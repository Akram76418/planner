-- دفتر الدفعات: حسابات أشخاص (أستلم منهم / أدفع لهم) ودفعات تُخصم من الإجمالي. خاص بالمدير وحده (كل مستخدم يرى بياناته فقط).
create table if not exists public.ledger_accounts (
  id         bigint generated always as identity primary key,
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  person     text not null check (length(trim(person)) between 1 and 120),
  direction  text not null check (direction in ('in','out')),      -- in: أستلم منه | out: أدفع له
  total      numeric(14,2) not null check (total >= 0),
  currency   text not null default 'ILS' check (currency in ('ILS','USD','JOD','EUR')),
  note       text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now()
);
create table if not exists public.ledger_payments (
  id         bigint generated always as identity primary key,
  account_id bigint not null references public.ledger_accounts(id) on delete cascade,
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  amount     numeric(14,2) not null check (amount > 0),
  paid_at    date not null default current_date,
  note       text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists ledger_accounts_owner on public.ledger_accounts (owner, created_at desc);
create index if not exists ledger_payments_acc on public.ledger_payments (account_id, paid_at desc);
alter table public.ledger_accounts enable row level security;
alter table public.ledger_payments enable row level security;
revoke all on public.ledger_accounts, public.ledger_payments from anon;

drop policy if exists "ledger acc all" on public.ledger_accounts;
drop policy if exists "ledger pay all" on public.ledger_payments;
create policy "ledger acc all" on public.ledger_accounts for all to authenticated
  using (owner = auth.uid() and public.admin_can('main'))
  with check (owner = auth.uid() and public.admin_can('main'));
create policy "ledger pay all" on public.ledger_payments for all to authenticated
  using (owner = auth.uid() and public.admin_can('main'))
  with check (owner = auth.uid() and public.admin_can('main')
              and exists (select 1 from public.ledger_accounts a where a.id = account_id and a.owner = auth.uid()));
grant select, insert, update, delete on public.ledger_accounts, public.ledger_payments to authenticated;
