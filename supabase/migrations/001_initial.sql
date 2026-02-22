create extension if not exists pgcrypto;

create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  api_key_encrypted text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete cascade,
  date date not null,
  model text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_cents integer not null default 0,
  raw_json jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  monthly_limit_cents integer not null,
  alert_threshold_pct integer not null default 80,
  created_at timestamptz not null default now()
);

alter table public.providers enable row level security;
alter table public.usage_records enable row level security;
alter table public.budgets enable row level security;

create policy "providers_select_own" on public.providers
for select using (auth.uid() = user_id);

create policy "providers_insert_own" on public.providers
for insert with check (auth.uid() = user_id);

create policy "providers_update_own" on public.providers
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "providers_delete_own" on public.providers
for delete using (auth.uid() = user_id);

create policy "usage_records_select_own" on public.usage_records
for select using (auth.uid() = user_id);

create policy "usage_records_insert_own" on public.usage_records
for insert with check (auth.uid() = user_id);

create policy "usage_records_update_own" on public.usage_records
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "usage_records_delete_own" on public.usage_records
for delete using (auth.uid() = user_id);

create policy "budgets_select_own" on public.budgets
for select using (auth.uid() = user_id);

create policy "budgets_insert_own" on public.budgets
for insert with check (auth.uid() = user_id);

create policy "budgets_update_own" on public.budgets
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "budgets_delete_own" on public.budgets
for delete using (auth.uid() = user_id);
