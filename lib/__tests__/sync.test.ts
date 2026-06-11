/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { encryptApiKey } from "../crypto/api-keys";
import { runProviderSync } from "../sync";
import type { ProviderUsageRecord } from "../providers/shared";

// runProviderSync 内部会 decryptApiKey,测试里用真实加密产物。
beforeAll(() => {
  process.env.API_KEY_ENCRYPTION_SECRET = "test-secret";
});

type Call = {
  table: string;
  op: "select" | "update" | "upsert" | "delete";
  args: any;
  filters: Array<[string, ...unknown[]]>;
  range?: [number, number];
};

type Result = { data?: any; error?: { message: string } | null };

/** 最小可用的 supabase 假实现:链式调用收集到 Call,await 时交给 dispatch。 */
function createFakeSupabase(dispatch: (call: Call) => Result): { client: SupabaseClient; calls: Call[] } {
  const calls: Call[] = [];

  function from(table: string) {
    const call: Call = { table, op: "select", args: null, filters: [] };
    calls.push(call);

    const b: any = {
      select: () => b,
      update: (values: unknown) => {
        call.op = "update";
        call.args = values;
        return b;
      },
      upsert: (rows: unknown, opts: unknown) => {
        call.op = "upsert";
        call.args = { rows, opts };
        return b;
      },
      delete: () => {
        call.op = "delete";
        return b;
      },
      eq: (k: string, v: unknown) => {
        call.filters.push(["eq", k, v]);
        return b;
      },
      or: (expr: string) => {
        call.filters.push(["or", expr]);
        return b;
      },
      gte: (k: string, v: unknown) => {
        call.filters.push(["gte", k, v]);
        return b;
      },
      lt: (k: string, v: unknown) => {
        call.filters.push(["lt", k, v]);
        return b;
      },
      in: (k: string, v: unknown) => {
        call.filters.push(["in", k, v]);
        return b;
      },
      order: () => b,
      range: (fromIdx: number, toIdx: number) => {
        call.range = [fromIdx, toIdx];
        return b;
      },
      maybeSingle: () => Promise.resolve(dispatch(call)),
      then: (resolve: any, reject: any) => Promise.resolve(dispatch(call)).then(resolve, reject),
    };

    return b;
  }

  return { client: { from } as unknown as SupabaseClient, calls };
}

const ENCRYPTED_KEY = () => encryptApiKey("sk-test");

function record(partial: Partial<ProviderUsageRecord>): ProviderUsageRecord {
  return {
    date: "2026-06-01",
    model: "m",
    input_tokens: 1,
    output_tokens: 1,
    cost_cents: 1,
    ...partial,
  };
}

function baseDispatch(overrides: {
  claim?: (call: Call) => Result;
  scan?: (call: Call) => Result;
  deleteIn?: (call: Call) => Result;
  upsert?: (call: Call) => Result;
}) {
  return (call: Call): Result => {
    if (call.table === "providers" && call.op === "select") {
      return { data: { id: "prov-1", api_key_encrypted: ENCRYPTED_KEY() }, error: null };
    }
    if (call.table === "providers" && call.op === "update") {
      return overrides.claim?.(call) ?? { data: [{ id: "prov-1" }], error: null };
    }
    if (call.table === "usage_records" && call.op === "upsert") {
      return overrides.upsert?.(call) ?? { error: null };
    }
    if (call.table === "usage_records" && call.op === "select") {
      return overrides.scan?.(call) ?? { data: [], error: null };
    }
    if (call.table === "usage_records" && call.op === "delete") {
      return overrides.deleteIn?.(call) ?? { error: null };
    }
    return { data: null, error: { message: `unexpected call: ${call.table}/${call.op}` } };
  };
}

function runOpts(client: SupabaseClient, fetchUsage: () => Promise<ProviderUsageRecord[]>) {
  return {
    supabase: client,
    userId: "user-1",
    providerName: "openai" as const,
    fetchUsage,
    startDate: "2026-06-01",
    endDate: "2026-06-05",
  };
}

