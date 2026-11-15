-- الاختبارات: أسئلة اختيار من متعدد + تبرير نصي يُقيَّم بالذكاء الاصطناعي (دالة grade-justification).
-- يعمل بعد accounts.sql وsubadmin.sql. آمن لإعادة التشغيل. صلاحية المدرّس = أستاذ (professor) أو مسؤول يملك الصلاحية ex.
create extension if not exists pg_trgm with schema extensions;

-- ───── 1) الجداول ─────
create table if not exists public.ex_exams (
  id              bigint generated always as identity primary key,
  owner           uuid not null default auth.uid(),
  title           text not null check (length(trim(title)) between 1 and 200),
  description     text check (description is null or length(description) <= 2000),
  cohort_ids      integer[] not null default '{}',
  opens_at        timestamptz,
  closes_at       timestamptz,
  duration_min    integer check (duration_min is null or duration_min between 1 and 1440),   -- مدة كلية (اختياري)
  per_question_sec integer check (per_question_sec is null or per_question_sec between 10 and 7200), -- زمن كل سؤال (اختياري)
  choice_weight   numeric not null default 1 check (choice_weight >= 0),
  just_weight     numeric not null default 1 check (just_weight >= 0),
  feedback_mode   text not null default 'after_release' check (feedback_mode in ('after_release', 'immediate')),
  published       boolean not null default false,
  released        boolean not null default false,           -- إطلاق النتائج للطلبة
  created_at      timestamptz not null default now()
);
create table if not exists public.ex_questions (
  id              bigint generated always as identity primary key,
  exam_id         bigint not null references public.ex_exams(id) on delete cascade,
  pos             integer not null default 0,
  stem            text not null check (length(trim(stem)) between 1 and 4000),
  options         jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 10),
  correct_options integer[] not null check (array_length(correct_options, 1) >= 1),
  multi_select    boolean not null default false,
  category        text check (category is null or length(category) <= 100),
  time_sec        integer check (time_sec is null or time_sec between 10 and 7200)       -- يتجاوز زمن الاختبار العام
);
create index if not exists ex_questions_exam on public.ex_questions (exam_id, pos, id);
create table if not exists public.justification_rubrics (
  question_id        bigint primary key references public.ex_questions(id) on delete cascade,
  key_reasoning      text not null default '',
  required_concepts  text[] not null default '{}',
  max_score          numeric not null default 1
);
create table if not exists public.ex_attempts (
  id           bigint generated always as identity primary key,
  exam_id      bigint not null references public.ex_exams(id) on delete cascade,
  student_id   uuid not null references auth.users(id) on delete cascade,
  started_at   timestamptz not null default now(),
  deadline_at  timestamptz,
  cur_pos      integer not null default 0,
  q_started_at timestamptz,
  q_deadline   timestamptz,
  submitted_at timestamptz,
  status       text not null default 'in_progress' check (status in ('in_progress', 'finished')),
  unique (exam_id, student_id)
);
create table if not exists public.ex_answers (
  id               bigint generated always as identity primary key,
  attempt_id       bigint not null references public.ex_attempts(id) on delete cascade,
  question_id      bigint not null references public.ex_questions(id) on delete cascade,
  selected_options integer[] not null default '{}',
  answered_at      timestamptz not null default now(),
  choice_score     numeric not null default 0,                -- يحسبها الخادم، ولا يقرؤها الطالب
  unique (attempt_id, question_id)
);
create table if not exists public.ex_justifications (
  id                bigint generated always as identity primary key,
  attempt_id        bigint not null references public.ex_attempts(id) on delete cascade,
  question_id       bigint not null references public.ex_questions(id) on delete cascade,
  student_id        uuid not null references auth.users(id) on delete cascade,
  student_text      text not null default '' check (length(student_text) <= 600),
  ai_score          numeric check (ai_score is null or (ai_score >= 0 and ai_score <= 1)),   -- مساهمة التبرير بعد تطبيق القواعد (0..1)
  ai_raw            jsonb,                                                                    -- ما أعاده النموذج كما هو
  ai_confidence     numeric,
  ai_feedback       text,
  matched_concepts  text[] not null default '{}',
  status            text not null default 'pending' check (status in ('pending', 'graded', 'needs_review')),
  flags             text[] not null default '{}',
  instructor_score  numeric check (instructor_score is null or (instructor_score >= 0 and instructor_score <= 1)),
  instructor_note   text,
  approved          boolean not null default false,
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  signals           jsonb not null default '{}'::jsonb,       -- إشارات المراجعة (لصق، فقدان تركيز، سرعة ظهور النص)
  ai_tries          integer not null default 0,
  created_at        timestamptz not null default now(),
  graded_at         timestamptz,
  unique (attempt_id, question_id)
);
create index if not exists ex_just_status on public.ex_justifications (status, created_at);
create table if not exists public.ex_ai_calls (
  id             bigint generated always as identity primary key,
  justification_id bigint references public.ex_justifications(id) on delete set null,
  student_id     uuid,
  model          text,
  input_tokens   integer,
  output_tokens  integer,
  latency_ms     integer,
  cost_usd       numeric not null default 0,
  ok             boolean not null default true,
  error          text,
  created_at     timestamptz not null default now()
);
create index if not exists ex_ai_calls_time on public.ex_ai_calls (created_at);
create index if not exists ex_ai_calls_student on public.ex_ai_calls (student_id, created_at);
create table if not exists public.ex_settings (
  id                int primary key default 1 check (id = 1),
  monthly_cap_usd   numeric not null default 20,     -- سقف التكلفة الشهري
  per_student_hour  integer not null default 60,     -- أقصى استدعاءات للطالب في الساعة
  price_in_per_mtok  numeric not null default 3,     -- سعر المليون رمز دخل (دولار) لحساب التكلفة
  price_out_per_mtok numeric not null default 15     -- سعر المليون رمز خرج
);
insert into public.ex_settings (id) values (1) on conflict do nothing;


