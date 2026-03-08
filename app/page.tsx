import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getProviderName, toNumber, type UsageRecordRow } from "@/lib/usage-records";

import { BudgetSection } from "./components/BudgetSection";
import { DashboardCharts, type DailyCostPoint, type DailyTokenPoint, type ModelCostPoint } from "./components/DashboardCharts";
import { SyncButtons } from "./SyncButtons";
import { CostSummary } from "./components/CostSummary";

function normalizeDateKey(value: unknown) {
  // 兼容 YYYY-MM-DD、ISO datetime、Date 对象，统一聚合键为 YYYY-MM-DD。
  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return "";
}

function getLast30DaysRange() {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startUtc = new Date(todayUtc);
  startUtc.setUTCDate(startUtc.getUTCDate() - 29);

  const endExclusive = new Date(todayUtc);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  return {
    start: startUtc.toISOString().slice(0, 10),
    endExclusive: endExclusive.toISOString().slice(0, 10),
  };
}

function buildDateSeries(startDate: string, endExclusive: string): string[] {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endExclusive}T00:00:00.000Z`);
  const dates: string[] = [];

  while (start < end) {
    dates.push(start.toISOString().slice(0, 10));
    start.setUTCDate(start.getUTCDate() + 1);
  }

  return dates;
}

function buildDateSeriesFromRows(rows: UsageRecordRow[], fallbackStart: string, fallbackEndExclusive: string): string[] {
  const normalizedDates = rows
    .map((row) => normalizeDateKey(row.date))
    .filter((date): date is string => Boolean(date));

  if (normalizedDates.length === 0) {
    return buildDateSeries(fallbackStart, fallbackEndExclusive);
  }

  const sorted = [...new Set(normalizedDates)].sort();
  const minDate = sorted[0];
  const maxDate = sorted[sorted.length - 1];
  const endExclusive = new Date(`${maxDate}T00:00:00.000Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  return buildDateSeries(minDate, endExclusive.toISOString().slice(0, 10));
}

