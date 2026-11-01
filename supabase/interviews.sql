-- المقابلات: لجنة مقيّمين، معايير وأوزان قابلة للتعديل، درجة نهائية تُعرض للمرشح فوراً أو بعد اعتماد الإدارة.
-- شغّله بعد subadmin.sql (ملف واحد في SQL Editor). الصلاحية: المسؤول الرئيسي أو مسؤول فرعي يملك «المقابلات».
create table if not exists public.iv_sessions (
  id bigint generated always as identity primary key,
  title text not null check (length(trim(title)) between 1 and 160),
  notes text check (notes is null or length(notes) <= 1000),
  criteria jsonb not null default '[]'::jsonb check (jsonb_typeof(criteria) = 'array'),
  release_mode text not null default 'admin' check (release_mode in ('auto', 'admin')),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);
create table if not exists public.iv_evaluators (
  session_id bigint not null references public.iv_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (session_id, user_id)
);
create table if not exists public.iv_entrants (
  session_id bigint not null references public.iv_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (session_id, user_id)
);
create table if not exists public.iv_candidates (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.iv_sessions(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 120),
  obj jsonb not null default '{}'::jsonb,
  released boolean not null default false,
  released_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists iv_cand_user_uq on public.iv_candidates (session_id, user_id) where user_id is not null;
create table if not exists public.iv_scores (
  cand_id bigint not null references public.iv_candidates(id) on delete cascade,
  evaluator_id uuid not null references auth.users(id) on delete cascade,
  scores jsonb not null default '{}'::jsonb,
  comment text check (comment is null or length(comment) <= 1000),
  submitted boolean not null default false,
  submitted_at timestamptz,
  primary key (cand_id, evaluator_id)
);
alter table public.iv_sessions add column if not exists iv_date date;
alter table public.iv_sessions add column if not exists iv_time time;
alter table public.iv_sessions add column if not exists iv_min int not null default 0 check (iv_min between 0 and 50);
alter table public.iv_sessions enable row level security;
alter table public.iv_evaluators enable row level security;
alter table public.iv_entrants enable row level security;
alter table public.iv_candidates enable row level security;
alter table public.iv_scores enable row level security;
revoke all on public.iv_sessions, public.iv_entrants, public.iv_evaluators, public.iv_candidates, public.iv_scores from anon, authenticated;

-- المعايير الافتراضية (من نموذج المعايير والأوزان)
create or replace function public.iv_default_criteria() returns jsonb language sql immutable as $$
  select '[
   {"id":"c1","name":"المؤهل العلمي (البكالوريوس)","type":"obj","weight":10,"calc":"degree","method":"تُدخل نسبة المؤهل من 100 وتُحوَّل إلى الدرجة حسب الوزن"},
   {"id":"c2","name":"المؤهل العلمي (الماجستير)","type":"obj","weight":10,"calc":"degree","method":"تُدخل نسبة المؤهل من 100 وتُحوَّل إلى الدرجة حسب الوزن"},
   {"id":"c3","name":"الخبرة التدريسية الجامعية","type":"obj","weight":5,"calc":"years","cap":10,"method":"تُدخل عدد السنوات وتُحوَّل إلى الدرجة حسب الوزن (10 سنوات فأكثر = الدرجة كاملة)"},
   {"id":"c4","name":"الخبرة في كلية فلسطين","type":"obj","weight":5,"calc":"years","cap":10,"method":"تُدخل عدد السنوات وتُحوَّل إلى الدرجة حسب الوزن (10 سنوات فأكثر = الدرجة كاملة)"},
   {"id":"c10","name":"مرشح دكتوراه","type":"obj","weight":3,"calc":"flag","method":"3 درجات لمن هو مرشح دكتوراه (نعم/لا) — الوزن قابل للتعديل"},
   {"id":"c5","name":"خطة الموظف","type":"com","weight":20,"method":"عرض خطة موحدة المدة: واقعيتها، قابليتها للقياس، ارتباطها باحتياجات القسم"},
   {"id":"c6","name":"القيادة والتواصل وإدارة الفريق","type":"com","weight":20,"method":"أسئلة سلوكية موحدة عن مواقف قيادية فعلية، مع طلب أمثلة وأدلة"},
   {"id":"c7","name":"حل المشكلات (دراسة حالة موحدة)","type":"com","weight":10,"method":"حالة واحدة لجميع المتقدمين: جودة التحليل والقرار المقترح"},
   {"id":"c8","name":"المرجعيات والنزاهة والالتزام المؤسسي","type":"com","weight":10,"method":"التحقق من المرجعيات والسجل المهني والالتزام بالأنظمة"},
   {"id":"c9","name":"الملاءمة للتخصص واحتياجات القسم","type":"com","weight":10,"method":"مدى انسجام تخصص المتقدم وخبرته مع أولويات القسم"}]'::jsonb $$;

