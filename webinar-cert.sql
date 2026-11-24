-- webinar-cert.sql: خيارات الشهادة لكل ويبينار (الجهة المنظِّمة، الشعار، التوقيع: كلها اختيارية)
-- يُشغَّل بعد webinar-attendance.sql
alter table public.wb_events add column if not exists cert_org text check (cert_org is null or length(cert_org) <= 200);
alter table public.wb_events add column if not exists cert_logo boolean not null default false;
alter table public.wb_events add column if not exists cert_signer text check (cert_signer is null or length(cert_signer) <= 200);

create or replace function public.wb_cert_opts_get(p_id bigint) returns table(org text, logo boolean, signer text)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.wb_is_mgr(p_id) then raise exception 'not allowed'; end if;
  return query select e.cert_org, e.cert_logo, e.cert_signer from wb_events e where e.id = p_id;
end $$;
create or replace function public.wb_cert_opts_set(p_id bigint, p_org text, p_logo boolean, p_signer text) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
begin
  if not public.wb_is_mgr(p_id) then raise exception 'not allowed'; end if;
  update wb_events set cert_org = nullif(left(trim(coalesce(p_org, '')), 200), ''), cert_logo = coalesce(p_logo, false), cert_signer = nullif(left(trim(coalesce(p_signer, '')), 200), '') where id = p_id;
end $$;

drop function if exists public.wb_cert(bigint);
create function public.wb_cert(p_id bigint)
returns table(full_name text, title text, speaker text, starts_at timestamptz, duration_min integer, minutes integer, org text, logo boolean, signer text)
language plpgsql stable security definer set search_path = public set row_security = off as $$
declare e wb_events; r wb_regs;
begin
  select * into e from wb_events where id = p_id; if not found then raise exception 'غير موجود'; end if;
  select * into r from wb_regs where event_id = p_id and user_id = auth.uid() and joined_at is not null;
  if not found then raise exception 'الشهادة لمن سُجّل حضوره'; end if;
  if e.min_minutes is not null and r.seconds_present < e.min_minutes * 60 then
    raise exception 'تُصدر الشهادة لمن حضر % دقيقة على الأقل. مدة حضورك المسجّلة: % دقيقة. (يُحتسب الوقت وصفحة الويبنار مفتوحة في التطبيق)', e.min_minutes, (r.seconds_present / 60);
  end if;
  return query select p.full_name, e.title, e.speaker, e.starts_at, e.duration_min, (r.seconds_present / 60)::integer, e.cert_org, e.cert_logo, e.cert_signer from profiles p where p.id = auth.uid();
end $$;

revoke execute on function public.wb_cert_opts_get(bigint), public.wb_cert_opts_set(bigint, text, boolean, text), public.wb_cert(bigint) from public, anon;
grant execute on function public.wb_cert_opts_get(bigint), public.wb_cert_opts_set(bigint, text, boolean, text), public.wb_cert(bigint) to authenticated;
select 'ready' as status;
