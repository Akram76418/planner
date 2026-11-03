-- كشف تكرار الطلبة (بالاسم أو الرقم الجامعي أو رقم الهوية). للمدير فقط.
-- لا يُرجع أرقام الهوية أبداً: تُستخدم للمقارنة داخل قاعدة البيانات فقط.
-- شغّله مرة واحدة في SQL Editor.

create or replace function public.comm_norm_name(t text) returns text
language sql immutable as $$
  select trim(regexp_replace(lower(translate(coalesce(t, ''), 'أإآىة', 'ااايه')), '\s+', ' ', 'g'))
$$;

create or replace function public.comm_find_duplicates()
returns table(reason text, grp text, id uuid, full_name text, university_id text, created_at timestamptz, last_sign_in timestamptz, must_change boolean, cohort_name text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  return query
  with s as (
    select p.id, nullif(trim(p.university_id), '') as uid, nullif(trim(p.national_id), '') as nid, public.comm_norm_name(p.full_name) as nm
    from public.profiles p where p.role::text = 'student'
  ), g as (
    select 'name'::text as r, s.nm as k, s.id from s where s.nm <> '' and s.nm in (select x.nm from s x group by x.nm having count(*) > 1)
    union all select 'number', s.uid, s.id from s where s.uid in (select x.uid from s x where x.uid is not null group by x.uid having count(*) > 1)
    union all select 'national_id', s.nid, s.id from s where s.nid in (select x.nid from s x where x.nid is not null group by x.nid having count(*) > 1)
    union all select 'number_vs_id', a.uid, a.id from s a join s b on a.uid = b.nid and a.id <> b.id
    union all select 'number_vs_id', b.nid, b.id from s a join s b on a.uid = b.nid and a.id <> b.id
  )
  select g.r, substr(md5(g.k), 1, 8), p.id, p.full_name, p.university_id, p.created_at, u.last_sign_in_at,
         coalesce(w.must_change, false), c.name
  from g
  join public.profiles p on p.id = g.id
  left join auth.users u on u.id = p.id
  left join public.comm_pw_status w on w.user_id = p.id
  left join public.comm_cohort_members m on m.user_id = p.id
  left join public.comm_cohorts c on c.id = m.cohort_id
  order by g.r, 2, p.created_at
  limit 1500;
end $$;
revoke execute on function public.comm_find_duplicates() from public, anon;
grant execute on function public.comm_find_duplicates() to authenticated;

-- قائمة الطلبة: رفع الحد من 300 إلى 2000 (للتحديد والحذف الجماعي)
create or replace function public.comm_list_students(p_cohort integer default null, p_search text default '', p_unassigned boolean default false)
returns table(id uuid, full_name text, university_id text, major text, cohort_id integer, cohort_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  return query
    select p.id, p.full_name, p.university_id, p.major, m.cohort_id, c.name
    from profiles p
    left join comm_cohort_members m on m.user_id = p.id
    left join comm_cohorts c on c.id = m.cohort_id
    where p.role::text = 'student'
      and (p_cohort is null or m.cohort_id = p_cohort)
      and (not p_unassigned or m.user_id is null)
      and (nullif(trim(p_search), '') is null
           or p.full_name ilike '%' || trim(p_search) || '%'
           or coalesce(p.university_id, '') ilike '%' || trim(p_search) || '%')
    order by p.full_name limit 2000;
end $$;
