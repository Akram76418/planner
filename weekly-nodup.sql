-- منع تكرار الأسماء في جدول الدوام (عند الإضافة) — لا يغيّر الأسماء الموجودة
create or replace function public.comm_weekly_save(p_id bigint, p_name text, p_cells jsonb, p_notes text, p_user uuid default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare nid bigint; nn text;
begin
  if not public.admin_can('weekly') then raise exception 'admin only'; end if;
  nn := regexp_replace(translate(lower(trim(p_name)), 'أإآىة', 'اااهي'), '\s+', ' ', 'g');
  if nn = '' then raise exception 'الاسم فارغ'; end if;
  if p_id is null then
    if exists (select 1 from comm_weekly w where regexp_replace(translate(lower(trim(w.name)), 'أإآىة', 'اااهي'), '\s+', ' ', 'g') = nn) then
      raise exception 'الاسم موجود مسبقاً في الجدول: %', trim(p_name);
    end if;
    insert into comm_weekly (user_id, name, cells, notes, sort)
    values (p_user, trim(p_name), coalesce(p_cells, '{}'), nullif(trim(p_notes), ''), coalesce((select max(sort) + 1 from comm_weekly), 0)) returning id into nid;
  else
    update comm_weekly set name = trim(p_name), cells = coalesce(p_cells, '{}'), notes = nullif(trim(p_notes), '') where id = p_id returning id into nid;
  end if;
  return nid;
end $$;
select 'ready' as status;
