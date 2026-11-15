// Edge Function: grade-justification  (نظام هجين بلا تكلفة: قواعد ← نموذج مجاني للملتبس ← مراجعة المدرّس)
// استدعاء الطالب/المدرّس:  supabase.functions.invoke('grade-justification', { body: { justification_id } })
// استدعاء المجدوِل (pg_cron):  body { retry_pending: true } مع ترويسة x-cron-secret = CRON_SECRET
// الأسرار:  supabase secrets set LLM_API_KEY=...  CRON_SECRET=...    (الرابط والنموذج والحد اليومي في جدول ex_settings)
// SUPABASE_URL وSUPABASE_ANON_KEY وSUPABASE_SERVICE_ROLE_KEY تُحقن تلقائياً. لا يُرسل أي اسم أو رقم طالب للمزوّد.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { gradeCore, type LlmReply } from './scoring.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
// deno-lint-ignore no-explicit-any
type Db = any;

// مزوّد متوافق مع واجهة OpenAI (Gemini/Groq/OpenRouter...). الرابط الكامل لنقطة chat/completions.
async function callLlm(url: string, key: string, model: string, system: string, user: string): Promise<LlmReply> {
  const t0 = Date.now(), ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(url, { method: 'POST', signal: ctl.signal, headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 500, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
    const b = await r.json().catch(() => ({}));
    const msg = String(b?.error?.message || b?.error || '').slice(0, 250);
    if (!r.ok) return { ok: false, status: r.status, ms: Date.now() - t0, error: `http ${r.status}: ${msg}`, limited: r.status === 429 || r.status === 402 || /quota|rate.?limit|exhaust|resource/i.test(msg) };
    return { ok: true, status: r.status, ms: Date.now() - t0, text: String(b?.choices?.[0]?.message?.content || '') };
  } catch (e) { return { ok: false, ms: Date.now() - t0, error: String(e).slice(0, 250) }; }
  finally { clearTimeout(to); }
}

async function gradeOne(svc: Db, jid: number, st: Db, opt: { owner: boolean; cron: boolean }) {
  const { data: j } = await svc.from('ex_justifications').select('id, student_id, attempt_id, question_id, student_text, status, ai_tries').eq('id', jid).maybeSingle();
  if (!j) return { error: 'not_found' };
  // حجز ذري يمنع المعالجة المزدوجة. الطالب: pending فقط وبحد 3 محاولات؛ المجدوِل: حتى 8؛ المدرّس: حر.
  let claim = svc.from('ex_justifications').update({ ai_tries: (j.ai_tries || 0) + 1 }).eq('id', jid).eq('ai_tries', j.ai_tries || 0);
  if (opt.owner) claim = claim.eq('status', 'pending').lt('ai_tries', 3);
  if (opt.cron) claim = claim.eq('status', 'pending').lt('ai_tries', 8);
  const { data: claimed } = await claim.select('id');
  if (!claimed || !claimed.length) return { ok: true, status: j.status, skipped: 'already_graded_or_busy' };

  const [{ data: qr }, { data: rb }, { data: an }] = await Promise.all([
    svc.from('ex_questions').select('stem, options, correct_options, multi_select').eq('id', j.question_id).single(),
    svc.from('justification_rubrics').select('key_reasoning, concepts, max_score').eq('question_id', j.question_id).maybeSingle(),
    svc.from('ex_answers').select('selected_options, choice_score').eq('attempt_id', j.attempt_id).eq('question_id', j.question_id).maybeSingle(),
  ]);
  if (!qr || !an) return { error: 'missing_context' };

  // حدود النموذج الخارجي: يومي عام + لكل طالب في الساعة. تجاوزها لا يمنع القواعد؛ الملتبس يبقى pending.
  const key = Deno.env.get('LLM_API_KEY'), url = String(st?.llm_url || ''), model = String(st?.llm_model || '');
  const day0 = new Date(); day0.setUTCHours(0, 0, 0, 0);
  const { count: dayCnt } = await svc.from('ex_ai_calls').select('id', { count: 'exact', head: true }).gte('created_at', day0.toISOString()).not('provider', 'is', null);
  const { count: hrCnt } = await svc.from('ex_ai_calls').select('id', { count: 'exact', head: true }).eq('student_id', j.student_id).gte('created_at', new Date(Date.now() - 3600_000).toISOString()).not('provider', 'is', null);
  const configured = !!(key && url && model);
  const withinLimits = (dayCnt || 0) < Number(st?.daily_call_limit ?? 1000) && (hrCnt || 0) < Number(st?.per_student_hour ?? 60);
  let host = ''; try { host = new URL(url).host; } catch { /* رابط غير صالح: يُعامل كغير مُعدّ */ }
  const llmEnabled = configured && !!host;

  let skippedLimit = false;
  const out = await gradeCore(
    { q: { stem: qr.stem, options: qr.options, correct: qr.correct_options, multi: !!qr.multi_select }, selected: an.selected_options, choiceScore: Number(an.choice_score), text: String(j.student_text || ''),
      rb: rb ? { key_reasoning: rb.key_reasoning || '', concepts: Array.isArray(rb.concepts) ? rb.concepts : [] } : null, llmEnabled, max_score: rb?.max_score },
    async (system, user) => {
      if (!withinLimits) { skippedLimit = true; return { ok: false, limited: true, error: 'usage_limit' }; }
      return await callLlm(url, key!, model, system, user);
    });

  // سجل التدقيق لكل استدعاء خارجي (لا نص طالب ولا هوية، فقط المعرّف الداخلي)
  for (const c of out.calls) await svc.from('ex_ai_calls').insert({ justification_id: jid, student_id: j.student_id, provider: host, model, latency_ms: c.ms, ok: c.ok, status: c.status, error: c.error, cost_usd: 0 });
  if (skippedLimit) await svc.from('ex_ai_calls').insert({ justification_id: jid, student_id: j.student_id, provider: null, model, ok: false, status: 'skipped', error: 'usage_limit' });

  if (out.kind === 'pending') {
    await svc.from('ex_justifications').update({ ai_raw: { source: 'pending', reason: out.reason, ratio: out.ratio } }).eq('id', jid);
    return { ok: true, status: 'pending', reason: out.reason };
  }
  await svc.from('ex_justifications').update({ ai_score: out.contribution, ai_confidence: out.confidence, ai_feedback: out.feedback || null, matched_concepts: out.matched, ai_raw: out.raw, status: out.status, flags: out.flags, graded_at: new Date().toISOString() }).eq('id', jid);
  return { ok: true, status: out.status, source: out.source };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const URL_ = Deno.env.get('SUPABASE_URL')!, ANON = Deno.env.get('SUPABASE_ANON_KEY')!, SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const svc = createClient(URL_, SVC, { auth: { persistSession: false } });
    const { data: st } = await svc.from('ex_settings').select('*').eq('id', 1).single();

    // ── إعادة المحاولة المجدولة (pg_cron): لا تعتمد على مستخدم ──
    if (body.retry_pending === true) {
      const secret = Deno.env.get('CRON_SECRET') || '', got = req.headers.get('x-cron-secret') || '';
      if (!secret || got.length !== secret.length || ![...secret].every((c, i) => c === got[i])) return json({ error: 'unauthorized' }, 401);
      const old = new Date(Date.now() - 24 * 3600_000).toISOString();
      // معلّق طويلاً (يوم أو 8 محاولات) ← مراجعة المدرّس
      await svc.from('ex_justifications').update({ status: 'needs_review', flags: ['pending_too_long'] }).eq('status', 'pending').or(`created_at.lt.${old},ai_tries.gte.8`);
      const { data: rows } = await svc.from('ex_justifications').select('id').eq('status', 'pending').gte('ai_tries', 0).lt('created_at', new Date(Date.now() - 120_000).toISOString()).order('id').limit(20);
      let done = 0;
      for (const r of rows || []) { const x = await gradeOne(svc, r.id, st, { owner: false, cron: true }); if (x.status && x.status !== 'pending') done++; }
      return json({ ok: true, tried: (rows || []).length, graded: done });
    }

    const jid = Number(body.justification_id);
    if (!Number.isInteger(jid) || jid <= 0) return json({ error: 'bad_request' }, 400);
    const auth = req.headers.get('Authorization') || '';
    const userClient = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: 'unauthorized' }, 401);
    const { data: j } = await svc.from('ex_justifications').select('student_id').eq('id', jid).maybeSingle();
    if (!j) return json({ error: 'not_found' }, 404);
    const owner = j.student_id === u.user.id;
    if (!owner) { const { data: can } = await userClient.rpc('ex_can_manage_just', { p_just: jid }); if (can !== true) return json({ error: 'forbidden' }, 403); }
    return json(await gradeOne(svc, jid, st, { owner, cron: false }));
  } catch (e) {
    return json({ error: 'server_error', detail: String(e).slice(0, 200) }, 500);
  }
});
