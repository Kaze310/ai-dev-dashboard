export type OpenAIUsageRecord = {
  date: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number;
};

type UsageApiResponse = {
  data?: unknown[];
  has_more?: boolean;
  next_page?: string | null;
};

const OPENAI_BASE_URL = "https://api.openai.com";
const MAX_DAYS_PER_REQUEST = 31;
const DAY_SECONDS = 24 * 60 * 60;
const MAX_PAGE_LIMIT = 31;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeModel(value: unknown): string {
  if (typeof value !== "string") {
    return "unknown";
  }

  const normalized = value.trim();
  if (!normalized || normalized === "null" || normalized === "undefined") {
    return "unknown";
  }

  return normalized;
}

function isValidModelValue(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim();
  return normalized !== "" && normalized !== "null" && normalized !== "undefined";
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function unixSecondsToDateString(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function dateToStartUnixSeconds(dateString: string): number {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  return Math.floor(date.getTime() / 1000);
}

function dateToEndUnixSecondsExclusive(dateString: string): number {
  // end_time 用“次日 00:00:00（不含）”，这样可以覆盖 endDate 当天完整 24 小时。
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return Math.floor(date.getTime() / 1000);
}

function buildCostKey(date: string, model: string): string {
  return `${date}|${model}`;
}

function stripModelDateSuffix(model: string): string {
  return model.replace(/-(20\d{2}-\d{2}-\d{2})$/, "");
}

function canonicalizeUsageModel(model: string): string {
  return stripModelDateSuffix(model.toLowerCase());
}

function canonicalizeCostLineItem(lineItem: string): string {
  const normalized = lineItem.trim().toLowerCase();

  // 常见 line_item 会带 input/output 等后缀，先剥离。
  const withoutSuffix = normalized
    .replace(/\s+(input|output|cached_input|cached_output|cached input|cached output)$/i, "")
    .replace(/\s*\((input|output|cached_input|cached_output|cached input|cached output)\)$/i, "");

  // 提取以 gpt-/o1/o3/o4 开头的模型 token；找不到就回退原值。
  const match = withoutSuffix.match(/(gpt-[a-z0-9.-]+|o[0-9]+(?:-[a-z0-9.-]+)?)/i);
  const token = match ? match[1] : withoutSuffix.split(/\s+/)[0] ?? withoutSuffix;

  return stripModelDateSuffix(token);
}

function parseBucket(bucket: Record<string, unknown>): OpenAIUsageRecord[] {
  const bucketStart = toNumber(bucket.start_time);
  const date = unixSecondsToDateString(bucketStart || Math.floor(Date.now() / 1000));

  if (!Array.isArray(bucket.results)) {
    return [];
  }

  return bucket.results
    .filter(isObject)
    // 过滤聚合/脏数据行：只保留明确字符串模型名。
    .filter((result) => isValidModelValue(result.model))
    .map((result) => {
      // 官方 usage/completions 里常见字段：input_tokens、output_tokens、model。
      const inputTokens = toNumber(result.input_tokens);
      const outputTokens = toNumber(result.output_tokens);

      return {
        date,
        model: normalizeModel(result.model),
        input_tokens: Math.max(0, Math.round(inputTokens)),
        output_tokens: Math.max(0, Math.round(outputTokens)),
        // 花费由 /organization/costs 单独提供，先初始化为 0，后续再合并。
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
    // 关键修复：让 usage 按 model 聚合，否则 model 可能是 null。
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
  // 这里的 map value 用 USD 浮点累加，最后分配给记录时再统一换算成 cents。
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
      const date = unixSecondsToDateString(bucketStart || Math.floor(Date.now() / 1000));

      for (const result of bucket.results) {
        if (!isObject(result)) {
          continue;
        }

        const model = normalizeModel(result.line_item);
        if (model === "unknown") {
          continue;
        }

        const canonicalModel = canonicalizeCostLineItem(model);
        const amount = isObject(result.amount) ? result.amount : {};
        const usd = Math.max(0, toNumber(amount.value));

        const key = buildCostKey(date, canonicalModel);
        const previous = costMap.get(key) ?? 0;
        costMap.set(key, previous + usd);
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

  const costMap = await fetchOpenAICosts(apiKey, startDate, endDate);
  const costByRecordIndex = new Map<number, number>();
  const groups = new Map<string, number[]>();

  // 先按“日期 + 规范化模型名”分组。
  allRecords.forEach((record, index) => {
    const canonicalModel = canonicalizeUsageModel(record.model);
    const groupKey = buildCostKey(record.date, canonicalModel);
    const existing = groups.get(groupKey) ?? [];
    existing.push(index);
    groups.set(groupKey, existing);
  });

  // 按组分配成本：单条就全给；多条则按 token 占比分摊，避免重复记账。
  for (const [groupKey, recordIndexes] of groups.entries()) {
    const groupCostUsd = costMap.get(groupKey) ?? 0;
    if (groupCostUsd <= 0) {
      continue;
    }

    if (recordIndexes.length === 1) {
      costByRecordIndex.set(recordIndexes[0], Math.max(0, Math.round(groupCostUsd * 100)));
      continue;
    }

    const tokens = recordIndexes.map((idx) => {
      const record = allRecords[idx];
      return Math.max(0, record.input_tokens + record.output_tokens);
    });
    const totalTokens = tokens.reduce((sum, value) => sum + value, 0);
    const totalGroupCents = Math.max(0, Math.round(groupCostUsd * 100));

    if (totalTokens <= 0) {
      const equalShareUsd = groupCostUsd / recordIndexes.length;
      let assigned = 0;
      for (let i = 0; i < recordIndexes.length; i += 1) {
        const idx = recordIndexes[i];
        if (i === recordIndexes.length - 1) {
          costByRecordIndex.set(idx, Math.max(0, totalGroupCents - assigned));
          continue;
        }

        const shareCents = Math.max(0, Math.round(equalShareUsd * 100));
        costByRecordIndex.set(idx, shareCents);
        assigned += shareCents;
      }
      continue;
    }

    let assignedCents = 0;
    for (let i = 0; i < recordIndexes.length; i += 1) {
      const idx = recordIndexes[i];
      if (i === recordIndexes.length - 1) {
        costByRecordIndex.set(idx, Math.max(0, totalGroupCents - assignedCents));
        continue;
      }

      const shareUsd = (tokens[i] / totalTokens) * groupCostUsd;
      const shareCents = Math.max(0, Math.round(shareUsd * 100));
      costByRecordIndex.set(idx, shareCents);
      assignedCents += shareCents;
    }
  }

  return allRecords.map((record, index) => ({
    ...record,
    cost_cents: costByRecordIndex.get(index) ?? 0,
  }));
}
