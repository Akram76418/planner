-- شعب المدرّس: لا يرى المدرّس إلا الشعب المرتبطة به، ويحصل على قائمة بأسماء طلبة شعبه.
-- الشعب المرتبطة = ما رُبط به من «إدارة ← الشعب» (comm_cohort_profs) + أي شعبة فيها طلبة مسجَّلون على اسمه (profiles.professor_id).
-- شغّله بعد exams.sql وexternal-isolation.sql. آمن للتكرار. يغيّر دوال: comm_has_access، comm_can_read_cohort (إعلانات الشعب)، comm_list_cohorts، comm_sched_list، comm_poll_list.

alter table public.comm_cohorts add column if not exists is_external boolean not null default false;
create or replace function public.ex_is_external(p_uid uuid) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select exists (select 1 from comm_cohort_members m join comm_cohorts c on c.id = m.cohort_id where m.user_id = p_uid and c.is_external)
$$;
revoke execute on function public.ex_is_external(uuid) from public, anon, authenticated;

create or replace function public.comm_prof_cohort_ids(p_uid uuid) returns setof integer
language sql stable security definer set search_path = public set row_security = off as $$
  select cp.cohort_id from comm_cohort_profs cp where cp.prof_id = p_uid
  union
  select m.cohort_id from comm_cohort_members m join profiles s on s.id = m.user_id where s.professor_id = p_uid and m.cohort_id is not null
$$;
revoke execute on function public.comm_prof_cohort_ids(uuid) from public, anon, authenticated;

create or replace function public.comm_has_access(k text) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when auth.uid() is null then false
    when public.current_user_role() = 'admin' then true
    when public.current_user_role() = 'professor' and k = 'cohorts' then true        -- المدرّس يرى شعبه دائماً (والحصر بالشعب في الدوال)
    when public.current_user_role() in ('professor','staff') then coalesce((select case k when 'weekly' then a.weekly when 'cohorts' then a.cohorts else false end from comm_staff_access a where a.user_id = auth.uid()), false)
    else false end
$$;

create or replace function public.comm_can_read_cohort(cid integer) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then false
    when public.current_user_role() = 'admin' then true
    when public.current_user_role() = 'professor' then cid in (select public.comm_prof_cohort_ids(auth.uid()))
    when public.current_user_role() = 'staff' then public.comm_has_access('cohorts')
    else exists (select 1 from comm_cohort_members m where m.user_id = auth.uid() and m.cohort_id = cid)
  end
$$;

drop function if exists public.comm_list_cohorts();
create or replace function public.comm_list_cohorts() returns table(id integer, name text, is_active boolean, members bigint, is_external boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() not in ('admin','professor','staff') then raise exception 'not allowed'; end if;
  if not public.comm_has_access('cohorts') then return; end if;
  return query select c.id, c.name, c.is_active, (select count(*) from comm_cohort_members m where m.cohort_id = c.id), c.is_external
               from comm_cohorts c where public.current_user_role() <> 'professor' or c.id in (select public.comm_prof_cohort_ids(auth.uid())) order by c.name;
end $$;
revoke execute on function public.comm_list_cohorts() from public, anon;
grant execute on function public.comm_list_cohorts() to authenticated;

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
      and (r in ('admin','staff') or s.cohort_id is null or s.cohort_id = myc
           or (r = 'professor' and s.cohort_id in (select public.comm_prof_cohort_ids(auth.uid()))))
    order by s.event_date, s.start_time nulls first, s.id limit 300;
end $$;

create or replace function public.comm_poll_list()
returns table(id bigint, cohort_id integer, cohort_name text, question text, options text[], closed boolean, created_at timestamptz, my_vote integer, counts integer[], total integer, eligible bigint, audience text, can_vote boolean)
language plpgsql stable security definer set search_path = public set row_security = off as $$
declare r text := public.current_user_role(); myc integer;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  if public.ex_is_external(auth.uid()) then return; end if;
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
           when p.cohort_id is null then (select count(*) from profiles x where x.role::text = 'student' and not public.ex_is_external(x.id))
           else (select count(*) from comm_cohort_members m2 where m2.cohort_id = p.cohort_id) end,
      p.audience,
      (not p.closed) and (
        (p.audience is null and r = 'student' and (p.cohort_id is null or p.cohort_id = myc))
        or (p.audience is not null and public.comm_poll_aud_ok(p.audience, auth.uid())))
    from comm_polls p left join comm_cohorts c on c.id = p.cohort_id
    where (r = 'admin' or not p.closed) and (r = 'admin'
       or (p.audience is null and ((r = 'staff' and public.comm_has_access('cohorts')) or (r = 'professor' and (p.cohort_id is null or p.cohort_id in (select public.comm_prof_cohort_ids(auth.uid())))) or (r = 'student' and (p.cohort_id is null or p.cohort_id = myc))))
       or (p.audience is not null and public.comm_poll_aud_ok(p.audience, auth.uid())))
    order by p.closed, p.id desc limit 100;
end $$;

-- قائمة طلبة الشعب: المدرّس لشعبه فقط، والمدير لكل الشعب
create or replace function public.comm_my_cohort_students()
returns table(cohort_id integer, cohort_name text, id uuid, full_name text, university_id text, major text)
language plpgsql stable security definer set search_path = public set row_security = off as $$
declare r text := public.current_user_role();
begin
  if r not in ('admin', 'professor', 'staff') then raise exception 'not allowed'; end if;
  if r = 'staff' and not public.comm_has_access('cohorts') then return; end if;
  return query
    select m.cohort_id, c.name, p.id, p.full_name, p.university_id, p.major
    from comm_cohort_members m join comm_cohorts c on c.id = m.cohort_id join profiles p on p.id = m.user_id
    where p.role::text = 'student' and (r <> 'professor' or m.cohort_id in (select public.comm_prof_cohort_ids(auth.uid())))
    order by c.name, p.full_name;
end $$;

revoke execute on function public.comm_has_access(text), public.comm_can_read_cohort(integer), public.comm_sched_list(date), public.comm_poll_list(), public.comm_my_cohort_students() from public, anon;
grant execute on function public.comm_has_access(text), public.comm_can_read_cohort(integer), public.comm_sched_list(date), public.comm_poll_list(), public.comm_my_cohort_students() to authenticated;
select 'ready' as status;
