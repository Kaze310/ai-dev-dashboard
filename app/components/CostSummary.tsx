"use client";

import { useEffect, useMemo, useState } from "react";

type Mode = "today" | "month" | "ytd";

type CostSummaryResponse = {
  mode: Mode;
  timeZone: string;
  label: string;
  start: string;
  endExclusive: string;
  totalCents: number;
  totalUsd: number;
  error?: string;
};

type MonthOption = {
  label: string;
  year: number;
  month: number;
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function getNowInUtc() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");

  return { year, month };
}

function buildMonthOptions(count = 12): MonthOption[] {
  const { year, month } = getNowInUtc();
  const options: MonthOption[] = [];

  let cursorYear = year;
  let cursorMonth = month;

  for (let i = 0; i < count; i += 1) {
    const date = new Date(Date.UTC(cursorYear, cursorMonth - 1, 1));
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    }).format(date);

    options.push({ label, year: cursorYear, month: cursorMonth });

    cursorMonth -= 1;
    if (cursorMonth === 0) {
      cursorMonth = 12;
      cursorYear -= 1;
    }
  }

  return options;
}

export function CostSummary() {
  const monthOptions = useMemo(() => buildMonthOptions(12), []);
  const [mode, setMode] = useState<Mode>("month");
  const [selectedMonth, setSelectedMonth] = useState<MonthOption>(monthOptions[0]);
  const [summary, setSummary] = useState<CostSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function fetchSummary() {
      setLoading(true);
      setError("");

      const params = new URLSearchParams({ mode });
      if (mode === "month") {
        params.set("year", String(selectedMonth.year));
        params.set("month", String(selectedMonth.month));
      }

      try {
        const response = await fetch(`/api/cost-summary?${params.toString()}`, {
          method: "GET",
          signal: controller.signal,
          cache: "no-store",
        });

        const result = (await response.json()) as CostSummaryResponse;

        if (!response.ok) {
          setError(result.error ?? "Failed to load summary");
          setSummary(null);
          return;
        }

        setSummary(result);
      } catch (fetchError) {
        if ((fetchError as { name?: string }).name === "AbortError") {
          return;
        }

        setError(fetchError instanceof Error ? fetchError.message : "Failed to load summary");
        setSummary(null);
      } finally {
        setLoading(false);
      }
    }

    void fetchSummary();

    return () => controller.abort();
  }, [mode, selectedMonth]);

  const totalText = summary ? formatUsd(summary.totalCents) : loading ? "Loading..." : "$0.00";
  const rangeLabel = summary?.label ?? "-";

  return (
    <section className="glass-panel mt-8 overflow-hidden rounded-[28px] p-6 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="section-eyebrow">Snapshot</p>
          <h2 className="mt-2 text-xl font-semibold text-zinc-900">Cost Summary</h2>
        </div>

        <div className="inline-flex rounded-full border border-[color:var(--line)] bg-white/75 p-1 text-sm shadow-sm">
          <button
            type="button"
            onClick={() => setMode("today")}
            className={`rounded-full px-3 py-1.5 ${mode === "today" ? "bg-[color:var(--foreground)] text-white shadow-sm" : "text-zinc-700"}`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setMode("month")}
            className={`rounded-full px-3 py-1.5 ${mode === "month" ? "bg-[color:var(--foreground)] text-white shadow-sm" : "text-zinc-700"}`}
          >
            This Month
          </button>
          <button
            type="button"
            onClick={() => setMode("ytd")}
            className={`rounded-full px-3 py-1.5 ${mode === "ytd" ? "bg-[color:var(--foreground)] text-white shadow-sm" : "text-zinc-700"}`}
          >
            YTD
          </button>
        </div>
      </div>

      {mode === "month" ? (
        <div className="mt-5">
          <label htmlFor="month-picker" className="mb-1.5 block text-xs font-medium uppercase tracking-[0.22em] text-zinc-500">
            Select Month
          </label>
          <select
            id="month-picker"
            value={`${selectedMonth.year}-${selectedMonth.month}`}
            onChange={(event) => {
              const [yearStr, monthStr] = event.target.value.split("-");
              const option = monthOptions.find(
                (item) => item.year === Number(yearStr) && item.month === Number(monthStr),
              );
              if (option) {
                setSelectedMonth(option);
              }
            }}
            className="rounded-2xl border border-[color:var(--line)] bg-white/80 px-4 py-2 text-sm text-zinc-800 shadow-sm outline-none focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent-soft)]"
          >
            {monthOptions.map((option) => (
              <option key={`${option.year}-${option.month}`} value={`${option.year}-${option.month}`}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <p className="text-5xl font-semibold tracking-tight text-zinc-950 sm:text-6xl">{totalText}</p>
          <p className="mt-2 text-base text-zinc-600">{rangeLabel}</p>
        </div>

        <div className="soft-panel rounded-[24px] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--accent)]">Billing note</p>
          <p className="mt-2 text-sm leading-6 text-zinc-700">
            Summary follows provider-reported bucket dates so the dashboard stays consistent with synced usage records.
          </p>
        </div>
      </div>

      <p className="mt-4 text-xs text-zinc-500">
        Based on provider UTC bucket date (Timezone: {summary?.timeZone ?? "UTC"})
      </p>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </section>
  );
}
