-- Target RDS schema. Applied by the project owner on 2026-11-11 (PostgreSQL 18).
-- Live runtime-role isolation tests remain pending; do not reapply to an existing database.
-- Apply ONCE to a dedicated, empty application database, never to Supabase.
-- This file creates structure/permissions only: no data import, user registration,
-- historical cleanup, snapshot publication, login credentials or AWS resources.
-- PostgreSQL 14+ syntax; confirm the selected RDS version before execution.
--
-- Provisioning prerequisites (separate, reviewed operation):
--   dashboard_owner: NOLOGIN migration/object owner; CREATE on schema public
--                    and the target database (for schema app_private).
--   dashboard_runtime: NOLOGIN application permission group.
--   dashboard_showcase: NOLOGIN public-snapshot permission group.
-- All three must be NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION.
-- Run after SET ROLE dashboard_owner through a separate migration connection.
-- Runtime/showcase LOGIN credentials will be provisioned separately, each with
-- only its matching group, no owner membership or elevated/inherited privileges.
-- Never use the RDS administrator credentials as application credentials.

begin;

-- Fail instead of silently accepting missing or privileged pre-existing roles.
do $$
declare
  role_name text;
  role_info record;
begin
  if current_user <> 'dashboard_owner' then
    raise exception 'Run this migration as dashboard_owner in the target database';
  end if;

  foreach role_name in array array[
    'dashboard_owner', 'dashboard_runtime', 'dashboard_showcase'
  ] loop
    select * into role_info from pg_catalog.pg_roles where rolname = role_name;
    if not found then
      raise exception 'Provision role % separately before this migration', role_name;
    end if;
    if role_info.rolcanlogin or role_info.rolsuper or role_info.rolbypassrls
      or role_info.rolcreatedb or role_info.rolcreaterole or role_info.rolreplication then
      raise exception 'Unexpected privileges on role %', role_name;
    end if;
  end loop;

  if pg_catalog.pg_has_role('dashboard_runtime', 'dashboard_owner', 'MEMBER')
    or pg_catalog.pg_has_role('dashboard_showcase', 'dashboard_owner', 'MEMBER')
    or pg_catalog.pg_has_role('dashboard_showcase', 'dashboard_runtime', 'MEMBER')
    or pg_catalog.pg_has_role('dashboard_runtime', 'dashboard_showcase', 'MEMBER') then
    raise exception 'Owner, runtime and showcase permissions must remain separate';
  end if;
end;
$$;

revoke create on schema public from public;
create schema app_private;
revoke all on schema app_private from public;
grant usage on schema public, app_private to dashboard_runtime;
grant usage on schema public to dashboard_showcase;

-- Functions normally grant EXECUTE to PUBLIC. Restrict future functions made
-- by this owner too; explicit revokes below cover the functions in this file.
alter default privileges revoke execute on functions from public;

create table public.app_users (
  id uuid primary key,
  created_at timestamptz not null default now()
);

-- app_users.id IS the Cognito sub from ONE configured user pool. There is no
-- separate business user ID, generated ID default or identity-mapping lookup.
-- Only the migration owner may register a verified Cognito sub in app_users.
-- Before import, confirm the sole source owner and the exact new Cognito sub.
-- Insert that sub into app_users, then rewrite ONLY the approved source owner's
-- user_id in providers, usage_records and budgets while importing into RDS.
-- Preserve the source database; stop if preflight finds any unexpected owner.
-- The old-to-new ID replacement is a one-time migration step, not a runtime map.
-- Do not infer ownership from email or a browser-supplied user_id. Accept JWTs
-- only from the configured pool/client; replacing the pool/account later needs
-- a separately reviewed data-ownership migration.

create table public.providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  name text not null,
  api_key_encrypted text not null,
  created_at timestamptz not null default now(),
  monthly_limit_cents integer default null,
  alert_threshold_pct integer not null default 80,
  last_synced_at timestamptz default null,
  constraint providers_user_id_name_key unique (user_id, name),
  constraint providers_id_user_id_key unique (id, user_id)
);

