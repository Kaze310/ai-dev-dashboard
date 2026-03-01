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

export function DashboardCharts({ dailyCostTrend, costByModel, dailyTokenUsage }: DashboardChartsProps) {
  const hasCostTrendData = dailyCostTrend.some((item) => item.openai > 0 || item.anthropic > 0 || item.other > 0);
  const hasModelCostData = costByModel.some((item) => item.costUsd > 0);
  const hasTokenData = dailyTokenUsage.some((item) => item.inputTokens > 0 || item.outputTokens > 0);

  return (
    <section className="mt-10 space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 p-4">
          <h3 className="text-base font-semibold">Daily Cost Trend (Last 30 Days)</h3>
          <div className="mt-4 w-full">
            {hasCostTrendData ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={dailyCostTrend} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                  <XAxis dataKey="date" tickFormatter={formatDateLabel} />
                  <YAxis tickFormatter={(value) => `$${value}`} />
                  <Tooltip formatter={tooltipUsd} labelFormatter={(label) => `Date: ${label}`} />
                  <Legend />
                  <Area type="monotone" dataKey="openai" stackId="cost" stroke="#2563eb" fill="#60a5fa" name="OpenAI" />
                  <Area
                    type="monotone"
                    dataKey="anthropic"
                    stackId="cost"
                    stroke="#059669"
                    fill="#34d399"
                    name="Anthropic"
                  />
                  <Area type="monotone" dataKey="other" stackId="cost" stroke="#6b7280" fill="#9ca3af" name="Other" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center rounded-md bg-zinc-50 text-sm text-zinc-500">
                最近 30 天暂无成本数据
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 p-4">
          <h3 className="text-base font-semibold">Cost by Model</h3>
          <div className="mt-4 w-full">
            {hasModelCostData ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={costByModel} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                  <XAxis
                    dataKey="model"
                    interval={0}
                    angle={0}
                    textAnchor="middle"
                    minTickGap={16}
                    height={48}
                    tickFormatter={(value) => shortenModelName(String(value))}
                  />
                  <YAxis tickFormatter={(value) => `$${value}`} />
                  <Tooltip formatter={tooltipUsd} labelFormatter={(label) => `Model: ${shortenModelName(String(label))}`} />
                  <Bar dataKey="costUsd" fill="#0ea5e9" radius={[4, 4, 0, 0]} name="Cost (USD)" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center rounded-md bg-zinc-50 text-sm text-zinc-500">
                暂无模型成本数据
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 p-4">
        <h3 className="text-base font-semibold">Daily Token Usage (Last 30 Days)</h3>
        <div className="mt-4 w-full">
          {hasTokenData ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={dailyTokenUsage} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                <XAxis dataKey="date" tickFormatter={formatDateLabel} />
                <YAxis />
                <Tooltip
                  formatter={tooltipTokens}
                  labelFormatter={(label) => `Date: ${label}`}
                  itemStyle={{ color: "#111827" }}
                  contentStyle={{ borderColor: "#d4d4d8", borderRadius: 8 }}
                />
                <Legend />
                <Bar dataKey="inputTokens" stackId="tokens" fill="#2563eb" name="Input Tokens" />
                <Bar dataKey="outputTokens" stackId="tokens" fill="#f97316" name="Output Tokens" minPointSize={2} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-md bg-zinc-50 text-sm text-zinc-500">
              最近 30 天暂无 token 数据
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
