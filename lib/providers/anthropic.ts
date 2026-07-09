import { isObject, normalizeModel, toNumber, buildDateModelKey } from "@/lib/normalize";
import { allocateCosts, type ProviderUsageRecord } from "@/lib/providers/shared";

export type AnthropicUsageRecord = ProviderUsageRecord;

type AnthropicResponse = {
  data?: unknown[];
  has_more?: boolean;
  next_page?: string | null;
};

const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_DAILY_BUCKET_LIMIT = 31;
const MAX_DAYS_PER_WINDOW = 31;

function toIsoStart(dateString: string): string {
  return `${dateString}T00:00:00Z`;
}

function toIsoEndExclusive(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().replace(".000", "");
}

function addDaysYmd(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * 把日期范围切成 ≤31 天的窗口。limit=31 个 1d bucket 配 31 天窗口,
 * 单窗口必然单页,但分页逻辑仍保留兜底。
 */
function splitIntoDateWindows(startDate: string, endDate: string): Array<{ start: string; end: string }> {
  const windows: Array<{ start: string; end: string }> = [];
  let cursor = startDate;

  while (cursor <= endDate) {
    const windowEnd = addDaysYmd(cursor, MAX_DAYS_PER_WINDOW - 1);
    windows.push({ start: cursor, end: windowEnd < endDate ? windowEnd : endDate });
    cursor = addDaysYmd(windowEnd, 1);
  }

  return windows;
}

function bucketToDate(bucket: Record<string, unknown>): string | null {
  const value = bucket.start_time ?? bucket.starting_at ?? bucket.date;
  if (typeof value === "string" && value.length >= 10) {
    return value.slice(0, 10);
  }

  if (typeof value === "number" && value > 0) {
    return new Date(value * 1000).toISOString().slice(0, 10);
  }

  // 取不到 bucket 日期就跳过,不再 fallback 到“今天”给数据安错日期。
  return null;
}

export function stripAnthropicSnapshotSuffix(model: string): string {
  // Anthropic 模型快照常见后缀:-YYYYMMDD(例如 claude-sonnet-4-5-20250929)。
  return model.replace(/-(20\d{6})$/, "");
}

export function canonicalizeModel(model: string): string {
  return stripAnthropicSnapshotSuffix(model.trim().toLowerCase());
}

export function canonicalizeCostIdentifier(identifier: string): string {
  const normalized = identifier.trim().toLowerCase();

  // cost report 里可能带 input/output/cache 文案,先剥离。
  const withoutSuffix = normalized
    .replace(/^batch api\s*\|\s*/i, "")
    .replace(/\s*,\s*(input|output|cache_read|cache_write|cached input|cached output)$/i, "")
    .replace(/\s+input$/i, "")
    .replace(/\s+output$/i, "")
    .replace(/\s+cache_read$/i, "")
    .replace(/\s+cache_write$/i, "")
    .replace(/\s*-\s*(input|output)\s+tokens$/i, "")
    .replace(/\s+usage$/i, "")
    .trim();

  // Anthropic 常见格式:Claude Opus 4.6 Usage - Input Tokens → claude-opus-4-6。
  const spacedMatch = withoutSuffix.match(/^claude\s+([a-z0-9]+)\s+([0-9.]+)/i);
  if (spacedMatch) {
    const family = spacedMatch[1];
    const version = spacedMatch[2].replace(/\./g, "-");
    return canonicalizeModel(`claude-${family}-${version}`);
  }

  // 优先抽取规范模型 token(如 claude-sonnet-4-5)。
  const match = withoutSuffix.match(/(claude-[a-z0-9-]+)/i);
  if (match) {
    return canonicalizeModel(match[1]);
  }

  // 兜底:把空格/点转成短横线,尽量贴近 usage model 格式。
  const fallback = withoutSuffix.replace(/[.\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return canonicalizeModel(fallback);
}

async function fetchUsageRange(
  apiKey: string,
  startIso: string,
  endIso: string,
): Promise<AnthropicUsageRecord[]> {
  const records: AnthropicUsageRecord[] = [];
  let page: string | undefined;

  while (true) {
    const params = new URLSearchParams({
      starting_at: startIso,
      ending_at: endIso,
      bucket_width: "1d",
      limit: String(MAX_DAILY_BUCKET_LIMIT),
    });
    params.append("group_by[]", "model");

    // 分页参数是 page/next_page(对照官方文档),不是 after_id/next_id。
    if (page) {
      params.set("page", page);
    }

    const response = await fetch(`${ANTHROPIC_BASE_URL}/v1/organizations/usage_report/messages?${params.toString()}`, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic usage API error ${response.status}: ${text}`);
    }

    const payload: unknown = await response.json();
    const typed = isObject(payload) ? (payload as AnthropicResponse) : undefined;
    const buckets = Array.isArray(typed?.data) ? typed.data : [];

    for (const bucket of buckets) {
      if (!isObject(bucket) || !Array.isArray(bucket.results)) {
        continue;
      }

      const date = bucketToDate(bucket);
      if (!date) {
        continue;
      }

      for (const result of bucket.results) {
        if (!isObject(result)) {
          continue;
        }

        const model = normalizeModel(result.model);
        if (model === "unknown") {
          continue;
        }

        // cache_creation / cache_read 计入 input_tokens 是有意为之的简化,
        // 含义与控制台的 input 口径不同(cache read 单价更低),见 README。
        const inputTokens =
          toNumber(result.input_tokens) +
          toNumber(result.cache_creation_input_tokens) +
          toNumber(result.cache_read_input_tokens);
        const outputTokens = toNumber(result.output_tokens);

        records.push({
          date,
          model,
          input_tokens: Math.max(0, Math.round(inputTokens)),
          output_tokens: Math.max(0, Math.round(outputTokens)),
          cost_cents: 0,
        });
      }
    }

    const hasMore = Boolean(typed?.has_more);
    const next = typed?.next_page ?? undefined;

    if (!hasMore || !next) {
      break;
    }

    page = next;
  }

  return records;
}

async function fetchCostRange(
  apiKey: string,
  startIso: string,
  endIso: string,
): Promise<Map<string, number>> {
  // Anthropic cost_report 的 amount 单位是最小货币单位 cents(已对照官方文档)。
  const costs = new Map<string, number>();
  let page: string | undefined;

  while (true) {
    const params = new URLSearchParams({
      starting_at: startIso,
      ending_at: endIso,
      bucket_width: "1d",
      limit: String(MAX_DAILY_BUCKET_LIMIT),
    });
    params.append("group_by[]", "description");

    if (page) {
      params.set("page", page);
    }

    const response = await fetch(`${ANTHROPIC_BASE_URL}/v1/organizations/cost_report?${params.toString()}`, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic cost API error ${response.status}: ${text}`);
    }

    const payload: unknown = await response.json();
    const typed = isObject(payload) ? (payload as AnthropicResponse) : undefined;
    const buckets = Array.isArray(typed?.data) ? typed.data : [];

    for (const bucket of buckets) {
      if (!isObject(bucket) || !Array.isArray(bucket.results)) {
        continue;
      }

      const date = bucketToDate(bucket);
      if (!date) {
        continue;
      }

      for (const result of bucket.results) {
        if (!isObject(result)) {
          continue;
        }

        const rawIdentifier = String(result.model ?? result.description ?? result.line_item ?? "");
        const canonical = canonicalizeCostIdentifier(rawIdentifier);
        if (!canonical) {
          continue;
        }

        const amountObj = isObject(result.amount) ? result.amount : {};
        const cents = Math.max(0, toNumber(amountObj.value ?? result.amount));

        const key = buildDateModelKey(date, canonical);
        const previous = costs.get(key) ?? 0;
        costs.set(key, previous + cents);
      }
    }

    const hasMore = Boolean(typed?.has_more);
    const next = typed?.next_page ?? undefined;

    if (!hasMore || !next) {
      break;
    }

    page = next;
  }

  return costs;
}

export async function fetchAnthropicUsage(
  apiKey: string,
  startDate: string,
  endDate: string,
): Promise<AnthropicUsageRecord[]> {
  // 调用方传入已解密的 API key;provider 层不访问数据库。
  if (startDate > endDate) {
    throw new Error("Invalid date range for Anthropic usage sync");
  }

  // 与 OpenAI 端一致:>31 天的范围切窗口,避免单请求超出 bucket 上限。
  const windows = splitIntoDateWindows(startDate, endDate);

  const usageRecords: AnthropicUsageRecord[] = [];
  const costMapCents = new Map<string, number>();

  for (const window of windows) {
    const startIso = toIsoStart(window.start);
    const endIso = toIsoEndExclusive(window.end);

    const partialUsage = await fetchUsageRange(apiKey, startIso, endIso);
    usageRecords.push(...partialUsage);

    const partialCosts = await fetchCostRange(apiKey, startIso, endIso);
    for (const [key, value] of partialCosts.entries()) {
      costMapCents.set(key, (costMapCents.get(key) ?? 0) + value);
    }
  }

  return allocateCosts(usageRecords, costMapCents, canonicalizeModel);
}

/**
 * 保存 key 时做一次轻量验证:拉 1 天 usage。
 * 在保存时就区分“key 无效”(401)与“非 admin key / 权限不足”(403)。
 */
export async function verifyAnthropicAdminKey(apiKey: string): Promise<{ ok: boolean; message?: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const params = new URLSearchParams({
    starting_at: toIsoStart(addDaysYmd(today, -1)),
    ending_at: toIsoEndExclusive(today),
    bucket_width: "1d",
    limit: "1",
  });

  const response = await fetch(
    `${ANTHROPIC_BASE_URL}/v1/organizations/usage_report/messages?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      cache: "no-store",
    },
  );

  if (response.ok) {
    return { ok: true };
  }

  if (response.status === 401) {
    return { ok: false, message: "Anthropic rejected the key (401): the API key is invalid." };
  }

  if (response.status === 403) {
    return {
      ok: false,
      message:
        "Anthropic rejected the key (403): the key is valid but cannot access org usage reports. An organization admin key (sk-ant-admin...) is required.",
    };
  }

  const text = await response.text();
  return { ok: false, message: `Anthropic key verification failed (${response.status}): ${text.slice(0, 300)}` };
}
