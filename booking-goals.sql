-- ═══ حجز المحاضرات: قائمة طلبة الشعبة الذين لم ينضموا لأي مجموعة (لورقة «لم ينضموا» في تصدير Excel) ═══
-- يُشغَّل بعد booking-cohort.sql. (أهداف كل محاضرة تُحفظ في حقل وصف الموضوع الموجود أصلاً، فلا تغيير عليه.)
-- طلبة شعبة المساق الذين لم ينضموا لأي مجموعة (للمحاضر/الأدمن، للتصدير والمتابعة)
create or replace function public.bk_admin_unjoined(p_off bigint)
returns table(user_id uuid, full_name text, university_id text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can('book') then raise exception 'admin only'; end if;
  return query select m.user_id, p.full_name, p.university_id
    from book_offerings o join comm_cohort_members m on m.cohort_id = o.cohort_id left join profiles p on p.id = m.user_id
    where o.id = p_off and o.cohort_id is not null
      and not exists (select 1 from book_members b where b.offering_id = p_off and b.user_id = m.user_id)
    order by p.full_name;
end $$;
revoke execute on function public.bk_admin_unjoined(bigint) from public, anon;
grant execute on function public.bk_admin_unjoined(bigint) to authenticated;
select 'ready' as status;
