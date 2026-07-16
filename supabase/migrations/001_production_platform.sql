-- 홍동원 production data layer. Run once in Supabase SQL Editor or with the Supabase CLI.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  username text,
  display_name text check (char_length(display_name) <= 80),
  role text not null default 'user' check (role in ('user', 'admin')),
  daily_ai_limit integer not null default 20 check (daily_ai_limit between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_key on public.profiles(username) where username is not null;

create table if not exists public.account_recovery (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  recovery_hash text not null check (char_length(recovery_hash) = 64),
  updated_at timestamptz not null default now()
);

create table if not exists public.study_snapshots (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint study_snapshot_size check (octet_length(data::text) <= 2000000)
);

create table if not exists public.daily_ai_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  usage_date date not null,
  request_count integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_micros bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

create table if not exists public.ai_usage_events (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  feature text not null,
  model text not null default '',
  status text not null default 'reserved' check (status in ('reserved', 'completed', 'failed')),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_micros bigint not null default 0,
  error_code text not null default '',
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists ai_usage_events_user_created_idx on public.ai_usage_events(user_id, created_at desc);

create table if not exists public.rate_limit_windows (
  key_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  expires_at timestamptz not null,
  primary key (key_hash, window_start)
);
create index if not exists rate_limit_expiry_idx on public.rate_limit_windows(expires_at);

create table if not exists public.analysis_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  problem_id text not null,
  title text not null,
  report jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, problem_id)
);

create table if not exists public.error_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  level text not null default 'error',
  message text not null,
  stack text not null default '',
  route text not null default '',
  context jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists error_events_created_idx on public.error_events(created_at desc);

alter table public.profiles enable row level security;
alter table public.account_recovery enable row level security;
alter table public.study_snapshots enable row level security;
alter table public.daily_ai_usage enable row level security;
alter table public.ai_usage_events enable row level security;
alter table public.rate_limit_windows enable row level security;
alter table public.analysis_reports enable row level security;
alter table public.error_events enable row level security;