-- تحقق من المعايير
create or replace function public.iv_check_criteria(p jsonb) returns jsonb language plpgsql immutable as $$
declare c jsonb; ids text[] := '{}'; w numeric; out jsonb := '[]'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0 or jsonb_array_length(p) > 40 then raise exception 'bad criteria'; end if;
  for c in select * from jsonb_array_elements(p) loop
    if coalesce(c ->> 'id', '') !~ '^[A-Za-z0-9_]{1,20}$' or (c ->> 'id') = any (ids) then raise exception 'bad criteria id'; end if;
    ids := ids || (c ->> 'id');
    if coalesce(c ->> 'type', '') not in ('obj', 'com') then raise exception 'bad criteria type'; end if;
    begin w := (c ->> 'weight')::numeric; exception when others then raise exception 'bad weight'; end;
    if w is null or w < 0 or w > 1000 then raise exception 'bad weight'; end if;
    if length(trim(coalesce(c ->> 'name', ''))) = 0 or length(c ->> 'name') > 160 or length(coalesce(c ->> 'method', '')) > 400 then raise exception 'bad criteria text'; end if;
    out := out || jsonb_build_object('id', c ->> 'id', 'name', trim(c ->> 'name'), 'type', c ->> 'type', 'weight', w, 'calc', case when (c ->> 'calc') in ('degree', 'years', 'flag') then c ->> 'calc' else null end, 'cap', case when (c ->> 'calc') = 'years' then least(greatest(coalesce(nullif(c ->> 'cap', '')::numeric, 10), 1), 100) else null end, 'method', nullif(trim(coalesce(c ->> 'method', '')), ''));
  end loop;
  return out;
end $$;

-- حساب الدرجة النهائية لمرشح (يُستخدم داخلياً فقط)
create or replace function public.iv_calc(p_cand bigint) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s iv_sessions; k iv_candidates; c jsonb; neval int; nsub int; avg_pts numeric; pts numeric; wsum numeric := 0; total numeric := 0; rows jsonb := '[]'::jsonb; w numeric; have boolean;
begin
  select * into k from iv_candidates where id = p_cand; if not found then return null; end if;
  select * into s from iv_sessions where id = k.session_id;
  select count(*) into neval from iv_evaluators where session_id = s.id;
  select count(*) into nsub from iv_scores sc join iv_evaluators e on e.session_id = s.id and e.user_id = sc.evaluator_id where sc.cand_id = p_cand and sc.submitted;
  for c in select * from jsonb_array_elements(s.criteria) loop
    w := (c ->> 'weight')::numeric; wsum := wsum + w; pts := null;
    if c ->> 'type' = 'obj' then
      if k.obj ? (c ->> 'id') then
        pts := greatest((k.obj ->> (c ->> 'id'))::numeric, 0);
        if c ->> 'calc' = 'degree' then pts := least(pts, 100) / 100 * w;
        elsif c ->> 'calc' = 'years' then pts := least(pts / coalesce(nullif(c ->> 'cap', '')::numeric, 10), 1) * w;
        elsif c ->> 'calc' = 'flag' then pts := least(pts, 1) * w;
        else pts := least(pts, w); end if;
      end if;
    elsif nsub > 0 then
      select avg(least(greatest((sc.scores ->> (c ->> 'id'))::numeric, 0), w)) into pts from iv_scores sc join iv_evaluators e on e.session_id = s.id and e.user_id = sc.evaluator_id
        where sc.cand_id = p_cand and sc.submitted and sc.scores ? (c ->> 'id');
    end if;
    total := total + coalesce(pts, 0);
    rows := rows || jsonb_build_object('id', c ->> 'id', 'name', c ->> 'name', 'type', c ->> 'type', 'weight', w, 'points', case when pts is null then null else round(pts, 2) end);
  end loop;
  return jsonb_build_object('total', round(total, 2), 'max', wsum, 'final', case when wsum > 0 then round(total / wsum * 100, 2) else null end,
    'rows', rows, 'neval', neval, 'nsub', nsub, 'complete', (neval > 0 and nsub >= case when s.iv_min > 0 then least(s.iv_min, neval) else neval end));
