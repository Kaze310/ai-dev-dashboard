import { isObject, normalizeModel, toNumber, buildDateModelKey } from "@/lib/normalize";
import { allocateCosts, type ProviderUsageRecord } from "@/lib/providers/shared";

export type OpenAIUsageRecord = ProviderUsageRecord;

type UsageApiResponse = {
  data?: unknown[];
  has_more?: boolean;
  next_page?: string | null;
};

const OPENAI_BASE_URL = "https://api.openai.com";
const MAX_DAYS_PER_REQUEST = 31;
const DAY_SECONDS = 24 * 60 * 60;
const MAX_PAGE_LIMIT = 31;

function isValidModelValue(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim();
  return normalized !== "" && normalized !== "null" && normalized !== "undefined";
}

function unixSecondsToDateString(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function dateToStartUnixSeconds(dateString: string): number {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  return Math.floor(date.getTime() / 1000);
}

function dateToEndUnixSecondsExclusive(dateString: string): number {
  // end_time 用“次日 00:00:00(不含)”,覆盖 endDate 当天完整 24 小时。
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return Math.floor(date.getTime() / 1000);
}

export function stripModelDateSuffix(model: string): string {
  return model.replace(/-(20\d{2}-\d{2}-\d{2})$/, "");
}

export function canonicalizeUsageModel(model: string): string {
  return stripModelDateSuffix(model.toLowerCase());
}

export function canonicalizeCostLineItem(lineItem: string): string {
  const normalized = lineItem.trim().toLowerCase();

  // 常见 line_item 会带 input/output 等后缀,先剥离。
  const withoutSuffix = normalized
    .replace(/\s+(input|output|cached_input|cached_output|cached input|cached output)$/i, "")
    .replace(/\s*\((input|output|cached_input|cached_output|cached input|cached output)\)$/i, "");

  // 提取以 gpt-/o1/o3/o4 开头的模型 token;找不到就回退原值。
  const match = withoutSuffix.match(/(gpt-[a-z0-9.-]+|o[0-9]+(?:-[a-z0-9.-]+)?)/i);
  const token = match ? match[1] : withoutSuffix.split(/\s+/)[0] ?? withoutSuffix;

  return stripModelDateSuffix(token);
}

function parseBucket(bucket: Record<string, unknown>): OpenAIUsageRecord[] {
  const bucketStart = toNumber(bucket.start_time);

  // start_time 缺失时不再 fallback 到“今天”——那等于给数据安错日期。直接跳过。
  if (bucketStart <= 0) {
    return [];
  }

  const date = unixSecondsToDateString(bucketStart);

  if (!Array.isArray(bucket.results)) {
    return [];
  }

  return bucket.results
    .filter(isObject)
    // 过滤聚合/脏数据行:只保留明确字符串模型名。
    .filter((result) => isValidModelValue(result.model))
    .map((result) => {
      const inputTokens = toNumber(result.input_tokens);
      const outputTokens = toNumber(result.output_tokens);

      return {
        date,
        model: normalizeModel(result.model),
        input_tokens: Math.max(0, Math.round(inputTokens)),
        output_tokens: Math.max(0, Math.round(outputTokens)),
        // 花费由 /organization/costs 单独提供,先初始化为 0,后续合并。
        cost_cents: 0,
      };
    });
}

async function fetchUsageRange(
  apiKey: string,
  startTime: number,
  endTime: number,
): Promise<OpenAIUsageRecord[]> {
  const records: OpenAIUsageRecord[] = [];
  let page: string | undefined;

  while (true) {
    const params = new URLSearchParams({
      start_time: String(startTime),
      end_time: String(endTime),
      bucket_width: "1d",
      limit: String(MAX_PAGE_LIMIT),
    });
    // 让 usage 按 model 聚合,否则 model 可能是 null。
    params.append("group_by[]", "model");

    if (page) {
      params.set("page", page);
    }

    const response = await fetch(
      `${OPENAI_BASE_URL}/v1/organization/usage/completions?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${text}`);
    }

    const payload: unknown = await response.json();
    const typed = isObject(payload) ? (payload as UsageApiResponse) : undefined;
    const buckets = Array.isArray(typed?.data) ? typed.data : [];

    for (const bucket of buckets) {
      if (!isObject(bucket)) {
        continue;
      }

      records.push(...parseBucket(bucket));
    }

    const hasMore = Boolean(typed?.has_more);
    const nextPage = typed?.next_page ?? undefined;

    if (!hasMore || !nextPage) {
      break;
    }

    page = nextPage;
  }

  return records;
}

