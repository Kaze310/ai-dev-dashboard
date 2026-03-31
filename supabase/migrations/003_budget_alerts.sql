-- providers 增加每个 provider 的预算配置（可为空表示未设置）。
alter table public.providers
add column if not exists monthly_limit_cents integer default null;

alter table public.providers
add column if not exists alert_threshold_pct integer not null default 80;

-- 每个用户最多一条全局预算记录，便于 upsert(user_id)。
create unique index if not exists budgets_user_id_key
on public.budgets (user_id);
