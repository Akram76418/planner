-- exams-nojust.sql: خيار المدرس «أسئلة بتبرير / بدون تبرير» لكل اختبار
-- يُشغَّل بعد exams.sql و exams-free.sql؛ وإن أُعيد تشغيل أيٍّ منهما فأعد تشغيل هذا الملف بعدهما.
alter table public.ex_exams add column if not exists use_just boolean not null default true;

create or replace function public.ex_exam_nojust_trg() returns trigger language plpgsql as $$
begin if not new.use_just then new.just_weight := 0; end if; return new; end $$;
drop trigger if exists ex_exam_nojust on public.ex_exams;
create trigger ex_exam_nojust before insert or update on public.ex_exams for each row execute function public.ex_exam_nojust_trg();
update public.ex_exams set just_weight = 0 where not use_just;

create or replace function public.ex_just_nojust_trg() returns trigger language plpgsql security definer set search_path = public set row_security = off as $$
begin
  if exists (select 1 from ex_attempts a join ex_exams e on e.id = a.exam_id where a.id = new.attempt_id and not e.use_just) then
    new.status := 'graded'; new.approved := true; new.flags := '{}'; new.student_text := ''; new.ai_score := 0;
  end if;
  return new;
end $$;
drop trigger if exists ex_just_nojust on public.ex_justifications;
create trigger ex_just_nojust before insert on public.ex_justifications for each row execute function public.ex_just_nojust_trg();

do $$ begin
  if position('use_just' in pg_get_functiondef('public.ex_state(bigint)'::regprocedure)) = 0 then
    drop function if exists public.ex_state_core(bigint);
    alter function public.ex_state(bigint) rename to ex_state_core;
  end if;
end $$;
create or replace function public.ex_state(p_attempt bigint) returns jsonb
language plpgsql security definer set search_path = public set row_security = off as $$
declare r jsonb; uj boolean;   -- use_just
begin
  r := public.ex_state_core(p_attempt);
  select e.use_just into uj from ex_attempts a join ex_exams e on e.id = a.exam_id where a.id = p_attempt;
  return r || jsonb_build_object('use_just', coalesce(uj, true));
end $$;
revoke execute on function public.ex_state(bigint), public.ex_state_core(bigint) from public, anon, authenticated;

create or replace function public.ex_answer(p_attempt bigint, p_question bigint, p_selected integer[], p_text text, p_signals jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public set row_security = off as $$
declare st jsonb; q ex_questions; a ex_attempts; sel integer[]; txt text := trim(coalesce(p_text, '')); sg jsonb := '{}'::jsonb; jid bigint; cs numeric; nlen integer; uj boolean;
begin
  st := public.ex_state(p_attempt);
  if st->>'mode' = 'free' then raise exception 'هذا الاختبار بنمط التنقل الحر'; end if;
  if st->>'status' = 'finished' then raise exception 'انتهى الاختبار'; end if;
  if (st->'question'->>'id')::bigint <> p_question then raise exception 'هذا السؤال لم يعد متاحاً (انتهى زمنه أو أُجيب عنه)'; end if;
  select * into q from ex_questions where id = p_question;
  select array_agg(distinct x order by x) into sel from unnest(coalesce(p_selected, '{}')) x;
  nlen := jsonb_array_length(q.options);
  if sel is null or exists (select 1 from unnest(sel) x where x < 0 or x >= nlen) then raise exception 'اختر إجابة صحيحة'; end if;
  if not q.multi_select and array_length(sel, 1) <> 1 then raise exception 'اختر خياراً واحداً'; end if;
  select use_just into uj from ex_exams where id = q.exam_id;
  if uj and length(txt) < 5 then raise exception 'اكتب تبريرك (5 أحرف على الأقل)'; end if;
  if length(txt) > 600 then raise exception 'التبرير أطول من 600 حرف'; end if;
  if jsonb_typeof(p_signals) = 'object' then
    sg := jsonb_build_object('paste', least(greatest(coalesce((p_signals->>'paste')::numeric, 0), 0), 1000), 'blur', least(greatest(coalesce((p_signals->>'blur')::numeric, 0), 0), 1000),
                             'typed_ms', least(greatest(coalesce((p_signals->>'typed_ms')::numeric, 0), 0), 86400000), 'keys', least(greatest(coalesce((p_signals->>'keys')::numeric, 0), 0), 100000));
  end if;
  cs := public.ex_choice_score(q.correct_options, sel, q.multi_select);
  insert into ex_answers (attempt_id, question_id, selected_options, choice_score) values (p_attempt, p_question, sel, cs);
  insert into ex_justifications (attempt_id, question_id, student_id, student_text, signals, status)
  values (p_attempt, p_question, auth.uid(), txt, sg, 'pending') returning id into jid;
  update ex_attempts set cur_pos = cur_pos + 1, q_started_at = null, q_deadline = null where id = p_attempt;
  return jsonb_build_object('justification_id', case when uj then jid else null end, 'next', public.ex_state(p_attempt),
    'choice_correct', case when (select feedback_mode from ex_exams where id = q.exam_id) = 'immediate' then cs >= 1 else null end);
end $$;

create or replace function public.ex_free_finalize(p_attempt bigint) returns bigint[]
language plpgsql security definer set search_path = public set row_security = off as $$
declare a ex_attempts; q ex_questions; d ex_drafts; ids bigint[] := '{}'; jid bigint; sel integer[]; txt text; cs numeric; ok boolean; total integer := 0; nw timestamptz := clock_timestamp();
begin
  select * into a from ex_attempts where id = p_attempt for update;
  if not found or a.status = 'finished' then return ids; end if;
  for q in select * from ex_questions where exam_id = a.exam_id order by pos, id loop
    total := total + 1;
    select * into d from ex_drafts where attempt_id = a.id and question_id = q.id;
    select coalesce(array_agg(distinct x order by x), '{}') into sel from unnest(coalesce(d.selected, '{}')) x where x >= 0 and x < jsonb_array_length(q.options);
    txt := trim(coalesce(d.student_text, ''));
    ok := cardinality(sel) > 0 and length(txt) >= 5;
    cs := case when cardinality(sel) = 0 then 0 else public.ex_choice_score(q.correct_options, sel, q.multi_select) end;
    insert into ex_answers (attempt_id, question_id, selected_options, choice_score) values (a.id, q.id, sel, cs) on conflict do nothing;
    jid := null;
    insert into ex_justifications (attempt_id, question_id, student_id, student_text, signals, status, flags)
    values (a.id, q.id, a.student_id, txt, coalesce(d.signals, '{}'::jsonb), case when ok then 'pending' else 'needs_review' end,
            case when cardinality(sel) = 0 and txt = '' then array['unanswered'] when not ok then array['incomplete'] else '{}'::text[] end)
    on conflict do nothing returning id into jid;
    if jid is not null and ok then ids := ids || jid; end if;
  end loop;
  update ex_attempts set status = 'finished', submitted_at = nw, cur_pos = total, q_started_at = null, q_deadline = null where id = a.id;
  return ids;
end $$;
select 'ready' as status;
