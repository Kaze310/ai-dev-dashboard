import { describe, expect, it } from "vitest";

import { allocateCosts, dedupeByDateModel, type ProviderUsageRecord } from "../shared";

const identity = (model: string) => model;

function record(partial: Partial<ProviderUsageRecord>): ProviderUsageRecord {
  return {
    date: "2026-06-01",
    model: "model-a",
    input_tokens: 0,
    output_tokens: 0,
    cost_cents: 0,
    ...partial,
  };
}

describe("allocateCosts", () => {
  it("assigns full group cost to a single matching record", () => {
    const usage = [record({ input_tokens: 100, output_tokens: 50 })];
    const costs = new Map([["2026-06-01|model-a", 250]]);

    const result = allocateCosts(usage, costs, identity);

    expect(result).toHaveLength(1);
    expect(result[0].cost_cents).toBe(250);
  });

  it("splits cost across records by token share and conserves the total", () => {
    const usage = [
      record({ model: "model-a-v1", input_tokens: 300, output_tokens: 0 }),
      record({ model: "model-a-v2", input_tokens: 100, output_tokens: 0 }),
    ];
    // 两个变体 canonicalize 到同一个组。
    const canonicalize = () => "model-a";
    const costs = new Map([["2026-06-01|model-a", 400]]);

    const result = allocateCosts(usage, costs, canonicalize);

    expect(result[0].cost_cents).toBeCloseTo(300);
    expect(result[1].cost_cents).toBeCloseTo(100);
    const total = result.reduce((sum, r) => sum + r.cost_cents, 0);
    expect(total).toBeCloseTo(400);
  });

  it("splits evenly when all tokens are zero", () => {
    const usage = [record({ model: "a" }), record({ model: "b" })];
    const canonicalize = () => "same";
    const costs = new Map([["2026-06-01|same", 100]]);

    const result = allocateCosts(usage, costs, canonicalize);

    expect(result[0].cost_cents).toBeCloseTo(50);
    expect(result[1].cost_cents).toBeCloseTo(50);
  });

  it("emits synthetic records for unmatched costs instead of dropping them", () => {
    const usage = [record({ model: "model-a", input_tokens: 10 })];
    const costs = new Map([
      ["2026-06-01|model-a", 100],
      ["2026-06-01|web-search", 55], // usage 里不存在的花费项
    ]);

    const result = allocateCosts(usage, costs, identity);

    expect(result).toHaveLength(2);
    const synthetic = result.find((r) => r.model === "web-search");
    expect(synthetic).toBeDefined();
    expect(synthetic?.cost_cents).toBe(55);
    expect(synthetic?.input_tokens).toBe(0);

    // 守恒:输出总成本 === cost map 总成本。
    const total = result.reduce((sum, r) => sum + r.cost_cents, 0);
    expect(total).toBeCloseTo(155);
  });

  it("conserves totals end to end with mixed matched/unmatched groups", () => {
    const usage = [
      record({ model: "m1", input_tokens: 7 }),
      record({ model: "m1", input_tokens: 3, date: "2026-06-02" }),
      record({ model: "m2", input_tokens: 5 }),
    ];
    const costs = new Map([
      ["2026-06-01|m1", 123.45],
      ["2026-06-02|m1", 67.89],
      ["2026-06-01|m2", 11.11],
      ["2026-06-03|other", 99.99],
    ]);

    const result = allocateCosts(usage, costs, identity);
    const total = result.reduce((sum, r) => sum + r.cost_cents, 0);
    const expected = [...costs.values()].reduce((sum, v) => sum + v, 0);

    expect(total).toBeCloseTo(expected);
  });
});

describe("dedupeByDateModel", () => {
  it("merges duplicate (date, model) rows so upsert cannot hit ON CONFLICT twice", () => {
    const records = [
      record({ model: "m", input_tokens: 10, output_tokens: 1, cost_cents: 5 }),
      record({ model: "m", input_tokens: 20, output_tokens: 2, cost_cents: 7 }),
      record({ model: "m", date: "2026-06-02", input_tokens: 1 }),
    ];

    const result = dedupeByDateModel(records);

    expect(result).toHaveLength(2);
    const merged = result.find((r) => r.date === "2026-06-01");
    expect(merged?.input_tokens).toBe(30);
    expect(merged?.output_tokens).toBe(3);
    expect(merged?.cost_cents).toBe(12);
  });

  it("keeps distinct keys untouched", () => {
    const records = [record({ model: "a" }), record({ model: "b" })];
    expect(dedupeByDateModel(records)).toHaveLength(2);
  });
});
