import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

type UsageRecordRow = {
  id: string;
  date: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number;
};

function formatDate(dateString: string) {
  // 统一按浏览器本地格式显示日期，阅读更直观。
  return new Date(dateString).toLocaleDateString();
}

function formatCost(cents: number) {
  // 数据库存的是“分”，这里转成美元字符串显示。
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // 首页必须登录才能访问。
    redirect("/login");
  }

  // 只读取当前用户的 usage 数据，RLS 会做第二层保护。
  const { data: usageRecords, error } = await supabase
    .from("usage_records")
    .select("id, date, model, input_tokens, output_tokens, cost_cents")
    .eq("user_id", user.id)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (usageRecords ?? []) as UsageRecordRow[];

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

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Recent Usage</h2>

        <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium">Input Tokens</th>
                <th className="px-4 py-3 font-medium">Output Tokens</th>
                <th className="px-4 py-3 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-zinc-500" colSpan={5}>
                    暂无 usage 数据。先到 Settings 保存 OpenAI key，再点 Sync Now。
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-t border-zinc-200">
                    <td className="px-4 py-3">{formatDate(row.date)}</td>
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
