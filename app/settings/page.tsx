import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { BudgetSettingsForm } from "./BudgetSettingsForm";
import { OpenAISettingsForm } from "./OpenAISettingsForm";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // 未登录用户不能进入设置页。
    redirect("/login");
  }

  // 这里只返回是否存在 key，不把 key 返回给客户端，避免泄露。
  const { data: providers } = await supabase
    .from("providers")
    .select("name")
    .eq("user_id", user.id)
    .in("name", ["openai", "anthropic"]);

  const names = new Set((providers ?? []).map((item) => item.name));

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-5 py-10 sm:px-6 sm:py-14">
      <section className="glass-panel rounded-[34px] px-6 py-7 sm:px-8 sm:py-9">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="section-eyebrow">Control Room</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-950">Settings</h1>
            <p className="mt-4 text-base leading-7 text-zinc-700">
              Manage provider access, sync usage manually, and set budget guardrails without exposing API keys to the client.
            </p>
          </div>

          <Link
            className="inline-flex items-center rounded-full border border-[color:var(--line)] bg-white/75 px-5 py-2.5 text-sm font-medium text-zinc-800 shadow-sm hover:-translate-y-0.5"
            href="/"
          >
            Back to Dashboard
          </Link>
        </div>

        <div className="mt-6 rounded-[24px] border border-amber-200 bg-amber-50/85 px-5 py-4 text-sm text-amber-900 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">Warning</p>
          <p className="mt-2 leading-6">
            Usage and cost sync endpoints require admin-level keys. A regular project key may save successfully here but still fail to fetch organization reports later.
          </p>
        </div>
      </section>

      <OpenAISettingsForm hasOpenAIKey={names.has("openai")} hasAnthropicKey={names.has("anthropic")} />
      <BudgetSettingsForm />
    </main>
  );
}
