-- 给 provider 做唯一约束：每个用户每个 provider 名称只保留一条记录。
create unique index if not exists providers_user_id_name_key
on public.providers (user_id, name);

-- 给 usage 做唯一约束：同 provider + 日期 + 模型 视为同一条 usage。
create unique index if not exists usage_records_provider_date_model_key
on public.usage_records (provider_id, date, model);
