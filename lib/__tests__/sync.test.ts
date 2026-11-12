import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { encryptApiKey } from "../crypto/api-keys";
import { runProviderSync } from "../sync";
import { SyncSupersededError, type SyncStore, type ClaimResult } from "../db/sync-store";
import type { ProviderUsageRecord } from "../providers/shared";

beforeAll(() => { process.env.API_KEY_ENCRYPTION_SECRET = "test-secret"; });
const record = (partial: Partial<ProviderUsageRecord> = {}): ProviderUsageRecord => ({
  date: "2026-06-01", model: "m", input_tokens: 1, output_tokens: 1, cost_cents: 1, ...partial,
});
function setup() {
  const provider = { id: "provider-id", api_key_encrypted: encryptApiKey("sk-test"), claimed_at: "2026-06-01 01:00:00+00" };
  const store = {
    claim: vi.fn<SyncStore["claim"]>().mockResolvedValue({ kind: "claimed", provider }),
    save: vi.fn<SyncStore["save"]>().mockResolvedValue(undefined),
  };
  const fetchUsage = vi.fn(async () => [record()]);
  return { provider, store, fetchUsage, options: { store, fetchUsage, providerName: "openai" as const, startDate: "2026-06-01", endDate: "2026-06-05" } };
}

describe("provider sync", () => {
  it("claims before external fetch and decrypts only on the server", async () => {
    const { options, store, fetchUsage } = setup();
    fetchUsage.mockImplementation(async () => {
      expect(store.claim).toHaveBeenCalledOnce();
      expect(store.save).not.toHaveBeenCalled();
      return [record()];
    });
    expect((await runProviderSync(options)).status).toBe(200);
    expect(fetchUsage).toHaveBeenCalledWith("sk-test", options.startDate, options.endDate);
    expect(store.save).toHaveBeenCalledOnce();
  });
  it.each([["missing", 400], ["limited", 429]] as const)("does not call providers for %s claims", async (kind, status) => {
    const { options, store, fetchUsage } = setup();
    store.claim.mockResolvedValue({ kind });
    expect((await runProviderSync(options)).status).toBe(status);
    expect(fetchUsage).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });
  it("only one of two overlapping callers reaches the provider", async () => {
    const { options, store, provider, fetchUsage } = setup();
    let claimed = false;
    store.claim.mockImplementation(async (): Promise<ClaimResult> => {
      if (claimed) return { kind: "limited" };
      claimed = true;
      return { kind: "claimed", provider };
    });
    const results = await Promise.all([runProviderSync(options), runProviderSync(options)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
    expect(fetchUsage).toHaveBeenCalledOnce();
  });
  it.each(["2026-02-31", "not-a-date", "2026-06-10"])("rejects invalid range %s without DB calls", async (startDate) => {
    const { options, store } = setup();
    expect((await runProviderSync({ ...options, startDate })).status).toBe(400);
    expect(store.claim).not.toHaveBeenCalled();
  });
  it("merges duplicate date/model keys before saving", async () => {
    const { options, store, fetchUsage } = setup();
    fetchUsage.mockResolvedValue([record({ input_tokens: 10, cost_cents: 5 }), record({ input_tokens: 20, cost_cents: 7 })]);
    expect((await runProviderSync(options)).body.synced).toBe(1);
    expect(store.save.mock.calls[0][1]).toEqual([record({ input_tokens: 30, output_tokens: 2, cost_cents: 12 })]);
  });
  it("allows an empty response without inventing replacement dates", async () => {
    const { options, store, fetchUsage } = setup();
    fetchUsage.mockResolvedValue([]);
    expect((await runProviderSync(options)).body.synced).toBe(0);
    expect(store.save.mock.calls[0][1]).toEqual([]);
  });
  it("rejects out-of-range provider data before writing", async () => {
    const { options, store, fetchUsage } = setup();
    fetchUsage.mockResolvedValue([record({ date: "2026-07-01" })]);
    expect((await runProviderSync(options)).status).toBe(502);
    expect(store.save).not.toHaveBeenCalled();
  });
  it("does not report partial success or expose SQL details when saving fails", async () => {
    const { options, store } = setup();
    store.save.mockRejectedValue(new Error("secret query parameters"));
    const result = await runProviderSync(options);
    expect(result.status).toBe(500);
    expect(result.body.synced).toBe(0);
    expect(JSON.stringify(result)).not.toContain("secret query parameters");
  });
  it("does not expose keys returned in provider errors", async () => {
    const { options, fetchUsage, store } = setup();
    fetchUsage.mockRejectedValue(new Error("bad key sk-test"));
    const result = await runProviderSync(options);
    expect(result.status).toBe(502);
    expect(JSON.stringify(result)).not.toContain("sk-test");
    expect(store.save).not.toHaveBeenCalled();
  });
  it("asks for refresh instead of overwriting a newer sync", async () => {
    const { options, store } = setup();
    store.save.mockRejectedValue(new SyncSupersededError());
    expect((await runProviderSync(options)).status).toBe(409);
  });
});
