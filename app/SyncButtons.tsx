"use client";

import { useState } from "react";

type SyncResponse = {
  synced: number;
  errors: string[];
};

export function SyncButtons() {
  const [isSyncing, setIsSyncing] = useState<"openai" | "anthropic" | "all" | null>(null);
  const [message, setMessage] = useState("");

  const syncProvider = async (provider: "openai" | "anthropic") => {
    const response = await fetch(`/api/sync/${provider}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const result = (await response.json()) as SyncResponse;
    if (!response.ok) {
      throw new Error(result.errors?.join("; ") || `${provider} sync failed`);
    }

    if (result.errors.length > 0) {
      throw new Error(result.errors.join("; "));
    }

    return result.synced;
  };

  const handleSync = async (mode: "openai" | "anthropic" | "all") => {
    setIsSyncing(mode);
    setMessage("");

    try {
      if (mode === "all") {
        const [openaiSynced, anthropicSynced] = await Promise.all([syncProvider("openai"), syncProvider("anthropic")]);
        setMessage(`同步完成：OpenAI ${openaiSynced} 条，Anthropic ${anthropicSynced} 条。`);
      } else {
        const synced = await syncProvider(mode);
        const label = mode === "openai" ? "OpenAI" : "Anthropic";
        setMessage(`${label} 同步完成：${synced} 条。`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "同步失败，请稍后重试。");
    } finally {
      setIsSyncing(null);
    }
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleSync("openai")}
          disabled={isSyncing !== null}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {isSyncing === "openai" ? "同步中..." : "Sync OpenAI"}
        </button>

        <button
          type="button"
          onClick={() => void handleSync("anthropic")}
          disabled={isSyncing !== null}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {isSyncing === "anthropic" ? "同步中..." : "Sync Anthropic"}
        </button>

        <button
          type="button"
          onClick={() => void handleSync("all")}
          disabled={isSyncing !== null}
          className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {isSyncing === "all" ? "同步中..." : "Sync All"}
        </button>
      </div>

      {message ? <p className="mt-2 text-sm text-zinc-600">{message}</p> : null}
    </div>
  );
}
