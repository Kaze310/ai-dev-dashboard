import "server-only";
import { readFileSync } from "node:fs";
import { Pool, types, type PoolConfig } from "pg";
import { userTransaction, type DatabaseClient } from "./transaction";

type Purpose = "app" | "showcase";

export function databaseConfig(purpose: Purpose, env = process.env): PoolConfig {
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  const user = required(purpose === "app" ? "DATABASE_USER" : "SHOWCASE_DATABASE_USER");
  if (user !== (purpose === "app" ? "dashboard_app" : "dashboard_public")) {
    throw new Error("Use the dedicated application database account");
  }
  const port = Number(env.DATABASE_PORT ?? "5432");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid DATABASE_PORT");
  return {
    host: required("DATABASE_HOST"), port, database: required("DATABASE_NAME"), user,
    password: required(purpose === "app" ? "DATABASE_PASSWORD" : "SHOWCASE_DATABASE_PASSWORD"),
    ssl: { ca: readFileSync(required("DATABASE_CA_CERT_PATH"), "utf8"), rejectUnauthorized: true },
    max: purpose === "app" ? 5 : 2,
    connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000,
    statement_timeout: 30_000, idle_in_transaction_session_timeout: 30_000,
    application_name: `ai-dashboard-${purpose}`,
    // Preserve date-only values and exact numeric/bigint strings across time zones.
    types: { getTypeParser: (oid, format) => oid === 1082 && format !== "binary" ? (value: string) => value : types.getTypeParser(oid, format) },
  };
}

const globalDb = globalThis as typeof globalThis & { dashboardPools?: Partial<Record<Purpose, Pool>> };
function getPool(purpose: Purpose) {
  const pools = globalDb.dashboardPools ??= {};
  if (!pools[purpose]) {
    const pool = new Pool(databaseConfig(purpose));
    // Idle socket errors must not crash the process or log credentials/query data.
    pool.on("error", () => console.error("An idle database connection was closed."));
    pools[purpose] = pool;
  }
  return pools[purpose];
}

// userId must come from getAppSession(), never request JSON or query parameters.
export function withUserDatabase<T>(userId: string, work: (db: DatabaseClient) => Promise<T>) {
  return userTransaction(getPool("app"), userId, work);
}

export function showcaseDatabase() { return getPool("showcase"); }
