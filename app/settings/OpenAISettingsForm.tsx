"use client";

import { FormEvent, useState } from "react";

type SyncResponse = {
  synced: number;
  errors: string[];
};

type SaveResponse = {
  saved?: boolean;
  error?: string;
};

export function OpenAISettingsForm({ hasKey }: { hasKey: boolean }) {
  const [apiKey, setApiKey] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveMessage("");

    if (!apiKey.trim()) {
      setSaveMessage("请输入 OpenAI API Key。");
      return;
    }

    setIsSaving(true);

    try {
      // 调后端 API 保存 key：key 不在浏览器端持久化，只发送一次给服务端。
      const response = await fetch("/api/providers/openai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });

      const result = (await response.json()) as SaveResponse;

      if (!response.ok) {
        setSaveMessage(result.error ?? "保存失败，请稍后重试。");
        return;
      }

      setSaveMessage("OpenAI API Key 已保存（仅服务端存储）。");
      setApiKey("");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "保存失败，请稍后重试。");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncMessage("");
    setIsSyncing(true);

    try {
      // 手动触发后端同步逻辑，由服务端拿 key 请求 OpenAI usage。
      const response = await fetch("/api/sync/openai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const result = (await response.json()) as SyncResponse;

      if (!response.ok) {
        const message = result.errors?.join("; ") || "同步失败，请稍后重试。";
        setSyncMessage(message);
        return;
      }

      if (result.errors.length > 0) {
        setSyncMessage(`同步完成，但有错误：${result.errors.join("; ")}`);
        return;
      }

      setSyncMessage(`同步成功，写入/更新 ${result.synced} 条 usage 记录。`);
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "同步失败，请稍后重试。");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <section className="mt-8 space-y-6">
      <div className="rounded-lg border border-zinc-200 p-5">
        <h2 className="text-lg font-semibold">OpenAI API Key</h2>
        <p className="mt-1 text-sm text-zinc-600">
          {hasKey ? "已存在已保存的 key，可直接更新。" : "当前还没有保存 key。"}
        </p>

        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div>
            <label htmlFor="openai-key" className="mb-1 block text-sm font-medium">
              API Key
            </label>
            <input
              id="openai-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-..."
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            />
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSaving ? "保存中..." : "保存 API Key"}
          </button>
        </form>

        {saveMessage ? <p className="mt-3 text-sm">{saveMessage}</p> : null}
      </div>

      <div className="rounded-lg border border-zinc-200 p-5">
        <h2 className="text-lg font-semibold">Usage 同步</h2>
        <p className="mt-1 text-sm text-zinc-600">点击按钮拉取最近 30 天 OpenAI usage。</p>

        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="mt-4 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {isSyncing ? "同步中..." : "Sync Now"}
        </button>

        {syncMessage ? <p className="mt-3 text-sm">{syncMessage}</p> : null}
      </div>
    </section>
  );
}