describe("runProviderSync — rate limiting", () => {
  it("claims the sync slot atomically: second concurrent caller gets 429", async () => {
    let claims = 0;
    const { client } = createFakeSupabase(
      baseDispatch({
        // 第一次抢占成功,第二次条件 UPDATE 不命中任何行(模拟并发竞争失败)。
        claim: () => ({ data: ++claims === 1 ? [{ id: "prov-1" }] : [], error: null }),
      }),
    );

    const first = await runProviderSync(runOpts(client, async () => [record({})]));
    const second = await runProviderSync(runOpts(client, async () => [record({})]));

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body.errors[0]).toMatch(/Rate limited/);
  });

  it("claim 的条件 UPDATE 带 last_synced_at 空值/过期过滤", async () => {
    const { client, calls } = createFakeSupabase(baseDispatch({}));
    await runProviderSync(runOpts(client, async () => []));

    const claim = calls.find((c) => c.table === "providers" && c.op === "update");
    const orFilter = claim?.filters.find(([kind]) => kind === "or");
    expect(String(orFilter?.[1])).toMatch(/last_synced_at\.is\.null,last_synced_at\.lt\./);
  });

  it("returns 500 when the claim update itself errors", async () => {
    const { client } = createFakeSupabase(
      baseDispatch({ claim: () => ({ data: null, error: { message: "db down" } }) }),
    );

    const result = await runProviderSync(runOpts(client, async () => []));
    expect(result.status).toBe(500);
    expect(result.body.errors).toContain("db down");
  });
});

