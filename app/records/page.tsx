import Link from "next/link";
import { redirect } from "next/navigation";

import { UsageRecordsTable } from "@/app/components/UsageRecordsTable";
import { createClient } from "@/lib/supabase/server";
import type { UsageRecordRow } from "@/lib/usage-records";

export default async function RecordsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("usage_records")
    .select("id, date, model, input_tokens, output_tokens, cost_cents, provider:providers(name)")
    .eq("user_id", user.id)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(250);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as UsageRecordRow[];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-10 sm:px-6 sm:py-14">
      <section className="glass-panel rounded-[34px] px-6 py-7 sm:px-8 sm:py-9">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="section-eyebrow">Records</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-950 sm:text-5xl">Usage Records</h1>
            <p className="mt-4 text-base leading-7 text-zinc-700">
              A dedicated view for raw synced rows. Useful when you want to inspect exact model, token, and cost values without cluttering the main dashboard.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/"
              className="inline-flex items-center rounded-full border border-[color:var(--line)] bg-white/75 px-5 py-2.5 text-sm font-medium text-zinc-800 shadow-sm hover:-translate-y-0.5"
            >
              Back to Dashboard
            </Link>
            <Link
              href="/settings"
              className="inline-flex items-center rounded-full bg-[color:var(--foreground)] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:-translate-y-0.5"
            >
              Open Settings
            </Link>
          </div>
        </div>
      </section>

      <div className="mt-8">
        <UsageRecordsTable rows={rows} />
      </div>
    </main>
  );
}
