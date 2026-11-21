-- حجز المحاضرات (3): ربط المساق بشعبة (كلية أو خارجية) + دخول الطالب بحسابه وانضمامه لمجموعة + سعة المجموعة + إشعار المحاضر عند الاكتمال
-- شغّله بعد booking.sql و booking-students.sql و external-isolation.sql. آمن لإعادة التشغيل.
-- المساقات المربوطة بشعبة لا تظهر في الصفحة العامة القديمة (book.html)؛ تُدار بالحساب داخل التطبيق فقط.

alter table public.book_offerings add column if not exists cohort_id integer references public.comm_cohorts(id) on delete set null;
alter table public.book_offerings add column if not exists group_cap integer check (group_cap is null or group_cap between 1 and 50);
alter table public.book_groups add column if not exists cap integer check (cap is null or cap between 1 and 50);

create table if not exists public.book_members (
  offering_id bigint not null references public.book_offerings(id) on delete cascade,
  group_id bigint not null references public.book_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (offering_id, user_id)
);
create index if not exists book_members_g on public.book_members (group_id);
create table if not exists public.book_notices (
  id bigint generated always as identity primary key,
  offering_id bigint references public.book_offerings(id) on delete cascade,
  group_id bigint references public.book_groups(id) on delete cascade,
  kind text not null check (kind in ('full', 'over')),
  user_id uuid,
  created_at timestamptz not null default now(),
  seen boolean not null default false
);
create index if not exists book_notices_seen on public.book_notices (seen, id desc);
alter table public.book_members enable row level security;
alter table public.book_notices enable row level security;
revoke all on public.book_members, public.book_notices from anon, authenticated;

-- ───────── الصفحة العامة القديمة: لا تعرض/تقبل المساقات المربوطة بشعبة ─────────
create or replace function public.book_pub_offerings() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'semester', semester, 'course', course, 'closed', closed) order by id desc), '[]'::jsonb)
  from book_offerings where not archived and cohort_id is null $$;

create or replace function public.book_pub_login(p_off bigint, p_group int, p_pw text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare g book_groups; a book_auth; o book_offerings;
begin
  select * into o from book_offerings where id = p_off and not archived and cohort_id is null;
  select * into g from book_groups where offering_id = p_off and group_no = p_group;
  if o.id is null or g.id is null then return jsonb_build_object('ok', false, 'err', 'bad'); end if;
  select * into a from book_auth where group_id = g.id for update;
  if a.locked_until is not null and a.locked_until > now() then
    return jsonb_build_object('ok', false, 'err', 'locked', 'wait', ceil(extract(epoch from a.locked_until - now()) / 60)::int);
  end if;
  if a.pw_hash = crypt(coalesce(p_pw, ''), a.pw_hash) then
    update book_auth set fails = 0, locked_until = null where group_id = g.id;
    return jsonb_build_object('ok', true, 'token', book_tok_make(g.id, a.pw_ver), 'must_change', a.must_change);
  end if;
  if a.fails + 1 >= 5 then
    update book_auth set fails = 0, locked_until = now() + interval '10 minutes' where group_id = g.id;
    return jsonb_build_object('ok', false, 'err', 'locked', 'wait', 10);
  end if;
  update book_auth set fails = fails + 1 where group_id = g.id;
  return jsonb_build_object('ok', false, 'err', 'bad', 'left', 5 - (a.fails + 1));
end $$;

-- تصفير الحجوزات يشمل انضمام الطلبة أيضاً
create or replace function public.book_reset(p_off bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('book') then raise exception 'admin only'; end if;
  update book_groups set topic_id = null, students = '[]'::jsonb, link = null, booked_at = null where offering_id = p_off;
  delete from book_members where offering_id = p_off;
end $$;

-- ───────── الطالب (من حسابه) ─────────
create or replace function public.bk_my_offerings()
returns table(id bigint, semester text, course text, closed boolean, cap integer, my_group integer)
language sql stable security definer set search_path = public as $$
  select o.id, o.semester, o.course, (o.closed or o.archived), o.group_cap,
    (select g.group_no from book_members m join book_groups g on g.id = m.group_id where m.offering_id = o.id and m.user_id = auth.uid())
  from book_offerings o
  where auth.uid() is not null and not o.archived and o.cohort_id is not null
    and o.cohort_id = (select m.cohort_id from comm_cohort_members m where m.user_id = auth.uid())
  order by o.id desc
$$;

create or replace function public.bk_state(p_off bigint) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o book_offerings; me uuid := auth.uid(); adm boolean := public.admin_can('book'); mycoh integer; mygrp bigint;
begin
  select * into o from book_offerings where id = p_off;
  select cohort_id into mycoh from comm_cohort_members where user_id = me;
  if o.id is null or (not adm and (o.archived or o.cohort_id is null or o.cohort_id is distinct from mycoh)) then
    return jsonb_build_object('ok', false, 'err', 'noaccess');
  end if;
  select group_id into mygrp from book_members where offering_id = p_off and user_id = me;
  return jsonb_build_object('ok', true, 'closed', (o.closed or o.archived), 'closed_msg', o.closed_msg, 'cap', o.group_cap, 'my_group', mygrp,
    'topics', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'no', t.no, 'title', t.title, 'descr', t.descr,
        'group_no', (select g.group_no from book_groups g where g.topic_id = t.id)) order by t.no) from book_topics t where t.offering_id = p_off), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'group_no', g.group_no, 'topic_id', g.topic_id,
        'topic_no', (select t.no from book_topics t where t.id = g.topic_id), 'topic_title', (select t.title from book_topics t where t.id = g.topic_id),
        'date', g.lecture_date, 'cap', coalesce(g.cap, o.group_cap),
        'count', (select count(*) from book_members m where m.group_id = g.id) + jsonb_array_length(g.students),
        'mine', (g.id = mygrp),
        'link', case when g.id = mygrp then g.link end,
        'members', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(p.full_name, '—'), 'me', m.user_id = me) order by m.joined_at)
                             from book_members m left join profiles p on p.id = m.user_id where m.group_id = g.id), '[]'::jsonb),
        'manual', g.students) order by g.group_no) from book_groups g where g.offering_id = p_off), '[]'::jsonb));
