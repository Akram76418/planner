-- بيانات القطعة في وصل الاستلام. شغّله بعد ledger-receipt.sql.
alter table public.ledger_accounts add column if not exists plot_no text check (plot_no is null or length(plot_no) <= 60);
alter table public.ledger_accounts add column if not exists parcel_no text check (parcel_no is null or length(parcel_no) <= 60);
alter table public.ledger_accounts add column if not exists area text check (area is null or length(area) <= 60);
alter table public.ledger_accounts add column if not exists location text check (location is null or length(location) <= 200);
alter table public.ledger_accounts add column if not exists contract_date date;
