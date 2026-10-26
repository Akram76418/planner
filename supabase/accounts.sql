-- الحسابات وكلمة المرور الأولى + ملفات المحادثات الفردية.
-- شغّله بعد comm-schema.sql. لا يعدّل جداول tawasul ولا دوالها، فقط يضيف جداول ودوال بادئتها comm_.
-- ويستبدل سياستي ملفات comm-files (التي أنشأناها نحن) لإضافة مسار المحادثات الفردية dm/.

-- ───── حالة كلمة المرور: صف لكل حساب أنشأته الإدارة (أو أعادت كلمته) ─────
create table if not exists public.comm_pw_status (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  must_change boolean not null default true,
  created_at  timestamptz not null default now(),
  changed_at  timestamptz
);
alter table public.comm_pw_status enable row level security;
revoke all on public.comm_pw_status from anon, authenticated;

-- تحويل رقم الجامعة إلى بريد الدخول (لشاشة الدخول قبل تسجيل الدخول). يرجع البريد فقط، ولا يخدم حسابات المدير.
create or replace function public.comm_resolve_login(p_id text) returns text
language sql stable security definer set search_path = public, auth as $$
  select u.email::text from public.profiles p join auth.users u on u.id = p.id
  where p.university_id = trim(p_id) and p.role::text <> 'admin' limit 1
$$;
revoke execute on function public.comm_resolve_login(text) from public;
grant execute on function public.comm_resolve_login(text) to anon, authenticated;

-- سياق المستخدم (نفس الدالة السابقة + must_change + الاسم)
create or replace function public.comm_my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'role', public.current_user_role(),
    'name', (select p.full_name from profiles p where p.id = auth.uid()),
    'category', public.comm_my_category(),
    'cohort_id', (select m.cohort_id from comm_cohort_members m where m.user_id = auth.uid()),
    'cohort_name', (select c.name from comm_cohort_members m join comm_cohorts c on c.id = m.cohort_id where m.user_id = auth.uid()),
    'planner', public.planner_ok(),
    'must_change', coalesce((select s.must_change from comm_pw_status s where s.user_id = auth.uid()), false)
  )
$$;

create or replace function public.comm_password_changed() returns void
language sql security definer set search_path = public as $$
  update public.comm_pw_status set must_change = false, changed_at = now() where user_id = auth.uid()
$$;

