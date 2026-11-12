import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { AccountNotProvisionedError, userTransaction } from "../transaction";

const alice = "11111111-2222-4333-8444-555555555555";
const bob = "22222222-2222-4333-8444-555555555555";
function setup() {
  let identity: string | undefined;
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") identity = undefined;
    if (sql.includes("set_config")) identity = values?.[0] as string;
    return { rows: [{ id: identity }], rowCount: 1 };
  });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  return { query, release, client, pool: { connect: vi.fn(async () => client) }, identity: () => identity };
}

describe("identity transactions (connection lifecycle, not live RLS)", () => {
  it("sets identity on the same client and clears it before the next borrower", async () => {
    const s = setup();
    for (const user of [alice, bob]) {
      await userTransaction(s.pool, user, async (db) => {
        expect(db).toBe(s.client);
        expect(s.identity()).toBe(user);
      });
      expect(s.identity()).toBeUndefined();
    }
    expect(s.release).toHaveBeenCalledTimes(2);
    expect(s.query).toHaveBeenCalledWith("SELECT set_config('app.user_id', $1, true)", [alice]);
  });
  it("rolls back errors before connection reuse", async () => {
    const s = setup();
    await expect(userTransaction(s.pool, alice, async () => { throw new Error("write failed"); })).rejects.toThrow("write failed");
    expect(s.identity()).toBeUndefined();
    expect(s.release).toHaveBeenCalledWith(false);
    await userTransaction(s.pool, bob, async () => { expect(s.identity()).toBe(bob); });
  });
  it("destroys a connection if rollback fails", async () => {
    const s = setup();
    s.query.mockImplementation(async (sql) => {
      if (sql === "ROLLBACK") throw new Error("connection lost");
      return { rows: [{ id: alice }], rowCount: 1 };
    });
    await expect(userTransaction(s.pool, alice, async () => { throw new Error("original failure"); })).rejects.toThrow("original failure");
    expect(s.release).toHaveBeenCalledWith(true);
  });
  it("rolls back if COMMIT fails and never returns a successful result", async () => {
    const s = setup();
    s.query.mockImplementation(async (sql) => {
      if (sql === "COMMIT") throw new Error("commit failed");
      return { rows: [{ id: alice }], rowCount: 1 };
    });
    await expect(userTransaction(s.pool, alice, async () => "saved")).rejects.toThrow("commit failed");
    expect(s.query).toHaveBeenCalledWith("ROLLBACK");
    expect(s.release).toHaveBeenCalledOnce();
  });
  it("does not execute business queries for an unregistered account", async () => {
    const s = setup();
    s.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const work = vi.fn();
    await expect(userTransaction(s.pool, alice, work)).rejects.toBeInstanceOf(AccountNotProvisionedError);
    expect(work).not.toHaveBeenCalled();
    expect(s.release).toHaveBeenCalledOnce();
  });
  it("rejects malformed identity before checking out a connection", async () => {
    const s = setup();
    await expect(userTransaction(s.pool, "'; DROP TABLE providers;", async () => undefined)).rejects.toThrow("Invalid authenticated user ID");
    expect(s.pool.connect).not.toHaveBeenCalled();
  });
});
