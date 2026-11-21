-- ═══ الاختبارات: نمط «التنقل الحر» على طريقة مودل (يُشغَّل بعد exams.sql، وأعد تشغيله إن أعدتَ تشغيل exams.sql) ═══
-- يحدّد المحاضر/الأدمن لكل اختبار: nav_mode = seq (التسلسلي الحالي: لا رجوع) أو free (تنقل حر + لوحة أسئلة + تعليم للمراجعة)،
-- و page_size = عدد الأسئلة في الشاشة الواحدة. الاختبارات الحالية تبقى تسلسلية دون أي تغيير.
alter table public.ex_exams add column if not exists nav_mode text not null default 'seq';
alter table public.ex_exams add column if not exists page_size integer not null default 1;
do $$ begin
  alter table public.ex_exams add constraint ex_exams_nav_mode_chk check (nav_mode in ('seq', 'free'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ex_exams add constraint ex_exams_page_size_chk check (page_size between 1 and 50);
exception when duplicate_object then null; end $$;

-- لا يُغيَّر نمط التنقل بعد أن يبدأ أي طالب محاولته (كي لا تتلف المحاولات الجارية)
create or replace function public.ex_nav_guard() returns trigger language plpgsql as $$
begin
  if new.nav_mode is distinct from old.nav_mode and exists (select 1 from ex_attempts where exam_id = old.id) then
    raise exception 'لا يمكن تغيير نمط التنقل بعد بدء محاولات الطلبة';
  end if;
  return new;
end $$;
drop trigger if exists ex_nav_guard_t on public.ex_exams;
create trigger ex_nav_guard_t before update on public.ex_exams for each row execute function public.ex_nav_guard();

-- مسودات الإجابة في النمط الحر (تُحفظ تلقائياً أثناء الحل، ولا تُحتسب إلا عند التسليم أو انتهاء الوقت)
create table if not exists public.ex_drafts (
  attempt_id   bigint not null references public.ex_attempts(id) on delete cascade,
  question_id  bigint not null references public.ex_questions(id) on delete cascade,
  selected     integer[] not null default '{}',
  student_text text not null default '' check (length(student_text) <= 600),
  flagged      boolean not null default false,
  signals      jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  primary key (attempt_id, question_id)
);
alter table public.ex_drafts enable row level security;
revoke all on public.ex_drafts from public, anon, authenticated;

-- ينهي المحاولة: يحوّل المسودات إلى إجابات وتبريرات (ما لم يُجَب يُسجَّل فارغاً للمراجعة). يعيد معرّفات التبريرات الجاهزة للتصحيح
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

-- حالة المحاولة الحرة: كل الأسئلة (دون الإجابات الصحيحة) + مسودات الطالب + الوقت المتبقي
create or replace function public.ex_free_state(p_attempt bigint) returns jsonb
language plpgsql security definer set search_path = public set row_security = off as $$
declare a ex_attempts; e ex_exams; nw timestamptz := clock_timestamp(); total integer;
begin
  select * into a from ex_attempts where id = p_attempt and student_id = auth.uid(); if not found then raise exception 'not found'; end if;
  select * into e from ex_exams where id = a.exam_id;
  if a.status <> 'finished' and ((a.deadline_at is not null and nw > a.deadline_at + interval '2 seconds') or (e.closes_at is not null and nw > e.closes_at + interval '2 seconds')) then
    perform public.ex_free_finalize(a.id); select * into a from ex_attempts where id = p_attempt;
  end if;
  if a.status = 'finished' then return jsonb_build_object('status', 'finished', 'mode', 'free', 'server_now', nw); end if;
  select count(*) into total from ex_questions where exam_id = e.id;
  return jsonb_build_object('status', 'in_progress', 'mode', 'free', 'attempt_id', a.id, 'total', total, 'page_size', e.page_size,
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'stem', q.stem, 'options', q.options, 'multi', q.multi_select) order by q.pos, q.id), '[]'::jsonb) from ex_questions q where q.exam_id = e.id),
    'drafts', (select coalesce(jsonb_object_agg(d.question_id::text, jsonb_build_object('sel', d.selected, 'text', d.student_text, 'flag', d.flagged)), '{}'::jsonb) from ex_drafts d where d.attempt_id = a.id),
    'total_left_s', case when a.deadline_at is null then null else greatest(0, ceil(extract(epoch from a.deadline_at - nw)))::int end,
    'server_now', nw);
