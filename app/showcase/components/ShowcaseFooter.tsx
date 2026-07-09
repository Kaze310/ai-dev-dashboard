import Link from "next/link";

export type ShowcaseFooterProps = {
  productName: string;
  sourceHref?: string;
  sourceLabel?: string;
  demoHref?: string;
  demoLabel?: string;
  contactHref?: string;
  contactLabel?: string;
  note?: string;
  metadata?: ReadonlyArray<string>;
};

function isExternalHref(href: string) {
  return /^(https?:|mailto:)/i.test(href);
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  const className = "text-sm text-zinc-600 underline decoration-[color:var(--line)] underline-offset-4 hover:text-[color:var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]";

  if (isExternalHref(href)) {
    return (
      <a href={href} className={className} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>
        {children}
      </a>
    );
  }

  return <Link href={href} className={className}>{children}</Link>;
}

export function ShowcaseFooter({
  productName,
  sourceHref,
  sourceLabel = "View source",
  demoHref,
  demoLabel = "Open the app",
  contactHref,
  contactLabel = "Contact",
  note = "Public showcase with aggregated, non-sensitive data.",
  metadata = ["Next.js", "Supabase", "Recharts"],
}: ShowcaseFooterProps) {
  return (
    <footer className="mt-12 border-t border-[color:var(--line)] pb-8 pt-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xl">
          <p className="text-sm font-semibold text-zinc-900">{productName}</p>
          <p className="mt-2 text-sm leading-6 text-zinc-600">{note}</p>
          {metadata.length > 0 ? <p className="mt-3 text-xs uppercase tracking-[0.16em] text-zinc-500">{metadata.join(" / ")}</p> : null}
        </div>

        {sourceHref || demoHref || contactHref ? (
          <nav aria-label="Showcase footer links" className="flex flex-wrap gap-x-5 gap-y-3 sm:justify-end">
            {demoHref ? <FooterLink href={demoHref}>{demoLabel}</FooterLink> : null}
            {sourceHref ? <FooterLink href={sourceHref}>{sourceLabel}</FooterLink> : null}
            {contactHref ? <FooterLink href={contactHref}>{contactLabel}</FooterLink> : null}
          </nav>
        ) : null}
      </div>
    </footer>
  );
}
