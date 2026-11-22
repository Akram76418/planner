-- ═══ حجز المحاضرات: «أهداف/محتويات المحاضرة» للمساق + قائمة غير المنضمين للتصدير (يُشغَّل بعد booking-cohort.sql) ═══
alter table public.book_offerings add column if not exists goals text;
alter table public.book_offerings add column if not exists goals_label text not null default 'أهداف المحاضرة';
do $$ begin
  alter table public.book_offerings add constraint book_goals_len_chk check (goals is null or length(goals) <= 3000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.book_offerings add constraint book_goals_label_chk check (goals_label in ('أهداف المحاضرة', 'محتويات المحاضرة', 'أهداف ومحتويات المحاضرة', 'الوصف'));
exception when duplicate_object then null; end $$;

create or replace function public.bk_state(p_off bigint) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o book_offerings; me uuid := auth.uid(); adm boolean := public.admin_can('book'); mycoh integer; mygrp bigint;
begin
  select * into o from book_offerings where id = p_off;
  select cohort_id into mycoh from comm_cohort_members where user_id = me;
  if o.id is null or (not adm and (o.archived or o.cohort_id is null or o.cohort_id is distinct from mycoh)) then
    return jsonb_build_object('ok', false, 'err', 'noaccess');
  end if;
  select group_id into mygrp from book_members where offering_id = p_off and user_id = me;
  return jsonb_build_object('ok', true, 'closed', (o.closed or o.archived), 'closed_msg', o.closed_msg, 'goals', o.goals, 'goals_label', o.goals_label, 'cap', o.group_cap, 'my_group', mygrp,
    'topics', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'no', t.no, 'title', t.title, 'descr', t.descr,
        'group_no', (select g.group_no from book_groups g where g.topic_id = t.id)) order by t.no) from book_topics t where t.offering_id = p_off), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'group_no', g.group_no, 'topic_id', g.topic_id,
        'topic_no', (select t.no from book_topics t where t.id = g.topic_id), 'topic_title', (select t.title from book_topics t where t.id = g.topic_id),
        'date', g.lecture_date, 'cap', coalesce(g.cap, o.group_cap),
        'count', (select count(*) from book_members m where m.group_id = g.id) + jsonb_array_length(g.students),
        'mine', (g.id = mygrp),
        'link', case when g.id = mygrp then g.link end,
        'members', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(p.full_name, '—'), 'me', m.user_id = me) order by m.joined_at)
                             from book_members m left join profiles p on p.id = m.user_id where m.group_id = g.id), '[]'::jsonb),
        'manual', g.students) order by g.group_no) from book_groups g where g.offering_id = p_off), '[]'::jsonb));
end $$;

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
