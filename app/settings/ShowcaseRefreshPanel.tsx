"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ShowcaseRefreshPanel() {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState("");

  async function refreshShowcase() {
    setIsRefreshing(true);
    setMessage("");

    try {
      const response = await fetch("/api/showcase/refresh", { method: "POST" });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        setMessage(result.error ?? "Unable to refresh showcase");
        return;
      }

      setMessage("Public showcase updated.");
      router.refresh();
    } catch {
      setMessage("Unable to refresh showcase");
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <section className="glass-panel mt-5 rounded-[28px] p-6 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="section-eyebrow">Public Snapshot</p>
          <h2 className="mt-2 text-xl font-semibold text-zinc-900">Keep the showcase current</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            Publish aggregated cost, token, provider, and trend data to the public showcase. Raw records and provider credentials stay private.
          </p>
        </div>

        <button
          type="button"
          onClick={refreshShowcase}
          disabled={isRefreshing}
          className="inline-flex items-center justify-center rounded-full bg-[color:var(--foreground)] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRefreshing ? "Updating..." : "Update Public Snapshot"}
        </button>
      </div>

      {message ? <p className="mt-4 text-sm text-zinc-700">{message}</p> : null}
    </section>
  );
}
