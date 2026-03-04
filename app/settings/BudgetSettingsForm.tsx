"use client";

import { useEffect, useState } from "react";

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

type BudgetGetResponse = {
  global: GlobalBudget | null;
  providers: ProviderBudget[];
  error?: string;
};

function centsToUsdInput(cents: number | null | undefined): string {
  if (!cents || cents <= 0) {
    return "";
  }

  return (cents / 100).toFixed(2);
}

function usdInputToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.round(parsed * 100);
}

function normalizeThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return 80;
  }

  return Math.min(100, Math.max(1, Math.round(value)));
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

export function BudgetSettingsForm() {
  const [loading, setLoading] = useState(true);
  const [globalLimitUsd, setGlobalLimitUsd] = useState("");
  const [globalThreshold, setGlobalThreshold] = useState(80);
  const [globalSaving, setGlobalSaving] = useState(false);
  const [globalMessage, setGlobalMessage] = useState("");

  const [providers, setProviders] = useState<ProviderBudget[]>([]);
  const [providerDrafts, setProviderDrafts] = useState<Record<string, { limitUsd: string; threshold: number }>>({});
  const [providerSaving, setProviderSaving] = useState<string | null>(null);
  const [providerMessages, setProviderMessages] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();

    async function loadBudgets() {
      setLoading(true);
      setGlobalMessage("");

      try {
        const response = await fetch("/api/budget", {
          method: "GET",
          signal: controller.signal,
          cache: "no-store",
        });

        const result = (await response.json()) as BudgetGetResponse;
        if (!response.ok) {
          setGlobalMessage(result.error ?? "Failed to load budgets");
          setProviders([]);
          return;
        }

        setGlobalLimitUsd(centsToUsdInput(result.global?.monthly_limit_cents));
        setGlobalThreshold(result.global?.alert_threshold_pct ?? 80);
        setProviders(result.providers ?? []);

        const initialDrafts: Record<string, { limitUsd: string; threshold: number }> = {};
        (result.providers ?? []).forEach((provider) => {
          initialDrafts[provider.id] = {
            limitUsd: centsToUsdInput(provider.monthly_limit_cents),
            threshold: provider.alert_threshold_pct ?? 80,
          };
        });
        setProviderDrafts(initialDrafts);
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") {
          return;
        }

        setGlobalMessage(error instanceof Error ? error.message : "Failed to load budgets");
      } finally {
        setLoading(false);
      }
    }

    void loadBudgets();

    return () => controller.abort();
  }, []);

  const saveGlobal = async () => {
    setGlobalSaving(true);
    setGlobalMessage("");

    const limitCents = usdInputToCents(globalLimitUsd);
    if (!limitCents) {
      setGlobalSaving(false);
      setGlobalMessage("Please enter a valid monthly budget in USD.");
      return;
    }

    try {
      const response = await fetch("/api/budget", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          monthly_limit_cents: limitCents,
          alert_threshold_pct: normalizeThreshold(globalThreshold),
        }),
      });

      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setGlobalMessage(result.error ?? "Failed to save global budget");
        return;
      }

      setGlobalMessage("Global budget saved.");
    } catch (error) {
      setGlobalMessage(error instanceof Error ? error.message : "Failed to save global budget");
    } finally {
      setGlobalSaving(false);
    }
  };

  const saveProvider = async (providerId: string) => {
    setProviderSaving(providerId);
    setProviderMessages((prev) => ({ ...prev, [providerId]: "" }));

    const draft = providerDrafts[providerId];
    const limitCents = usdInputToCents(draft?.limitUsd ?? "");

    try {
      const response = await fetch(`/api/budget/${providerId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          monthly_limit_cents: limitCents,
          alert_threshold_pct: normalizeThreshold(draft?.threshold ?? 80),
        }),
      });

      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setProviderMessages((prev) => ({ ...prev, [providerId]: result.error ?? "Failed to save provider budget" }));
        return;
      }

      setProviderMessages((prev) => ({ ...prev, [providerId]: "Provider budget saved." }));
    } catch (error) {
      setProviderMessages((prev) => ({
        ...prev,
        [providerId]: error instanceof Error ? error.message : "Failed to save provider budget",
      }));
    } finally {
      setProviderSaving(null);
    }
  };

  return (
    <section className="mt-8 space-y-6">
      <div className="rounded-lg border border-zinc-200 p-5">
        <h2 className="text-lg font-semibold">Budget</h2>
        <p className="mt-1 text-sm text-zinc-600">Set monthly budget and alert threshold for global and each provider.</p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="global-limit" className="mb-1 block text-sm font-medium">
              Global Monthly Limit (USD)
            </label>
            <input
              id="global-limit"
              type="number"
              min="0"
              step="0.01"
              value={globalLimitUsd}
              onChange={(event) => setGlobalLimitUsd(event.target.value)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
              placeholder="100.00"
            />
          </div>

          <div>
            <label htmlFor="global-threshold" className="mb-1 block text-sm font-medium">
              Alert Threshold (%)
            </label>
            <input
              id="global-threshold"
              type="number"
              min="1"
              max="100"
              step="1"
              value={globalThreshold}
              onChange={(event) => setGlobalThreshold(normalizeThreshold(Number(event.target.value)))}
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => void saveGlobal()}
          disabled={globalSaving || loading}
          className="mt-4 rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {globalSaving ? "Saving..." : "Save Global Budget"}
        </button>

        {globalMessage ? <p className="mt-2 text-sm text-zinc-600">{globalMessage}</p> : null}
      </div>

      {providers.map((provider) => {
        const draft = providerDrafts[provider.id] ?? { limitUsd: "", threshold: 80 };

        return (
          <div key={provider.id} className="rounded-lg border border-zinc-200 p-5">
            <h3 className="text-base font-semibold">{providerLabel(provider.name)} Budget</h3>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={`provider-limit-${provider.id}`} className="mb-1 block text-sm font-medium">
                  Monthly Limit (USD)
                </label>
                <input
                  id={`provider-limit-${provider.id}`}
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.limitUsd}
                  onChange={(event) =>
                    setProviderDrafts((prev) => ({
                      ...prev,
                      [provider.id]: { ...draft, limitUsd: event.target.value },
                    }))
                  }
                  className="w-full rounded-md border border-zinc-300 px-3 py-2"
                  placeholder="Leave blank to unset"
                />
              </div>

              <div>
                <label htmlFor={`provider-threshold-${provider.id}`} className="mb-1 block text-sm font-medium">
                  Alert Threshold (%)
                </label>
                <input
                  id={`provider-threshold-${provider.id}`}
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={draft.threshold}
                  onChange={(event) =>
                    setProviderDrafts((prev) => ({
                      ...prev,
                      [provider.id]: { ...draft, threshold: normalizeThreshold(Number(event.target.value)) },
                    }))
                  }
                  className="w-full rounded-md border border-zinc-300 px-3 py-2"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => void saveProvider(provider.id)}
              disabled={providerSaving === provider.id || loading}
              className="mt-4 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {providerSaving === provider.id ? "Saving..." : `Save ${providerLabel(provider.name)} Budget`}
            </button>

            {providerMessages[provider.id] ? <p className="mt-2 text-sm text-zinc-600">{providerMessages[provider.id]}</p> : null}
          </div>
        );
      })}
    </section>
  );
}
