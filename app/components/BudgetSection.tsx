"use client";

import { useEffect, useMemo, useState } from "react";

import { BudgetBar } from "./BudgetBar";

type GlobalBudget = {
  id: string;
  monthly_limit_cents: number;
  alert_threshold_pct: number;
  current_month_cents: number;
};

type ProviderBudget = {
  id: string;
  name: string;
  monthly_limit_cents: number | null;
  alert_threshold_pct: number;
  current_month_cents: number;
};

type BudgetResponse = {
  month: {
    start: string;
    endExclusive: string;
    timeZone: string;
  };
  global: GlobalBudget | null;
  providers: ProviderBudget[];
  error?: string;
};

type AlertItem = {
  name: string;
  percent: number;
  isOver: boolean;
};

function normalizeThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return 80;
  }

  return Math.min(100, Math.max(1, Math.round(value)));
}

function getPercent(current: number, limit: number | null | undefined): number {
  if (!limit || limit <= 0) {
    return 0;
  }

  return (Math.max(0, current) / limit) * 100;
}

function providerLabel(name: string) {
  if (name.toLowerCase() === "openai") {
    return "OpenAI";
  }
  if (name.toLowerCase() === "anthropic") {
    return "Anthropic";
  }
  return name;
}

export function BudgetSection() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [budget, setBudget] = useState<BudgetResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch("/api/budget", {
          method: "GET",
          signal: controller.signal,
          cache: "no-store",
        });

        const result = (await response.json()) as BudgetResponse;
        if (!response.ok) {
          setError(result.error ?? "Failed to load budget data");
          setBudget(null);
          return;
        }

        setBudget(result);
      } catch (fetchError) {
        if ((fetchError as { name?: string }).name === "AbortError") {
          return;
        }

        setError(fetchError instanceof Error ? fetchError.message : "Failed to load budget data");
        setBudget(null);
      } finally {
        setLoading(false);
      }
    }

    void load();

    return () => controller.abort();
  }, []);

  const providerRows = useMemo(() => {
    return (budget?.providers ?? []).filter((provider) => provider.monthly_limit_cents && provider.monthly_limit_cents > 0);
  }, [budget?.providers]);

  const alerts = useMemo<AlertItem[]>(() => {
    const items: AlertItem[] = [];

    if (budget?.global?.monthly_limit_cents && budget.global.monthly_limit_cents > 0) {
      const percent = getPercent(budget.global.current_month_cents, budget.global.monthly_limit_cents);
      const threshold = normalizeThreshold(budget.global.alert_threshold_pct);
      if (percent >= threshold) {
        items.push({
          name: "Global",
          percent,
          isOver: percent >= 100,
        });
      }
    }

    for (const provider of providerRows) {
      const percent = getPercent(provider.current_month_cents, provider.monthly_limit_cents);
      const threshold = normalizeThreshold(provider.alert_threshold_pct);
      if (percent >= threshold) {
        items.push({
          name: providerLabel(provider.name),
          percent,
          isOver: percent >= 100,
        });
      }
    }

    return items;
  }, [budget?.global, providerRows]);

  const hasAnyBar = Boolean(
    (budget?.global?.monthly_limit_cents && budget.global.monthly_limit_cents > 0) || providerRows.length > 0,
  );

  const hasOverLimit = alerts.some((item) => item.isOver);
  const bannerClass = hasOverLimit
    ? "border-red-300 bg-red-50 text-red-800"
    : "border-amber-300 bg-amber-50 text-amber-800";

  return (
    <section className="mt-4 rounded-lg border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Budget Status</h2>
      <p className="mt-1 text-sm text-zinc-600">Current month spend vs budget limit.</p>

      {loading ? <p className="mt-3 text-sm text-zinc-500">Loading budget...</p> : null}
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {!loading && !error && alerts.length > 0 ? (
        <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${bannerClass}`}>
          Alert: {alerts.map((item) => `${item.name} ${Math.round(item.percent)}%`).join(" · ")}
        </div>
      ) : null}

      {!loading && !error && hasAnyBar ? (
        <div className="mt-4 space-y-3">
          <BudgetBar
            title="Global Budget"
            currentCents={budget?.global?.current_month_cents ?? 0}
            limitCents={budget?.global?.monthly_limit_cents ?? null}
            thresholdPct={budget?.global?.alert_threshold_pct ?? 80}
          />

          {providerRows.map((provider) => (
            <BudgetBar
              key={provider.id}
              title={`${providerLabel(provider.name)} Budget`}
              currentCents={provider.current_month_cents}
              limitCents={provider.monthly_limit_cents}
              thresholdPct={provider.alert_threshold_pct}
            />
          ))}
        </div>
      ) : null}

      {!loading && !error && !hasAnyBar ? (
        <p className="mt-3 text-sm text-zinc-500">No budget set. Configure it from Settings.</p>
      ) : null}
    </section>
  );
}
