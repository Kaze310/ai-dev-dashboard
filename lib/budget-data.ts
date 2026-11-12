import "server-only";
import { withUserDatabase } from "@/lib/db/pool";

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

export async function getBudgetData(userId: string): Promise<BudgetData> {
  const timeZone = getAppTimeZone();
  const { year, month } = getCurrentLocalDateParts(timeZone);
  const { start, endExclusive } = getMonthRange(year, month);
  return withUserDatabase(userId, async (db) => {
    const global = await db.query<Omit<GlobalBudgetData, "current_month_cents">>(
      "SELECT id, monthly_limit_cents, alert_threshold_pct FROM public.budgets WHERE user_id = $1", [userId]);
    const providers = await db.query<ProviderBudgetData>(`
      SELECT p.id, p.name, p.monthly_limit_cents, p.alert_threshold_pct,
             coalesce(t.total_cents, 0) AS current_month_cents
      FROM public.providers p
      LEFT JOIN public.usage_provider_totals($2::date, $3::date) t ON t.provider_id = p.id
      WHERE p.user_id = $1 ORDER BY p.name`, [userId, start, endExclusive]);
    const total = await db.query<{ cents: string }>(
      "SELECT public.usage_cost_total($1::date, $2::date) AS cents", [start, endExclusive]);
    return {
      month: { start, endExclusive, timeZone },
      global: global.rows[0] ? { ...global.rows[0], current_month_cents: toNumber(total.rows[0].cents) } : null,
      providers: providers.rows.map((row) => ({ ...row, current_month_cents: toNumber(row.current_month_cents) })),
    };
  });
}