-- ───── 1ب) التصحيح الهجين المجاني: مفاهيم مع مرادفات + إعدادات المزوّد + سجل تدقيق ─────
alter table public.justification_rubrics add column if not exists concepts jsonb not null default '[]'::jsonb;   -- [{"k":"مفهوم","syn":["مرادف عربي","english synonym"]}]
alter table public.ex_settings add column if not exists llm_url text not null default '';                       -- رابط chat/completions المتوافق مع OpenAI (https فقط). المفتاح في supabase secrets وليس هنا
alter table public.ex_settings add column if not exists llm_model text not null default '';
alter table public.ex_settings add column if not exists daily_call_limit integer not null default 1000;
do $$ begin
  alter table public.ex_settings add constraint ex_settings_https check (llm_url = '' or llm_url ~ '^https://');
exception when duplicate_object then null; end $$;
alter table public.ex_ai_calls add column if not exists provider text;      -- مضيف المزوّد (null = تخطّي بسبب الحد)
alter table public.ex_ai_calls add column if not exists status text;        -- ok | rate_limited | invalid_json | error | skipped

-- ───── 2) الصلاحيات ─────
create or replace function public.ex_is_instructor() returns boolean
language sql stable security definer set search_path = public as $$
  select public.admin_can('ex') or public.current_user_role() = 'professor'
$$;
create or replace function public.ex_can_manage(p_exam bigint) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select public.admin_can('ex') or (public.current_user_role() = 'professor' and exists (select 1 from ex_exams e where e.id = p_exam and e.owner = auth.uid()))
$$;
create or replace function public.ex_can_manage_just(p_just bigint) returns boolean
language sql stable security definer set search_path = public set row_security = off as $$
  select exists (select 1 from ex_justifications j join ex_attempts a on a.id = j.attempt_id where j.id = p_just and public.ex_can_manage(a.exam_id))
$$;
grant execute on function public.ex_is_instructor(), public.ex_can_manage(bigint), public.ex_can_manage_just(bigint) to authenticated;

alter table public.ex_exams enable row level security;
alter table public.ex_questions enable row level security;
alter table public.justification_rubrics enable row level security;
alter table public.ex_attempts enable row level security;
alter table public.ex_answers enable row level security;
alter table public.ex_justifications enable row level security;
alter table public.ex_ai_calls enable row level security;
alter table public.ex_settings enable row level security;
revoke all on public.ex_exams, public.ex_questions, public.justification_rubrics, public.ex_attempts, public.ex_answers, public.ex_justifications, public.ex_ai_calls, public.ex_settings from anon, authenticated;

