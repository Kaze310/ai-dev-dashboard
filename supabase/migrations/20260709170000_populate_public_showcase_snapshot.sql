-- Capture the current personal dashboard data once for the public showcase.
-- The public table remains read-only from the application after this migration.
alter table public.showcase_snapshots
add column if not exists total_spend_cents numeric not null default 0;

drop policy if exists "showcase_snapshots_authenticated_insert" on public.showcase_snapshots;
drop policy if exists "showcase_snapshots_authenticated_update" on public.showcase_snapshots;
drop function if exists public.refresh_showcase_snapshot();

with record_bounds as (
  select
    coalesce(sum(cost_cents), 0) as total_spend_cents,
    coalesce(sum(input_tokens + output_tokens), 0)::bigint as total_tokens,
    coalesce(
      sum(cost_cents) filter (
        where date >= date_trunc('month', current_date)::date
          and date < (date_trunc('month', current_date) + interval '1 month')::date
      ),
      0
    ) as current_month_cents,
    min(date) as min_date,
    max(date) as max_date
  from public.usage_records
), provider_totals as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object('name', grouped.name, 'costCents', grouped.total_cents)
      order by grouped.total_cents desc
    ),
    '[]'::jsonb
  ) as payload
  from (
    select
      case lower(p.name)
        when 'openai' then 'OpenAI'
        when 'anthropic' then 'Anthropic'
        else 'Other'
      end as name,
      sum(u.cost_cents) as total_cents
    from public.usage_records u
    join public.providers p on p.id = u.provider_id
    group by case lower(p.name)
      when 'openai' then 'OpenAI'
      when 'anthropic' then 'Anthropic'
      else 'Other'
    end
  ) grouped
), model_totals as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object('model', grouped.model, 'costCents', grouped.total_cents)
      order by grouped.total_cents desc
    ),
    '[]'::jsonb
  ) as payload
  from (
    select model, sum(cost_cents) as total_cents
    from public.usage_records
    group by model
    order by total_cents desc
    limit 12
  ) grouped
), daily_totals as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', grouped.date,
        'openaiCents', grouped.openai_cents,
        'anthropicCents', grouped.anthropic_cents,
        'otherCents', grouped.other_cents,
        'inputTokens', grouped.input_tokens,
        'outputTokens', grouped.output_tokens
      )
      order by grouped.date
    ),
    '[]'::jsonb
  ) as payload
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
    where u.date >= current_date - 89
      and u.date < current_date + 1
    group by u.date
  ) grouped
), budget_totals as (
  select coalesce(
    least(100, round((record_bounds.current_month_cents / nullif(sum(b.monthly_limit_cents), 0)) * 100, 1)),
    0
  ) as usage_pct
  from record_bounds
  left join public.budgets b on true
  group by record_bounds.current_month_cents
)
insert into public.showcase_snapshots (
  id,
  generated_at,
  period_label,
  current_month_cents,
  total_spend_cents,
  total_tokens,
  budget_usage_pct,
  provider_totals,
  model_totals,
  daily_totals
)
select
  true,
  now(),
  case
    when record_bounds.min_date is null then 'No synced data'
    when record_bounds.min_date = record_bounds.max_date then to_char(record_bounds.min_date, 'Mon DD, YYYY')
    else to_char(record_bounds.min_date, 'Mon YYYY') || ' - ' || to_char(record_bounds.max_date, 'Mon YYYY')
  end,
  record_bounds.current_month_cents,
  record_bounds.total_spend_cents,
  record_bounds.total_tokens,
  budget_totals.usage_pct,
  provider_totals.payload,
  model_totals.payload,
  daily_totals.payload
from record_bounds
cross join provider_totals
cross join model_totals
cross join daily_totals
cross join budget_totals
on conflict (id) do update set
  generated_at = excluded.generated_at,
  period_label = excluded.period_label,
  current_month_cents = excluded.current_month_cents,
  total_spend_cents = excluded.total_spend_cents,
  total_tokens = excluded.total_tokens,
  budget_usage_pct = excluded.budget_usage_pct,
  provider_totals = excluded.provider_totals,
  model_totals = excluded.model_totals,
  daily_totals = excluded.daily_totals;
