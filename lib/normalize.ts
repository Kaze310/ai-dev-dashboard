// 共享的解析/规范化工具,此前在 providers 与多个 route 中重复实现。

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export function normalizeModel(value: unknown): string {
  if (typeof value !== "string") {
    return "unknown";
  }

  const normalized = value.trim();
  if (!normalized || normalized === "null" || normalized === "undefined") {
    return "unknown";
  }

  return normalized;
}

export function buildDateModelKey(date: string, model: string): string {
  return `${date}|${model}`;
}
