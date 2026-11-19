-- الشعبة الخارجية: تواصل محدود. الطالب الخارجي يراسل محاضريه (المرتبطين بشعبته) فقط ويقرأ إعلانات شعبته،
-- والمحاضر يراسل طلبته الخارجيين وينشر إعلاناً لشعبته الخارجية. لا يرى الخارجي طلبة الكلية ولا جدولهم ولا استبياناتهم.
-- شغّله بعد external-isolation.sql وprofessor-scope.sql. آمن للتكرار.

-- 1) من يراسل من
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
  me_ext boolean := public.ex_is_external(auth.uid());
  tg_ext boolean;
  s_id uuid; p_id uuid;
begin
  if target_user_id is null or target_user_id = auth.uid() then return false; end if;
  select role::text into target_role from public.profiles where id = target_user_id;
  if target_role is null then return false; end if;
  tg_ext := public.ex_is_external(target_user_id);
  if me_ext or tg_ext then
    if me_role = 'admin' or target_role = 'admin' then return true; end if;
    -- خارجي ↔ محاضر مرتبط بشعبته فقط
    if me_ext and me_role = 'student' and target_role = 'professor' then s_id := auth.uid(); p_id := target_user_id;
    elsif tg_ext and target_role = 'student' and me_role = 'professor' then s_id := target_user_id; p_id := auth.uid();
    else return false; end if;
    return exists (select 1 from public.profiles where id = s_id and professor_id = p_id)
        or exists (select 1 from public.comm_cohort_members m where m.user_id = s_id and m.cohort_id in (select public.comm_prof_cohort_ids(p_id)));
  end if;
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

-- 2) الجدول: الخارجي لا يرى محاضرات «كل الشعب» الخاصة بالكلية، بل جدول شعبته فقط
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
      and (r in ('admin','staff') or (s.cohort_id is null and not public.ex_is_external(auth.uid())) or s.cohort_id = myc
           or (r = 'professor' and s.cohort_id in (select public.comm_prof_cohort_ids(auth.uid()))))
    order by s.event_date, s.start_time nulls first, s.id limit 300;
end $$;

-- 3) إعلانات الشعبة الخارجية: ينشرها المحاضر المرتبط بها (إضافة إلى الإدارة)
create or replace function public.comm_ext_ann_ok(cid integer) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select public.current_user_role() = 'professor'
     and exists (select 1 from comm_cohorts c where c.id = cid and c.is_external)
     and cid in (select public.comm_prof_cohort_ids(auth.uid()))
$$;
revoke execute on function public.comm_ext_ann_ok(integer) from public, anon;
grant execute on function public.comm_ext_ann_ok(integer) to authenticated;

drop policy if exists "ann insert" on public.comm_announcements;
create policy "ann insert" on public.comm_announcements for insert
  with check (sender_id = auth.uid() and (public.admin_can('ann') or public.comm_ext_ann_ok(cohort_id)));
drop policy if exists "ann delete" on public.comm_announcements;
create policy "ann delete" on public.comm_announcements for delete
  using (public.admin_can('ann') or (sender_id = auth.uid() and public.comm_ext_ann_ok(cohort_id)));

select 'ready' as status;
