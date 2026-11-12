import { NextResponse } from "next/server";
import { decryptApiKey } from "@/lib/crypto/api-keys";
import { dedupeByDateModel, type ProviderUsageRecord } from "@/lib/providers/shared";
import { authorizeApi } from "@/lib/auth/session";
import { AccountNotProvisionedError } from "@/lib/db/transaction";
import { createSyncStore, SyncSupersededError, type SyncStore } from "@/lib/db/sync-store";

export type SyncOutcome = { status: number; body: { synced: number; errors: string[] } };
export type UsageFetcher = (apiKey: string, startDate: string, endDate: string) => Promise<ProviderUsageRecord[]>;

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

function isValidYmd(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const failure = (status: number, message: string): SyncOutcome => ({ status, body: { synced: 0, errors: [message] } });

export async function runProviderSync(options: {
  store: SyncStore; providerName: "openai" | "anthropic"; fetchUsage: UsageFetcher;
  startDate: string; endDate: string;
}): Promise<SyncOutcome> {
  const { store, providerName, fetchUsage, startDate, endDate } = options;
  if (!isValidYmd(startDate) || !isValidYmd(endDate) || startDate > endDate) {
    return failure(400, "Invalid date range: expected real YYYY-MM-DD dates with startDate <= endDate.");
  }
  try {
    const claim = await store.claim(providerName);
    if (claim.kind === "missing") return failure(400, `${providerName} provider key not found. Please save API key first.`);
    if (claim.kind === "limited") return failure(429, "Rate limited: a sync for this provider ran within the last minute.");
    if (claim.kind !== "claimed") throw new Error("Unexpected sync claim");
    let apiKey;
    try { apiKey = decryptApiKey(claim.provider.api_key_encrypted); }
    catch { return failure(500, "The saved provider key could not be decrypted. Check the original encryption secret or save the key again."); }
    let usage;
    try { usage = await fetchUsage(apiKey, startDate, endDate); }
    catch { return failure(502, "Unable to fetch provider reports. Check reporting permissions and try again."); }
    const rows = dedupeByDateModel(usage).filter((item) => item.model !== "unknown" && item.model !== "");
    if (rows.some((row) => !isValidYmd(row.date) || row.date < startDate || row.date > endDate
      || !Number.isSafeInteger(row.input_tokens) || row.input_tokens < 0
      || !Number.isSafeInteger(row.output_tokens) || row.output_tokens < 0 || !Number.isFinite(row.cost_cents))) {
      return failure(502, "The provider returned invalid usage data. Existing records were preserved.");
    }
    await store.save(claim.provider, rows);
    return { status: 200, body: { synced: rows.length, errors: [] } };
  } catch (error) {
    if (error instanceof AccountNotProvisionedError) return failure(403, error.message);
    if (error instanceof SyncSupersededError) return failure(409, "A newer sync or key change replaced this request. Refresh the dashboard.");
    return failure(500, "Sync could not be saved. Existing records were preserved. Please try again.");
  }
}

export async function handleProviderSync(request: Request, providerName: "openai" | "anthropic", fetchUsage: UsageFetcher) {
  const { user, response } = await authorizeApi(request);
  if (!user) {
    const { error } = await response.json();
    return NextResponse.json({ synced: 0, errors: [error] }, { status: response.status });
  }
  let body: Record<string, unknown> = {};
  const text = await request.text();
  if (text.trim()) {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed;
    } catch { return NextResponse.json(failure(400, "Invalid JSON body").body, { status: 400 }); }
  }
  const defaults = getDefaultDateRange();
  const startDate = body.startDate ?? defaults.startDate;
  const endDate = body.endDate ?? defaults.endDate;
  if (typeof startDate !== "string" || typeof endDate !== "string") {
    return NextResponse.json(failure(400, "Invalid date range").body, { status: 400 });
  }
  const outcome = await runProviderSync({ store: createSyncStore(user.sub), providerName, fetchUsage, startDate, endDate });
  return NextResponse.json(outcome.body, { status: outcome.status });
}
