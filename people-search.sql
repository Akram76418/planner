-- بحث شامل في كل الأسماء + تعديل الاسم والرقم (للمسؤول بصلاحية الطلبة)
drop function if exists public.comm_people_search(text, integer);
create or replace function public.comm_people_search(p_q text, p_limit integer default 100)
returns table(id uuid, full_name text, role text, number text, major text, cohort_name text)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.admin_can('students') then raise exception 'admin only'; end if;
  return query
    select p.id, p.full_name, p.role::text, p.university_id, p.major, c.name
    from profiles p
    left join comm_cohort_members m on m.user_id = p.id
    left join comm_cohorts c on c.id = m.cohort_id
    where p.role::text <> 'admin'
      and (nullif(trim(p_q), '') is null
           or p.full_name ilike '%' || trim(p_q) || '%'
           or coalesce(p.university_id, '') ilike '%' || trim(p_q) || '%'
           or coalesce(p.employee_number, '') ilike '%' || trim(p_q) || '%')
    order by p.full_name limit least(coalesce(p_limit, 100), 300);
end $$;

create or replace function public.comm_person_update(p_user uuid, p_name text, p_number text) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare v_name text := trim(coalesce(p_name, '')); v_num text := trim(coalesce(p_number, '')); v_role text;
begin
  if not public.admin_can('students') then raise exception 'admin only'; end if;
  select role::text into v_role from profiles where id = p_user;
  if v_role is null then raise exception 'not found'; end if;
  if v_role = 'admin' then raise exception 'cannot edit admin'; end if;
  if v_name = '' then raise exception 'الاسم فارغ'; end if;
  if v_num !~ '^[A-Za-z0-9]{3,20}$' then raise exception 'الرقم غير صالح (3–20 حرفاً أو رقماً إنجليزياً)'; end if;
  if exists (select 1 from profiles where id <> p_user and (university_id = v_num or national_id = v_num or employee_number = v_num)) then
    raise exception 'الرقم مستخدم لشخص آخر';
  end if;
  update profiles set full_name = v_name, university_id = v_num,
         employee_number = case when v_role = 'student' then employee_number else v_num end
   where id = p_user;
end $$;

revoke execute on function public.comm_people_search(text, integer) from public, anon;
revoke execute on function public.comm_person_update(uuid, text, text) from public, anon;
grant execute on function public.comm_people_search(text, integer) to authenticated;
grant execute on function public.comm_person_update(uuid, text, text) to authenticated;
select 'ready';
