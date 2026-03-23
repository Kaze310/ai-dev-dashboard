import { NextResponse } from "next/server";

import { encryptApiKey } from "@/lib/crypto/api-keys";
import { createClient } from "@/lib/supabase/server";

type SaveOpenAIKeyBody = {
  apiKey?: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SaveOpenAIKeyBody;
  try {
    body = (await request.json()) as SaveOpenAIKeyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
  }
  const encryptedApiKey = encryptApiKey(apiKey);

  // 先查有没有记录，再决定 update 还是 insert，逻辑更直观。
  const { data: existing, error: queryError } = await supabase
    .from("providers")
    .select("id")
    .eq("user_id", user.id)
    .eq("name", "openai")
    .maybeSingle();

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  if (existing?.id) {
    // 已有记录就更新 key。
    const { error: updateError } = await supabase
      .from("providers")
      .update({ api_key_encrypted: encryptedApiKey })
      .eq("id", existing.id)
      .eq("user_id", user.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ saved: true, provider: "openai", updated: true });
  }

  const { error: insertError } = await supabase.from("providers").insert({
    // 没有记录就新建一条 openai provider。
    user_id: user.id,
    name: "openai",
    api_key_encrypted: encryptedApiKey,
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ saved: true, provider: "openai", created: true });
}
