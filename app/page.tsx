import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { SyncButtons } from "./SyncButtons";

type ProviderRef = {
  name: string;
};

type UsageRecordRow = {
  id: string;
  date: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number;
  provider: ProviderRef | ProviderRef[] | null;
};

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString();
}

function formatCost(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function getProviderName(provider: UsageRecordRow["provider"]) {
  if (!provider) {
    return "unknown";
  }

  if (Array.isArray(provider)) {
    return provider[0]?.name ?? "unknown";
  }

  return provider.name;
}

function getCurrentMonthRange() {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    start: monthStart.toISOString().slice(0, 10),
    endExclusive: nextMonthStart.toISOString().slice(0, 10),
  };
}

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { start, endExclusive } = getCurrentMonthRange();

  const [{ data: usageRecords, error }, { data: monthlyRows, error: monthlyError }] = await Promise.all([
    supabase
      .from("usage_records")
      .select("id, date, model, input_tokens, output_tokens, cost_cents, provider:providers(name)")
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("usage_records")
      .select("cost_cents")
      .eq("user_id", user.id)
      .gte("date", start)
      .lt("date", endExclusive),
  ]);

  if (error) {
    throw new Error(error.message);
  }

  if (monthlyError) {
    throw new Error(monthlyError.message);
  }

  const rows = (usageRecords ?? []) as UsageRecordRow[];
  const monthlyTotalCents = (monthlyRows ?? []).reduce((sum, item) => sum + (item.cost_cents ?? 0), 0);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-16">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold">AI Dev Dashboard</h1>
          <p className="mt-3 text-lg text-zinc-700">Signed in as: {user.email}</p>
        </div>

        <Link href="/settings" className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium">
          Settings
        </Link>
      </div>

      <section className="mt-8 rounded-lg border border-zinc-200 p-5">
        <h2 className="text-lg font-semibold">Current Month Total</h2>
        <p className="mt-2 text-2xl font-semibold">{formatCost(monthlyTotalCents)}</p>
        <p className="mt-1 text-sm text-zinc-600">汇总当前自然月（UTC）所有 provider 的花费。</p>
        <SyncButtons />
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Recent Usage</h2>

        <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium">Input Tokens</th>
                <th className="px-4 py-3 font-medium">Output Tokens</th>
                <th className="px-4 py-3 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-zinc-500" colSpan={6}>
                    暂无 usage 数据。先到 Settings 保存 OpenAI / Anthropic key，再执行同步。
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-t border-zinc-200">
                    <td className="px-4 py-3">{formatDate(row.date)}</td>
                    <td className="px-4 py-3">{getProviderName(row.provider)}</td>
                    <td className="px-4 py-3">{row.model}</td>
                    <td className="px-4 py-3">{row.input_tokens.toLocaleString()}</td>
                    <td className="px-4 py-3">{row.output_tokens.toLocaleString()}</td>
                    <td className="px-4 py-3">{formatCost(row.cost_cents)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
