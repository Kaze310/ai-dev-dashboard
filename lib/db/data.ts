import "server-only";
import { withUserDatabase } from "./pool";
import type { UsageRecordRow } from "@/lib/usage-records";

export type ChartAggregateRow = {
  date: string; provider_name: string; model: string;
  input_tokens: string; output_tokens: string; cost_cents: string;
};

export function getChartData(userId: string, start: string, endExclusive: string) {
  return withUserDatabase(userId, async (db) => (await db.query<ChartAggregateRow>(
    "SELECT * FROM public.usage_daily_model_aggregates($1::date, $2::date)", [start, endExclusive],
  )).rows);
}

export function getCostTotal(userId: string, start: string, endExclusive: string) {
  return withUserDatabase(userId, async (db) => (await db.query<{ total: string }>(
    "SELECT public.usage_cost_total($1::date, $2::date) AS total", [start, endExclusive],
  )).rows[0].total);
}

export function getUsageRecords(userId: string) {
  return withUserDatabase(userId, async (db) => (await db.query<UsageRecordRow>(`
    SELECT u.id, u.date, u.model, u.input_tokens, u.output_tokens, u.cost_cents,
           json_build_object('name', p.name) AS provider
    FROM public.usage_records u JOIN public.providers p ON p.id = u.provider_id AND p.user_id = u.user_id
    WHERE u.user_id = $1 ORDER BY u.date DESC, u.created_at DESC, u.id DESC LIMIT 250`, [userId],
  )).rows);
}

export function getConfiguredProviders(userId: string) {
  return withUserDatabase(userId, async (db) => (await db.query<{ name: string }>(
    "SELECT name FROM public.providers WHERE user_id = $1 AND name IN ('openai', 'anthropic')", [userId],
  )).rows);
}