-- المدرّس: إدارة الاختبارات وأسئلتها ومعايير التصحيح (الطلبة لا يصلون إليها إطلاقاً)
drop policy if exists "ex exams mgr" on public.ex_exams;
create policy "ex exams mgr" on public.ex_exams for all to authenticated   -- شرط على الصف نفسه (لا استعلام فرعي) كي يعمل insert ... returning
  using (public.admin_can('ex') or (public.current_user_role() = 'professor' and owner = auth.uid()))
  with check (public.admin_can('ex') or (public.current_user_role() = 'professor' and owner = auth.uid()));
drop policy if exists "ex questions mgr" on public.ex_questions;
create policy "ex questions mgr" on public.ex_questions for all to authenticated using (public.ex_can_manage(exam_id)) with check (public.ex_can_manage(exam_id));
drop policy if exists "ex rubrics mgr" on public.justification_rubrics;
create policy "ex rubrics mgr" on public.justification_rubrics for all to authenticated
  using (exists (select 1 from ex_questions q where q.id = question_id and public.ex_can_manage(q.exam_id)))
  with check (exists (select 1 from ex_questions q where q.id = question_id and public.ex_can_manage(q.exam_id)));
grant select, insert, update, delete on public.ex_exams, public.ex_questions, public.justification_rubrics to authenticated;

-- الطالب: يقرأ صفوفه فقط، وبأعمدة محدودة (لا درجات ولا حالة ولا حقول المدرّس). الإدخال يتم فقط عبر ex_answer، ولا تحديث إطلاقاً.
drop policy if exists "ex attempts own" on public.ex_attempts;
create policy "ex attempts own" on public.ex_attempts for select to authenticated using (student_id = auth.uid());
drop policy if exists "ex answers own" on public.ex_answers;
create policy "ex answers own" on public.ex_answers for select to authenticated using (exists (select 1 from ex_attempts a where a.id = attempt_id and a.student_id = auth.uid()));
drop policy if exists "ex just own" on public.ex_justifications;
create policy "ex just own" on public.ex_justifications for select to authenticated using (student_id = auth.uid());
grant select on public.ex_attempts to authenticated;
grant select (id, attempt_id, question_id, selected_options, answered_at) on public.ex_answers to authenticated;
grant select (id, attempt_id, question_id, student_id, student_text, created_at) on public.ex_justifications to authenticated;
drop policy if exists "ex settings mgr" on public.ex_settings;
create policy "ex settings mgr" on public.ex_settings for all to authenticated using (public.admin_can('ex')) with check (public.admin_can('ex'));
grant select, update on public.ex_settings to authenticated;

-- حارس إضافي: لا إدخال ولا تعديل على التبريرات من العميل مباشرة (الخادم والدوال فقط)
create or replace function public.ex_just_guard() returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then raise exception 'not allowed'; end if;
  if tg_op = 'UPDATE' and (new.student_text is distinct from old.student_text or new.student_id <> old.student_id or new.attempt_id <> old.attempt_id or new.question_id <> old.question_id) then
    raise exception 'justification text is immutable';
  end if;
  return new;
end $$;
drop trigger if exists ex_just_guard_t on public.ex_justifications;
create trigger ex_just_guard_t before insert or update on public.ex_justifications for each row execute function public.ex_just_guard();

-- ───── 3) جهة الطالب ─────
create or replace function public.ex_choice_score(p_correct integer[], p_sel integer[], p_multi boolean) returns numeric
language sql immutable as $$
  select case when p_multi
      then greatest(0, (select count(*) from unnest(p_sel) x where x = any(p_correct)) - (select count(*) from unnest(p_sel) x where not x = any(p_correct)))::numeric / array_length(p_correct, 1)
      else case when (select array_agg(distinct x order by x) from unnest(p_sel) x) = (select array_agg(distinct x order by x) from unnest(p_correct) x) then 1 else 0 end end
$$;

-- يُحدّث حالة المحاولة (انتهاء المدة الكلية أو زمن السؤال) ثم يعيد السؤال الحالي دون الإجابة الصحيحة
create or replace function public.ex_state(p_attempt bigint) returns jsonb
language plpgsql security definer set search_path = public set row_security = off as $$
declare a ex_attempts; e ex_exams; q ex_questions; total integer; nw timestamptz := clock_timestamp(); qsec integer; n integer := 0;
begin
  select * into a from ex_attempts where id = p_attempt and student_id = auth.uid() for update;
  if not found then raise exception 'not found'; end if;
  select * into e from ex_exams where id = a.exam_id;
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

