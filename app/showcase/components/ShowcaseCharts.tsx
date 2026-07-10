"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ShowcaseDailyCostPoint = {
  date: string;
  openai: number;
  anthropic: number;
  other: number;
  total?: number;
};

export type ShowcaseModelCostPoint = {
  model: string;
  costUsd: number;
};

export type ShowcaseChartsProps = {
  dailyCostTrend: ReadonlyArray<ShowcaseDailyCostPoint>;
  costByModel: ReadonlyArray<ShowcaseModelCostPoint>;
  title?: string;
  description?: string;
};

type ChartTooltipEntry = {
  dataKey?: string | number;
  color?: string;
  name?: string | number;
  value?: number | string;
};

type ChartTooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: ChartTooltipEntry[];
};

function formatDateLabel(value: string) {
  return typeof value === "string" ? value.slice(5) : "";
}

function formatUsd(value: number | string | undefined) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  if (numeric > 0 && numeric < 0.01) {
    return "<$0.01";
  }

  return `$${(Number.isFinite(numeric) ? numeric : 0).toFixed(2)}`;
}

function formatTokens(value: number | string | undefined) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return (Number.isFinite(numeric) ? numeric : 0).toLocaleString();
}

function shortenModelName(model: string) {
  const trimmed = model.trim().replace(/-(20\d{2}-\d{2}-\d{2})$/, "").replace(/-(20\d{6})$/, "");
  if (!trimmed) {
    return "Unknown";
  }

  if (trimmed.toLowerCase() === "gpt-5.2-codex") {
    return "GPT-5.2 Codex";
  }

  return trimmed
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function ChartTooltip({ active, label, payload }: ChartTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-[#fffaf2]/95 px-3 py-2.5 shadow-[0_14px_34px_rgba(66,52,29,0.12)] backdrop-blur">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--accent)]">{String(label)}</p>
      <div className="mt-2 space-y-1.5">
        {payload.map((entry) => {
          const name = String(entry.name ?? entry.dataKey ?? "Value");
          const isTokenValue = name.toLowerCase().includes("token");
          return (
            <div key={String(entry.dataKey)} className="flex min-w-[150px] items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-2 text-zinc-600">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color ?? "#1f6f78" }} />
                {name}
              </span>
              <span className="font-semibold text-zinc-900">{isTokenValue ? formatTokens(entry.value) : formatUsd(entry.value)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return <div className="soft-panel flex h-[260px] items-center justify-center rounded-[20px] px-5 text-center text-sm text-zinc-500">{message}</div>;
}

export function ShowcaseCharts({
  dailyCostTrend,
  costByModel,
  title = "Usage, cost, and model mix",
  description = "A compact view of the signals the dashboard brings together for day-to-day AI spend decisions.",
}: ShowcaseChartsProps) {
  const hasCostTrendData = dailyCostTrend.some((point) => point.openai > 0 || point.anthropic > 0 || point.other > 0);
  const hasModelCostData = costByModel.some((point) => point.costUsd > 0);

  return (
    <section aria-labelledby="showcase-charts-title" className="mt-10">
      <div className="max-w-2xl">
        <p className="section-eyebrow">Live shape of the product</p>
        <h2 id="showcase-charts-title" className="mt-2 text-2xl font-semibold text-zinc-950">{title}</h2>
        {description ? <p className="mt-3 text-sm leading-6 text-zinc-600">{description}</p> : null}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <article className="glass-panel min-w-0 rounded-[26px] p-5" aria-label="Daily cost trend chart">
          <p className="section-eyebrow">Trend</p>
          <h3 className="mt-2 text-base font-semibold text-zinc-900">Daily cost trend</h3>
          <p className="mt-1 text-sm text-zinc-600">Provider spend over the selected window.</p>
          <div className="mt-4 min-w-0">
            {hasCostTrendData ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={dailyCostTrend} margin={{ top: 8, right: 4, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="4 6" stroke="#d7d2c8" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={formatDateLabel} axisLine={false} tickLine={false} tick={{ fill: "#667274", fontSize: 11 }} />
                  <YAxis tickFormatter={(value) => `$${value}`} axisLine={false} tickLine={false} tick={{ fill: "#667274", fontSize: 11 }} width={42} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                  <Area type="monotone" dataKey="openai" stackId="cost" stroke="#39779a" strokeWidth={2} fill="#cfe3e7" fillOpacity={0.85} name="OpenAI" />
                  <Area type="monotone" dataKey="anthropic" stackId="cost" stroke="#4d8768" strokeWidth={2} fill="#d8e9d9" fillOpacity={0.85} name="Anthropic" />
                  <Area type="monotone" dataKey="other" stackId="cost" stroke="#a68e69" strokeWidth={2} fill="#f0e4ca" fillOpacity={0.85} name="Other" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="No cost data for this showcase window." />
            )}
          </div>
        </article>

        <article className="glass-panel min-w-0 rounded-[26px] p-5" aria-label="Cost by model family chart">
          <p className="section-eyebrow">Mix</p>
          <h3 className="mt-2 text-base font-semibold text-zinc-900">Cost by model family</h3>
          <p className="mt-1 text-sm text-zinc-600">Normalized model families ranked by total spend.</p>
          <div className="mt-4 min-w-0">
            {hasModelCostData ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={costByModel} margin={{ top: 8, right: 4, left: 0, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="4 6" stroke="#d7d2c8" vertical={false} />
                  <XAxis dataKey="model" interval={0} height={52} axisLine={false} tickLine={false} tick={{ fill: "#667274", fontSize: 11 }} tickFormatter={(value) => shortenModelName(String(value))} />
                  <YAxis tickFormatter={(value) => `$${value}`} axisLine={false} tickLine={false} tick={{ fill: "#667274", fontSize: 11 }} width={42} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="costUsd" fill="#5d9bb0" radius={[7, 7, 0, 0]} name="Cost (USD)" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="No model-family cost data for this showcase window." />
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
