import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type SaveAnthropicKeyBody = {
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

  let body: SaveAnthropicKeyBody;
  try {
    body = (await request.json()) as SaveAnthropicKeyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
  }

  const { data: existing, error: queryError } = await supabase
    .from("providers")
    .select("id")
    .eq("user_id", user.id)
    .eq("name", "anthropic")
    .maybeSingle();

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from("providers")
      .update({ api_key_encrypted: apiKey })
      .eq("id", existing.id)
      .eq("user_id", user.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ saved: true, provider: "anthropic", updated: true });
  }

  const { error: insertError } = await supabase.from("providers").insert({
    user_id: user.id,
    name: "anthropic",
    api_key_encrypted: apiKey,
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ saved: true, provider: "anthropic", created: true });
}
