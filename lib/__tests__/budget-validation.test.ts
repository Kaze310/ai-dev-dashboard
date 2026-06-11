import { describe, expect, it } from "vitest";

import { parseMonthlyLimitField, parseThresholdField } from "../budget-validation";

describe("parseMonthlyLimitField", () => {
  it("absent key = missing, NOT clear — PUT {} must not delete the budget", () => {
    expect(parseMonthlyLimitField({})).toEqual({ kind: "missing" });
    expect(parseMonthlyLimitField({ alert_threshold_pct: 90 })).toEqual({ kind: "missing" });
  });

  it("explicit null/empty = clear", () => {
    expect(parseMonthlyLimitField({ monthly_limit_cents: null })).toEqual({ kind: "clear" });
    expect(parseMonthlyLimitField({ monthly_limit_cents: "" })).toEqual({ kind: "clear" });
  });

  it("accepts positive numbers and numeric strings", () => {
    expect(parseMonthlyLimitField({ monthly_limit_cents: 10000 })).toEqual({ kind: "value", cents: 10000 });
    expect(parseMonthlyLimitField({ monthly_limit_cents: "2500" })).toEqual({ kind: "value", cents: 2500 });
    expect(parseMonthlyLimitField({ monthly_limit_cents: 99.6 })).toEqual({ kind: "value", cents: 100 });
  });

  it("rejects negatives, zero, NaN, and garbage instead of clearing", () => {
    expect(parseMonthlyLimitField({ monthly_limit_cents: -5 })).toEqual({ kind: "invalid" });
    expect(parseMonthlyLimitField({ monthly_limit_cents: 0 })).toEqual({ kind: "invalid" });
    expect(parseMonthlyLimitField({ monthly_limit_cents: "abc" })).toEqual({ kind: "invalid" });
    expect(parseMonthlyLimitField({ monthly_limit_cents: NaN })).toEqual({ kind: "invalid" });
    expect(parseMonthlyLimitField({ monthly_limit_cents: {} })).toEqual({ kind: "invalid" });
    expect(parseMonthlyLimitField({ monthly_limit_cents: true })).toEqual({ kind: "invalid" });
  });
});

describe("parseThresholdField", () => {
  it("absent key = missing (leave unchanged)", () => {
    expect(parseThresholdField({})).toEqual({ kind: "missing" });
    expect(parseThresholdField({ monthly_limit_cents: 100 })).toEqual({ kind: "missing" });
  });

  it("accepts 1-100", () => {
    expect(parseThresholdField({ alert_threshold_pct: 1 })).toEqual({ kind: "value", pct: 1 });
    expect(parseThresholdField({ alert_threshold_pct: "95" })).toEqual({ kind: "value", pct: 95 });
    expect(parseThresholdField({ alert_threshold_pct: 100 })).toEqual({ kind: "value", pct: 100 });
  });

  it("rounds decimals — intentional contract, not a bug (flip to Number.isInteger for strict mode)", () => {
    expect(parseThresholdField({ alert_threshold_pct: 1.5 })).toEqual({ kind: "value", pct: 2 });
    expect(parseThresholdField({ alert_threshold_pct: 99.6 })).toEqual({ kind: "value", pct: 100 });
    expect(parseThresholdField({ alert_threshold_pct: "85.0" })).toEqual({ kind: "value", pct: 85 });
    // 舍入后越界仍然越界:100.4 → 100 合法,100.6 → 101 拒绝。
    expect(parseThresholdField({ alert_threshold_pct: 100.6 })).toEqual({ kind: "invalid" });
    expect(parseThresholdField({ alert_threshold_pct: 0.4 })).toEqual({ kind: "invalid" });
  });

  it("rejects out-of-range, null, empty, and non-numeric — threshold cannot be cleared", () => {
    expect(parseThresholdField({ alert_threshold_pct: 0 })).toEqual({ kind: "invalid" });
    expect(parseThresholdField({ alert_threshold_pct: 101 })).toEqual({ kind: "invalid" });
    expect(parseThresholdField({ alert_threshold_pct: -3 })).toEqual({ kind: "invalid" });
    expect(parseThresholdField({ alert_threshold_pct: null })).toEqual({ kind: "invalid" });
    expect(parseThresholdField({ alert_threshold_pct: "" })).toEqual({ kind: "invalid" });
    expect(parseThresholdField({ alert_threshold_pct: "abc" })).toEqual({ kind: "invalid" });
    expect(parseThresholdField({ alert_threshold_pct: {} })).toEqual({ kind: "invalid" });
  });
});