create table public.usage_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  provider_id uuid not null,
  date date not null,
  model text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_cents numeric not null default 0,
  created_at timestamptz not null default now(),
  constraint usage_records_provider_owner_fkey
    foreign key (provider_id, user_id)
    references public.providers(id, user_id) on delete cascade,
  constraint usage_records_provider_date_model_key unique (provider_id, date, model)
);

-- Preserve fractional cents, business record IDs/timestamps and encrypted keys;
-- only the approved source owner's user_id changes to the new Cognito sub.
-- Preflight must reject mismatched usage/provider owners before data import.
create index usage_records_user_date_idx on public.usage_records (user_id, date);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  monthly_limit_cents integer not null,
  alert_threshold_pct integer not null default 80,
  created_at timestamptz not null default now(),
  constraint budgets_user_id_key unique (user_id)
);

create table public.showcase_snapshots (
  id boolean primary key default true check (id = true),
  generated_at timestamptz not null default now(),
  period_label text not null,
  current_month_cents numeric not null default 0,
  total_tokens bigint not null default 0,
  budget_usage_pct numeric not null default 0,
  provider_totals jsonb not null default '[]'::jsonb,
  model_totals jsonb not null default '[]'::jsonb,
  daily_totals jsonb not null default '[]'::jsonb,
  total_spend_cents numeric not null default 0
);

alter table public.app_users enable row level security;
alter table public.app_users force row level security;
alter table public.providers enable row level security;
alter table public.providers force row level security;
alter table public.usage_records enable row level security;
alter table public.usage_records force row level security;
alter table public.budgets enable row level security;
alter table public.budgets force row level security;
alter table public.showcase_snapshots enable row level security;
alter table public.showcase_snapshots force row level security;

-- FORCE RLS also subjects the owner to policies. These explicit owner policies
-- permit the separately authorized import/user-registration/snapshot work.
create policy app_users_owner on public.app_users
  for all to dashboard_owner using (true) with check (true);
create policy providers_owner on public.providers
  for all to dashboard_owner using (true) with check (true);
create policy usage_records_owner on public.usage_records
  for all to dashboard_owner using (true) with check (true);
create policy budgets_owner on public.budgets
  for all to dashboard_owner using (true) with check (true);
create policy showcase_snapshots_owner on public.showcase_snapshots
  for all to dashboard_owner using (true) with check (true);

create function app_private.current_app_user_id()
returns uuid
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;

-- The helper reads transaction context only; it performs no table lookup.
-- The user table remains the FK parent and can only be read by its own user.
create policy app_users_read_own on public.app_users
  for select to dashboard_runtime
  using (id = (select app_private.current_app_user_id()));

-- Missing/empty context returns NULL and authorizes no rows.
-- Malformed UUID context raises an error rather than falling back to a user.
-- A valid sub absent from app_users has no business rows; foreign keys reject
-- business inserts for it. The runtime role cannot register users itself.
create policy providers_own on public.providers
  for all to dashboard_runtime
  using (user_id = (select app_private.current_app_user_id()))
  with check (user_id = (select app_private.current_app_user_id()));
create policy usage_records_own on public.usage_records
  for all to dashboard_runtime
  using (user_id = (select app_private.current_app_user_id()))
  with check (user_id = (select app_private.current_app_user_id()));
create policy budgets_own on public.budgets
  for all to dashboard_runtime
  using (user_id = (select app_private.current_app_user_id()))
  with check (user_id = (select app_private.current_app_user_id()));

-- Only the approved singleton aggregate is public. Neither application role
-- can insert/update/delete it; there is deliberately no refresh function.
create policy showcase_snapshots_read on public.showcase_snapshots
  for select to dashboard_runtime, dashboard_showcase using (id = true);

