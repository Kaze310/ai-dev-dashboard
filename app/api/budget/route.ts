import { NextResponse } from "next/server";

import { getAppTimeZone, getCurrentLocalDateParts, getMonthRange } from "@/lib/date-range";
import { createClient } from "@/lib/supabase/server";

type BudgetPutBody = {
  monthly_limit_cents?: number;
  alert_threshold_pct?: number;
};

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  return NaN;
}

function normalizeThreshold(value: unknown): number {
  const parsed = Math.round(toNumber(value));
  if (!Number.isFinite(parsed)) {
    return 80;
  }

  return Math.min(100, Math.max(1, parsed));
}

function normalizeMonthlyLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Math.round(toNumber(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timeZone = getAppTimeZone();
  const { year, month } = getCurrentLocalDateParts(timeZone);
  const { start, endExclusive } = getMonthRange(year, month);

  const [{ data: globalBudget, error: globalError }, { data: providers, error: providersError }, { data: usageRows, error: usageError }] =
    await Promise.all([
      supabase
        .from("budgets")
        .select("id, monthly_limit_cents, alert_threshold_pct")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("providers")
        .select("id, name, monthly_limit_cents, alert_threshold_pct")
        .eq("user_id", user.id)
        .order("name", { ascending: true }),
      supabase
        .from("usage_records")
        .select("provider_id, cost_cents")
        .eq("user_id", user.id)
        .gte("date", start)
        .lt("date", endExclusive),
    ]);

  if (globalError) {
    return NextResponse.json({ error: globalError.message }, { status: 500 });
  }

  if (providersError) {
    return NextResponse.json({ error: providersError.message }, { status: 500 });
  }

  if (usageError) {
    return NextResponse.json({ error: usageError.message }, { status: 500 });
  }

  const providerSpendMap = new Map<string, number>();
  let globalSpend = 0;

  for (const row of usageRows ?? []) {
    const cents = Math.max(0, Math.round(toNumber(row.cost_cents)));
    globalSpend += cents;

    const key = String(row.provider_id ?? "");
    if (!key) {
      continue;
    }
    providerSpendMap.set(key, (providerSpendMap.get(key) ?? 0) + cents);
  }

  return NextResponse.json({
    month: { start, endExclusive, timeZone },
    global: globalBudget
      ? {
          id: globalBudget.id,
          monthly_limit_cents: globalBudget.monthly_limit_cents,
          alert_threshold_pct: globalBudget.alert_threshold_pct,
          current_month_cents: globalSpend,
        }
      : null,
    providers: (providers ?? []).map((provider) => ({
      id: provider.id,
      name: provider.name,
      monthly_limit_cents: provider.monthly_limit_cents,
      alert_threshold_pct: provider.alert_threshold_pct,
      current_month_cents: providerSpendMap.get(provider.id) ?? 0,
    })),
  });
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

  const monthlyLimit = normalizeMonthlyLimit(body.monthly_limit_cents);
  if (monthlyLimit === null) {
    return NextResponse.json({ error: "monthly_limit_cents must be a positive integer" }, { status: 400 });
  }

  const alertThreshold = normalizeThreshold(body.alert_threshold_pct);

  const { data, error } = await supabase
    .from("budgets")
    .upsert(
      {
        user_id: user.id,
        monthly_limit_cents: monthlyLimit,
        alert_threshold_pct: alertThreshold,
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