async function fetchCostsRange(
  apiKey: string,
  startTime: number,
  endTime: number,
): Promise<Map<string, number>> {
  // OpenAI costs 的 amount.value 单位是 USD(已对照官方文档),这里转成 cents 累加。
  const costMap = new Map<string, number>();
  let page: string | undefined;

  while (true) {
    const params = new URLSearchParams({
      start_time: String(startTime),
      end_time: String(endTime),
      bucket_width: "1d",
      limit: String(MAX_PAGE_LIMIT),
    });
    params.append("group_by[]", "line_item");

    if (page) {
      params.set("page", page);
    }

    const response = await fetch(`${OPENAI_BASE_URL}/v1/organization/costs?${params.toString()}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI costs API error ${response.status}: ${text}`);
    }

    const payload: unknown = await response.json();
    const typed = isObject(payload) ? (payload as UsageApiResponse) : undefined;
    const buckets = Array.isArray(typed?.data) ? typed.data : [];

    for (const bucket of buckets) {
      if (!isObject(bucket) || !Array.isArray(bucket.results)) {
        continue;
      }

      const bucketStart = toNumber(bucket.start_time);
      if (bucketStart <= 0) {
        continue;
      }
      const date = unixSecondsToDateString(bucketStart);

      for (const result of bucket.results) {
        if (!isObject(result)) {
          continue;
        }

        const lineItem = normalizeModel(result.line_item);
        if (lineItem === "unknown") {
          continue;
        }

        const canonicalModel = canonicalizeCostLineItem(lineItem);
        const amount = isObject(result.amount) ? result.amount : {};
        const usd = Math.max(0, toNumber(amount.value));

        const key = buildDateModelKey(date, canonicalModel);
        const previous = costMap.get(key) ?? 0;
        costMap.set(key, previous + usd * 100);
      }
    }

    const hasMore = Boolean(typed?.has_more);
    const nextPage = typed?.next_page ?? undefined;
    if (!hasMore || !nextPage) {
      break;
    }

    page = nextPage;
  }

  return costMap;
}

function splitIntoUsageWindows(startTime: number, endTime: number): Array<{ start: number; end: number }> {
  const windows: Array<{ start: number; end: number }> = [];
  let cursor = startTime;
  const maxWindowSeconds = MAX_DAYS_PER_REQUEST * DAY_SECONDS;

  while (cursor < endTime) {
    const windowEnd = Math.min(endTime, cursor + maxWindowSeconds);
    windows.push({ start: cursor, end: windowEnd });
    cursor = windowEnd;
  }

  return windows;
}

async function fetchOpenAICosts(
  apiKey: string,
  startDate: string,
  endDate: string,
): Promise<Map<string, number>> {
  const startTime = dateToStartUnixSeconds(startDate);
  const endTime = dateToEndUnixSecondsExclusive(endDate);

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) {
    throw new Error("Invalid date range for OpenAI costs sync");
  }

  const windows = splitIntoUsageWindows(startTime, endTime);
  const merged = new Map<string, number>();

  for (const window of windows) {
    const partial = await fetchCostsRange(apiKey, window.start, window.end);
    for (const [key, value] of partial.entries()) {
      const previous = merged.get(key) ?? 0;
      merged.set(key, previous + value);
    }
  }

  return merged;
}

export async function fetchOpenAIUsage(
  apiKey: string,
  startDate: string,
  endDate: string,
): Promise<OpenAIUsageRecord[]> {
  // 调用方传入已解密的 API key;provider 层不访问数据库。
  const startTime = dateToStartUnixSeconds(startDate);
  const endTime = dateToEndUnixSecondsExclusive(endDate);

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) {
    throw new Error("Invalid date range for OpenAI usage sync");
  }

  const windows = splitIntoUsageWindows(startTime, endTime);
  const allRecords: OpenAIUsageRecord[] = [];

  for (const window of windows) {
    const partial = await fetchUsageRange(apiKey, window.start, window.end);
    allRecords.push(...partial);
  }

  const costMapCents = await fetchOpenAICosts(apiKey, startDate, endDate);

  return allocateCosts(allRecords, costMapCents, canonicalizeUsageModel);
}

/**
 * 保存 key 时做一次轻量验证:拉 1 天 usage。
 * 在保存时就区分“key 无效”(401)与“不是 admin key / 权限不足”(403),
 * 而不是等到 sync 才失败。
 */
export async function verifyOpenAIAdminKey(apiKey: string): Promise<{ ok: boolean; message?: string }> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - DAY_SECONDS;

  const params = new URLSearchParams({
    start_time: String(start),
    end_time: String(end),
    bucket_width: "1d",
    limit: "1",
  });

  const response = await fetch(
    `${OPENAI_BASE_URL}/v1/organization/usage/completions?${params.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    },
  );

  if (response.ok) {
    return { ok: true };
  }

  if (response.status === 401) {
    return { ok: false, message: "OpenAI rejected the key (401): the API key is invalid." };
  }

  if (response.status === 403) {
    return {
      ok: false,
      message:
        "OpenAI rejected the key (403): the key is valid but lacks org-level usage permissions. An Admin API key is required.",
    };
  }

  const text = await response.text();
  return { ok: false, message: `OpenAI key verification failed (${response.status}): ${text.slice(0, 300)}` };
}
