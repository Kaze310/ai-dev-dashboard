import { NextResponse } from "next/server";

import { parseMonthlyLimitField, parseThresholdField } from "@/lib/budget-validation";
import { createClient } from "@/lib/supabase/server";

type ProviderBudgetPutBody = {
  monthly_limit_cents?: number | null;
  alert_threshold_pct?: number;
};

export async function PUT(
  request: Request,
  context: { params: Promise<{ providerId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { providerId } = await context.params;

  let body: ProviderBudgetPutBody;
  try {
    body = (await request.json()) as ProviderBudgetPutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // 字段语义:缺席 = 不改动;显式 null/空 = 清除 limit;非法 = 400。
  // 此前 `PUT {alert_threshold_pct: 90}` 会把缺席的 limit 当 null 清掉预算。
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

  if (monthlyLimit.kind === "missing" && alertThreshold.kind === "missing") {
    return NextResponse.json(
      { error: "Nothing to update: provide monthly_limit_cents and/or alert_threshold_pct" },
      { status: 400 },
    );
  }

  const updatePayload: { monthly_limit_cents?: number | null; alert_threshold_pct?: number } = {};
  if (monthlyLimit.kind === "clear") {
    updatePayload.monthly_limit_cents = null;
  } else if (monthlyLimit.kind === "value") {
    updatePayload.monthly_limit_cents = monthlyLimit.cents;
  }
  if (alertThreshold.kind === "value") {
    updatePayload.alert_threshold_pct = alertThreshold.pct;
  }

  const { data: provider, error: queryError } = await supabase
    .from("providers")
    .select("id, user_id")
    .eq("id", providerId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  if (!provider?.id) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("providers")
    .update(updatePayload)
    .eq("id", provider.id)
    .eq("user_id", user.id)
    .select("id, name, monthly_limit_cents, alert_threshold_pct")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ saved: true, provider: data });
}
