-- طلبات تسجيل الطلبة (يوافق عليها المدير). شغّله مرة واحدة بعد accounts.sql.
-- لا تُخزَّن كلمات مرور: عند الموافقة يُنشأ الحساب بكلمة المرور الافتراضية ويُلزَم الطالب بتغييرها.
create table if not exists public.comm_signup_requests (
  id         bigint generated always as identity primary key,
  number     text not null,
  full_name  text not null,
  major      text,
  phone      text,
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists comm_signup_requests_idx on public.comm_signup_requests (status, created_at);
alter table public.comm_signup_requests enable row level security;
revoke all on public.comm_signup_requests from anon, authenticated;

-- يستدعيها الطالب من شاشة الدخول (قبل أن يملك حساباً). ترجع: ok | exists | pending | invalid | full
create or replace function public.comm_request_signup(p_number text, p_name text, p_major text default null, p_phone text default null)
returns text language plpgsql security definer set search_path = public as $$
declare n text := trim(coalesce(p_number, '')); nm text := trim(coalesce(p_name, ''));
begin
  if n !~ '^[A-Za-z0-9]{3,20}$' or length(nm) < 3 or length(nm) > 100 then return 'invalid'; end if;
  if exists (select 1 from profiles where university_id = n) then return 'exists'; end if;
  if exists (select 1 from comm_signup_requests where number = n and status = 'pending') then return 'pending'; end if;
  if (select count(*) from comm_signup_requests where status = 'pending') >= 1000 then return 'full'; end if;
  insert into comm_signup_requests (number, full_name, major, phone)
  values (n, nm, left(nullif(trim(p_major), ''), 120), left(nullif(trim(p_phone), ''), 30));
  return 'ok';
end $$;
revoke execute on function public.comm_request_signup(text, text, text, text) from public;
grant execute on function public.comm_request_signup(text, text, text, text) to anon, authenticated;

create or replace function public.comm_list_requests() returns table(id bigint, number text, full_name text, major text, phone text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  return query select r.id, r.number, r.full_name, r.major, r.phone, r.created_at
               from comm_signup_requests r where r.status = 'pending' order by r.created_at limit 500;
end $$;

create or replace function public.comm_decide_request(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  if p_status not in ('approved','rejected') then raise exception 'bad status'; end if;
  update comm_signup_requests set status = p_status, decided_at = now() where id = p_id;
end $$;

revoke execute on function public.comm_list_requests(), public.comm_decide_request(bigint, text) from public, anon;
grant execute on function public.comm_list_requests(), public.comm_decide_request(bigint, text) to authenticated;
