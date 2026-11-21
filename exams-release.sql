-- ═══ الاختبارات: نشر النتائج إما «بدون التبرير» (درجة الاختيار فقط) أو «مع التبرير» (يُشغَّل بعد exams.sql) ═══
-- release_mode = full (الافتراضي: الاختيار + التبرير المعتمد) أو choice (الاختيار فقط؛ لا يرى الطالب أي شيء عن التبرير)
alter table public.ex_exams add column if not exists release_mode text not null default 'full';
do $$ begin
  alter table public.ex_exams add constraint ex_exams_release_mode_chk check (release_mode in ('full', 'choice'));
exception when duplicate_object then null; end $$;

create or replace function public.ex_my_results(p_exam bigint) returns jsonb
language plpgsql stable security definer set search_path = public set row_security = off as $$
declare e ex_exams; a ex_attempts; vis boolean; rows jsonb; tc numeric; tj numeric; n integer;
begin
  select * into e from ex_exams where id = p_exam; select * into a from ex_attempts where exam_id = p_exam and student_id = auth.uid();
  if not found then return jsonb_build_object('visible', false, 'status', 'none'); end if;
  vis := e.released or (e.feedback_mode = 'immediate' and a.status = 'finished');
  if not vis then return jsonb_build_object('visible', false, 'status', a.status); end if;
  select count(*) into n from ex_questions where exam_id = p_exam;
  select coalesce(jsonb_agg(jsonb_build_object('pos', q.pos, 'stem', q.stem, 'options', q.options, 'multi', q.multi_select, 'selected', an.selected_options, 'correct', q.correct_options,
           'choice_score', an.choice_score, 'just_text', case when e.release_mode = 'choice' then null else j.student_text end,
           'just_score', case when e.release_mode = 'choice' then null when coalesce(j.approved, false) then coalesce(j.instructor_score, j.ai_score, 0) end,
           'feedback', case when e.release_mode = 'choice' then null when coalesce(j.approved, false) then coalesce(nullif(j.instructor_note, ''), j.ai_feedback) end,
           'pending', e.release_mode <> 'choice' and not coalesce(j.approved, false)) order by q.pos, q.id), '[]'::jsonb),
         coalesce(sum(an.choice_score), 0), coalesce(sum(case when j.approved then coalesce(j.instructor_score, j.ai_score, 0) else 0 end), 0)
    into rows, tc, tj
    from ex_questions q left join ex_answers an on an.question_id = q.id and an.attempt_id = a.id
    left join ex_justifications j on j.question_id = q.id and j.attempt_id = a.id where q.exam_id = p_exam;
  return jsonb_build_object('visible', true, 'mode', e.release_mode, 'status', a.status, 'rows', rows, 'choice_total', round(tc * e.choice_weight, 2), 'just_total', case when e.release_mode = 'choice' then 0 else round(tj * e.just_weight, 2) end,
    'total', case when e.release_mode = 'choice' then round(tc * e.choice_weight, 2) else round(tc * e.choice_weight + tj * e.just_weight, 2) end,
    'unreviewed', case when e.release_mode = 'choice' then 0 else (select count(*) from ex_justifications j2 where j2.attempt_id = a.id and not j2.approved) end,
    'max', case when e.release_mode = 'choice' then round(n * e.choice_weight, 2) else round(n * (e.choice_weight + e.just_weight), 2) end);
end $$;

select 'ready' as status;
