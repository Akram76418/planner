-- حذف طالب له رسائل سابقة (مع إظهار عدد رسائله قبل التأكيد). شغّله مرة واحدة بعد students-cleanup.sql.
-- لا يغيّر جداول tawasul، فقط يضيف دالتين. الحذف يتم داخل معاملة واحدة: إن فشلت أي خطوة لا يُحذف شيء.

-- عدد محادثات ورسائل كل طالب (للإدارة، تُستخدم لتحذيرك قبل الحذف)
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
    from profiles p where p.id = any (p_ids) and p.role::text = 'student';
end $$;
revoke execute on function public.comm_student_activity(uuid[]) from public, anon;
grant execute on function public.comm_student_activity(uuid[]) to authenticated;

-- حذف بيانات طالب كاملة (محادثاته ورسائله وإشعاراته وطلباته) ثم ملفه الشخصي. تستدعيها دالة الخادم فقط (لا التطبيق مباشرة).
create or replace function public.comm_purge_student(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public set row_security = off as $$
declare conv uuid[]; n_msgs bigint := 0;
begin
  if not exists (select 1 from profiles where id = p_id and role::text = 'student') then raise exception 'not a student'; end if;
  select coalesce(array_agg(conversation_id), '{}') into conv from communication_conversation_participants where user_id = p_id;
  select count(*) into n_msgs from communication_messages where conversation_id = any (conv);

  -- مراجع الرد/التحويل من رسائل خارج هذه المحادثات
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

  delete from academic_requests where student_id = p_id;
  delete from messages where student_id = p_id or sender_id = p_id or recipient_id = p_id;
  delete from profiles where id = p_id;
  return jsonb_build_object('messages', n_msgs, 'conversations', coalesce(array_length(conv, 1), 0));
end $$;
revoke execute on function public.comm_purge_student(uuid) from public, anon, authenticated;
grant execute on function public.comm_purge_student(uuid) to service_role;
