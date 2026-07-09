export type ShowcaseMetric = {
  id?: string;
  label: string;
  value: string;
  detail?: string;
  trend?: string;
  tone?: "accent" | "positive" | "warning" | "neutral";
};

export type MetricCardsProps = {
  metrics: ReadonlyArray<ShowcaseMetric>;
  title?: string;
  description?: string;
};

function metricToneClass(tone: ShowcaseMetric["tone"]) {
  if (tone === "positive") {
    return "border-emerald-200/80 bg-emerald-50/55";
  }

  if (tone === "warning") {
    return "border-amber-200/80 bg-amber-50/60";
  }

  if (tone === "neutral") {
    return "border-zinc-200/80 bg-white/65";
  }

  return "border-[#bedbd5] bg-[#eef7f4]/75";
}

export function MetricCards({ metrics, title = "At a glance", description }: MetricCardsProps) {
  return (
    <section id="showcase-metrics" aria-labelledby="showcase-metrics-title" className="mt-6 scroll-mt-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <p className="section-eyebrow">Snapshot</p>
          <h2 id="showcase-metrics-title" className="mt-2 text-xl font-semibold text-zinc-950">{title}</h2>
        </div>
        {description ? <p className="max-w-xl text-sm leading-6 text-zinc-600">{description}</p> : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric, index) => (
          <article key={metric.id ?? `${metric.label}-${index}`} className={`min-w-0 rounded-[22px] border p-4 shadow-[0_10px_26px_rgba(79,79,57,0.05)] ${metricToneClass(metric.tone)}`}>
            <p className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{metric.label}</p>
            <p className="mt-3 break-words text-3xl font-semibold tracking-tight text-zinc-950">{metric.value}</p>
            {metric.detail ? <p className="mt-2 text-sm leading-5 text-zinc-600">{metric.detail}</p> : null}
            {metric.trend ? <p className="mt-3 text-xs font-medium text-[color:var(--accent)]">{metric.trend}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