describe("runProviderSync — stale-row cleanup", () => {
  it("surfaces scan failures instead of silently succeeding", async () => {
    const { client } = createFakeSupabase(
      baseDispatch({ scan: () => ({ data: null, error: { message: "scan exploded" } }) }),
    );

    const result = await runProviderSync(runOpts(client, async () => [record({})]));

    expect(result.status).toBe(500);
    expect(result.body.errors[0]).toMatch(/Stale-row scan failed: scan exploded/);
    // upsert 已发生,synced 数如实返回。
    expect(result.body.synced).toBe(1);
  });

  it("surfaces delete failures", async () => {
    const { client } = createFakeSupabase(
      baseDispatch({
        scan: (call) =>
          call.range?.[0] === 0
            ? { data: [{ id: "stale-1", date: "2026-06-01", model: "old-model" }], error: null }
            : { data: [], error: null },
        deleteIn: () => ({ error: { message: "delete exploded" } }),
      }),
    );

    const result = await runProviderSync(runOpts(client, async () => [record({})]));

    expect(result.status).toBe(500);
    expect(result.body.errors[0]).toMatch(/Stale-row delete failed: delete exploded/);
  });

  it("chunks large deletes into batches of 200", async () => {
    const staleRows = Array.from({ length: 450 }, (_, i) => ({
      id: `stale-${i}`,
      date: "2026-06-01", // 与本批同日期,确保进入清理范围
      model: `old-${i}`,
    }));
    const deleteSizes: number[] = [];

    const { client } = createFakeSupabase(
      baseDispatch({
        scan: (call) => (call.range?.[0] === 0 ? { data: staleRows, error: null } : { data: [], error: null }),
        deleteIn: (call) => {
          const inFilter = call.filters.find(([kind]) => kind === "in");
          deleteSizes.push((inFilter?.[2] as string[]).length);
          return { error: null };
        },
      }),
    );

    const result = await runProviderSync(runOpts(client, async () => [record({})]));

    expect(result.status).toBe(200);
    expect(deleteSizes).toEqual([200, 200, 50]);
  });

  it("paginates the stale-row scan past 1000 rows", async () => {
    const page = (offset: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `row-${offset + i}`,
        date: "2026-06-01",
        model: "m", // 与本批一致 → 不删
      }));
    const scanRanges: Array<[number, number] | undefined> = [];

    const { client } = createFakeSupabase(
      baseDispatch({
        scan: (call) => {
          scanRanges.push(call.range);
          return call.range?.[0] === 0
            ? { data: page(0, 1000), error: null }
            : { data: page(1000, 5), error: null };
        },
      }),
    );

    const result = await runProviderSync(runOpts(client, async () => [record({})]));

    expect(result.status).toBe(200);
    expect(scanRanges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("empty provider result deletes NOTHING — protects against 200+empty (outage, data lag, long-idle user)", async () => {
    const { client, calls } = createFakeSupabase(baseDispatch({}));

    const result = await runProviderSync(runOpts(client, async () => []));

    expect(result.status).toBe(200);
    expect(result.body.synced).toBe(0);
    // 既不 upsert,也不扫描/删除:本地历史数据原样保留。
    expect(calls.some((c) => c.op === "upsert")).toBe(false);
    expect(calls.some((c) => c.table === "usage_records" && c.op === "select")).toBe(false);
    expect(calls.some((c) => c.op === "delete")).toBe(false);
  });

  it("only cleans dates present in the batch: stale model on a returned date is removed, untouched dates survive", async () => {
    const deleted: string[][] = [];
    const { client } = createFakeSupabase(
      baseDispatch({
        scan: (call) =>
          call.range?.[0] === 0
            ? {
                data: [
                  // 同日期、模型已不在本批 → 应删除(provider 修正 / 合成行被替换)。
                  { id: "stale-same-date", date: "2026-06-01", model: "gone-model" },
                  // 本批没有这个日期的数据 → 必须保留(可能只是数据延迟)。
                  { id: "keep-other-date", date: "2026-06-03", model: "old-model" },
                ],
                error: null,
              }
            : { data: [], error: null },
        deleteIn: (call) => {
          const inFilter = call.filters.find(([kind]) => kind === "in");
          deleted.push(inFilter?.[2] as string[]);
          return { error: null };
        },
      }),
    );

    const result = await runProviderSync(
      runOpts(client, async () => [record({ date: "2026-06-01", model: "m" })]),
    );

    expect(result.status).toBe(200);
    expect(deleted).toEqual([["stale-same-date"]]);
  });
});

describe("runProviderSync — input validation", () => {
  it("rejects malformed date ranges before touching the database", async () => {
    const { client, calls } = createFakeSupabase(baseDispatch({}));
    const result = await runProviderSync({
      ...runOpts(client, async () => []),
      startDate: "2026-06-10",
      endDate: "2026-06-01",
    });

    expect(result.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("rejects dates that match the format but are not real (2026-02-31)", async () => {
    const { client, calls } = createFakeSupabase(baseDispatch({}));

    // 2026-02-31 会被 Date 归一化成 2026-03-03,造成同步范围静默偏移。
    const result = await runProviderSync({
      ...runOpts(client, async () => []),
      startDate: "2026-02-31",
      endDate: "2026-03-05",
    });

    expect(result.status).toBe(400);
    expect(result.body.errors[0]).toMatch(/Invalid date range/);
    expect(calls).toHaveLength(0);
  });

  it("dedupes duplicate (date, model) rows before upsert", async () => {
    let upserted: any[] = [];
    const { client } = createFakeSupabase(
      baseDispatch({
        upsert: (call) => {
          upserted = call.args.rows;
          return { error: null };
        },
      }),
    );

    await runProviderSync(
      runOpts(client, async () => [
        record({ model: "m", input_tokens: 10, cost_cents: 5 }),
        record({ model: "m", input_tokens: 20, cost_cents: 7 }),
      ]),
    );

    expect(upserted).toHaveLength(1);
    expect(upserted[0].input_tokens).toBe(30);
    expect(upserted[0].cost_cents).toBe(12);
  });
});
