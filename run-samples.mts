// تشغيل العيّنات العشر بنموذجك المجاني الحقيقي (الحالات الواضحة تُصحَّح بالقواعد ولا تستهلك أي استدعاء).
// الاستخدام (Node 22+):
//   LLM_URL=https://.../chat/completions LLM_MODEL=اسم_النموذج LLM_API_KEY=مفتاحك node --experimental-strip-types --no-warnings run-samples.mts
// المفتاح يبقى في جهازك فقط. بدون LLM_URL تُصحَّح الحالات الواضحة وتُحوَّل الملتبسة للمراجعة.
import { gradeCore, type LlmReply } from './scoring.ts';
import { readFileSync } from 'node:fs';
const samples = JSON.parse(readFileSync(new URL('./samples.json', import.meta.url), 'utf8'));
const { LLM_URL, LLM_MODEL, LLM_API_KEY } = process.env;
const q = { stem: 'Which drug controls postpartum haemorrhage?', options: ['Antihypertensive', 'Oxytocin', 'Antibiotic'], correct: [1], multi: false };
const rb = { key_reasoning: 'Oxytocin causes uterine contraction and reduces postpartum bleeding.', concepts: [
  { k: 'uterine contraction', syn: ['uterine contractions', 'uterus contracts', 'contract the uterus', 'انقباض الرحم', 'انقباضات الرحم', 'تقلص الرحم'] },
  { k: 'postpartum bleeding control', syn: ['postpartum bleeding', 'postpartum haemorrhage', 'postpartum hemorrhage', 'pph', 'bleeding', 'النزف بعد الولادة', 'يوقف النزف', 'نزف ما بعد الولادة'] }] };
const call = async (system: string, user: string): Promise<LlmReply> => {
  const t0 = Date.now();
  try {
    const r = await fetch(LLM_URL!, { method: 'POST', headers: { Authorization: `Bearer ${LLM_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: LLM_MODEL, temperature: 0, max_tokens: 500, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
    const b: any = await r.json().catch(() => ({})); const msg = String(b?.error?.message || '');
    if (!r.ok) return { ok: false, ms: Date.now() - t0, error: `http ${r.status} ${msg}`, limited: r.status === 429 || r.status === 402 || /quota|rate/i.test(msg) };
    return { ok: true, ms: Date.now() - t0, text: String(b?.choices?.[0]?.message?.content || '') };
  } catch (e) { return { ok: false, ms: Date.now() - t0, error: String(e) }; }
};
for (const s of samples) {
  const o: any = await gradeCore({ q, selected: s.selected, choiceScore: s.choice_correct ? 1 : 0, text: s.text, rb, llmEnabled: !!(LLM_URL && LLM_MODEL && LLM_API_KEY) }, call);
  console.log(s.id.padEnd(13), o.kind === 'pending' ? 'PENDING ' + o.reason : `${o.source} | contrib ${o.contribution} | total ${(s.choice_correct ? 1 : 0) + o.contribution} | ${o.status} | ${o.flags.join(',')} | ${o.feedback}`, o.calls.length ? ` [llm calls ${o.calls.length}: ${o.calls.map((c: any) => c.status + ' ' + c.ms + 'ms').join(', ')}]` : '');
}
