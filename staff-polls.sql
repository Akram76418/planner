-- استبيانات الموظفين: نفس آلية استبيانات الطلبة مع جمهور مستهدف
-- audience: null = طلبة (كما كان) | staff_all = كل الموظفين | staff_trainers = المدربون | staff_admin = الإداريون
-- المدربون = دور «أستاذ» أو تصنيف أكاديمي/عملي ؛ الإداريون = تصنيف «إداري» (ولا يكونون أساتذة)
alter table public.comm_polls add column if not exists audience text
  check (audience is null or audience in ('staff_all','staff_trainers','staff_admin'));

create or replace function public.comm_poll_aud_ok(p_aud text, p_uid uuid) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when p_aud is null then false
    when p_aud = 'staff_all' then exists (select 1 from profiles x where x.id = p_uid and x.role::text in ('staff','professor'))
    when p_aud = 'staff_trainers' then exists (select 1 from profiles x where x.id = p_uid and x.role::text in ('staff','professor')
        and (x.role::text = 'professor' or exists (select 1 from comm_staff_categories k where k.user_id = p_uid and k.category in ('academic','practical'))))
    when p_aud = 'staff_admin' then exists (select 1 from profiles x where x.id = p_uid and x.role::text in ('staff','professor')
        and x.role::text <> 'professor' and exists (select 1 from comm_staff_categories k where k.user_id = p_uid and k.category = 'admin'))
    else false end
$$;

drop function if exists public.comm_poll_list();
create or replace function public.comm_poll_list()
returns table(id bigint, cohort_id integer, cohort_name text, question text, options text[], closed boolean, created_at timestamptz, my_vote integer, counts integer[], total integer, eligible bigint, audience text, can_vote boolean)
language plpgsql stable security definer set search_path = public set row_security = off as $$
declare r text := public.current_user_role(); myc integer;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  select m.cohort_id into myc from comm_cohort_members m where m.user_id = auth.uid();
  return query
    select p.id, p.cohort_id, c.name, p.question, p.options, p.closed, p.created_at,
      (select v.opt from comm_poll_votes v where v.poll_id = p.id and v.user_id = auth.uid()),
      case when (r = 'admin') or (p.audience is null and r in ('professor','staff')) or p.closed or exists (select 1 from comm_poll_votes v where v.poll_id = p.id and v.user_id = auth.uid())
           then (select array_agg((select count(*)::int from comm_poll_votes v where v.poll_id = p.id and v.opt = g.i - 1) order by g.i) from generate_series(1, array_length(p.options, 1)) g(i))
           else null end,
      (select count(*)::int from comm_poll_votes v where v.poll_id = p.id),
      case when p.audience is not null then
             (select count(*) from profiles x where public.comm_poll_aud_ok(p.audience, x.id))
           when p.cohort_id is null then (select count(*) from profiles x where x.role::text = 'student')
           else (select count(*) from comm_cohort_members m2 where m2.cohort_id = p.cohort_id) end,
      p.audience,
      (not p.closed) and (
        (p.audience is null and r = 'student' and (p.cohort_id is null or p.cohort_id = myc))
        or (p.audience is not null and public.comm_poll_aud_ok(p.audience, auth.uid())))
    from comm_polls p left join comm_cohorts c on c.id = p.cohort_id
    where r = 'admin'
       or (p.audience is null and (r in ('professor','staff') or p.cohort_id is null or p.cohort_id = myc))
       or (p.audience is not null and public.comm_poll_aud_ok(p.audience, auth.uid()))
    order by p.closed, p.id desc limit 100;
end $$;

