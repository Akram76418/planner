-- growth.sql: سجل تدقيق + تاريخ الشعب + تقرير الشعب + نسخة احتياطية + وقت المحاضرة
-- يُشغَّل بعد people-search.sql (يعيد تعريف comm_person_update ليسجّل التعديل)

-- 1) سجل التدقيق
create table if not exists public.comm_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid, actor_name text, action text not null,
  target_id uuid, target_name text, detail text
);
create index if not exists comm_audit_at on public.comm_audit (at desc);
alter table public.comm_audit enable row level security;
revoke all on public.comm_audit from anon, authenticated;

create or replace function public.comm_audit_add(p_action text, p_target uuid default null, p_target_name text default null, p_detail text default null) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  insert into comm_audit (actor, actor_name, action, target_id, target_name, detail)
  values (auth.uid(), (select full_name from profiles where id = auth.uid()), left(p_action, 60), p_target, left(p_target_name, 200), left(p_detail, 500));
end $$;

create or replace function public.comm_audit_list(p_q text default '', p_limit integer default 200)
returns table(id bigint, at timestamptz, actor_name text, action text, target_name text, detail text)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.admin_can('main') then raise exception 'main admin only'; end if;
  return query select a.id, a.at, a.actor_name, a.action, a.target_name, a.detail from comm_audit a
   where nullif(trim(p_q), '') is null or a.action ilike '%' || trim(p_q) || '%' or coalesce(a.target_name, '') ilike '%' || trim(p_q) || '%' or coalesce(a.detail, '') ilike '%' || trim(p_q) || '%' or coalesce(a.actor_name, '') ilike '%' || trim(p_q) || '%'
   order by a.id desc limit least(coalesce(p_limit, 200), 500);
end $$;

-- 2) تاريخ الشعب (يُسجَّل تلقائياً بمشغّل على عضوية الشعب)
create table if not exists public.comm_cohort_history (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid not null, user_name text,
  from_id integer, from_name text, to_id integer, to_name text, by_id uuid
);
create index if not exists comm_cohort_history_u on public.comm_cohort_history (user_id, at desc);
alter table public.comm_cohort_history enable row level security;
revoke all on public.comm_cohort_history from anon, authenticated;

create or replace function public.comm_cohort_hist_trg() returns trigger
language plpgsql security definer set search_path = public set row_security = off as $$
declare f integer; t integer; uid uuid;
begin
  if tg_op = 'INSERT' then f := null; t := new.cohort_id; uid := new.user_id;
  elsif tg_op = 'DELETE' then f := old.cohort_id; t := null; uid := old.user_id;
  else f := old.cohort_id; t := new.cohort_id; uid := new.user_id; end if;
  if f is not distinct from t then return coalesce(new, old); end if;
  insert into comm_cohort_history (user_id, user_name, from_id, from_name, to_id, to_name, by_id)
  values (uid, (select full_name from profiles where id = uid), f, (select name from comm_cohorts where id = f), t, (select name from comm_cohorts where id = t), auth.uid());
  return coalesce(new, old);
end $$;
drop trigger if exists comm_cohort_hist on public.comm_cohort_members;
create trigger comm_cohort_hist after insert or update or delete on public.comm_cohort_members
  for each row execute function public.comm_cohort_hist_trg();

create or replace function public.comm_person_history(p_user uuid)
returns table(at timestamptz, from_name text, to_name text)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.admin_can('students') then raise exception 'admin only'; end if;
  return query select h.at, h.from_name, h.to_name from comm_cohort_history h where h.user_id = p_user order by h.id desc limit 50;
end $$;

-- 3) تعديل الاسم/الرقم مع التسجيل
create or replace function public.comm_person_update(p_user uuid, p_name text, p_number text) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare v_name text := trim(coalesce(p_name, '')); v_num text := trim(coalesce(p_number, '')); v_role text; v_mail text; o profiles;
begin
  if not public.admin_can('students') then raise exception 'admin only'; end if;
  select * into o from profiles where id = p_user;
  if not found then raise exception 'not found'; end if;
  v_role := o.role::text;
  if v_role = 'admin' then raise exception 'cannot edit admin'; end if;
  if v_name = '' then raise exception 'الاسم فارغ'; end if;
  if v_num !~ '^[A-Za-z0-9]{3,20}$' then raise exception 'الرقم غير صالح (3–20 حرفاً أو رقماً إنجليزياً)'; end if;
  if exists (select 1 from profiles where id <> p_user and (university_id = v_num or national_id = v_num or employee_number = v_num)) then
    raise exception 'الرقم مستخدم لشخص آخر';
  end if;
  update profiles set full_name = v_name, university_id = v_num,
         employee_number = case when v_role = 'student' then employee_number else v_num end
   where id = p_user;
  v_mail := lower(v_num) || '@planner.local';
  if exists (select 1 from auth.users where id = p_user and email like '%@planner.local')
     and not exists (select 1 from auth.users where id <> p_user and lower(email) = v_mail) then
    update auth.users set email = v_mail where id = p_user;
    update auth.identities set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_mail)), provider_id = v_mail where user_id = p_user and provider = 'email';
  end if;
  insert into comm_audit (actor, actor_name, action, target_id, target_name, detail)
  values (auth.uid(), (select full_name from profiles where id = auth.uid()), 'تعديل بيانات', p_user, v_name,
          'الاسم: ' || coalesce(o.full_name, '') || ' ← ' || v_name || ' | الرقم: ' || coalesce(o.university_id, '') || ' ← ' || v_num);
