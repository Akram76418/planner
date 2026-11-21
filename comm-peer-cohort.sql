-- ═══ المحادثات الخاصة: إظهار شعبة الطالب بجانب اسمه (للمستخدم الموظف فقط) ═══
create or replace function public.comm_peer_cohorts(p_ids uuid[])
returns table(user_id uuid, cohorts text)
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if coalesce(public.current_user_role()::text, '') not in ('admin', 'professor', 'staff') then return; end if;
  return query
    select m.user_id, string_agg(c.name, '، ' order by c.name)
    from comm_cohort_members m join comm_cohorts c on c.id = m.cohort_id
    where m.user_id = any (p_ids[1:200])
    group by m.user_id;
end $$;
revoke execute on function public.comm_peer_cohorts(uuid[]) from public, anon;
grant execute on function public.comm_peer_cohorts(uuid[]) to authenticated;
select 'ready' as status;