drop policy if exists "profiles read own" on public.profiles;
create policy "profiles read own" on public.profiles for select using (auth.uid() = id);
drop policy if exists "profiles update own" on public.profiles;
-- Profile mutations go through the authenticated server endpoint. Keeping browser
-- clients read-only prevents role and daily-limit escalation through PostgREST.
drop policy if exists "snapshots own" on public.study_snapshots;
create policy "snapshots own" on public.study_snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "usage read own" on public.daily_ai_usage;
create policy "usage read own" on public.daily_ai_usage for select using (auth.uid() = user_id);
drop policy if exists "events read own" on public.ai_usage_events;
create policy "events read own" on public.ai_usage_events for select using (auth.uid() = user_id);
drop policy if exists "reports own" on public.analysis_reports;
create policy "reports own" on public.analysis_reports for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, username, display_name)
  values (
    new.id,
    case when new.raw_user_meta_data->>'account_type' = 'username' then null else new.email end,
    case when new.raw_user_meta_data->>'account_type' = 'username' then left(lower(new.raw_user_meta_data->>'username'), 20) else null end,
    left(coalesce(new.raw_user_meta_data->>'name', ''), 80)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_seconds integer := greatest(10, least(3600, p_window_seconds));
  v_limit integer := greatest(1, least(10000, p_limit));
  v_start timestamptz := to_timestamp(floor(extract(epoch from clock_timestamp()) / v_seconds) * v_seconds);
  v_count integer;
begin
  insert into public.rate_limit_windows(key_hash, window_start, request_count, expires_at)
  values (encode(extensions.digest(p_key, 'sha256'), 'hex'), v_start, 1, v_start + make_interval(secs => v_seconds * 2))
  on conflict (key_hash, window_start) do update
    set request_count = public.rate_limit_windows.request_count + 1
  returning request_count into v_count;
  if random() < 0.01 then delete from public.rate_limit_windows where expires_at < now(); end if;
  return jsonb_build_object('allowed', v_count <= v_limit, 'remaining', greatest(0, v_limit - v_count), 'reset_seconds', v_seconds);
end;
$$;

create or replace function public.reserve_ai_request(p_user_id uuid, p_feature text, p_request_id uuid, p_daily_limit integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_date date := (clock_timestamp() at time zone 'Asia/Seoul')::date;
  v_limit integer := greatest(1, least(500, p_daily_limit));
  v_count integer;
begin
  insert into public.daily_ai_usage(user_id, usage_date, request_count)
  values (p_user_id, v_date, 1)
  on conflict (user_id, usage_date) do update
    set request_count = public.daily_ai_usage.request_count + 1, updated_at = now()
    where public.daily_ai_usage.request_count < v_limit
  returning request_count into v_count;
  if v_count is null then
    select request_count into v_count from public.daily_ai_usage where user_id = p_user_id and usage_date = v_date;
    return jsonb_build_object('allowed', false, 'used', coalesce(v_count, 0), 'limit', v_limit, 'remaining', 0);
  end if;
  insert into public.ai_usage_events(id, user_id, feature) values (p_request_id, p_user_id, left(p_feature, 80));
  return jsonb_build_object('allowed', true, 'used', v_count, 'limit', v_limit, 'remaining', greatest(0, v_limit - v_count));
exception when unique_violation then
  return jsonb_build_object('allowed', true, 'used', coalesce(v_count, 0), 'limit', v_limit, 'remaining', greatest(0, v_limit - coalesce(v_count, 0)));
end;
$$;

create or replace function public.finalize_ai_request(
  p_user_id uuid, p_request_id uuid, p_model text, p_input_tokens integer, p_output_tokens integer,
  p_cost_micros bigint, p_status text, p_error_code text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_date date;
  v_updated integer;
begin
  update public.ai_usage_events set
    model = left(coalesce(p_model, ''), 120),
    input_tokens = greatest(0, coalesce(p_input_tokens, 0)),
    output_tokens = greatest(0, coalesce(p_output_tokens, 0)),
    cost_micros = greatest(0, coalesce(p_cost_micros, 0)),
    status = case when p_status = 'completed' then 'completed' else 'failed' end,
    error_code = left(coalesce(p_error_code, ''), 120), finished_at = now()
  where id = p_request_id and user_id = p_user_id and status = 'reserved';
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    v_date := (clock_timestamp() at time zone 'Asia/Seoul')::date;
    update public.daily_ai_usage set
      input_tokens = input_tokens + greatest(0, coalesce(p_input_tokens, 0)),
      output_tokens = output_tokens + greatest(0, coalesce(p_output_tokens, 0)),
      cost_micros = cost_micros + greatest(0, coalesce(p_cost_micros, 0)), updated_at = now()
    where user_id = p_user_id and usage_date = v_date;
  end if;
end;
$$;

create or replace function public.admin_dashboard_metrics(p_days integer default 30)
returns jsonb language sql security definer set search_path = public as $$
  with bounds as (select current_date - greatest(1, least(180, p_days)) as since),
  totals as (
    select coalesce(sum(request_count),0) requests, coalesce(sum(input_tokens),0) input_tokens,
      coalesce(sum(output_tokens),0) output_tokens, coalesce(sum(cost_micros),0) cost_micros
    from public.daily_ai_usage, bounds where usage_date >= bounds.since
  ), daily as (
    select coalesce(jsonb_agg(jsonb_build_object('date', usage_date, 'requests', requests, 'costMicros', cost) order by usage_date), '[]'::jsonb) data
    from (select usage_date, sum(request_count) requests, sum(cost_micros) cost from public.daily_ai_usage, bounds where usage_date >= bounds.since group by usage_date) x
  ), features as (
    select coalesce(jsonb_agg(jsonb_build_object('feature', feature, 'requests', requests, 'costMicros', cost) order by requests desc), '[]'::jsonb) data
    from (select feature, count(*) requests, sum(cost_micros) cost from public.ai_usage_events, bounds where created_at::date >= bounds.since group by feature) x
  ), failures as (
    select coalesce(jsonb_agg(jsonb_build_object('message', message, 'route', route, 'createdAt', created_at) order by created_at desc), '[]'::jsonb) data
    from (select message, route, created_at from public.error_events order by created_at desc limit 20) x
  )
  select jsonb_build_object(
    'periodDays', greatest(1, least(180, p_days)), 'users', (select count(*) from public.profiles),
    'requests', totals.requests, 'inputTokens', totals.input_tokens, 'outputTokens', totals.output_tokens,
    'costMicros', totals.cost_micros, 'daily', daily.data, 'features', features.data, 'errors', failures.data
  ) from totals, daily, features, failures;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.reserve_ai_request(uuid, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.finalize_ai_request(uuid, uuid, text, integer, integer, bigint, text, text) from public, anon, authenticated;
revoke all on function public.admin_dashboard_metrics(integer) from public, anon, authenticated;
revoke all on table public.account_recovery from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
grant execute on function public.reserve_ai_request(uuid, text, uuid, integer) to service_role;
grant execute on function public.finalize_ai_request(uuid, uuid, text, integer, integer, bigint, text, text) to service_role;
grant execute on function public.admin_dashboard_metrics(integer) to service_role;

-- Private, short-lived upload quarantine. The recognition function deletes each object after consuming it.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('problem-uploads', 'problem-uploads', false, 12582912, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "users upload own problem files" on storage.objects;
create policy "users upload own problem files" on storage.objects for insert to authenticated
with check (bucket_id = 'problem-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "users read own problem files" on storage.objects;
create policy "users read own problem files" on storage.objects for select to authenticated
using (bucket_id = 'problem-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "users delete own problem files" on storage.objects;
create policy "users delete own problem files" on storage.objects for delete to authenticated
using (bucket_id = 'problem-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