function aggregateChartData(rows: UsageRecordRow[], startDate: string, endExclusive: string) {
  // 用真实数据的日期范围生成 X 轴，避免“有数据但全落在 0 区”。
  const dates = buildDateSeriesFromRows(rows, startDate, endExclusive);

  const dailyCostMap = new Map<string, { openai: number; anthropic: number; other: number }>();
  const dailyTokenMap = new Map<string, { inputTokens: number; outputTokens: number }>();
  const modelCostMap = new Map<string, number>();

  for (const date of dates) {
    dailyCostMap.set(date, { openai: 0, anthropic: 0, other: 0 });
    dailyTokenMap.set(date, { inputTokens: 0, outputTokens: 0 });
  }

  for (const row of rows) {
    const rowDate = normalizeDateKey(row.date);

    if (!dailyCostMap.has(rowDate) || !dailyTokenMap.has(rowDate)) {
      continue;
    }

    const provider = getProviderName(row.provider).toLowerCase();
    const costCents = toNumber(row.cost_cents);
    const inputTokens = toNumber(row.input_tokens);
    const outputTokens = toNumber(row.output_tokens);

    const currentCost = dailyCostMap.get(rowDate) ?? { openai: 0, anthropic: 0, other: 0 };
    if (provider === "openai") {
      currentCost.openai += costCents;
    } else if (provider === "anthropic") {
      currentCost.anthropic += costCents;
    } else {
      currentCost.other += costCents;
    }
    dailyCostMap.set(rowDate, currentCost);

    const currentTokens = dailyTokenMap.get(rowDate) ?? { inputTokens: 0, outputTokens: 0 };
    currentTokens.inputTokens += inputTokens;
    currentTokens.outputTokens += outputTokens;
    dailyTokenMap.set(rowDate, currentTokens);

    const modelName = row.model?.trim() || "unknown";
    modelCostMap.set(modelName, (modelCostMap.get(modelName) ?? 0) + costCents);
  }

  const dailyCostTrend: DailyCostPoint[] = dates.map((date) => {
    const values = dailyCostMap.get(date) ?? { openai: 0, anthropic: 0, other: 0 };
    const openai = values.openai / 100;
    const anthropic = values.anthropic / 100;
    const other = values.other / 100;

    return {
      date,
      openai,
      anthropic,
      other,
      total: openai + anthropic + other,
    };
  });

  const dailyTokenUsage: DailyTokenPoint[] = dates.map((date) => {
    const tokens = dailyTokenMap.get(date) ?? { inputTokens: 0, outputTokens: 0 };
    return {
      date,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
    };
  });

  const costByModel: ModelCostPoint[] = [...modelCostMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([model, cents]) => ({
      model,
      costUsd: cents / 100,
    }));

  return { dailyCostTrend, dailyTokenUsage, costByModel };
}

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { start: chartStart, endExclusive: chartEndExclusive } = getLast30DaysRange();

  const { data: chartRows, error: chartError } = await supabase
    .from("usage_records")
    .select("id, date, model, input_tokens, output_tokens, cost_cents, provider:providers(name)")
    .eq("user_id", user.id)
    .gte("date", chartStart)
    .lt("date", chartEndExclusive);

  if (chartError) {
    throw new Error(chartError.message);
  }

  const { dailyCostTrend, dailyTokenUsage, costByModel } = aggregateChartData(
    (chartRows ?? []) as UsageRecordRow[],
    chartStart,
    chartEndExclusive,
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-10 sm:px-6 sm:py-14">
      <section className="glass-panel relative overflow-hidden rounded-[34px] px-6 py-7 sm:px-8 sm:py-9">
        <div className="absolute right-0 top-0 h-44 w-44 rounded-full bg-[#d8ece7] blur-3xl" />
        <div className="absolute bottom-0 left-8 h-28 w-28 rounded-full bg-[#ead6a6]/40 blur-3xl" />

        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="section-eyebrow">Unified Spend Intelligence</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-950 sm:text-5xl">
              AI Dev Dashboard
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-zinc-700 sm:text-lg">
              Track OpenAI and Anthropic usage in one quiet, readable workspace with budgets, alerts, and model-level visibility.
            </p>
          </div>

          <div className="relative flex flex-col gap-3 sm:items-end">
            <div className="rounded-[24px] border border-white/70 bg-white/72 px-5 py-4 shadow-sm backdrop-blur">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Signed in as</p>
              <p className="mt-2 text-sm font-medium text-zinc-900">{user.email}</p>
            </div>

            <Link
              href="/settings"
              className="inline-flex items-center rounded-full bg-[color:var(--foreground)] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:-translate-y-0.5"
            >
              Open Settings
            </Link>
          </div>
        </div>
      </section>

      <section className="glass-panel mt-5 rounded-[28px] p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="section-eyebrow">Refresh</p>
            <h2 className="mt-2 text-lg font-semibold text-zinc-900">Manual Sync</h2>
            <p className="mt-1 text-sm text-zinc-600">Pull the latest usage data from OpenAI and Anthropic on demand.</p>
          </div>

          <div className="rounded-full bg-white/70 px-4 py-2 text-xs uppercase tracking-[0.2em] text-zinc-500 shadow-sm">
            provider APIs only
          </div>
        </div>
        <SyncButtons />
      </section>

      <CostSummary />
      <BudgetSection />

      <DashboardCharts dailyCostTrend={dailyCostTrend} costByModel={costByModel} dailyTokenUsage={dailyTokenUsage} />

      <section className="glass-panel mt-10 rounded-[30px] p-6 sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="section-eyebrow">Records</p>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-900">Raw usage now lives on its own page</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-600">
              The dashboard stays focused on spend, budget status, and trends. Open the dedicated records view only when you need row-level inspection.
            </p>
          </div>

          <Link
            href="/records"
            className="inline-flex items-center justify-center rounded-full bg-[color:var(--foreground)] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:-translate-y-0.5"
          >
            Open Records
          </Link>
        </div>
      </section>
    </main>
  );
}