end $$;

-- 4) تقرير الشعب
create or replace function public.comm_cohort_report()
returns table(cohort_id integer, cohort_name text, members bigint, never_signed bigint, inactive_14 bigint, default_pw bigint, ann_30 bigint, read_pct integer)
language plpgsql stable security definer set search_path = public, auth set row_security = off as $$
begin
  if not public.admin_can('students') then raise exception 'admin only'; end if;
  return query
  select c.id, c.name,
    (select count(*) from comm_cohort_members m where m.cohort_id = c.id),
    (select count(*) from comm_cohort_members m join auth.users u on u.id = m.user_id where m.cohort_id = c.id and u.last_sign_in_at is null),
    (select count(*) from comm_cohort_members m join auth.users u on u.id = m.user_id where m.cohort_id = c.id and u.last_sign_in_at < now() - interval '14 days'),
    (select count(*) from comm_cohort_members m join comm_pw_status s on s.user_id = m.user_id where m.cohort_id = c.id and s.must_change),
    (select count(*) from comm_announcements a where a.cohort_id = c.id and a.created_at > now() - interval '30 days'),
    (select case when n.total = 0 or mem.n = 0 then null else least(100, round(100.0 * n.reads / (n.total * mem.n)))::integer end
       from (select count(*) total, coalesce(sum((select count(*) from comm_ann_reads r where r.ann_id = a.id)), 0) reads
               from comm_announcements a where a.cohort_id = c.id and a.created_at > now() - interval '30 days') n,
            (select count(*) n from comm_cohort_members m where m.cohort_id = c.id) mem)
  from comm_cohorts c where c.is_active order by c.name;
end $$;

create or replace function public.comm_cohort_inactive(p_cohort integer, p_days integer default 14)
returns table(id uuid, full_name text, university_id text, last_sign_in timestamptz, default_pw boolean)
language plpgsql stable security definer set search_path = public, auth set row_security = off as $$
begin
  if not public.admin_can('students') then raise exception 'admin only'; end if;
  return query
  select p.id, p.full_name, p.university_id, u.last_sign_in_at, coalesce(s.must_change, false)
  from comm_cohort_members m join profiles p on p.id = m.user_id join auth.users u on u.id = p.id
  left join comm_pw_status s on s.user_id = p.id
  where m.cohort_id = p_cohort and (u.last_sign_in_at is null or u.last_sign_in_at < now() - make_interval(days => greatest(1, coalesce(p_days, 14))))
  order by u.last_sign_in_at nulls first, p.full_name;
end $$;

-- 5) نسخة احتياطية (مسؤول رئيسي فقط)
create or replace function public.comm_backup_export() returns jsonb
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.admin_can('main') then raise exception 'main admin only'; end if;
  return jsonb_build_object(
    'at', now(),
    'people', coalesce((select jsonb_agg(jsonb_build_object('role', p.role, 'name', p.full_name, 'number', p.university_id, 'major', p.major, 'cohort', c.name) order by p.role::text, p.full_name)
                from profiles p left join comm_cohort_members m on m.user_id = p.id left join comm_cohorts c on c.id = m.cohort_id), '[]'::jsonb),
    'cohorts', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'active', c.is_active, 'members', (select count(*) from comm_cohort_members m where m.cohort_id = c.id)) order by c.name) from comm_cohorts c), '[]'::jsonb),
    'announcements', coalesce((select jsonb_agg(jsonb_build_object('cohort', c.name, 'title', a.title, 'body', a.body, 'at', a.created_at) order by a.id desc) from (select * from comm_announcements order by id desc limit 500) a left join comm_cohorts c on c.id = a.cohort_id), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('at', x.at, 'actor', x.actor_name, 'action', x.action, 'target', x.target_name, 'detail', x.detail) order by x.id desc) from (select * from comm_audit order by id desc limit 500) x), '[]'::jsonb));
end $$;

-- 6) وقت المحاضرة (الساعة) في الحجز
alter table public.book_groups add column if not exists lecture_time text check (lecture_time is null or lecture_time ~ '^[0-2][0-9]:[0-5][0-9]$');
create or replace function public.bk_times(p_off bigint) returns table(group_no integer, lecture_time text)
language sql stable security definer set search_path = public set row_security = off as $$
  select g.group_no, g.lecture_time from book_groups g join book_offerings o on o.id = g.offering_id
  where g.offering_id = p_off and auth.uid() is not null and g.lecture_time is not null
    and (public.current_user_role() in ('admin','professor','staff')
         or o.cohort_id is null or o.cohort_id = (select m.cohort_id from comm_cohort_members m where m.user_id = auth.uid()))
$$;

revoke execute on function public.comm_audit_add(text, uuid, text, text), public.comm_audit_list(text, integer), public.comm_person_history(uuid), public.comm_person_update(uuid, text, text),
  public.comm_cohort_report(), public.comm_cohort_inactive(integer, integer), public.comm_backup_export(), public.bk_times(bigint) from public, anon;
grant execute on function public.comm_audit_add(text, uuid, text, text), public.comm_audit_list(text, integer), public.comm_person_history(uuid), public.comm_person_update(uuid, text, text),
  public.comm_cohort_report(), public.comm_cohort_inactive(integer, integer), public.comm_backup_export(), public.bk_times(bigint) to authenticated;
select 'ready';
