export type OpenAIUsageRecord = {
  date: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number;
};

type UsageApiResponse = {
  data?: unknown[];
  results?: unknown[];
  usage?: unknown[];
  has_more?: boolean;
  next_page?: string | null;
  next?: string | null;
};

const OPENAI_BASE_URL = "https://api.openai.com";
const DEFAULT_PAGE_LIMIT = 100;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toDateString(value: unknown): string {
  // 统一把日期转成 YYYY-MM-DD，方便数据库按天统计与去重。
  if (typeof value === "string") {
    // 兼容已经是 YYYY-MM-DD 或 ISO 时间字符串。
    return value.length >= 10 ? value.slice(0, 10) : value;
  }

  if (typeof value === "number") {
    // 一些接口会返回 Unix 秒时间戳。
    return new Date(value * 1000).toISOString().slice(0, 10);
  }

  return new Date().toISOString().slice(0, 10);
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

function toCostCents(item: Record<string, unknown>): number {
  // 优先读取明确的 cents 字段。
  if (typeof item.cost_cents === "number") {
    return Math.max(0, Math.round(item.cost_cents));
  }

  // 兼容常见美元字段（例如 total_cost / cost / amount_usd）。
  const usdCandidate =
    toNumber(item.total_cost) ||
    toNumber(item.cost) ||
    toNumber(item.amount_usd) ||
    toNumber(item.usd);

  return Math.max(0, Math.round(usdCandidate * 100));
}

function parseSingleUsageItem(item: Record<string, unknown>): OpenAIUsageRecord[] {
  // 一些响应是按“天 bucket + results[]”嵌套，先展开 results。
  if (Array.isArray(item.results)) {
    const bucketDate = toDateString(item.date ?? item.start_time ?? item.timestamp);

    return item.results
      .filter(isObject)
      .map((result) => {
        const inputTokens =
          toNumber(result.input_tokens) ||
          toNumber(result.prompt_tokens) ||
          toNumber(result.n_context_tokens_total);

        const outputTokens =
          toNumber(result.output_tokens) ||
          toNumber(result.completion_tokens) ||
          toNumber(result.n_generated_tokens_total);

        return {
          date: bucketDate,
          model: String(result.model ?? result.model_name ?? "unknown"),
          input_tokens: Math.max(0, Math.round(inputTokens)),
          output_tokens: Math.max(0, Math.round(outputTokens)),
          cost_cents: toCostCents(result),
        };
      });
  }

  const inputTokens =
    toNumber(item.input_tokens) ||
    toNumber(item.prompt_tokens) ||
    toNumber(item.n_context_tokens_total);

  const outputTokens =
    toNumber(item.output_tokens) ||
    toNumber(item.completion_tokens) ||
    toNumber(item.n_generated_tokens_total);

  return [
    {
      date: toDateString(item.date ?? item.start_time ?? item.timestamp),
      model: String(item.model ?? item.model_name ?? "unknown"),
      input_tokens: Math.max(0, Math.round(inputTokens)),
      output_tokens: Math.max(0, Math.round(outputTokens)),
      cost_cents: toCostCents(item),
    },
  ];
}

function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isObject(payload)) {
    return [];
  }

  const typed = payload as UsageApiResponse;

  if (Array.isArray(typed.data)) {
    return typed.data;
  }

  if (Array.isArray(typed.results)) {
    return typed.results;
  }

  if (Array.isArray(typed.usage)) {
    return typed.usage;
  }

  return [];
}

async function fetchUsageFromPath(
  apiKey: string,
  path: string,
  startDate: string,
  endDate: string,
): Promise<OpenAIUsageRecord[]> {
  const records: OpenAIUsageRecord[] = [];
  let page: string | undefined;

  while (true) {
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      limit: String(DEFAULT_PAGE_LIMIT),
    });

    if (page) {
      params.set("page", page);
    }

    const response = await fetch(`${OPENAI_BASE_URL}${path}?${params.toString()}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${text}`);
    }

    const payload: unknown = await response.json();
    const items = extractItems(payload);

    for (const item of items) {
      if (!isObject(item)) {
        continue;
      }

      records.push(...parseSingleUsageItem(item));
    }

    // 兼容不同接口返回的分页字段。
    const typed = isObject(payload) ? (payload as UsageApiResponse) : undefined;
    const nextPage = typed?.next_page ?? typed?.next ?? undefined;
    const hasMore = Boolean(typed?.has_more);

    if (!hasMore || !nextPage) {
      break;
    }

    page = nextPage;
  }

  return records;
}

export async function fetchOpenAIUsage(
  apiKey: string,
  startDate: string,
  endDate: string,
): Promise<OpenAIUsageRecord[]> {
  // 某些 key 只支持 organization usage；某些环境可能仍是 /v1/usage。
  const candidatePaths = ["/v1/organization/usage", "/v1/usage"];
  const errors: string[] = [];

  for (const path of candidatePaths) {
    try {
      return await fetchUsageFromPath(apiKey, path, startDate, endDate);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${path}: ${message}`);
    }
  }

  throw new Error(`Failed to fetch OpenAI usage from all endpoints. ${errors.join(" | ")}`);
}