create or replace function public.ex_my_exams() returns jsonb
language sql stable security definer set search_path = public set row_security = off as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'description', e.description, 'opens_at', e.opens_at, 'closes_at', e.closes_at,
      'duration_min', e.duration_min, 'per_question_sec', e.per_question_sec,
      'questions', (select count(*) from ex_questions q where q.id is not null and q.exam_id = e.id),
      'attempt_id', a.id, 'attempt_status', a.status, 'released', e.released, 'feedback_mode', e.feedback_mode,
      'state', case when a.status = 'finished' then 'finished'
                    when e.closes_at is not null and now() > e.closes_at then 'closed'
                    when e.opens_at is not null and now() < e.opens_at then 'upcoming'
                    when a.id is not null then 'in_progress' else 'open' end
    ) order by coalesce(e.opens_at, e.created_at) desc), '[]'::jsonb)
  from ex_exams e
  left join ex_attempts a on a.exam_id = e.id and a.student_id = auth.uid()
  where e.published and exists (select 1 from comm_cohort_members m where m.user_id = auth.uid() and m.cohort_id = any(e.cohort_ids))
$$;

create or replace function public.ex_start(p_exam bigint) returns jsonb
language plpgsql security definer set search_path = public set row_security = off as $$
declare e ex_exams; a ex_attempts;
begin
  select * into e from ex_exams where id = p_exam and published;
  if not found or not exists (select 1 from comm_cohort_members m where m.user_id = auth.uid() and m.cohort_id = any(e.cohort_ids)) then raise exception 'الاختبار غير متاح لك'; end if;
  if e.opens_at is not null and now() < e.opens_at then raise exception 'لم يبدأ الاختبار بعد'; end if;
  if e.closes_at is not null and now() > e.closes_at then raise exception 'انتهى وقت الاختبار'; end if;
  if not exists (select 1 from ex_questions where exam_id = e.id) then raise exception 'الاختبار لا يحتوي أسئلة'; end if;
  select * into a from ex_attempts where exam_id = e.id and student_id = auth.uid();
  if not found then
    insert into ex_attempts (exam_id, student_id, deadline_at)
    values (e.id, auth.uid(), case when e.duration_min is null then null else now() + make_interval(mins => e.duration_min) end) returning * into a;
  end if;
  return public.ex_state(a.id);
end $$;

create or replace function public.ex_current(p_attempt bigint) returns jsonb
language sql security definer set search_path = public set row_security = off as $$ select public.ex_state(p_attempt) $$;

-- الإجابة: لا رجوع، مرة واحدة لكل سؤال، والتبرير إلزامي (5 إلى 600 حرفاً)
create or replace function public.ex_answer(p_attempt bigint, p_question bigint, p_selected integer[], p_text text, p_signals jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public set row_security = off as $$
declare st jsonb; q ex_questions; a ex_attempts; sel integer[]; txt text := trim(coalesce(p_text, '')); sg jsonb := '{}'::jsonb; jid bigint; cs numeric; nlen integer;
begin
  st := public.ex_state(p_attempt);
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

-- نتيجة الطالب: لا تظهر إلا بعد إطلاقها من المدرّس (أو في وضع الفوري بعد التسليم)
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
           'choice_score', an.choice_score, 'just_text', j.student_text,
           'just_score', case when coalesce(j.approved, false) then coalesce(j.instructor_score, j.ai_score, 0) end,
           'feedback', case when coalesce(j.approved, false) then coalesce(nullif(j.instructor_note, ''), j.ai_feedback) end,
           'pending', not coalesce(j.approved, false)) order by q.pos, q.id), '[]'::jsonb),
         coalesce(sum(an.choice_score), 0), coalesce(sum(case when j.approved then coalesce(j.instructor_score, j.ai_score, 0) else 0 end), 0)
    into rows, tc, tj
    from ex_questions q left join ex_answers an on an.question_id = q.id and an.attempt_id = a.id
    left join ex_justifications j on j.question_id = q.id and j.attempt_id = a.id where q.exam_id = p_exam;
  return jsonb_build_object('visible', true, 'status', a.status, 'rows', rows, 'choice_total', round(tc * e.choice_weight, 2), 'just_total', round(tj * e.just_weight, 2),
    'total', round(tc * e.choice_weight + tj * e.just_weight, 2), 'unreviewed', (select count(*) from ex_justifications j2 where j2.attempt_id = a.id and not j2.approved), 'max', round(n * (e.choice_weight + e.just_weight), 2));
