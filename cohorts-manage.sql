-- تعديل الشعب وحذفها (للمدير فقط). شغّله مرة واحدة بعد comm-schema.sql.
create or replace function public.comm_rename_cohort(p_id integer, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'invalid name'; end if;
  update comm_cohorts set name = trim(p_name) where id = p_id;
  if not found then raise exception 'cohort not found'; end if;
exception when unique_violation then raise exception 'cohort name already exists';
end $$;

-- حذف شعبة. إن كان فيها طلبة أو إعلانات ترجع blocked دون حذف، ويُعاد الاستدعاء بـ p_force = true بعد تأكيد المدير.
-- عند الحذف يصير طلبتها بلا شعبة وتُحذف إعلاناتها.
create or replace function public.comm_delete_cohort(p_id integer, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m bigint; a bigint;
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  select count(*) into m from comm_cohort_members where cohort_id = p_id;
  select count(*) into a from comm_announcements where cohort_id = p_id;
  if (m > 0 or a > 0) and not p_force then
    return jsonb_build_object('blocked', true, 'members', m, 'announcements', a);
  end if;
  delete from comm_cohort_members where cohort_id = p_id;
  delete from comm_cohorts where id = p_id;
  return jsonb_build_object('deleted', true, 'members', m, 'announcements', a);
end $$;

revoke execute on function public.comm_rename_cohort(integer, text), public.comm_delete_cohort(integer, boolean) from public, anon;
grant execute on function public.comm_rename_cohort(integer, text), public.comm_delete_cohort(integer, boolean) to authenticated;
