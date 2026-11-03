-- Access control: only emails in planner_allowed can use the planner's data.
-- Admins manage that list from the app (Settings > Users). Run once in Supabase > SQL Editor.
-- Does not touch other apps that share this Supabase project.

create table if not exists public.planner_allowed (
  email    text primary key check (email = lower(email)),
  is_admin boolean not null default false,
  added_at timestamptz not null default now()
);
alter table public.planner_allowed enable row level security;   -- no policies: reachable only through the functions below

create or replace function public.planner_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from planner_allowed where email = lower(auth.jwt() ->> 'email'))
$$;

create or replace function public.planner_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from planner_allowed where email = lower(auth.jwt() ->> 'email') and is_admin)
$$;

create or replace function public.planner_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('allowed', public.planner_ok(), 'admin', public.planner_is_admin())
$$;

create or replace function public.planner_list_users() returns table(email text, is_admin boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.planner_is_admin() then raise exception 'admin only'; end if;
  return query select a.email, a.is_admin from planner_allowed a order by a.is_admin desc, a.email;
end $$;

create or replace function public.planner_add_user(p_email text, p_admin boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  if not public.planner_is_admin() then raise exception 'admin only'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid email'; end if;
  insert into planner_allowed (email, is_admin) values (e, coalesce(p_admin, false))
  on conflict (email) do update set is_admin = planner_allowed.is_admin or excluded.is_admin;
end $$;

create or replace function public.planner_remove_user(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  if not public.planner_is_admin() then raise exception 'admin only'; end if;
  if e = lower(auth.jwt() ->> 'email') then raise exception 'you cannot remove yourself'; end if;
  delete from planner_allowed where email = e;
end $$;

grant execute on function public.planner_me(), public.planner_list_users(),
  public.planner_add_user(text, boolean), public.planner_remove_user(text) to authenticated;
revoke execute on function public.planner_me(), public.planner_list_users(),
  public.planner_add_user(text, boolean), public.planner_remove_user(text) from anon;

drop policy if exists "own records" on public.records;
create policy "own records" on public.records for all
  using (user_id = auth.uid() and public.planner_ok())
  with check (user_id = auth.uid() and public.planner_ok());

drop policy if exists "own subs" on public.push_subscriptions;
create policy "own subs" on public.push_subscriptions for all
  using (user_id = auth.uid() and public.planner_ok())
  with check (user_id = auth.uid() and public.planner_ok());

-- First administrator (the owner). Change the email if needed.
insert into public.planner_allowed (email, is_admin) values ('abusalah76@gmail.com', true)
on conflict (email) do update set is_admin = true;
