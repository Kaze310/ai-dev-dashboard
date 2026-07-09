import type { ReactNode } from "react";

export type FeatureHighlight = {
  id?: string;
  eyebrow?: string;
  title: string;
  description: string;
  detail?: string;
  icon?: ReactNode;
};

export type FeatureHighlightsProps = {
  features: ReadonlyArray<FeatureHighlight>;
  title?: string;
  description?: string;
};

export function FeatureHighlights({ features, title = "Built for trustworthy visibility", description }: FeatureHighlightsProps) {
  return (
    <section aria-labelledby="showcase-features-title" className="mt-10">
      <div className="max-w-2xl">
        <p className="section-eyebrow">What this demonstrates</p>
        <h2 id="showcase-features-title" className="mt-2 text-2xl font-semibold text-zinc-950">{title}</h2>
        {description ? <p className="mt-3 text-sm leading-6 text-zinc-600">{description}</p> : null}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {features.map((feature, index) => (
          <article key={feature.id ?? `${feature.title}-${index}`} className="soft-panel min-w-0 rounded-[24px] p-5">
            <div className="flex items-start gap-4">
              <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#d7ebe6] text-sm font-semibold text-[#1f6f78]">
                {feature.icon ?? String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                {feature.eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{feature.eyebrow}</p> : null}
                <h3 className="mt-1 text-base font-semibold text-zinc-900">{feature.title}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-600">{feature.description}</p>
                {feature.detail ? <p className="mt-3 border-t border-[color:var(--line)] pt-3 text-xs font-medium leading-5 text-[color:var(--accent)]">{feature.detail}</p> : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
