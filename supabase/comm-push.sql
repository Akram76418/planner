-- إشعارات رسائل التواصل على الجوال والحاسوب. شغّله مرة واحدة بعد accounts.sql.
-- 1) جدول صغير يحفظ آخر وقت فُحصت عنده الرسائل (تقرؤه دالة الإشعارات فقط)
create table if not exists public.comm_push_state (
  id      integer primary key check (id = 1),
  last_ts timestamptz not null
);
alter table public.comm_push_state enable row level security;
revoke all on public.comm_push_state from anon, authenticated;

-- 2) السماح للطلبة والموظفين بتسجيل اشتراك الإشعارات (كان للمنظّم فقط)
drop policy if exists "own subs" on public.push_subscriptions;
create policy "own subs" on public.push_subscriptions for all
  using (user_id = auth.uid() and (public.planner_ok() or public.current_user_role() is not null))
  with check (user_id = auth.uid() and (public.planner_ok() or public.current_user_role() is not null));
