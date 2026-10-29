-- ميزات الطلبة: الرئيسية، الجدول، إعلانات مثبّتة مع المقروء، استبيانات.
-- شغّله مرة واحدة بعد faculty-update.sql. يضيف جداول ودوالاً فقط، ولا يحذف بيانات.

-- ───── 1) الإعلانات: تثبيت + «اطّلع» ─────
alter table public.comm_announcements add column if not exists pinned boolean not null default false;

create table if not exists public.comm_ann_reads (
  ann_id  bigint not null references public.comm_announcements(id) on delete cascade,
  user_id uuid   not null references auth.users(id) on delete cascade,
  at      timestamptz not null default now(),
  primary key (ann_id, user_id)
);
alter table public.comm_ann_reads enable row level security;
revoke all on public.comm_ann_reads from anon, authenticated;

drop function if exists public.comm_ann_list(integer, bigint, integer);
create or replace function public.comm_ann_list(p_cohort integer, p_before bigint default null, p_limit integer default 40)
returns table(id bigint, sender_id uuid, sender_name text, title text, body text, file_path text, file_name text, file_type text, file_size bigint, created_at timestamptz, pinned boolean, readers bigint)
language plpgsql stable security definer set search_path = public set row_security = off as $$
declare adm boolean := public.current_user_role() = 'admin';
begin
  if not public.comm_can_read_cohort(p_cohort) then raise exception 'not allowed'; end if;
  return query select a.id, a.sender_id, p.full_name, a.title, a.body, a.file_path, a.file_name, a.file_type, a.file_size, a.created_at, a.pinned,
      case when adm then (select count(*) from comm_ann_reads r where r.ann_id = a.id) else null end
    from comm_announcements a left join profiles p on p.id = a.sender_id
    where a.cohort_id = p_cohort and (p_before is null or a.id < p_before)
    order by a.pinned desc, a.id desc limit greatest(1, least(coalesce(p_limit, 40), 100));
end $$;

create or replace function public.comm_ann_mark_read(p_cohort integer) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
begin
  if auth.uid() is null or public.current_user_role() = 'admin' then return; end if;
  if not public.comm_can_read_cohort(p_cohort) then return; end if;
  insert into comm_ann_reads (ann_id, user_id)
    select a.id, auth.uid() from comm_announcements a where a.cohort_id = p_cohort
  on conflict do nothing;
end $$;

