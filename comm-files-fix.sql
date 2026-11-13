-- إصلاح/تشخيص إرفاق الملفات بالرسائل (التواصل). آمن لإعادة التشغيل.
-- (1) دالة بديلة: تربط الملف بآخر رسالة أرسلها المستخدم في المحادثة (للحالة التي لا تعيد فيها دالة الإرسال رقم الرسالة)
create or replace function public.comm_dm_attach_last(p_conv uuid, p_path text, p_name text, p_type text, p_size bigint) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare mid bigint;
begin
  if p_path not like 'dm/' || p_conv::text || '/' || auth.uid()::text || '/%' then raise exception 'bad path'; end if;
  select m.id into mid from communication_messages m
   where m.conversation_id = p_conv and m.sender_id = auth.uid() and m.deleted_at is null
     and not exists (select 1 from comm_dm_files f where f.message_id = m.id)
   order by m.id desc limit 1;
  if mid is null then raise exception 'no message to attach'; end if;
  insert into comm_dm_files (message_id, conversation_id, sender_id, file_path, file_name, file_type, file_size)
  values (mid, p_conv, auth.uid(), p_path, left(p_name, 200), left(p_type, 100), p_size) on conflict (message_id) do nothing;
end $$;
revoke execute on function public.comm_dm_attach_last(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.comm_dm_attach_last(uuid, text, text, text, bigint) to authenticated;

-- (2) تأكد من وجود الحاوية بحد 20 ميغابايت وبلا قيد على الأنواع
insert into storage.buckets (id, name, public, file_size_limit) values ('comm-files', 'comm-files', false, 20971520)
on conflict (id) do update set file_size_limit = 20971520, allowed_mime_types = null;

-- (3) تشخيص (انسخ نتائجه إن بقيت المشكلة)
select 'bucket' as k, b.id::text as a, b.public::text as b, b.file_size_limit::text as c, coalesce(b.allowed_mime_types::text, '-') as d from storage.buckets b where b.id = 'comm-files'
union all
select 'policy', policyname, cmd, '', '' from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'comm files%'
union all
select 'fn', proname, pg_get_function_result(oid), pg_get_function_arguments(oid), '' from pg_proc where pronamespace = 'public'::regnamespace and proname in ('send_communication_message', 'comm_dm_attach', 'comm_dm_attach_last')
union all
select 'cols', column_name, data_type, '', '' from information_schema.columns where table_schema = 'public' and table_name = 'comm_channel_messages' and column_name like 'file%';
