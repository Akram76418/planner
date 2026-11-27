-- webinar-checks.sql: «أسئلة الحضور» أثناء الويبنار (تسجيل فقط، لا تؤثر على الشهادة)
-- يُشغَّل بعد webinar.sql و webinar-attendance.sql. شغّله خارج أوقات الاختبارات.
create table if not exists public.wb_checks (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.wb_events(id) on delete cascade,
  question text not null check (length(trim(question)) between 2 and 300),
  options text[] not null check (array_length(options, 1) between 2 and 6),
  correct integer,                                   -- فهرس الخيار الصحيح (من 0) أو null = تسجيل حضور فقط
  secs integer not null default 90 check (secs between 15 and 900),
  opened_at timestamptz,                             -- null = مسوّدة لم تُنشر
  closed boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.wb_cvotes (
  check_id bigint not null references public.wb_checks(id) on delete cascade,
  user_id uuid not null,
  opt integer not null,
  answered_at timestamptz not null default now(),
  primary key (check_id, user_id)
);
alter table public.wb_checks enable row level security;
alter table public.wb_cvotes enable row level security;
revoke all on public.wb_checks, public.wb_cvotes from public, anon, authenticated;

create or replace function public.wb_check_save(p_id bigint, p_q text, p_opts text[], p_correct integer, p_secs integer) returns bigint
language plpgsql security definer set search_path = public set row_security = off as $$
declare o text[]; cid bigint;
begin
  if not public.wb_is_mgr(p_id) then raise exception 'not allowed'; end if;
  select array_agg(trim(x)) into o from unnest(p_opts) x where length(trim(x)) > 0;
  if coalesce(array_length(o, 1), 0) < 2 then raise exception 'خياران على الأقل'; end if;
  if p_correct is not null and (p_correct < 0 or p_correct >= array_length(o, 1)) then raise exception 'الخيار الصحيح غير صالح'; end if;
  insert into wb_checks (event_id, question, options, correct, secs) values (p_id, trim(p_q), o, p_correct, greatest(15, least(coalesce(p_secs, 90), 900))) returning id into cid;
  return cid;
end $$;

create or replace function public.wb_check_publish(p_check bigint) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare eid bigint;
begin
  select event_id into eid from wb_checks where id = p_check; if eid is null or not public.wb_is_mgr(eid) then raise exception 'not allowed'; end if;
  update wb_checks set opened_at = now(), closed = false where id = p_check;
  delete from wb_cvotes where check_id = p_check;       -- إعادة النشر تبدأ من جديد
end $$;

create or replace function public.wb_check_close(p_check bigint) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare eid bigint;
begin
  select event_id into eid from wb_checks where id = p_check; if eid is null or not public.wb_is_mgr(eid) then raise exception 'not allowed'; end if;
  update wb_checks set closed = true where id = p_check;
end $$;

create or replace function public.wb_check_delete(p_check bigint) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare eid bigint;
begin
  select event_id into eid from wb_checks where id = p_check; if eid is null or not public.wb_is_mgr(eid) then raise exception 'not allowed'; end if;
  delete from wb_checks where id = p_check;
end $$;

-- قائمة المنظّم (مع الإجابة الصحيحة والأعداد)
create or replace function public.wb_check_list(p_id bigint)
returns table(id bigint, question text, options text[], correct integer, secs integer, opened_at timestamptz, is_open boolean, answered bigint, right_n bigint, counts integer[])
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.wb_is_mgr(p_id) then raise exception 'not allowed'; end if;
  return query select c.id, c.question, c.options, c.correct, c.secs, c.opened_at,
      (c.opened_at is not null and not c.closed and now() < c.opened_at + make_interval(secs => c.secs)),
      (select count(*) from wb_cvotes v where v.check_id = c.id),
      (select count(*) from wb_cvotes v where v.check_id = c.id and c.correct is not null and v.opt = c.correct),
      (select array_agg((select count(*)::integer from wb_cvotes v where v.check_id = c.id and v.opt = i) order by i) from generate_series(0, array_length(c.options, 1) - 1) i)
    from wb_checks c where c.event_id = p_id order by c.created_at, c.id;
end $$;

-- السؤال المفتوح الآن للطالب (بدون الإجابة الصحيحة)؛ لمن سجّل حضوره فقط
create or replace function public.wb_check_active(p_id bigint)
returns table(id bigint, question text, options text[], left_s integer, my_opt integer)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.wb_can_see(p_id) then return; end if;
  if not exists (select 1 from wb_regs r where r.event_id = p_id and r.user_id = auth.uid() and r.joined_at is not null) then return; end if;
  return query select c.id, c.question, c.options, ceil(extract(epoch from c.opened_at + make_interval(secs => c.secs) - now()))::integer,
      (select v.opt from wb_cvotes v where v.check_id = c.id and v.user_id = auth.uid())
    from wb_checks c where c.event_id = p_id and c.opened_at is not null and not c.closed and now() < c.opened_at + make_interval(secs => c.secs)
    order by c.opened_at desc limit 1;
end $$;

create or replace function public.wb_check_answer(p_check bigint, p_opt integer) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare c wb_checks;
begin
  select * into c from wb_checks where id = p_check; if not found or not public.wb_can_see(c.event_id) then raise exception 'not allowed'; end if;
  if c.opened_at is null or c.closed or now() >= c.opened_at + make_interval(secs => c.secs) then raise exception 'انتهى وقت السؤال'; end if;
  if not exists (select 1 from wb_regs r where r.event_id = c.event_id and r.user_id = auth.uid() and r.joined_at is not null) then raise exception 'سجّل حضورك أولاً بزر انضمام'; end if;
  if p_opt < 0 or p_opt >= array_length(c.options, 1) then raise exception 'خيار غير صحيح'; end if;
  insert into wb_cvotes (check_id, user_id, opt) values (p_check, auth.uid(), p_opt)
    on conflict (check_id, user_id) do update set opt = excluded.opt, answered_at = now();
end $$;

-- كل الإجابات (للتصدير)
create or replace function public.wb_check_results(p_id bigint)
returns table(check_id bigint, user_id uuid, opt integer, answered_at timestamptz)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.wb_is_mgr(p_id) then raise exception 'not allowed'; end if;
  return query select v.check_id, v.user_id, v.opt, v.answered_at from wb_cvotes v join wb_checks c on c.id = v.check_id where c.event_id = p_id;
end $$;

-- نتائجي: للطالب فقط، الأسئلة التي انتهت (تظهر الإجابة الصحيحة بعد الإغلاق)
create or replace function public.wb_check_mine(p_id bigint)
returns table(id bigint, question text, options text[], correct integer, my_opt integer)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.wb_can_see(p_id) then raise exception 'not allowed'; end if;
  return query select c.id, c.question, c.options, c.correct, (select v.opt from wb_cvotes v where v.check_id = c.id and v.user_id = auth.uid())
    from wb_checks c where c.event_id = p_id and c.opened_at is not null and (c.closed or now() >= c.opened_at + make_interval(secs => c.secs))
      and exists (select 1 from wb_regs r where r.event_id = p_id and r.user_id = auth.uid() and r.joined_at is not null)
    order by c.opened_at, c.id;
end $$;

revoke execute on function public.wb_check_save(bigint, text, text[], integer, integer), public.wb_check_publish(bigint), public.wb_check_close(bigint), public.wb_check_delete(bigint), public.wb_check_list(bigint), public.wb_check_active(bigint), public.wb_check_answer(bigint, integer), public.wb_check_results(bigint), public.wb_check_mine(bigint) from public, anon;
grant execute on function public.wb_check_save(bigint, text, text[], integer, integer), public.wb_check_publish(bigint), public.wb_check_close(bigint), public.wb_check_delete(bigint), public.wb_check_list(bigint), public.wb_check_active(bigint), public.wb_check_answer(bigint, integer), public.wb_check_results(bigint), public.wb_check_mine(bigint) to authenticated;
