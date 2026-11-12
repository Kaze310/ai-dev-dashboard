import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { userTransaction } from "../transaction";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ withUserDatabase: vi.fn() }));
vi.mock("../pool", () => ({ withUserDatabase: mocks.withUserDatabase }));
import { createSyncStore, SyncSupersededError } from "../sync-store";

const sub = "11111111-2222-4333-8444-555555555555";
const provider = { id: "22222222-2222-4333-8444-555555555555", api_key_encrypted: "ciphertext", claimed_at: "2026-06-01 01:00:00.123456+00" };
const row = { date: "2026-06-01", model: "model", input_tokens: 1, output_tokens: 1, cost_cents: 0.0003 };
const query = vi.fn<(sql: string, values?: unknown[]) => Promise<{ rows: { id: string }[]; rowCount: number }>>();
const release = vi.fn();
beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [{ id: sub }], rowCount: 1 });
  release.mockReset();
  const pool = { connect: async () => ({ query, release } as unknown as PoolClient) };
  mocks.withUserDatabase.mockImplementation((id, work) => userTransaction(pool, id, work));
});

describe("sync persistence transactions", () => {
  it("rolls back the entire batch when stale-row cleanup fails", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes("DELETE FROM public.usage_records")) throw new Error("cleanup failed");
      return { rows: [{ id: sub }], rowCount: 1 };
    });
    await expect(createSyncStore(sub).save(provider, [row])).rejects.toThrow("cleanup failed");
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO public.usage_records"))).toBe(true);
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query).not.toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });
  it("does not insert or delete when a newer request owns the sync claim", async () => {
    query.mockImplementation(async (sql) => ({ rows: [], rowCount: sql.includes("FOR UPDATE") ? 0 : 1 }));
    await expect(createSyncStore(sub).save(provider, [row])).rejects.toBeInstanceOf(SyncSupersededError);
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT") || sql.includes("DELETE"))).toBe(false);
    const lock = query.mock.calls.find(([sql]) => sql.includes("FOR UPDATE"))!;
    expect(lock[1]).toEqual([provider.id, sub, provider.claimed_at, provider.api_key_encrypted]);
  });
  it("preserves history when the provider returns nothing", async () => {
    await createSyncStore(sub).save(provider, []);
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT") || sql.includes("DELETE"))).toBe(false);
    expect(query).toHaveBeenCalledWith("COMMIT");
  });
  it("writes batches exceeding the old 1000-row REST limit with owner parameters", async () => {
    const rows = Array.from({ length: 2100 }, (_, i) => ({ ...row, model: `m${i}` }));
    await createSyncStore(sub).save(provider, rows);
    const inserts = query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO public.usage_records"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]?.slice(0, 2)).toEqual([sub, provider.id]);
    expect(JSON.parse(inserts[0][1]?.[2] as string)).toHaveLength(2100);
    const cleanup = query.mock.calls.find(([sql]) => sql.includes("DELETE FROM public.usage_records"))!;
    expect(cleanup[0]).toContain("EXISTS (SELECT 1 FROM batch b WHERE b.date = u.date)");
    expect(cleanup[0]).toContain("NOT EXISTS (SELECT 1 FROM batch b WHERE b.date = u.date AND b.model = u.model)");
    expect(query).toHaveBeenCalledWith("COMMIT");
  });
});
