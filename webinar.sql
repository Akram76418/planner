-- ويبنار: جدولة وتسجيل وحضور وأسئلة واستطلاعات وتقييم وشهادات + تسجيل الطلبة صوتاً وصورة وإرساله للمحاضر.
-- البث نفسه عبر رابط خارجي (Zoom/Meet/Teams/Jitsi) يظهر للمسجّلين فقط عند الموعد.
-- أمان: كل الجداول مغلقة (RLS) والكتابة والقراءة عبر دوال RPC فقط. شغّله مرة (آمن للتكرار).
-- صلاحية المدير الفرعي: المفتاح 'wb' في admin_perms. المدير الرئيسي والمحاضر ينشئان ويديران ويبناراتهما.

create table if not exists public.wb_events (
  id bigint generated always as identity primary key,
  title text not null check (length(trim(title)) between 2 and 200),
  speaker text check (speaker is null or length(speaker) <= 200),
  descr text check (descr is null or length(descr) <= 4000),
  starts_at timestamptz not null,
  duration_min integer not null default 60 check (duration_min between 5 and 720),
  link text check (link is null or link ~* '^https?://'),
  aud_students boolean not null default false,
  aud_staff boolean not null default false,
  cohort_ids integer[] not null default '{}',
  materials_url text check (materials_url is null or materials_url ~* '^https?://'),
  record_url text check (record_url is null or record_url ~* '^https?://'),
  allow_recordings boolean not null default false,
  cancelled boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create table if not exists public.wb_regs (
  event_id bigint not null references public.wb_events(id) on delete cascade,
  user_id uuid not null,
  registered_at timestamptz not null default now(),
  joined_at timestamptz,
  primary key (event_id, user_id)
);
create table if not exists public.wb_questions (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.wb_events(id) on delete cascade,
  user_id uuid not null,
  body text not null check (length(trim(body)) between 1 and 1000),
  anon boolean not null default false,
  answer text check (answer is null or length(answer) <= 2000),
  answered_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.wb_qvotes (
  question_id bigint not null references public.wb_questions(id) on delete cascade,
  user_id uuid not null,
  primary key (question_id, user_id)
);
create table if not exists public.wb_polls (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.wb_events(id) on delete cascade,
  question text not null check (length(trim(question)) between 2 and 300),
  options text[] not null check (array_length(options, 1) between 2 and 8),
  closed boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.wb_pvotes (
  poll_id bigint not null references public.wb_polls(id) on delete cascade,
  user_id uuid not null,
  opt integer not null,
  primary key (poll_id, user_id)
);
create table if not exists public.wb_feedback (
  event_id bigint not null references public.wb_events(id) on delete cascade,
  user_id uuid not null,
  rating integer not null check (rating between 1 and 5),
  comment text check (comment is null or length(comment) <= 1000),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create table if not exists public.wb_recs (
  id bigint generated always as identity primary key,
  event_id bigint references public.wb_events(id) on delete cascade,
  user_id uuid not null,
  file_path text not null,
  file_name text not null,
  mime text, size_bytes bigint, seconds integer,
  created_at timestamptz not null default now()
);
create index if not exists wb_regs_u on public.wb_regs (user_id);
create index if not exists wb_q_e on public.wb_questions (event_id);
create index if not exists wb_recs_e on public.wb_recs (event_id);
alter table public.wb_events enable row level security; alter table public.wb_regs enable row level security;
alter table public.wb_questions enable row level security; alter table public.wb_qvotes enable row level security;
alter table public.wb_polls enable row level security; alter table public.wb_pvotes enable row level security;
alter table public.wb_feedback enable row level security; alter table public.wb_recs enable row level security;
revoke all on public.wb_events, public.wb_regs, public.wb_questions, public.wb_qvotes, public.wb_polls, public.wb_pvotes, public.wb_feedback, public.wb_recs from anon, authenticated;

-- ───── مساعدات ─────
create or replace function public.wb_is_ext(u uuid) returns boolean
language plpgsql stable security definer set search_path = public set row_security = off as $$
declare r boolean;
begin
  if to_regprocedure('public.ex_is_external(uuid)') is null then return false; end if;
  execute 'select public.ex_is_external($1)' into r using u; return coalesce(r, false);
end $$;

create or replace function public.wb_is_mgr(eid bigint) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select auth.uid() is not null and (public.admin_can('wb') or exists (select 1 from wb_events e where e.id = eid and e.created_by = auth.uid()))
$$;

create or replace function public.wb_can_see(eid bigint) returns boolean
language plpgsql stable security definer set search_path = public set row_security = off as $$
declare e wb_events; r text := public.current_user_role();
begin
  if auth.uid() is null then return false; end if;
  select * into e from wb_events where id = eid; if not found then return false; end if;
  if public.wb_is_mgr(eid) then return true; end if;
  if exists (select 1 from wb_regs where event_id = eid and user_id = auth.uid()) then return true; end if;
  if e.cancelled and not exists (select 1 from wb_regs where event_id = eid and user_id = auth.uid()) then return false; end if;
  if exists (select 1 from comm_cohort_members m where m.user_id = auth.uid() and m.cohort_id = any (e.cohort_ids)) then return true; end if;
  if e.aud_students and r = 'student' and not public.wb_is_ext(auth.uid()) then return true; end if;
  if e.aud_staff and r in ('professor', 'staff', 'admin') then return true; end if;
  return false;
end $$;

-- ───── الفعاليات ─────
-- فتح الرابط عند الموعد تماماً (يمكن للمنظّم تقديمه بدقائق اختيارياً)، ولا تسجيل ذاتي: كل من في الجمهور يدخل مباشرة ويُسجَّل حضوره عند الضغط
alter table public.wb_events add column if not exists open_before_min integer not null default 0 check (open_before_min between 0 and 120);
drop function if exists public.wb_list();
drop function if exists public.wb_save(bigint, text, text, text, timestamptz, integer, text, boolean, boolean, integer[], text, text, boolean);
create or replace function public.wb_list()
returns table(id bigint, title text, speaker text, descr text, starts_at timestamptz, duration_min integer, link text, aud_students boolean, aud_staff boolean, cohort_ids integer[],
  materials_url text, record_url text, allow_recordings boolean, cancelled boolean, created_by uuid, creator_name text, is_mgr boolean,
  registered boolean, joined boolean, regs bigint, attended bigint, questions bigint, my_rating integer, link_open boolean, open_before_min integer)
language sql stable security definer set search_path = public set row_security = off as $$
  select e.id, e.title, e.speaker, e.descr, e.starts_at, e.duration_min,
    case when public.wb_is_mgr(e.id) or (not e.cancelled and now() >= e.starts_at - make_interval(mins => e.open_before_min) and now() <= e.starts_at + make_interval(mins => e.duration_min) + interval '60 minutes') then e.link end,
    e.aud_students, e.aud_staff, e.cohort_ids, e.materials_url, e.record_url, e.allow_recordings, e.cancelled, e.created_by, p.full_name, public.wb_is_mgr(e.id),
    r.user_id is not null, r.joined_at is not null,
    (select count(*) from wb_regs x where x.event_id = e.id), (select count(*) from wb_regs x where x.event_id = e.id and x.joined_at is not null),
    (select count(*) from wb_questions q where q.event_id = e.id),
    (select f.rating from wb_feedback f where f.event_id = e.id and f.user_id = auth.uid()),
    (not e.cancelled and now() >= e.starts_at - make_interval(mins => e.open_before_min) and now() <= e.starts_at + make_interval(mins => e.duration_min) + interval '60 minutes'),
    e.open_before_min
  from wb_events e left join wb_regs r on r.event_id = e.id and r.user_id = auth.uid() left join profiles p on p.id = e.created_by
  where auth.uid() is not null and public.wb_can_see(e.id)
  order by e.starts_at desc
$$;

create or replace function public.wb_save(p_id bigint, p_title text, p_speaker text, p_descr text, p_starts timestamptz, p_dur integer, p_link text,
  p_students boolean, p_staff boolean, p_cohorts integer[], p_materials text, p_record text, p_allow_rec boolean, p_open_min integer default 0) returns bigint
language plpgsql security definer set search_path = public set row_security = off as $$
declare rid bigint; r text := public.current_user_role();
begin
  if auth.uid() is null or r not in ('admin', 'professor') then raise exception 'not allowed'; end if;
  if r = 'admin' and not public.admin_can('wb') then raise exception 'not allowed'; end if;
  if p_title is null or length(trim(p_title)) < 2 then raise exception 'اكتب عنوان الويبنار'; end if;
  if p_starts is null then raise exception 'حدّد الموعد'; end if;
  if p_id is null then
    insert into wb_events (title, speaker, descr, starts_at, duration_min, link, aud_students, aud_staff, cohort_ids, materials_url, record_url, allow_recordings, open_before_min, created_by)
    values (trim(p_title), nullif(trim(coalesce(p_speaker, '')), ''), nullif(trim(coalesce(p_descr, '')), ''), p_starts, greatest(5, least(720, coalesce(p_dur, 60))), nullif(trim(coalesce(p_link, '')), ''),
      coalesce(p_students, false), coalesce(p_staff, false), coalesce(p_cohorts, '{}'), nullif(trim(coalesce(p_materials, '')), ''), nullif(trim(coalesce(p_record, '')), ''), coalesce(p_allow_rec, false), greatest(0, least(120, coalesce(p_open_min, 0))), auth.uid()) returning id into rid;
  else
    if not public.wb_is_mgr(p_id) then raise exception 'not allowed'; end if;
    update wb_events set title = trim(p_title), speaker = nullif(trim(coalesce(p_speaker, '')), ''), descr = nullif(trim(coalesce(p_descr, '')), ''), starts_at = p_starts,
      duration_min = greatest(5, least(720, coalesce(p_dur, 60))), link = nullif(trim(coalesce(p_link, '')), ''), aud_students = coalesce(p_students, false), aud_staff = coalesce(p_staff, false),
      cohort_ids = coalesce(p_cohorts, '{}'), materials_url = nullif(trim(coalesce(p_materials, '')), ''), record_url = nullif(trim(coalesce(p_record, '')), ''), allow_recordings = coalesce(p_allow_rec, false), open_before_min = greatest(0, least(120, coalesce(p_open_min, 0)))
    where id = p_id returning id into rid;
  end if;
  return rid;
end $$;

create or replace function public.wb_cancel(p_id bigint, p_cancel boolean) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
begin
  if not public.wb_is_mgr(p_id) then raise exception 'not allowed'; end if;
  update wb_events set cancelled = coalesce(p_cancel, true) where id = p_id;
end $$;

create or replace function public.wb_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
begin
  if not public.wb_is_mgr(p_id) then raise exception 'not allowed'; end if;
  delete from wb_events where id = p_id;
end $$;

-- ───── التسجيل والانضمام ─────
create or replace function public.wb_register(p_id bigint, p_on boolean default true) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
begin
  raise exception 'لا يوجد تسجيل ذاتي: كل من في الجمهور يدخل مباشرة عند الموعد';
end $$;

-- الانضمام: يُسجَّل الحضور عند الضغط ويعيد الرابط (ضمن نافذة الموعد فقط)
create or replace function public.wb_join(p_id bigint) returns text
language plpgsql security definer set search_path = public set row_security = off as $$
declare e wb_events;
begin
  select * into e from wb_events where id = p_id; if not found then raise exception 'غير موجود'; end if;
  if not public.wb_can_see(p_id) then raise exception 'not allowed'; end if;
  if e.cancelled then raise exception 'أُلغي هذا الويبنار'; end if;
  if not public.wb_is_mgr(p_id) and not (now() >= e.starts_at - make_interval(mins => e.open_before_min) and now() <= e.starts_at + make_interval(mins => e.duration_min) + interval '60 minutes') then
    raise exception 'الرابط يُفتح عند موعد البدء'; end if;
  if e.link is null then raise exception 'لم يُضَف رابط البث بعد'; end if;
  if public.wb_is_mgr(p_id) then return e.link; end if;   -- المنظّم لا يُحتسب ضمن الحضور
  insert into wb_regs (event_id, user_id, joined_at) values (p_id, auth.uid(), now())
    on conflict (event_id, user_id) do update set joined_at = coalesce(wb_regs.joined_at, now());
  return e.link;
end $$;

create or replace function public.wb_attendees(p_id bigint)
returns table(user_id uuid, full_name text, acct_role text, university_id text, registered_at timestamptz, joined_at timestamptz)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.wb_is_mgr(p_id) then raise exception 'not allowed'; end if;
  return query select r.user_id, p.full_name, p.role::text, p.university_id, r.registered_at, r.joined_at
    from wb_regs r left join profiles p on p.id = r.user_id where r.event_id = p_id order by (r.joined_at is null), p.full_name;
end $$;

-- حضور يدوي (المنظّم يؤكد حضور من انضم عبر Zoom لا عبر التطبيق)
create or replace function public.wb_mark_attended(p_id bigint, p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
begin
  if not public.wb_is_mgr(p_id) then raise exception 'not allowed'; end if;
  insert into wb_regs (event_id, user_id, joined_at) values (p_id, p_user, case when p_on then now() end)
    on conflict (event_id, user_id) do update set joined_at = case when p_on then coalesce(wb_regs.joined_at, now()) else null end;
end $$;

-- ───── الأسئلة ─────
create or replace function public.wb_q_list(p_id bigint)
returns table(id bigint, body text, author text, mine boolean, votes bigint, voted boolean, answer text, answered_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.wb_can_see(p_id) then raise exception 'not allowed'; end if;
  return query select q.id, q.body,
      case when q.anon and not public.wb_is_mgr(p_id) then null when q.anon then coalesce(p.full_name, '') || ' (مجهول للمشاركين)' else p.full_name end,
      q.user_id = auth.uid(), (select count(*) from wb_qvotes v where v.question_id = q.id),
      exists (select 1 from wb_qvotes v where v.question_id = q.id and v.user_id = auth.uid()), q.answer, q.answered_at, q.created_at
    from wb_questions q left join profiles p on p.id = q.user_id where q.event_id = p_id
    order by (q.answer is not null), 5 desc, q.id;
end $$;
create or replace function public.wb_q_add(p_id bigint, p_body text, p_anon boolean default false) returns bigint
language plpgsql security definer set search_path = public set row_security = off as $$
declare qid bigint;
begin
  if not public.wb_can_see(p_id) then raise exception 'not allowed'; end if;
  if length(trim(coalesce(p_body, ''))) = 0 then raise exception 'اكتب السؤال'; end if;
  if (select count(*) from wb_questions where event_id = p_id and user_id = auth.uid()) >= 30 then raise exception 'بلغتَ حدّ الأسئلة'; end if;
  insert into wb_questions (event_id, user_id, body, anon) values (p_id, auth.uid(), left(trim(p_body), 1000), coalesce(p_anon, false)) returning id into qid;
  return qid;
end $$;
create or replace function public.wb_q_vote(p_qid bigint) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare eid bigint;
begin
  select event_id into eid from wb_questions where id = p_qid; if eid is null or not public.wb_can_see(eid) then raise exception 'not allowed'; end if;
  if exists (select 1 from wb_qvotes where question_id = p_qid and user_id = auth.uid()) then delete from wb_qvotes where question_id = p_qid and user_id = auth.uid();
  else insert into wb_qvotes values (p_qid, auth.uid()); end if;
end $$;
create or replace function public.wb_q_answer(p_qid bigint, p_answer text) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare eid bigint;
begin
  select event_id into eid from wb_questions where id = p_qid; if eid is null or not public.wb_is_mgr(eid) then raise exception 'not allowed'; end if;
  update wb_questions set answer = nullif(trim(coalesce(p_answer, '')), ''), answered_at = case when length(trim(coalesce(p_answer, ''))) > 0 then now() end where id = p_qid;
end $$;
create or replace function public.wb_q_delete(p_qid bigint) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare q wb_questions;
begin
  select * into q from wb_questions where id = p_qid; if not found then return; end if;
  if not (q.user_id = auth.uid() or public.wb_is_mgr(q.event_id)) then raise exception 'not allowed'; end if;
  delete from wb_questions where id = p_qid;
end $$;

-- ───── الاستطلاعات ─────
create or replace function public.wb_poll_list(p_id bigint)
returns table(id bigint, question text, options text[], closed boolean, counts integer[], my_vote integer, total bigint)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.wb_can_see(p_id) then raise exception 'not allowed'; end if;
  return query select p.id, p.question, p.options, p.closed,
      (select array_agg((select count(*)::integer from wb_pvotes v where v.poll_id = p.id and v.opt = i) order by i) from generate_series(0, array_length(p.options, 1) - 1) i),
      (select v.opt from wb_pvotes v where v.poll_id = p.id and v.user_id = auth.uid()),
      (select count(*) from wb_pvotes v where v.poll_id = p.id)
    from wb_polls p where p.event_id = p_id order by p.id desc;
end $$;
create or replace function public.wb_poll_save(p_id bigint, p_question text, p_options text[]) returns bigint
language plpgsql security definer set search_path = public set row_security = off as $$
declare pid bigint; o text[];
begin
  if not public.wb_is_mgr(p_id) then raise exception 'not allowed'; end if;
  select array_agg(trim(x)) into o from unnest(p_options) x where length(trim(x)) > 0;
  if coalesce(array_length(o, 1), 0) < 2 then raise exception 'خياران على الأقل'; end if;
  insert into wb_polls (event_id, question, options) values (p_id, trim(p_question), o) returning id into pid; return pid;
end $$;
create or replace function public.wb_poll_vote(p_poll bigint, p_opt integer) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare p wb_polls;
begin
  select * into p from wb_polls where id = p_poll; if not found or not public.wb_can_see(p.event_id) then raise exception 'not allowed'; end if;
  if p.closed then raise exception 'أُغلق الاستطلاع'; end if;
  if p_opt < 0 or p_opt >= array_length(p.options, 1) then raise exception 'خيار غير صحيح'; end if;
  insert into wb_pvotes values (p_poll, auth.uid(), p_opt) on conflict (poll_id, user_id) do update set opt = excluded.opt;
end $$;
create or replace function public.wb_poll_close(p_poll bigint, p_closed boolean) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare eid bigint;
begin
  select event_id into eid from wb_polls where id = p_poll; if eid is null or not public.wb_is_mgr(eid) then raise exception 'not allowed'; end if;
  update wb_polls set closed = coalesce(p_closed, true) where id = p_poll;
end $$;
create or replace function public.wb_poll_delete(p_poll bigint) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare eid bigint;
begin
  select event_id into eid from wb_polls where id = p_poll; if eid is null or not public.wb_is_mgr(eid) then raise exception 'not allowed'; end if;
  delete from wb_polls where id = p_poll;
end $$;

-- ───── التقييم ─────
create or replace function public.wb_fb_save(p_id bigint, p_rating integer, p_comment text) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
begin
  if not exists (select 1 from wb_regs where event_id = p_id and user_id = auth.uid() and joined_at is not null) then raise exception 'التقييم لمن حضر الويبنار'; end if;
  insert into wb_feedback (event_id, user_id, rating, comment) values (p_id, auth.uid(), p_rating, nullif(left(trim(coalesce(p_comment, '')), 1000), ''))
  on conflict (event_id, user_id) do update set rating = excluded.rating, comment = excluded.comment;
end $$;
create or replace function public.wb_fb_list(p_id bigint)
returns table(rating integer, comment text, created_at timestamptz)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.wb_is_mgr(p_id) then raise exception 'not allowed'; end if;
  return query select f.rating, f.comment, f.created_at from wb_feedback f where f.event_id = p_id order by f.created_at desc;
end $$;

-- ───── الشهادة: لمن سُجّل حضوره فقط ─────
create or replace function public.wb_cert(p_id bigint)
returns table(full_name text, title text, speaker text, starts_at timestamptz, duration_min integer)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  return query select p.full_name, e.title, e.speaker, e.starts_at, e.duration_min
    from wb_regs r join wb_events e on e.id = r.event_id join profiles p on p.id = r.user_id
    where r.event_id = p_id and r.user_id = auth.uid() and r.joined_at is not null;
  if not found then raise exception 'الشهادة لمن سُجّل حضوره'; end if;
end $$;

-- ───── تسجيلات الطلبة (صوت/صورة) ─────
create or replace function public.wb_rec_add(p_event bigint, p_path text, p_name text, p_mime text, p_size bigint, p_seconds integer) returns bigint
language plpgsql security definer set search_path = public set row_security = off as $$
declare rid bigint;
begin
  if not public.wb_path_ok_ins(p_path) then raise exception 'مسار غير مسموح'; end if;
  if p_event is not null and not exists (select 1 from wb_events where id = p_event and (allow_recordings or created_by = auth.uid())) then raise exception 'لا يقبل هذا الويبنار تسجيلات'; end if;
  insert into wb_recs (event_id, user_id, file_path, file_name, mime, size_bytes, seconds) values (p_event, auth.uid(), p_path, left(p_name, 200), left(p_mime, 80), p_size, p_seconds) returning id into rid;
  return rid;
end $$;
create or replace function public.wb_rec_list(p_event bigint)
returns table(id bigint, user_id uuid, author text, file_path text, file_name text, mime text, size_bytes bigint, seconds integer, created_at timestamptz, mine boolean)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  return query select r.id, r.user_id, p.full_name, r.file_path, r.file_name, r.mime, r.size_bytes, r.seconds, r.created_at, r.user_id = auth.uid()
    from wb_recs r left join profiles p on p.id = r.user_id
    where r.event_id = p_event and (r.user_id = auth.uid() or public.wb_is_mgr(p_event)) order by r.id desc;
end $$;
create or replace function public.wb_rec_delete(p_id bigint) returns text
language plpgsql security definer set search_path = public set row_security = off as $$
declare r wb_recs;
begin
  select * into r from wb_recs where id = p_id; if not found then return null; end if;
  if not (r.user_id = auth.uid() or (r.event_id is not null and public.wb_is_mgr(r.event_id))) then raise exception 'not allowed'; end if;
  delete from wb_recs where id = p_id; return r.file_path;
end $$;

-- مسارات التخزين: w<رقم الويبنار>/<معرّف الطالب>/اسم_الملف
create or replace function public.wb_path_ok_ins(p_name text) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select auth.uid() is not null and split_part(p_name, '/', 1) ~ '^w[0-9]{1,15}$' and split_part(p_name, '/', 2) = auth.uid()::text
    and exists (select 1 from wb_events e where e.id = substr(split_part(p_name, '/', 1), 2)::bigint and public.wb_can_see(e.id) and (e.allow_recordings or e.created_by = auth.uid()))
$$;
create or replace function public.wb_path_read(p_name text) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select auth.uid() is not null and split_part(p_name, '/', 1) ~ '^w[0-9]{1,15}$'
    and (split_part(p_name, '/', 2) = auth.uid()::text or public.wb_is_mgr(substr(split_part(p_name, '/', 1), 2)::bigint))
$$;
create or replace function public.wb_path_del(p_name text) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select public.wb_path_read(p_name) and not exists (select 1 from wb_recs where file_path = p_name)
$$;

do $$
declare f text;
begin
  foreach f in array array['wb_is_ext(uuid)', 'wb_is_mgr(bigint)', 'wb_can_see(bigint)', 'wb_list()', 'wb_save(bigint,text,text,text,timestamptz,integer,text,boolean,boolean,integer[],text,text,boolean,integer)',
    'wb_cancel(bigint,boolean)', 'wb_delete(bigint)', 'wb_register(bigint,boolean)', 'wb_join(bigint)', 'wb_attendees(bigint)', 'wb_mark_attended(bigint,uuid,boolean)',
    'wb_q_list(bigint)', 'wb_q_add(bigint,text,boolean)', 'wb_q_vote(bigint)', 'wb_q_answer(bigint,text)', 'wb_q_delete(bigint)',
    'wb_poll_list(bigint)', 'wb_poll_save(bigint,text,text[])', 'wb_poll_vote(bigint,integer)', 'wb_poll_close(bigint,boolean)', 'wb_poll_delete(bigint)',
    'wb_fb_save(bigint,integer,text)', 'wb_fb_list(bigint)', 'wb_cert(bigint)', 'wb_rec_add(bigint,text,text,text,bigint,integer)', 'wb_rec_list(bigint)', 'wb_rec_delete(bigint)',
    'wb_path_ok_ins(text)', 'wb_path_read(text)', 'wb_path_del(text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ───── التخزين: حاوية خاصة، 60 ميغابايت للتسجيل ─────
do $$
begin
  if to_regclass('storage.objects') is null then raise notice 'storage غير متاح: تخطّي إعداد الحاوية'; return; end if;
  insert into storage.buckets (id, name, public, file_size_limit) values ('webinar-files', 'webinar-files', false, 62914560)
  on conflict (id) do update set file_size_limit = 62914560, public = false;
  execute 'drop policy if exists "wb files read" on storage.objects';
  execute 'drop policy if exists "wb files insert" on storage.objects';
  execute 'drop policy if exists "wb files delete" on storage.objects';
  execute 'create policy "wb files read" on storage.objects for select to authenticated using (bucket_id = ''webinar-files'' and public.wb_path_read(name))';
  execute 'create policy "wb files insert" on storage.objects for insert to authenticated with check (bucket_id = ''webinar-files'' and public.wb_path_ok_ins(name))';
  execute 'create policy "wb files delete" on storage.objects for delete to authenticated using (bucket_id = ''webinar-files'' and public.wb_path_del(name))';
exception when others then raise notice 'تعذّر إعداد سياسات التخزين: %', sqlerrm;
end $$;

select 'ready' as status;
