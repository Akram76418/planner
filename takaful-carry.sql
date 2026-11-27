-- takaful-carry.sql: ترحيل الرصيد من دورة سابقة إلى دورة لاحقة
alter table public.tk_rounds add column if not exists carry numeric(14,2) not null default 0;
alter table public.tk_rounds add column if not exists carry_from bigint references public.tk_rounds(id) on delete set null;
select 'ready' as status;