create or replace function public.comm_ann_pin(p_id bigint, p_pinned boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  update comm_announcements set pinned = coalesce(p_pinned, false) where id = p_id;
end $$;
revoke execute on function public.comm_ann_list(integer, bigint, integer), public.comm_ann_mark_read(integer), public.comm_ann_pin(bigint, boolean) from public, anon;
grant execute on function public.comm_ann_list(integer, bigint, integer), public.comm_ann_mark_read(integer), public.comm_ann_pin(bigint, boolean) to authenticated;

-- ───── 2) الجدول (محاضرات / تدريب عملي / امتحانات / أحداث) ─────
create table if not exists public.comm_schedule (
  id         bigint generated always as identity primary key,
  cohort_id  integer references public.comm_cohorts(id) on delete cascade,  -- فارغ = كل الشعب
  kind       text not null default 'lecture' check (kind in ('lecture','clinical','exam','event','other')),
  title      text not null check (length(trim(title)) between 1 and 200),
  event_date date not null,
  start_time time,
  end_time   time,
  place      text check (place is null or length(place) <= 200),
  notes      text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists comm_schedule_idx on public.comm_schedule (event_date, start_time);
alter table public.comm_schedule enable row level security;
revoke all on public.comm_schedule from anon, authenticated;

create or replace function public.comm_sched_list(p_from date default current_date)
returns table(id bigint, cohort_id integer, cohort_name text, kind text, title text, event_date date, start_time time, end_time time, place text, notes text)
language plpgsql stable security definer set search_path = public set row_security = off as $$
declare r text := public.current_user_role(); myc integer;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  select m.cohort_id into myc from comm_cohort_members m where m.user_id = auth.uid();
  return query
    select s.id, s.cohort_id, c.name, s.kind, s.title, s.event_date, s.start_time, s.end_time, s.place, s.notes
    from comm_schedule s left join comm_cohorts c on c.id = s.cohort_id
    where s.event_date >= coalesce(p_from, current_date)
      and (r in ('admin','professor','staff') or s.cohort_id is null or s.cohort_id = myc)
    order by s.event_date, s.start_time nulls first, s.id limit 300;
end $$;

create or replace function public.comm_sched_save(p_id bigint, p_cohort integer, p_kind text, p_title text, p_date date, p_start time, p_end time, p_place text, p_notes text)
returns bigint language plpgsql security definer set search_path = public as $$
declare nid bigint;
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  if p_id is null then
    insert into comm_schedule (cohort_id, kind, title, event_date, start_time, end_time, place, notes)
    values (p_cohort, p_kind, trim(p_title), p_date, p_start, p_end, nullif(trim(p_place), ''), nullif(trim(p_notes), '')) returning id into nid;
  else
    update comm_schedule set cohort_id = p_cohort, kind = p_kind, title = trim(p_title), event_date = p_date, start_time = p_start, end_time = p_end,
      place = nullif(trim(p_place), ''), notes = nullif(trim(p_notes), '') where id = p_id returning id into nid;
  end if;
  return nid;
end $$;

create or replace function public.comm_sched_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  delete from comm_schedule where id = p_id;
end $$;
revoke execute on function public.comm_sched_list(date), public.comm_sched_save(bigint, integer, text, text, date, time, time, text, text), public.comm_sched_delete(bigint) from public, anon;
grant execute on function public.comm_sched_list(date), public.comm_sched_save(bigint, integer, text, text, date, time, time, text, text), public.comm_sched_delete(bigint) to authenticated;

-- ───── 3) الاستبيانات ─────
create table if not exists public.comm_polls (
  id         bigint generated always as identity primary key,
  cohort_id  integer references public.comm_cohorts(id) on delete cascade,  -- فارغ = كل الطلبة
  question   text not null check (length(trim(question)) between 1 and 300),
  options    text[] not null check (array_length(options, 1) between 2 and 8),
  closed     boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.comm_poll_votes (
  poll_id bigint not null references public.comm_polls(id) on delete cascade,
  user_id uuid   not null references auth.users(id) on delete cascade,
  opt     integer not null check (opt >= 0),
  at      timestamptz not null default now(),
  primary key (poll_id, user_id)
);
alter table public.comm_polls enable row level security;
alter table public.comm_poll_votes enable row level security;
revoke all on public.comm_polls, public.comm_poll_votes from anon, authenticated;

create or replace function public.comm_poll_list()
returns table(id bigint, cohort_id integer, cohort_name text, question text, options text[], closed boolean, created_at timestamptz, my_vote integer, counts integer[], total integer, eligible bigint)
language plpgsql stable security definer set search_path = public set row_security = off as $$
declare r text := public.current_user_role(); myc integer;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  select m.cohort_id into myc from comm_cohort_members m where m.user_id = auth.uid();
  return query
    select p.id, p.cohort_id, c.name, p.question, p.options, p.closed, p.created_at,
      (select v.opt from comm_poll_votes v where v.poll_id = p.id and v.user_id = auth.uid()),
      case when r in ('admin','professor','staff') or p.closed or exists (select 1 from comm_poll_votes v where v.poll_id = p.id and v.user_id = auth.uid())
           then (select array_agg((select count(*)::int from comm_poll_votes v where v.poll_id = p.id and v.opt = g.i - 1) order by g.i) from generate_series(1, array_length(p.options, 1)) g(i))
           else null end,
      (select count(*)::int from comm_poll_votes v where v.poll_id = p.id),
      case when p.cohort_id is null then (select count(*) from profiles x where x.role::text = 'student')
           else (select count(*) from comm_cohort_members m2 where m2.cohort_id = p.cohort_id) end
    from comm_polls p left join comm_cohorts c on c.id = p.cohort_id
    where r in ('admin','professor','staff') or p.cohort_id is null or p.cohort_id = myc
    order by p.closed, p.id desc limit 100;
end $$;

create or replace function public.comm_poll_vote(p_poll bigint, p_opt integer) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare pl comm_polls; myc integer;
begin
  if auth.uid() is null or public.current_user_role() <> 'student' then raise exception 'للطلبة فقط'; end if;
  select * into pl from comm_polls where id = p_poll;
  if not found or pl.closed then raise exception 'الاستبيان مغلق'; end if;
  select m.cohort_id into myc from comm_cohort_members m where m.user_id = auth.uid();
  if pl.cohort_id is not null and pl.cohort_id is distinct from myc then raise exception 'not allowed'; end if;
  if p_opt < 0 or p_opt >= array_length(pl.options, 1) then raise exception 'bad option'; end if;
  insert into comm_poll_votes (poll_id, user_id, opt) values (p_poll, auth.uid(), p_opt)
  on conflict (poll_id, user_id) do update set opt = excluded.opt, at = now();
end $$;

create or replace function public.comm_poll_create(p_cohort integer, p_question text, p_options text[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare nid bigint; opts text[];
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  select array_agg(trim(x)) into opts from unnest(p_options) x where length(trim(x)) > 0;
  if coalesce(array_length(opts, 1), 0) < 2 then raise exception 'يلزم خياران على الأقل'; end if;
  insert into comm_polls (cohort_id, question, options) values (p_cohort, trim(p_question), opts[1:8]) returning id into nid;
  return nid;
end $$;

create or replace function public.comm_poll_close(p_id bigint, p_closed boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  update comm_polls set closed = coalesce(p_closed, true) where id = p_id;
end $$;
create or replace function public.comm_poll_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  delete from comm_polls where id = p_id;
end $$;
revoke execute on function public.comm_poll_list(), public.comm_poll_vote(bigint, integer), public.comm_poll_create(integer, text, text[]), public.comm_poll_close(bigint, boolean), public.comm_poll_delete(bigint) from public, anon;
grant execute on function public.comm_poll_list(), public.comm_poll_vote(bigint, integer), public.comm_poll_create(integer, text, text[]), public.comm_poll_close(bigint, boolean), public.comm_poll_delete(bigint) to authenticated;

-- ───── 4) مشرف الطالب (للرئيسية) ─────
create or replace function public.comm_my_supervisor() returns table(id uuid, full_name text)
language sql stable security definer set search_path = public set row_security = off as $$
  select s.id, s.full_name from profiles me join profiles s on s.id = me.professor_id where me.id = auth.uid()
$$;
revoke execute on function public.comm_my_supervisor() from public, anon;
grant execute on function public.comm_my_supervisor() to authenticated;

-- مسح المراسلات يشمل الآن اطّلاع الإعلانات أيضاً (تُحذف تلقائياً مع الإعلانات).
