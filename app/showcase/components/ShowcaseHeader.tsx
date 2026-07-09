import Link from "next/link";

export type ShowcaseHeaderProps = {
  eyebrow?: string;
  productName: string;
  tagline: string;
  description?: string;
  demoHref?: string;
  demoLabel?: string;
  sourceHref?: string;
  sourceLabel?: string;
};

function isExternalHref(href: string) {
  return /^(https?:|mailto:)/i.test(href);
}

function ActionLink({ href, children, primary = false }: { href: string; children: React.ReactNode; primary?: boolean }) {
  const className = primary
    ? "inline-flex min-h-11 items-center justify-center rounded-full bg-[color:var(--foreground)] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:-translate-y-0.5 hover:bg-[#294043] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f1e8]"
    : "inline-flex min-h-11 items-center justify-center rounded-full border border-[color:var(--line)] bg-white/75 px-5 py-2.5 text-sm font-medium text-zinc-800 shadow-sm hover:-translate-y-0.5 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f1e8]";

  if (isExternalHref(href)) {
    return (
      <a href={href} className={className} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export function ShowcaseHeader({
  eyebrow = "Public product walkthrough",
  productName,
  tagline,
  description,
  demoHref,
  demoLabel = "Try the demo",
  sourceHref,
  sourceLabel = "View source",
}: ShowcaseHeaderProps) {
  return (
    <header className="glass-panel rounded-[30px] px-6 py-7 sm:px-8 sm:py-9">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="section-eyebrow">{eyebrow}</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight text-zinc-950 sm:text-5xl">{productName}</h1>
          <p className="mt-4 max-w-2xl text-xl font-medium leading-8 text-zinc-800 sm:text-2xl">{tagline}</p>
          {description ? <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-600">{description}</p> : null}
        </div>

        {demoHref || sourceHref ? (
          <nav aria-label="Showcase actions" className="flex flex-col gap-3 sm:flex-row lg:shrink-0">
            {demoHref ? <ActionLink href={demoHref} primary>{demoLabel}</ActionLink> : null}
            {sourceHref ? <ActionLink href={sourceHref}>{sourceLabel}</ActionLink> : null}
          </nav>
        ) : null}
      </div>
    </header>
  );
}
