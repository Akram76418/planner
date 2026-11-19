-- (1) إغلاق إنشاء الحسابات ببريد عشوائي بشكل صارم على مستوى قاعدة البيانات
-- (2) قائمة الطلبة: طلبة الكلية والطلبة الخارجيون بنفس الإمكانيات (بحث، إسناد، كلمة افتراضية، حذف)
-- شغّله بعد external-isolation.sql. آمن للتكرار.
-- ملاحظة: حسابات الكلية بريدها الداخلي <الرقم>@planner.local وتُنشأ من إدارة الكلية فقط.

-- ───────── 1) قفل التسجيل ─────────
create table if not exists public.comm_allowed_emails (email text primary key);
alter table public.comm_allowed_emails enable row level security;
revoke all on public.comm_allowed_emails from anon, authenticated;

-- بريد المسؤولين الحاليين يُسمح به تلقائياً
insert into public.comm_allowed_emails (email)
select lower(u.email) from auth.users u join public.profiles p on p.id = u.id where p.role::text = 'admin' and u.email is not null
on conflict do nothing;
insert into public.comm_allowed_emails (email) values ('abusalah76@gmail.com') on conflict do nothing;

create or replace function public.comm_block_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is null or lower(new.email) like '%@planner.local' or exists (select 1 from public.comm_allowed_emails a where a.email = lower(new.email)) then
    return new;
  end if;
  raise exception 'التسجيل مغلق: الحسابات تُنشأ من إدارة الكلية فقط';
end $$;
drop trigger if exists comm_block_signup_trg on auth.users;
create trigger comm_block_signup_trg before insert on auth.users for each row execute function public.comm_block_signup();

-- هل الحساب الحالي مسموح له باستخدام التطبيق؟ (يمنع أيضاً الحسابات الغريبة الموجودة سابقاً)
create or replace function public.comm_login_allowed() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce((select lower(u.email) like '%@planner.local' or exists (select 1 from public.comm_allowed_emails a where a.email = lower(u.email))
                          or exists (select 1 from public.profiles p where p.id = u.id and p.role::text = 'admin')
                   from auth.users u where u.id = auth.uid()), false)
$$;
revoke execute on function public.comm_login_allowed() from public, anon;
grant execute on function public.comm_login_allowed() to authenticated;

-- الحسابات الغريبة (بريد غير داخلي وغير مُدرَج): للمسؤول الرئيسي، لمراجعتها وحذفها
create or replace function public.comm_stray_accounts()
returns table(id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, full_name text, acct_role text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.admin_can('main') then raise exception 'admin only'; end if;
  return query select u.id, u.email::text, u.created_at, u.last_sign_in_at, p.full_name, p.role::text
    from auth.users u left join public.profiles p on p.id = u.id
    where lower(u.email) not like '%@planner.local' and not exists (select 1 from public.comm_allowed_emails a where a.email = lower(u.email))
      and coalesce(p.role::text, '') <> 'admin'
    order by u.created_at desc;
end $$;
revoke execute on function public.comm_stray_accounts() from public, anon;
grant execute on function public.comm_stray_accounts() to authenticated;

-- ───────── 2) طلبة الكلية / الخارجيون ─────────
drop function if exists public.comm_list_students(integer, text, boolean);
create or replace function public.comm_list_students(p_cohort integer default null, p_search text default '', p_unassigned boolean default false, p_external boolean default null)
returns table(id uuid, full_name text, university_id text, major text, cohort_id integer, cohort_name text, is_external boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can('students') then raise exception 'admin only'; end if;
  return query
    select p.id, p.full_name, p.university_id, p.major, m.cohort_id, c.name, public.ex_is_external(p.id)
    from profiles p
    left join comm_cohort_members m on m.user_id = p.id
    left join comm_cohorts c on c.id = m.cohort_id
    where p.role::text = 'student'
      and (case when p_external is null then (p_cohort is not null or not public.ex_is_external(p.id))
                when p_external then public.ex_is_external(p.id) else not public.ex_is_external(p.id) end)
      and (p_cohort is null or m.cohort_id = p_cohort)
      and (not p_unassigned or m.user_id is null)
      and (nullif(trim(p_search), '') is null
           or p.full_name ilike '%' || trim(p_search) || '%'
           or coalesce(p.university_id, '') ilike '%' || trim(p_search) || '%')
    order by p.full_name limit 2000;
end $$;
revoke execute on function public.comm_list_students(integer, text, boolean, boolean) from public, anon;
grant execute on function public.comm_list_students(integer, text, boolean, boolean) to authenticated;

drop function if exists public.comm_pending_passwords();
create or replace function public.comm_pending_passwords() returns table(user_id uuid, full_name text, university_id text, role text, created_at timestamptz, is_external boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can('reset') then raise exception 'admin only'; end if;
  return query select s.user_id, p.full_name, p.university_id, p.role::text, s.created_at, public.ex_is_external(p.id)
               from comm_pw_status s join profiles p on p.id = s.user_id
               where s.must_change order by p.full_name;
end $$;
revoke execute on function public.comm_pending_passwords() from public, anon;
grant execute on function public.comm_pending_passwords() to authenticated;

select 'ready' as status;