end $$;

create or replace function public.iv_visible(p_cand bigint) returns boolean language sql stable security definer set search_path = public as $$
  select k.released or (s.release_mode = 'auto' and (public.iv_calc(k.id) ->> 'complete')::boolean)
  from iv_candidates k join iv_sessions s on s.id = k.session_id where k.id = p_cand $$;

-- أدواري: إدارة / مقيّم / مرشح
create or replace function public.iv_roles() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('manage', public.admin_can('iv'),
    'evaluator', exists (select 1 from iv_evaluators where user_id = auth.uid()),
    'entrant', exists (select 1 from iv_entrants where user_id = auth.uid()),
    'candidate', exists (select 1 from iv_candidates where user_id = auth.uid())) $$;

-- ===== الإدارة =====
create or replace function public.iv_staff_list() returns table (id uuid, full_name text, role text) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can('iv') then raise exception 'admin only'; end if;
  return query select p.id, p.full_name, p.role::text from profiles p where p.role::text in ('admin', 'professor', 'staff') order by p.full_name;
end $$;

create or replace function public.iv_admin_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can('iv') then raise exception 'admin only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'status', s.status, 'release_mode', s.release_mode, 'iv_date', s.iv_date, 'iv_time', s.iv_time,
    'candidates', (select count(*) from iv_candidates k where k.session_id = s.id), 'evaluators', (select count(*) from iv_evaluators e where e.session_id = s.id)) order by s.id desc) from iv_sessions s), '[]'::jsonb);
end $$;

