import { NextResponse } from "next/server";

import { encryptApiKey } from "@/lib/crypto/api-keys";
import { createClient } from "@/lib/supabase/server";

type SaveKeyBody = {
  apiKey?: string;
};

export type KeyVerifier = (apiKey: string) => Promise<{ ok: boolean; message?: string }>;

/**
 * 两个 provider 的保存逻辑此前是复制粘贴的两份,合并为一个 handler。
 *
 * 变更点:
 * - 保存前先调用 verifier 做一次轻量验证(1 天 usage),保存时即可区分
 *   “key 无效”与“非 admin key”,而不是等 sync 才失败。
 * - select-then-insert/update 改为 upsert onConflict (user_id, name),
 *   消除并发下撞唯一索引报错的窗口。
 */
export async function handleSaveProviderKey(
  request: Request,
  providerName: "openai" | "anthropic",
  verifyKey: KeyVerifier,
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SaveKeyBody;
  try {
    body = (await request.json()) as SaveKeyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
  }

  try {
    const verification = await verifyKey(apiKey);
    if (!verification.ok) {
      return NextResponse.json({ error: verification.message ?? "API key verification failed" }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `API key verification failed: ${message}` }, { status: 502 });
  }

  const encryptedApiKey = encryptApiKey(apiKey);

  const { error: upsertError } = await supabase.from("providers").upsert(
    {
      user_id: user.id,
      name: providerName,
      api_key_encrypted: encryptedApiKey,
    },
    { onConflict: "user_id,name" },
  );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ saved: true, provider: providerName, verified: true });
}
