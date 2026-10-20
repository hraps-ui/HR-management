-- Aeroplast HR Portal shared cloud database.
-- Run this entire script in the Supabase SQL Editor for your project.
create extension if not exists pgcrypto;

create table if not exists public.portal_state (
  id smallint primary key check (id = 1),
  payload jsonb not null,
  version text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.portal_users (
  id uuid primary key default gen_random_uuid(),
  login_id text not null,
  login_key text not null unique,
  user_type text not null check (user_type in ('admin_root','employee')),
  role text not null check (role in ('admin','employee')),
  employee_record_id text,
  password_salt text not null,
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists portal_users_one_root_admin
  on public.portal_users(user_type) where user_type = 'admin_root';
create unique index if not exists portal_users_employee_record
  on public.portal_users(employee_record_id) where user_type = 'employee';

create table if not exists public.portal_sessions (
  token_hash text primary key,
  user_id uuid not null references public.portal_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.portal_state enable row level security;
alter table public.portal_users enable row level security;
alter table public.portal_sessions enable row level security;

-- The server-side Edge Function connects as service_role; browsers have no direct table access.
grant all on table public.portal_state to service_role;
grant all on table public.portal_users to service_role;
grant all on table public.portal_sessions to service_role;

-- No direct browser access to HR rows. Only the Edge Function's service role may read/write them.
revoke all on public.portal_state from anon, authenticated;
revoke all on public.portal_users from anon, authenticated;
revoke all on public.portal_sessions from anon, authenticated;

create or replace function public.bootstrap_portal_state(p_payload jsonb, p_version text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.portal_state(id, payload, version, updated_at)
  values (1, p_payload, p_version, now())
  on conflict (id) do nothing;
  return found;
end;
$$;

create or replace function public.compare_and_swap_portal_state(
  p_expected_version text,
  p_payload jsonb,
  p_new_version text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.portal_state
     set payload = p_payload, version = p_new_version, updated_at = now()
   where id = 1 and version = p_expected_version;
  return found;
end;
$$;

revoke all on function public.bootstrap_portal_state(jsonb, text) from public, anon, authenticated;
revoke all on function public.compare_and_swap_portal_state(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.bootstrap_portal_state(jsonb, text) to service_role;
grant execute on function public.compare_and_swap_portal_state(text, jsonb, text) to service_role;
