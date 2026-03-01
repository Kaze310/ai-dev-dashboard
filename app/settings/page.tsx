import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

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
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Settings</h1>
        <Link className="text-sm underline" href="/">
          Back to Dashboard
        </Link>
      </div>

      <p className="mt-3 text-sm text-zinc-600">在这里管理 OpenAI / Anthropic API Key 并手动触发 usage 同步。</p>

      <OpenAISettingsForm hasOpenAIKey={names.has("openai")} hasAnthropicKey={names.has("anthropic")} />
    </main>
  );
}
