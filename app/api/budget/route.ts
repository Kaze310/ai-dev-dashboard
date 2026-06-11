import { NextResponse } from "next/server";

import { getBudgetData } from "@/lib/budget-data";
import {
  DEFAULT_ALERT_THRESHOLD_PCT,
  parseMonthlyLimitField,
  parseThresholdField,
} from "@/lib/budget-validation";
import { createClient } from "@/lib/supabase/server";

type BudgetPutBody = {
  monthly_limit_cents?: number | null;
  alert_threshold_pct?: number;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await getBudgetData(supabase, user.id);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: BudgetPutBody;
  try {
    body = (await request.json()) as BudgetPutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawBody = (body ?? {}) as Record<string, unknown>;
  const monthlyLimit = parseMonthlyLimitField(rawBody);
  if (monthlyLimit.kind === "invalid") {
    return NextResponse.json(
      { error: "monthly_limit_cents must be a positive number, or null/empty to clear the budget" },
      { status: 400 },
    );
  }

  const alertThreshold = parseThresholdField(rawBody);
  if (alertThreshold.kind === "invalid") {
    return NextResponse.json(
      { error: "alert_threshold_pct must be a number between 1 and 100" },
      { status: 400 },
    );
  }

  // 字段缺席 = 不改动。`PUT {}` 此前会把 undefined 当成 clear 删掉预算。
  if (monthlyLimit.kind === "missing" && alertThreshold.kind === "missing") {
    return NextResponse.json({ error: "Nothing to update: provide monthly_limit_cents and/or alert_threshold_pct" }, { status: 400 });
  }

  // 只有显式 null/空才清除全局预算。
  if (monthlyLimit.kind === "clear") {
    const { error } = await supabase.from("budgets").delete().eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ saved: true, global: null, cleared: true });
  }

  // limit 缺席、只改阈值:更新现有行;没有现有预算则无从更新。
  if (monthlyLimit.kind === "missing") {
    const { data, error } = await supabase
      .from("budgets")
      .update({ alert_threshold_pct: alertThreshold.kind === "value" ? alertThreshold.pct : DEFAULT_ALERT_THRESHOLD_PCT })
      .eq("user_id", user.id)
      .select("id, monthly_limit_cents, alert_threshold_pct")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json(
        { error: "No existing budget to update: provide monthly_limit_cents to create one" },
        { status: 400 },
      );
    }

    return NextResponse.json({ saved: true, global: data });
  }

  // limit 有值、阈值也显式提供:两个字段都是用户意图,直接 upsert。
  if (alertThreshold.kind === "value") {
    const { data, error } = await supabase
      .from("budgets")
      .upsert(
        {
          user_id: user.id,
          monthly_limit_cents: monthlyLimit.cents,
          alert_threshold_pct: alertThreshold.pct,
        },
        { onConflict: "user_id" },
      )
      .select("id, monthly_limit_cents, alert_threshold_pct")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ saved: true, global: data });
  }

  // limit 有值、阈值缺席:原子 UPDATE 只动 limit,完全不触碰阈值。
  // 此前的实现是“读旧阈值再 upsert”——读取错误被忽略会用默认 80 覆盖,
  // 并发修改阈值也会被旧值覆盖。
  const { data: updated, error: updateError } = await supabase
    .from("budgets")
    .update({ monthly_limit_cents: monthlyLimit.cents })
    .eq("user_id", user.id)
    .select("id, monthly_limit_cents, alert_threshold_pct")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (updated) {
    return NextResponse.json({ saved: true, global: updated });
  }

  // 不存在则新建(阈值用默认值)。与并发创建竞态撞唯一索引时,重试一次 UPDATE。
  const { data: inserted, error: insertError } = await supabase
    .from("budgets")
    .insert({
      user_id: user.id,
      monthly_limit_cents: monthlyLimit.cents,
      alert_threshold_pct: DEFAULT_ALERT_THRESHOLD_PCT,
    })
    .select("id, monthly_limit_cents, alert_threshold_pct")
    .single();

  if (!insertError) {
    return NextResponse.json({ saved: true, global: inserted });
  }

  const { data: retried, error: retryError } = await supabase
    .from("budgets")
    .update({ monthly_limit_cents: monthlyLimit.cents })
    .eq("user_id", user.id)
    .select("id, monthly_limit_cents, alert_threshold_pct")
    .maybeSingle();

  if (retryError || !retried) {
    return NextResponse.json({ error: retryError?.message ?? insertError.message }, { status: 500 });
  }

  return NextResponse.json({ saved: true, global: retried });
}
