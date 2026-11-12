import { NextResponse } from "next/server";
import { encryptApiKey } from "@/lib/crypto/api-keys";
import { authorizeApi, apiFailure } from "@/lib/auth/session";
import { withUserDatabase } from "@/lib/db/pool";

export type KeyVerifier = (apiKey: string) => Promise<{ ok: boolean; message?: string }>;

export async function handleSaveProviderKey(request: Request, providerName: "openai" | "anthropic", verifyKey: KeyVerifier) {
  const { user, response } = await authorizeApi(request);
  if (!user) return response;
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
  // Check account access before calling an external provider, then release the DB connection.
  try { await withUserDatabase(user.sub, async () => undefined); }
  catch (error) { return apiFailure(error); }
  try {
    const verification = await verifyKey(apiKey);
    if (!verification.ok) return NextResponse.json({ error: "API key verification failed. Check the key and its reporting permissions." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Could not verify the API key with the provider. Please try again." }, { status: 502 });
  }
  try {
    const encrypted = encryptApiKey(apiKey);
    await withUserDatabase(user.sub, (db) => db.query(`
      INSERT INTO public.providers (user_id, name, api_key_encrypted) VALUES ($1, $2, $3)
      ON CONFLICT (user_id, name) DO UPDATE SET api_key_encrypted = EXCLUDED.api_key_encrypted`,
      [user.sub, providerName, encrypted]));
    return NextResponse.json({ saved: true, provider: providerName, verified: true });
  } catch (error) { return apiFailure(error); }
}
