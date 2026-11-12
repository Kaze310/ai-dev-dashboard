import "server-only";
import { withUserDatabase } from "./pool";
import type { ProviderUsageRecord } from "@/lib/providers/shared";

export type SyncClaim = { id: string; api_key_encrypted: string; claimed_at: string };
export type ClaimResult = { kind: "claimed"; provider: SyncClaim } | { kind: "missing" | "limited" };
export type SyncStore = {
  claim(providerName: "openai" | "anthropic"): Promise<ClaimResult>;
  save(provider: SyncClaim, rows: ProviderUsageRecord[]): Promise<void>;
};
export class SyncSupersededError extends Error {}

export function createSyncStore(userId: string): SyncStore {
  return {
    claim: (name) => withUserDatabase(userId, async (db) => {
      // The server clock and a conditional UPDATE serialize concurrent claims.
      const claim = await db.query<SyncClaim>(`
        UPDATE public.providers SET last_synced_at = clock_timestamp()
        WHERE user_id = $1 AND name = $2
          AND (last_synced_at IS NULL OR last_synced_at < clock_timestamp() - interval '60 seconds')
        RETURNING id, api_key_encrypted, last_synced_at::text AS claimed_at`, [userId, name]);
      if (claim.rows[0]) return { kind: "claimed", provider: claim.rows[0] };
      const existing = await db.query("SELECT id FROM public.providers WHERE user_id = $1 AND name = $2", [userId, name]);
      return { kind: existing.rowCount ? "limited" : "missing" };
    }),
    save: (provider, rows) => withUserDatabase(userId, async (db) => {
      // A slow request must not overwrite a newer sync or a newly replaced key.
      // Hold this lock only during DB writes, never during provider HTTP calls.
      const lock = await db.query(`SELECT id FROM public.providers
        WHERE id = $1 AND user_id = $2 AND last_synced_at = $3::timestamptz AND api_key_encrypted = $4
        FOR UPDATE`, [provider.id, userId, provider.claimed_at, provider.api_key_encrypted]);
      if (!lock.rowCount) throw new SyncSupersededError();
      if (!rows.length) return;
      const batch = JSON.stringify(rows);
      await db.query(`INSERT INTO public.usage_records
        (user_id, provider_id, date, model, input_tokens, output_tokens, cost_cents)
        SELECT $1::uuid, $2::uuid, x.date, x.model, x.input_tokens, x.output_tokens, x.cost_cents
        FROM jsonb_to_recordset($3::jsonb) AS x(date date, model text, input_tokens bigint, output_tokens bigint, cost_cents numeric)
        ON CONFLICT (provider_id, date, model) DO UPDATE SET
          input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens, cost_cents = EXCLUDED.cost_cents`,
        [userId, provider.id, batch]);
      // Only replace dates actually returned. Empty/missing days retain history.
      // No REST pagination limit, and cleanup failure rolls the upsert back too.
      await db.query(`WITH batch AS (
          SELECT * FROM jsonb_to_recordset($3::jsonb) AS x(date date, model text)
        ) DELETE FROM public.usage_records u
        WHERE u.user_id = $1 AND u.provider_id = $2
          AND EXISTS (SELECT 1 FROM batch b WHERE b.date = u.date)
          AND NOT EXISTS (SELECT 1 FROM batch b WHERE b.date = u.date AND b.model = u.model)`,
        [userId, provider.id, batch]);
    }),
  };
}
