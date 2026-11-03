-- حجز المحاضرات: بوابة الطلبة + كلمات مرور المجموعات + إيقاف الحجز وإغلاق التعديل
-- شغّله بعد booking.sql (ملف واحد في SQL Editor). آمن لإعادة التشغيل.
create extension if not exists pgcrypto with schema extensions;

alter table public.book_offerings add column if not exists closed boolean not null default false;
alter table public.book_offerings add column if not exists closed_msg text check (closed_msg is null or length(closed_msg) <= 300);

-- كلمات المرور (مُشفّرة bcrypt) — لا وصول مباشر لأي مستخدم؛ كل شيء عبر الدوال فقط
create table if not exists public.book_auth (
  group_id bigint primary key references public.book_groups(id) on delete cascade,
  pw_hash text not null,
  temp_pw text,
  must_change boolean not null default true,
  fails int not null default 0,
  locked_until timestamptz,
  pw_ver int not null default 1
);
alter table public.book_auth enable row level security;
revoke all on public.book_auth from anon, authenticated;
create table if not exists public.book_secret (k text primary key, v text not null);
alter table public.book_secret enable row level security;
revoke all on public.book_secret from anon, authenticated;

create or replace function public.book_newtemp() returns text language sql volatile set search_path = public, extensions as $$
  select lpad((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0') $$;

create or replace function public.book_grp_auth() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare t text := book_newtemp();
begin
  insert into book_auth (group_id, pw_hash, temp_pw) values (new.id, crypt(t, gen_salt('bf')), t) on conflict do nothing;
  return new;
end $$;
drop trigger if exists book_grp_auth_t on public.book_groups;
create trigger book_grp_auth_t after insert on public.book_groups for each row execute function public.book_grp_auth();

-- مجموعات موجودة مسبقاً
do $$ declare r record; t text;
begin
  for r in select id from book_groups g where not exists (select 1 from book_auth a where a.group_id = g.id) loop
    t := public.book_newtemp();
    insert into book_auth (group_id, pw_hash, temp_pw) values (r.id, extensions.crypt(t, extensions.gen_salt('bf')), t);
  end loop;
end $$;

create or replace function public.book_secret_get() returns text language plpgsql security definer set search_path = public, extensions as $$
declare s text;
begin
  select v into s from book_secret where k = 'tok';
  if s is null then
    s := encode(gen_random_bytes(32), 'hex');
    insert into book_secret (k, v) values ('tok', s) on conflict do nothing;
    select v into s from book_secret where k = 'tok';
  end if;
  return s;
end $$;

create or replace function public.book_tok_make(p_group bigint, p_ver int) returns text language plpgsql security definer set search_path = public, extensions as $$
declare pl text := p_group || ':' || p_ver || ':' || (extract(epoch from now())::bigint + 7*86400);
begin
  return pl || '.' || encode(hmac(pl, book_secret_get(), 'sha256'), 'hex');
end $$;

-- يعيد رقم المجموعة أو null
create or replace function public.book_tok_check(p_tok text) returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare pl text; sg text; parts text[]; gid bigint; a book_auth;
begin
  if p_tok is null or length(p_tok) > 200 or position('.' in p_tok) = 0 then return null; end if;
  pl := split_part(p_tok, '.', 1); sg := split_part(p_tok, '.', 2);
  if encode(hmac(pl, book_secret_get(), 'sha256'), 'hex') <> sg then return null; end if;
  parts := string_to_array(pl, ':');
  if array_length(parts, 1) <> 3 or parts[3]::bigint < extract(epoch from now())::bigint then return null; end if;
  gid := parts[1]::bigint;
  select * into a from book_auth where group_id = gid;
  if not found or a.pw_ver <> parts[2]::int then return null; end if;
  return gid;
exception when others then return null;
end $$;

-- ===== الواجهة العامة للطلبة =====
create or replace function public.book_pub_offerings() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'semester', semester, 'course', course, 'closed', closed) order by id desc), '[]'::jsonb)
  from book_offerings where not archived $$;

