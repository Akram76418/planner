-- بحث عن أي حساب (طالب/موظف/عضو هيئة) بالاسم أو الرقم، وتحويل حساب طالب إلى موظف. شغّله بعد subadmin.sql.
create or replace function public.comm_find_account(p_q text) returns table(id uuid, full_name text, role text, number text, category text)
language plpgsql stable security definer set search_path = public as $$
declare q text := trim(coalesce(p_q, ''));
begin
  if not public.admin_can('staff') then raise exception 'admin only'; end if;
  if length(q) < 2 then return; end if;
  return query select p.id, p.full_name, p.role::text, coalesce(nullif(p.university_id, ''), nullif(p.employee_number, '')), sc.category
    from profiles p left join comm_staff_categories sc on sc.user_id = p.id
    where p.role::text <> 'admin'
      and (public.comm_norm_name(p.full_name) like '%' || public.comm_norm_name(q) || '%' or p.university_id ilike '%' || q || '%' or p.employee_number ilike '%' || q || '%')
    order by p.full_name limit 30;
end $$;
revoke execute on function public.comm_find_account(text) from public, anon;
grant execute on function public.comm_find_account(text) to authenticated;

-- تحويل حساب (غالباً أُنشئ بالخطأ كطالب) إلى موظف أو عضو هيئة تدريس
create or replace function public.comm_make_staff(p_user uuid, p_role text default 'staff', p_category text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('staff') then raise exception 'admin only'; end if;
  if p_role not in ('staff', 'professor') then raise exception 'bad role'; end if;
  if not exists (select 1 from profiles where id = p_user and role::text in ('student', 'staff', 'professor')) then raise exception 'not allowed'; end if;
  execute format('update profiles set role = %L where id = %L', p_role, p_user);
  delete from comm_cohort_members where user_id = p_user;
  update profiles set professor_id = null where id = p_user;
  if p_category in ('academic', 'practical', 'admin') then
    insert into comm_staff_categories (user_id, category) values (p_user, p_category) on conflict (user_id) do update set category = excluded.category;
  end if;
end $$;
revoke execute on function public.comm_make_staff(uuid, text, text) from public, anon;
grant execute on function public.comm_make_staff(uuid, text, text) to authenticated;
