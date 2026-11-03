-- ملفات PDF المرفقة بـ «متابعاتي اليومية»: حاوية خاصة، كل مستخدم يصل إلى مجلده فقط (المسار: <user_id>/<follow_id>/<file>.pdf).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('follow-files', 'follow-files', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];

drop policy if exists "follow files select" on storage.objects;
drop policy if exists "follow files insert" on storage.objects;
drop policy if exists "follow files delete" on storage.objects;
create policy "follow files select" on storage.objects for select to authenticated
  using (bucket_id = 'follow-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "follow files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'follow-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "follow files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'follow-files' and (storage.foldername(name))[1] = auth.uid()::text);
