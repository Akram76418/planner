-- يسمح لأكثر من أكاديمي بمراسلة طلبة الشعبة (يوسّع can_communicate_with دون تغيير بقية قواعدها).
-- شغّله بعد student-features.sql. يستبدل دالتين فقط ولا يحذف بيانات.
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

-- مشرفو الطالب لأزرار «راسل مشرفي» في الرئيسية: الأساسي + أكاديميو شعبته
drop function if exists public.comm_my_supervisor();
create or replace function public.comm_my_supervisor() returns table(id uuid, full_name text)
language sql stable security definer set search_path = public set row_security = off as $$
  select p.id, p.full_name from profiles p
  where p.id = (select professor_id from profiles where id = auth.uid())
     or p.id in (select cp.prof_id from comm_cohort_members m join comm_cohort_profs cp on cp.cohort_id = m.cohort_id where m.user_id = auth.uid())
  order by p.full_name
$$;
revoke execute on function public.comm_my_supervisor() from public, anon;
grant execute on function public.comm_my_supervisor() to authenticated;