end $$;

create or replace function public.bk_join(p_group bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare g book_groups; o book_offerings; me uuid := auth.uid(); mycoh integer; cap integer; n integer;
begin
  if me is null then return jsonb_build_object('ok', false, 'err', 'auth'); end if;
  select * into g from book_groups where id = p_group for update;
  if not found then return jsonb_build_object('ok', false, 'err', 'nogroup'); end if;
  select * into o from book_offerings where id = g.offering_id;
  if o.archived or o.closed then return jsonb_build_object('ok', false, 'err', 'closed'); end if;
  select cohort_id into mycoh from comm_cohort_members where user_id = me;
  if o.cohort_id is null or o.cohort_id is distinct from mycoh then return jsonb_build_object('ok', false, 'err', 'cohort'); end if;
  if exists (select 1 from book_members where offering_id = o.id and user_id = me) then return jsonb_build_object('ok', false, 'err', 'already'); end if;
  cap := coalesce(g.cap, o.group_cap);
  n := (select count(*) from book_members where group_id = g.id) + jsonb_array_length(g.students);
  if cap is not null and n >= cap then
    if not exists (select 1 from book_notices where group_id = g.id and kind = 'over' and user_id = me and not seen) then
      insert into book_notices (offering_id, group_id, kind, user_id) values (o.id, g.id, 'over', me);
    end if;
    return jsonb_build_object('ok', false, 'err', 'full', 'cap', cap);
  end if;
  insert into book_members (offering_id, group_id, user_id) values (o.id, g.id, me);
  n := n + 1;
  if cap is not null and n >= cap then insert into book_notices (offering_id, group_id, kind, user_id) values (o.id, g.id, 'full', me); end if;
  return jsonb_build_object('ok', true, 'count', n, 'cap', cap, 'full', cap is not null and n >= cap);
end $$;

create or replace function public.bk_leave(p_off bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare o book_offerings;
begin
  select * into o from book_offerings where id = p_off;
  if o.id is null or o.archived or o.closed then return jsonb_build_object('ok', false, 'err', 'closed'); end if;
  delete from book_members where offering_id = p_off and user_id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

-- عضو المجموعة يحجز موضوعاً لمجموعته / يلغيه / يضع رابط المحاضرة
create or replace function public.bk_my_group(p_off bigint, out gid bigint, out err text) language plpgsql security definer set search_path = public as $$
declare o book_offerings;
begin
  select * into o from book_offerings where id = p_off;
  if o.id is null or o.archived or o.closed then err := 'closed'; return; end if;
  select group_id into gid from book_members where offering_id = p_off and user_id = auth.uid();
  if gid is null then err := 'nogroup'; end if;
end $$;

create or replace function public.bk_book_topic(p_off bigint, p_topic bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare w record; g book_groups;
begin
  select * into w from bk_my_group(p_off);
  if w.err is not null then return jsonb_build_object('ok', false, 'err', w.err); end if;
  select * into g from book_groups where id = w.gid for update;
  if g.topic_id is not null then return jsonb_build_object('ok', false, 'err', 'has'); end if;
  if not exists (select 1 from book_topics where id = p_topic and offering_id = p_off) then return jsonb_build_object('ok', false, 'err', 'notopic'); end if;
  begin
    update book_groups set topic_id = p_topic, booked_at = now() where id = g.id;
  exception when unique_violation then return jsonb_build_object('ok', false, 'err', 'taken');
  end;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bk_cancel_topic(p_off bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select * into w from bk_my_group(p_off);
  if w.err is not null then return jsonb_build_object('ok', false, 'err', w.err); end if;
  update book_groups set topic_id = null, booked_at = null, link = null where id = w.gid;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bk_set_link(p_off bigint, p_link text) returns jsonb language plpgsql security definer set search_path = public as $$
declare w record; g book_groups; lk text := nullif(trim(coalesce(p_link, '')), '');
begin
  select * into w from bk_my_group(p_off);
  if w.err is not null then return jsonb_build_object('ok', false, 'err', w.err); end if;
  select * into g from book_groups where id = w.gid;
  if lk is not null and (length(lk) > 500 or lk !~* '^https?://\S+$') then return jsonb_build_object('ok', false, 'err', 'link'); end if;
  if lk is not null and g.topic_id is null then return jsonb_build_object('ok', false, 'err', 'notopic'); end if;
  update book_groups set link = lk where id = g.id;
  return jsonb_build_object('ok', true);
end $$;

-- ───────── الإدارة (المحاضر) ─────────
create or replace function public.bk_admin_set_cohort(p_off bigint, p_cohort integer, p_cap integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('book') then raise exception 'admin only'; end if;
  if p_cap is not null and (p_cap < 1 or p_cap > 50) then raise exception 'سعة المجموعة من 1 إلى 50'; end if;
  update book_offerings set cohort_id = p_cohort, group_cap = p_cap where id = p_off;
end $$;

create or replace function public.bk_admin_set_group_cap(p_group bigint, p_cap integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('book') then raise exception 'admin only'; end if;
  if p_cap is not null and (p_cap < 1 or p_cap > 50) then raise exception 'سعة المجموعة من 1 إلى 50'; end if;
  update book_groups set cap = p_cap where id = p_group;
end $$;

create or replace function public.bk_admin_members(p_off bigint)
returns table(group_id bigint, group_no integer, user_id uuid, full_name text, university_id text, joined_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can('book') then raise exception 'admin only'; end if;
  return query select m.group_id, g.group_no, m.user_id, p.full_name, p.university_id, m.joined_at
    from book_members m join book_groups g on g.id = m.group_id left join profiles p on p.id = m.user_id
    where m.offering_id = p_off order by g.group_no, m.joined_at;
end $$;

create or replace function public.bk_admin_remove_member(p_off bigint, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('book') then raise exception 'admin only'; end if;
  delete from book_members where offering_id = p_off and user_id = p_user;
end $$;

create or replace function public.bk_admin_notices(p_limit integer default 60)
returns table(id bigint, kind text, created_at timestamptz, seen boolean, semester text, course text, group_no integer, user_name text, members bigint, cap integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can('book') then raise exception 'admin only'; end if;
  return query select n.id, n.kind, n.created_at, n.seen, o.semester, o.course, g.group_no, p.full_name,
      (select count(*) from book_members m where m.group_id = g.id) + jsonb_array_length(g.students), coalesce(g.cap, o.group_cap)
    from book_notices n join book_offerings o on o.id = n.offering_id join book_groups g on g.id = n.group_id left join profiles p on p.id = n.user_id
    order by n.id desc limit greatest(1, least(coalesce(p_limit, 60), 200));
end $$;

create or replace function public.bk_admin_notices_seen() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('book') then raise exception 'admin only'; end if;
  update book_notices set seen = true where not seen;
end $$;

create or replace function public.bk_admin_notice_count() returns integer
language sql stable security definer set search_path = public as $$
  select case when public.admin_can('book') then (select count(*)::int from book_notices where not seen) else 0 end
$$;

do $$
declare f text;
begin
  foreach f in array array['bk_my_offerings()', 'bk_state(bigint)', 'bk_join(bigint)', 'bk_leave(bigint)', 'bk_book_topic(bigint,bigint)', 'bk_cancel_topic(bigint)', 'bk_set_link(bigint,text)',
    'bk_admin_set_cohort(bigint,integer,integer)', 'bk_admin_set_group_cap(bigint,integer)', 'bk_admin_members(bigint)', 'bk_admin_remove_member(bigint,uuid)',
    'bk_admin_notices(integer)', 'bk_admin_notices_seen()', 'bk_admin_notice_count()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke execute on function public.bk_my_group(bigint) from public, anon, authenticated;
end $$;

select 'ready' as status;
