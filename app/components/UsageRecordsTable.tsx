import { formatCost, formatDate, getProviderName, toNumber, type UsageRecordRow } from "@/lib/usage-records";

type UsageRecordsTableProps = {
  rows: UsageRecordRow[];
};

function providerTone(provider: string) {
  if (provider === "openai") {
    return "bg-[#e0edf7] text-[#1f5e82]";
  }

  if (provider === "anthropic") {
    return "bg-[#e2efe9] text-[#295b4c]";
  }

  return "bg-white/75 text-zinc-700";
}

export function UsageRecordsTable({ rows }: UsageRecordsTableProps) {
  const totalCost = rows.reduce((sum, row) => sum + toNumber(row.cost_cents), 0);
  const totalInput = rows.reduce((sum, row) => sum + toNumber(row.input_tokens), 0);
  const totalOutput = rows.reduce((sum, row) => sum + toNumber(row.output_tokens), 0);

  return (
    <section className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="soft-panel rounded-[24px] p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Rows</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-900">{rows.length.toLocaleString()}</p>
        </div>
        <div className="soft-panel rounded-[24px] p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Visible Cost</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-900">{formatCost(totalCost)}</p>
        </div>
        <div className="soft-panel rounded-[24px] p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Visible Tokens</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-900">
            {(totalInput + totalOutput).toLocaleString()}
          </p>
        </div>
      </div>

      <div className="glass-panel overflow-hidden rounded-[28px]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--line)] px-5 py-4">
          <div>
            <p className="text-sm font-medium text-zinc-900">Usage Records</p>
            <p className="mt-1 text-sm text-zinc-600">Raw synced records. Dates follow provider-reported UTC bucket dates.</p>
          </div>

          <div className="rounded-full bg-white/75 px-4 py-2 text-xs uppercase tracking-[0.2em] text-zinc-500 shadow-sm">
            newest first
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/50 text-zinc-600">
              <tr>
                <th className="px-5 py-3 font-medium">Date (UTC bucket)</th>
                <th className="px-5 py-3 font-medium">Provider</th>
                <th className="px-5 py-3 font-medium">Model</th>
                <th className="px-5 py-3 font-medium">Input Tokens</th>
                <th className="px-5 py-3 font-medium">Output Tokens</th>
                <th className="px-5 py-3 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-5 py-10 text-zinc-500" colSpan={6}>
                    No usage records yet. Save a provider key in Settings and run a sync first.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const provider = getProviderName(row.provider);

                  return (
                    <tr key={row.id} className="border-t border-[color:var(--line)]/80">
                      <td className="px-5 py-4 text-zinc-700">{formatDate(row.date)}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium shadow-sm ${providerTone(provider)}`}>
                          {provider}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-zinc-900">{row.model}</td>
                      <td className="px-5 py-4 text-zinc-700">{toNumber(row.input_tokens).toLocaleString()}</td>
                      <td className="px-5 py-4 text-zinc-700">{toNumber(row.output_tokens).toLocaleString()}</td>
                      <td className="px-5 py-4 font-medium text-zinc-900">{formatCost(toNumber(row.cost_cents))}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
