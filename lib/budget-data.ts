import type { SupabaseClient } from "@supabase/supabase-js";

import { getAppTimeZone, getCurrentLocalDateParts, getMonthRange } from "@/lib/date-range";
import { toNumber } from "@/lib/normalize";

export type GlobalBudgetData = {
  id: string;
  monthly_limit_cents: number;
  alert_threshold_pct: number;
  current_month_cents: number;
};

export type ProviderBudgetData = {
  id: string;
  name: string;
  monthly_limit_cents: number | null;
  alert_threshold_pct: number;
  current_month_cents: number;
};

export type BudgetData = {
  month: { start: string; endExclusive: string; timeZone: string };
  global: GlobalBudgetData | null;
  providers: ProviderBudgetData[];
};

/**
 * 预算数据的唯一取数路径,供 /api/budget GET 与 server component 共用。
 * 月度花费通过 RPC 在数据库端聚合(usage_provider_totals),
 * 不再 select 原始行——PostgREST 默认 1000 行上限会静默截断求和结果。
 */
export async function getBudgetData(supabase: SupabaseClient, userId: string): Promise<BudgetData> {
  const timeZone = getAppTimeZone();
  const { year, month } = getCurrentLocalDateParts(timeZone);
  const { start, endExclusive } = getMonthRange(year, month);

  const [globalResult, providersResult, totalsResult] = await Promise.all([
    supabase
      .from("budgets")
      .select("id, monthly_limit_cents, alert_threshold_pct")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("providers")
      .select("id, name, monthly_limit_cents, alert_threshold_pct")
      .eq("user_id", userId)
      .order("name", { ascending: true }),
    supabase.rpc("usage_provider_totals", { p_start: start, p_end_exclusive: endExclusive }),
  ]);

  if (globalResult.error) {
    throw new Error(globalResult.error.message);
  }
  if (providersResult.error) {
    throw new Error(providersResult.error.message);
  }
  if (totalsResult.error) {
    throw new Error(totalsResult.error.message);
  }

  const providerSpendMap = new Map<string, number>();
  let globalSpend = 0;

  for (const row of (totalsResult.data ?? []) as Array<{ provider_id: string; total_cents: unknown }>) {
    const cents = Math.max(0, toNumber(row.total_cents));
    globalSpend += cents;
    providerSpendMap.set(String(row.provider_id), cents);
  }

  const globalBudget = globalResult.data;

  return {
    month: { start, endExclusive, timeZone },
    global: globalBudget
      ? {
          id: globalBudget.id,
          monthly_limit_cents: globalBudget.monthly_limit_cents,
          alert_threshold_pct: globalBudget.alert_threshold_pct,
          current_month_cents: globalSpend,
        }
      : null,
    providers: (providersResult.data ?? []).map((provider) => ({
      id: provider.id,
      name: provider.name,
      monthly_limit_cents: provider.monthly_limit_cents,
      alert_threshold_pct: provider.alert_threshold_pct,
      current_month_cents: providerSpendMap.get(provider.id) ?? 0,
    })),
  };
}
