export type AnthropicUsageRecord = {
  date: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number;
};

type AnthropicResponse = {
  data?: unknown[];
  has_more?: boolean;
  next_id?: string | null;
  last_id?: string | null;
};

const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_DAILY_BUCKET_LIMIT = 31;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function toIsoStart(dateString: string): string {
  return `${dateString}T00:00:00Z`;
}

function toIsoEndExclusive(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().replace(".000", "");
}

function bucketToDate(bucket: Record<string, unknown>): string {
  const value = bucket.start_time ?? bucket.starting_at ?? bucket.date;
  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  if (typeof value === "number") {
    return new Date(value * 1000).toISOString().slice(0, 10);
  }

  return new Date().toISOString().slice(0, 10);
}

function stripAnthropicSnapshotSuffix(model: string): string {
  // Anthropic 模型快照常见后缀：-YYYYMMDD（例如 claude-sonnet-4-5-20250929）。
  return model.replace(/-(20\d{6})$/, "");
}

function canonicalizeModel(model: string): string {
  return stripAnthropicSnapshotSuffix(model.trim().toLowerCase());
}

function canonicalizeCostIdentifier(identifier: string): string {
  const normalized = identifier.trim().toLowerCase();

  // cost report 里可能带 input/output/cache 文案，先剥离。
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

  // Anthropic 常见格式：Claude Opus 4.6 Usage - Input Tokens
  // 统一转为 claude-opus-4-6，便于和 usage model 对齐。
  const spacedMatch = withoutSuffix.match(/^claude\s+([a-z0-9]+)\s+([0-9.]+)/i);
  if (spacedMatch) {
    const family = spacedMatch[1];
    const version = spacedMatch[2].replace(/\./g, "-");
    return canonicalizeModel(`claude-${family}-${version}`);
  }

  // 优先抽取规范模型 token（如 claude-sonnet-4-5）。
  const match = withoutSuffix.match(/(claude-[a-z0-9-]+)/i);
  if (match) {
    return canonicalizeModel(match[1]);
  }

  // 兜底：把空格/点转成短横线，尽量贴近 usage model 格式。
  const fallback = withoutSuffix.replace(/[.\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return canonicalizeModel(fallback);
}

function buildKey(date: string, model: string): string {
  return `${date}|${model}`;
}

async function fetchUsageRange(
  apiKey: string,
  startIso: string,
  endIso: string,
): Promise<AnthropicUsageRecord[]> {
  const records: AnthropicUsageRecord[] = [];
  let cursor: string | undefined;

  while (true) {
    const params = new URLSearchParams({
      starting_at: startIso,
      ending_at: endIso,
      bucket_width: "1d",
      limit: String(MAX_DAILY_BUCKET_LIMIT),
    });
    params.append("group_by[]", "model");

    if (cursor) {
      params.set("after_id", cursor);
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
      let bucketModelRows = 0;

      for (const result of bucket.results) {
        if (!isObject(result)) {
          continue;
        }

        const model = normalizeModel(result.model);
        if (model === "unknown") {
          continue;
        }
        bucketModelRows += 1;
        // 临时诊断：确认 usage_report 当天是否真的返回了按模型拆分的数据行。
        console.log(`[anthropic-usage-raw] date=${date} model=${JSON.stringify(model)}`);

        // Anthropic usage_report/messages 常见字段包含 input/output 与 cache tokens。
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

      // 临时诊断：每个日期 bucket 命中了多少条模型行。
      console.log(`[anthropic-usage-bucket] date=${date} model_rows=${bucketModelRows}`);
    }

    const hasMore = Boolean(typed?.has_more);
    const next = typed?.next_id ?? typed?.last_id ?? undefined;

    if (!hasMore || !next) {
      break;
    }

    cursor = next;
  }

  return records;
}

async function fetchCostRange(
  apiKey: string,
  startIso: string,
  endIso: string,
): Promise<Map<string, number>> {
  // 这里 value 先存 USD 浮点，最后合并到记录时再换算 cents。
  const costs = new Map<string, number>();
  let cursor: string | undefined;

  while (true) {
    const params = new URLSearchParams({
      starting_at: startIso,
      ending_at: endIso,
      bucket_width: "1d",
      limit: String(MAX_DAILY_BUCKET_LIMIT),
    });
    params.append("group_by[]", "description");

    if (cursor) {
      params.set("after_id", cursor);
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
      let bucketCostRows = 0;

      for (const result of bucket.results) {
        if (!isObject(result)) {
          continue;
        }

        const rawIdentifier = String(result.model ?? result.description ?? result.line_item ?? "");
        const canonical = canonicalizeCostIdentifier(rawIdentifier);
        if (!canonical) {
          continue;
        }
        bucketCostRows += 1;
        // 临时诊断：确认 cost_report 当天返回的原始 description / line_item。
        console.log(
          `[anthropic-cost-raw] date=${date} description=${JSON.stringify(result.description)} line_item=${JSON.stringify(result.line_item)} canonical=${canonical}`,
        );

        const amountObj = isObject(result.amount) ? result.amount : {};
        // Anthropic 文档说明 amount.value 以最小单位（cents）给出，这里先按 cents 浮点累加。
        const cents = Math.max(0, toNumber(amountObj.value ?? result.amount));

        const key = buildKey(date, canonical);
        const previous = costs.get(key) ?? 0;
        costs.set(key, previous + cents);
      }

      // 临时诊断：每个日期 bucket 命中了多少条成本行。
      console.log(`[anthropic-cost-bucket] date=${date} cost_rows=${bucketCostRows}`);
    }

    const hasMore = Boolean(typed?.has_more);
    const next = typed?.next_id ?? typed?.last_id ?? undefined;

    if (!hasMore || !next) {
      break;
    }

    cursor = next;
  }

  return costs;
}

export async function fetchAnthropicUsage(
  apiKey: string,
  startDate: string,
  endDate: string,
): Promise<AnthropicUsageRecord[]> {
  const startIso = toIsoStart(startDate);
  const endIso = toIsoEndExclusive(endDate);

  const usageRecords = await fetchUsageRange(apiKey, startIso, endIso);
  const costMap = await fetchCostRange(apiKey, startIso, endIso);

  const groups = new Map<string, number[]>();
  usageRecords.forEach((record, index) => {
    const key = buildKey(record.date, canonicalizeModel(record.model));
    const existing = groups.get(key) ?? [];
    existing.push(index);
    groups.set(key, existing);
  });

  const costByIndex = new Map<number, number>();
  let matchedGroupCostCents = 0;

  for (const [groupKey, indexes] of groups.entries()) {
    const groupCostCents = costMap.get(groupKey) ?? 0;
    if (groupCostCents <= 0) {
      continue;
    }

    matchedGroupCostCents += groupCostCents;

    const totalGroupCents = Math.max(0, Math.round(groupCostCents));

    if (indexes.length === 1) {
      costByIndex.set(indexes[0], totalGroupCents);
      continue;
    }

    const tokens = indexes.map((index) => {
      const record = usageRecords[index];
      return Math.max(0, record.input_tokens + record.output_tokens);
    });
    const totalTokens = tokens.reduce((sum, value) => sum + value, 0);

    if (totalTokens <= 0) {
      const evenCents = groupCostCents / indexes.length;
      let assignedCents = 0;

      for (let i = 0; i < indexes.length; i += 1) {
        const index = indexes[i];
        if (i === indexes.length - 1) {
          costByIndex.set(index, Math.max(0, totalGroupCents - assignedCents));
          continue;
        }

        const shareCents = Math.max(0, Math.round(evenCents));
        costByIndex.set(index, shareCents);
        assignedCents += shareCents;
      }

      continue;
    }

    let assignedCents = 0;

    for (let i = 0; i < indexes.length; i += 1) {
      const index = indexes[i];
      if (i === indexes.length - 1) {
        costByIndex.set(index, Math.max(0, totalGroupCents - assignedCents));
        continue;
      }

      const shareCentsFloat = (tokens[i] / totalTokens) * groupCostCents;
      const shareCents = Math.max(0, Math.round(shareCentsFloat));
      costByIndex.set(index, shareCents);
      assignedCents += shareCents;
    }
  }

  // 临时诊断：核对成本映射覆盖率，定位“总额偏低”来源。
  const totalCostMapCents = [...costMap.values()].reduce((sum, value) => sum + value, 0);
  const unmatchedCostEntries = [...costMap.entries()].filter(([key]) => !groups.has(key));
  const unmatchedCostCents = unmatchedCostEntries.reduce((sum, [, value]) => sum + value, 0);

  console.log(
    `[anthropic-cost-coverage] range=${startDate}..${endDate} total=${totalCostMapCents.toFixed(2)} matched=${matchedGroupCostCents.toFixed(2)} unmatched=${unmatchedCostCents.toFixed(2)}`,
  );
  console.log(
    `[anthropic-cost-coverage] groups usage=${groups.size} cost=${costMap.size} unmatched_entries=${unmatchedCostEntries.length}`,
  );
  for (const [key, value] of unmatchedCostEntries.slice(0, 20)) {
    console.log(`[anthropic-cost-unmatched] ${key} => ${value.toFixed(2)} cents`);
  }

  return usageRecords.map((record, index) => ({
    ...record,
    cost_cents: costByIndex.get(index) ?? 0,
  }));
}
