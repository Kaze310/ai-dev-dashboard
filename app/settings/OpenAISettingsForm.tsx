"use client";

import { useState } from "react";

type SyncResponse = {
  synced: number;
  errors: string[];
};

type SaveResponse = {
  saved?: boolean;
  error?: string;
};

type ProviderName = "openai" | "anthropic";

type ProviderState = {
  apiKey: string;
  saveMessage: string;
  syncMessage: string;
  isSaving: boolean;
  isSyncing: boolean;
  hasKey: boolean;
};

export function OpenAISettingsForm({
  hasOpenAIKey,
  hasAnthropicKey,
}: {
  hasOpenAIKey: boolean;
  hasAnthropicKey: boolean;
}) {
  const [providers, setProviders] = useState<Record<ProviderName, ProviderState>>({
    openai: {
      apiKey: "",
      saveMessage: "",
      syncMessage: "",
      isSaving: false,
      isSyncing: false,
      hasKey: hasOpenAIKey,
    },
    anthropic: {
      apiKey: "",
      saveMessage: "",
      syncMessage: "",
      isSaving: false,
      isSyncing: false,
      hasKey: hasAnthropicKey,
    },
  });

  const updateProvider = (name: ProviderName, patch: Partial<ProviderState>) => {
    setProviders((prev) => ({
      ...prev,
      [name]: {
        ...prev[name],
        ...patch,
      },
    }));
  };

  const providerLabel = (name: ProviderName) => (name === "openai" ? "OpenAI" : "Anthropic");

  const handleSave = async (name: ProviderName) => {
    const current = providers[name];
    if (!current.apiKey.trim()) {
      updateProvider(name, { saveMessage: `请输入 ${providerLabel(name)} API Key。` });
      return;
    }

    updateProvider(name, { isSaving: true, saveMessage: "" });

    try {
      const response = await fetch(`/api/providers/${name}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ apiKey: current.apiKey.trim() }),
      });

      const result = (await response.json()) as SaveResponse;

      if (!response.ok) {
        updateProvider(name, { saveMessage: result.error ?? "保存失败，请稍后重试。", isSaving: false });
        return;
      }

      updateProvider(name, {
        saveMessage: `${providerLabel(name)} API Key 已保存（仅服务端存储）。`,
        apiKey: "",
        isSaving: false,
        hasKey: true,
      });
    } catch (error) {
      updateProvider(name, {
        saveMessage: error instanceof Error ? error.message : "保存失败，请稍后重试。",
        isSaving: false,
      });
    }
  };

  const handleSync = async (name: ProviderName) => {
    updateProvider(name, { isSyncing: true, syncMessage: "" });

    try {
      const response = await fetch(`/api/sync/${name}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const result = (await response.json()) as SyncResponse;

      if (!response.ok) {
        const message = result.errors?.join("; ") || "同步失败，请稍后重试。";
        updateProvider(name, { syncMessage: message, isSyncing: false });
        return;
      }

      if (result.errors.length > 0) {
        updateProvider(name, {
          syncMessage: `同步完成，但有错误：${result.errors.join("; ")}`,
          isSyncing: false,
        });
        return;
      }

      updateProvider(name, {
        syncMessage: `同步成功，写入/更新 ${result.synced} 条 usage 记录。`,
        isSyncing: false,
      });
    } catch (error) {
      updateProvider(name, {
        syncMessage: error instanceof Error ? error.message : "同步失败，请稍后重试。",
        isSyncing: false,
      });
    }
  };

  const renderProviderCard = (name: ProviderName) => {
    const state = providers[name];

    return (
      <div key={name} className="rounded-lg border border-zinc-200 p-5">
        <h2 className="text-lg font-semibold">{providerLabel(name)} API Key</h2>
        <p className="mt-1 text-sm text-zinc-600">
          {state.hasKey ? "已存在已保存的 key，可直接更新。" : "当前还没有保存 key。"}
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor={`${name}-key`} className="mb-1 block text-sm font-medium">
              API Key
            </label>
            <input
              id={`${name}-key`}
              type="password"
              value={state.apiKey}
              onChange={(event) => updateProvider(name, { apiKey: event.target.value })}
              placeholder={name === "openai" ? "sk-..." : "sk-ant-..."}
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void handleSave(name)}
              disabled={state.isSaving}
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {state.isSaving ? "保存中..." : "保存 API Key"}
            </button>

            <button
              type="button"
              onClick={() => void handleSync(name)}
              disabled={state.isSyncing}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {state.isSyncing ? "同步中..." : "Sync Now"}
            </button>
          </div>
        </div>

        {state.saveMessage ? <p className="mt-3 text-sm">{state.saveMessage}</p> : null}
        {state.syncMessage ? <p className="mt-2 text-sm">{state.syncMessage}</p> : null}
      </div>
    );
  };

  return <section className="mt-8 space-y-6">{(["openai", "anthropic"] as ProviderName[]).map(renderProviderCard)}</section>;
}
