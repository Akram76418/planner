-- تحديثات: أكثر من أكاديمي للشعبة، قنوات كاملة لعضو هيئة التدريس، وإصلاح اسم PCN.
-- شغّله مرة واحدة بعد admin-tools.sql. يضيف جدولاً ويستبدل دوالاً فقط، ولا يحذف بيانات.

-- 1) عضو هيئة التدريس يرى كل قنوات الموظفين مثل المدير (الموظف العادي: «الجميع» + تصنيفه)
create or replace function public.comm_can_use_channel(ch text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then false
    when public.current_user_role() in ('admin', 'professor') then true
    when public.current_user_role() = 'staff' then ch = 'all' or ch = coalesce(public.comm_my_category(), '#none')
    else false
  end
$$;

-- 2) أسماء/معرّفات المدراء لإظهارهم باسم PCN (الاسم المشترك مع غير المدير لا يُعتمد)
create or replace function public.comm_admin_names() returns setof text
language sql stable security definer set search_path = public as $$
  select a.full_name from profiles a
  where a.role::text = 'admin' and a.full_name is not null
    and not exists (select 1 from profiles o where o.role::text <> 'admin' and o.full_name = a.full_name)
$$;
create or replace function public.comm_admin_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from profiles where role::text = 'admin'
$$;
revoke execute on function public.comm_admin_names(), public.comm_admin_ids() from public, anon;
grant execute on function public.comm_admin_names(), public.comm_admin_ids() to authenticated;

-- 3) أكثر من عضو هيئة تدريس للشعبة
create table if not exists public.comm_cohort_profs (
  cohort_id integer not null references public.comm_cohorts(id) on delete cascade,
  prof_id   uuid    not null references auth.users(id) on delete cascade,
  primary key (cohort_id, prof_id)
);
alter table public.comm_cohort_profs enable row level security;
revoke all on public.comm_cohort_profs from anon, authenticated;

drop function if exists public.comm_cohort_professors();
create or replace function public.comm_cohort_professors()
returns table(cohort_id integer, cohort_name text, members bigint, profs jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  return query
    select c.id, c.name,
      (select count(*) from comm_cohort_members m where m.cohort_id = c.id),
      coalesce((select jsonb_agg(jsonb_build_object('id', cp.prof_id, 'name', p.full_name) order by p.full_name)
                from comm_cohort_profs cp join profiles p on p.id = cp.prof_id where cp.cohort_id = c.id), '[]'::jsonb)
    from comm_cohorts c order by c.name;
end $$;

-- تعيين مجموعة الأكاديميين للشعبة. الأول في الترتيب يصبح «المشرف» في ملف كل طالب (professor_id).
create or replace function public.comm_assign_professors(p_cohort integer, p_profs uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; first_p uuid;
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  p_profs := coalesce(p_profs, '{}');
  if exists (select 1 from unnest(p_profs) x where not exists (select 1 from profiles where id = x and role::text = 'professor')) then
    raise exception 'المشرف يجب أن يكون من نوع عضو هيئة تدريس';
  end if;
  delete from comm_cohort_profs where cohort_id = p_cohort;
  insert into comm_cohort_profs (cohort_id, prof_id) select p_cohort, x from unnest(p_profs) x;
  first_p := p_profs[1];
  update profiles set professor_id = first_p
   where role::text = 'student' and id in (select user_id from comm_cohort_members where cohort_id = p_cohort);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.comm_cohort_professors(), public.comm_assign_professors(integer, uuid[]) from public, anon;
grant execute on function public.comm_cohort_professors(), public.comm_assign_professors(integer, uuid[]) to authenticated;
