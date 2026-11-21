-- ═══ أبحاث الماجستير: ملف لكل مرحلة (يُشغَّل بعد research.sql و research2.sql) ═══
alter table public.rs_files add column if not exists milestone_id bigint references public.rs_milestones(id) on delete set null;
create index if not exists rs_files_ms_idx on public.rs_files(milestone_id);

-- يمكن للمستخدم رؤية/رفع ملف مرحلة: الطالب لمراحله فقط، والمشرف لأي مرحلة في المجموعة
create or replace function public.rs_ms_file_ok(p_group bigint, p_ms bigint) returns boolean
language plpgsql stable security definer set search_path = public set row_security = off as $$
declare m rs_milestones;
begin
  select * into m from rs_milestones where id = p_ms and group_id = p_group;
  if not found then return false; end if;
  return public.rs_is_sup(p_group) or m.student_id = auth.uid();
end $$;

drop function if exists public.rs_files_list(bigint);
create or replace function public.rs_files_list(p_group bigint)
returns table(id bigint, title text, version integer, uploader uuid, uploader_name text, file_path text, file_name text, file_type text, file_size bigint, note text, created_at timestamptz, milestone_id bigint, ms_student_id uuid, ms_student_name text)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.rs_can_see(p_group) then raise exception 'not allowed'; end if;
  return query select f.id, f.title, f.version, f.uploader, p.full_name, f.file_path, f.file_name, f.file_type, f.file_size, f.note, f.created_at, f.milestone_id, s.student_id, sp.full_name
    from rs_files f left join profiles p on p.id = f.uploader left join rs_milestones s on s.id = f.milestone_id left join profiles sp on sp.id = s.student_id
    where f.group_id = p_group order by f.created_at desc, f.id desc;
end $$;

drop function if exists public.rs_file_add(bigint,text,text,text,text,text,bigint);
create or replace function public.rs_file_add(p_group bigint, p_title text, p_note text, p_path text, p_name text, p_type text, p_size bigint, p_milestone bigint default null) returns bigint
language plpgsql security definer set search_path = public set row_security = off as $$
declare v integer; fid bigint; t text := trim(p_title);
begin
  if not public.rs_is_member(p_group) then raise exception 'not allowed'; end if;
  if p_path !~ ('^g' || p_group || '/[A-Za-z0-9._/-]{1,200}$') then raise exception 'مسار الملف غير صحيح'; end if;
  if coalesce(p_size, 0) > 26214400 then raise exception 'الملف أكبر من 25 ميغابايت'; end if;
  if p_milestone is not null then
    if not public.rs_ms_file_ok(p_group, p_milestone) then raise exception 'not allowed'; end if;
    select coalesce(max(version), 0) + 1 into v from rs_files where group_id = p_group and milestone_id = p_milestone;
    select left(s.title, 200) into t from rs_milestones s where s.id = p_milestone;
  else
    select coalesce(max(version), 0) + 1 into v from rs_files where group_id = p_group and milestone_id is null and lower(title) = lower(t);
  end if;
  insert into rs_files (group_id, title, version, uploader, file_path, file_name, file_type, file_size, note, milestone_id)
  values (p_group, t, v, auth.uid(), p_path, left(p_name, 200), left(p_type, 100), p_size, nullif(left(trim(coalesce(p_note, '')), 500), ''), p_milestone) returning id into fid;
  return fid;
end $$;

-- ربط ملف موجود في المكتبة بمرحلة (أو فك الربط بتمرير null)
create or replace function public.rs_file_link(p_file bigint, p_milestone bigint) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare f rs_files;
begin
  select * into f from rs_files where id = p_file; if not found then raise exception 'الملف غير موجود'; end if;
  if not (f.uploader = auth.uid() or public.rs_is_sup(f.group_id)) then raise exception 'not allowed'; end if;
  if p_milestone is not null and not public.rs_ms_file_ok(f.group_id, p_milestone) then raise exception 'not allowed'; end if;
  update rs_files set milestone_id = p_milestone where id = p_file;
end $$;

do $$
declare f text;
begin
  foreach f in array array['rs_files_list(bigint)', 'rs_file_add(bigint,text,text,text,text,text,bigint,bigint)', 'rs_file_link(bigint,bigint)', 'rs_ms_file_ok(bigint,bigint)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

select 'ready' as status;