end $$;

-- حفظ مسودة سؤال (يُستدعى تلقائياً من الواجهة بعد كل تغيير)
create or replace function public.ex_free_save(p_attempt bigint, p_question bigint, p_selected integer[], p_text text, p_flag boolean, p_signals jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public set row_security = off as $$
declare a ex_attempts; e ex_exams; q ex_questions; sel integer[]; sg jsonb := '{}'::jsonb; nw timestamptz := clock_timestamp();
begin
  select * into a from ex_attempts where id = p_attempt and student_id = auth.uid(); if not found then raise exception 'not found'; end if;
  if a.status = 'finished' then return jsonb_build_object('finished', true); end if;
  select * into e from ex_exams where id = a.exam_id;
  if e.nav_mode <> 'free' then raise exception 'هذا الاختبار ليس بنمط التنقل الحر'; end if;
  if (a.deadline_at is not null and nw > a.deadline_at + interval '2 seconds') or (e.closes_at is not null and nw > e.closes_at + interval '2 seconds') then
    perform public.ex_free_finalize(a.id); return jsonb_build_object('finished', true);
  end if;
  select * into q from ex_questions where id = p_question and exam_id = a.exam_id; if not found then raise exception 'السؤال غير موجود'; end if;
  select coalesce(array_agg(distinct x order by x), '{}') into sel from unnest(coalesce(p_selected, '{}')) x;
  if exists (select 1 from unnest(sel) x where x < 0 or x >= jsonb_array_length(q.options)) then raise exception 'اختيار غير صحيح'; end if;
  if not q.multi_select and cardinality(sel) > 1 then raise exception 'اختر خياراً واحداً'; end if;
  if jsonb_typeof(p_signals) = 'object' then
    sg := jsonb_build_object('paste', least(greatest(coalesce((p_signals->>'paste')::numeric, 0), 0), 1000), 'blur', least(greatest(coalesce((p_signals->>'blur')::numeric, 0), 0), 1000),
                             'typed_ms', least(greatest(coalesce((p_signals->>'typed_ms')::numeric, 0), 0), 86400000), 'keys', least(greatest(coalesce((p_signals->>'keys')::numeric, 0), 0), 100000));
  end if;
  insert into ex_drafts (attempt_id, question_id, selected, student_text, flagged, signals, updated_at)
  values (a.id, q.id, sel, left(coalesce(p_text, ''), 600), coalesce(p_flag, false), sg, now())
  on conflict (attempt_id, question_id) do update set selected = excluded.selected, student_text = excluded.student_text, flagged = excluded.flagged, signals = excluded.signals, updated_at = now();
  return jsonb_build_object('saved', true);
end $$;

-- التسليم النهائي من الطالب: يعيد معرّفات التبريرات لتصحيحها
create or replace function public.ex_free_submit(p_attempt bigint) returns jsonb
language plpgsql security definer set search_path = public set row_security = off as $$
begin
  if not exists (select 1 from ex_attempts a join ex_exams e on e.id = a.exam_id where a.id = p_attempt and a.student_id = auth.uid() and e.nav_mode = 'free') then raise exception 'not found'; end if;
  return jsonb_build_object('ids', to_jsonb(public.ex_free_finalize(p_attempt)));
end $$;

-- للمدرّس: يُنهي المحاولات الحرة التي انتهى وقتها ولم يعد طالبها (فتظهر إجاباتهم في المراجعة والنتائج)
create or replace function public.ex_free_sweep(p_exam bigint) returns integer
language plpgsql security definer set search_path = public set row_security = off as $$
declare e ex_exams; a record; n integer := 0;
begin
  if not public.ex_can_manage(p_exam) then raise exception 'not allowed'; end if;
  select * into e from ex_exams where id = p_exam; if not found or e.nav_mode <> 'free' then return 0; end if;
  for a in select id from ex_attempts where exam_id = p_exam and status = 'in_progress'
       and ((deadline_at is not null and clock_timestamp() > deadline_at + interval '2 seconds') or (e.closes_at is not null and clock_timestamp() > e.closes_at + interval '2 seconds')) loop
    perform public.ex_free_finalize(a.id); n := n + 1;
  end loop;
  return n;
end $$;

-- (نسخة محدَّثة من ex_state: تحوّل الاختبار الحر إلى ex_free_state)
create or replace function public.ex_state(p_attempt bigint) returns jsonb
language plpgsql security definer set search_path = public set row_security = off as $$
declare a ex_attempts; e ex_exams; q ex_questions; total integer; nw timestamptz := clock_timestamp(); qsec integer; n integer := 0;
begin
  select * into a from ex_attempts where id = p_attempt and student_id = auth.uid() for update;
  if not found then raise exception 'not found'; end if;
  select * into e from ex_exams where id = a.exam_id;
  if e.nav_mode = 'free' then return public.ex_free_state(p_attempt); end if;   -- نمط التنقل الحر
  select count(*) into total from ex_questions where exam_id = e.id;
  loop
    n := n + 1; exit when n > 500 or a.status = 'finished';
    if (a.deadline_at is not null and nw > a.deadline_at + interval '2 seconds') or (e.closes_at is not null and nw > e.closes_at + interval '2 seconds') or a.cur_pos >= total then
      a.status := 'finished'; a.submitted_at := nw; exit;
    end if;
    select * into q from ex_questions where exam_id = e.id order by pos, id offset a.cur_pos limit 1;
    qsec := coalesce(q.time_sec, e.per_question_sec);
    if a.q_deadline is not null and nw > a.q_deadline + interval '3 seconds' then       -- انتهى زمن السؤال: يُسجَّل فارغاً ويُنتقل للتالي
      insert into ex_answers (attempt_id, question_id, selected_options, choice_score) values (a.id, q.id, '{}', 0) on conflict do nothing;
      insert into ex_justifications (attempt_id, question_id, student_id, student_text, status, flags) values (a.id, q.id, a.student_id, '', 'needs_review', array['timeout']) on conflict do nothing;
      a.cur_pos := a.cur_pos + 1; a.q_started_at := null; a.q_deadline := null; continue;
    end if;
    if a.q_started_at is null then
      a.q_started_at := nw; a.q_deadline := case when qsec is not null then nw + make_interval(secs => qsec) else null end;
      if a.deadline_at is not null and a.q_deadline is not null and a.q_deadline > a.deadline_at then a.q_deadline := a.deadline_at; end if;
    end if;
    exit;
  end loop;
  update ex_attempts set status = a.status, submitted_at = a.submitted_at, cur_pos = a.cur_pos, q_started_at = a.q_started_at, q_deadline = a.q_deadline where id = a.id;
  if a.status = 'finished' then
    return jsonb_build_object('status', 'finished', 'total', total, 'pos', a.cur_pos, 'server_now', nw);
  end if;
  return jsonb_build_object('status', 'in_progress', 'attempt_id', a.id, 'total', total, 'pos', a.cur_pos,
    'question', jsonb_build_object('id', q.id, 'stem', q.stem, 'options', q.options, 'multi', q.multi_select),
    'q_left_s', case when a.q_deadline is null then null else greatest(0, ceil(extract(epoch from a.q_deadline - nw)))::int end,
    'total_left_s', case when a.deadline_at is null then null else greatest(0, ceil(extract(epoch from a.deadline_at - nw)))::int end,
    'server_now', nw);
end $$;

-- (نسخة محدَّثة من ex_answer: ترفض الاختبار الحر)
create or replace function public.ex_answer(p_attempt bigint, p_question bigint, p_selected integer[], p_text text, p_signals jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public set row_security = off as $$
declare st jsonb; q ex_questions; a ex_attempts; sel integer[]; txt text := trim(coalesce(p_text, '')); sg jsonb := '{}'::jsonb; jid bigint; cs numeric; nlen integer;
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
  if length(txt) < 5 then raise exception 'اكتب تبريرك (5 أحرف على الأقل)'; end if;
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
  return jsonb_build_object('justification_id', jid, 'next', public.ex_state(p_attempt),
    'choice_correct', case when (select feedback_mode from ex_exams where id = q.exam_id) = 'immediate' then cs >= 1 else null end);
end $$;

revoke execute on function public.ex_free_finalize(bigint), public.ex_free_state(bigint) from public, anon, authenticated;
revoke execute on function public.ex_free_save(bigint, bigint, integer[], text, boolean, jsonb), public.ex_free_submit(bigint), public.ex_free_sweep(bigint) from public, anon;
grant execute on function public.ex_free_save(bigint, bigint, integer[], text, boolean, jsonb), public.ex_free_submit(bigint), public.ex_free_sweep(bigint) to authenticated;
select 'ready' as status;
