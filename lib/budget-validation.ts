// 预算字段解析。关键区分:字段缺席(missing)≠ 显式 null/空(clear)。
// 此前 `PUT {}` 或只提交阈值时,undefined 被当成 clear 直接删预算。
//
// 语义:
// - missing:字段不在 body 里 → 不改动该字段
// - clear:显式 null 或 ""(仅 limit 支持;threshold 不可清除,给 null 算 invalid)
// - value:合法值
// - invalid:给了但非法 → 400

export type LimitFieldParse =
  | { kind: "missing" }
  | { kind: "clear" }
  | { kind: "value"; cents: number }
  | { kind: "invalid" };

export function parseMonthlyLimitField(body: Record<string, unknown>): LimitFieldParse {
  if (!Object.prototype.hasOwnProperty.call(body, "monthly_limit_cents")) {
    return { kind: "missing" };
  }

  const value = body.monthly_limit_cents;

  if (value === null || value === "") {
    return { kind: "clear" };
  }

  if (typeof value !== "number" && typeof value !== "string") {
    return { kind: "invalid" };
  }

  const parsed = Math.round(typeof value === "number" ? value : Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { kind: "invalid" };
  }

  return { kind: "value", cents: parsed };
}

// 阈值小数(如 99.6)被有意接受并四舍五入到整数百分比:
// 精度损失 ≤0.5%,对告警触发时机无实质影响,拒绝 "85.0" 这类输入
// 反而损害可用性。错误信息与此契约保持一致(不声称只接受整数)。
// 若要改为严格模式,把舍入换成 Number.isInteger 校验即可。
export type ThresholdFieldParse =
  | { kind: "missing" }
  | { kind: "value"; pct: number }
  | { kind: "invalid" };

export function parseThresholdField(body: Record<string, unknown>): ThresholdFieldParse {
  if (!Object.prototype.hasOwnProperty.call(body, "alert_threshold_pct")) {
    return { kind: "missing" };
  }

  const value = body.alert_threshold_pct;

  if (typeof value !== "number" && typeof value !== "string") {
    return { kind: "invalid" };
  }

  const raw = typeof value === "number" ? value : value.trim() === "" ? NaN : Number(value);
  const parsed = Math.round(raw);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
    return { kind: "invalid" };
  }

  return { kind: "value", pct: parsed };
}

export const DEFAULT_ALERT_THRESHOLD_PCT = 80;
