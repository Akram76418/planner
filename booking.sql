-- حجز المحاضرات (للإدارة): فصول/مساقات، مواضيع، مجموعات (عدد المجموعات = عدد المواضيع)، أسماء الطلبة، رابط وتاريخ المحاضرة.
-- شغّله بعد subadmin.sql. الوصول: المسؤول الرئيسي، أو مسؤول فرعي منحته صلاحية «حجز المحاضرات».
create table if not exists public.book_offerings (
  id bigint generated always as identity primary key,
  semester text not null check (length(trim(semester)) between 1 and 80),
  course   text not null check (length(trim(course)) between 1 and 80),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (semester, course)
);
create table if not exists public.book_topics (
  id bigint generated always as identity primary key,
  offering_id bigint not null references public.book_offerings(id) on delete cascade,
  no int not null,
  title text not null check (length(trim(title)) between 1 and 200),
  descr text check (descr is null or length(descr) <= 1500),
  unique (offering_id, no) deferrable initially deferred
);
create table if not exists public.book_groups (
  id bigint generated always as identity primary key,
  offering_id bigint not null references public.book_offerings(id) on delete cascade,
  group_no int not null,
  topic_id bigint references public.book_topics(id) on delete set null,
  students jsonb not null default '[]'::jsonb check (jsonb_typeof(students) = 'array'),
  link text check (link is null or (length(link) <= 500 and link ~* '^https?://\S+$')),
  lecture_date date,
  booked_at timestamptz,
  unique (offering_id, group_no)
);
create unique index if not exists book_groups_topic_uq on public.book_groups (topic_id) where topic_id is not null;
create index if not exists book_topics_off on public.book_topics (offering_id, no);

alter table public.book_offerings enable row level security;
alter table public.book_topics enable row level security;
alter table public.book_groups enable row level security;
revoke all on public.book_offerings, public.book_topics, public.book_groups from anon;
drop policy if exists "book off all" on public.book_offerings;
drop policy if exists "book top all" on public.book_topics;
drop policy if exists "book grp all" on public.book_groups;
create policy "book off all" on public.book_offerings for all to authenticated using (public.admin_can('book')) with check (public.admin_can('book'));
create policy "book top all" on public.book_topics for all to authenticated using (public.admin_can('book')) with check (public.admin_can('book'));
create policy "book grp all" on public.book_groups for all to authenticated using (public.admin_can('book')) with check (public.admin_can('book'));
grant select, insert, update, delete on public.book_offerings, public.book_topics, public.book_groups to authenticated;

-- مساق جديد (مع نسخ مواضيع مساق آخر اختيارياً، بلا حجوزات) وإنشاء المجموعات بعدد المواضيع
create or replace function public.book_add_offering(p_semester text, p_course text, p_copy bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare oid bigint; n int;
begin
  if not public.admin_can('book') then raise exception 'admin only'; end if;
  insert into book_offerings (semester, course) values (trim(p_semester), trim(p_course)) returning id into oid;
  if p_copy is not null then
    insert into book_topics (offering_id, no, title, descr)
      select oid, row_number() over (order by no), title, descr from book_topics where offering_id = p_copy;
  end if;
  select count(*) into n from book_topics where offering_id = oid;
  insert into book_groups (offering_id, group_no) select oid, g from generate_series(1, n) g;
  return oid;
end $$;

create or replace function public.book_add_topic(p_off bigint, p_title text, p_desc text default null) returns int
language plpgsql security definer set search_path = public as $$
declare nx int;
begin
  if not public.admin_can('book') then raise exception 'admin only'; end if;
  select coalesce(max(no), 0) + 1 into nx from book_topics where offering_id = p_off;
  insert into book_topics (offering_id, no, title, descr) values (p_off, nx, trim(p_title), nullif(trim(coalesce(p_desc, '')), ''));
  insert into book_groups (offering_id, group_no) values (p_off, nx) on conflict do nothing;
  return nx;
end $$;

-- حذف موضوع: يُلغى حجزه، تُعاد ترقيم المواضيع 1..n، وتُحذف آخر مجموعة (عدد المجموعات = عدد المواضيع)
create or replace function public.book_delete_topic(p_topic bigint) returns void
language plpgsql security definer set search_path = public as $$
declare off bigint; tno int; nold int;
begin
  if not public.admin_can('book') then raise exception 'admin only'; end if;
  select offering_id, no into off, tno from book_topics where id = p_topic;
  if off is null then raise exception 'not found'; end if;
  select count(*) into nold from book_topics where offering_id = off;
  update book_groups set topic_id = null, link = null, booked_at = null where topic_id = p_topic;
  delete from book_topics where id = p_topic;
  update book_topics set no = no - 1 where offering_id = off and no > tno;
  delete from book_groups where offering_id = off and group_no = nold;
end $$;

-- مسح كل الحجوزات والأسماء والروابط لمساق (التواريخ تبقى)
create or replace function public.book_reset(p_off bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('book') then raise exception 'admin only'; end if;
  update book_groups set topic_id = null, students = '[]'::jsonb, link = null, booked_at = null where offering_id = p_off;
end $$;
revoke execute on function public.book_add_offering(text, text, bigint), public.book_add_topic(bigint, text, text), public.book_delete_topic(bigint), public.book_reset(bigint) from public, anon;
grant execute on function public.book_add_offering(text, text, bigint), public.book_add_topic(bigint, text, text), public.book_delete_topic(bigint), public.book_reset(bigint) to authenticated;
