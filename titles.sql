-- الألقاب: «د.» لأكرم ابو صلاح وعبد الرحمن الهمص وخالد خضورة، و«أ.» لباقي أعضاء هيئة التدريس. آمن للتكرار (لا يضاعف اللقب).
create or replace function public.comm_apply_titles() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_dr integer; n_a integer;
  strip constant text := '^\s*(أ\.\s*د\.?|د\.|أ\.|م\.|dr\.?)\s*';
begin
  if public.current_user_role() <> 'admin' then raise exception 'admin only'; end if;
  -- الدكاترة الثلاثة (موظف أو عضو هيئة تدريس)
  update profiles set full_name = 'د. ' || btrim(regexp_replace(full_name, strip, '', 'i'))
   where role::text in ('professor', 'staff')
     and (full_name ~ 'أكرم.*(ابو|أبو) صلاح' or full_name ~ 'اكرم.*(ابو|أبو) صلاح'
          or full_name ~ 'عبد الرحمن.*الهمص' or full_name ~ 'خالد.*خضورة')
     and full_name !~ '^\s*د\.\s';
  get diagnostics n_dr = row_count;
  -- باقي أعضاء هيئة التدريس: «أ.» إن لم يكن لهم لقب
  update profiles set full_name = 'أ. ' || btrim(full_name)
   where role::text = 'professor'
     and full_name !~ '^\s*(أ\.\s*د|د\.|أ\.|م\.|dr)'
     and not (full_name ~ 'أكرم.*(ابو|أبو) صلاح' or full_name ~ 'اكرم.*(ابو|أبو) صلاح'
          or full_name ~ 'عبد الرحمن.*الهمص' or full_name ~ 'خالد.*خضورة');
  get diagnostics n_a = row_count;
  return jsonb_build_object('doctors', n_dr, 'teachers', n_a);
end $$;
revoke execute on function public.comm_apply_titles() from public, anon;
grant execute on function public.comm_apply_titles() to authenticated;