end $$;

-- ───── 4) جهة المدرّس ─────
create or replace function public.ex_review_list(p_exam bigint, p_status text default null, p_q bigint default null, p_student text default null) returns jsonb
language plpgsql stable security definer set search_path = public, extensions set row_security = off as $$
begin
  if not public.ex_can_manage(p_exam) then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'status') = 'needs_review' desc, (x->>'id')::bigint) from (
    select jsonb_build_object('id', j.id, 'student', p.full_name, 'student_no', p.university_id, 'question_id', q.id, 'pos', q.pos, 'stem', q.stem, 'options', q.options,
        'multi', q.multi_select, 'correct', q.correct_options, 'selected', an.selected_options, 'choice_score', an.choice_score, 'text', j.student_text,
        'status', j.status, 'ai_score', j.ai_score, 'ai_confidence', j.ai_confidence, 'ai_feedback', j.ai_feedback, 'matched', j.matched_concepts, 'flags', j.flags,
        'ai_raw', j.ai_raw - 'feedback', 'instructor_score', j.instructor_score, 'instructor_note', j.instructor_note, 'approved', j.approved, 'signals', j.signals,
        'rubric', jsonb_build_object('key', r.key_reasoning, 'concepts', r.required_concepts, 'max', r.max_score),
        'similar', (select round(max(similarity(j.student_text, j2.student_text))::numeric, 2) from ex_justifications j2
                     where j2.question_id = j.question_id and j2.student_id <> j.student_id and length(j2.student_text) > 20 and length(j.student_text) > 20)) as x
    from ex_justifications j join ex_questions q on q.id = j.question_id join ex_attempts a on a.id = j.attempt_id
    left join ex_answers an on an.attempt_id = j.attempt_id and an.question_id = j.question_id
    left join justification_rubrics r on r.question_id = q.id left join profiles p on p.id = j.student_id
    where a.exam_id = p_exam and (p_status is null or j.status = p_status) and (p_q is null or q.id = p_q)
      and (p_student is null or p.full_name ilike '%' || p_student || '%' or p.university_id ilike '%' || p_student || '%')
    limit 1500) s), '[]'::jsonb);
end $$;

create or replace function public.ex_set_score(p_just bigint, p_score numeric, p_note text default null) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
begin
  if not public.ex_can_manage_just(p_just) then raise exception 'not allowed'; end if;
  if p_score is not null and (p_score < 0 or p_score > 1) then raise exception 'الدرجة من 0 إلى 1'; end if;
  update ex_justifications set instructor_score = p_score, instructor_note = nullif(trim(coalesce(p_note, '')), ''), status = 'graded',
         approved = true, reviewed_by = auth.uid(), reviewed_at = now() where id = p_just;
end $$;

create or replace function public.ex_approve(p_ids bigint[]) returns integer
language plpgsql security definer set search_path = public set row_security = off as $$
declare n integer;
begin
  with u as (update ex_justifications j set approved = true, status = case when j.status = 'needs_review' then 'graded' else j.status end, reviewed_by = auth.uid(), reviewed_at = now()
             where j.id = any(p_ids) and public.ex_can_manage_just(j.id) and j.status <> 'pending' returning 1) select count(*) into n from u;
  return n;
end $$;

create or replace function public.ex_bulk_approve(p_exam bigint) returns integer
language plpgsql security definer set search_path = public set row_security = off as $$
declare n integer;
begin
  if not public.ex_can_manage(p_exam) then raise exception 'not allowed'; end if;
  with u as (update ex_justifications j set approved = true, reviewed_by = auth.uid(), reviewed_at = now()
             from ex_attempts a where a.id = j.attempt_id and a.exam_id = p_exam and j.status = 'graded' and not j.approved and cardinality(j.flags) = 0 returning 1) select count(*) into n from u;
  return n;
end $$;

create or replace function public.ex_pending_ids(p_exam bigint) returns bigint[]
language plpgsql stable security definer set search_path = public set row_security = off as $$
begin
  if not public.ex_can_manage(p_exam) then raise exception 'not allowed'; end if;
  return coalesce((select array_agg(j.id) from ex_justifications j join ex_attempts a on a.id = j.attempt_id where a.exam_id = p_exam and j.status = 'pending' and length(j.student_text) >= 5), '{}');
