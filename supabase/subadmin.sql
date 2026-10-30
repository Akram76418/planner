-- صلاحيات المسؤولين الفرعيين. شغّل هذا الملف في SQL Editor (بعد الملفات السابقة وقبل ledger.sql).
-- المسؤول الرئيسي = أي مسؤول ليس له سجل في admin_perms (يملك كل الصلاحيات). المسؤول الفرعي = مسؤول له سجل صلاحيات.
-- مفاتيح الصلاحيات: create requests students staff cohorts reset delete ann sched poll weekly logs wipe proj
-- (الدفتر المالي وإدارة المسؤولين والمستخدمين المسموح لهم: للرئيسي فقط دائماً)

create table if not exists public.admin_perms (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  perms     jsonb not null default '{}'::jsonb,
  prev_role text not null default 'staff',
  added_by  uuid,
  added_at  timestamptz not null default now()
);
alter table public.admin_perms enable row level security;   -- بلا سياسات: الوصول عبر الدوال فقط
revoke all on public.admin_perms from anon, authenticated;

create or replace function public.admin_can(k text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_user_role() = 'admin' and (
    not exists (select 1 from public.admin_perms where user_id = auth.uid())
    or (k <> 'main' and coalesce((select (perms ->> k)::boolean from public.admin_perms where user_id = auth.uid()), false)));
$$;
grant execute on function public.admin_can(text) to authenticated;

-- صلاحياتي: null لغير المسؤول، و{"main":true} للرئيسي، و{"main":false,"perms":{...}} للفرعي
create or replace function public.comm_my_perms() returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when public.current_user_role() <> 'admin' then null
    when exists (select 1 from public.admin_perms where user_id = auth.uid())
      then jsonb_build_object('main', false, 'perms', (select perms from public.admin_perms where user_id = auth.uid()))
    else jsonb_build_object('main', true) end;
$$;
grant execute on function public.comm_my_perms() to authenticated;

create or replace function public.comm_list_admins() returns table(id uuid, full_name text, is_sub boolean, perms jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can('main') then raise exception 'admin only'; end if;
  return query select p.id, p.full_name, (a.user_id is not null), coalesce(a.perms, '{}'::jsonb)
    from profiles p left join admin_perms a on a.user_id = p.id
    where p.role = 'admin' order by (a.user_id is null) desc, p.full_name;
end $$;
grant execute on function public.comm_list_admins() to authenticated;

-- ترقية موظف/عضو هيئة تدريس إلى مسؤول فرعي بصلاحيات محددة، أو تعديل صلاحياته، أو إلغاؤه (p_on=false)
create or replace function public.comm_set_admin(p_user uuid, p_on boolean, p_perms jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r text; has_row boolean;
begin
  if not public.admin_can('main') then raise exception 'admin only'; end if;
  select role into r from profiles where id = p_user;
  if r is null then raise exception 'not found'; end if;
  if r = 'student' then raise exception 'students cannot be admins'; end if;
  select exists (select 1 from admin_perms where user_id = p_user) into has_row;
  if r = 'admin' and not has_row then raise exception 'cannot modify the main admin'; end if;
  if p_on then
    insert into admin_perms (user_id, perms, prev_role, added_by)
      values (p_user, coalesce(p_perms, '{}'::jsonb), case when r = 'admin' then 'staff' else r end, auth.uid())
      on conflict (user_id) do update set perms = coalesce(p_perms, '{}'::jsonb);
    update profiles set role = 'admin' where id = p_user;
  else
    update profiles set role = coalesce((select prev_role from admin_perms where user_id = p_user), 'staff') where id = p_user;
    delete from admin_perms where user_id = p_user;
  end if;
end $$;
grant execute on function public.comm_set_admin(uuid, boolean, jsonb) to authenticated;

-- سياسات الجداول
drop policy if exists "channel delete" on public.comm_channel_messages;
create policy "channel delete" on public.comm_channel_messages for delete using (public.admin_can('ann'));
drop policy if exists "ann insert" on public.comm_announcements;
create policy "ann insert" on public.comm_announcements for insert with check (sender_id = auth.uid() and public.admin_can('ann'));
drop policy if exists "ann delete" on public.comm_announcements;
create policy "ann delete" on public.comm_announcements for delete using (public.admin_can('ann'));

-- إعادة تعريف الدوال لتتحقق من الصلاحية المناسبة بدل «مسؤول» فقط
-- comm_add_cohort (cohorts)
create or replace function public.comm_add_cohort(p_name text) returns integer
language plpgsql security definer set search_path = public as $$
declare new_id integer;
begin
  if not public.admin_can('cohorts') then raise exception 'admin only'; end if;
  insert into comm_cohorts (name) values (trim(p_name))
  on conflict (name) do update set is_active = true returning id into new_id;
  return new_id;
end $$;

-- comm_set_staff_category (staff)
create or replace function public.comm_set_staff_category(p_user uuid, p_category text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('staff') then raise exception 'admin only'; end if;
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

-- comm_list_staff (staff)
create or replace function public.comm_list_staff() returns table(id uuid, full_name text, role text, category text, university_id text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can('staff') then raise exception 'admin only'; end if;
  return query select p.id, p.full_name, p.role::text, sc.category, p.university_id
               from profiles p left join comm_staff_categories sc on sc.user_id = p.id
               where p.role::text in ('professor','staff') order by p.full_name;
end $$;

-- comm_list_students (students)
create or replace function public.comm_list_students(p_cohort integer default null, p_search text default '', p_unassigned boolean default false)
returns table(id uuid, full_name text, university_id text, major text, cohort_id integer, cohort_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can('students') then raise exception 'admin only'; end if;
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
    order by p.full_name limit 2000;
end $$;

-- comm_assign_cohort (students)
create or replace function public.comm_assign_cohort(p_user uuid, p_cohort integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('students') then raise exception 'admin only'; end if;
  if not exists (select 1 from profiles where id = p_user and role::text = 'student') then raise exception 'user is not a student'; end if;
  if p_cohort is null then
    delete from comm_cohort_members where user_id = p_user;
  else
    insert into comm_cohort_members (user_id, cohort_id) values (p_user, p_cohort)
    on conflict (user_id) do update set cohort_id = excluded.cohort_id, added_at = now();
  end if;
end $$;

-- comm_bulk_assign_cohort (students)
create or replace function public.comm_bulk_assign_cohort(p_university_ids text[], p_cohort integer) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.admin_can('students') then raise exception 'admin only'; end if;
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

-- comm_pending_passwords (reset)
create or replace function public.comm_pending_passwords() returns table(user_id uuid, full_name text, university_id text, role text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can('reset') then raise exception 'admin only'; end if;
  return query select s.user_id, p.full_name, p.university_id, p.role::text, s.created_at
               from comm_pw_status s join profiles p on p.id = s.user_id
               where s.must_change order by p.full_name;
end $$;

-- comm_list_requests (requests)
create or replace function public.comm_list_requests() returns table(id bigint, number text, full_name text, major text, phone text, created_at timestamptz, kind text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can('requests') then raise exception 'admin only'; end if;
  return query select r.id, r.number, r.full_name, r.major, r.phone, r.created_at, r.kind
               from comm_signup_requests r where r.status = 'pending' order by r.created_at limit 500;
end $$;

-- comm_decide_request (requests)
create or replace function public.comm_decide_request(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('requests') then raise exception 'admin only'; end if;
  if p_status not in ('approved','rejected') then raise exception 'bad status'; end if;
  update comm_signup_requests set status = p_status, decided_at = now() where id = p_id;
end $$;

-- comm_find_duplicates (students)
create or replace function public.comm_find_duplicates()
returns table(reason text, grp text, id uuid, full_name text, university_id text, created_at timestamptz, last_sign_in timestamptz, must_change boolean, cohort_name text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.admin_can('students') then raise exception 'admin only'; end if;
  return query
  with s as (
    select p.id, nullif(trim(p.university_id), '') as uid, nullif(trim(p.national_id), '') as nid, public.comm_norm_name(p.full_name) as nm
    from public.profiles p where p.role::text = 'student'
  ), g as (
    select 'name'::text as r, s.nm as k, s.id from s where s.nm <> '' and s.nm in (select x.nm from s x group by x.nm having count(*) > 1)
    union all select 'number', s.uid, s.id from s where s.uid in (select x.uid from s x where x.uid is not null group by x.uid having count(*) > 1)
    union all select 'national_id', s.nid, s.id from s where s.nid in (select x.nid from s x where x.nid is not null group by x.nid having count(*) > 1)
    union all select 'number_vs_id', a.uid, a.id from s a join s b on a.uid = b.nid and a.id <> b.id
    union all select 'number_vs_id', b.nid, b.id from s a join s b on a.uid = b.nid and a.id <> b.id
  )
  select g.r, substr(md5(g.k), 1, 8), p.id, p.full_name, p.university_id, p.created_at, u.last_sign_in_at,
         coalesce(w.must_change, false), c.name
  from g
  join public.profiles p on p.id = g.id
  left join auth.users u on u.id = p.id
  left join public.comm_pw_status w on w.user_id = p.id
  left join public.comm_cohort_members m on m.user_id = p.id
  left join public.comm_cohorts c on c.id = m.cohort_id
  order by g.r, 2, p.created_at
  limit 1500;
end $$;

-- comm_student_activity (students)
create or replace function public.comm_student_activity(p_ids uuid[])
returns table(id uuid, full_name text, convs bigint, msgs bigint)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.admin_can('students') then raise exception 'admin only'; end if;
  return query
    select p.id, p.full_name,
      (select count(*) from communication_conversation_participants cp where cp.user_id = p.id),
      (select count(*) from communication_messages m where m.conversation_id in
         (select cp.conversation_id from communication_conversation_participants cp where cp.user_id = p.id))
    from profiles p where p.id = any (p_ids) and p.role::text <> 'admin';
end $$;

-- comm_rename_cohort (cohorts)
create or replace function public.comm_rename_cohort(p_id integer, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('cohorts') then raise exception 'admin only'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'invalid name'; end if;
  update comm_cohorts set name = trim(p_name) where id = p_id;
  if not found then raise exception 'cohort not found'; end if;
exception when unique_violation then raise exception 'cohort name already exists';
end $$;

-- comm_delete_cohort (cohorts)
create or replace function public.comm_delete_cohort(p_id integer, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m bigint; a bigint;
begin
  if not public.admin_can('cohorts') then raise exception 'admin only'; end if;
  select count(*) into m from comm_cohort_members where cohort_id = p_id;
  select count(*) into a from comm_announcements where cohort_id = p_id;
  if (m > 0 or a > 0) and not p_force then
    return jsonb_build_object('blocked', true, 'members', m, 'announcements', a);
  end if;
  delete from comm_cohort_members where cohort_id = p_id;
  delete from comm_cohorts where id = p_id;
  return jsonb_build_object('deleted', true, 'members', m, 'announcements', a);
end $$;

-- comm_list_logs (logs)
create or replace function public.comm_list_logs(p_kind text default null, p_limit integer default 300)
returns table(id bigint, ts timestamptz, kind text, who text, full_name text, university_id text, msg text, ua text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can('logs') then raise exception 'admin only'; end if;
  return query
    select l.id, l.ts, l.kind, l.who, p.full_name, p.university_id, l.msg, l.ua
    from comm_app_log l left join profiles p on p.id = l.user_id
    where p_kind is null or l.kind = p_kind
    order by l.ts desc limit greatest(1, least(coalesce(p_limit, 300), 1000));
end $$;

-- comm_clear_logs (logs)
create or replace function public.comm_clear_logs() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('logs') then raise exception 'admin only'; end if;
  delete from comm_app_log where true;
end $$;

-- comm_wipe_counts (wipe)
create or replace function public.comm_wipe_counts() returns jsonb
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.admin_can('wipe') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'conversations', (select count(*) from communication_conversations),
    'messages', (select count(*) from communication_messages),
    'channel', (select count(*) from comm_channel_messages),
    'announcements', (select count(*) from comm_announcements));
end $$;

-- comm_cohort_professors (staff)
create or replace function public.comm_cohort_professors()
returns table(cohort_id integer, cohort_name text, members bigint, profs jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can('staff') then raise exception 'admin only'; end if;
  return query
    select c.id, c.name,
      (select count(*) from comm_cohort_members m where m.cohort_id = c.id),
      coalesce((select jsonb_agg(jsonb_build_object('id', cp.prof_id, 'name', p.full_name) order by p.full_name)
                from comm_cohort_profs cp join profiles p on p.id = cp.prof_id where cp.cohort_id = c.id), '[]'::jsonb)
    from comm_cohorts c order by c.name;
end $$;

-- comm_assign_professor (staff)
create or replace function public.comm_assign_professor(p_cohort integer, p_prof uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.admin_can('staff') then raise exception 'admin only'; end if;
  if p_prof is not null and not exists (select 1 from profiles where id = p_prof and role::text = 'professor') then
    raise exception 'المشرف يجب أن يكون من نوع عضو هيئة تدريس';
  end if;
  update profiles set professor_id = p_prof
   where role::text = 'student' and id in (select user_id from comm_cohort_members where cohort_id = p_cohort);
  get diagnostics n = row_count;
  return n;
end $$;

-- comm_set_staff_role (staff)
create or replace function public.comm_set_staff_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('staff') then raise exception 'admin only'; end if;
  if p_role not in ('staff', 'professor') then raise exception 'bad role'; end if;
  if not exists (select 1 from profiles where id = p_user and role::text in ('staff', 'professor')) then raise exception 'not staff'; end if;
  execute format('update profiles set role = %L where id = %L', p_role, p_user);
  if p_role = 'staff' then update profiles set professor_id = null where professor_id = p_user; end if;
end $$;

-- comm_assign_professors (staff)
create or replace function public.comm_assign_professors(p_cohort integer, p_profs uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; first_p uuid;
begin
  if not public.admin_can('staff') then raise exception 'admin only'; end if;
  p_profs := coalesce(p_profs, '{}');
  if exists (select 1 from unnest(p_profs) x where not exists (select 1 from profiles where id = x and role::text = 'professor')) then
    raise exception 'المشرف يجب أن يكون من نوع عضو هيئة تدريس';
  end if;
  delete from comm_cohort_profs where cohort_id = p_cohort;
  insert into comm_cohort_profs (cohort_id, prof_id) select p_cohort, x from unnest(p_profs) x;
  first_p := p_profs[1];
  update profiles set professor_id = first_p
   where role::text = 'student' and id in (select user_id from comm_cohort_members where cohort_id = p_cohort);
  get diagnostics n = row_count;
  return n;
end $$;

-- comm_ann_pin (ann)
create or replace function public.comm_ann_pin(p_id bigint, p_pinned boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('ann') then raise exception 'admin only'; end if;
  update comm_announcements set pinned = coalesce(p_pinned, false) where id = p_id;
end $$;

-- comm_sched_save (sched)
create or replace function public.comm_sched_save(p_id bigint, p_cohort integer, p_kind text, p_title text, p_date date, p_start time, p_end time, p_place text, p_notes text)
returns bigint language plpgsql security definer set search_path = public as $$
declare nid bigint;
begin
  if not public.admin_can('sched') then raise exception 'admin only'; end if;
  if p_id is null then
    insert into comm_schedule (cohort_id, kind, title, event_date, start_time, end_time, place, notes)
    values (p_cohort, p_kind, trim(p_title), p_date, p_start, p_end, nullif(trim(p_place), ''), nullif(trim(p_notes), '')) returning id into nid;
  else
    update comm_schedule set cohort_id = p_cohort, kind = p_kind, title = trim(p_title), event_date = p_date, start_time = p_start, end_time = p_end,
      place = nullif(trim(p_place), ''), notes = nullif(trim(p_notes), '') where id = p_id returning id into nid;
  end if;
  return nid;
end $$;

-- comm_sched_delete (sched)
create or replace function public.comm_sched_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('sched') then raise exception 'admin only'; end if;
  delete from comm_schedule where id = p_id;
end $$;

-- comm_poll_create (poll)
create or replace function public.comm_poll_create(p_cohort integer, p_question text, p_options text[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare nid bigint; opts text[];
begin
  if not public.admin_can('poll') then raise exception 'admin only'; end if;
  select array_agg(trim(x)) into opts from unnest(p_options) x where length(trim(x)) > 0;
  if coalesce(array_length(opts, 1), 0) < 2 then raise exception 'يلزم خياران على الأقل'; end if;
  insert into comm_polls (cohort_id, question, options) values (p_cohort, trim(p_question), opts[1:8]) returning id into nid;
  return nid;
end $$;

-- comm_poll_close (poll)
create or replace function public.comm_poll_close(p_id bigint, p_closed boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('poll') then raise exception 'admin only'; end if;
  update comm_polls set closed = coalesce(p_closed, true) where id = p_id;
end $$;

-- comm_poll_delete (poll)
create or replace function public.comm_poll_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('poll') then raise exception 'admin only'; end if;
  delete from comm_polls where id = p_id;
end $$;

-- comm_weekly_save (weekly)
create or replace function public.comm_weekly_save(p_id bigint, p_name text, p_cells jsonb, p_notes text, p_user uuid default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare nid bigint;
begin
  if not public.admin_can('weekly') then raise exception 'admin only'; end if;
  if p_id is null then
    insert into comm_weekly (user_id, name, cells, notes, sort)
    values (p_user, trim(p_name), coalesce(p_cells, '{}'), nullif(trim(p_notes), ''), coalesce((select max(sort) + 1 from comm_weekly), 0)) returning id into nid;
  else
    update comm_weekly set name = trim(p_name), cells = coalesce(p_cells, '{}'), notes = nullif(trim(p_notes), '') where id = p_id returning id into nid;
  end if;
  return nid;
end $$;

-- comm_weekly_delete (weekly)
create or replace function public.comm_weekly_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('weekly') then raise exception 'admin only'; end if;
  delete from comm_weekly where id = p_id;
end $$;

-- comm_weekly_clear (weekly)
create or replace function public.comm_weekly_clear() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('weekly') then raise exception 'admin only'; end if;
  delete from comm_weekly where true;
end $$;

-- comm_weekly_fill (weekly)
create or replace function public.comm_weekly_fill() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.admin_can('weekly') then raise exception 'admin only'; end if;
  insert into comm_weekly (user_id, name, sort)
    select p.id, p.full_name, coalesce((select max(sort) from comm_weekly), 0) + row_number() over (order by p.full_name)
    from profiles p
    where p.role::text in ('professor','staff') and p.full_name is not null
      and not exists (select 1 from comm_weekly w where w.user_id = p.id);
  get diagnostics n = row_count;
  return n;
end $$;

-- comm_apply_titles (staff)
create or replace function public.comm_apply_titles() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_dr integer; n_a integer;
  strip constant text := '^\s*(أ\.\s*د\.?|د\.|أ\.|م\.|dr\.?)\s*';
begin
  if not public.admin_can('staff') then raise exception 'admin only'; end if;
  -- الدكاترة الثلاثة (موظف أو عضو هيئة تدريس)
  update profiles set full_name = 'د. ' || btrim(regexp_replace(full_name, strip, '', 'i'))
   where role::text in ('professor', 'staff')
     and (full_name ~ 'أكرم.*(ابو|أبو) صلاح' or full_name ~ 'اكرم.*(ابو|أبو) صلاح'
          or full_name ~ 'عبد الرحمن.*الهمص' or full_name ~ 'خالد.*خضورة')
     and full_name !~ '^\s*د\.\s';
  get diagnostics n_dr = row_count;
  -- باقي أعضاء هيئة التدريس: «أ.» إن لم يكن لهم لقب
  update profiles set full_name = 'أ. ' || btrim(full_name)
   where role::text = 'professor'
     and full_name !~ '^\s*(أ\.\s*د|د\.|أ\.|م\.|dr)'
     and not (full_name ~ 'أكرم.*(ابو|أبو) صلاح' or full_name ~ 'اكرم.*(ابو|أبو) صلاح'
          or full_name ~ 'عبد الرحمن.*الهمص' or full_name ~ 'خالد.*خضورة');
  get diagnostics n_a = row_count;
  return jsonb_build_object('doctors', n_dr, 'teachers', n_a);
end $$;

-- planner_list_users (main)
create or replace function public.planner_list_users() returns table(email text, is_admin boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can('main') then raise exception 'admin only'; end if;
  return query select a.email, a.is_admin from planner_allowed a order by a.is_admin desc, a.email;
end $$;

-- planner_add_user (main)
create or replace function public.planner_add_user(p_email text, p_admin boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  if not public.admin_can('main') then raise exception 'admin only'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid email'; end if;
  insert into planner_allowed (email, is_admin) values (e, coalesce(p_admin, false))
  on conflict (email) do update set is_admin = planner_allowed.is_admin or excluded.is_admin;
end $$;

-- planner_remove_user (main)
create or replace function public.planner_remove_user(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  if not public.admin_can('main') then raise exception 'admin only'; end if;
  if e = lower(auth.jwt() ->> 'email') then raise exception 'you cannot remove yourself'; end if;
  delete from planner_allowed where email = e;
end $$;
