-- 004: correctness fixes (2026-06-10)
--
-- 1) cost_cents integer -> numeric: 行级 round 会把 <0.5 cent 归零并累计长尾误差,
--    改为 numeric 存分数 cents,展示层再格式化。
-- 2) 汇总下推数据库:PostgREST 默认 max-rows 1000,select 原始行再在 JS 求和会被
--    静默截断(YTD 必然超限)。改用 security invoker 的 SQL 函数,RLS 仍生效。
-- 3) providers.last_synced_at:sync 端点最小频控。
-- 4) 一次性清理历史 unknown 模型行,sync 路径中移除补丁式 delete。
-- 5) 删除 raw_json:其内容只是处理后记录的副本,无对账价值。

-- (1) cost precision
alter table public.usage_records
  alter column cost_cents type numeric using cost_cents::numeric;

-- (3) sync rate limiting
alter table public.providers
  add column if not exists last_synced_at timestamptz default null;

-- (4) one-off cleanup of legacy dirty rows
delete from public.usage_records
where model in ('unknown', 'UNKNOWN', 'Unknown', '');

-- (5) drop redundant column
alter table public.usage_records drop column if exists raw_json;

-- (2) aggregate RPCs — security invoker so RLS applies to the calling user.

create or replace function public.usage_cost_total(p_start date, p_end_exclusive date)
returns numeric
language sql
security invoker
set search_path = public
as $$
  select coalesce(sum(cost_cents), 0)
  from public.usage_records
  where user_id = auth.uid()
    and date >= p_start
    and date < p_end_exclusive;
$$;

create or replace function public.usage_provider_totals(p_start date, p_end_exclusive date)
returns table (provider_id uuid, total_cents numeric)
language sql
security invoker
set search_path = public
as $$
  select provider_id, coalesce(sum(cost_cents), 0) as total_cents
  from public.usage_records
  where user_id = auth.uid()
    and date >= p_start
    and date < p_end_exclusive
  group by provider_id;
$$;

create or replace function public.usage_daily_model_aggregates(p_start date, p_end_exclusive date)
returns table (
  date date,
  provider_name text,
  model text,
  input_tokens bigint,
  output_tokens bigint,
  cost_cents numeric
)
language sql
security invoker
set search_path = public
as $$
  select
    u.date,
    p.name as provider_name,
    u.model,
    coalesce(sum(u.input_tokens), 0)::bigint as input_tokens,
    coalesce(sum(u.output_tokens), 0)::bigint as output_tokens,
    coalesce(sum(u.cost_cents), 0) as cost_cents
  from public.usage_records u
  join public.providers p on p.id = u.provider_id
  where u.user_id = auth.uid()
    and u.date >= p_start
    and u.date < p_end_exclusive
  group by u.date, p.name, u.model;
$$;
