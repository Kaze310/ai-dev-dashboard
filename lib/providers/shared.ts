import { buildDateModelKey } from "@/lib/normalize";

export type ProviderUsageRecord = {
  date: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number;
};

/**
 * 把 cost report 的金额分配到 usage 记录上,并保证成本守恒:
 * sum(返回记录的 cost_cents) === sum(costMapCents)。
 *
 * - 同组单条记录:全额分配。
 * - 同组多条:按 token 占比分摊(token 全为 0 时均分),不做行级 round,
 *   存储列为 numeric,展示层再格式化。
 * - 匹配不到任何 usage 组的成本(非 completions/messages 的花费、
 *   canonicalize 未覆盖的模型名)不再丢弃,落成 tokens=0 的合成记录,
 *   model 用 canonical line item 名。否则 dashboard 会系统性低于真实账单。
 */
export function allocateCosts(
  usageRecords: ProviderUsageRecord[],
  costMapCents: Map<string, number>,
  canonicalizeUsageModel: (model: string) => string,
): ProviderUsageRecord[] {
  const groups = new Map<string, number[]>();

  usageRecords.forEach((record, index) => {
    const key = buildDateModelKey(record.date, canonicalizeUsageModel(record.model));
    const existing = groups.get(key) ?? [];
    existing.push(index);
    groups.set(key, existing);
  });

  const costByIndex = new Map<number, number>();

  for (const [key, indexes] of groups.entries()) {
    const groupCostCents = costMapCents.get(key) ?? 0;
    if (groupCostCents <= 0) {
      continue;
    }

    if (indexes.length === 1) {
      costByIndex.set(indexes[0], groupCostCents);
      continue;
    }

    const tokens = indexes.map((index) => {
      const record = usageRecords[index];
      return Math.max(0, record.input_tokens + record.output_tokens);
    });
    const totalTokens = tokens.reduce((sum, value) => sum + value, 0);

    for (let i = 0; i < indexes.length; i += 1) {
      const share =
        totalTokens > 0 ? (tokens[i] / totalTokens) * groupCostCents : groupCostCents / indexes.length;
      costByIndex.set(indexes[i], share);
    }
  }

  const allocated = usageRecords.map((record, index) => ({
    ...record,
    cost_cents: costByIndex.get(index) ?? 0,
  }));

  // 成本守恒:unmatched 成本落成合成记录,而不是静默消失。
  for (const [key, cents] of costMapCents.entries()) {
    if (cents <= 0 || groups.has(key)) {
      continue;
    }

    const separator = key.indexOf("|");
    const date = key.slice(0, separator);
    const model = key.slice(separator + 1) || "unknown";

    allocated.push({
      date,
      model,
      input_tokens: 0,
      output_tokens: 0,
      cost_cents: cents,
    });
  }

  return allocated;
}

/**
 * upsert 前按 (date, model) 预聚合。
 * 同批 rows 内出现重复冲突键时 Postgres 会直接报
 * "ON CONFLICT DO UPDATE command cannot affect row a second time",
 * 之前依赖 provider API 恰好每天每模型返回一行,是侥幸而非保证。
 */
export function dedupeByDateModel(records: ProviderUsageRecord[]): ProviderUsageRecord[] {
  const merged = new Map<string, ProviderUsageRecord>();

  for (const record of records) {
    const key = buildDateModelKey(record.date, record.model);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { ...record });
      continue;
    }

    existing.input_tokens += record.input_tokens;
    existing.output_tokens += record.output_tokens;
    existing.cost_cents += record.cost_cents;
  }

  return [...merged.values()];
}
