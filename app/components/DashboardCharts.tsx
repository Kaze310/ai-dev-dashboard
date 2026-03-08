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

export type DailyCostPoint = {
  date: string;
  openai: number;
  anthropic: number;
  other: number;
  total: number;
};

export type ModelCostPoint = {
  model: string;
  costUsd: number;
};

export type DailyTokenPoint = {
  date: string;
  inputTokens: number;
  outputTokens: number;
};

type DashboardChartsProps = {
  dailyCostTrend: DailyCostPoint[];
  costByModel: ModelCostPoint[];
  dailyTokenUsage: DailyTokenPoint[];
};

function formatUsd(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatDateLabel(dateString: string) {
  if (typeof dateString !== "string") {
    return "";
  }

  return dateString.slice(5);
}

function toTitleCase(value: string) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function shortenModelName(model: string) {
  if (typeof model !== "string") {
    return "";
  }

  const trimmed = model.trim();
  if (!trimmed) {
    return "";
  }

  const noDateSuffix = trimmed
    .replace(/-(20\d{2}-\d{2}-\d{2})$/, "")
    .replace(/-(20\d{6})$/, "");
  const lower = noDateSuffix.toLowerCase();

  if (lower === "gpt-5.2-codex") {
    return "GPT-5.2 Codex";
  }

  if (lower.startsWith("claude-opus-4-6")) {
    return "Opus 4.6";
  }

  if (lower.startsWith("claude-opus-4-5")) {
    return "Opus 4.5";
  }

  if (lower.startsWith("claude-sonnet-4-5")) {
    return "Sonnet 4.5";
  }

  if (lower.startsWith("claude-sonnet-4")) {
    return "Sonnet 4";
  }

  if (lower.startsWith("claude-opus-4")) {
    return "Opus 4";
  }

  // 通用兜底：去日期后缀后做标题化展示，仅用于图表标签。
  return toTitleCase(noDateSuffix);
}

function tooltipUsd(value: number | string | undefined) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return formatUsd(Number.isFinite(numeric) ? numeric : 0);
}

function tooltipTokens(value: number | string | undefined) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return (Number.isFinite(numeric) ? numeric : 0).toLocaleString();
}

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

