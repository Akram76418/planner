-- أدوات الإدارة: سجل الدخول والأخطاء، مسح كل المراسلات، ربط الأكاديمي بالشعبة، تغيير نوع الموظف.
-- شغّله مرة واحدة بعد staff-accounts.sql. يضيف جدولاً ودوالاً فقط، ولا يحذف أي بيانات بنفسه.

-- ───── 1) سجل الدخول والأخطاء ─────
create table if not exists public.comm_app_log (
  id      bigint generated always as identity primary key,
  ts      timestamptz not null default now(),
  user_id uuid,
  who     text,
  kind    text not null check (kind in ('login','login_fail','logout','error','wipe','admin')),
  msg     text,
  ua      text
);
create index if not exists comm_app_log_ts on public.comm_app_log (ts desc);
alter table public.comm_app_log enable row level security;
revoke all on public.comm_app_log from anon, authenticated;

-- تسجيل حدث. المستخدم المسجَّل: login/logout/error. الزائر: login_fail فقط (مع حد للإغراق).
create or replace function public.comm_log_event(p_kind text, p_msg text default null, p_who text default null, p_ua text default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    if p_kind <> 'login_fail' then return; end if;
    if (select count(*) from comm_app_log where kind = 'login_fail' and ts > now() - interval '1 minute') > 60 then return; end if;
  else
    if p_kind not in ('login','logout','error') then return; end if;
    if p_kind = 'error' and (select count(*) from comm_app_log where user_id = uid and kind = 'error' and ts > now() - interval '10 minutes') > 15 then return; end if;
  end if;
  insert into comm_app_log (user_id, who, kind, msg, ua)
  values (uid, left(nullif(trim(coalesce(p_who, '')), ''), 60), p_kind, left(p_msg, 500), left(p_ua, 200));
  if random() < 0.02 then delete from comm_app_log where ts < now() - interval '90 days'; end if;
end $$;
revoke execute on function public.comm_log_event(text, text, text, text) from public;
grant execute on function public.comm_log_event(text, text, text, text) to anon, authenticated;

create or replace function public.comm_list_logs(p_kind text default null, p_limit integer default 300)
returns table(id bigint, ts timestamptz, kind text, who text, full_name text, university_id text, msg text, ua text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  return query
    select l.id, l.ts, l.kind, l.who, p.full_name, p.university_id, l.msg, l.ua
    from comm_app_log l left join profiles p on p.id = l.user_id
    where p_kind is null or l.kind = p_kind
    order by l.ts desc limit greatest(1, least(coalesce(p_limit, 300), 1000));
end $$;

create or replace function public.comm_clear_logs() returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  delete from comm_app_log;
end $$;
revoke execute on function public.comm_list_logs(text, integer), public.comm_clear_logs() from public, anon;
grant execute on function public.comm_list_logs(text, integer), public.comm_clear_logs() to authenticated;

-- ───── 2) مسح كل المراسلات (الحسابات تبقى) ─────
create or replace function public.comm_wipe_counts() returns jsonb
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'conversations', (select count(*) from communication_conversations),
    'messages', (select count(*) from communication_messages),
    'channel', (select count(*) from comm_channel_messages),
    'announcements', (select count(*) from comm_announcements));
end $$;
revoke execute on function public.comm_wipe_counts() from public, anon;
grant execute on function public.comm_wipe_counts() to authenticated;

-- المسح الفعلي: تستدعيها دالة الخادم فقط (ثم تحذف الملفات المرفقة من التخزين). معاملة واحدة.
create or replace function public.comm_wipe_messages() returns jsonb
language plpgsql security definer set search_path = public set row_security = off as $$
declare r jsonb;
begin
  r := jsonb_build_object(
    'conversations', (select count(*) from communication_conversations),
    'messages', (select count(*) from communication_messages),
    'channel', (select count(*) from comm_channel_messages),
    'announcements', (select count(*) from comm_announcements));
  update communication_messages set reply_to_id = null, forwarded_from_id = null;
  delete from communication_message_attachments;
  delete from comm_dm_files;
  delete from communication_notifications;
  delete from communication_messages;
  delete from communication_conversation_participants;
  delete from communication_conversations;
  delete from communication_drafts;
  delete from comm_channel_messages;
  delete from comm_announcements;
  delete from comm_reads;
  delete from messages;
  insert into comm_app_log (kind, msg) values ('wipe', 'تم مسح كل المراسلات: ' || r::text);
  return r;
end $$;
revoke execute on function public.comm_wipe_messages() from public, anon, authenticated;
grant execute on function public.comm_wipe_messages() to service_role;

-- ───── 3) ربط الأكاديمي بشعبة (كل طلبة الشعبة) ─────
create or replace function public.comm_cohort_professors()
returns table(cohort_id integer, cohort_name text, members bigint, prof_id uuid, prof_name text, assigned bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  return query
    select c.id, c.name,
      (select count(*) from comm_cohort_members m where m.cohort_id = c.id),
      top.pid, (select pp.full_name from profiles pp where pp.id = top.pid),
      (select count(*) from comm_cohort_members m join profiles p on p.id = m.user_id where m.cohort_id = c.id and p.professor_id is not null)
    from comm_cohorts c
    left join lateral (
      select p2.professor_id as pid from comm_cohort_members m2 join profiles p2 on p2.id = m2.user_id
      where m2.cohort_id = c.id and p2.professor_id is not null
      group by p2.professor_id order by count(*) desc limit 1) top on true
    order by c.name;
end $$;

create or replace function public.comm_assign_professor(p_cohort integer, p_prof uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  if p_prof is not null and not exists (select 1 from profiles where id = p_prof and role::text = 'professor') then
    raise exception 'المشرف يجب أن يكون من نوع عضو هيئة تدريس';
  end if;
  update profiles set professor_id = p_prof
   where role::text = 'student' and id in (select user_id from comm_cohort_members where cohort_id = p_cohort);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.comm_cohort_professors(), public.comm_assign_professor(integer, uuid) from public, anon;
grant execute on function public.comm_cohort_professors(), public.comm_assign_professor(integer, uuid) to authenticated;

-- ───── 4) تغيير نوع موظف (موظف ⇄ عضو هيئة تدريس) ─────
create or replace function public.comm_set_staff_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  if p_role not in ('staff', 'professor') then raise exception 'bad role'; end if;
  if not exists (select 1 from profiles where id = p_user and role::text in ('staff', 'professor')) then raise exception 'not staff'; end if;
  execute format('update profiles set role = %L where id = %L', p_role, p_user);
  if p_role = 'staff' then update profiles set professor_id = null where professor_id = p_user; end if;
end $$;
revoke execute on function public.comm_set_staff_role(uuid, text) from public, anon;
grant execute on function public.comm_set_staff_role(uuid, text) to authenticated;

-- ───── 5) أسماء المدراء (لتظهر لغير المدراء باسم PCN في التطبيق) ─────
create or replace function public.comm_admin_names() returns setof text
language sql stable security definer set search_path = public as $$
  select full_name from profiles where role::text = 'admin' and full_name is not null
$$;
revoke execute on function public.comm_admin_names() from public, anon;
grant execute on function public.comm_admin_names() to authenticated;
