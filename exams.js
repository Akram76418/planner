/* الاختبارات: اختيار من متعدد + تبرير نصي يُقيَّم بالذكاء الاصطناعي ثم يعتمده المدرّس.
   تبويب داخل «التواصل» (comm.js يوفّر window.COMM_API). يعتمد على exams.sql ودالة grade-justification. */
(function () {
  'use strict';
  var A = null;
  function api() { return A || (A = window.COMM_API || null); }
  function T(a, e) { var x = api(); return x && !x.ar() ? e : a; }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $q(s) { return document.querySelector(s); }
  function rpc(n, a) { return api().rpc(n, a); }
  function db() { return api().sb(); }
  function num(x, d) { var n = Number(String(x == null ? '' : x).replace(/[٠-٩]/g, function (c) { return c.charCodeAt(0) - 1632; }).replace('٫', '.').replace(',', '.')); return isFinite(n) && String(x).trim() !== '' ? n : d; }
  function r2(n) { return Math.round(Number(n) * 100) / 100; }
  function dtv(iso) { if (!iso) return ''; var d = new Date(iso), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function fdt(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleString(api().ar() ? 'ar' : 'en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } }
  function mmss(s) { s = Math.max(0, Math.floor(s)); var m = Math.floor(s / 60); return (m >= 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : String(m)) + ':' + String(s % 60).padStart(2, '0'); }
  function LET(i) { return String.fromCharCode(65 + i); }

  var css = document.createElement('style');
  css.textContent = '.xm-q{font-size:17px;line-height:1.7;margin:8px 0}.xm-opt{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--bd,#ccc);border-radius:10px;margin:6px 0;cursor:pointer}.xm-opt.on{border-color:var(--accent,#2563eb);background:var(--accent-soft,#dbeafe)}' +
    '.xm-opt input{margin-top:5px}.xm-timer{display:flex;gap:12px;flex-wrap:wrap;font-weight:700}.xm-timer span{background:var(--card-2,rgba(127,127,127,.12));padding:4px 10px;border-radius:99px}.xm-timer .lo{background:var(--bad,#c0392b);color:#fff}' +
    '.xm-just{width:100%;min-height:110px}.xm-bar{height:6px;background:var(--card-2,rgba(127,127,127,.2));border-radius:99px;overflow:hidden;margin:6px 0}.xm-bar i{display:block;height:100%;background:var(--accent,#2563eb)}' +
    '.xm-rv{border:1px solid var(--bd,#ccc);border-radius:12px;padding:12px;margin:10px 0}.xm-rv.nr{border-color:#d97706}.xm-flag{display:inline-block;background:#fde68a;color:#78350f;border-radius:99px;font-size:12px;padding:1px 8px;margin:2px}' +
    '.xm-ok{color:#15803d}.xm-no{color:#b91c1c}.xm-kv{font-size:13px;color:var(--muted)}.xm-ed .row{align-items:flex-start}.xm-chips{display:flex;flex-wrap:wrap;gap:6px}.xm-chips label{border:1px solid var(--bd,#ccc);border-radius:99px;padding:3px 10px;cursor:pointer}';
  document.head.appendChild(css);

  var X = { loaded: false, list: [], view: 'list', busy: false, err: '', msg: '', run: null, res: null, ed: null, rv: null, usage: null, tick: null, cohorts: null };

  function role() { return api().role(); }
  function instr() { var a = api(); return role() === 'professor' || (role() === 'admin' && a.CAN('ex')); }
  function student() { return role() === 'student'; }
  function visible() { return student() || instr(); }

  /* ───────── تحميل ───────── */
  async function load() {
    X.err = '';
    if (student()) { X.list = (await rpc('ex_my_exams')) || []; }
    else if (instr()) {
      var r = await db().from('ex_exams').select('*, ex_questions(count)').order('created_at', { ascending: false });
      if (r.error) throw new Error(r.error.message);
      X.list = r.data || [];
      try { X.usage = await rpc('ex_ai_usage'); } catch (e) { X.usage = null; }
      if (role() === 'admin') { try { X.ext = (await rpc('ex_external_cohorts')) || []; } catch (e) { X.ext = null; } }
      if (role() === 'admin') { var sr = await db().from('ex_settings').select('*').eq('id', 1).maybeSingle(); X.settings = sr.data || null; }
      if (!X.cohorts) { try { X.cohorts = (await rpc('comm_list_cohorts')) || []; } catch (e) { X.cohorts = []; } }
    }
    X.loaded = true;
  }
  function badge() { return student() ? (X.list || []).filter(function (e) { return e.state === 'open' || e.state === 'in_progress'; }).length : 0; }
  function back() { stopTick(); X.view = 'list'; X.run = null; X.res = null; X.ed = null; X.rv = null; X.msg = ''; }
  function root() { return $q('#xm-root'); }
  function redraw() { var r = root(); if (r) { r.innerHTML = html(); armTick(); } }
  window.exView = function () { return '<div id="xm-root"></div>'; };
  window.exMount = function () { redraw(); if (!X.loaded && !X.busy) go(load); };
  async function go(fn) { X.busy = true; X.err = ''; try { await fn(); } catch (e) { X.err = (e && e.message) || String(e); } X.busy = false; redraw(); }

  /* ───────── العرض ───────── */
  function html() {
    var top = (X.err ? '<p class="pill bad">⚠ ' + h(X.err) + '</p>' : '') + (X.msg ? '<p class="pill ok">' + h(X.msg) + '</p>' : '');
    if (!X.loaded && !X.err) return '<div class="card"><p class="sub">' + h(T('جارٍ التحميل…', 'Loading…')) + '</p></div>';
    if (student()) {
      if (X.view === 'run') return top + runHtml();
      if (X.view === 'res') return top + resHtml();
      return top + stuList();
    }
    if (X.view === 'edit') return top + editHtml();
    if (X.view === 'rev') return top + revHtml();
    return top + insList();
  }

  /* ---- الطالب: القائمة ---- */
  var STL = { open: ['متاح', 'Open'], in_progress: ['قيد الحل', 'In progress'], upcoming: ['لم يبدأ', 'Upcoming'], closed: ['أُغلق', 'Closed'], finished: ['سُلّم', 'Submitted'] };
  function stuList() {
    var rows = (X.list || []).map(function (e) {
      var btn = '';
      if (e.state === 'open') btn = '<button class="btn sm pri" data-act="xm-start" data-id="' + e.id + '">' + h(T('ابدأ الاختبار', 'Start')) + '</button>';
      else if (e.state === 'in_progress') btn = '<button class="btn sm pri" data-act="xm-start" data-id="' + e.id + '">' + h(T('متابعة', 'Continue')) + '</button>';
      else if (e.state === 'finished') btn = '<button class="btn sm" data-act="xm-res" data-id="' + e.id + '">' + h(T('النتيجة', 'Results')) + '</button>';
      var meta = [e.questions + ' ' + T('سؤال', 'questions')];
      if (e.duration_min) meta.push(T('المدة الكلية ', 'Total ') + e.duration_min + T(' دقيقة', ' min'));
      if (e.per_question_sec) meta.push(T('لكل سؤال ', 'Per question ') + e.per_question_sec + T(' ثانية', ' s'));
      if (e.opens_at) meta.push(T('يبدأ ', 'Opens ') + fdt(e.opens_at));
      if (e.closes_at) meta.push(T('يُغلق ', 'Closes ') + fdt(e.closes_at));
      return '<div class="row"><div class="main"><div class="t">' + h(e.title) + ' <span class="pill">' + h(STL[e.state] ? STL[e.state][api().ar() ? 0 : 1] : e.state) + '</span></div><div class="sub">' + h(meta.join(' · ')) + '</div>' + (e.description ? '<div class="sub">' + h(e.description) + '</div>' : '') + '</div><div class="act">' + btn + '</div></div>';
    }).join('');
    return '<div class="card"><h2>' + h(T('الاختبارات', 'Exams')) + '</h2><div class="list">' + (rows || '<div class="empty">' + h(T('لا توجد اختبارات متاحة لك', 'No exams available')) + '</div>') + '</div></div>';
  }

  /* ---- الطالب: الحل ---- */
  /* مسودة محلية للسؤال الحالي (الاختيار والنص) تنجو من انقطاع النت وإعادة تحميل الصفحة؛ لا تتجاوز مهلة الخادم */
  function dkey(R) { return 'xm_draft_' + R.st.attempt_id + '_' + R.st.question.id; }
  function saveDraft() { var R = X.run; if (!R || !R.st || !R.st.question) return; try { localStorage.setItem(dkey(R), JSON.stringify({ sel: R.sel, text: R.text, sig: R.sig, t0: R.t0, t: Date.now() })); } catch (e) {} }
  function loadDraft(R) { try { var d = JSON.parse(localStorage.getItem(dkey(R)) || 'null'); if (d && Array.isArray(d.sel) && typeof d.text === 'string') { R.sel = d.sel.filter(function (i) { return i < R.st.question.options.length; }); R.text = d.text.slice(0, 600); if (d.sig) R.sig = { paste: d.sig.paste | 0, blur: d.sig.blur | 0, typed_ms: d.sig.typed_ms | 0, keys: d.sig.keys | 0 }; R.t0 = d.t0 || 0; } } catch (e) {} }
  function clearDraft(R) { try { localStorage.removeItem(dkey(R)); } catch (e) {} }
  function newRun(st, exam) { var R0 = { exam: exam, st: st, sel: [], text: '', sig: { paste: 0, blur: 0, typed_ms: 0, keys: 0 }, t0: 0, t1: 0, qEnd: st.q_left_s == null ? null : Date.now() + st.q_left_s * 1000, tEnd: st.total_left_s == null ? null : Date.now() + st.total_left_s * 1000, sent: false }; loadDraft(R0); return R0; }
  function resetQ(R, st) { R.st = st; R.sel = []; R.text = ''; R.sig = { paste: 0, blur: 0, typed_ms: 0, keys: 0 }; R.t0 = 0; R.t1 = 0; R.sent = false; R.qEnd = st.q_left_s == null ? null : Date.now() + st.q_left_s * 1000; R.tEnd = st.total_left_s == null ? null : Date.now() + st.total_left_s * 1000; loadDraft(R); }
  function runHtml() {
    var R = X.run, st = R.st, q = st.question;
    var opts = (q.options || []).map(function (o, i) {
      var on = R.sel.indexOf(i) > -1;
      return '<label class="xm-opt' + (on ? ' on' : '') + '"><input type="' + (q.multi ? 'checkbox' : 'radio') + '" name="xm-o" data-ex="opt" data-i="' + i + '"' + (on ? ' checked' : '') + '><span><b>' + LET(i) + '.</b> ' + h(o) + '</span></label>';
    }).join('');
    var timer = '<div class="xm-timer">' + (R.qEnd ? '<span id="xm-qt">⏱ ' + h(T('السؤال: ', 'Question: ')) + mmss((R.qEnd - Date.now()) / 1000) + '</span>' : '') + (R.tEnd ? '<span id="xm-tt">⌛ ' + h(T('الكلي: ', 'Total: ')) + mmss((R.tEnd - Date.now()) / 1000) + '</span>' : '') + '</div>';
    var prompt = q.multi ? T('اشرح باختصار سبب اختيارك لهذه الإجابات.', 'Briefly explain why you chose these answers.') : T('اشرح باختصار سبب اختيارك لهذه الإجابة.', 'Briefly explain why you chose this answer.');
    return '<div class="card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>' + h(R.exam.title) + '</b><span class="sub">' + h(T('السؤال ', 'Question ')) + (st.pos + 1) + ' / ' + st.total + '</span></div>' +
      '<div class="xm-bar"><i style="width:' + Math.round(st.pos / st.total * 100) + '%"></i></div>' + timer +
      '<div class="xm-q">' + h(q.stem) + '</div>' + (q.multi ? '<p class="sub">' + h(T('يمكن اختيار أكثر من إجابة.', 'You may select more than one answer.')) + '</p>' : '') + opts +
      '<label style="display:block;margin-top:12px"><b>' + h(prompt) + '</b><textarea id="xm-txt" class="xm-just" maxlength="600" data-ex="txt" placeholder="' + h(T('اكتب تبريرك بكلماتك (5 إلى 600 حرف)', 'Write your reasoning in your own words (5–600 characters)')) + '">' + h(R.text) + '</textarea></label>' +
      '<div class="sub" style="display:flex;justify-content:space-between"><span>' + h(T('يُقيَّم تبريرك بشكل منفصل عن اختيارك.', 'Your justification is graded separately from your choice.')) + '</span><span id="xm-cnt">' + R.text.length + ' / 600</span></div>' +
      '<p class="sub">' + h(T('لا رجوع للأسئلة السابقة بعد الإرسال، واللصق في خانة التبرير غير مسموح.', 'You cannot go back after submitting, and pasting into the box is disabled.')) + '</p>' +
      '<button class="btn pri" data-act="xm-submit"' + (X.busy ? ' disabled' : '') + '>' + h(st.pos + 1 >= st.total ? T('إرسال وإنهاء', 'Submit & finish') : T('إرسال والتالي', 'Submit & next')) + '</button></div>';
  }
  function stopTick() { clearInterval(X.tick); X.tick = null; }
  function armTick() {
    stopTick();
    if (X.view !== 'run' || !X.run) return;
    X.tick = setInterval(function () {
      var R = X.run; if (!R || X.view !== 'run' || X.busy) return;
      var now = Date.now(), a = $q('#xm-qt'), b = $q('#xm-tt');
      if (a && R.qEnd) { var l = (R.qEnd - now) / 1000; a.textContent = '⏱ ' + T('السؤال: ', 'Question: ') + mmss(l); a.className = l <= 10 ? 'lo' : ''; }
      if (b && R.tEnd) { var l2 = (R.tEnd - now) / 1000; b.textContent = '⌛ ' + T('الكلي: ', 'Total: ') + mmss(l2); b.className = l2 <= 60 ? 'lo' : ''; }
      if ((R.qEnd && now >= R.qEnd) || (R.tEnd && now >= R.tEnd)) expired();
    }, 500);
  }
  /* عند انتهاء الزمن: أرسل ما كُتب إن كان صالحاً (الخادم يمهل 3 ثوانٍ)، وإلا اطلب حالة الخادم لينتقل */
  function expired() {
    var R = X.run; if (!R || R.sent || (R.noAuto && Date.now() < R.noAuto)) return; R.sent = true; stopTick();
    if (R.sel.length && R.text.trim().length >= 5) return void submit(true);
    go(async function () { await advance(await rpc('ex_current', { p_attempt: R.st.attempt_id })); });
  }
  async function advance(st) {
    var R = X.run;
    if (st.status === 'finished') { stopTick(); await load(); X.view = 'res'; X.res = await rpc('ex_my_results', { p_exam: R.exam.id }); X.run = null; return; }
    resetQ(R, st);
  }
  async function submit(auto) {
    var R = X.run; if (!R) return;
    if (!auto) { if (!R.sel.length) { X.err = T('اختر إجابة أولاً', 'Choose an answer first'); return redraw(); } if (R.text.trim().length < 5) { X.err = T('اكتب تبريرك (5 أحرف على الأقل)', 'Write your reasoning (min 5 characters)'); return redraw(); } }
    R.sent = true; stopTick();
    var sg = { paste: R.sig.paste, blur: R.sig.blur, typed_ms: R.t0 ? Math.max(0, (R.t1 || Date.now()) - R.t0) : 0, keys: R.sig.keys };
    await go(async function () {
      var r;
      try { r = await rpc('ex_answer', { p_attempt: R.st.attempt_id, p_question: R.st.question.id, p_selected: R.sel.slice().sort(function (a, b) { return a - b; }), p_text: R.text.trim(), p_signals: sg }); }
      catch (e) {
        R.sent = false; R.noAuto = Date.now() + 5000;
        if (auto) { try { await advance(await rpc('ex_current', { p_attempt: R.st.attempt_id })); return; } catch (e2) { /* لا اتصال: تبقى المسودة ويُعاد الإرسال لاحقاً */ } }
        throw e;
      }
      clearDraft(R); grade(r.justification_id);
      await advance(r.next);
    });
  }
  /* التصحيح فور الإرسال، وأي فشل لا يمنع الطالب (يبقى «قيد المراجعة» ويُعاد من لوحة المدرّس) */
  function grade(id) { try { db().functions.invoke('grade-justification', { body: { justification_id: id } }).catch(function () {}); } catch (e) {} }

  /* ---- الطالب: النتيجة ---- */
  function resHtml() {
    var r = X.res;
    if (!r || !r.visible) return '<div class="card"><h2>' + h(T('تم تسليم الاختبار', 'Exam submitted')) + '</h2><p class="sub">' + h(T('ستظهر نتيجتك بعد أن يراجع المدرّس التبريرات ويعتمدها.', 'Your result will appear after the instructor reviews and approves the justifications.')) + '</p><button class="btn" data-act="xm-back">' + h(T('رجوع', 'Back')) + '</button></div>';
    var rows = (r.rows || []).map(function (q) {
      var sel = q.selected || [], cor = q.correct || [];
      var ok = sel.slice().sort().join() === cor.slice().sort().join();
      return '<div class="xm-rv"><div class="xm-q">' + (q.pos + 0) + '. ' + h(q.stem) + '</div>' +
        '<div class="xm-kv">' + h(T('إجابتك: ', 'Your answer: ')) + (sel.length ? sel.map(function (i) { return LET(i); }).join('، ') : '—') + ' <b class="' + (ok ? 'xm-ok' : 'xm-no') + '">' + (ok ? '✓' : '✗') + '</b> · ' + h(T('الصحيح: ', 'Correct: ')) + cor.map(function (i) { return LET(i); }).join('، ') + ' · ' + h(T('درجة الاختيار: ', 'Choice score: ')) + r2(q.choice_score) + '</div>' +
        '<div style="margin:6px 0">' + h(q.just_text || '—') + '</div>' +
        (q.pending ? '<div class="sub">' + h(T('تبريرك قيد المراجعة', 'Justification under review')) + '</div>' : '<div class="xm-kv">' + h(T('درجة التبرير: ', 'Justification score: ')) + r2(q.just_score) + (q.feedback ? ' — ' + h(q.feedback) : '') + '</div>') + '</div>';
    }).join('');
    return '<div class="card"><h2>' + h(T('نتيجتك', 'Your result')) + ': ' + r.total + ' / ' + r.max + '</h2><p class="sub">' + h(T('الاختيار: ', 'Choices: ')) + r.choice_total + ' · ' + h(T('التبرير: ', 'Justifications: ')) + r.just_total + (r.unreviewed ? ' · ' + h(T('بعض التبريرات لم تُعتمد بعد', 'some justifications are not approved yet')) : '') + '</p>' + rows + '<button class="btn" data-act="xm-back">' + h(T('رجوع', 'Back')) + '</button></div>';
  }

  /* ---- المدرّس: القائمة ---- */
  function insList() {
    var u = X.usage, usage = u ? '<p class="sub">' + h(u.configured ? T('النموذج المجاني: مُفعّل · استدعاءات اليوم ', 'Free LLM: on · calls today ') + u.today_calls + ' / ' + u.daily_limit : T('النموذج المجاني غير مُعدّ: التصحيح بالقواعد فقط، والملتبس يذهب إليك للمراجعة.', 'Free LLM not configured: rules only; ambiguous answers go to you.')) + (u.pending ? ' · ' + h(T('بانتظار إعادة المحاولة: ', 'pending retry: ')) + u.pending : '') + (u.failed_today ? ' · ' + h(T('إخفاقات اليوم: ', 'failures today: ')) + u.failed_today : '') + '</p>' : '';
    var rows = (X.list || []).map(function (e) {
      var nq = e.ex_questions && e.ex_questions[0] ? e.ex_questions[0].count : 0;
      return '<div class="row" style="align-items:flex-start"><div class="main"><div class="t">' + h(e.title) + ' ' + (e.published ? '<span class="pill ok">' + h(T('منشور', 'Published')) + '</span>' : '<span class="pill">' + h(T('مسودة', 'Draft')) + '</span>') + (e.released ? ' <span class="pill ok">' + h(T('النتائج مُطلقة', 'Results released')) + '</span>' : '') + '</div>' +
        '<div class="sub">' + nq + ' ' + h(T('سؤال', 'questions')) + ' · ' + h(T('الشعب: ', 'Cohorts: ')) + h(cohNames(e.cohort_ids)) + '</div></div>' +
        '<div class="act" style="display:flex;gap:4px;flex-wrap:wrap"><button class="btn sm" data-act="xm-edit" data-id="' + e.id + '">' + h(T('تحرير', 'Edit')) + '</button><button class="btn sm pri" data-act="xm-rev" data-id="' + e.id + '">' + h(T('المراجعة والنتائج', 'Review & results')) + '</button>' +
        '<button class="btn sm" data-act="xm-pub" data-id="' + e.id + '">' + h(e.published ? T('إلغاء النشر', 'Unpublish') : T('نشر', 'Publish')) + '</button><button class="btn sm" data-act="xm-rel" data-id="' + e.id + '">' + h(e.released ? T('إخفاء النتائج', 'Hide results') : T('إطلاق النتائج للطلبة', 'Release results')) + '</button>' +
        '<button class="btn sm bad" data-act="xm-del" data-id="' + e.id + '" data-confirm="1" data-confirm-text="' + h(T('اضغط لتأكيد الحذف النهائي', 'Click to confirm')) + '">' + h(T('حذف', 'Delete')) + '</button></div></div>';
    }).join('');
    return '<div class="card"><h2>' + h(T('الاختبارات', 'Exams')) + '</h2>' + usage + settingsHtml() + externalHtml() + '<button class="btn pri" data-act="xm-new">+ ' + h(T('اختبار جديد', 'New exam')) + '</button> <button class="btn" data-act="xm-tpl">⬇ ' + h(T('قالب استيراد الأسئلة (Excel)', 'Question import template (Excel)')) + '</button><div class="list" style="margin-top:8px">' + (rows || '<div class="empty">' + h(T('لا اختبارات بعد', 'No exams yet')) + '</div>') + '</div>' +
      '<p class="sub">' + h(T('الطلبة الخارجيون: أنشئ لهم حسابات من «إدارة ← إنشاء حسابات» برفع Excel (الرقم الجامعي والاسم) إلى شعبة خارجية، وكلمتهم الافتراضية 12345678، ثم اختر هذه الشعبة في الاختبار.', 'External students: create accounts via Admin → Create accounts with an Excel upload into an "external" cohort (default password 12345678), then pick that cohort in the exam.')) + '</p></div>';
  }
  function settingsHtml() {
    var st = X.settings; if (!st || role() !== 'admin') return '';
    return '<details style="margin:8px 0"><summary class="sub">⚙ ' + h(T('إعدادات النموذج المجاني (اختياري)', 'Free LLM settings (optional)')) + '</summary><div class="form">' +
      '<label>' + h(T('رابط المزوّد (chat/completions المتوافق مع OpenAI، https)', 'Provider URL (OpenAI-compatible chat/completions, https)')) + '<input id="st-url" dir="ltr" value="' + h(st.llm_url || '') + '" placeholder="https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"></label>' +
      '<label>' + h(T('اسم النموذج', 'Model name')) + '<input id="st-model" dir="ltr" value="' + h(st.llm_model || '') + '"></label>' +
      '<label>' + h(T('الحد اليومي للاستدعاءات', 'Daily call limit')) + '<input id="st-day" inputmode="numeric" value="' + h(st.daily_call_limit == null ? 1000 : st.daily_call_limit) + '"></label>' +
      '<label>' + h(T('حد الاستدعاءات لكل طالب في الساعة', 'Per-student calls per hour')) + '<input id="st-hr" inputmode="numeric" value="' + h(st.per_student_hour == null ? 60 : st.per_student_hour) + '"></label></div>' +
      '<p class="sub">' + h(T('المفتاح لا يُدخل هنا أبداً: يُضبط من الخادم عبر supabase secrets (LLM_API_KEY). لا يُرسل للمزوّد اسم الطالب ولا رقمه.', 'Never enter the key here: set it server-side via supabase secrets (LLM_API_KEY). No student name or number is sent to the provider.')) + '</p>' +
      '<button class="btn sm pri" data-act="xm-setsave">' + h(T('حفظ الإعدادات', 'Save settings')) + '</button></details>';
  }
  function externalHtml() {
    var L = X.ext; if (!L || role() !== 'admin') return '';
    var rows = L.map(function (c) {
      return '<div class="row"><div class="main"><div class="t">' + h(c.name) + ' <span class="sub">(' + c.members + ')</span> ' + (c.is_external ? '<span class="pill ok">' + h(T('خارجية: معزولة عن بيانات الكلية', 'External: isolated')) + '</span>' : '') + '</div></div><div class="act" style="display:flex;gap:4px;flex-wrap:wrap">' +
        '<button class="btn sm" data-act="xm-extset" data-id="' + c.id + '" data-on="' + (c.is_external ? 0 : 1) + '">' + h(c.is_external ? T('إلغاء كونها خارجية', 'Unmark external') : T('اجعلها شعبة خارجية', 'Mark as external')) + '</button>' +
        (c.is_external && c.members > 0 ? '<button class="btn sm bad" data-act="xm-extdel" data-id="' + c.id + '" data-n="' + h(c.name) + '">' + h(T('حذف حسابات هذه الشعبة', 'Delete this cohort\'s accounts')) + '</button>' : '') + '</div></div>';
    }).join('');
    return '<details style="margin:8px 0"><summary class="sub">🌐 ' + h(T('الطلبة الخارجيون (من جامعة أخرى): عزلهم عن بيانات الكلية', 'External students (other university): isolate from college data')) + '</summary>' +
      '<p class="sub">' + h(T('الشعبة المعلَّمة «خارجية» لا يظهر أعضاؤها في قوائم الطلبة ولا البحث ولا التكرار ولا استبيانات الطلبة، ولا يراسلون أحداً ولا يراسلهم أحد. يرون الاختبارات المنشورة لشعبتهم فقط. احذف حساباتهم بعد انتهاء الاختبار.', 'Members of an external cohort are hidden from student lists, search, duplicates and student polls, and cannot message or be messaged. They only see exams published to their cohort. Delete their accounts after the exam.')) + '</p><div class="list">' + (rows || '<div class="empty">—</div>') + '</div></details>';
  }
  function cohNames(ids) { var m = {}; (X.cohorts || []).forEach(function (c) { m[c.id] = c.name; }); return (ids || []).map(function (i) { return m[i] || i; }).join('، ') || '—'; }

  /* ---- المدرّس: المحرّر ---- */
  function conceptsToText(cs, names) {
    if (Array.isArray(cs) && cs.length) return cs.map(function (c) { return c.k + ((c.syn || []).length ? ' = ' + c.syn.join('، ') : ''); }).join('\n');
    return (names || []).join('\n');
  }
  function parseConcepts(t) {
    return String(t || '').split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var p = l.split('='), k = p[0].trim(), syn = (p.slice(1).join('=') || '').split(/[,،;|]/).map(function (x) { return x.trim(); }).filter(Boolean);
      return { k: k.slice(0, 120), syn: syn.slice(0, 30).map(function (x) { return x.slice(0, 120); }) };
    }).filter(function (c) { return c.k; }).slice(0, 20);
  }
  function blankQ() { return { id: null, stem: '', options: ['', '', '', ''], correct: [], multi: false, category: '', time_sec: '', key: '', concepts: '' }; }
  function editHtml() {
    var E = X.ed, e = E.exam;
    var coh = '<div class="xm-chips">' + (X.cohorts || []).filter(function (c) { return c.is_active !== false; }).map(function (c) { return '<label><input type="checkbox" data-ex="coh" value="' + c.id + '"' + ((e.cohort_ids || []).indexOf(c.id) > -1 ? ' checked' : '') + '> ' + h(c.name) + '</label>'; }).join('') + '</div>';
    var qs = E.qs.map(function (q, qi) {
      return '<div class="xm-rv" data-qi="' + qi + '"><div style="display:flex;justify-content:space-between"><b>' + h(T('سؤال ', 'Question ')) + (qi + 1) + '</b><button class="btn sm bad" data-act="xm-qdel" data-i="' + qi + '" data-confirm="1" data-confirm-text="' + h(T('اضغط لتأكيد حذف السؤال', 'Click to confirm')) + '">✕</button></div>' +
        '<label>' + h(T('نص السؤال', 'Question text')) + '<textarea data-q="stem" rows="2" style="width:100%">' + h(q.stem) + '</textarea></label>' +
        '<div class="sub">' + h(T('الخيارات (علّم الصحيح)', 'Options (tick the correct)')) + '</div>' +
        q.options.map(function (o, oi) { return '<div style="display:flex;gap:6px;align-items:center;margin:4px 0"><input type="checkbox" data-q="cor" data-o="' + oi + '"' + (q.correct.indexOf(oi) > -1 ? ' checked' : '') + '><b>' + LET(oi) + '</b><input data-q="opt" data-o="' + oi + '" value="' + h(o) + '" style="flex:1">' + (q.options.length > 2 ? '<button class="btn sm" data-act="xm-odel" data-i="' + qi + '" data-o="' + oi + '">−</button>' : '') + '</div>'; }).join('') +
        (q.options.length < 10 ? '<button class="btn sm" data-act="xm-oadd" data-i="' + qi + '">+ ' + h(T('خيار', 'Option')) + '</button> ' : '') +
        '<label class="ck"><input type="checkbox" data-q="multi"' + (q.multi ? ' checked' : '') + '> ' + h(T('أكثر من إجابة صحيحة (درجة جزئية)', 'Multiple correct answers (partial credit)')) + '</label>' +
        '<div class="form"><label>' + h(T('التصنيف (اختياري)', 'Category (optional)')) + '<input data-q="category" value="' + h(q.category) + '"></label><label>' + h(T('زمن هذا السؤال بالثواني (اختياري)', 'Seconds for this question (optional)')) + '<input data-q="time_sec" inputmode="numeric" value="' + h(q.time_sec) + '"></label></div>' +
        '<label>' + h(T('معيار التبرير: الفكرة الصحيحة (للمصحّح الآلي فقط، لا يراه الطالب)', 'Rubric: key reasoning (grader only; hidden from students)')) + '<textarea data-q="key" rows="2" style="width:100%">' + h(q.key) + '</textarea></label>' +
        '<label>' + h(T('المفاهيم المطلوبة مع مرادفاتها (سطر لكل مفهوم: المفهوم = مرادف1، مرادف2 — عربي وإنجليزي). يُصحَّح تلقائياً بالقواعد دون أي استدعاء خارجي حين تتطابق ≥80٪ من المفاهيم.', 'Required concepts with synonyms (one line each: concept = syn1, syn2 — Arabic & English). Auto-graded by rules, no external call, when ≥80% match.')) + '<textarea data-q="concepts" rows="4" dir="auto" style="width:100%" placeholder="انقباض الرحم = انقباضات الرحم، uterine contraction\nوقف النزف = النزف بعد الولادة، postpartum bleeding">' + h(q.concepts) + '</textarea></label></div>';
    }).join('');
    return '<div class="card xm-ed"><div style="display:flex;gap:8px;align-items:center"><button class="btn sm" data-act="xm-back">' + h(T('رجوع', 'Back')) + '</button><b>' + h(e.id ? T('تحرير الاختبار', 'Edit exam') : T('اختبار جديد', 'New exam')) + '</b></div>' +
      '<div class="form"><label>' + h(T('العنوان', 'Title')) + '<input id="xm-title" value="' + h(e.title || '') + '" maxlength="200"></label>' +
      '<label>' + h(T('يفتح في (اختياري)', 'Opens at (optional)')) + '<input id="xm-open" type="datetime-local" value="' + h(dtv(e.opens_at)) + '"></label>' +
      '<label>' + h(T('يُغلق في (اختياري)', 'Closes at (optional)')) + '<input id="xm-close" type="datetime-local" value="' + h(dtv(e.closes_at)) + '"></label>' +
      '<label>' + h(T('المدة الكلية بالدقائق (اتركها فارغة لعدم التحديد)', 'Total minutes (blank = none)')) + '<input id="xm-dur" inputmode="numeric" value="' + h(e.duration_min || '') + '"></label>' +
      '<label>' + h(T('زمن كل سؤال بالثواني (اتركه فارغاً لعدم التحديد)', 'Seconds per question (blank = none)')) + '<input id="xm-pq" inputmode="numeric" value="' + h(e.per_question_sec || '') + '"></label>' +
      '<label>' + h(T('وزن الاختيار', 'Choice weight')) + '<input id="xm-wc" inputmode="decimal" value="' + h(e.choice_weight == null ? 1 : e.choice_weight) + '"></label>' +
      '<label>' + h(T('وزن التبرير', 'Justification weight')) + '<input id="xm-wj" inputmode="decimal" value="' + h(e.just_weight == null ? 1 : e.just_weight) + '"></label>' +
      '<label>' + h(T('عرض النتيجة للطالب', 'Result visibility')) + '<select id="xm-fm"><option value="after_release"' + (e.feedback_mode !== 'immediate' ? ' selected' : '') + '>' + h(T('بعد أن أطلقها أنا (موصى به)', 'After I release it (recommended)')) + '</option><option value="immediate"' + (e.feedback_mode === 'immediate' ? ' selected' : '') + '>' + h(T('فور التسليم', 'Right after submitting')) + '</option></select></label></div>' +
      '<label>' + h(T('الوصف (اختياري)', 'Description (optional)')) + '<textarea id="xm-desc" rows="2" style="width:100%">' + h(e.description || '') + '</textarea></label>' +
      '<div class="sub" style="margin-top:8px">' + h(T('الشعب المستهدفة', 'Target cohorts')) + '</div>' + coh +
      '<h3 style="margin-top:14px">' + h(T('الأسئلة', 'Questions')) + '</h3><p class="sub"><label class="btn sm" style="cursor:pointer">⬆ ' + h(T('استيراد الأسئلة دفعة واحدة من Excel / CSV', 'Import all questions from Excel / CSV')) + '<input type="file" hidden accept=".xlsx,.xls,.csv" data-xm="qimport"></label> <button class="btn sm" data-act="xm-tpl">⬇ ' + h(T('القالب', 'Template')) + '</button> <button class="btn sm" data-act="xm-qexp">⬇ ' + h(T('تصدير أسئلة هذا الاختبار', 'Export this exam\'s questions')) + '</button><br>' + h(T('صف لكل سؤال. تُضاف الأسئلة إلى المحرّر للمراجعة قبل الحفظ.', 'One row per question. Questions are added to the editor for review before saving.')) + '</p>' + qs + '<div class="tabs"><button class="btn" data-act="xm-qadd">+ ' + h(T('سؤال', 'Question')) + '</button><button class="btn pri" data-act="xm-save"' + (X.busy ? ' disabled' : '') + '>' + h(T('حفظ الاختبار', 'Save exam')) + '</button></div></div>';
  }
  function collect() {
    var E = X.ed; if (!E || X.view !== 'edit') return;
    var e = E.exam, v = function (id) { var x = $q('#' + id); return x ? x.value : ''; };
    e.title = v('xm-title'); e.description = v('xm-desc'); e.feedback_mode = v('xm-fm') || 'after_release';
    e.opens_at = v('xm-open') ? new Date(v('xm-open')).toISOString() : null; e.closes_at = v('xm-close') ? new Date(v('xm-close')).toISOString() : null;
    e.duration_min = num(v('xm-dur'), null); e.per_question_sec = num(v('xm-pq'), null); e.choice_weight = num(v('xm-wc'), 1); e.just_weight = num(v('xm-wj'), 1);
    e.cohort_ids = Array.prototype.map.call(document.querySelectorAll('[data-ex="coh"]:checked'), function (c) { return Number(c.value); });
    E.qs.forEach(function (q, qi) {
      var box = document.querySelector('.xm-rv[data-qi="' + qi + '"]'); if (!box) return;
      var g = function (k) { var x = box.querySelector('[data-q="' + k + '"]'); return x ? x.value : ''; };
      q.stem = g('stem'); q.category = g('category'); q.time_sec = g('time_sec'); q.key = g('key'); q.concepts = g('concepts');
      q.multi = !!(box.querySelector('[data-q="multi"]') || {}).checked;
      q.options = Array.prototype.map.call(box.querySelectorAll('[data-q="opt"]'), function (i) { return i.value; });
      q.correct = Array.prototype.map.call(box.querySelectorAll('[data-q="cor"]:checked'), function (i) { return Number(i.dataset.o); });
    });
  }
  async function openEditor(id) {
    var E = { exam: { cohort_ids: [], choice_weight: 1, just_weight: 1, feedback_mode: 'after_release' }, qs: [] };
    if (id) {
      var r = await db().from('ex_exams').select('*').eq('id', id).single(); if (r.error) throw new Error(r.error.message); E.exam = r.data;
      var q = await db().from('ex_questions').select('*, justification_rubrics(*)').eq('exam_id', id).order('pos').order('id'); if (q.error) throw new Error(q.error.message);
      E.qs = (q.data || []).map(function (x) { var rb = x.justification_rubrics; rb = Array.isArray(rb) ? rb[0] : rb; rb = rb || {}; return { id: x.id, stem: x.stem, options: x.options, correct: x.correct_options, multi: x.multi_select, category: x.category || '', time_sec: x.time_sec || '', key: rb.key_reasoning || '', concepts: conceptsToText(rb.concepts, rb.required_concepts) }; });
    } else E.qs = [blankQ()];
    X.ed = E; X.view = 'edit'; X.msg = '';
  }
  /* ---- استيراد الأسئلة من Excel/CSV: صف لكل سؤال. أي خطأ في أي صف يمنع الاستيراد كله ويُعرض بالتفصيل ---- */
  var LMAP = { '1': 0, 'ا': 0, 'a': 0, '2': 1, 'ب': 1, 'b': 1, '3': 2, 'ج': 2, 'c': 2, '4': 3, 'د': 3, 'd': 3, '5': 4, 'ه': 4, 'e': 4, '6': 5, 'و': 5, 'f': 5, '7': 6, 'g': 6, '8': 7, 'h': 7, '9': 8, 'i': 8, '10': 9, 'j': 9 };
  function nk(x) { return String(x == null ? '' : x).replace(/[​-‏‪-‮﻿ـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function optIdx(h) { var k = nk(h).replace(/^(خيار|الخيار|option|choice)\s*/, '').replace(/[\s.:)]+$/, ''); return Object.prototype.hasOwnProperty.call(LMAP, k) ? LMAP[k] : -1; }
  function colKind(h) {
    var k = nk(h); if (!k) return '';
    if (/^(السؤال|نص السؤال|سؤال|question|stem|q)$/.test(k)) return 'stem';
    if (/^(الاجابه الصحيحه|الاجابه|الصحيح|الجواب|الاجابات الصحيحه|correct|answer|correct answer)$/.test(k) || /^(الاجابه الصحيحه|correct)/.test(k)) return 'cor';
    if (/^(التصنيف|الفئه|category)$/.test(k)) return 'cat';
    if (/(زمن|ثواني|ثانيه|seconds|time)/.test(k)) return 'sec';
    if (/(معيار|الفكره|rubric|key reasoning|key)/.test(k)) return 'key';
    if (/(المفاهيم|مفاهيم|concepts)/.test(k)) return 'con';
    return optIdx(h) >= 0 ? 'opt' : '';
  }
  function parseAoa(aoa) {
    var hr = -1, kinds = [], r, c;
    for (r = 0; r < Math.min(aoa.length, 5) && hr < 0; r++) { var ks = (aoa[r] || []).map(colKind); if (ks.indexOf('stem') > -1 && ks.indexOf('cor') > -1 && ks.filter(function (k) { return k === 'opt'; }).length >= 2) { hr = r; kinds = ks; } }
    if (hr < 0) return { qs: [], errors: [T('لم أجد صف العناوين. يجب أن يحوي: السؤال، خيارين على الأقل (أ، ب…)، الإجابة الصحيحة. حمّل القالب.', 'Header row not found. Needs: Question, at least two options (A, B…), Correct answer. Download the template.')] };
    var cols = { stem: -1, cor: -1, cat: -1, sec: -1, key: -1, con: -1 }, optCols = [];
    kinds.forEach(function (k, i) { if (k === 'opt') optCols.push({ i: i, n: optIdx(aoa[hr][i]) }); else if (k && cols[k] === -1) cols[k] = i; });
    optCols.sort(function (a, b) { return a.n - b.n; });
    var qs = [], errors = [], cell = function (row, i) { return i < 0 || row[i] == null ? '' : String(row[i]).replace(/\r/g, '').trim(); };
    for (r = hr + 1; r < aoa.length; r++) {
      var row = aoa[r] || [], stem = cell(row, cols.stem), n = r + 1;
      if (!row.some(function (x) { return String(x == null ? '' : x).trim(); })) continue;
      if (!stem) { errors.push(T('الصف ' + n + ': نص السؤال فارغ', 'Row ' + n + ': empty question')); continue; }
      var opts = [], map = {};
      optCols.forEach(function (oc) { var t = cell(row, oc.i); if (t) { map[oc.n] = opts.length; opts.push(t); } });
      if (opts.length < 2) { errors.push(T('الصف ' + n + ': يلزم خياران على الأقل', 'Row ' + n + ': at least two options')); continue; }
      var raw = cell(row, cols.cor), toks = raw.split(/[,،;|+\s\/&]+/).filter(Boolean), cor = [], bad = false;
      toks.forEach(function (t) {
        var k = nk(t), parts = (!Object.prototype.hasOwnProperty.call(LMAP, k) && /^[a-j]{2,}$/.test(k)) ? k.split('') : [k];
        parts.forEach(function (p) { if (!Object.prototype.hasOwnProperty.call(LMAP, p) || map[LMAP[p]] == null) bad = true; else if (cor.indexOf(map[LMAP[p]]) < 0) cor.push(map[LMAP[p]]); });
      });
      if (!raw || bad || !cor.length) { errors.push(T('الصف ' + n + ': الإجابة الصحيحة «' + raw + '» غير مفهومة أو تشير لخيار غير موجود (استخدم الحرف مثل B أو ب، وللمتعدد: A,C)', 'Row ' + n + ': correct answer "' + raw + '" is invalid or points to a missing option (use a letter like B; multiple: A,C)')); continue; }
      var sec = cell(row, cols.sec), secN = sec === '' ? '' : num(sec, NaN);
      if (secN !== '' && (isNaN(secN) || secN < 10 || secN > 7200)) { errors.push(T('الصف ' + n + ': زمن السؤال من 10 إلى 7200 ثانية', 'Row ' + n + ': seconds must be 10–7200')); continue; }
      qs.push({ id: null, stem: stem.slice(0, 4000), options: opts, correct: cor.sort(function (a, b) { return a - b; }), multi: cor.length > 1, category: cell(row, cols.cat).slice(0, 100), time_sec: secN === '' ? '' : String(Math.floor(secN)), key: cell(row, cols.key), concepts: cell(row, cols.con).split(/\n|;|؛/).map(function (l) { return l.trim(); }).filter(Boolean).join('\n') });
    }
    if (!qs.length && !errors.length) errors.push(T('لا أسئلة في الملف', 'No questions in the file'));
    return { qs: qs, errors: errors };
  }
  function applyExamSheet(aoa, e) {
    (aoa || []).forEach(function (row) {
      var k = nk(row[0]), v = row[1] == null ? '' : String(row[1]).trim(); if (!k || v === '') return;
      if (/^(العنوان|عنوان الاختبار|title)$/.test(k)) e.title = v.slice(0, 200);
      else if (/^(الوصف|description)$/.test(k)) e.description = v.slice(0, 2000);
      else if (/(المده|duration|total)/.test(k)) { var d = num(v, NaN); if (!isNaN(d) && d >= 1 && d <= 1440) e.duration_min = Math.floor(d); }
      else if (/(كل سؤال|per question|per-question)/.test(k)) { var p = num(v, NaN); if (!isNaN(p) && p >= 10 && p <= 7200) e.per_question_sec = Math.floor(p); }
    });
  }
  var QH = ['السؤال', 'أ', 'ب', 'ج', 'د', 'هـ', 'و', 'الإجابة الصحيحة', 'التصنيف', 'زمن السؤال (ثانية)', 'معيار التبرير', 'المفاهيم ومرادفاتها'];
  function xlsxBook(qrows, erows, withHelp) {
    var X_ = window.XLSX, wb = X_.utils.book_new(), w1 = X_.utils.aoa_to_sheet([QH].concat(qrows));
    w1['!cols'] = [46, 18, 18, 18, 18, 18, 18, 16, 14, 14, 40, 50].map(function (w) { return { wch: w }; });
    X_.utils.book_append_sheet(wb, w1, 'الأسئلة');
    X_.utils.book_append_sheet(wb, X_.utils.aoa_to_sheet(erows), 'الاختبار');
    if (withHelp) X_.utils.book_append_sheet(wb, X_.utils.aoa_to_sheet([
      ['صف واحد لكل سؤال. لا تغيّر عناوين الأعمدة.'], ['الخيارات: من 2 إلى 6 (أ إلى هـ…)، ويمكن ترك الزائد فارغاً.'],
      ['الإجابة الصحيحة: حرف الخيار (ب أو B). لأكثر من إجابة افصل بفاصلة: A,C (يصبح متعدد الإجابات بدرجة جزئية).'],
      ['زمن السؤال والتصنيف ومعيار التبرير: اختيارية. الزمن بين 10 و7200 ثانية.'],
      ['المفاهيم: سطر لكل مفهوم داخل الخلية (Alt+Enter) بصيغة: المفهوم = مرادف1، مرادف2 (عربي وإنجليزي). بها يصحّح النظام التبريرات تلقائياً.'],
      ['ورقة «الاختبار» اختيارية (العنوان والوصف والمدة وزمن السؤال)، والقيمة الفارغة تُتجاهل.'], ['احذف صفّي المثالين قبل الاستخدام.']]), 'تعليمات');
    wb.Workbook = { Views: [{ RTL: true }] };
    return wb;
  }
  async function exportTemplate() {
    await loadXlsx();
    var wb = xlsxBook([
      ['أي دواء يستخدم للسيطرة على النزف بعد الولادة؟', 'خافض ضغط', 'أوكسيتوسين', 'مضاد حيوي', '', '', '', 'ب', 'التوليد', 60, 'الأوكسيتوسين يسبب انقباض الرحم فيقلل النزف بعد الولادة.', 'انقباض الرحم = انقباضات الرحم، تقلص الرحم، uterine contraction\nوقف النزف = النزف بعد الولادة، postpartum bleeding، PPH'],
      ['Select ALL correct signs of preeclampsia', 'High blood pressure', 'Proteinuria', 'Low-grade fever', 'Headache', '', '', 'A,B,D', 'Obstetrics', '', 'Hypertension with protein in urine and neurological symptoms.', 'hypertension = high blood pressure، ارتفاع الضغط\nproteinuria = بروتين في البول']
    ], [['العنوان', 'اختبار الوحدة الأولى'], ['الوصف', 'اختياري'], ['المدة الكلية بالدقائق', 30], ['زمن كل سؤال بالثواني', 60]], true);
    window.XLSX.writeFile(wb, 'Exam_Import_Template.xlsx');
  }
  async function exportQuestions() {
    collect(); var E = X.ed; if (!E || !E.qs.length) throw new Error(T('لا أسئلة للتصدير', 'No questions to export'));
    await loadXlsx();
    var big = E.qs.filter(function (q) { return q.options.length > 6; }).length; if (big) throw new Error(T('يوجد ' + big + ' سؤال فيه أكثر من 6 خيارات ولا يدعمها ملف Excel', big + ' question(s) have more than 6 options, which the Excel format does not support'));
    var rows = E.qs.map(function (q) { var o = q.options.slice(0, 6); while (o.length < 6) o.push(''); return [q.stem].concat(o, [q.correct.map(function (i) { return LET(i); }).join(','), q.category, q.time_sec, q.key, q.concepts]); });
    var e = E.exam;
    window.XLSX.writeFile(xlsxBook(rows, [['العنوان', e.title || ''], ['الوصف', e.description || ''], ['المدة الكلية بالدقائق', e.duration_min || ''], ['زمن كل سؤال بالثواني', e.per_question_sec || '']], false), 'exam-questions.xlsx');
  }
  async function importFile(file) {
    if (!file || !X.ed) return;
    collect(); X.err = ''; X.msg = '';
    try {
      var res, en, wb;
      if (/\.(csv|txt|tsv)$/i.test(file.name) && window.parseCsvText) res = parseAoa(window.parseCsvText(await file.arrayBuffer()));
      else {
        await loadXlsx();
        wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
        var names = wb.SheetNames, qn = names.filter(function (n) { return /^(الاسئله|الأسئلة|questions)$/i.test(nk(n)) || /^(الاسئله|questions)$/i.test(n); })[0] || names[0];
        en = names.filter(function (n) { return /^(الاختبار|exam|settings|الاعدادات)$/i.test(nk(n)); })[0];
        res = parseAoa(window.XLSX.utils.sheet_to_json(wb.Sheets[qn], { header: 1, defval: '', raw: false }));
      }
      if (res.errors.length) { X.err = res.errors.slice(0, 8).join(' | ') + (res.errors.length > 8 ? ' …(+' + (res.errors.length - 8) + ')' : '') + T(' — لم يُستورد شيء، صحّح الملف وأعد المحاولة.', ' — nothing imported; fix the file and retry.'); return redraw(); }
      var E = X.ed; if (E.qs.length === 1 && !E.qs[0].id && !E.qs[0].stem.trim()) E.qs = [];
      E.qs = E.qs.concat(res.qs);
      if (en && wb) applyExamSheet(window.XLSX.utils.sheet_to_json(wb.Sheets[en], { header: 1, defval: '', raw: false }), E.exam);
      X.msg = T('أُضيف ' + res.qs.length + ' سؤالاً. راجعها ثم اضغط «حفظ الاختبار» (لم يُحفظ شيء بعد).', res.qs.length + ' questions added. Review them, then press Save (nothing is saved yet).');
    } catch (e) { X.err = (e && e.message) || String(e); }
    redraw();
  }
  async function saveExam() {
    collect(); var E = X.ed, e = E.exam;
    if (!String(e.title || '').trim()) throw new Error(T('اكتب عنوان الاختبار', 'Enter a title'));
    if (!(e.cohort_ids || []).length) throw new Error(T('اختر شعبة واحدة على الأقل', 'Pick at least one cohort'));
    if (e.opens_at && e.closes_at && e.closes_at <= e.opens_at) throw new Error(T('وقت الإغلاق قبل وقت الفتح', 'Close time is before open time'));
    if (e.duration_min != null && (e.duration_min < 1 || e.duration_min > 1440)) throw new Error(T('المدة الكلية من 1 إلى 1440 دقيقة', 'Total minutes must be 1–1440'));
    if (e.per_question_sec != null && (e.per_question_sec < 10 || e.per_question_sec > 7200)) throw new Error(T('زمن السؤال من 10 إلى 7200 ثانية', 'Per-question seconds must be 10–7200'));
    E.qs.forEach(function (q, i) {
      var n = i + 1; if (!q.stem.trim()) throw new Error(T('نص السؤال ' + n + ' فارغ', 'Question ' + n + ' is empty'));
      if (q.options.some(function (o) { return !o.trim(); })) throw new Error(T('السؤال ' + n + ': خيار فارغ', 'Question ' + n + ': empty option'));
      if (!q.correct.length) throw new Error(T('السؤال ' + n + ': علّم الإجابة الصحيحة', 'Question ' + n + ': mark the correct answer'));
      if (!q.multi && q.correct.length > 1) throw new Error(T('السؤال ' + n + ': فعّل «أكثر من إجابة» أو اترك إجابة واحدة', 'Question ' + n + ': enable multi-select or keep one answer'));
      var ts = num(q.time_sec, null); if (ts != null && (ts < 10 || ts > 7200)) throw new Error(T('السؤال ' + n + ': الزمن من 10 إلى 7200 ثانية', 'Question ' + n + ': seconds must be 10–7200'));
    });
    var body = { title: e.title.trim(), description: (e.description || '').trim() || null, cohort_ids: e.cohort_ids, opens_at: e.opens_at, closes_at: e.closes_at, duration_min: e.duration_min, per_question_sec: e.per_question_sec, choice_weight: e.choice_weight, just_weight: e.just_weight, feedback_mode: e.feedback_mode };
    var r = e.id ? await db().from('ex_exams').update(body).eq('id', e.id).select('id').single() : await db().from('ex_exams').insert(body).select('id').single();
    if (r.error) throw new Error(r.error.message); e.id = r.data.id;
    var keep = [];
    for (var i = 0; i < E.qs.length; i++) {
      var q = E.qs[i], row = { exam_id: e.id, pos: i + 1, stem: q.stem.trim(), options: q.options.map(function (o) { return o.trim(); }), correct_options: q.correct.slice().sort(function (a, b) { return a - b; }), multi_select: !!q.multi, category: q.category.trim() || null, time_sec: num(q.time_sec, null) };
      var w = q.id ? await db().from('ex_questions').update(row).eq('id', q.id).select('id').single() : await db().from('ex_questions').insert(row).select('id').single();
      if (w.error) throw new Error(w.error.message); q.id = w.data.id; keep.push(q.id);
      var rb = await db().from('justification_rubrics').upsert({ question_id: q.id, key_reasoning: q.key.trim(), required_concepts: parseConcepts(q.concepts).map(function (c) { return c.k; }), concepts: parseConcepts(q.concepts) });
      if (rb.error) throw new Error(rb.error.message);
    }
    var all = await db().from('ex_questions').select('id').eq('exam_id', e.id);
    var gone = (all.data || []).map(function (x) { return x.id; }).filter(function (id) { return keep.indexOf(id) < 0; });
    if (gone.length) { var d = await db().from('ex_questions').delete().in('id', gone); if (d.error) throw new Error(d.error.message); }
    await load(); X.view = 'list'; X.ed = null; X.msg = T('تم حفظ الاختبار', 'Exam saved');
  }

  /* ---- المدرّس: المراجعة والنتائج ---- */
  function revHtml() {
    var V = X.rv, e = V.exam;
    var qopts = '<option value="">' + h(T('كل الأسئلة', 'All questions')) + '</option>' + V.qlist.map(function (q) { return '<option value="' + q.id + '"' + (String(V.fq) === String(q.id) ? ' selected' : '') + '>' + q.pos + '. ' + h(q.stem.slice(0, 40)) + '</option>'; }).join('');
    var st = '<option value="">' + h(T('كل الحالات', 'All statuses')) + '</option>' + [['needs_review', T('تحتاج مراجعة', 'Needs review')], ['pending', T('بانتظار التصحيح', 'Pending')], ['graded', T('مُصحَّح', 'Graded')]].map(function (s) { return '<option value="' + s[0] + '"' + (V.fs === s[0] ? ' selected' : '') + '>' + h(s[1]) + '</option>'; }).join('');
    var tbl = (V.table || []).map(function (r) { return '<tr><td>' + h(r.student) + '</td><td dir="ltr">' + h(r.student_no || '') + '</td><td>' + r.choice + '</td><td>' + r.just + '</td><td><b>' + r2(r.choice + r.just) + '</b> / ' + r.max + '</td><td>' + (r.review ? '<span class="xm-flag">' + r.review + '</span>' : '✓') + '</td></tr>'; }).join('');
    var items = (V.rows || []).map(itemHtml).join('');
    return '<div class="card"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn sm" data-act="xm-back">' + h(T('رجوع', 'Back')) + '</button><b>' + h(e.title) + '</b></div>' +
      (V.prog ? '<p class="pill">' + h(V.prog) + '</p>' : '') +
      '<div class="tabs" style="margin:8px 0"><button class="btn sm" data-act="xm-regrade">' + h(T('إعادة تصحيح غير المصحَّح', 'Re-grade pending')) + '</button><button class="btn sm" data-act="xm-bulk" data-confirm="1" data-confirm-text="' + h(T('اضغط لاعتماد كل المصحَّح بلا ملاحظات', 'Click to approve all clean graded')) + '">' + h(T('اعتماد المصحَّح بلا ملاحظات', 'Approve all clean')) + '</button><button class="btn sm" data-act="xm-xl">⬇ Excel</button><button class="btn sm" data-act="xm-csv">⬇ CSV</button></div>' +
      '<h3>' + h(T('درجات الطلبة', 'Student scores')) + '</h3><div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr><th>' + h(T('الطالب', 'Student')) + '</th><th>' + h(T('الرقم', 'No.')) + '</th><th>' + h(T('الاختيار', 'Choice')) + '</th><th>' + h(T('التبرير', 'Justif.')) + '</th><th>' + h(T('المجموع', 'Total')) + '</th><th>' + h(T('للمراجعة', 'To review')) + '</th></tr></thead><tbody>' + (tbl || '<tr><td colspan="6">' + h(T('لا محاولات بعد', 'No attempts yet')) + '</td></tr>') + '</tbody></table></div>' +
      '<h3 style="margin-top:14px">' + h(T('مراجعة التبريرات', 'Justification review')) + '</h3><div class="form"><label>' + h(T('الحالة', 'Status')) + '<select id="rv-st" data-ex="rvf">' + st + '</select></label><label>' + h(T('السؤال', 'Question')) + '<select id="rv-q" data-ex="rvf">' + qopts + '</select></label>' +
      '<label>' + h(T('طالب (اسم أو رقم)', 'Student (name/no.)')) + '<input id="rv-s" value="' + h(V.fst || '') + '"></label><div style="align-self:end"><button class="btn" data-act="xm-rvgo">' + h(T('بحث', 'Search')) + '</button></div></div>' +
      '<p class="sub">' + (V.rows || []).length + ' ' + h(T('تبرير', 'items')) + '</p>' + items + '</div>';
  }
  function itemHtml(j) {
    var ok = (j.selected || []).slice().sort().join() === (j.correct || []).slice().sort().join(), sg = j.signals || {};
    var fl = (j.flags || []).map(function (f) { return '<span class="xm-flag">' + h(f) + '</span>'; }).join('');
    var sigs = [sg.paste ? T('لصق ', 'paste ') + sg.paste : '', sg.blur ? T('خروج من الصفحة ', 'left page ') + sg.blur : '', sg.typed_ms ? T('زمن الكتابة ', 'typing ') + Math.round(sg.typed_ms / 1000) + 's' : '', j.similar != null && j.similar >= 0.6 ? T('تشابه مع طالب آخر ', 'similar to another ') + j.similar : ''].filter(Boolean).join(' · ');
    var cur = j.instructor_score != null ? j.instructor_score : j.ai_score;
    return '<div class="xm-rv' + (j.status === 'needs_review' ? ' nr' : '') + '"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>' + h(j.student || '—') + ' <span dir="ltr" class="sub">' + h(j.student_no || '') + '</span></b><span>' +
      '<span class="pill">' + h(j.status) + '</span> ' + (j.approved ? '<span class="pill ok">' + h(T('معتمد', 'Approved')) + '</span>' : '') + '</span></div>' +
      '<div class="sub">' + j.pos + '. ' + h(j.stem) + '</div>' +
      '<div class="xm-kv">' + h(T('اختياره: ', 'Chosen: ')) + ((j.selected || []).map(LET).join('، ') || '—') + ' <b class="' + (ok ? 'xm-ok' : 'xm-no') + '">' + (ok ? '✓' : '✗') + '</b> · ' + h(T('الصحيح: ', 'Correct: ')) + (j.correct || []).map(LET).join('، ') + '</div>' +
      '<div style="margin:6px 0;padding:8px;background:var(--card-2,rgba(127,127,127,.1));border-radius:8px;white-space:pre-wrap">' + h(j.text || '—') + '</div>' +
      '<div class="xm-kv">' + h(T('مساهمة التصحيح الآلي: ', 'Auto-grade contribution: ')) + (j.ai_score == null ? '—' : j.ai_score) + (j.ai_raw && j.ai_raw.source ? ' · ' + h(({ rules: T('بالقواعد', 'rules'), llm: T('بنموذج مجاني', 'free LLM'), rules_ambiguous: T('قواعد (ملتبس)', 'rules (ambiguous)'), pending: T('بانتظار إعادة المحاولة', 'pending retry') })[j.ai_raw.source] || j.ai_raw.source) + (j.ai_raw.ratio != null ? ' ' + Math.round(j.ai_raw.ratio * 100) + '%' : '') : '') + (j.ai_confidence != null ? ' · ' + h(T('الثقة ', 'confidence ')) + j.ai_confidence : '') + '</div>' +
      (j.ai_feedback ? '<div class="xm-kv">' + h(j.ai_feedback) + '</div>' : '') +
      ((j.matched || []).length ? '<div class="xm-kv">' + h(T('مفاهيم مطابقة: ', 'Matched: ')) + h(j.matched.join('، ')) + '</div>' : '') + (fl ? '<div>' + fl + '</div>' : '') + (sigs ? '<div class="xm-kv">' + h(sigs) + '</div>' : '') +
      '<details><summary class="sub">' + h(T('معيار التصحيح', 'Rubric')) + '</summary><div class="xm-kv">' + h((j.rubric || {}).key || '') + ' · ' + h(((j.rubric || {}).concepts || []).join('، ')) + '</div></details>' +
      '<div class="tabs" style="margin-top:8px;align-items:flex-end"><label>' + h(T('درجتك (0 إلى 1)', 'Your score (0–1)')) + '<input id="sc-' + j.id + '" inputmode="decimal" style="width:90px" value="' + (cur == null ? '' : h(cur)) + '"></label><label style="flex:1">' + h(T('ملاحظة للطالب (اختياري)', 'Note to student')) + '<input id="nt-' + j.id + '" value="' + h(j.instructor_note || '') + '" style="width:100%"></label>' +
      '<button class="btn sm pri" data-act="xm-score" data-id="' + j.id + '">' + h(T('اعتماد بدرجتي', 'Approve with my score')) + '</button>' + (j.status !== 'pending' && !j.approved ? '<button class="btn sm" data-act="xm-appr" data-id="' + j.id + '">' + h(T('اعتماد درجة الذكاء', 'Approve AI score')) + '</button>' : '') + '</div></div>';
  }
  async function loadReview() {
    var V = X.rv;
    V.rows = (await rpc('ex_review_list', { p_exam: V.exam.id, p_status: V.fs || null, p_q: V.fq ? Number(V.fq) : null, p_student: V.fst || null })) || [];
    V.table = (await rpc('ex_results_table', { p_exam: V.exam.id })) || [];
  }
  async function openReview(id) {
    var ex = (X.list || []).filter(function (e) { return e.id === id; })[0];
    var q = await db().from('ex_questions').select('id,pos,stem').eq('exam_id', id).order('pos');
    X.rv = { exam: ex, qlist: q.data || [], fs: 'needs_review', fq: '', fst: '', rows: [], table: [], prog: '' }; X.view = 'rev'; X.msg = ''; await loadReview();
  }
  function readFilters() { var V = X.rv; if (!V) return; var s = $q('#rv-st'), q = $q('#rv-q'), n = $q('#rv-s'); if (s) V.fs = s.value; if (q) V.fq = q.value; if (n) V.fst = n.value.trim(); }
  async function regrade() {
    var V = X.rv, ids = (await rpc('ex_pending_ids', { p_exam: V.exam.id })) || [], done = 0, bad = 0;
    if (!ids.length) { V.prog = T('لا يوجد تبرير بانتظار التصحيح', 'Nothing pending'); return; }
    for (var i = 0; i < ids.length; i += 3) {
      await Promise.all(ids.slice(i, i + 3).map(function (id) { return db().functions.invoke('grade-justification', { body: { justification_id: id } }).then(function (r) { if (r.error || (r.data && r.data.error)) bad++; else done++; }).catch(function () { bad++; }); }));
      V.prog = T('جارٍ التصحيح… ', 'Grading… ') + Math.min(i + 3, ids.length) + ' / ' + ids.length;
    }
    V.prog = T('اكتملت إعادة التصحيح: نجح ' + done + (bad ? '، وتعذّر ' + bad + ' (قد يكون السقف الشهري أو إعدادات الدالة)' : ''), 'Done: ' + done + ' ok' + (bad ? ', ' + bad + ' failed' : ''));
    await loadReview();
  }
  function exportRows() { return (X.rv.table || []).map(function (r) { return { 'الطالب': r.student, 'الرقم الجامعي': r.student_no || '', 'الحالة': r.status, 'أُجيب': r.answered, 'درجة الاختيار': r.choice, 'درجة التبرير': r.just, 'المجموع': r2(r.choice + r.just), 'العظمى': r.max, 'للمراجعة': r.review }; }); }
  function saveBlob(name, blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
  function exportCsv() {
    var rows = exportRows(); if (!rows.length) return; var k = Object.keys(rows[0]);
    var esc = function (v) { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
    saveBlob('exam-' + X.rv.exam.id + '.csv', new Blob(['﻿' + [k.map(esc).join(',')].concat(rows.map(function (r) { return k.map(function (c) { return esc(r[c]); }).join(','); })).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  }
  function loadXlsx() { if (window.XLSX) return Promise.resolve(); if (window.__xlsxP) return window.__xlsxP; var L = ['https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js']; window.__xlsxP = L.reduce(function (p, src) { return p.catch(function () { return new Promise(function (res, rej) { var sc = document.createElement('script'); sc.src = src; sc.onload = function () { window.XLSX ? res() : rej(); }; sc.onerror = function () { sc.remove(); rej(); }; document.head.appendChild(sc); }); }); }, Promise.reject()).catch(function () { window.__xlsxP = null; throw new Error(T('تعذّر تحميل مكتبة Excel من الإنترنت. للاستيراد احفظ الملف بصيغة CSV. (التصدير يحتاج المكتبة.)', 'Could not load the Excel library. For import, save the file as CSV. (Export needs the library.)')); }); return window.__xlsxP; }
  async function exportXlsx() {
    var rows = exportRows(); if (!rows.length) return; await loadXlsx();
    var ws = window.XLSX.utils.json_to_sheet(rows), wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, 'Results'); window.XLSX.writeFile(wb, 'exam-' + X.rv.exam.id + '.xlsx');
  }

  /* ───────── الأحداث ───────── */
  var ACTS = {
    'xm-back': function () { back(); go(load); },
    'xm-start': function (el) { go(async function () {
      var id = Number(el.dataset.id), exam = X.list.filter(function (e) { return e.id === id; })[0], st = await rpc('ex_start', { p_exam: id });
      if (st.status === 'finished') { await load(); X.view = 'res'; X.res = await rpc('ex_my_results', { p_exam: id }); return; }
      X.run = newRun(st, exam); X.view = 'run';
    }); },
    'xm-submit': function () { submit(false); },
    'xm-res': function (el) { go(async function () { X.res = await rpc('ex_my_results', { p_exam: Number(el.dataset.id) }); X.view = 'res'; }); },
    'xm-new': function () { go(function () { return openEditor(null); }); },
    'xm-edit': function (el) { go(function () { return openEditor(Number(el.dataset.id)); }); },
    'xm-qadd': function () { collect(); X.ed.qs.push(blankQ()); redraw(); },
    'xm-qdel': function (el) { collect(); X.ed.qs.splice(Number(el.dataset.i), 1); redraw(); },
    'xm-oadd': function (el) { collect(); X.ed.qs[Number(el.dataset.i)].options.push(''); redraw(); },
    'xm-odel': function (el) { collect(); var q = X.ed.qs[Number(el.dataset.i)], o = Number(el.dataset.o); q.options.splice(o, 1); q.correct = q.correct.filter(function (c) { return c !== o; }).map(function (c) { return c > o ? c - 1 : c; }); redraw(); },
    'xm-save': function () { go(saveExam); },
    'xm-pub': function (el) { go(async function () { var id = Number(el.dataset.id), e = X.list.filter(function (x) { return x.id === id; })[0]; var r = await db().from('ex_exams').update({ published: !e.published }).eq('id', id); if (r.error) throw new Error(r.error.message); await load(); }); },
    'xm-rel': function (el) { go(async function () { var id = Number(el.dataset.id), e = X.list.filter(function (x) { return x.id === id; })[0]; var r = await db().from('ex_exams').update({ released: !e.released }).eq('id', id); if (r.error) throw new Error(r.error.message); await load(); }); },
    'xm-del': function (el) { go(async function () { var r = await db().from('ex_exams').delete().eq('id', Number(el.dataset.id)); if (r.error) throw new Error(r.error.message); await load(); }); },
    'xm-rev': function (el) { go(function () { return openReview(Number(el.dataset.id)); }); },
    'xm-rvgo': function () { readFilters(); go(loadReview); },
    'xm-score': function (el) { go(async function () {
      var id = Number(el.dataset.id), s = num(($q('#sc-' + id) || {}).value, NaN); if (isNaN(s) || s < 0 || s > 1) throw new Error(T('الدرجة رقم من 0 إلى 1', 'Score must be 0–1'));
      readFilters(); await rpc('ex_set_score', { p_just: id, p_score: s, p_note: ($q('#nt-' + id) || {}).value || null }); await loadReview();
    }); },
    'xm-appr': function (el) { go(async function () { readFilters(); await rpc('ex_approve', { p_ids: [Number(el.dataset.id)] }); await loadReview(); }); },
    'xm-bulk': function () { go(async function () { readFilters(); var n = await rpc('ex_bulk_approve', { p_exam: X.rv.exam.id }); X.rv.prog = T('اعتُمد ' + n + ' تبريراً', n + ' approved'); await loadReview(); }); },
    'xm-regrade': function () { readFilters(); go(regrade); },
    'xm-setsave': function () { go(async function () {
      var d = num(($q('#st-day') || {}).value, NaN), hr = num(($q('#st-hr') || {}).value, NaN), url = (($q('#st-url') || {}).value || '').trim();
      if (isNaN(d) || d < 0 || isNaN(hr) || hr < 1) throw new Error(T('الحدّان رقمان صحيحان', 'Limits must be numbers'));
      if (url && !/^https:\/\//.test(url)) throw new Error(T('الرابط يجب أن يبدأ بـ https://', 'URL must start with https://'));
      var r = await db().from('ex_settings').update({ llm_url: url, llm_model: (($q('#st-model') || {}).value || '').trim(), daily_call_limit: Math.floor(d), per_student_hour: Math.floor(hr) }).eq('id', 1);
      if (r.error) throw new Error(r.error.message); await load(); X.msg = T('حُفظت الإعدادات', 'Settings saved');
    }); },
    'xm-tpl': function () { go(exportTemplate); },
    'xm-qexp': function () { go(exportQuestions); },
    'xm-extset': function (el) { go(async function () { await rpc('ex_set_external', { p_cohort: Number(el.dataset.id), p_on: el.dataset.on === '1' }); await load(); }); },
    'xm-extdel': function (el) { go(async function () {
      var id = Number(el.dataset.id), m = (await rpc('comm_list_students', { p_cohort: id, p_search: '', p_unassigned: false })) || [], ids = m.map(function (x) { return x.id; });
      if (!ids.length) { X.msg = T('لا أعضاء', 'No members'); return; }
      var w = window.prompt(T('سيُحذف ' + ids.length + ' حساب في «' + el.dataset.n + '» نهائياً مع محاولاتهم ونتائجهم.\n\nصدّر النتائج أولاً إن أردت الاحتفاظ بها.\nللتأكيد اكتب كلمة: حذف', 'This permanently deletes ' + ids.length + ' accounts in "' + el.dataset.n + '" with their attempts and results.\nExport results first if you need them.\nType: delete'));
      if (!w || ['حذف', 'delete'].indexOf(w.trim().toLowerCase()) < 0) return;
      var del = 0, errs = [];
      for (var i = 0; i < ids.length; i += 100) {
        var r = await db().functions.invoke((window.PLANNER_CONFIG || {}).ADMIN_FN || 'admin-accounts', { body: { action: 'delete', ids: ids.slice(i, i + 100) } });
        if (r.error || (r.data && r.data.error)) throw new Error((r.data && r.data.error) || (r.error && r.error.message) || 'delete failed');
        (r.data.results || []).forEach(function (x) { if (x.status === 'deleted') del++; else if (x.status === 'error') errs.push(x.message); });
      }
      X.msg = T('تم حذف ' + del + ' حساب' + (errs.length ? ' · تعذّر ' + errs.length + ': ' + errs[0] : ''), 'Deleted ' + del + (errs.length ? ' · failed ' + errs.length : '')); await load();
    }); },
    'xm-csv': function () { exportCsv(); },
    'xm-xl': function () { go(exportXlsx); }
  };
  window.EXTRA_ACT = Object.assign(window.EXTRA_ACT || {}, ACTS);

  document.addEventListener('change', function (e) {
    var t = e.target, k = t.dataset && t.dataset.ex; if (!k) return;
    if (k === 'opt' && X.run) {
      var R = X.run, i = Number(t.dataset.i);
      if (R.st.question.multi) { var p = R.sel.indexOf(i); if (t.checked && p < 0) R.sel.push(i); else if (!t.checked && p > -1) R.sel.splice(p, 1); } else R.sel = [i];
      saveDraft();
      document.querySelectorAll('.xm-opt').forEach(function (l) { var c = l.querySelector('input'); l.classList.toggle('on', !!(c && c.checked)); });
    }
  });
  document.addEventListener('change', function (e) { var t = e.target; if (t && t.dataset && t.dataset.xm === 'qimport') { var f = t.files && t.files[0]; t.value = ''; importFile(f); } });
  document.addEventListener('input', function (e) {
    var t = e.target; if (!t.dataset || t.dataset.ex !== 'txt' || !X.run) return;
    var R = X.run, now = Date.now(); R.text = t.value; if (!R.t0) R.t0 = now; R.t1 = now; R.sig.keys++;
    saveDraft();
    var c = $q('#xm-cnt'); if (c) c.textContent = t.value.length + ' / 600';
  });
  function noPaste(e) { var t = e.target; if (t && t.id === 'xm-txt' && X.run) { e.preventDefault(); X.run.sig.paste++; } }
  document.addEventListener('paste', noPaste); document.addEventListener('drop', noPaste);
  function netBanner(on) {
    var r = root(), b = $q('#xm-net'); if (!r || X.view !== 'run') return;
    if (!on) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('p'); b.id = 'xm-net'; b.className = 'pill bad'; b.textContent = T('انقطع الاتصال. إجابتك محفوظة على جهازك، لكن الوقت لا يتوقف. أرسلها فور عودة الاتصال.', 'You are offline. Your answer is saved on this device, but the clock keeps running. Submit as soon as you are back online.'); r.insertBefore(b, r.firstChild); }
  }
  window.addEventListener('offline', function () { netBanner(true); });
  window.addEventListener('online', function () { netBanner(false); });
  function lost() { if (X.view === 'run' && X.run) X.run.sig.blur++; }
  window.addEventListener('blur', lost);
  document.addEventListener('visibilitychange', function () { if (document.hidden) lost(); });

  window.EXAMS = { parseAoa: parseAoa, visible: visible, instr: instr, html: html, load: load, badge: badge, arm: armTick, active: function () { return X.view === 'run'; }, loaded: function () { return X.loaded; } };
})();
