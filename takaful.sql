-- التكافل: تدوين داخلي لدورات مساهمة موظفي المشاريع وتوزيعها على الزملاء بلا مشروع.
-- خاص بالمدير الرئيسي وحده. ولا يرى المعنيّ شيئاً إلا إذا فعّل المدير زر «إظهار الحالة» لتلك الدورة.
create table if not exists public.tk_rounds (
  id          bigint generated always as identity primary key,
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null check (length(trim(title)) between 1 and 160),
  round_date  date not null default current_date,
  currency    text not null default 'ILS' check (currency in ('ILS','USD','JOD','EUR')),
  note        text check (note is null or length(note) <= 500),
  show_status boolean not null default false,
  closed      boolean not null default false,
  created_at  timestamptz not null default now()
);
create table if not exists public.tk_items (
  id         bigint generated always as identity primary key,
  round_id   bigint not null references public.tk_rounds(id) on delete cascade,
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('in','out')),          -- in: مساهم | out: مستفيد
  person     text not null check (length(trim(person)) between 1 and 120),
  emp        text,                                                -- الرقم الوظيفي (للربط الداخلي فقط ولا يُعرض)
  amount     numeric(14,2) not null default 0 check (amount >= 0),
  done       boolean not null default false,                      -- in: تم استلامه | out: تم صرفه
  done_at    date,
  note       text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists tk_items_round on public.tk_items (round_id, kind);
alter table public.tk_rounds enable row level security;
alter table public.tk_items enable row level security;
revoke all on public.tk_rounds, public.tk_items from anon;

drop policy if exists "tk rounds main" on public.tk_rounds;
drop policy if exists "tk items main" on public.tk_items;
create policy "tk rounds main" on public.tk_rounds for all to authenticated
  using (owner = auth.uid() and public.admin_can('main'))
  with check (owner = auth.uid() and public.admin_can('main'));
create policy "tk items main" on public.tk_items for all to authenticated
  using (owner = auth.uid() and public.admin_can('main'))
  with check (owner = auth.uid() and public.admin_can('main')
              and exists (select 1 from public.tk_rounds r where r.id = round_id and r.owner = auth.uid()));
grant select, insert, update, delete on public.tk_rounds, public.tk_items to authenticated;

-- حالتي: ما يخص المستخدم نفسه فقط، وللدورات التي فعّل المدير إظهار حالتها (بلا أي بيانات للآخرين)
create or replace function public.tk_my_status()
returns table(round_id bigint, title text, round_date date, currency text, kind text, amount numeric, done boolean, done_at date)
language sql stable security definer set search_path = public set row_security = off as $$
  select r.id, r.title, r.round_date, r.currency, i.kind, i.amount, i.done, i.done_at
  from tk_items i join tk_rounds r on r.id = i.round_id
  where r.show_status
    and nullif(trim(i.emp), '') is not null
    and trim(i.emp) = (select nullif(trim(p.employee_number), '') from profiles p where p.id = auth.uid())
  order by r.round_date desc, r.id desc
$$;
revoke execute on function public.tk_my_status() from public, anon;
grant execute on function public.tk_my_status() to authenticated;
select 'ready' as status;
