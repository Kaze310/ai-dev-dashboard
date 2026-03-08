"use client";

type BudgetBarProps = {
  title: string;
  currentCents: number;
  limitCents: number | null | undefined;
  thresholdPct: number;
};

function formatUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.min(100, value);
}

function normalizeThreshold(value: number) {
  if (!Number.isFinite(value)) {
    return 80;
  }

  return Math.min(100, Math.max(1, Math.round(value)));
}

export function BudgetBar({ title, currentCents, limitCents, thresholdPct }: BudgetBarProps) {
  if (!limitCents || limitCents <= 0) {
    return null;
  }

  const safeCurrent = Math.max(0, Math.round(currentCents));
  const safeLimit = Math.max(1, Math.round(limitCents));
  const safeThreshold = normalizeThreshold(thresholdPct);
  const ratio = (safeCurrent / safeLimit) * 100;
  const widthPct = clampPercent(ratio);

  const colorClass =
    ratio >= 100 ? "bg-red-500" : ratio >= safeThreshold ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="soft-panel rounded-[24px] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
        <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs text-zinc-500 shadow-sm">Threshold: {safeThreshold}%</span>
      </div>

      <div className="mt-3 h-3.5 w-full overflow-hidden rounded-full bg-[#ebe4d8]">
        <div className={`h-full rounded-full transition-all ${colorClass}`} style={{ width: `${widthPct}%` }} />
      </div>

      <p className="mt-3 text-sm text-zinc-700">
        {formatUsd(safeCurrent)} / {formatUsd(safeLimit)} ({Math.round(ratio)}%)
      </p>
    </div>
  );
}
