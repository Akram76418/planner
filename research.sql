-- أبحاث الماجستير: مجموعات (مشرف + طلبة) ← محادثة جماعية وفردية بمرفقات، مكتبة ملفات بنسخ، ومتتبّع مراحل البحث.
-- يعمل بعد subadmin.sql (admin_can). آمن لإعادة التشغيل. كل الوصول عبر دوال SECURITY DEFINER؛ الجداول مغلقة على المتصفح.
-- صلاحية الإدارة الشاملة: المدير الرئيسي أو من منحه الصلاحية «rs» (أبحاث الماجستير). المدرّس ينشئ مجموعاته ويكون مشرفها.
-- الخصوصية: المحادثة الفردية يراها طرفاها فقط (حتى المشرف والمدير لا يقرؤونها)، والمرحلة يراها صاحبها والمشرف.

alter table public.comm_cohorts add column if not exists is_external boolean not null default false;
create or replace function public.ex_is_external(p_uid uuid) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select exists (select 1 from comm_cohort_members m join comm_cohorts c on c.id = m.cohort_id where m.user_id = p_uid and c.is_external)
$$;
revoke execute on function public.ex_is_external(uuid) from public, anon, authenticated;

-- ───── الجداول ─────
create table if not exists public.rs_groups (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 1 and 160),
  description text check (description is null or length(description) <= 1000),
  created_by uuid not null default auth.uid(),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.rs_members (
  group_id bigint not null references public.rs_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'student' check (role in ('supervisor', 'student', 'member')),
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists rs_members_user on public.rs_members (user_id);
create table if not exists public.rs_threads (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.rs_groups(id) on delete cascade,
  kind text not null check (kind in ('group', 'direct')),
  a uuid, b uuid,
  created_at timestamptz not null default now(),
  check ((kind = 'group' and a is null and b is null) or (kind = 'direct' and a is not null and b is not null and a < b))
);
create unique index if not exists rs_threads_group_u on public.rs_threads (group_id) where kind = 'group';
create unique index if not exists rs_threads_direct_u on public.rs_threads (group_id, a, b) where kind = 'direct';
create table if not exists public.rs_messages (
  id bigint generated always as identity primary key,
  thread_id bigint not null references public.rs_threads(id) on delete cascade,
  sender_id uuid not null,
  body text not null default '' check (length(body) <= 4000),
  file_path text, file_name text, file_type text, file_size bigint,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  check (length(trim(body)) > 0 or file_path is not null or deleted)
);
create index if not exists rs_messages_t on public.rs_messages (thread_id, id);
create table if not exists public.rs_reads (
  thread_id bigint not null references public.rs_threads(id) on delete cascade,
  user_id uuid not null, last_id bigint not null default 0,
  primary key (thread_id, user_id)
);
create table if not exists public.rs_files (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.rs_groups(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  version integer not null default 1,
  uploader uuid not null,
  file_path text not null, file_name text not null, file_type text, file_size bigint,
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists rs_files_g on public.rs_files (group_id, (lower(title)), version);
create table if not exists public.rs_milestones (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.rs_groups(id) on delete cascade,
  student_id uuid not null,
  title text not null check (length(trim(title)) between 1 and 200),
  due_date date,
  status text not null default 'todo' check (status in ('todo', 'doing', 'review', 'done')),
  note text check (note is null or length(note) <= 1000),
  sup_note text check (sup_note is null or length(sup_note) <= 1000),
  approved_by uuid, approved_at timestamptz,
  pos integer not null default 0,
  created_by uuid, created_at timestamptz not null default now()
);
create index if not exists rs_ms_g on public.rs_milestones (group_id, student_id, pos);
alter table public.rs_groups enable row level security;
alter table public.rs_members enable row level security;
alter table public.rs_threads enable row level security;
alter table public.rs_messages enable row level security;
alter table public.rs_reads enable row level security;
alter table public.rs_files enable row level security;
alter table public.rs_milestones enable row level security;
revoke all on public.rs_groups, public.rs_members, public.rs_threads, public.rs_messages, public.rs_reads, public.rs_files, public.rs_milestones from anon, authenticated;

-- ───── مساعدات الصلاحيات ─────
create or replace function public.rs_is_member(p_group bigint) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select exists (select 1 from rs_members where group_id = p_group and user_id = auth.uid())
$$;
create or replace function public.rs_is_sup(p_group bigint) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select public.admin_can('rs') or exists (select 1 from rs_members where group_id = p_group and user_id = auth.uid() and role = 'supervisor')
$$;
create or replace function public.rs_can_see(p_group bigint) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select public.rs_is_member(p_group) or public.admin_can('rs')
$$;
create or replace function public.rs_thread_ok(p_thread bigint) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select exists (select 1 from rs_threads t where t.id = p_thread and public.rs_is_member(t.group_id)
                 and (t.kind = 'group' or auth.uid() in (t.a, t.b)))
$$;
-- مسار الملف: g<رقم المجموعة>/... لملفات المجموعة والمكتبة، d<رقم المحادثة>/... لمرفقات المحادثة الفردية
create or replace function public.rs_path_ok(p_name text) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when split_part(p_name, '/', 1) ~ '^g[0-9]{1,15}$' then public.rs_can_see(substr(split_part(p_name, '/', 1), 2)::bigint)
    when split_part(p_name, '/', 1) ~ '^d[0-9]{1,15}$' then public.rs_thread_ok(substr(split_part(p_name, '/', 1), 2)::bigint)
    else false end
$$;
create or replace function public.rs_path_orphan(p_name text) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select public.rs_path_ok(p_name) and not exists (select 1 from rs_files where file_path = p_name) and not exists (select 1 from rs_messages where file_path = p_name)
$$;
revoke execute on function public.rs_is_member(bigint), public.rs_is_sup(bigint), public.rs_can_see(bigint), public.rs_thread_ok(bigint), public.rs_path_ok(text), public.rs_path_orphan(text) from public, anon;
grant execute on function public.rs_is_member(bigint), public.rs_is_sup(bigint), public.rs_can_see(bigint), public.rs_thread_ok(bigint), public.rs_path_ok(text), public.rs_path_orphan(text) to authenticated;

-- ───── المجموعات والأعضاء ─────
create or replace function public.rs_my_groups()
returns table(id bigint, name text, description text, my_role text, members bigint, unread bigint, archived boolean, overdue bigint)
language sql stable security definer set search_path = public set row_security = off as $$
  select g.id, g.name, g.description, coalesce(m.role, 'admin'),
    (select count(*) from rs_members x where x.group_id = g.id),
    (select count(*) from rs_messages ms join rs_threads t on t.id = ms.thread_id
      where t.group_id = g.id and not ms.deleted and ms.sender_id <> auth.uid() and m.user_id is not null and public.rs_thread_ok(t.id)
        and ms.id > coalesce((select r.last_id from rs_reads r where r.thread_id = t.id and r.user_id = auth.uid()), 0)),
    g.archived,
    (select count(*) from rs_milestones s where s.group_id = g.id and s.status <> 'done' and s.due_date < current_date and (s.student_id = auth.uid() or public.rs_is_sup(g.id)))
  from rs_groups g left join rs_members m on m.group_id = g.id and m.user_id = auth.uid()
  where auth.uid() is not null and (m.user_id is not null or public.admin_can('rs'))
  order by g.archived, g.id desc
$$;

create or replace function public.rs_group_create(p_name text, p_desc text default null) returns bigint
language plpgsql security definer set search_path = public set row_security = off as $$
declare gid bigint;
begin
  if not (public.admin_can('rs') or public.current_user_role() = 'professor') then raise exception 'ينشئ المجموعات المدرّسون والمدير فقط'; end if;
  insert into rs_groups (name, description, created_by) values (trim(p_name), nullif(trim(coalesce(p_desc, '')), ''), auth.uid()) returning id into gid;
  insert into rs_members (group_id, user_id, role) values (gid, auth.uid(), 'supervisor');
  insert into rs_threads (group_id, kind) values (gid, 'group');
  return gid;
end $$;

create or replace function public.rs_group_update(p_id bigint, p_name text, p_desc text, p_archived boolean) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
begin
  if not public.rs_is_sup(p_id) then raise exception 'not allowed'; end if;
  update rs_groups set name = trim(p_name), description = nullif(trim(coalesce(p_desc, '')), ''), archived = coalesce(p_archived, false) where id = p_id;
end $$;

-- يعيد مسارات الملفات ليحذفها المتصفح من التخزين بعد الحذف
create or replace function public.rs_group_delete(p_id bigint) returns text[]
language plpgsql security definer set search_path = public set row_security = off as $$
declare paths text[];
begin
  if not public.rs_is_sup(p_id) then raise exception 'not allowed'; end if;
  select coalesce(array_agg(x), '{}') into paths from (
    select file_path x from rs_files where group_id = p_id
    union all select ms.file_path from rs_messages ms join rs_threads t on t.id = ms.thread_id where t.group_id = p_id and ms.file_path is not null) q;
  delete from rs_groups where id = p_id;
  return paths;
end $$;

create or replace function public.rs_members_list(p_group bigint)
returns table(user_id uuid, full_name text, role text, university_id text, acct_role text)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.rs_can_see(p_group) then raise exception 'not allowed'; end if;
  return query select m.user_id, p.full_name, m.role, case when public.rs_is_sup(p_group) then p.university_id end, p.role::text
    from rs_members m join profiles p on p.id = m.user_id where m.group_id = p_group
    order by (m.role = 'supervisor') desc, p.full_name;
end $$;

create or replace function public.rs_find_people(p_q text) returns table(id uuid, full_name text, acct_role text, university_id text)
language plpgsql stable security definer set search_path = public set row_security = off as $$
declare q text := trim(coalesce(p_q, ''));
begin
  if not (public.admin_can('rs') or public.current_user_role() = 'professor') then raise exception 'not allowed'; end if;
  if length(q) < 2 then return; end if;
  return query select p.id, p.full_name, p.role::text, p.university_id from profiles p
    where p.role::text in ('student', 'professor', 'staff') and not public.ex_is_external(p.id)
      and (p.full_name ilike '%' || q || '%' or coalesce(p.university_id, '') ilike '%' || q || '%' or coalesce(p.employee_number, '') ilike '%' || q || '%')
    order by p.full_name limit 20;
end $$;

create or replace function public.rs_member_set(p_group bigint, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
begin
  if not public.rs_is_sup(p_group) then raise exception 'not allowed'; end if;
  if p_role not in ('supervisor', 'student', 'member') then raise exception 'bad role'; end if;
  if not exists (select 1 from profiles where id = p_user and role::text in ('student', 'professor', 'staff')) then raise exception 'المستخدم غير صالح للإضافة'; end if;
  if p_role <> 'supervisor' and exists (select 1 from rs_members where group_id = p_group and user_id = p_user and role = 'supervisor')
     and not exists (select 1 from rs_members where group_id = p_group and user_id <> p_user and role = 'supervisor') then raise exception 'يجب أن يبقى مشرف واحد على الأقل'; end if;
  insert into rs_members (group_id, user_id, role) values (p_group, p_user, p_role) on conflict (group_id, user_id) do update set role = excluded.role;
end $$;

create or replace function public.rs_member_remove(p_group bigint, p_user uuid) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
begin
  if not (public.rs_is_sup(p_group) or p_user = auth.uid()) then raise exception 'not allowed'; end if;
  if exists (select 1 from rs_members where group_id = p_group and user_id = p_user and role = 'supervisor')
     and not exists (select 1 from rs_members where group_id = p_group and user_id <> p_user and role = 'supervisor') then raise exception 'لا يمكن إزالة المشرف الوحيد'; end if;
  delete from rs_members where group_id = p_group and user_id = p_user;
end $$;

-- ───── المحادثات ─────
create or replace function public.rs_threads(p_group bigint)
returns table(id bigint, kind text, other_id uuid, other_name text, last_at timestamptz, unread bigint)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.rs_is_member(p_group) then raise exception 'not allowed'; end if;
  return query select t.id, t.kind,
      case when t.kind = 'direct' then (case when t.a = auth.uid() then t.b else t.a end) end,
      case when t.kind = 'direct' then (select p.full_name from profiles p where p.id = (case when t.a = auth.uid() then t.b else t.a end)) end,
      (select max(m.created_at) from rs_messages m where m.thread_id = t.id and not m.deleted),
      (select count(*) from rs_messages m where m.thread_id = t.id and not m.deleted and m.sender_id <> auth.uid()
         and m.id > coalesce((select r.last_id from rs_reads r where r.thread_id = t.id and r.user_id = auth.uid()), 0))
    from rs_threads t where t.group_id = p_group and public.rs_thread_ok(t.id)
    order by (t.kind = 'group') desc, 5 desc nulls last;
end $$;

create or replace function public.rs_direct_open(p_group bigint, p_other uuid) returns bigint
language plpgsql security definer set search_path = public set row_security = off as $$
declare va uuid := least(auth.uid(), p_other);
        vb uuid := greatest(auth.uid(), p_other);
        tid bigint;
begin
  if p_other = auth.uid() or not public.rs_is_member(p_group) or not exists (select 1 from rs_members where group_id = p_group and user_id = p_other) then raise exception 'not allowed'; end if;
  insert into rs_threads (group_id, kind, a, b) values (p_group, 'direct', va, vb) on conflict do nothing;
  select t.id into tid from rs_threads t where t.group_id = p_group and t.kind = 'direct' and t.a = va and t.b = vb;
  return tid;
end $$;

create or replace function public.rs_msgs(p_thread bigint, p_before bigint default null, p_limit integer default 60)
returns table(id bigint, sender_id uuid, sender_name text, body text, file_path text, file_name text, file_type text, file_size bigint, deleted boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.rs_thread_ok(p_thread) then raise exception 'not allowed'; end if;
  return query select m.id, m.sender_id, p.full_name, case when m.deleted then '' else m.body end, case when m.deleted then null else m.file_path end,
      case when m.deleted then null else m.file_name end, case when m.deleted then null else m.file_type end, case when m.deleted then null else m.file_size end, m.deleted, m.created_at
    from rs_messages m left join profiles p on p.id = m.sender_id
    where m.thread_id = p_thread and (p_before is null or m.id < p_before)
    order by m.id desc limit greatest(1, least(coalesce(p_limit, 60), 200));
end $$;

create or replace function public.rs_msg_send(p_thread bigint, p_body text, p_path text default null, p_name text default null, p_type text default null, p_size bigint default null) returns bigint
language plpgsql security definer set search_path = public set row_security = off as $$
declare t rs_threads; mid bigint; body text := trim(coalesce(p_body, ''));
begin
  if not public.rs_thread_ok(p_thread) then raise exception 'not allowed'; end if;
  select * into t from rs_threads where id = p_thread;
  if length(body) > 4000 then raise exception 'الرسالة طويلة'; end if;
  if p_path is not null then
    if p_path !~ ('^' || case when t.kind = 'group' then 'g' || t.group_id else 'd' || t.id end || '/[A-Za-z0-9._/-]{1,200}$') then raise exception 'مسار الملف غير صحيح'; end if;
    if coalesce(p_size, 0) > 26214400 then raise exception 'الملف أكبر من 25 ميغابايت'; end if;
  end if;
  if body = '' and p_path is null then raise exception 'الرسالة فارغة'; end if;
  insert into rs_messages (thread_id, sender_id, body, file_path, file_name, file_type, file_size)
  values (p_thread, auth.uid(), body, p_path, left(p_name, 200), left(p_type, 100), p_size) returning id into mid;
  insert into rs_reads (thread_id, user_id, last_id) values (p_thread, auth.uid(), mid) on conflict (thread_id, user_id) do update set last_id = greatest(rs_reads.last_id, mid);
  return mid;
end $$;

-- حذف رسالة: صاحبها، أو المشرف في المحادثة الجماعية. يعيد مسار الملف ليُحذف من التخزين.
create or replace function public.rs_msg_delete(p_id bigint) returns text
language plpgsql security definer set search_path = public set row_security = off as $$
declare m rs_messages; t rs_threads;
begin
  select * into m from rs_messages where id = p_id; if not found then return null; end if;
  select * into t from rs_threads where id = m.thread_id;
  if not public.rs_thread_ok(m.thread_id) or not (m.sender_id = auth.uid() or (t.kind = 'group' and public.rs_is_sup(t.group_id))) then raise exception 'not allowed'; end if;
  update rs_messages set deleted = true, file_path = null, body = '' where id = p_id;
  return m.file_path;
end $$;

create or replace function public.rs_mark_read(p_thread bigint) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare mx bigint;
begin
  if not public.rs_thread_ok(p_thread) then return; end if;
  select coalesce(max(id), 0) into mx from rs_messages where thread_id = p_thread;
  insert into rs_reads (thread_id, user_id, last_id) values (p_thread, auth.uid(), mx) on conflict (thread_id, user_id) do update set last_id = greatest(rs_reads.last_id, mx);
end $$;

-- ───── مكتبة الملفات (نسخ) ─────
create or replace function public.rs_files_list(p_group bigint)
returns table(id bigint, title text, version integer, uploader uuid, uploader_name text, file_path text, file_name text, file_type text, file_size bigint, note text, created_at timestamptz)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.rs_can_see(p_group) then raise exception 'not allowed'; end if;
  return query select f.id, f.title, f.version, f.uploader, p.full_name, f.file_path, f.file_name, f.file_type, f.file_size, f.note, f.created_at
    from rs_files f left join profiles p on p.id = f.uploader where f.group_id = p_group order by lower(f.title), f.version desc;
end $$;

create or replace function public.rs_file_add(p_group bigint, p_title text, p_note text, p_path text, p_name text, p_type text, p_size bigint) returns bigint
language plpgsql security definer set search_path = public set row_security = off as $$
declare v integer; fid bigint;
begin
  if not public.rs_is_member(p_group) then raise exception 'not allowed'; end if;
  if p_path !~ ('^g' || p_group || '/[A-Za-z0-9._/-]{1,200}$') then raise exception 'مسار الملف غير صحيح'; end if;
  if coalesce(p_size, 0) > 26214400 then raise exception 'الملف أكبر من 25 ميغابايت'; end if;
  select coalesce(max(version), 0) + 1 into v from rs_files where group_id = p_group and lower(title) = lower(trim(p_title));
  insert into rs_files (group_id, title, version, uploader, file_path, file_name, file_type, file_size, note)
  values (p_group, trim(p_title), v, auth.uid(), p_path, left(p_name, 200), left(p_type, 100), p_size, nullif(left(trim(coalesce(p_note, '')), 500), '')) returning id into fid;
  return fid;
end $$;

create or replace function public.rs_file_delete(p_id bigint) returns text
language plpgsql security definer set search_path = public set row_security = off as $$
declare f rs_files;
begin
  select * into f from rs_files where id = p_id; if not found then return null; end if;
  if not (f.uploader = auth.uid() or public.rs_is_sup(f.group_id)) then raise exception 'not allowed'; end if;
  delete from rs_files where id = p_id; return f.file_path;
end $$;

-- ───── مراحل البحث ─────
create or replace function public.rs_ms_list(p_group bigint)
returns table(id bigint, student_id uuid, student_name text, title text, due_date date, status text, note text, sup_note text, approved_at timestamptz, pos integer)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.rs_can_see(p_group) then raise exception 'not allowed'; end if;
  return query select s.id, s.student_id, p.full_name, s.title, s.due_date, s.status, s.note, s.sup_note, s.approved_at, s.pos
    from rs_milestones s left join profiles p on p.id = s.student_id
    where s.group_id = p_group and (public.rs_is_sup(p_group) or s.student_id = auth.uid())
    order by p.full_name, s.pos, s.id;
end $$;

create or replace function public.rs_ms_save(p_id bigint, p_group bigint, p_student uuid, p_title text, p_due date, p_note text) returns bigint
language plpgsql security definer set search_path = public set row_security = off as $$
declare rid bigint;
begin
  if not public.rs_is_sup(p_group) then raise exception 'not allowed'; end if;
  if not exists (select 1 from rs_members where group_id = p_group and user_id = p_student) then raise exception 'الطالب ليس عضواً في المجموعة'; end if;
  if p_id is null then
    insert into rs_milestones (group_id, student_id, title, due_date, note, pos, created_by)
    values (p_group, p_student, trim(p_title), p_due, nullif(trim(coalesce(p_note, '')), ''), coalesce((select max(pos) + 1 from rs_milestones where group_id = p_group and student_id = p_student), 0), auth.uid()) returning id into rid;
  else
    update rs_milestones set title = trim(p_title), due_date = p_due, note = nullif(trim(coalesce(p_note, '')), '') where id = p_id and group_id = p_group returning id into rid;
  end if;
  return rid;
end $$;

create or replace function public.rs_ms_status(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare s rs_milestones;
begin
  select * into s from rs_milestones where id = p_id; if not found then raise exception 'not found'; end if;
  if p_status not in ('todo', 'doing', 'review', 'done') then raise exception 'bad status'; end if;
  if not (public.rs_is_sup(s.group_id) or (s.student_id = auth.uid() and public.rs_is_member(s.group_id) and p_status <> 'done')) then raise exception 'الاعتماد النهائي للمشرف فقط'; end if;
  update rs_milestones set status = p_status, approved_by = case when p_status = 'done' then auth.uid() else null end, approved_at = case when p_status = 'done' then now() else null end where id = p_id;
end $$;

create or replace function public.rs_ms_approve(p_id bigint, p_note text default null) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare s rs_milestones;
begin
  select * into s from rs_milestones where id = p_id; if not found then raise exception 'not found'; end if;
  if not public.rs_is_sup(s.group_id) then raise exception 'not allowed'; end if;
  update rs_milestones set status = 'done', approved_by = auth.uid(), approved_at = now(), sup_note = nullif(trim(coalesce(p_note, '')), '') where id = p_id;
end $$;

create or replace function public.rs_ms_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare s rs_milestones;
begin
  select * into s from rs_milestones where id = p_id; if not found then return; end if;
  if not public.rs_is_sup(s.group_id) then raise exception 'not allowed'; end if;
  delete from rs_milestones where id = p_id;
end $$;

-- مراحل افتراضية لرسالة الماجستير (تُضاف فقط إن لم يكن للطالب مراحل)
create or replace function public.rs_ms_template(p_group bigint, p_student uuid) returns integer
language plpgsql security definer set search_path = public set row_security = off as $$
declare titles text[] := array['اعتماد عنوان البحث والمقترح', 'الإطار النظري ومراجعة الأدبيات', 'موافقة لجنة الأخلاقيات والإذن بجمع البيانات', 'أداة الدراسة: التحكيم والصدق والثبات', 'جمع البيانات', 'التحليل الإحصائي وعرض النتائج', 'كتابة الفصول وتسليم المسودة الأولى', 'المراجعة النهائية وتسليم النسخة للتحكيم', 'المناقشة'];
        i integer;
begin
  if not public.rs_is_sup(p_group) then raise exception 'not allowed'; end if;
  if not exists (select 1 from rs_members where group_id = p_group and user_id = p_student) then raise exception 'الطالب ليس عضواً في المجموعة'; end if;
  if exists (select 1 from rs_milestones where group_id = p_group and student_id = p_student) then return 0; end if;
  for i in 1..array_length(titles, 1) loop
    insert into rs_milestones (group_id, student_id, title, pos, created_by) values (p_group, p_student, titles[i], i, auth.uid());
  end loop;
  return array_length(titles, 1);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'rs_my_groups()', 'rs_group_create(text,text)', 'rs_group_update(bigint,text,text,boolean)', 'rs_group_delete(bigint)', 'rs_members_list(bigint)', 'rs_find_people(text)',
    'rs_member_set(bigint,uuid,text)', 'rs_member_remove(bigint,uuid)', 'rs_threads(bigint)', 'rs_direct_open(bigint,uuid)', 'rs_msgs(bigint,bigint,integer)',
    'rs_msg_send(bigint,text,text,text,text,bigint)', 'rs_msg_delete(bigint)', 'rs_mark_read(bigint)', 'rs_files_list(bigint)', 'rs_file_add(bigint,text,text,text,text,text,bigint)',
    'rs_file_delete(bigint)', 'rs_ms_list(bigint)', 'rs_ms_save(bigint,bigint,uuid,text,date,text)', 'rs_ms_status(bigint,text)', 'rs_ms_approve(bigint,text)', 'rs_ms_delete(bigint)', 'rs_ms_template(bigint,uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ───── التخزين: حاوية خاصة بالأبحاث (25 ميغابايت للملف) ─────
do $$
begin
  if to_regclass('storage.objects') is null then raise notice 'storage غير متاح: تخطّي إعداد الحاوية'; return; end if;
  insert into storage.buckets (id, name, public, file_size_limit) values ('research-files', 'research-files', false, 26214400)
  on conflict (id) do update set file_size_limit = 26214400, public = false;
  execute 'drop policy if exists "rs files read" on storage.objects';
  execute 'drop policy if exists "rs files insert" on storage.objects';
  execute 'drop policy if exists "rs files delete" on storage.objects';
  execute 'create policy "rs files read" on storage.objects for select to authenticated using (bucket_id = ''research-files'' and public.rs_path_ok(name))';
  execute 'create policy "rs files insert" on storage.objects for insert to authenticated with check (bucket_id = ''research-files'' and public.rs_path_ok(name))';
  execute 'create policy "rs files delete" on storage.objects for delete to authenticated using (bucket_id = ''research-files'' and public.rs_path_orphan(name))';
exception when others then raise notice 'تعذّر إعداد سياسات التخزين: %', sqlerrm;
end $$;

select 'ready' as status;
