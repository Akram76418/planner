-- التكافل: صفحة عامة لفاعل الخير (بلا تسجيل دخول). يعمل بعد takaful.sql. آمن لإعادة التشغيل.
-- يتعهّد فاعل الخير بمبلغ فيظهر عند الإدارة «بانتظار الاعتماد»، ولا يدخل الإجمالي إلا بعد اعتمادك.
alter table public.tk_rounds add column if not exists ext_open boolean not null default false;   -- فتح الصفحة العامة لهذه الدورة

create table if not exists public.tk_pending (
  id         bigint generated always as identity primary key,
  round_id   bigint not null references public.tk_rounds(id) on delete cascade,
  donor      text check (donor is null or length(donor) <= 80),
  kind       text not null default 'donation' check (kind in ('donation','course')),
  amount     numeric(14,2) not null check (amount > 0 and amount <= 100000),
  note       text check (note is null or length(note) <= 200),
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  ip_hash    text,
  item_id    bigint references public.tk_items(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists tk_pending_round on public.tk_pending (round_id, status);
create index if not exists tk_pending_ip on public.tk_pending (ip_hash, created_at);
alter table public.tk_pending enable row level security;
revoke all on public.tk_pending from anon, authenticated;
drop policy if exists "tk pending admin" on public.tk_pending;
create policy "tk pending admin" on public.tk_pending for select to authenticated using (public.admin_can('tk'));
grant select on public.tk_pending to authenticated;

-- ───── جهة العموم ─────
-- الدورات المفتوحة للتبرع العام (+ بيانات التحويل + إجمالي المتعهَّد به والمستلَم فقط، دون أي أسماء).
create or replace function public.tk_pub_info() returns jsonb
language sql stable security definer set search_path = public set row_security = off as $$
  select jsonb_build_object(
    'pay_info', (select s.pay_info from tk_settings s where s.id = 1),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'currency', r.currency,
        'total_pledged', (select coalesce(sum(i.amount), 0) from tk_items i where i.round_id = r.id and i.kind = 'in'),
        'total_received', (select coalesce(sum(i.amount), 0) from tk_items i where i.round_id = r.id and i.kind = 'in' and i.done)) order by r.round_date desc, r.id desc)
                        from tk_rounds r where r.ext_open and not r.closed), '[]'::jsonb))
$$;

-- إرسال تعهّد. حماية: مصيدة (honeypot) + حد لكل جهاز/شبكة + حد عام + سقف للمعلّق.
create or replace function public.tk_pub_pledge(p_round bigint, p_name text, p_amount numeric, p_kind text default 'donation', p_note text default null, p_hp text default null)
returns jsonb
language plpgsql security definer set search_path = public set row_security = off as $$
declare hdr jsonb; ip text; ih text; nm text := nullif(trim(coalesce(p_name, '')), ''); nt text := nullif(trim(coalesce(p_note, '')), ''); nid bigint; k text;
begin
  if coalesce(p_hp, '') <> '' then return jsonb_build_object('ok', true, 'ref', 0); end if;          -- روبوت: نتجاهل بصمت
  begin hdr := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb; exception when others then hdr := '{}'::jsonb; end;
  ip := coalesce(nullif(trim(split_part(coalesce(hdr->>'x-forwarded-for', hdr->>'cf-connecting-ip', ''), ',', 1)), ''), 'unknown');
  ih := md5(ip || ':tk');
  if not exists (select 1 from tk_rounds r where r.id = p_round and r.ext_open and not r.closed) then return jsonb_build_object('ok', false, 'err', 'closed'); end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000 then return jsonb_build_object('ok', false, 'err', 'amount'); end if;
  if nm is not null and length(nm) > 80 then nm := left(nm, 80); end if;
  if nt is not null and length(nt) > 200 then nt := left(nt, 200); end if;
  k := case when p_kind = 'course' then 'course' else 'donation' end;
  if (select count(*) from tk_pending where ip_hash = ih and created_at > now() - interval '1 hour') >= 3 then return jsonb_build_object('ok', false, 'err', 'rate'); end if;
  if (select count(*) from tk_pending where created_at > now() - interval '10 minutes') >= 20 then return jsonb_build_object('ok', false, 'err', 'busy'); end if;
  if (select count(*) from tk_pending where status = 'pending') >= 200 then return jsonb_build_object('ok', false, 'err', 'busy'); end if;
  insert into tk_pending (round_id, donor, kind, amount, note, ip_hash) values (p_round, nm, k, round(p_amount, 2), nt, ih) returning id into nid;
  return jsonb_build_object('ok', true, 'ref', nid);
end $$;

-- ───── جهة الإدارة ─────
-- اعتماد: يُنشئ مساهمة خارجية مستلَمة ضمن إجمالي الدورة (اضغطها بعد وصول المبلغ فعلاً)
create or replace function public.tk_pending_approve(p_id bigint, p_amount numeric default null) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare p tk_pending; nid bigint; amt numeric;
begin
  if not public.admin_can('tk') then raise exception 'not allowed'; end if;
  select * into p from tk_pending where id = p_id for update;
  if not found or p.status <> 'pending' then raise exception 'تم البت في هذا التعهد مسبقاً'; end if;
  amt := coalesce(p_amount, p.amount);
  if amt <= 0 or amt > 100000 then raise exception 'مبلغ غير صحيح'; end if;
  insert into tk_items (round_id, owner, kind, person, amount, done, done_at, ext, src, note)
  values (p.round_id, auth.uid(), 'in', coalesce(p.donor, 'فاعل خير'), round(amt, 2), true, current_date, p.kind, 'admin', p.note) returning id into nid;
  update tk_pending set status = 'approved', item_id = nid, decided_at = now() where id = p_id;
end $$;

create or replace function public.tk_pending_reject(p_id bigint) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
begin
  if not public.admin_can('tk') then raise exception 'not allowed'; end if;
  update tk_pending set status = 'rejected', decided_at = now() where id = p_id and status = 'pending';
end $$;

create or replace function public.tk_pending_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
begin
  if not public.admin_can('tk') then raise exception 'not allowed'; end if;
  delete from tk_pending where id = p_id and status <> 'pending';
end $$;

revoke execute on function public.tk_pub_info(), public.tk_pub_pledge(bigint, text, numeric, text, text, text), public.tk_pending_approve(bigint, numeric), public.tk_pending_reject(bigint), public.tk_pending_delete(bigint) from public;
grant execute on function public.tk_pub_info(), public.tk_pub_pledge(bigint, text, numeric, text, text, text) to anon, authenticated;
grant execute on function public.tk_pending_approve(bigint, numeric), public.tk_pending_reject(bigint), public.tk_pending_delete(bigint) to authenticated;
select 'ready' as status;
