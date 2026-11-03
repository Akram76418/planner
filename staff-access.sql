-- صلاحيات عرض الأقسام للأساتذة والموظفين: جدول الدوام (weekly) والشعب/الطلبة (cohorts)
-- الافتراضي: بلا صلاحية، ويمنحها الأدمن لكل موظف. (الأدمن الرئيسي والفرعي كما هم.)
-- شغّله بعد staff-polls.sql
create table if not exists public.comm_staff_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  weekly  boolean not null default false,
  cohorts boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.comm_staff_access enable row level security;
revoke all on public.comm_staff_access from anon, authenticated;

create or replace function public.comm_has_access(k text) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when auth.uid() is null then false
    when public.current_user_role() = 'admin' then true
    when public.current_user_role() in ('professor','staff') then coalesce((select case k when 'weekly' then a.weekly when 'cohorts' then a.cohorts else false end from comm_staff_access a where a.user_id = auth.uid()), false)
    else false end
$$;

create or replace function public.comm_my_access() returns jsonb
language sql stable security definer set search_path = public set row_security = off as $$
  select jsonb_build_object('weekly', public.comm_has_access('weekly'), 'cohorts', public.comm_has_access('cohorts'))
$$;

create or replace function public.comm_staff_access_list() returns table(user_id uuid, weekly boolean, cohorts boolean)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.admin_can('staff') then raise exception 'admin only'; end if;
  return query select a.user_id, a.weekly, a.cohorts from comm_staff_access a;
end $$;

create or replace function public.comm_set_staff_access(p_user uuid, p_weekly boolean, p_cohorts boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('staff') then raise exception 'admin only'; end if;
  insert into comm_staff_access (user_id, weekly, cohorts) values (p_user, coalesce(p_weekly, false), coalesce(p_cohorts, false))
  on conflict (user_id) do update set weekly = excluded.weekly, cohorts = excluded.cohorts, updated_at = now();
end $$;

-- جدول الدوام
create or replace function public.comm_weekly_list()
returns table(id bigint, user_id uuid, name text, cells jsonb, notes text, sort integer)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.comm_has_access('weekly') then raise exception 'ليست لديك صلاحية لعرض جدول الدوام'; end if;
  return query select w.id, w.user_id, w.name, w.cells, w.notes, w.sort from comm_weekly w order by w.sort, w.name, w.id;
end $$;

-- قائمة الشعب (فارغة لمن لا صلاحية له)
create or replace function public.comm_list_cohorts() returns table(id integer, name text, is_active boolean, members bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() not in ('admin','professor','staff') then raise exception 'not allowed'; end if;
  if not public.comm_has_access('cohorts') then return; end if;
  return query select c.id, c.name, c.is_active, (select count(*) from comm_cohort_members m where m.cohort_id = c.id)
               from comm_cohorts c order by c.name;
end $$;

-- قراءة إعلانات الشعبة
create or replace function public.comm_can_read_cohort(cid integer) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then false
    when public.current_user_role() = 'admin' then true
    when public.current_user_role() in ('professor','staff') then public.comm_has_access('cohorts')
    else exists (select 1 from comm_cohort_members m where m.user_id = auth.uid() and m.cohort_id = cid)
  end
$$;

-- جدول الطلبة
create or replace function public.comm_sched_list(p_from date default current_date)
returns table(id bigint, cohort_id integer, cohort_name text, kind text, title text, event_date date, start_time time, end_time time, place text, notes text)
language plpgsql stable security definer set search_path = public set row_security = off as $$
declare r text := public.current_user_role(); myc integer;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  if r in ('professor','staff') and not public.comm_has_access('cohorts') then return; end if;
  select m.cohort_id into myc from comm_cohort_members m where m.user_id = auth.uid();
  return query
    select s.id, s.cohort_id, c.name, s.kind, s.title, s.event_date, s.start_time, s.end_time, s.place, s.notes
    from comm_schedule s left join comm_cohorts c on c.id = s.cohort_id
    where s.event_date >= coalesce(p_from, current_date)
      and (r in ('admin','professor','staff') or s.cohort_id is null or s.cohort_id = myc)
    order by s.event_date, s.start_time nulls first, s.id limit 300;
end $$;

-- الاستبيانات: استبيانات الطلبة تحتاج صلاحية الشعب للموظف
create or replace function public.comm_poll_list()
returns table(id bigint, cohort_id integer, cohort_name text, question text, options text[], closed boolean, created_at timestamptz, my_vote integer, counts integer[], total integer, eligible bigint, audience text, can_vote boolean)
language plpgsql stable security definer set search_path = public set row_security = off as $$
declare r text := public.current_user_role(); myc integer;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  select m.cohort_id into myc from comm_cohort_members m where m.user_id = auth.uid();
  return query
    select p.id, p.cohort_id, c.name, p.question, p.options, p.closed, p.created_at,
      (select v.opt from comm_poll_votes v where v.poll_id = p.id and v.user_id = auth.uid()),
      case when (r = 'admin') or (p.audience is null and r in ('professor','staff') and public.comm_has_access('cohorts')) or p.closed or exists (select 1 from comm_poll_votes v where v.poll_id = p.id and v.user_id = auth.uid())
           then (select array_agg((select count(*)::int from comm_poll_votes v where v.poll_id = p.id and v.opt = g.i - 1) order by g.i) from generate_series(1, array_length(p.options, 1)) g(i))
           else null end,
      (select count(*)::int from comm_poll_votes v where v.poll_id = p.id),
      case when p.audience is not null then
             (select count(*) from profiles x where public.comm_poll_aud_ok(p.audience, x.id))
           when p.cohort_id is null then (select count(*) from profiles x where x.role::text = 'student')
           else (select count(*) from comm_cohort_members m2 where m2.cohort_id = p.cohort_id) end,
      p.audience,
      (not p.closed) and (
        (p.audience is null and r = 'student' and (p.cohort_id is null or p.cohort_id = myc))
        or (p.audience is not null and public.comm_poll_aud_ok(p.audience, auth.uid())))
    from comm_polls p left join comm_cohorts c on c.id = p.cohort_id
    where r = 'admin'
       or (p.audience is null and ((r in ('professor','staff') and public.comm_has_access('cohorts')) or (r = 'student' and (p.cohort_id is null or p.cohort_id = myc))))
       or (p.audience is not null and public.comm_poll_aud_ok(p.audience, auth.uid()))
    order by p.closed, p.id desc limit 100;
end $$;

revoke execute on function public.comm_has_access(text), public.comm_my_access(), public.comm_staff_access_list(), public.comm_set_staff_access(uuid, boolean, boolean) from public, anon;
grant execute on function public.comm_has_access(text), public.comm_my_access(), public.comm_staff_access_list(), public.comm_set_staff_access(uuid, boolean, boolean) to authenticated;
revoke execute on function public.comm_weekly_list(), public.comm_list_cohorts(), public.comm_sched_list(date), public.comm_poll_list() from public, anon;
grant execute on function public.comm_weekly_list(), public.comm_list_cohorts(), public.comm_sched_list(date), public.comm_poll_list() to authenticated;

-- حفاظاً على عمل الأساتذة الحاليين: تُمنح صلاحية الشعب لمن دوره «أستاذ» الآن (يمكنك سحبها من الواجهة)
insert into public.comm_staff_access (user_id, cohorts)
select p.id, true from public.profiles p where p.role::text = 'professor'
on conflict (user_id) do nothing;

select 'ready' as status;
