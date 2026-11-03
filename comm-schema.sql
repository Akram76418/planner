-- التواصل (قنوات الموظفين + إعلانات الشعب) لتطبيق المنظّم.
-- جداول جديدة بادئتها comm_ فقط. لا يعدّل جداول tawasul ولا دوالها ولا سياساتها.
-- المحادثات الفردية تستخدم دوال tawasul الحالية (send_communication_message وغيرها) ولا تُنشأ هنا.
-- يعتمد على الدالتين الموجودتين: public.current_user_role() و public.planner_ok().
-- شغّله مرة واحدة في Supabase > SQL Editor بعد أخذ نسخة احتياطية.

-- ───────────── الجداول ─────────────

-- تصنيف الموظف (تحدده الإدارة): academic | practical | admin
create table if not exists public.comm_staff_categories (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  category   text not null check (category in ('academic','practical','admin')),
  updated_at timestamptz not null default now()
);

-- الشعب (تحددها الإدارة)
create table if not exists public.comm_cohorts (
  id         integer generated always as identity primary key,
  name       text not null unique check (length(trim(name)) between 1 and 80),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- انتماء الطالب لشعبة واحدة
create table if not exists public.comm_cohort_members (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  cohort_id integer not null references public.comm_cohorts(id) on delete restrict,
  added_at  timestamptz not null default now()
);
create index if not exists comm_cohort_members_cohort_idx on public.comm_cohort_members (cohort_id);

-- رسائل قنوات الموظفين: all | academic | practical | admin
create table if not exists public.comm_channel_messages (
  id         bigint generated always as identity primary key,
  channel    text not null check (channel in ('all','academic','practical','admin')),
  sender_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body       text not null check (length(trim(body)) between 1 and 4000),
  file_path  text,
  file_name  text,
  file_type  text,
  file_size  bigint,
  created_at timestamptz not null default now()
);
create index if not exists comm_channel_messages_idx on public.comm_channel_messages (channel, created_at desc);

-- إعلانات الشعب (من الإدارة فقط)
create table if not exists public.comm_announcements (
  id         bigint generated always as identity primary key,
  cohort_id  integer not null references public.comm_cohorts(id) on delete cascade,
  sender_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text check (title is null or length(title) <= 200),
  body       text not null check (length(trim(body)) between 1 and 4000),
  file_path  text,
  file_name  text,
  file_type  text,
  file_size  bigint,
  created_at timestamptz not null default now()
);
create index if not exists comm_announcements_idx on public.comm_announcements (cohort_id, created_at desc);

-- آخر قراءة لكل مستخدم (لعدّاد غير المقروء). scope مثل: ch:all أو ann
create table if not exists public.comm_reads (
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  scope        text not null check (length(scope) <= 40),
  last_read_at timestamptz not null default now(),
  primary key (user_id, scope)
);

-- ───────────── دوال مساعدة (للصلاحيات) ─────────────

create or replace function public.comm_my_category() returns text
language sql stable security definer set search_path = public as $$
  select category from comm_staff_categories where user_id = auth.uid()
$$;

-- هل يحق للمستخدم الحالي استخدام قناة الموظفين؟
create or replace function public.comm_can_use_channel(ch text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then false
    when public.current_user_role() = 'admin' then true
    when public.current_user_role() in ('professor','staff') then
      ch = 'all' or ch = coalesce(public.comm_my_category(), '#none')
    else false
  end
$$;

-- هل يحق للمستخدم قراءة إعلانات شعبة معينة؟
create or replace function public.comm_can_read_cohort(cid integer) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then false
    when public.current_user_role() in ('admin','professor','staff') then true
    else exists (select 1 from comm_cohort_members m where m.user_id = auth.uid() and m.cohort_id = cid)
  end
$$;

-- ───────────── الصلاحيات على مستوى الصفوف (RLS) ─────────────

alter table public.comm_staff_categories enable row level security;
alter table public.comm_cohorts          enable row level security;
alter table public.comm_cohort_members   enable row level security;
alter table public.comm_channel_messages enable row level security;
alter table public.comm_announcements    enable row level security;
alter table public.comm_reads            enable row level security;

-- التصنيف والشعب: لا سياسات مباشرة، الوصول عبر الدوال أدناه فقط
-- قنوات الموظفين: قراءة وكتابة لمن له حق القناة. الحذف للمدير.
drop policy if exists "channel read"   on public.comm_channel_messages;
drop policy if exists "channel insert" on public.comm_channel_messages;
drop policy if exists "channel delete" on public.comm_channel_messages;
create policy "channel read"   on public.comm_channel_messages for select using (public.comm_can_use_channel(channel));
create policy "channel insert" on public.comm_channel_messages for insert with check (sender_id = auth.uid() and public.comm_can_use_channel(channel));
create policy "channel delete" on public.comm_channel_messages for delete using (public.current_user_role() = 'admin');

-- الإعلانات: قراءة للشعبة المعنية والموظفين، الكتابة والحذف للمدير فقط
drop policy if exists "ann read"   on public.comm_announcements;
drop policy if exists "ann insert" on public.comm_announcements;
drop policy if exists "ann delete" on public.comm_announcements;
create policy "ann read"   on public.comm_announcements for select using (public.comm_can_read_cohort(cohort_id));
create policy "ann insert" on public.comm_announcements for insert with check (sender_id = auth.uid() and public.current_user_role() = 'admin');
create policy "ann delete" on public.comm_announcements for delete using (public.current_user_role() = 'admin');

-- آخر قراءة: لكل مستخدم صفوفه
drop policy if exists "reads own" on public.comm_reads;
create policy "reads own" on public.comm_reads for all using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.comm_staff_categories, public.comm_cohorts, public.comm_cohort_members,
  public.comm_channel_messages, public.comm_announcements, public.comm_reads from anon;
revoke all on public.comm_staff_categories, public.comm_cohorts, public.comm_cohort_members from authenticated;

-- ───────────── دوال الإدارة والواجهة ─────────────

-- سياق المستخدم: يحدد ما يظهر له من أيقونات
create or replace function public.comm_my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'role', public.current_user_role(),
    'category', public.comm_my_category(),
    'cohort_id', (select m.cohort_id from comm_cohort_members m where m.user_id = auth.uid()),
    'cohort_name', (select c.name from comm_cohort_members m join comm_cohorts c on c.id = m.cohort_id where m.user_id = auth.uid()),
    'planner', public.planner_ok()
  )
$$;

create or replace function public.comm_list_cohorts() returns table(id integer, name text, is_active boolean, members bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() not in ('admin','professor','staff') then raise exception 'not allowed'; end if;
  return query select c.id, c.name, c.is_active, (select count(*) from comm_cohort_members m where m.cohort_id = c.id)
               from comm_cohorts c order by c.name;
end $$;

create or replace function public.comm_add_cohort(p_name text) returns integer
language plpgsql security definer set search_path = public as $$
declare new_id integer;
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  insert into comm_cohorts (name) values (trim(p_name))
  on conflict (name) do update set is_active = true returning id into new_id;
  return new_id;
end $$;

create or replace function public.comm_set_staff_category(p_user uuid, p_category text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  if not exists (select 1 from profiles where id = p_user and role::text in ('professor','staff')) then
    raise exception 'user is not an employee';
  end if;
  if p_category is null or p_category = '' then
    delete from comm_staff_categories where user_id = p_user;
  else
    if p_category not in ('academic','practical','admin') then raise exception 'invalid category'; end if;
    insert into comm_staff_categories (user_id, category) values (p_user, p_category)
    on conflict (user_id) do update set category = excluded.category, updated_at = now();
  end if;
end $$;

-- قائمة الموظفين وتصنيفاتهم (للإدارة). لا تُرجع رقم هوية ولا رقماً وظيفياً.
create or replace function public.comm_list_staff() returns table(id uuid, full_name text, role text, category text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  return query select p.id, p.full_name, p.role::text, sc.category
               from profiles p left join comm_staff_categories sc on sc.user_id = p.id
               where p.role::text in ('professor','staff') order by p.full_name;
end $$;

-- قائمة الطلبة وشعبهم (للإدارة)
create or replace function public.comm_list_students(p_cohort integer default null, p_search text default '', p_unassigned boolean default false)
returns table(id uuid, full_name text, university_id text, major text, cohort_id integer, cohort_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  return query
    select p.id, p.full_name, p.university_id, p.major, m.cohort_id, c.name
    from profiles p
    left join comm_cohort_members m on m.user_id = p.id
    left join comm_cohorts c on c.id = m.cohort_id
    where p.role::text = 'student'
      and (p_cohort is null or m.cohort_id = p_cohort)
      and (not p_unassigned or m.user_id is null)
      and (nullif(trim(p_search), '') is null
           or p.full_name ilike '%' || trim(p_search) || '%'
           or coalesce(p.university_id, '') ilike '%' || trim(p_search) || '%')
    order by p.full_name limit 300;
end $$;

create or replace function public.comm_assign_cohort(p_user uuid, p_cohort integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  if not exists (select 1 from profiles where id = p_user and role::text = 'student') then raise exception 'user is not a student'; end if;
  if p_cohort is null then
    delete from comm_cohort_members where user_id = p_user;
  else
    insert into comm_cohort_members (user_id, cohort_id) values (p_user, p_cohort)
    on conflict (user_id) do update set cohort_id = excluded.cohort_id, added_at = now();
  end if;
end $$;

-- إسناد جماعي بالرقم الجامعي. يرجع عدد من أُسند.
create or replace function public.comm_bulk_assign_cohort(p_university_ids text[], p_cohort integer) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  if not exists (select 1 from comm_cohorts where id = p_cohort) then raise exception 'unknown cohort'; end if;
  with ids as (
    select p.id from profiles p
    where p.role::text = 'student' and p.university_id = any (select trim(x) from unnest(p_university_ids) x)
  ), up as (
    insert into comm_cohort_members (user_id, cohort_id)
    select id, p_cohort from ids
    on conflict (user_id) do update set cohort_id = excluded.cohort_id, added_at = now()
    returning 1
  ) select count(*) into n from up;
  return n;
end $$;

-- عدّاد غير المقروء للقنوات والإعلانات
create or replace function public.comm_unread_counts() returns table(scope text, unread bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
    select 'ch:' || ch.channel,
           (select count(*) from comm_channel_messages m
            where m.channel = ch.channel and m.sender_id <> auth.uid()
              and m.created_at > coalesce((select r.last_read_at from comm_reads r where r.user_id = auth.uid() and r.scope = 'ch:' || ch.channel), '-infinity'))
    from (select unnest(array['all','academic','practical','admin']) as channel) ch
    where public.comm_can_use_channel(ch.channel);
  return query
    select 'ann',
           (select count(*) from comm_announcements a
            where public.comm_can_read_cohort(a.cohort_id)
              and (public.current_user_role() = 'admin' or a.cohort_id = (select m.cohort_id from comm_cohort_members m where m.user_id = auth.uid()) or public.current_user_role() in ('professor','staff'))
              and a.created_at > coalesce((select r.last_read_at from comm_reads r where r.user_id = auth.uid() and r.scope = 'ann'), '-infinity'));
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'comm_my_category()','comm_can_use_channel(text)','comm_can_read_cohort(integer)','comm_my_context()',
    'comm_list_cohorts()','comm_add_cohort(text)','comm_set_staff_category(uuid,text)','comm_list_staff()',
    'comm_list_students(integer,text,boolean)','comm_assign_cohort(uuid,integer)','comm_bulk_assign_cohort(text[],integer)','comm_unread_counts()']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ───────────── الملفات المرفقة (حاوية جديدة خاصة) ─────────────
-- مسارات الملفات: ch/<القناة>/<معرّف المرسل>/<اسم>  و  ann/<رقم الشعبة>/<معرّف المرسل>/<اسم>

insert into storage.buckets (id, name, public, file_size_limit)
values ('comm-files', 'comm-files', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "comm files read"   on storage.objects;
drop policy if exists "comm files insert" on storage.objects;
create policy "comm files read" on storage.objects for select to authenticated using (
  bucket_id = 'comm-files' and (
    ((storage.foldername(name))[1] = 'ch'  and public.comm_can_use_channel((storage.foldername(name))[2]))
    or ((storage.foldername(name))[1] = 'ann' and (storage.foldername(name))[2] ~ '^[0-9]+$' and public.comm_can_read_cohort(((storage.foldername(name))[2])::integer))
  ));
create policy "comm files insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'comm-files' and (storage.foldername(name))[3] = auth.uid()::text and (
    ((storage.foldername(name))[1] = 'ch'  and public.comm_can_use_channel((storage.foldername(name))[2]))
    or ((storage.foldername(name))[1] = 'ann' and public.current_user_role() = 'admin')
  ));

-- ───────────── التحديث اللحظي ─────────────
do $$
begin
  begin alter publication supabase_realtime add table public.comm_channel_messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.comm_announcements;    exception when duplicate_object then null; end;
end $$;