create function public.usage_cost_total(p_start date, p_end_exclusive date)
returns numeric
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select coalesce(sum(u.cost_cents), 0)
  from public.usage_records u
  where u.user_id = (select app_private.current_app_user_id())
    and u.date >= p_start and u.date < p_end_exclusive;
$$;

create function public.usage_provider_totals(p_start date, p_end_exclusive date)
returns table (provider_id uuid, total_cents numeric)
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select u.provider_id, coalesce(sum(u.cost_cents), 0) as total_cents
  from public.usage_records u
  where u.user_id = (select app_private.current_app_user_id())
    and u.date >= p_start and u.date < p_end_exclusive
  group by u.provider_id;
$$;

create function public.usage_daily_model_aggregates(p_start date, p_end_exclusive date)
returns table (
  date date, provider_name text, model text,
  input_tokens bigint, output_tokens bigint, cost_cents numeric
)
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select u.date, p.name as provider_name, u.model,
    coalesce(sum(u.input_tokens), 0)::bigint as input_tokens,
    coalesce(sum(u.output_tokens), 0)::bigint as output_tokens,
    coalesce(sum(u.cost_cents), 0) as cost_cents
  from public.usage_records u
  join public.providers p on p.id = u.provider_id and p.user_id = u.user_id
  where u.user_id = (select app_private.current_app_user_id())
    and u.date >= p_start and u.date < p_end_exclusive
  group by u.date, p.name, u.model;
$$;

revoke all on table public.app_users, public.providers, public.usage_records,
  public.budgets, public.showcase_snapshots from public, dashboard_runtime, dashboard_showcase;
grant select (id) on public.app_users to dashboard_runtime;
grant select, insert, update, delete on public.providers, public.usage_records,
  public.budgets to dashboard_runtime;
grant select on public.showcase_snapshots to dashboard_runtime, dashboard_showcase;

revoke all on function app_private.current_app_user_id(),
  public.usage_cost_total(date, date), public.usage_provider_totals(date, date),
  public.usage_daily_model_aggregates(date, date) from public, dashboard_showcase;
grant execute on function app_private.current_app_user_id(),
  public.usage_cost_total(date, date), public.usage_provider_totals(date, date),
  public.usage_daily_model_aggregates(date, date) to dashboard_runtime;

commit;

-- Server integration contract (implemented in lib/auth and lib/db):
-- 1. Validate Cognito JWT signature, the ONE configured pool issuer, audience/
--    client, token use, expiry and sub format BEFORE opening the user transaction.
--    The verified sub is the user_id; never accept user_id from request input.
-- 2. Check out ONE runtime connection, BEGIN, set the identity with a parameter:
--      SELECT set_config('app.user_id', $1, true);
--    $1 is the verified Cognito sub. No identity-mapping SELECT is needed.
-- 3. Perform business queries on THAT connection; COMMIT or ROLLBACK before release.
--    Do not set session-wide identity settings, use pool.query across a transaction,
--    or keep a DB transaction open while calling external provider APIs.
-- 4. Public showcase requests use the separate showcase connection/credentials.
-- This setting is NOT cryptographic proof: SQL-capable runtime credentials can
-- set it. RLS relies on a trusted server and parameterized SQL; it is not
-- protection against a compromised backend or leaked database credentials.
--
-- Deferred RDS verification: migration atomicity; actual login role inheritance;
-- no-context, unregistered-sub and wrong-user reads/writes; two-user isolation;
-- aggregate isolation; register users only through the migration owner;
-- INSERT/UPDATE/DELETE/UPSERT and cross-owner provider references; connection
-- reuse after COMMIT and ROLLBACK; no runtime user/snapshot writes; no public
-- private-data/function access; exact import counts/sums and key decryption;
-- all three imported user_id columns equal the approved new Cognito sub, with
-- no old/unknown owner IDs left and no source database updates.
