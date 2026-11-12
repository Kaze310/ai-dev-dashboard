import type { PoolClient } from "pg";

export type DatabaseClient = Pick<PoolClient, "query">;
export type ConnectionSource = { connect(): Promise<PoolClient> };
export const isUserId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export class AccountNotProvisionedError extends Error {
  constructor() { super("This account does not have dashboard access yet."); }
}

// Identity and every query share one connection. SET LOCAL expires on both
// COMMIT and ROLLBACK, so the next borrower cannot inherit this user's identity.
export async function userTransaction<T>(
  pool: ConnectionSource, userId: string, work: (db: DatabaseClient) => Promise<T>,
): Promise<T> {
  if (!isUserId(userId)) throw new Error("Invalid authenticated user ID");
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const account = await client.query("SELECT id FROM public.app_users WHERE id = $1", [userId]);
    if (!account.rowCount) throw new AccountNotProvisionedError();
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { discard = true; }
    throw error;
  } finally {
    client.release(discard);
  }
}
