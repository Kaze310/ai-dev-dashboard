import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { DashboardCharts, type DailyCostPoint, type DailyTokenPoint, type ModelCostPoint } from "./components/DashboardCharts";
import { SyncButtons } from "./SyncButtons";
import { CostSummary } from "./components/CostSummary";

type ProviderRef = {
  name: string;
};

type UsageRecordRow = {
  id: string;
  date: string;
  model: string;
  input_tokens: number | string | null;
  output_tokens: number | string | null;
  cost_cents: number | string | null;
  provider: ProviderRef | ProviderRef[] | null;
};

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function formatDate(dateString: string) {
  return new Date(`${dateString}T00:00:00.000Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
  });
}

function formatCost(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function getProviderName(provider: UsageRecordRow["provider"]) {
  if (!provider) {
    return "unknown";
  }

  if (Array.isArray(provider)) {
    return provider[0]?.name ?? "unknown";
  }

  return provider.name;
}

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

  const [{ data: usageRecords, error }, { data: chartRows, error: chartError }] = await Promise.all([
      supabase
        .from("usage_records")
        .select("id, date, model, input_tokens, output_tokens, cost_cents, provider:providers(name)")
        .eq("user_id", user.id)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("usage_records")
        .select("id, date, model, input_tokens, output_tokens, cost_cents, provider:providers(name)")
        .eq("user_id", user.id)
        .gte("date", chartStart)
        .lt("date", chartEndExclusive),
    ]);

  if (error) {
    throw new Error(error.message);
  }

  if (chartError) {
    throw new Error(chartError.message);
  }

  const rows = (usageRecords ?? []) as UsageRecordRow[];

  const { dailyCostTrend, dailyTokenUsage, costByModel } = aggregateChartData(
    (chartRows ?? []) as UsageRecordRow[],
    chartStart,
    chartEndExclusive,
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-16">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold">AI Dev Dashboard</h1>
          <p className="mt-3 text-lg text-zinc-700">Signed in as: {user.email}</p>
        </div>

        <Link href="/settings" className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium">
          Settings
        </Link>
      </div>

      <CostSummary />

      <section className="mt-4 rounded-lg border border-zinc-200 p-5">
        <h2 className="text-lg font-semibold">Manual Sync</h2>
        <p className="mt-1 text-sm text-zinc-600">手动同步 OpenAI 与 Anthropic 最新 usage 数据。</p>
        <SyncButtons />
      </section>

      <DashboardCharts dailyCostTrend={dailyCostTrend} costByModel={costByModel} dailyTokenUsage={dailyTokenUsage} />

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Recent Usage</h2>
        <p className="mt-1 text-sm text-zinc-600">日期按 provider 返回的 UTC bucket date 展示。</p>

        <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-4 py-3 font-medium">Date (UTC bucket)</th>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium">Input Tokens</th>
                <th className="px-4 py-3 font-medium">Output Tokens</th>
                <th className="px-4 py-3 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-zinc-500" colSpan={6}>
                    暂无 usage 数据。先到 Settings 保存 OpenAI / Anthropic key，再执行同步。
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-t border-zinc-200">
                    <td className="px-4 py-3">{formatDate(row.date)}</td>
                    <td className="px-4 py-3">{getProviderName(row.provider)}</td>
                    <td className="px-4 py-3">{row.model}</td>
                    <td className="px-4 py-3">{toNumber(row.input_tokens).toLocaleString()}</td>
                    <td className="px-4 py-3">{toNumber(row.output_tokens).toLocaleString()}</td>
                    <td className="px-4 py-3">{formatCost(toNumber(row.cost_cents))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
