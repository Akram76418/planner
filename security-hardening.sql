-- تشديد أمني: حدّ للمحاولات على الدوال المفتوحة قبل تسجيل الدخول (تخمين الأرقام الجامعية + طلبات التسجيل الوهمية).
-- يعمل بعد staff-accounts.sql. آمن لإعادة التشغيل. لا يغيّر أي بيانات موجودة.
create table if not exists public.comm_rl (
  id      bigint generated always as identity primary key,
  kind    text not null,
  ip_hash text not null,
  ts      timestamptz not null default now()
);
create index if not exists comm_rl_idx on public.comm_rl (kind, ip_hash, ts);
alter table public.comm_rl enable row level security;
revoke all on public.comm_rl from anon, authenticated;

-- عنوان الزائر كما تمرّره Supabase (يُفضَّل ترويسة Cloudflare لأن الزائر لا يستطيع انتحالها)
create or replace function public.comm_client_ip() returns text
language plpgsql stable security definer set search_path = public as $$
declare hdr jsonb; xs text[];
begin
  begin hdr := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb; exception when others then hdr := '{}'::jsonb; end;
  if nullif(hdr->>'cf-connecting-ip', '') is not null then return trim(hdr->>'cf-connecting-ip'); end if;
  if nullif(hdr->>'x-real-ip', '') is not null then return trim(hdr->>'x-real-ip'); end if;
  xs := string_to_array(coalesce(hdr->>'x-forwarded-for', ''), ',');
  if array_length(xs, 1) is null then return 'unknown'; end if;
  return trim(xs[array_length(xs, 1)]);                      -- آخر عنوان أضافته البوابة (لا الأول الذي قد ينتحله الزائر)
end $$;
revoke execute on function public.comm_client_ip() from public, anon, authenticated;

-- true = مسموح (ويُسجَّل الطلب)، false = تجاوز الحدّ
create or replace function public.comm_rl_hit(p_kind text, p_limit integer, p_secs integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare ih text := md5(public.comm_client_ip() || ':rl');
begin
  if (select count(*) from comm_rl where kind = p_kind and ip_hash = ih and ts > now() - make_interval(secs => p_secs)) >= p_limit then return false; end if;
  insert into comm_rl (kind, ip_hash) values (p_kind, ih);
  if random() < 0.02 then delete from comm_rl where ts < now() - interval '1 day'; end if;
  return true;
end $$;
revoke execute on function public.comm_rl_hit(text, integer, integer) from public, anon, authenticated;

-- تحويل الرقم الجامعي إلى بريد الدخول: حدّ 200 محاولة كل 10 دقائق لكل عنوان (يتسع لشبكة الجامعة، ويمنع الجمع الآلي للبريد)
create or replace function public.comm_resolve_login(p_id text) returns text
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.comm_rl_hit('resolve', 200, 600) then return null; end if;
  return (select u.email::text from public.profiles p join auth.users u on u.id = p.id
          where p.university_id = trim(p_id) and p.role::text <> 'admin' limit 1);
end $$;
revoke execute on function public.comm_resolve_login(text) from public;
grant execute on function public.comm_resolve_login(text) to anon, authenticated;

-- طلبات التسجيل: حدّ 20 طلباً في الساعة لكل عنوان (يمنع ملء قائمة الانتظار بطلبات وهمية)
create or replace function public.comm_request_signup(p_number text, p_name text, p_major text default null, p_phone text default null, p_kind text default 'student')
returns text language plpgsql security definer set search_path = public as $$
declare n text := trim(coalesce(p_number, '')); nm text := trim(coalesce(p_name, '')); k text := case when p_kind = 'staff' then 'staff' else 'student' end;
begin
  if n !~ '^[A-Za-z0-9]{3,20}$' or length(nm) < 3 or length(nm) > 100 then return 'invalid'; end if;
  if not public.comm_rl_hit('signup', 20, 3600) then return 'full'; end if;
  if exists (select 1 from profiles where university_id = n or employee_number = n) then return 'exists'; end if;
  if exists (select 1 from comm_signup_requests where number = n and status = 'pending') then return 'pending'; end if;
  if (select count(*) from comm_signup_requests where status = 'pending') >= 1000 then return 'full'; end if;
  insert into comm_signup_requests (number, full_name, major, phone, kind)
  values (n, nm, left(nullif(trim(p_major), ''), 120), left(nullif(trim(p_phone), ''), 30), k);
  return 'ok';
end $$;
revoke execute on function public.comm_request_signup(text, text, text, text, text) from public;
grant execute on function public.comm_request_signup(text, text, text, text, text) to anon, authenticated;

-- تقرير: الحسابات التي لم يغيّر أصحابها كلمة المرور الافتراضية بعد (للمدير الرئيسي)
create or replace function public.comm_default_pw_report() returns table(role text, cnt bigint, oldest_days integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  return query select p.role::text, count(*), coalesce(max(extract(day from now() - s.created_at))::integer, 0)
               from comm_pw_status s join profiles p on p.id = s.user_id where s.must_change group by p.role::text order by 2 desc;
end $$;
revoke execute on function public.comm_default_pw_report() from public, anon;
grant execute on function public.comm_default_pw_report() to authenticated;
select 'ready' as status;
