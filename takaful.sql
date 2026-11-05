-- التكافل: دورات مساهمة. المساهم يتعهّد بنفسه من زر «التكافل»، والمستفيد يؤكد الاستلام، والإدارة تتحكم بكل شيء.
-- يديره المدير الرئيسي، ومن منحه صلاحية «التكافل» من المساعدين. آمن لإعادة التشغيل.
create table if not exists public.tk_rounds (
  id          bigint generated always as identity primary key,
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null check (length(trim(title)) between 1 and 160),
  round_date  date not null default current_date,
  currency    text not null default 'ILS' check (currency in ('ILS','USD','JOD','EUR')),
  note        text check (note is null or length(note) <= 500),
  show_status boolean not null default false,   -- نشر التوزيع للمستفيدين (يرون نصيبهم والإجمالي ويؤكدون الاستلام)
  closed      boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.tk_rounds add column if not exists accepting boolean not null default false;   -- فتح باب التبرع للموظفين
create table if not exists public.tk_items (
  id         bigint generated always as identity primary key,
  round_id   bigint not null references public.tk_rounds(id) on delete cascade,
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('in','out')),          -- in: مساهم | out: مستفيد
  person     text not null check (length(trim(person)) between 1 and 120),
  emp        text,
  amount     numeric(14,2) not null default 0 check (amount >= 0),
  done       boolean not null default false,                      -- in: تم استلام المبلغ | out: تم صرفه
  done_at    date,
  note       text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now()
);
alter table public.tk_items add column if not exists uid uuid references auth.users(id) on delete set null;
alter table public.tk_items add column if not exists src text not null default 'admin' check (src in ('admin','self'));
alter table public.tk_items add column if not exists pledged_at timestamptz;
alter table public.tk_items add column if not exists recv_confirmed boolean not null default false;   -- أكّد المستفيد استلامه
alter table public.tk_items add column if not exists recv_at timestamptz;
alter table public.tk_items add column if not exists ext text check (ext is null or ext in ('donation','course'));   -- مساهمة خارجية: تبرع / رسوم دورة تدريبية
create index if not exists tk_items_round on public.tk_items (round_id, kind);
create index if not exists tk_items_uid on public.tk_items (uid);

create table if not exists public.tk_settings (
  id       integer primary key default 1 check (id = 1),
  pay_info text check (pay_info is null or length(pay_info) <= 600)   -- رقم جوال باي أو الآيبان وطريقة التحويل
);
insert into public.tk_settings (id) values (1) on conflict (id) do nothing;

alter table public.tk_rounds enable row level security;
alter table public.tk_items enable row level security;
alter table public.tk_settings enable row level security;
revoke all on public.tk_rounds, public.tk_items, public.tk_settings from anon;

drop policy if exists "tk rounds main" on public.tk_rounds;
drop policy if exists "tk items main" on public.tk_items;
drop policy if exists "tk rounds admin" on public.tk_rounds;
drop policy if exists "tk items admin" on public.tk_items;
drop policy if exists "tk settings admin" on public.tk_settings;
create policy "tk rounds admin" on public.tk_rounds for all to authenticated
  using (public.admin_can('tk')) with check (public.admin_can('tk'));
create policy "tk items admin" on public.tk_items for all to authenticated
  using (public.admin_can('tk')) with check (public.admin_can('tk'));
create policy "tk settings admin" on public.tk_settings for all to authenticated
  using (public.admin_can('tk')) with check (public.admin_can('tk'));
grant select, insert, update, delete on public.tk_rounds, public.tk_items, public.tk_settings to authenticated;

-- ───── جهة الموظف ─────
-- سطر المستخدم الحالي في دورة: بالمعرّف أو بالرقم الوظيفي
create or replace function public.tk_my_emp() returns text
language sql stable security definer set search_path = public set row_security = off as $$
  select nullif(trim(p.employee_number), '') from profiles p where p.id = auth.uid()
$$;

drop function if exists public.tk_my_status();
drop function if exists public.tk_my_rounds();
create or replace function public.tk_my_rounds()
returns table(round_id bigint, title text, round_date date, currency text, accepting boolean, published boolean,
              total_pledged numeric, total_received numeric, my_pledge numeric, my_pledge_done boolean, pay_info text,
              out_amount numeric, out_done boolean, out_confirmed boolean)