create or replace function public.comm_poll_vote(p_poll bigint, p_opt integer) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
declare pl comm_polls; myc integer; r text := public.current_user_role();
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  select * into pl from comm_polls where id = p_poll;
  if not found or pl.closed then raise exception 'الاستبيان مغلق'; end if;
  if pl.audience is null then
    if r <> 'student' then raise exception 'للطلبة فقط'; end if;
    select m.cohort_id into myc from comm_cohort_members m where m.user_id = auth.uid();
    if pl.cohort_id is not null and pl.cohort_id is distinct from myc then raise exception 'not allowed'; end if;
  elsif not public.comm_poll_aud_ok(pl.audience, auth.uid()) then
    raise exception 'غير موجّه إليك';
  end if;
  if p_opt < 0 or p_opt >= array_length(pl.options, 1) then raise exception 'bad option'; end if;
  if exists (select 1 from comm_poll_votes v where v.poll_id = p_poll and v.user_id = auth.uid()) then raise exception 'سبق أن أجبت على هذا الاستبيان'; end if;
  insert into comm_poll_votes (poll_id, user_id, opt) values (p_poll, auth.uid(), p_opt);
end $$;

drop function if exists public.comm_poll_create(integer, text, text[]);
create or replace function public.comm_poll_create(p_cohort integer, p_question text, p_options text[], p_audience text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare nid bigint; opts text[];
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  if p_audience is not null and p_audience not in ('staff_all','staff_trainers','staff_admin') then raise exception 'bad audience'; end if;
  select array_agg(trim(x)) into opts from unnest(p_options) x where length(trim(x)) > 0;
  if coalesce(array_length(opts, 1), 0) < 2 then raise exception 'يلزم خياران على الأقل'; end if;
  insert into comm_polls (cohort_id, question, options, audience)
  values (case when p_audience is null then p_cohort else null end, trim(p_question), opts[1:8], p_audience) returning id into nid;
  return nid;
end $$;

revoke execute on function public.comm_poll_aud_ok(text, uuid) from public, anon, authenticated;
revoke execute on function public.comm_poll_list(), public.comm_poll_vote(bigint, integer), public.comm_poll_create(integer, text, text[], text) from public, anon;
grant execute on function public.comm_poll_list(), public.comm_poll_vote(bigint, integer), public.comm_poll_create(integer, text, text[], text) to authenticated;


-- أسماء المصوّتين: للأدمن الرئيسي فقط
create or replace function public.comm_poll_voters() returns table(poll_id bigint, opt integer, voter text)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.admin_can('main') then raise exception 'main admin only'; end if;
  return query select v.poll_id, v.opt, coalesce(nullif(trim(p.full_name), ''), '—') from comm_poll_votes v left join profiles p on p.id = v.user_id order by v.poll_id, v.opt, p.full_name;
end $$;
revoke execute on function public.comm_poll_voters() from public, anon;
grant execute on function public.comm_poll_voters() to authenticated;

-- تعديل نص الاستبيان (الأدمن): السؤال والخيارات ؛ مع وجود أصوات لا يجوز تقليل عدد الخيارات
create or replace function public.comm_poll_update(p_id bigint, p_question text, p_options text[]) returns void
language plpgsql security definer set search_path = public as $$
declare opts text[]; mx integer;
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  if length(trim(coalesce(p_question, ''))) = 0 then raise exception 'السؤال فارغ'; end if;
  select array_agg(trim(x)) into opts from unnest(p_options) x where length(trim(x)) > 0;
  if coalesce(array_length(opts, 1), 0) < 2 then raise exception 'يلزم خياران على الأقل'; end if;
  opts := opts[1:8];
  select max(opt) + 1 into mx from comm_poll_votes where poll_id = p_id;
  if coalesce(mx, 0) > array_length(opts, 1) then raise exception 'لا يمكن تقليل الخيارات لوجود أصوات عليها'; end if;
  update comm_polls set question = trim(p_question), options = opts where id = p_id;
end $$;
revoke execute on function public.comm_poll_update(bigint, text, text[]) from public, anon;
grant execute on function public.comm_poll_update(bigint, text, text[]) to authenticated;
select 'ready' as status;