-- من لم يغيّر كلمته الافتراضية بعد (للإدارة)
create or replace function public.comm_pending_passwords() returns table(user_id uuid, full_name text, university_id text, role text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  return query select s.user_id, p.full_name, p.university_id, p.role::text, s.created_at
               from comm_pw_status s join profiles p on p.id = s.user_id
               where s.must_change order by p.full_name;
end $$;

-- ───── ملفات المحادثات الفردية ─────
create table if not exists public.comm_dm_files (
  id              bigint generated always as identity primary key,
  message_id      bigint not null unique,
  conversation_id uuid   not null,
  sender_id       uuid   not null,
  file_path       text   not null,
  file_name       text,
  file_type       text,
  file_size       bigint,
  created_at      timestamptz not null default now()
);
alter table public.comm_dm_files enable row level security;
revoke all on public.comm_dm_files from anon, authenticated;

-- رسائل محادثة فردية (للمشاركين فقط) مع ملفها إن وُجد
create or replace function public.comm_dm_messages(p_conv uuid, p_before bigint default null, p_limit integer default 50)
returns table(id bigint, sender_id uuid, sender_name text, body text, created_at timestamptz, file_path text, file_name text, file_type text, file_size bigint)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not exists (select 1 from communication_conversation_participants cp where cp.conversation_id = p_conv and cp.user_id = auth.uid()) then
    raise exception 'not a participant';
  end if;
  return query
    select m.id, m.sender_id, p.full_name, m.body, m.created_at, f.file_path, f.file_name, f.file_type, f.file_size
    from communication_messages m
    left join profiles p on p.id = m.sender_id
    left join comm_dm_files f on f.message_id = m.id
    where m.conversation_id = p_conv and m.deleted_at is null and (p_before is null or m.id < p_before)
    order by m.id desc limit greatest(1, least(coalesce(p_limit, 50), 100));
end $$;

create or replace function public.comm_dm_attach(p_message bigint, p_path text, p_name text, p_type text, p_size bigint) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare conv uuid;
begin
  select m.conversation_id into conv from communication_messages m where m.id = p_message and m.sender_id = auth.uid();
  if conv is null then raise exception 'not your message'; end if;
  if p_path not like 'dm/' || conv::text || '/' || auth.uid()::text || '/%' then raise exception 'bad path'; end if;
  insert into comm_dm_files (message_id, conversation_id, sender_id, file_path, file_name, file_type, file_size)
  values (p_message, conv, auth.uid(), p_path, left(p_name, 200), left(p_type, 100), p_size)
  on conflict (message_id) do nothing;
end $$;

do $$
declare f text;
begin
  foreach f in array array['comm_my_context()','comm_password_changed()','comm_pending_passwords()',
    'comm_dm_messages(uuid,bigint,integer)','comm_dm_attach(bigint,text,text,text,bigint)']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ───── سياسات ملفات التخزين (استبدال سياستينا لإضافة dm/) ─────
drop policy if exists "comm files read"   on storage.objects;
drop policy if exists "comm files insert" on storage.objects;
create policy "comm files read" on storage.objects for select to authenticated using (
  bucket_id = 'comm-files' and (
    ((storage.foldername(name))[1] = 'ch'  and public.comm_can_use_channel((storage.foldername(name))[2]))
    or ((storage.foldername(name))[1] = 'ann' and (storage.foldername(name))[2] ~ '^[0-9]+$' and public.comm_can_read_cohort(((storage.foldername(name))[2])::integer))
    or ((storage.foldername(name))[1] = 'dm' and (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$' and exists (
          select 1 from public.communication_conversation_participants cp
          where cp.conversation_id = ((storage.foldername(name))[2])::uuid and cp.user_id = auth.uid()))
  ));
create policy "comm files insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'comm-files' and (storage.foldername(name))[3] = auth.uid()::text and (
    ((storage.foldername(name))[1] = 'ch'  and public.comm_can_use_channel((storage.foldername(name))[2]))
    or ((storage.foldername(name))[1] = 'ann' and public.current_user_role() = 'admin')
    or ((storage.foldername(name))[1] = 'dm' and (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$' and exists (
          select 1 from public.communication_conversation_participants cp
          where cp.conversation_id = ((storage.foldername(name))[2])::uuid and cp.user_id = auth.uid()))
  ));

-- ───── قراءة القنوات والإعلانات مع اسم المرسل ─────
create or replace function public.comm_channel_list(p_channel text, p_before bigint default null, p_limit integer default 60)
returns table(id bigint, sender_id uuid, sender_name text, body text, file_path text, file_name text, file_type text, file_size bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.comm_can_use_channel(p_channel) then raise exception 'not allowed'; end if;
  return query select m.id, m.sender_id, p.full_name, m.body, m.file_path, m.file_name, m.file_type, m.file_size, m.created_at
    from comm_channel_messages m left join profiles p on p.id = m.sender_id
    where m.channel = p_channel and (p_before is null or m.id < p_before)
    order by m.id desc limit greatest(1, least(coalesce(p_limit, 60), 100));
end $$;

create or replace function public.comm_ann_list(p_cohort integer, p_before bigint default null, p_limit integer default 40)
returns table(id bigint, sender_name text, title text, body text, file_path text, file_name text, file_type text, file_size bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.comm_can_read_cohort(p_cohort) then raise exception 'not allowed'; end if;
  return query select a.id, p.full_name, a.title, a.body, a.file_path, a.file_name, a.file_type, a.file_size, a.created_at
    from comm_announcements a left join profiles p on p.id = a.sender_id
    where a.cohort_id = p_cohort and (p_before is null or a.id < p_before)
    order by a.id desc limit greatest(1, least(coalesce(p_limit, 40), 100));
end $$;

do $$
declare f text;
begin
  foreach f in array array['comm_channel_list(text,bigint,integer)','comm_ann_list(integer,bigint,integer)']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