drop function if exists public.iv_session_save(bigint, text, text, jsonb, text, text);
drop function if exists public.iv_session_save(bigint, text, text, jsonb, text, text, date, time);
create or replace function public.iv_session_save(p_id bigint, p_title text, p_notes text, p_criteria jsonb, p_mode text, p_status text, p_date date default null, p_time time default null, p_min int default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare nid bigint; cr jsonb;
begin
  if not public.admin_can('iv') then raise exception 'admin only'; end if;
  cr := iv_check_criteria(coalesce(p_criteria, iv_default_criteria()));
  if p_id is null then
    insert into iv_sessions (title, notes, criteria, release_mode, status, iv_date, iv_time, iv_min) values (trim(p_title), nullif(trim(coalesce(p_notes, '')), ''), cr, coalesce(p_mode, 'admin'), 'open', p_date, p_time, coalesce(p_min, 0)) returning id into nid;
  else
    update iv_sessions set title = trim(p_title), notes = nullif(trim(coalesce(p_notes, '')), ''), criteria = cr, release_mode = coalesce(p_mode, release_mode), status = coalesce(p_status, status),
      iv_date = coalesce(p_date, iv_date), iv_time = coalesce(p_time, iv_time), iv_min = coalesce(p_min, iv_min) where id = p_id returning id into nid;
  end if;
  return nid;
end $$;

create or replace function public.iv_session_delete(p_id bigint) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('iv') then raise exception 'admin only'; end if;
  delete from iv_sessions where id = p_id;
end $$;

create or replace function public.iv_set_evaluators(p_session bigint, p_users uuid[]) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('iv') then raise exception 'admin only'; end if;
  if exists (select 1 from iv_candidates where session_id = p_session and user_id = any (coalesce(p_users, '{}'))) then raise exception 'candidate cannot be an evaluator'; end if;
  if exists (select 1 from iv_entrants where session_id = p_session and user_id = any (coalesce(p_users, '{}'))) then raise exception 'entrant cannot be an evaluator'; end if;
  delete from iv_evaluators where session_id = p_session and not (user_id = any (coalesce(p_users, '{}')));
  insert into iv_evaluators (session_id, user_id) select p_session, u from unnest(coalesce(p_users, '{}')) u
    where exists (select 1 from profiles where id = u and role::text in ('admin', 'professor', 'staff')) on conflict do nothing;
end $$;

create or replace function public.iv_cand_add(p_session bigint, p_user uuid, p_name text default null) returns bigint language plpgsql security definer set search_path = public as $$
declare nm text; nid bigint;
begin
  if not public.admin_can('iv') then raise exception 'admin only'; end if;
  if p_user is not null then
    if exists (select 1 from iv_evaluators where session_id = p_session and user_id = p_user) then raise exception 'evaluator cannot be a candidate'; end if;
    if exists (select 1 from iv_entrants where session_id = p_session and user_id = p_user) then raise exception 'entrant cannot be a candidate'; end if;
    select full_name into nm from profiles where id = p_user;
  end if;
  nm := coalesce(nullif(trim(coalesce(p_name, '')), ''), nm);
  if nm is null then raise exception 'name required'; end if;
  insert into iv_candidates (session_id, user_id, name) values (p_session, p_user, nm) returning id into nid;
  return nid;
end $$;

create or replace function public.iv_cand_delete(p_cand bigint) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('iv') then raise exception 'admin only'; end if;
  delete from iv_candidates where id = p_cand;
end $$;

create or replace function public.iv_obj_apply(p_cand bigint, p_obj jsonb) returns void language plpgsql security definer set search_path = public as $$
declare k text; clean jsonb := '{}'::jsonb; v numeric;
begin
  for k in select jsonb_object_keys(coalesce(p_obj, '{}')) loop
    if not exists (select 1 from iv_candidates c join iv_sessions s on s.id = c.session_id, jsonb_array_elements(s.criteria) e where c.id = p_cand and e ->> 'id' = k and e ->> 'type' = 'obj') then continue; end if;
    begin v := (p_obj ->> k)::numeric; exception when others then continue; end;
    if v is not null and v >= 0 and v <= 1000 then clean := clean || jsonb_build_object(k, v); end if;
  end loop;
  update iv_candidates set obj = clean where id = p_cand;
end $$;

create or replace function public.iv_cand_obj(p_cand bigint, p_obj jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('iv') then raise exception 'admin only'; end if;
  perform public.iv_obj_apply(p_cand, p_obj);
end $$;

-- مُدخلو البيانات الموضوعية: يُدخلون المعايير الموضوعية فقط، ولا يقيّمون ولا يدخلون في المتوسط
create or replace function public.iv_set_entrants(p_session bigint, p_users uuid[]) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('iv') then raise exception 'admin only'; end if;
  if exists (select 1 from iv_candidates where session_id = p_session and user_id = any (coalesce(p_users, '{}'))) then raise exception 'candidate cannot be an entrant'; end if;
  if exists (select 1 from iv_evaluators where session_id = p_session and user_id = any (coalesce(p_users, '{}'))) then raise exception 'evaluator cannot be an entrant'; end if;
  delete from iv_entrants where session_id = p_session and not (user_id = any (coalesce(p_users, '{}')));
  insert into iv_entrants (session_id, user_id) select p_session, u from unnest(coalesce(p_users, '{}')) u
    where exists (select 1 from profiles where id = u and role::text in ('admin', 'professor', 'staff')) on conflict do nothing;
end $$;

create or replace function public.iv_my_entry() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'status', s.status, 'iv_date', s.iv_date, 'iv_time', s.iv_time,
      'criteria', (select coalesce(jsonb_agg(c), '[]'::jsonb) from jsonb_array_elements(s.criteria) c where c ->> 'type' = 'obj'),
      'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'obj', k.obj) order by k.id) from iv_candidates k where k.session_id = s.id), '[]'::jsonb)) order by s.id desc)
    from iv_sessions s join iv_entrants e on e.session_id = s.id and e.user_id = auth.uid()), '[]'::jsonb);
end $$;

