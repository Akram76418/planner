-- حسابات الموظفين بالرقم الوظيفي + طلب تسجيل الموظف + حذف الموظفين السابقين.
-- شغّله مرة واحدة بعد students-purge.sql (وبعد cohorts-manage.sql). يضيف/يستبدل دوالاً فقط، ولا يحذف أي بيانات بنفسه.
-- الحذف نفسه يتم لاحقاً من التطبيق بتحديد منك وتأكيد. المدراء لا يُحذفون أبداً.

-- 1) نوع الطلب (طالب/موظف)
alter table public.comm_signup_requests add column if not exists kind text not null default 'student';
do $$ begin
  alter table public.comm_signup_requests add constraint comm_signup_requests_kind_chk check (kind in ('student','staff'));
exception when duplicate_object then null; end $$;

-- 2) تقديم الطلب (من شاشة الدخول). الموظف يكتب رقمه الوظيفي في خانة الرقم.
drop function if exists public.comm_request_signup(text, text, text, text);
create or replace function public.comm_request_signup(p_number text, p_name text, p_major text default null, p_phone text default null, p_kind text default 'student')
returns text language plpgsql security definer set search_path = public as $$
declare n text := trim(coalesce(p_number, '')); nm text := trim(coalesce(p_name, '')); k text := case when p_kind = 'staff' then 'staff' else 'student' end;
begin
  if n !~ '^[A-Za-z0-9]{3,20}$' or length(nm) < 3 or length(nm) > 100 then return 'invalid'; end if;
  if exists (select 1 from profiles where university_id = n or employee_number = n) then return 'exists'; end if;
  if exists (select 1 from comm_signup_requests where number = n and status = 'pending') then return 'pending'; end if;
  if (select count(*) from comm_signup_requests where status = 'pending') >= 1000 then return 'full'; end if;
  insert into comm_signup_requests (number, full_name, major, phone, kind)
  values (n, nm, left(nullif(trim(p_major), ''), 120), left(nullif(trim(p_phone), ''), 30), k);
  return 'ok';
end $$;
revoke execute on function public.comm_request_signup(text, text, text, text, text) from public;
grant execute on function public.comm_request_signup(text, text, text, text, text) to anon, authenticated;

-- 3) قائمة الطلبات مع النوع
drop function if exists public.comm_list_requests();
create or replace function public.comm_list_requests() returns table(id bigint, number text, full_name text, major text, phone text, created_at timestamptz, kind text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  return query select r.id, r.number, r.full_name, r.major, r.phone, r.created_at, r.kind
               from comm_signup_requests r where r.status = 'pending' order by r.created_at limit 500;
end $$;
revoke execute on function public.comm_list_requests() from public, anon;
grant execute on function public.comm_list_requests() to authenticated;

-- 4) قائمة الموظفين مع الرقم الوظيفي
drop function if exists public.comm_list_staff();
create or replace function public.comm_list_staff() returns table(id uuid, full_name text, role text, category text, university_id text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  return query select p.id, p.full_name, p.role::text, sc.category, p.university_id
               from profiles p left join comm_staff_categories sc on sc.user_id = p.id
               where p.role::text in ('professor','staff') order by p.full_name;
end $$;
revoke execute on function public.comm_list_staff() from public, anon;
grant execute on function public.comm_list_staff() to authenticated;

-- 5) عدد محادثات/رسائل أي حساب غير مدير (للتحذير قبل الحذف)
create or replace function public.comm_student_activity(p_ids uuid[])
returns table(id uuid, full_name text, convs bigint, msgs bigint)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  return query
    select p.id, p.full_name,
      (select count(*) from communication_conversation_participants cp where cp.user_id = p.id),
      (select count(*) from communication_messages m where m.conversation_id in
         (select cp.conversation_id from communication_conversation_participants cp where cp.user_id = p.id))
    from profiles p where p.id = any (p_ids) and p.role::text <> 'admin';
end $$;
revoke execute on function public.comm_student_activity(uuid[]) from public, anon;
grant execute on function public.comm_student_activity(uuid[]) to authenticated;

-- 6) حذف حساب غير مدير بالكامل (طالب أو موظف أو عضو هيئة تدريس). تستدعيها دالة الخادم فقط.
create or replace function public.comm_purge_user(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public set row_security = off as $$
declare conv uuid[]; n_msgs bigint := 0;
begin
  if not exists (select 1 from profiles where id = p_id and role::text <> 'admin') then raise exception 'not deletable'; end if;
  select coalesce(array_agg(conversation_id), '{}') into conv from communication_conversation_participants where user_id = p_id;
  select count(*) into n_msgs from communication_messages where conversation_id = any (conv);

  update communication_messages set reply_to_id = null
    where reply_to_id in (select id from communication_messages where conversation_id = any (conv)) and not (conversation_id = any (conv));
  update communication_messages set forwarded_from_id = null
    where forwarded_from_id in (select id from communication_messages where conversation_id = any (conv)) and not (conversation_id = any (conv));
  update communication_messages set reply_to_id = null, forwarded_from_id = null where conversation_id = any (conv);

  delete from communication_message_attachments where message_id in (select id from communication_messages where conversation_id = any (conv));
  delete from comm_dm_files where conversation_id = any (conv);
  delete from communication_notifications where user_id = p_id or conversation_id = any (conv);
  delete from communication_messages where conversation_id = any (conv);
  delete from communication_conversation_participants where conversation_id = any (conv);
  delete from communication_conversations where id = any (conv);
  delete from communication_drafts where owner_id = p_id or recipient_id = p_id;

  begin update communication_audit_logs set actor_id = null where actor_id = p_id;
  exception when not_null_violation then delete from communication_audit_logs where actor_id = p_id; end;

  -- طلبتهم المسندون إليهم يبقون بلا مشرف (لا يُحذفون)
  update profiles set professor_id = null where professor_id = p_id;
  delete from academic_requests where student_id = p_id;
  delete from messages where student_id = p_id or sender_id = p_id or recipient_id = p_id;
  delete from profiles where id = p_id;
  return jsonb_build_object('messages', n_msgs, 'conversations', coalesce(array_length(conv, 1), 0));
end $$;
revoke execute on function public.comm_purge_user(uuid) from public, anon, authenticated;
grant execute on function public.comm_purge_user(uuid) to service_role;