language plpgsql stable security definer set search_path = public set row_security = off as $$
declare me text := public.tk_my_emp();
begin
  if auth.uid() is null or public.current_user_role() not in ('admin','professor','staff') then raise exception 'not allowed'; end if;
  return query
    select r.id, r.title, r.round_date, r.currency, r.accepting, r.show_status,
      (select coalesce(sum(i.amount), 0) from tk_items i where i.round_id = r.id and i.kind = 'in'),
      (select coalesce(sum(i.amount), 0) from tk_items i where i.round_id = r.id and i.kind = 'in' and i.done),
      (select i.amount from tk_items i where i.round_id = r.id and i.kind = 'in' and (i.uid = auth.uid() or (me is not null and trim(i.emp) = me)) order by i.id limit 1),
      (select i.done from tk_items i where i.round_id = r.id and i.kind = 'in' and (i.uid = auth.uid() or (me is not null and trim(i.emp) = me)) order by i.id limit 1),
      case when r.accepting then (select s.pay_info from tk_settings s where s.id = 1) else null end,
      (select i.amount from tk_items i where r.show_status and i.round_id = r.id and i.kind = 'out' and (i.uid = auth.uid() or (me is not null and trim(i.emp) = me)) order by i.id limit 1),
      (select i.done from tk_items i where r.show_status and i.round_id = r.id and i.kind = 'out' and (i.uid = auth.uid() or (me is not null and trim(i.emp) = me)) order by i.id limit 1),
      (select i.recv_confirmed from tk_items i where r.show_status and i.round_id = r.id and i.kind = 'out' and (i.uid = auth.uid() or (me is not null and trim(i.emp) = me)) order by i.id limit 1)
    from tk_rounds r
    where not r.closed and (r.accepting or r.show_status)
    order by r.round_date desc, r.id desc limit 20;
end $$;

-- التعهّد بالتبرع (مرة واحدة لكل دورة، ويمكن تعديل المبلغ قبل أن تستلمه الإدارة)
create or replace function public.tk_pledge(p_round bigint, p_amount numeric) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare r tk_rounds; me text := public.tk_my_emp(); nm text; ex tk_items;
begin
  if auth.uid() is null or public.current_user_role() not in ('admin','professor','staff') then raise exception 'not allowed'; end if;
  select * into r from tk_rounds where id = p_round;
  if not found or r.closed or not r.accepting then raise exception 'باب التبرع مغلق لهذه الدورة'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then raise exception 'أدخل مبلغاً صحيحاً'; end if;
  select * into ex from tk_items i where i.round_id = p_round and i.kind = 'in' and (i.uid = auth.uid() or (me is not null and trim(i.emp) = me)) order by i.id limit 1;
  if found then
    if ex.done then raise exception 'استلمت الإدارة مساهمتك، ولا يمكن تعديلها'; end if;
    update tk_items set amount = round(p_amount, 2), uid = coalesce(uid, auth.uid()), pledged_at = now() where id = ex.id;
  else
    select coalesce(nullif(trim(full_name), ''), '—') into nm from profiles where id = auth.uid();
    insert into tk_items (round_id, owner, kind, person, emp, amount, uid, src, pledged_at)
    values (p_round, r.owner, 'in', nm, me, round(p_amount, 2), auth.uid(), 'self', now());
  end if;
end $$;

-- تأكيد المستفيد لاستلام المبلغ
create or replace function public.tk_confirm_receipt(p_round bigint) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare me text := public.tk_my_emp(); n integer;
begin
  if auth.uid() is null or public.current_user_role() not in ('admin','professor','staff') then raise exception 'not allowed'; end if;
  if not exists (select 1 from tk_rounds r where r.id = p_round and r.show_status and not r.closed) then raise exception 'غير متاح'; end if;
  update tk_items set recv_confirmed = true, recv_at = now(), uid = coalesce(uid, auth.uid())
   where round_id = p_round and kind = 'out' and amount > 0 and (uid = auth.uid() or (me is not null and trim(emp) = me));
  get diagnostics n = row_count;
  if n = 0 then raise exception 'لا نصيب مخصّص لك في هذه الدورة'; end if;
end $$;

revoke execute on function public.tk_my_emp(), public.tk_my_rounds(), public.tk_pledge(bigint, numeric), public.tk_confirm_receipt(bigint) from public, anon;
grant execute on function public.tk_my_rounds(), public.tk_pledge(bigint, numeric), public.tk_confirm_receipt(bigint) to authenticated;
select 'ready' as status;
