/* eslint-disable @next/next/no-img-element */

import Link from "next/link";

export type ProductPreviewStatus = {
  label?: string;
  value: string;
  tone?: "positive" | "neutral" | "warning";
};

export type ProductPreviewProps = {
  title: string;
  description?: string;
  imageSrc?: string;
  imageAlt: string;
  caption?: string;
  status?: ProductPreviewStatus;
  previewHref?: string;
  previewLabel?: string;
};

function isExternalHref(href: string) {
  return /^(https?:|mailto:)/i.test(href);
}

function statusClass(tone: ProductPreviewStatus["tone"]) {
  if (tone === "warning") {
    return "bg-amber-100 text-amber-800";
  }

  if (tone === "positive") {
    return "bg-emerald-100 text-emerald-800";
  }

  return "bg-[#d7ebe6] text-[#1f6f78]";
}

export function ProductPreview({
  title,
  description,
  imageSrc,
  imageAlt,
  caption,
  status,
  previewHref,
  previewLabel = "Open product view",
}: ProductPreviewProps) {
  return (
    <section aria-labelledby="product-preview-title" className="glass-panel overflow-hidden rounded-[30px] p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="section-eyebrow">Product preview</p>
          <h2 id="product-preview-title" className="mt-2 text-2xl font-semibold text-zinc-950">{title}</h2>
          {description ? <p className="mt-2 text-sm leading-6 text-zinc-600">{description}</p> : null}
        </div>

        {status ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm" role="status">
            <span className={`inline-flex min-h-10 items-center justify-center rounded-full px-3.5 py-2 font-medium ${statusClass(status.tone)}`}>
              {status.value}
            </span>
            {status.label ? <span className="text-zinc-500">{status.label}</span> : null}
          </div>
        ) : null}
      </div>

      <div className="mt-5 overflow-hidden rounded-[24px] border border-[color:var(--line)] bg-[#fbf8f1] shadow-[0_18px_40px_rgba(66,52,29,0.08)]">
        <div className="flex h-10 items-center gap-2 border-b border-[color:var(--line)] bg-white/65 px-4" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-[#d99882]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#e3c378]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#91b69b]" />
          <span className="ml-2 hidden truncate text-xs text-zinc-400 sm:block">ai-dev-dashboard / overview</span>
        </div>

        {imageSrc ? (
          <img src={imageSrc} alt={imageAlt} className="block h-auto max-h-[620px] w-full object-cover object-top" />
        ) : (
          <div role="img" aria-label={imageAlt} className="grid min-h-[280px] gap-4 p-4 sm:min-h-[390px] sm:grid-cols-[180px_1fr] sm:p-6">
            <div className="hidden rounded-2xl border border-[color:var(--line)] bg-white/80 p-4 sm:block">
              <div className="h-3 w-24 rounded-full bg-[#d7ebe6]" />
              <div className="mt-7 space-y-3">
                {["w-20", "w-28", "w-24", "w-16"].map((width) => (
                  <div key={width} className={`h-2.5 rounded-full bg-[#ebe4d8] ${width}`} />
                ))}
              </div>
            </div>
            <div className="min-w-0 rounded-2xl border border-[color:var(--line)] bg-white/80 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="h-3 w-28 rounded-full bg-[#d7ebe6]" />
                  <div className="mt-2 h-2.5 w-40 max-w-full rounded-full bg-[#ebe4d8]" />
                </div>
                <div className="h-8 w-20 rounded-full bg-[#f1e7cf]" />
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {["n/a", "n/a", "n/a"].map((value, index) => (
                  <div key={`${value}-${index}`} className="rounded-xl border border-[color:var(--line)] bg-[#fbf8f1] p-3">
                    <div className="h-2 w-16 rounded-full bg-[#ebe4d8]" />
                    <p className="mt-3 text-lg font-semibold text-zinc-900">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 h-28 rounded-xl border border-[color:var(--line)] bg-[#f8f4eb] p-4 sm:h-48">
                <div className="flex h-full items-end gap-2">
                  {[35, 50, 42, 68, 58, 78, 62, 88, 70, 82, 74, 95].map((height, index) => (
                    <div key={`${height}-${index}`} className="min-w-0 flex-1 rounded-t-md bg-[#8fb4b4]" style={{ height: `${height}%` }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
        {caption ? <p className="text-sm leading-6 text-zinc-600">{caption}</p> : <span />}
        {previewHref ? (
          isExternalHref(previewHref) ? (
            <a href={previewHref} target={previewHref.startsWith("http") ? "_blank" : undefined} rel={previewHref.startsWith("http") ? "noreferrer" : undefined} className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full border border-[color:var(--line)] bg-white/75 px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]">
              {previewLabel}
            </a>
          ) : (
            <Link href={previewHref} className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full border border-[color:var(--line)] bg-white/75 px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]">
              {previewLabel}
            </Link>
          )
        ) : null}
      </div>
    </section>
  );
}