end $$;

create or replace function public.ex_results_table(p_exam bigint) returns jsonb
language plpgsql stable security definer set search_path = public set row_security = off as $$
declare e ex_exams; n integer;
begin
  if not public.ex_can_manage(p_exam) then raise exception 'not allowed'; end if;
  select * into e from ex_exams where id = p_exam; select count(*) into n from ex_questions where exam_id = p_exam;
  return coalesce((select jsonb_agg(jsonb_build_object('student', p.full_name, 'student_no', p.university_id, 'status', a.status,
      'answered', (select count(*) from ex_answers an where an.attempt_id = a.id),
      'choice', round(coalesce((select sum(an.choice_score) from ex_answers an where an.attempt_id = a.id), 0) * e.choice_weight, 2),
      'just', round(coalesce((select sum(coalesce(j.instructor_score, j.ai_score, 0)) from ex_justifications j where j.attempt_id = a.id), 0) * e.just_weight, 2),
      'review', (select count(*) from ex_justifications j where j.attempt_id = a.id and j.status in ('needs_review', 'pending') and not j.approved),
      'max', round(n * (e.choice_weight + e.just_weight), 2)) order by p.full_name)
    from ex_attempts a left join profiles p on p.id = a.student_id where a.exam_id = p_exam), '[]'::jsonb);
end $$;

create or replace function public.ex_ai_usage() returns jsonb
language sql stable security definer set search_path = public set row_security = off as $$
  select case when public.ex_is_instructor() then jsonb_build_object(
    'today_calls', (select count(*) from ex_ai_calls where provider is not null and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
    'daily_limit', (select daily_call_limit from ex_settings where id = 1),
    'configured', (select llm_url <> '' and llm_model <> '' from ex_settings where id = 1),
    'pending', (select count(*) from ex_justifications where status = 'pending'),
    'failed_today', (select count(*) from ex_ai_calls where not ok and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc')) else null end
$$;

revoke execute on function public.ex_state(bigint), public.ex_choice_score(integer[], integer[], boolean) from public, anon, authenticated;
revoke execute on function public.ex_my_exams(), public.ex_start(bigint), public.ex_current(bigint), public.ex_answer(bigint, bigint, integer[], text, jsonb), public.ex_my_results(bigint),
  public.ex_review_list(bigint, text, bigint, text), public.ex_set_score(bigint, numeric, text), public.ex_approve(bigint[]), public.ex_bulk_approve(bigint), public.ex_pending_ids(bigint),
  public.ex_results_table(bigint), public.ex_ai_usage() from public, anon;
grant execute on function public.ex_my_exams(), public.ex_start(bigint), public.ex_current(bigint), public.ex_answer(bigint, bigint, integer[], text, jsonb), public.ex_my_results(bigint),
  public.ex_review_list(bigint, text, bigint, text), public.ex_set_score(bigint, numeric, text), public.ex_approve(bigint[]), public.ex_bulk_approve(bigint), public.ex_pending_ids(bigint),
  public.ex_results_table(bigint), public.ex_ai_usage() to authenticated;

-- ───── اختياري: إعادة محاولة المعلّق تلقائياً كل 10 دقائق (pg_cron + pg_net) ─────
-- 1) فعّل الإضافتين من Database ← Extensions: pg_cron وpg_net. 2) ضع CRON_SECRET في supabase secrets (نص عشوائي طويل من اختيارك، وليس مفتاح الخدمة).
-- 3) أزل التعليق عن الأمر التالي وبدّل القيمتين:
-- select cron.schedule('ex-regrade-pending', '*/10 * * * *', $cron$
--   select net.http_post(url := 'https://kfxclzkmuugadkiuwvdp.supabase.co/functions/v1/grade-justification',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'ضع_CRON_SECRET_هنا'),
--     body := '{"retry_pending": true}'::jsonb) $cron$);
-- ملاحظة: تحتاج الدالة إلى تعطيل «Verify JWT» لهذا الاستدعاء: supabase functions deploy grade-justification --no-verify-jwt (التحقق من المستخدم يتم داخل الدالة نفسها).

select 'ready' as status;
