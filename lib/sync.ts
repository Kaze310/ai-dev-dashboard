import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptApiKey } from "@/lib/crypto/api-keys";
import { buildDateModelKey } from "@/lib/normalize";
import { dedupeByDateModel, type ProviderUsageRecord } from "@/lib/providers/shared";
import { createClient } from "@/lib/supabase/server";

type SyncBody = {
  startDate?: string;
  endDate?: string;
};

export type SyncOutcome = {
  status: number;
  body: { synced: number; errors: string[] };
};

const MIN_SYNC_INTERVAL_SECONDS = 60;
const DELETE_CHUNK_SIZE = 200;
const PAGE_SIZE = 1000;
const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type UsageFetcher = (
  apiKey: string,
  startDate: string,
  endDate: string,
) => Promise<ProviderUsageRecord[]>;

function getDefaultDateRange() {
  // 默认拉取最近 30 天。全程 UTC——此前 setDate(本地时区) 与
  // toISOString(UTC) 混用,在时区边界会差一天。
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function addDaysYmd(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// 格式 + 真实性双重校验:2026-02-31 满足正则但会被 Date 归一化成
// 2026-03-03,导致同步范围静默偏移。round-trip 不一致即拒绝。
function isValidYmd(ymd: string): boolean {
  if (!YMD_PATTERN.test(ymd)) {
    return false;
  }

  const date = new Date(`${ymd}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === ymd;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * sync 核心逻辑,supabase client 通过参数注入,便于单测。
 *
 * 限流是原子的:用条件 UPDATE 抢占 last_synced_at
 * (where last_synced_at is null or < now - 60s, returning id),
 * 抢不到返回 429。并发请求只有一个能拿到名额——此前“先读后判断、
 * 成功后才写回”的实现,并发下全部通过检查。
 * 代价:失败的 sync 也消耗 60 秒名额(key 在保存时已验证,可接受)。
 */
export async function runProviderSync(options: {
  supabase: SupabaseClient;
  userId: string;
  providerName: "openai" | "anthropic";
  fetchUsage: UsageFetcher;
  startDate: string;
  endDate: string;
  now?: () => Date;
}): Promise<SyncOutcome> {
  const { supabase, userId, providerName, fetchUsage, startDate, endDate } = options;
  const now = options.now ?? (() => new Date());

  if (!isValidYmd(startDate) || !isValidYmd(endDate) || startDate > endDate) {
    return {
      status: 400,
      body: { synced: 0, errors: ["Invalid date range: expected real YYYY-MM-DD dates with startDate <= endDate."] },
    };
  }

  const { data: provider, error: providerError } = await supabase
    .from("providers")
    .select("id, api_key_encrypted")
    .eq("user_id", userId)
    .eq("name", providerName)
    .maybeSingle();

  if (providerError) {
    return { status: 500, body: { synced: 0, errors: [providerError.message] } };
  }

  if (!provider?.id || !provider.api_key_encrypted) {
    return {
      status: 400,
      body: { synced: 0, errors: [`${providerName} provider key not found. Please save API key first.`] },
    };
  }

  // 原子抢占同步名额。PostgREST 在 PATCH 上使用复合
  // `.or(last_synced_at.is.null,last_synced_at.lt.<cutoff>)` 会生成错误 SQL
  // (`column providers.last_synced_at does not exist`),因此拆成两个条件 UPDATE。
  // 每个 UPDATE 都会在行锁后重新检查条件,并发请求仍只有一个能命中。
  const nowDate = now();
  const cutoffIso = new Date(nowDate.getTime() - MIN_SYNC_INTERVAL_SECONDS * 1000).toISOString();
  const claimPayload = { last_synced_at: nowDate.toISOString() };
  const { data: expiredClaim, error: expiredClaimError } = await supabase
    .from("providers")
    .update(claimPayload)
    .eq("id", provider.id)
    .eq("user_id", userId)
    .lt("last_synced_at", cutoffIso)
    .select("id");

  if (expiredClaimError) {
    return { status: 500, body: { synced: 0, errors: [expiredClaimError.message] } };
  }

  let claimed = expiredClaim ?? [];

  if (claimed.length === 0) {
    const { data: nullClaim, error: nullClaimError } = await supabase
      .from("providers")
      .update(claimPayload)
      .eq("id", provider.id)
      .eq("user_id", userId)
      .is("last_synced_at", null)
      .select("id");

    if (nullClaimError) {
      return { status: 500, body: { synced: 0, errors: [nullClaimError.message] } };
    }

    claimed = nullClaim ?? [];
  }

  if (claimed.length === 0) {
    return {
      status: 429,
      body: { synced: 0, errors: ["Rate limited: a sync for this provider ran within the last minute."] },
    };
  }

  try {
    const decryptedApiKey = decryptApiKey(provider.api_key_encrypted);
    const usage = await fetchUsage(decryptedApiKey, startDate, endDate);

    // upsert 前按冲突键 (date, model) 预聚合,
    // 否则同批重复键会触发 Postgres "cannot affect row a second time"。
    const deduped = dedupeByDateModel(usage).filter(
      (item) => item.model !== "unknown" && item.model !== "",
    );

    const rows = deduped.map((item) => ({
      user_id: userId,
      provider_id: provider.id,
      date: item.date,
      model: item.model,
      input_tokens: item.input_tokens,
      output_tokens: item.output_tokens,
      cost_cents: item.cost_cents,
    }));

    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from("usage_records")
        .upsert(rows, { onConflict: "provider_id,date,model" });

      if (upsertError) {
        return { status: 500, body: { synced: 0, errors: [upsertError.message] } };
      }
    }

    // 清理陈旧行:provider 修正历史数据或上次的 unmatched 合成行
    // 这次匹配成功时,残留旧行会导致重复计费。
    //
    // 清理只作用于“本批数据中出现过的日期”——某个日期 provider 这次
    // 没返回任何数据,就不动那天的本地行。否则 200+空体(provider
    // 数据延迟、故障降级、或用户长期未使用)会把本地历史直接镜像清空。
    // 代价:provider 把某天整体清零的罕见修正不会同步过来,可接受。
    //
    // 所有错误都收集并上抛——此前查询失败被静默 break、删除不检查错误,
    // 数据可能残留却向用户报告成功。
    const errors: string[] = [];
    const batchKeys = new Set(rows.map((row) => buildDateModelKey(row.date, row.model)));
    const batchDates = new Set(rows.map((row) => row.date));
    const staleIds: string[] = [];

    // 空批次没有可清理的日期,直接跳过扫描。
    for (let offset = 0; rows.length > 0; offset += PAGE_SIZE) {
      const { data: existingRows, error: existingError } = await supabase
        .from("usage_records")
        .select("id, date, model")
        .eq("user_id", userId)
        .eq("provider_id", provider.id)
        .gte("date", startDate)
        .lt("date", addDaysYmd(endDate, 1))
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (existingError) {
        errors.push(`Stale-row scan failed: ${existingError.message}`);
        break;
      }

      for (const row of existingRows ?? []) {
        const rowDate = String(row.date).slice(0, 10);
        if (batchDates.has(rowDate) && !batchKeys.has(buildDateModelKey(rowDate, row.model))) {
          staleIds.push(row.id);
        }
      }

      if (!existingRows || existingRows.length < PAGE_SIZE) {
        break;
      }
    }

    // 分批删除,避免单次 .in() 超出请求长度;每批单独检查错误。
    if (errors.length === 0) {
      for (const ids of chunk(staleIds, DELETE_CHUNK_SIZE)) {
        const { error: deleteError } = await supabase.from("usage_records").delete().in("id", ids);
        if (deleteError) {
          errors.push(`Stale-row delete failed: ${deleteError.message}`);
          break;
        }
      }
    }

    if (errors.length > 0) {
      // upsert 已成功但清理失败:totals 可能包含陈旧行,如实返回 500。
      return { status: 500, body: { synced: rows.length, errors } };
    }

    return { status: 200, body: { synced: rows.length, errors: [] } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 500, body: { synced: 0, errors: [message] } };
  }
}

export async function handleProviderSync(
  request: Request,
  providerName: "openai" | "anthropic",
  fetchUsage: UsageFetcher,
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ synced: 0, errors: ["Unauthorized"] }, { status: 401 });
  }

  let body: SyncBody = {};
  try {
    body = (await request.json()) as SyncBody;
  } catch {
    // body 可选。
  }

  const defaults = getDefaultDateRange();
  const outcome = await runProviderSync({
    supabase,
    userId: user.id,
    providerName,
    fetchUsage,
    startDate: body.startDate ?? defaults.startDate,
    endDate: body.endDate ?? defaults.endDate,
  });

  return NextResponse.json(outcome.body, { status: outcome.status });
}
