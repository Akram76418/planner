-- webinar-attendance.sql: مدة الحضور تلقائياً + حد أدنى لإصدار الشهادة + تصدير منسّق
-- يُشغَّل بعد webinar.sql
alter table public.wb_regs add column if not exists seconds_present integer not null default 0 check (seconds_present >= 0);
alter table public.wb_regs add column if not exists last_seen timestamptz;
alter table public.wb_events add column if not exists min_minutes integer check (min_minutes is null or min_minutes between 1 and 720);

-- نبضة كل دقيقة من صفحة الويبنار المفتوحة: تُحتسب المدة داخل نافذة البث فقط
create or replace function public.wb_ping(p_id bigint) returns integer
language plpgsql security definer set search_path = public set row_security = off as $$
declare e wb_events; r wb_regs; gap numeric; sec integer;
begin
  select * into e from wb_events where id = p_id; if not found or e.cancelled then return 0; end if;
  select * into r from wb_regs where event_id = p_id and user_id = auth.uid() and joined_at is not null;
  if not found then return 0; end if;
  if not (now() >= e.starts_at - make_interval(mins => e.open_before_min) and now() <= e.starts_at + make_interval(mins => e.duration_min) + interval '60 minutes') then
    return r.seconds_present;
  end if;
  gap := case when r.last_seen is null then 0 else extract(epoch from now() - r.last_seen) end;
  sec := r.seconds_present + least(greatest(gap, 0), 75)::integer;
  update wb_regs set seconds_present = sec, last_seen = now() where event_id = p_id and user_id = auth.uid();
  return sec;
end $$;

drop function if exists public.wb_attendees(bigint);
create function public.wb_attendees(p_id bigint)
returns table(user_id uuid, full_name text, acct_role text, university_id text, registered_at timestamptz, joined_at timestamptz, minutes integer)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.wb_is_mgr(p_id) then raise exception 'not allowed'; end if;
  return query select r.user_id, p.full_name, p.role::text, p.university_id, r.registered_at, r.joined_at, (r.seconds_present / 60)::integer
    from wb_regs r left join profiles p on p.id = r.user_id where r.event_id = p_id order by (r.joined_at is null), p.full_name;
end $$;

-- الحد الأدنى للشهادة (المنظّم)
create or replace function public.wb_min_get(p_id bigint) returns integer
language plpgsql stable security definer set search_path = public set row_security = off as $$
declare m integer;
begin
  if not public.wb_is_mgr(p_id) then raise exception 'not allowed'; end if;
  select min_minutes into m from wb_events where id = p_id; return m;
end $$;
create or replace function public.wb_min_set(p_id bigint, p_min integer) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
begin
  if not public.wb_is_mgr(p_id) then raise exception 'not allowed'; end if;
  update wb_events set min_minutes = nullif(p_min, 0) where id = p_id;
end $$;

-- تعديل يدوي لمدة حضور شخص (لمن دخل Zoom مباشرة)
create or replace function public.wb_set_minutes(p_id bigint, p_user uuid, p_min integer) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
begin
  if not public.wb_is_mgr(p_id) then raise exception 'not allowed'; end if;
  if p_min is null or p_min < 0 or p_min > 720 then raise exception 'مدة غير صالحة'; end if;
  insert into wb_regs (event_id, user_id, joined_at, seconds_present) values (p_id, p_user, now(), p_min * 60)
    on conflict (event_id, user_id) do update set seconds_present = p_min * 60, joined_at = coalesce(wb_regs.joined_at, now());
end $$;

-- الحضور اليدوي: يُعطى كامل مدة الويبنار ما لم تكن هناك مدة مسجّلة
create or replace function public.wb_mark_attended(p_id bigint, p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare d integer;
begin
  if not public.wb_is_mgr(p_id) then raise exception 'not allowed'; end if;
  select duration_min into d from wb_events where id = p_id;
  insert into wb_regs (event_id, user_id, joined_at, seconds_present) values (p_id, p_user, case when p_on then now() end, case when p_on then d * 60 else 0 end)
    on conflict (event_id, user_id) do update set joined_at = case when p_on then coalesce(wb_regs.joined_at, now()) else null end,
      seconds_present = case when p_on then case when wb_regs.seconds_present = 0 then d * 60 else wb_regs.seconds_present end else 0 end;
end $$;

-- الشهادة: تتضمن مدة الحضور، وتُشترط الحد الأدنى إن حدّده المنظّم
drop function if exists public.wb_cert(bigint);
create function public.wb_cert(p_id bigint)
returns table(full_name text, title text, speaker text, starts_at timestamptz, duration_min integer, minutes integer)
language plpgsql stable security definer set search_path = public set row_security = off as $$
declare e wb_events; r wb_regs;
begin
  select * into e from wb_events where id = p_id; if not found then raise exception 'غير موجود'; end if;
  select * into r from wb_regs where event_id = p_id and user_id = auth.uid() and joined_at is not null;
  if not found then raise exception 'الشهادة لمن سُجّل حضوره'; end if;
  if e.min_minutes is not null and r.seconds_present < e.min_minutes * 60 then
    raise exception 'تُصدر الشهادة لمن حضر % دقيقة على الأقل. مدة حضورك المسجّلة: % دقيقة. (يُحتسب الوقت وصفحة الويبنار مفتوحة في التطبيق)', e.min_minutes, (r.seconds_present / 60);
  end if;
  return query select p.full_name, e.title, e.speaker, e.starts_at, e.duration_min, (r.seconds_present / 60)::integer from profiles p where p.id = auth.uid();
end $$;

revoke execute on function public.wb_ping(bigint), public.wb_attendees(bigint), public.wb_min_get(bigint), public.wb_min_set(bigint, integer), public.wb_set_minutes(bigint, uuid, integer), public.wb_mark_attended(bigint, uuid, boolean), public.wb_cert(bigint) from public, anon;
grant execute on function public.wb_ping(bigint), public.wb_attendees(bigint), public.wb_min_get(bigint), public.wb_min_set(bigint, integer), public.wb_set_minutes(bigint, uuid, integer), public.wb_mark_attended(bigint, uuid, boolean), public.wb_cert(bigint) to authenticated;
select 'ready' as status;
