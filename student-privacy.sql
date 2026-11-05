-- خصوصية الطلبة/الموظفين في البحث عن المستلمين:
-- الطالب لا يرى الرقم الوظيفي ولا الرقم الجامعي لأي شخص، ولا يبحث بهما. (بقية السلوك كما هو)
create or replace function public.search_communication_recipients(search_text text default ''::text, before_name text default null::text, before_id uuid default null::uuid, page_size integer default 25)
 returns table(id uuid, full_name text, role text, university_id text, employee_number text)
 language sql stable security definer
 set search_path to 'public'
 set row_security to 'off'
as $function$
  select p.id, p.full_name, p.role::text,
         case when public.current_user_role() = 'student' then null else p.university_id end,
         case when public.current_user_role() = 'student' then null else p.employee_number end
  from public.profiles p
  where p.id <> auth.uid()
    and public.can_communicate_with(p.id)
    and (
      nullif(trim(search_text), '') is null
      or p.full_name ilike '%' || trim(search_text) || '%'
      or (public.current_user_role() <> 'student' and coalesce(p.university_id, '') ilike '%' || trim(search_text) || '%')
      or (public.current_user_role() <> 'student' and coalesce(p.employee_number, '') ilike '%' || trim(search_text) || '%')
    )
    and (
      before_name is null
      or p.full_name > before_name
      or (p.full_name = before_name and p.id > before_id)
    )
  order by p.full_name asc, p.id asc
  limit greatest(1, least(coalesce(page_size, 25), 50));
$function$;
select 'ready' as status;
