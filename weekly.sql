-- الجدول الأسبوعي للمحاضرين والموظفين (اسم الموظف + مكان عمله في كل يوم). شغّله بعد student-features.sql.
create table if not exists public.comm_weekly (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id) on delete set null,
  name       text not null check (length(trim(name)) between 1 and 120),
  cells      jsonb not null default '{}'::jsonb,   -- {sun,mon,tue,wed,thu: نص مكان العمل}
  notes      text check (notes is null or length(notes) <= 300),
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.comm_weekly enable row level security;
revoke all on public.comm_weekly from anon, authenticated;

create or replace function public.comm_weekly_list()
returns table(id bigint, user_id uuid, name text, cells jsonb, notes text, sort integer)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if public.current_user_role() not in ('admin','professor','staff') then raise exception 'not allowed'; end if;
  return query select w.id, w.user_id, w.name, w.cells, w.notes, w.sort from comm_weekly w order by w.sort, w.name, w.id;
end $$;

create or replace function public.comm_weekly_save(p_id bigint, p_name text, p_cells jsonb, p_notes text, p_user uuid default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare nid bigint;
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  if p_id is null then
    insert into comm_weekly (user_id, name, cells, notes, sort)
    values (p_user, trim(p_name), coalesce(p_cells, '{}'), nullif(trim(p_notes), ''), coalesce((select max(sort) + 1 from comm_weekly), 0)) returning id into nid;
  else
    update comm_weekly set name = trim(p_name), cells = coalesce(p_cells, '{}'), notes = nullif(trim(p_notes), '') where id = p_id returning id into nid;
  end if;
  return nid;
end $$;

create or replace function public.comm_weekly_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  delete from comm_weekly where id = p_id;
end $$;

create or replace function public.comm_weekly_clear() returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  delete from comm_weekly where true;
end $$;

-- يضيف كل المحاضرين والموظفين المسجلين الذين ليسوا في الجدول بعد
create or replace function public.comm_weekly_fill() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  insert into comm_weekly (user_id, name, sort)
    select p.id, p.full_name, coalesce((select max(sort) from comm_weekly), 0) + row_number() over (order by p.full_name)
    from profiles p
    where p.role::text in ('professor','staff') and p.full_name is not null
      and not exists (select 1 from comm_weekly w where w.user_id = p.id);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.comm_weekly_list(), public.comm_weekly_save(bigint, text, jsonb, text, uuid), public.comm_weekly_delete(bigint), public.comm_weekly_clear(), public.comm_weekly_fill() from public, anon;
grant execute on function public.comm_weekly_list(), public.comm_weekly_save(bigint, text, jsonb, text, uuid), public.comm_weekly_delete(bigint), public.comm_weekly_clear(), public.comm_weekly_fill() to authenticated;