create or replace function public.iv_entry_save(p_cand bigint, p_obj jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare s iv_sessions;
begin
  select s2.* into s from iv_sessions s2 join iv_candidates k on k.session_id = s2.id where k.id = p_cand;
  if s.id is null or not exists (select 1 from iv_entrants where session_id = s.id and user_id = auth.uid()) then return jsonb_build_object('ok', false, 'err', 'notmember'); end if;
  if s.status <> 'open' then return jsonb_build_object('ok', false, 'err', 'closed'); end if;
  perform public.iv_obj_apply(p_cand, p_obj);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.iv_release(p_cand bigint, p_on boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('iv') then raise exception 'admin only'; end if;
  update iv_candidates set released = p_on, released_at = case when p_on then now() else null end where id = p_cand;
end $$;

create or replace function public.iv_reopen(p_cand bigint, p_evaluator uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can('iv') then raise exception 'admin only'; end if;
  update iv_scores set submitted = false, submitted_at = null where cand_id = p_cand and evaluator_id = p_evaluator;
end $$;

create or replace function public.iv_admin_detail(p_session bigint) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s iv_sessions;
begin
  if not public.admin_can('iv') then raise exception 'admin only'; end if;
  select * into s from iv_sessions where id = p_session; if not found then return null; end if;
  return jsonb_build_object('session', to_jsonb(s),
    'entrants', coalesce((select jsonb_agg(jsonb_build_object('user_id', n.user_id, 'name', coalesce(p.full_name, '—'))) from iv_entrants n left join profiles p on p.id = n.user_id where n.session_id = p_session), '[]'::jsonb),
    'evaluators', coalesce((select jsonb_agg(jsonb_build_object('user_id', e.user_id, 'name', coalesce(p.full_name, '—')) order by p.full_name) from iv_evaluators e left join profiles p on p.id = e.user_id where e.session_id = p_session), '[]'::jsonb),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'user_id', k.user_id, 'name', k.name, 'obj', k.obj, 'released', k.released, 'visible', public.iv_visible(k.id), 'calc', public.iv_calc(k.id),
        'evals', coalesce((select jsonb_agg(jsonb_build_object('evaluator_id', e.user_id, 'name', coalesce(p.full_name, '—'), 'scores', coalesce(sc.scores, '{}'::jsonb), 'comment', sc.comment, 'submitted', coalesce(sc.submitted, false)) order by p.full_name)
          from iv_evaluators e left join profiles p on p.id = e.user_id left join iv_scores sc on sc.cand_id = k.id and sc.evaluator_id = e.user_id where e.session_id = p_session), '[]'::jsonb)) order by k.id)
      from iv_candidates k where k.session_id = p_session), '[]'::jsonb));
end $$;

-- ===== المقيّم =====
create or replace function public.iv_my_eval() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'notes', s.notes, 'status', s.status, 'iv_date', s.iv_date, 'iv_time', s.iv_time,
      'criteria', (select coalesce(jsonb_agg(c), '[]'::jsonb) from jsonb_array_elements(s.criteria) c where c ->> 'type' = 'com'),
      'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'scores', coalesce(sc.scores, '{}'::jsonb), 'comment', sc.comment, 'submitted', coalesce(sc.submitted, false)) order by k.id)
        from iv_candidates k left join iv_scores sc on sc.cand_id = k.id and sc.evaluator_id = auth.uid() where k.session_id = s.id), '[]'::jsonb)) order by s.id desc)
    from iv_sessions s join iv_evaluators e on e.session_id = s.id and e.user_id = auth.uid()), '[]'::jsonb);
end $$;

