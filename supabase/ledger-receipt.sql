-- وصل الاستلام في دفتر الدفعات: وصف ثابت لكل حساب + بيانات المستلم (الاسم/الهوية/التوقيع) خاصة بالمسؤول الرئيسي. شغّله بعد subadmin.sql و ledger.sql.
alter table public.ledger_accounts add column if not exists receipt_desc text check (receipt_desc is null or length(receipt_desc) <= 1500);

create table if not exists public.ledger_profile (
  owner     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  full_name text check (full_name is null or length(full_name) <= 120),
  id_no     text check (id_no is null or length(id_no) <= 30),
  sig       text check (sig is null or length(sig) <= 400000),
  updated_at timestamptz not null default now()
);
alter table public.ledger_profile enable row level security;
revoke all on public.ledger_profile from anon;
drop policy if exists "ledger profile all" on public.ledger_profile;
create policy "ledger profile all" on public.ledger_profile for all to authenticated
  using (owner = auth.uid() and public.admin_can('main'))
  with check (owner = auth.uid() and public.admin_can('main'));
grant select, insert, update, delete on public.ledger_profile to authenticated;