function ChartTooltip({ active, label, payload }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <div className="rounded-[20px] border border-[color:var(--line)] bg-[#fffaf2]/96 px-4 py-3 shadow-[0_18px_44px_rgba(66,52,29,0.12)] backdrop-blur">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">{label}</p>
      <div className="mt-3 space-y-2">
        {payload.map((entry: ChartTooltipEntry) => (
          <div key={String(entry.dataKey)} className="flex min-w-[180px] items-center justify-between gap-4 text-sm">
            <div className="flex items-center gap-2 text-zinc-700">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: typeof entry.color === "string" ? entry.color : "#1f6f78" }}
              />
              <span>{String(entry.name)}</span>
            </div>
            <span className="font-semibold text-zinc-900">
              {String(entry.name).toLowerCase().includes("token")
                ? tooltipTokens(entry.value as number | string | undefined)
                : tooltipUsd(entry.value as number | string | undefined)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardCharts({ dailyCostTrend, costByModel, dailyTokenUsage }: DashboardChartsProps) {
  const hasCostTrendData = dailyCostTrend.some((item) => item.openai > 0 || item.anthropic > 0 || item.other > 0);
  const hasModelCostData = costByModel.some((item) => item.costUsd > 0);
  const hasTokenData = dailyTokenUsage.some((item) => item.inputTokens > 0 || item.outputTokens > 0);

  return (
    <section className="mt-10 space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="glass-panel rounded-[28px] p-5">
          <p className="section-eyebrow">Trend</p>
          <h3 className="mt-2 text-base font-semibold text-zinc-900">Daily Cost Trend</h3>
          <p className="mt-1 text-sm text-zinc-600">Last 30 days, stacked by provider.</p>
          <div className="mt-4 w-full">
            {hasCostTrendData ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={dailyCostTrend} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <defs>
                    <linearGradient id="costOpenAiFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4a8fb0" stopOpacity={0.7} />
                      <stop offset="100%" stopColor="#4a8fb0" stopOpacity={0.08} />
                    </linearGradient>
                    <linearGradient id="costAnthropicFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4f8c6d" stopOpacity={0.7} />
                      <stop offset="100%" stopColor="#4f8c6d" stopOpacity={0.08} />
                    </linearGradient>
                    <linearGradient id="costOtherFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a68e69" stopOpacity={0.65} />
                      <stop offset="100%" stopColor="#a68e69" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 6" stroke="#d7d2c8" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={formatDateLabel} axisLine={false} tickLine={false} tick={{ fill: "#667274", fontSize: 12 }} />
                  <YAxis tickFormatter={(value) => `$${value}`} axisLine={false} tickLine={false} tick={{ fill: "#667274", fontSize: 12 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <Area type="monotone" dataKey="openai" stackId="cost" stroke="#39779a" strokeWidth={2} fill="url(#costOpenAiFill)" name="OpenAI" />
                  <Area
                    type="monotone"
                    dataKey="anthropic"
                    stackId="cost"
                    stroke="#4d8768"
                    strokeWidth={2}
                    fill="url(#costAnthropicFill)"
                    name="Anthropic"
                  />
                  <Area type="monotone" dataKey="other" stackId="cost" stroke="#a68e69" strokeWidth={2} fill="url(#costOtherFill)" name="Other" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="soft-panel flex h-full items-center justify-center rounded-[22px] text-sm text-zinc-500">
                最近 30 天暂无成本数据
              </div>
            )}
          </div>
        </div>

        <div className="glass-panel rounded-[28px] p-5">
          <p className="section-eyebrow">Mix</p>
          <h3 className="mt-2 text-base font-semibold text-zinc-900">Cost by Model</h3>
          <p className="mt-1 text-sm text-zinc-600">Top models ranked by total spend.</p>
          <div className="mt-4 w-full">
            {hasModelCostData ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={costByModel} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="4 6" stroke="#d7d2c8" vertical={false} />
                  <XAxis
                    dataKey="model"
                    interval={0}
                    angle={0}
                    textAnchor="middle"
                    minTickGap={16}
                    height={48}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#667274", fontSize: 12 }}
                    tickFormatter={(value) => shortenModelName(String(value))}
                  />
                  <YAxis tickFormatter={(value) => `$${value}`} axisLine={false} tickLine={false} tick={{ fill: "#667274", fontSize: 12 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="costUsd" fill="#5d9bb0" radius={[8, 8, 0, 0]} name="Cost (USD)" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="soft-panel flex h-full items-center justify-center rounded-[22px] text-sm text-zinc-500">
                暂无模型成本数据
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="glass-panel rounded-[28px] p-5">
        <p className="section-eyebrow">Volume</p>
        <h3 className="mt-2 text-base font-semibold text-zinc-900">Daily Token Usage</h3>
        <p className="mt-1 text-sm text-zinc-600">Input versus output tokens across the same 30-day window.</p>
        <div className="mt-4 w-full">
          {hasTokenData ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={dailyTokenUsage} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="4 6" stroke="#d7d2c8" vertical={false} />
                <XAxis dataKey="date" tickFormatter={formatDateLabel} axisLine={false} tickLine={false} tick={{ fill: "#667274", fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#667274", fontSize: 12 }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Bar dataKey="inputTokens" stackId="tokens" fill="#4a8fb0" radius={[8, 8, 0, 0]} name="Input Tokens" />
                <Bar dataKey="outputTokens" stackId="tokens" fill="#d48645" radius={[8, 8, 0, 0]} name="Output Tokens" minPointSize={2} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="soft-panel flex h-full items-center justify-center rounded-[22px] text-sm text-zinc-500">
              最近 30 天暂无 token 数据
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