create or replace function public.iv_eval_save(p_cand bigint, p_scores jsonb, p_comment text, p_submit boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s iv_sessions; k iv_candidates; sc iv_scores; c jsonb; clean jsonb := '{}'::jsonb; v numeric; w numeric; missing text := '';
begin
  select * into k from iv_candidates where id = p_cand; if not found then return jsonb_build_object('ok', false, 'err', 'nocand'); end if;
  select * into s from iv_sessions where id = k.session_id;
  if not exists (select 1 from iv_evaluators where session_id = s.id and user_id = auth.uid()) then return jsonb_build_object('ok', false, 'err', 'notmember'); end if;
  if s.status <> 'open' then return jsonb_build_object('ok', false, 'err', 'closed'); end if;
  select * into sc from iv_scores where cand_id = p_cand and evaluator_id = auth.uid();
  if found and sc.submitted then return jsonb_build_object('ok', false, 'err', 'submitted'); end if;
  for c in select * from jsonb_array_elements(s.criteria) where value ->> 'type' = 'com' loop
    w := (c ->> 'weight')::numeric;
    if p_scores ? (c ->> 'id') and jsonb_typeof(p_scores -> (c ->> 'id')) = 'number' then
      v := (p_scores ->> (c ->> 'id'))::numeric;
      if v < 0 or v > w then return jsonb_build_object('ok', false, 'err', 'range', 'name', c ->> 'name', 'max', w); end if;
      clean := clean || jsonb_build_object(c ->> 'id', v);
    elsif p_submit then missing := c ->> 'name'; end if;
  end loop;
  if p_submit and missing <> '' then return jsonb_build_object('ok', false, 'err', 'missing', 'name', missing); end if;
  insert into iv_scores (cand_id, evaluator_id, scores, comment, submitted, submitted_at)
    values (p_cand, auth.uid(), clean, nullif(left(trim(coalesce(p_comment, '')), 1000), ''), coalesce(p_submit, false), case when p_submit then now() end)
    on conflict (cand_id, evaluator_id) do update set scores = excluded.scores, comment = excluded.comment, submitted = excluded.submitted, submitted_at = excluded.submitted_at;
  return jsonb_build_object('ok', true);
end $$;

-- ===== المرشح: نتائجي =====
create or replace function public.iv_my_results() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := '[]'::jsonb; k record; cj jsonb;
begin
  for k in select c.id, s.title, s.iv_date as d, s.iv_time as t, public.iv_visible(c.id) as vis from iv_candidates c join iv_sessions s on s.id = c.session_id where c.user_id = auth.uid() order by c.id desc loop
    if k.vis then cj := public.iv_calc(k.id); r := r || jsonb_build_object('title', k.title, 'iv_date', k.d, 'iv_time', k.t, 'visible', true, 'final', cj -> 'final', 'total', cj -> 'total', 'max', cj -> 'max', 'rows', cj -> 'rows');
    else r := r || jsonb_build_object('title', k.title, 'iv_date', k.d, 'iv_time', k.t, 'visible', false); end if;
  end loop;
  return r;
end $$;

-- الصلاحيات
revoke execute on function public.iv_obj_apply(bigint, jsonb), public.iv_default_criteria(), public.iv_check_criteria(jsonb), public.iv_calc(bigint), public.iv_visible(bigint) from public, anon, authenticated;
revoke execute on function public.iv_roles(), public.iv_staff_list(), public.iv_admin_list(), public.iv_session_save(bigint, text, text, jsonb, text, text, date, time, int), public.iv_session_delete(bigint),
  public.iv_set_evaluators(bigint, uuid[]), public.iv_cand_add(bigint, uuid, text), public.iv_cand_delete(bigint), public.iv_cand_obj(bigint, jsonb), public.iv_release(bigint, boolean),
  public.iv_reopen(bigint, uuid), public.iv_admin_detail(bigint), public.iv_my_eval(), public.iv_eval_save(bigint, jsonb, text, boolean), public.iv_my_results(),
  public.iv_set_entrants(bigint, uuid[]), public.iv_my_entry(), public.iv_entry_save(bigint, jsonb) from public, anon;
grant execute on function public.iv_roles(), public.iv_staff_list(), public.iv_admin_list(), public.iv_session_save(bigint, text, text, jsonb, text, text, date, time, int), public.iv_session_delete(bigint),
  public.iv_set_evaluators(bigint, uuid[]), public.iv_cand_add(bigint, uuid, text), public.iv_cand_delete(bigint), public.iv_cand_obj(bigint, jsonb), public.iv_release(bigint, boolean),
  public.iv_reopen(bigint, uuid), public.iv_admin_detail(bigint), public.iv_my_eval(), public.iv_eval_save(bigint, jsonb, text, boolean), public.iv_my_results(),
  public.iv_set_entrants(bigint, uuid[]), public.iv_my_entry(), public.iv_entry_save(bigint, jsonb) to authenticated;
select 'ready' as status;
