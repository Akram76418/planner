-- أبحاث الماجستير (2): تعليقات المشرف على كل نسخة من الملف + تذكيرات مواعيد المراحل
-- شغّله بعد research.sql. آمن لإعادة التشغيل.

create table if not exists public.rs_file_comments (
  id bigint generated always as identity primary key,
  file_id bigint not null references public.rs_files(id) on delete cascade,
  group_id bigint not null references public.rs_groups(id) on delete cascade,
  author uuid not null,
  body text not null check (length(trim(body)) between 1 and 2000),
  place text check (place is null or length(place) <= 120),
  status text not null default 'open' check (status in ('open', 'fixed')),
  fixed_by uuid, fixed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists rs_fc_f on public.rs_file_comments (file_id, id);
create index if not exists rs_fc_g on public.rs_file_comments (group_id, id);
create table if not exists public.rs_cmt_reads (
  group_id bigint not null references public.rs_groups(id) on delete cascade,
  user_id uuid not null,
  last_id bigint not null default 0,
  primary key (group_id, user_id)
);
alter table public.rs_file_comments enable row level security;
alter table public.rs_cmt_reads enable row level security;
revoke all on public.rs_file_comments, public.rs_cmt_reads from anon, authenticated;

-- قائمة التعليقات لكل مجموعة (يراها الأعضاء ومن له صلاحية rs)
create or replace function public.rs_cmt_list(p_group bigint)
returns table(id bigint, file_id bigint, file_title text, version integer, author uuid, author_name text, body text, place text, status text, fixed_by_name text, fixed_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.rs_can_see(p_group) then raise exception 'not allowed'; end if;
  return query select c.id, c.file_id, f.title, f.version, c.author, pa.full_name, c.body, c.place, c.status, pf.full_name, c.fixed_at, c.created_at
    from rs_file_comments c join rs_files f on f.id = c.file_id left join profiles pa on pa.id = c.author left join profiles pf on pf.id = c.fixed_by
    where c.group_id = p_group order by c.id;
end $$;

create or replace function public.rs_cmt_add(p_file bigint, p_body text, p_place text default null) returns bigint
language plpgsql security definer set search_path = public set row_security = off as $$
declare f rs_files; cid bigint;
begin
  select * into f from rs_files where id = p_file; if not found then raise exception 'الملف غير موجود'; end if;
  if not public.rs_is_member(f.group_id) then raise exception 'not allowed'; end if;
  if length(trim(coalesce(p_body, ''))) = 0 then raise exception 'اكتب التعليق'; end if;
  insert into rs_file_comments (file_id, group_id, author, body, place) values (p_file, f.group_id, auth.uid(), left(trim(p_body), 2000), nullif(left(trim(coalesce(p_place, '')), 120), '')) returning id into cid;
  -- تعليقي الخاص يُحتسب مقروءاً عندي
  insert into rs_cmt_reads (group_id, user_id, last_id) values (f.group_id, auth.uid(), cid)
    on conflict (group_id, user_id) do update set last_id = greatest(rs_cmt_reads.last_id, cid);
  return cid;
end $$;

-- تم التعديل / إعادة الفتح: أي عضو يضع «تم»، وإعادة الفتح للمشرف أو كاتب التعليق
create or replace function public.rs_cmt_status(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare c rs_file_comments;
begin
  if p_status not in ('open', 'fixed') then raise exception 'حالة غير صحيحة'; end if;
  select * into c from rs_file_comments where id = p_id; if not found then return; end if;
  if not public.rs_is_member(c.group_id) then raise exception 'not allowed'; end if;
  if p_status = 'open' and not (public.rs_is_sup(c.group_id) or c.author = auth.uid()) then raise exception 'إعادة الفتح للمشرف أو كاتب التعليق'; end if;
  update rs_file_comments set status = p_status, fixed_by = case when p_status = 'fixed' then auth.uid() end, fixed_at = case when p_status = 'fixed' then now() end where id = p_id;
end $$;

create or replace function public.rs_cmt_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare c rs_file_comments;
begin
  select * into c from rs_file_comments where id = p_id; if not found then return; end if;
  if not (c.author = auth.uid() or public.rs_is_sup(c.group_id)) then raise exception 'not allowed'; end if;
  delete from rs_file_comments where id = p_id;
end $$;

create or replace function public.rs_cmt_mark_seen(p_group bigint) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare mx bigint;
begin
  if not public.rs_is_member(p_group) then return; end if;
  select coalesce(max(id), 0) into mx from rs_file_comments where group_id = p_group;
  insert into rs_cmt_reads (group_id, user_id, last_id) values (p_group, auth.uid(), mx)
    on conflict (group_id, user_id) do update set last_id = greatest(rs_cmt_reads.last_id, mx);
end $$;

-- مجموعاتي: + تعليقات جديدة + مراحل قريبة الموعد (خلال 3 أيام)
drop function if exists public.rs_my_groups();
create or replace function public.rs_my_groups()
returns table(id bigint, name text, description text, my_role text, members bigint, unread bigint, archived boolean, overdue bigint, cmt_new bigint, soon bigint)
language sql stable security definer set search_path = public set row_security = off as $$
  select g.id, g.name, g.description, coalesce(m.role, 'admin'),
    (select count(*) from rs_members x where x.group_id = g.id),
    (select count(*) from rs_messages ms join rs_threads t on t.id = ms.thread_id
      where t.group_id = g.id and not ms.deleted and ms.sender_id <> auth.uid() and m.user_id is not null and public.rs_thread_ok(t.id)
        and ms.id > coalesce((select r.last_id from rs_reads r where r.thread_id = t.id and r.user_id = auth.uid()), 0)),
    g.archived,
    (select count(*) from rs_milestones s where s.group_id = g.id and s.status <> 'done' and s.due_date < current_date and (s.student_id = auth.uid() or public.rs_is_sup(g.id))),
    (select count(*) from rs_file_comments c where c.group_id = g.id and m.user_id is not null and c.author <> auth.uid()
        and c.id > coalesce((select r.last_id from rs_cmt_reads r where r.group_id = g.id and r.user_id = auth.uid()), 0)),
    (select count(*) from rs_milestones s where s.group_id = g.id and s.status <> 'done' and s.due_date between current_date and current_date + 3 and (s.student_id = auth.uid() or public.rs_is_sup(g.id)))
  from rs_groups g left join rs_members m on m.group_id = g.id and m.user_id = auth.uid()
  where auth.uid() is not null and (m.user_id is not null or public.admin_can('rs'))
  order by g.archived, g.id desc
$$;

-- تذكيرات المراحل: المتأخرة والقريبة (حتى p_days يوماً) في مجموعاتي غير المؤرشفة
create or replace function public.rs_reminders(p_days integer default 7)
returns table(id bigint, group_id bigint, group_name text, student_id uuid, student_name text, title text, due_date date, status text, days_left integer)
language sql stable security definer set search_path = public set row_security = off as $$
  select s.id, s.group_id, g.name, s.student_id, p.full_name, s.title, s.due_date, s.status, (s.due_date - current_date)
  from rs_milestones s join rs_groups g on g.id = s.group_id left join profiles p on p.id = s.student_id
  where auth.uid() is not null and not g.archived and s.status <> 'done' and s.due_date is not null
    and s.due_date <= current_date + greatest(0, least(coalesce(p_days, 7), 60))
    and public.rs_is_member(s.group_id) and (s.student_id = auth.uid() or public.rs_is_sup(s.group_id))
  order by s.due_date, g.name, p.full_name
$$;

do $$
declare f text;
begin
  foreach f in array array['rs_cmt_list(bigint)', 'rs_cmt_add(bigint,text,text)', 'rs_cmt_status(bigint,text)', 'rs_cmt_delete(bigint)', 'rs_cmt_mark_seen(bigint)', 'rs_my_groups()', 'rs_reminders(integer)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

select 'ready' as status;