create or replace function public.book_pub_state(p_off bigint) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o book_offerings;
begin
  select * into o from book_offerings where id = p_off and not archived;
  if not found then return jsonb_build_object('ok', false, 'err', 'nooff'); end if;
  return jsonb_build_object('ok', true, 'closed', o.closed, 'closed_msg', o.closed_msg,
    'topics', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'no', t.no, 'title', t.title, 'descr', t.descr,
        'group_no', (select g.group_no from book_groups g where g.topic_id = t.id)) order by t.no) from book_topics t where t.offering_id = p_off), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('group_no', g.group_no, 'topic_no', (select t.no from book_topics t where t.id = g.topic_id), 'date', g.lecture_date) order by g.group_no) from book_groups g where g.offering_id = p_off), '[]'::jsonb));
end $$;

create or replace function public.book_pub_login(p_off bigint, p_group int, p_pw text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare g book_groups; a book_auth; o book_offerings;
begin
  select * into o from book_offerings where id = p_off and not archived;
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

create or replace function public.book_pub_me(p_tok text) returns jsonb language plpgsql security definer set search_path = public as $$
declare gid bigint := book_tok_check(p_tok); g book_groups; o book_offerings; a book_auth; t book_topics;
begin
  if gid is null then return jsonb_build_object('ok', false, 'err', 'auth'); end if;
  select * into g from book_groups where id = gid;
  select * into o from book_offerings where id = g.offering_id;
  select * into a from book_auth where group_id = gid;
  select * into t from book_topics where id = g.topic_id;
  return jsonb_build_object('ok', true, 'group_no', g.group_no, 'must_change', a.must_change, 'closed', (o.closed or o.archived), 'closed_msg', o.closed_msg,
    'topic_id', g.topic_id, 'topic_no', t.no, 'topic_title', t.title, 'students', g.students, 'link', g.link, 'date', g.lecture_date);
end $$;

create or replace function public.book_pub_change_pw(p_tok text, p_new text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare gid bigint := book_tok_check(p_tok); a book_auth;
begin
  if gid is null then return jsonb_build_object('ok', false, 'err', 'auth'); end if;
  if p_new is null or length(p_new) < 6 or length(p_new) > 64 or p_new = '0123456' then return jsonb_build_object('ok', false, 'err', 'weak'); end if;
  select * into a from book_auth where group_id = gid for update;
  if a.pw_hash = crypt(p_new, a.pw_hash) then return jsonb_build_object('ok', false, 'err', 'same'); end if;
  update book_auth set pw_hash = crypt(p_new, gen_salt('bf')), temp_pw = null, must_change = false, pw_ver = pw_ver + 1 where group_id = gid returning * into a;
  return jsonb_build_object('ok', true, 'token', book_tok_make(gid, a.pw_ver));
end $$;

-- فحص مشترك: المجموعة غير مُجبرة على تغيير كلمة المرور والمساق مفتوح
create or replace function public.book_write_gate(p_tok text, out gid bigint, out err text) language plpgsql security definer set search_path = public as $$
declare a book_auth; o book_offerings;
begin
  gid := book_tok_check(p_tok);
  if gid is null then err := 'auth'; return; end if;
  select * into a from book_auth where group_id = gid;
  if a.must_change then err := 'mustchange'; return; end if;
  select o2.* into o from book_offerings o2 join book_groups g on g.offering_id = o2.id where g.id = gid;
  if o.closed or o.archived then err := 'closed'; return; end if;
end $$;

create or replace function public.book_pub_book(p_tok text, p_topic bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare w record; g book_groups;
begin
  select * into w from book_write_gate(p_tok);
  if w.err is not null then return jsonb_build_object('ok', false, 'err', w.err); end if;
  select * into g from book_groups where id = w.gid for update;
  if g.topic_id is not null then return jsonb_build_object('ok', false, 'err', 'has'); end if;
  if not exists (select 1 from book_topics where id = p_topic and offering_id = g.offering_id) then return jsonb_build_object('ok', false, 'err', 'notopic'); end if;
  begin
    update book_groups set topic_id = p_topic, booked_at = now() where id = g.id;
  exception when unique_violation then return jsonb_build_object('ok', false, 'err', 'taken');
  end;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.book_pub_cancel(p_tok text) returns jsonb language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select * into w from book_write_gate(p_tok);
  if w.err is not null then return jsonb_build_object('ok', false, 'err', w.err); end if;
  update book_groups set topic_id = null, booked_at = null, link = null where id = w.gid;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.book_pub_save(p_tok text, p_names jsonb, p_link text) returns jsonb language plpgsql security definer set search_path = public as $$
declare w record; g book_groups; nm text; clean jsonb := '[]'::jsonb; lk text := nullif(trim(coalesce(p_link, '')), '');
begin
  select * into w from book_write_gate(p_tok);
  if w.err is not null then return jsonb_build_object('ok', false, 'err', w.err); end if;
  if p_names is null or jsonb_typeof(p_names) <> 'array' or jsonb_array_length(p_names) > 15 then return jsonb_build_object('ok', false, 'err', 'names'); end if;
  select * into g from book_groups where id = w.gid;
  for nm in select jsonb_array_elements_text(p_names) loop
    nm := left(trim(regexp_replace(nm, '\s+', ' ', 'g')), 80);
    if nm <> '' and not clean ? nm then clean := clean || to_jsonb(nm); end if;
  end loop;
  select e into nm from book_groups g2, jsonb_array_elements_text(g2.students) e
    where g2.offering_id = g.offering_id and g2.id <> g.id and exists (select 1 from jsonb_array_elements_text(clean) c where lower(c) = lower(e)) limit 1;
  if nm is not null then return jsonb_build_object('ok', false, 'err', 'dup', 'name', nm); end if;
  if lk is not null and (length(lk) > 500 or lk !~* '^https?://\S+$') then return jsonb_build_object('ok', false, 'err', 'link'); end if;
  if lk is not null and g.topic_id is null then return jsonb_build_object('ok', false, 'err', 'notopic'); end if;
  update book_groups set students = clean, link = lk where id = g.id;
  return jsonb_build_object('ok', true, 'students', clean);
end $$;

-- ===== للإدارة =====
create or replace function public.book_admin_set_closed(p_off bigint, p_closed boolean, p_msg text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('book') then raise exception 'admin only'; end if;
  update book_offerings set closed = p_closed, closed_msg = case when p_closed then nullif(left(trim(coalesce(p_msg, '')), 300), '') else closed_msg end where id = p_off;
end $$;

create or replace function public.book_admin_passwords(p_off bigint) returns table (group_id bigint, group_no int, temp_pw text, must_change boolean, locked boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('book') then raise exception 'admin only'; end if;
  return query select g.id, g.group_no, a.temp_pw, a.must_change, coalesce(a.locked_until > now(), false)
    from book_groups g join book_auth a on a.group_id = g.id where g.offering_id = p_off order by g.group_no;
end $$;

create or replace function public.book_admin_reset_pw(p_group bigint default null, p_off bigint default null) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare r record; t text; n int := 0;
begin
  if not public.admin_can('book') then raise exception 'admin only'; end if;
  for r in select id from book_groups where (p_group is not null and id = p_group) or (p_group is null and p_off is not null and offering_id = p_off) loop
    t := book_newtemp();
    update book_auth set pw_hash = crypt(t, gen_salt('bf')), temp_pw = t, must_change = true, fails = 0, locked_until = null, pw_ver = pw_ver + 1 where group_id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- الصلاحيات: الدوال الداخلية مغلقة، العامة للطلبة (anon) مفتوحة، الإدارية للمسجّلين
revoke execute on function public.book_newtemp(), public.book_grp_auth(), public.book_secret_get(), public.book_tok_make(bigint, int), public.book_tok_check(text), public.book_write_gate(text) from public, anon, authenticated;
revoke execute on function public.book_pub_offerings(), public.book_pub_state(bigint), public.book_pub_login(bigint, int, text), public.book_pub_me(text), public.book_pub_change_pw(text, text),
  public.book_pub_book(text, bigint), public.book_pub_cancel(text), public.book_pub_save(text, jsonb, text) from public;
grant execute on function public.book_pub_offerings(), public.book_pub_state(bigint), public.book_pub_login(bigint, int, text), public.book_pub_me(text), public.book_pub_change_pw(text, text),
  public.book_pub_book(text, bigint), public.book_pub_cancel(text), public.book_pub_save(text, jsonb, text) to anon, authenticated;
revoke execute on function public.book_admin_set_closed(bigint, boolean, text), public.book_admin_passwords(bigint), public.book_admin_reset_pw(bigint, bigint) from public, anon;
grant execute on function public.book_admin_set_closed(bigint, boolean, text), public.book_admin_passwords(bigint), public.book_admin_reset_pw(bigint, bigint) to authenticated;

select public.book_secret_get() is not null as ready;
