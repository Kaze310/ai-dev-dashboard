import type { Metadata } from "next";

import { getShowcaseData, type ShowcaseData } from "@/lib/showcase-data";

import { FeatureHighlights } from "./components/FeatureHighlights";
import { MetricCards } from "./components/MetricCards";
import { ProductPreview } from "./components/ProductPreview";
import { ShowcaseCharts } from "./components/ShowcaseCharts";
import { ShowcaseFooter } from "./components/ShowcaseFooter";
import { ShowcaseHeader } from "./components/ShowcaseHeader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI Dev Dashboard | Public Showcase",
  description: "A public product walkthrough of unified AI API spend, usage, and budget visibility.",
};

function formatUsd(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function snapshotDate(data: ShowcaseData) {
  if (!data.generatedAt) {
    return "Snapshot not published yet";
  }

  const date = new Date(data.generatedAt);
  if (Number.isNaN(date.valueOf())) {
    return "Latest published snapshot";
  }

  return `Updated ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function buildMetrics(data: ShowcaseData) {
  return [
    {
      id: "monthly-spend",
      label: "Synced spend",
      value: formatUsd(data.totalSpendUsd),
      detail: data.periodLabel,
      tone: "accent" as const,
    },
    {
      id: "token-volume",
      label: "Token volume",
      value: formatTokens(data.totalTokens),
      detail: "Input + output tokens",
      tone: "positive" as const,
    },
    {
      id: "providers",
      label: "Providers tracked",
      value: String(data.providerTotals.length),
      detail: data.providerTotals.map((provider) => provider.name).join(" + ") || "Waiting for snapshot",
      tone: "neutral" as const,
    },
    {
      id: "model-families",
      label: "Model families",
      value: String(data.modelTotals.length),
      detail: "Normalized for comparison",
      tone: "positive" as const,
    },
  ];
}

const features = [
  {
    id: "aggregation",
    eyebrow: "Data pipeline",
    title: "Multi-provider aggregation",
    description: "OpenAI and Anthropic usage are normalized into one readable cost and token view.",
    detail: "Shared provider normalization keeps comparisons consistent.",
  },
  {
    id: "security",
    eyebrow: "Data boundary",
    title: "RLS-backed user isolation",
    description: "Supabase Row Level Security keeps private records scoped to the signed-in account.",
    detail: "The public page reads only a curated aggregate snapshot.",
  },
  {
    id: "credentials",
    eyebrow: "Credential handling",
    title: "Encrypted provider keys",
    description: "Provider credentials are encrypted server-side and never returned to browser components.",
    detail: "Sync routes decrypt keys only when a provider request runs.",
  },
  {
    id: "reliability",
    eyebrow: "Sync reliability",
    title: "Idempotent usage sync",
    description: "Repeated syncs upsert normalized records and preserve cost totals without duplicate rows.",
    detail: "Model canonicalization keeps chart labels stable across provider reports.",
  },
];

export default async function ShowcasePage() {
  const data = await getShowcaseData();

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-12">
      <ShowcaseHeader
        productName="AI Dev Dashboard"
        tagline="One calm place to see AI spend, usage, and budget drift."
        description="A personal operations dashboard that turns provider-level API reports into a unified view for day-to-day cost decisions."
        demoHref="/login"
        demoLabel="Try the app"
        sourceHref="https://github.com/Kaze310/ai-dev-dashboard"
        sourceLabel="View source"
      />

      <ProductPreview
        title="The product at a glance"
        description="The dashboard keeps cost summary, provider mix, budget guardrails, and model-level trends in one workspace."
        imageSrc="/screenshots/dashboard.png"
        imageAlt="AI Dev Dashboard showing cost summary, budget status, and usage charts"
        caption={data.isLive ? `${snapshotDate(data)} · Public view uses aggregated data only.` : "Apply the showcase migration and publish a snapshot from Settings to show your current data here."}
        status={{
          label: "Data status",
          value: data.isLive ? "Live aggregate" : "Preview pending",
          tone: data.isLive ? "positive" : "warning",
          href: "#showcase-metrics",
        }}
        previewHref="/login"
        previewLabel="Open full dashboard"
      />

      <MetricCards
        metrics={buildMetrics(data)}
        description="Numbers are sourced from the latest public aggregate snapshot, never from raw usage rows."
      />

      <ShowcaseCharts
        dailyCostTrend={data.dailyTotals}
        costByModel={data.modelTotals}
        dailyTokenUsage={data.dailyTotals}
      />

      <FeatureHighlights
        features={features}
        description="The project is small enough to understand end to end, with the important production concerns kept visible in the implementation."
      />

      <ShowcaseFooter
        productName="AI Dev Dashboard"
        note="Public showcase with aggregated, non-sensitive data. Private records, provider credentials, and account details remain behind authentication."
        demoHref="/login"
        demoLabel="Open the app"
        sourceHref="https://github.com/Kaze310/ai-dev-dashboard"
        sourceLabel="View source"
        metadata={["Next.js", "TypeScript", "Supabase", "Recharts", "Vercel"]}
      />
    </main>
  );
}
