import { createPublicServerClient } from "@/lib/supabase/public-server";

export type ShowcaseProviderTotal = {
  name: string;
  costUsd: number;
};

export type ShowcaseModelTotal = {
  model: string;
  costUsd: number;
};

export type ShowcaseDailyTotal = {
  date: string;
  openai: number;
  anthropic: number;
  other: number;
  total: number;
  inputTokens: number;
  outputTokens: number;
};

export type ShowcaseData = {
  generatedAt: string | null;
  periodLabel: string;
  currentMonthUsd: number;
  totalTokens: number;
  budgetUsagePct: number;
  providerTotals: ShowcaseProviderTotal[];
  modelTotals: ShowcaseModelTotal[];
  dailyTotals: ShowcaseDailyTotal[];
  isLive: boolean;
};

type SnapshotRow = {
  generated_at: string | null;
  period_label: string | null;
  current_month_cents: number | string | null;
  total_tokens: number | string | null;
  budget_usage_pct: number | string | null;
  provider_totals: unknown;
  model_totals: unknown;
  daily_totals: unknown;
};

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
}

function providerLabel(value: unknown): string {
  const name = String(value ?? "").toLowerCase();
  if (name === "openai") return "OpenAI";
  if (name === "anthropic") return "Anthropic";
  return "Other";
}

function modelLabel(value: unknown): string {
  const name = String(value ?? "").toLowerCase();
  if (name.includes("gpt") || name.includes("openai")) return "GPT family";
  if (name.includes("claude") || name.includes("anthropic")) return "Claude family";
  return "Other models";
}

function normalizeSnapshot(row: SnapshotRow): ShowcaseData {
  const providerMap = new Map<string, number>();
  for (const item of asArray(row.provider_totals)) {
    const name = providerLabel(item.name);
    providerMap.set(name, (providerMap.get(name) ?? 0) + Math.max(0, toNumber(item.costCents)) / 100);
  }

  const modelMap = new Map<string, number>();
  for (const item of asArray(row.model_totals)) {
    const model = modelLabel(item.model);
    modelMap.set(model, (modelMap.get(model) ?? 0) + Math.max(0, toNumber(item.costCents)) / 100);
  }

  const dailyTotals = asArray(row.daily_totals)
    .map((item) => {
      const openai = Math.max(0, toNumber(item.openaiCents)) / 100;
      const anthropic = Math.max(0, toNumber(item.anthropicCents)) / 100;
      const other = Math.max(0, toNumber(item.otherCents)) / 100;
      return {
        date: String(item.date ?? "").slice(0, 10),
        openai,
        anthropic,
        other,
        total: openai + anthropic + other,
        inputTokens: Math.max(0, toNumber(item.inputTokens)),
        outputTokens: Math.max(0, toNumber(item.outputTokens)),
      };
    })
    .filter((item) => item.date.length > 0);

  return {
    generatedAt: row.generated_at,
    periodLabel: row.period_label || "Current month",
    currentMonthUsd: Math.max(0, toNumber(row.current_month_cents)) / 100,
    totalTokens: Math.max(0, toNumber(row.total_tokens)),
    budgetUsagePct: Math.min(100, Math.max(0, toNumber(row.budget_usage_pct))),
    providerTotals: [...providerMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, costUsd]) => ({ name, costUsd })),
    modelTotals: [...modelMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([model, costUsd]) => ({ model, costUsd })),
    dailyTotals,
    isLive: true,
  };
}

const emptyShowcaseData: ShowcaseData = {
  generatedAt: null,
  periodLabel: "Current month",
  currentMonthUsd: 0,
  totalTokens: 0,
  budgetUsagePct: 0,
  providerTotals: [],
  modelTotals: [],
  dailyTotals: [],
  isLive: false,
};

export async function getShowcaseData(): Promise<ShowcaseData> {
  const supabase = createPublicServerClient();
  const { data, error } = await supabase
    .from("showcase_snapshots")
    .select("generated_at, period_label, current_month_cents, total_tokens, budget_usage_pct, provider_totals, model_totals, daily_totals")
    .eq("id", true)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.error("Unable to load public showcase snapshot", error.message);
    }
    return emptyShowcaseData;
  }

  return normalizeSnapshot(data as SnapshotRow);
}
