-- عزل طلبة الاختبارات الخارجيين (من جامعة أخرى) عن بيانات الكلية.
-- الفكرة: شعبة تُعلَّم «خارجية»؛ أعضاؤها طلبة عاديون للدخول لكنهم لا يظهرون في قوائم الطلبة ولا البحث ولا التكرار
-- ولا استبيانات الطلبة ولا كلمات المرور المعلّقة، ولا يراسلون أحداً ولا يراسلهم أحد، وتُخفى شعبتهم عن «الجميع» في الإعلانات.
-- شغّله بعد exams.sql. آمن للتكرار. (نسخ احتياطي قبل التشغيل يُنصح به.)

alter table public.comm_cohorts add column if not exists is_external boolean not null default false;

create or replace function public.ex_is_external(p_uid uuid) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select exists (select 1 from comm_cohort_members m join comm_cohorts c on c.id = m.cohort_id where m.user_id = p_uid and c.is_external)
$$;
revoke execute on function public.ex_is_external(uuid) from public, anon, authenticated;

create or replace function public.ex_set_external(p_cohort integer, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('cohorts') then raise exception 'admin only'; end if;
  update comm_cohorts set is_external = coalesce(p_on, false) where id = p_cohort;
  if not found then raise exception 'cohort not found'; end if;
end $$;

create or replace function public.ex_external_cohorts() returns table(id integer, name text, is_external boolean, members bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.admin_can('cohorts') or public.admin_can('ex')) then raise exception 'admin only'; end if;
  return query select c.id, c.name, c.is_external, (select count(*) from comm_cohort_members m where m.cohort_id = c.id) from comm_cohorts c order by c.is_external desc, c.name;
end $$;
revoke execute on function public.ex_set_external(integer, boolean), public.ex_external_cohorts() from public, anon;
grant execute on function public.ex_set_external(integer, boolean), public.ex_external_cohorts() to authenticated;

drop function if exists public.comm_list_cohorts();
create or replace function public.comm_list_cohorts() returns table(id integer, name text, is_active boolean, members bigint, is_external boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() not in ('admin','professor','staff') then raise exception 'not allowed'; end if;
  if not public.comm_has_access('cohorts') then return; end if;
  return query select c.id, c.name, c.is_active, (select count(*) from comm_cohort_members m where m.cohort_id = c.id), c.is_external
               from comm_cohorts c order by c.name;
end $$;
revoke execute on function public.comm_list_cohorts() from public, anon;
grant execute on function public.comm_list_cohorts() to authenticated;

create or replace function public.comm_list_students(p_cohort integer default null, p_search text default '', p_unassigned boolean default false)
returns table(id uuid, full_name text, university_id text, major text, cohort_id integer, cohort_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can('students') then raise exception 'admin only'; end if;
  return query
    select p.id, p.full_name, p.university_id, p.major, m.cohort_id, c.name
    from profiles p
    left join comm_cohort_members m on m.user_id = p.id
    left join comm_cohorts c on c.id = m.cohort_id
    where p.role::text = 'student'
      and (p_cohort is not null or not public.ex_is_external(p.id))
      and (p_cohort is null or m.cohort_id = p_cohort)
      and (not p_unassigned or m.user_id is null)
      and (nullif(trim(p_search), '') is null
           or p.full_name ilike '%' || trim(p_search) || '%'
           or coalesce(p.university_id, '') ilike '%' || trim(p_search) || '%')
    order by p.full_name limit 2000;
end $$;

create or replace function public.comm_find_duplicates()
returns table(reason text, grp text, id uuid, full_name text, university_id text, created_at timestamptz, last_sign_in timestamptz, must_change boolean, cohort_name text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.admin_can('students') then raise exception 'admin only'; end if;
  return query
  with s as (
    select p.id, nullif(trim(p.university_id), '') as uid, nullif(trim(p.national_id), '') as nid, public.comm_norm_name(p.full_name) as nm
    from public.profiles p where p.role::text = 'student' and not public.ex_is_external(p.id)
  ), g as (
    select 'name'::text as r, s.nm as k, s.id from s where s.nm <> '' and s.nm in (select x.nm from s x group by x.nm having count(*) > 1)
    union all select 'number', s.uid, s.id from s where s.uid in (select x.uid from s x where x.uid is not null group by x.uid having count(*) > 1)
    union all select 'national_id', s.nid, s.id from s where s.nid in (select x.nid from s x where x.nid is not null group by x.nid having count(*) > 1)
    union all select 'number_vs_id', a.uid, a.id from s a join s b on a.uid = b.nid and a.id <> b.id
    union all select 'number_vs_id', b.nid, b.id from s a join s b on a.uid = b.nid and a.id <> b.id
  )
  select g.r, substr(md5(g.k), 1, 8), p.id, p.full_name, p.university_id, p.created_at, u.last_sign_in_at,
         coalesce(w.must_change, false), c.name
  from g
  join public.profiles p on p.id = g.id
  left join auth.users u on u.id = p.id
  left join public.comm_pw_status w on w.user_id = p.id
  left join public.comm_cohort_members m on m.user_id = p.id
  left join public.comm_cohorts c on c.id = m.cohort_id
  order by g.r, 2, p.created_at
  limit 1500;
end $$;

create or replace function public.comm_pending_passwords() returns table(user_id uuid, full_name text, university_id text, role text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can('reset') then raise exception 'admin only'; end if;
  return query select s.user_id, p.full_name, p.university_id, p.role::text, s.created_at
               from comm_pw_status s join profiles p on p.id = s.user_id
               where s.must_change and not public.ex_is_external(p.id) order by p.full_name;
end $$;

create or replace function public.can_communicate_with(target_user_id uuid)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
 set row_security to 'off'
as $function$
declare
  me_role text := public.current_user_role();
  target_role text;
  my_professor_id uuid;
begin
  if target_user_id is null or target_user_id = auth.uid() then return false; end if;
  if public.ex_is_external(auth.uid()) or public.ex_is_external(target_user_id) then return false; end if;
  select role::text into target_role from public.profiles where id = target_user_id;
  if target_role is null then return false; end if;
  if me_role = 'admin' then return true; end if;
  if me_role = 'student' then
    select professor_id into my_professor_id from public.profiles where id = auth.uid();
    return target_role = 'admin' or target_user_id = my_professor_id
      or exists (select 1 from public.comm_cohort_members m join public.comm_cohort_profs cp on cp.cohort_id = m.cohort_id
                 where m.user_id = auth.uid() and cp.prof_id = target_user_id);
  end if;
  if me_role = 'professor' then
    return target_role in ('admin', 'staff', 'professor')
      or exists (select 1 from public.profiles where id = target_user_id and role = 'student' and professor_id = auth.uid())
      or (target_role = 'student' and exists (select 1 from public.comm_cohort_members m join public.comm_cohort_profs cp on cp.cohort_id = m.cohort_id
                 where m.user_id = target_user_id and cp.prof_id = auth.uid()));
  end if;
  if me_role = 'staff' then
    return target_role in ('admin', 'professor', 'staff');
  end if;
  return false;
end;
$function$;

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
       or (p.audience is null and ((r in ('professor','staff') and public.comm_has_access('cohorts')) or (r = 'student' and (p.cohort_id is null or p.cohort_id = myc))))
       or (p.audience is not null and public.comm_poll_aud_ok(p.audience, auth.uid())))
    order by p.closed, p.id desc limit 100;
end $$;

create or replace function public.comm_poll_vote(p_poll bigint, p_opt integer) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare pl comm_polls; myc integer; r text := public.current_user_role();
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  if public.ex_is_external(auth.uid()) then raise exception 'not allowed'; end if;
  select * into pl from comm_polls where id = p_poll;
  if not found or pl.closed then raise exception 'الاستبيان مغلق'; end if;
  if pl.audience is null then
    if r <> 'student' then raise exception 'للطلبة فقط'; end if;
    select m.cohort_id into myc from comm_cohort_members m where m.user_id = auth.uid();
    if pl.cohort_id is not null and pl.cohort_id is distinct from myc then raise exception 'not allowed'; end if;
  elsif not public.comm_poll_aud_ok(pl.audience, auth.uid()) then
    raise exception 'غير موجّه إليك';
  end if;
  if p_opt < 0 or p_opt >= array_length(pl.options, 1) then raise exception 'bad option'; end if;
  if exists (select 1 from comm_poll_votes v where v.poll_id = p_poll and v.user_id = auth.uid()) then raise exception 'سبق أن أجبت على هذا الاستبيان'; end if;
  insert into comm_poll_votes (poll_id, user_id, opt) values (p_poll, auth.uid(), p_opt);
end $$;

create or replace function public.comm_default_pw_report() returns table(role text, cnt bigint, oldest_days integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  return query select p.role::text, count(*), coalesce(max(extract(day from now() - s.created_at))::integer, 0)
               from comm_pw_status s join profiles p on p.id = s.user_id where s.must_change and not public.ex_is_external(p.id) group by p.role::text order by 2 desc;
end $$;

create or replace function public.comm_my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'role', public.current_user_role(),
    'name', (select p.full_name from profiles p where p.id = auth.uid()),
    'category', public.comm_my_category(),
    'cohort_id', (select m.cohort_id from comm_cohort_members m where m.user_id = auth.uid()),
    'cohort_name', (select c.name from comm_cohort_members m join comm_cohorts c on c.id = m.cohort_id where m.user_id = auth.uid()),
    'planner', public.planner_ok(),
    'external', public.ex_is_external(auth.uid()),
    'must_change', coalesce((select s.must_change from comm_pw_status s where s.user_id = auth.uid()), false)
  )
$$;

select 'ready' as status;
