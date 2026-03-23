import { NextResponse } from "next/server";

import { decryptApiKey } from "@/lib/crypto/api-keys";
import { fetchOpenAIUsage } from "@/lib/providers/openai";
import { createClient } from "@/lib/supabase/server";

type SyncBody = {
  startDate?: string;
  endDate?: string;
};

function getDefaultDateRange() {
  // 默认拉取最近 30 天，避免第一次同步就扫全历史。
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 30);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ synced: 0, errors: ["Unauthorized"] }, { status: 401 });
  }

  let body: SyncBody = {};
  try {
    body = (await request.json()) as SyncBody;
  } catch {
    // body 可选，不传也允许，所以这里不直接报错。
  }

  const defaults = getDefaultDateRange();
  const startDate = body.startDate ?? defaults.startDate;
  const endDate = body.endDate ?? defaults.endDate;

  const { data: provider, error: providerError } = await supabase
    .from("providers")
    .select("id, api_key_encrypted")
    .eq("user_id", user.id)
    .eq("name", "openai")
    .maybeSingle();

  if (providerError) {
    return NextResponse.json({ synced: 0, errors: [providerError.message] }, { status: 500 });
  }

  if (!provider?.id || !provider.api_key_encrypted) {
    return NextResponse.json(
      { synced: 0, errors: ["OpenAI provider key not found. Please save API key first."] },
      { status: 400 },
    );
  }

  try {
    const decryptedApiKey = decryptApiKey(provider.api_key_encrypted);
    const usage = await fetchOpenAIUsage(decryptedApiKey, startDate, endDate);

    if (usage.length === 0) {
      return NextResponse.json({ synced: 0, errors: [] });
    }

    const rows = usage.map((item) => ({
      user_id: user.id,
      provider_id: provider.id,
      date: item.date,
      model: item.model,
      input_tokens: item.input_tokens,
      output_tokens: item.output_tokens,
      cost_cents: item.cost_cents,
      raw_json: item,
    }));

    // 用 provider_id + date + model 去重，同一天同模型重复同步会走更新而不是重复插入。
    const { error: upsertError } = await supabase
      .from("usage_records")
      .upsert(rows, { onConflict: "provider_id,date,model" });

    if (upsertError) {
      return NextResponse.json({ synced: 0, errors: [upsertError.message] }, { status: 500 });
    }

    // 清理历史遗留的 unknown/空模型行，避免旧脏数据继续出现在 UI 中。
    await supabase
      .from("usage_records")
      .delete()
      .eq("user_id", user.id)
      .eq("provider_id", provider.id)
      .in("model", ["unknown", "UNKNOWN", "Unknown", ""]);

    return NextResponse.json({ synced: rows.length, errors: [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ synced: 0, errors: [message] }, { status: 500 });
  }
}
