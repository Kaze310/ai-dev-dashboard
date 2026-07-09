-- Public showcase data is an explicitly curated aggregate, not a public view of
-- usage_records, providers, or budgets.
create table if not exists public.showcase_snapshots (
  id boolean primary key default true check (id = true),
  generated_at timestamptz not null default now(),
  period_label text not null,
  current_month_cents numeric not null default 0,
  total_tokens bigint not null default 0,
  budget_usage_pct numeric not null default 0,
  provider_totals jsonb not null default '[]'::jsonb,
  model_totals jsonb not null default '[]'::jsonb,
  daily_totals jsonb not null default '[]'::jsonb
);

alter table public.showcase_snapshots enable row level security;

drop policy if exists "showcase_snapshots_public_read" on public.showcase_snapshots;
create policy "showcase_snapshots_public_read" on public.showcase_snapshots
for select to anon, authenticated
using (id = true);

drop policy if exists "showcase_snapshots_authenticated_insert" on public.showcase_snapshots;
create policy "showcase_snapshots_authenticated_insert" on public.showcase_snapshots
for insert to authenticated
with check (id = true);

drop policy if exists "showcase_snapshots_authenticated_update" on public.showcase_snapshots;
create policy "showcase_snapshots_authenticated_update" on public.showcase_snapshots
for update to authenticated
using (id = true)
with check (id = true);

create or replace function public.refresh_showcase_snapshot()
returns public.showcase_snapshots
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := current_date;
  v_month_start date := date_trunc('month', current_date)::date;
  v_month_end date := (date_trunc('month', current_date) + interval '1 month')::date;
  v_current_month numeric := 0;
  v_total_tokens bigint := 0;
  v_budget_usage_pct numeric := 0;
  v_provider_totals jsonb := '[]'::jsonb;
  v_model_totals jsonb := '[]'::jsonb;
  v_daily_totals jsonb := '[]'::jsonb;
  v_snapshot public.showcase_snapshots;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select
    coalesce(sum(cost_cents), 0),
    coalesce(sum(input_tokens + output_tokens), 0)::bigint
  into v_current_month, v_total_tokens
  from public.usage_records
  where user_id = v_user_id
    and date >= v_month_start
    and date < v_month_end;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', case lower(provider_totals.name)
          when 'openai' then 'OpenAI'
          when 'anthropic' then 'Anthropic'
          else 'Other'
        end,
        'costCents', provider_totals.total_cents
      )
      order by provider_totals.total_cents desc
    ),
    '[]'::jsonb
  )
  into v_provider_totals
  from (
    select p.name, sum(u.cost_cents) as total_cents
    from public.usage_records u
    join public.providers p on p.id = u.provider_id
    where u.user_id = v_user_id
      and u.date >= v_month_start
      and u.date < v_month_end
    group by p.name
  ) provider_totals;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('model', model_totals.model, 'costCents', model_totals.total_cents)
      order by model_totals.total_cents desc
    ),
    '[]'::jsonb
  )
  into v_model_totals
  from (
    select model, sum(cost_cents) as total_cents
    from public.usage_records
    where user_id = v_user_id
      and date >= v_month_start
      and date < v_month_end
    group by model
    order by total_cents desc
    limit 6
  ) model_totals;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', daily_totals.date,
        'openaiCents', daily_totals.openai_cents,
        'anthropicCents', daily_totals.anthropic_cents,
        'otherCents', daily_totals.other_cents,
        'inputTokens', daily_totals.input_tokens,
        'outputTokens', daily_totals.output_tokens
      )
      order by daily_totals.date
    ),
    '[]'::jsonb
  )
  into v_daily_totals
  from (
    select
      u.date,
      coalesce(sum(case when lower(p.name) = 'openai' then u.cost_cents else 0 end), 0) as openai_cents,
      coalesce(sum(case when lower(p.name) = 'anthropic' then u.cost_cents else 0 end), 0) as anthropic_cents,
      coalesce(sum(case when lower(p.name) not in ('openai', 'anthropic') then u.cost_cents else 0 end), 0) as other_cents,
      coalesce(sum(u.input_tokens), 0)::bigint as input_tokens,
      coalesce(sum(u.output_tokens), 0)::bigint as output_tokens
    from public.usage_records u
    join public.providers p on p.id = u.provider_id
    where u.user_id = v_user_id
      and u.date >= v_today - 29
      and u.date < v_today + 1
    group by u.date
  ) daily_totals;

  select case
    when b.monthly_limit_cents is null or b.monthly_limit_cents <= 0 then 0
    else least(100, round((v_current_month / b.monthly_limit_cents) * 100, 1))
  end
  into v_budget_usage_pct
  from public.budgets b
  where b.user_id = v_user_id;

  insert into public.showcase_snapshots (
    id,
    generated_at,
    period_label,
    current_month_cents,
    total_tokens,
    budget_usage_pct,
    provider_totals,
    model_totals,
    daily_totals
  ) values (
    true,
    now(),
    to_char(v_month_start, 'Mon YYYY'),
    v_current_month,
    v_total_tokens,
    coalesce(v_budget_usage_pct, 0),
    v_provider_totals,
    v_model_totals,
    v_daily_totals
  )
  on conflict (id) do update set
    generated_at = excluded.generated_at,
    period_label = excluded.period_label,
    current_month_cents = excluded.current_month_cents,
    total_tokens = excluded.total_tokens,
    budget_usage_pct = excluded.budget_usage_pct,
    provider_totals = excluded.provider_totals,
    model_totals = excluded.model_totals,
    daily_totals = excluded.daily_totals
  returning * into v_snapshot;

  return v_snapshot;
end;
$$;

revoke all on function public.refresh_showcase_snapshot() from public;
grant execute on function public.refresh_showcase_snapshot() to authenticated;
