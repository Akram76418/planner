/* المقابلات: إدارة الجلسات واللجنة والمعايير، تقييم المقيّمين، ونتائج المرشحين. يعتمد على iv.sql */
(function () {
  'use strict';
  var PA = function () { return window.PLANNER_AUTH || null; };
  function sb() { return PA() && PA().sb(); }
  function ar() { return PA() ? PA().lang() === 'ar' : true; }
  function T(a, e) { return ar() ? a : e; }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast_(m) { if (typeof toast === 'function') toast(m); }
  function $q(s) { return document.querySelector(s); }
  function val(id) { var e = $q('#' + id); return e ? e.value : ''; }
  function num(x) { var n = Number(String(x).replace(/[٠-٩]/g, function (d) { return d.charCodeAt(0) - 1632; }).replace('٫', '.').replace(',', '.')); return isFinite(n) ? n : NaN; }
  function fmtDT(d, t) { if (!d && !t) return ''; var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''), days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']; return '📅 ' + (m ? days[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] + ' ' + m[1] + '-' + m[2] + '-' + m[3] : '') + (t ? ' 🕐 ' + String(t).slice(0, 5) : ''); }
  function fmt(n) { return n == null ? '—' : String(Math.round(Number(n) * 100) / 100); }

  var DEF = [
    { id: 'c1', name: 'المؤهل العلمي (البكالوريوس)', type: 'obj', weight: 10, calc: 'degree', method: 'تُحسب من جدول المؤهلات (حد أقصى 10 درجات: 60-69=3-4، 70-79=5-6، 80-89=7-8، 90-99=9-10)' },
    { id: 'c2', name: 'المؤهل العلمي (الماجستير)', type: 'obj', weight: 10, calc: 'degree', method: 'تُحسب من جدول المؤهلات (حد أقصى 10 درجات: 60-69=3-4، 70-79=5-6، 80-89=7-8، 90-99=9-10)' },
    { id: 'c3', name: 'الخبرة التدريسية الجامعية', type: 'obj', weight: 5, calc: 'years', method: 'سنوات الخبرة (حد أقصى 5 درجات: 3 سنوات = 3 درجات وكل سنة بدرجة)' },
    { id: 'c4', name: 'الخبرة في كلية فلسطين', type: 'obj', weight: 5, calc: 'years', method: 'سنوات الخبرة (حد أقصى 5 درجات: 3 سنوات = 3 درجات وكل سنة بدرجة)' },
    { id: 'c5', name: 'خطة الموظف', type: 'com', weight: 20, method: 'عرض خطة موحدة المدة: واقعيتها، قابليتها للقياس، ارتباطها باحتياجات القسم' },
    { id: 'c6', name: 'القيادة والتواصل وإدارة الفريق', type: 'com', weight: 20, method: 'أسئلة سلوكية موحدة عن مواقف قيادية فعلية، مع طلب أمثلة وأدلة' },
    { id: 'c7', name: 'حل المشكلات (دراسة حالة موحدة)', type: 'com', weight: 10, method: 'حالة واحدة لجميع المتقدمين: جودة التحليل والقرار المقترح' },
    { id: 'c8', name: 'المرجعيات والنزاهة والالتزام المؤسسي', type: 'com', weight: 10, method: 'التحقق من المرجعيات والسجل المهني والالتزام بالأنظمة' },
    { id: 'c9', name: 'الملاءمة للتخصص واحتياجات القسم', type: 'com', weight: 10, method: 'مدى انسجام تخصص المتقدم وخبرته مع أولويات القسم' }];
  var V = { loaded: false, busy: false, err: '', msg: '', bad: false, tab: '', list: [], sid: 0, det: null, staff: [], form: null, crit: null, my: [], mine: [], open: {}, dr: {} };

  function role() { return window.IV || {}; }
  window.ivView = function () { return '<div id="iv-root"></div>'; };
  window.ivMount = function () { if (!V.tab) V.tab = role().manage ? 'manage' : role().evaluator ? 'eval' : 'mine'; draw(); if (!V.loaded) load(); };
  function say(m, bad) { V.msg = m || ''; V.bad = !!bad; }
  function run(fn) { V.busy = true; V.err = ''; return Promise.resolve().then(fn).catch(function (e) { V.err = (e && e.message) || String(e); }).then(function () { V.busy = false; draw(); }); }
  async function rpc(n, a) { var r = await sb().rpc(n, a || {}); if (r.error) throw new Error(r.error.message); return r.data; }

  async function load() {
    if (!sb()) return; V.busy = true; V.err = ''; draw();
    try {
      var r = role();
      if (r.manage) { V.list = (await rpc('iv_admin_list')) || []; if (!V.sid && V.list[0]) V.sid = V.list[0].id; if (V.sid) V.det = await rpc('iv_admin_detail', { p_session: V.sid }); }
      if (r.evaluator) V.my = (await rpc('iv_my_eval')) || [];
      if (r.candidate) V.mine = (await rpc('iv_my_results')) || [];
      V.loaded = true;
    } catch (e) { V.err = (e && e.message) || String(e); if (/iv_|schema cache|does not exist/i.test(V.err)) V.err += ' — ' + T('شغّل interviews.sql في Supabase أولاً.', 'Run interviews.sql first.'); }
    V.busy = false; draw();
  }
  async function reloadAll() { V.loaded = false; await load(); }

  /* ---------- العرض ---------- */
  function tabs() {
    var r = role(), t = [];
    if (r.manage) t.push(['manage', T('إدارة المقابلات', 'Manage')]);
    if (r.evaluator) t.push(['eval', T('تقييماتي (لجنة)', 'My evaluations')]);
    if (r.candidate) t.push(['mine', T('نتيجتي', 'My result')]);
    if (t.length < 2) return '';
    return '<div class="cm-tabs" style="margin:0 0 10px">' + t.map(function (x) { return '<button class="btn sm' + (V.tab === x[0] ? ' pri' : '') + '" data-act="iv-tab" data-t="' + x[0] + '">' + h(x[1]) + '</button>'; }).join('') + '</div>';
  }
  function draw() {
    var el = document.getElementById('iv-root'); if (!el) return;
    el.innerHTML = tabs() + (V.err ? '<p class="pill bad">' + h(V.err) + '</p>' : '') + (V.msg ? '<p class="pill ' + (V.bad ? 'bad' : 'ok') + '">' + h(V.msg) + '</p>' : '') + (V.busy ? '<p class="sub">…</p>' : '') +
      (V.tab === 'manage' ? managePane() : V.tab === 'eval' ? evalPane() : minePane());
  }
  function sessBar() {
    return '<div class="card"><div class="form"><label style="grid-column:1/-1">' + h(T('المقابلة', 'Interview')) + '<select data-iv="sid">' +
      (V.list.map(function (s) { return '<option value="' + s.id + '"' + (s.id === V.sid ? ' selected' : '') + '>' + h(s.title + (s.status === 'closed' ? ' — ' + T('مغلقة', 'closed') : '')) + '</option>'; }).join('') || '<option value="">—</option>') + '</select></label></div>' +
      (V.det && fmtDT(V.det.session.iv_date, V.det.session.iv_time) ? '<div class="sub" style="margin:6px 0">' + h(fmtDT(V.det.session.iv_date, V.det.session.iv_time)) + '</div>' : '') +
      '<div class="tabs"><button class="btn sm pri" data-act="iv-new">+ ' + h(T('مقابلة جديدة', 'New interview')) + '</button>' +
      (V.det ? ' <button class="btn sm" data-act="iv-editform">' + h(T('إعدادات المعايير والأوزان', 'Criteria & weights')) + '</button> <button class="btn sm" data-act="iv-toggle">' + h(V.det.session.status === 'open' ? T('إغلاق المقابلة', 'Close') : T('إعادة فتح', 'Reopen')) + '</button> <button class="btn sm bad" data-act="iv-del" data-confirm="1">' + h(T('حذف', 'Delete')) + '</button>' : '') + '</div></div>';
  }
  function critEditor() {
    var f = V.form, rows = V.crit, tot = rows.reduce(function (a, c) { return a + (num(c.weight) || 0); }, 0);
    return '<div class="card" style="border:2px solid var(--accent,#0b8a97)"><b>' + h(f.id ? T('تعديل المقابلة', 'Edit interview') : T('مقابلة جديدة', 'New interview')) + '</b><div class="form">' +
      '<label style="grid-column:1/-1">' + h(T('العنوان (مثل: مقابلة وظيفة محاضر)', 'Title')) + '<input id="iv-title" maxlength="160" value="' + h(f.title || '') + '"></label>' +
      '<label>' + h(T('تاريخ المقابلة', 'Interview date')) + '<input id="iv-date" type="date" value="' + h(f.iv_date || '') + '"></label><label>' + h(T('ساعة المقابلة', 'Time')) + '<input id="iv-time" type="time" value="' + h(String(f.iv_time || '').slice(0, 5)) + '"></label>' +
      '<label style="grid-column:1/-1">' + h(T('ملاحظات', 'Notes')) + '<textarea id="iv-notes" rows="2" maxlength="1000">' + h(f.notes || '') + '</textarea></label>' +
      '<label style="grid-column:1/-1">' + h(T('عرض الدرجة النهائية للمرشح', 'Show final grade to candidate')) + '<select id="iv-mode"><option value="auto"' + (f.release_mode === 'auto' ? ' selected' : '') + '>' + h(T('مباشرة بعد أن يُكمل كل أعضاء اللجنة تقييمهم', 'Right after all committee members finish')) + '</option><option value="admin"' + (f.release_mode !== 'auto' ? ' selected' : '') + '>' + h(T('مؤجَّلة حتى أوافق أنا (الإدارة) على كل مرشح', 'Postponed until admin approves each candidate')) + '</option></select></label></div>' +
      '<b style="display:block;margin-top:8px">' + h(T('المعايير والأوزان', 'Criteria & weights')) + '</b><p class="sub">' + h(T('«موضوعي» تُدخله الإدارة مرة واحدة للمرشح؛ «لجنة» يُقيّمه كل عضو، ويُؤخذ المتوسط. الوزن = أقصى درجة للمعيار. إن لم يكن المجموع 100 تُحوَّل النتيجة إلى نسبة من 100.', 'Objective: entered once by admin. Committee: scored by each member (average). Weight = max points. If the total is not 100 the result is converted to a percentage.')) + '</p>' +
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>' + h(T('المعيار', 'Criterion')) + '</th><th>' + h(T('النوع', 'Type')) + '</th><th>' + h(T('الوزن', 'Weight')) + '</th><th>' + h(T('طريقة التقييم', 'Method')) + '</th><th></th></tr></thead><tbody>' +
      rows.map(function (c, i) {
        return '<tr><td><input data-ivc="' + i + ':name" value="' + h(c.name) + '" maxlength="160" style="min-width:150px"></td><td><select data-ivc="' + i + ':type"><option value="obj"' + (c.type === 'obj' ? ' selected' : '') + '>' + h(T('موضوعي', 'Objective')) + '</option><option value="com"' + (c.type === 'com' ? ' selected' : '') + '>' + h(T('لجنة', 'Committee')) + '</option></select></td>' +
          '<td><input data-ivc="' + i + ':weight" type="number" min="0" max="1000" step="0.5" value="' + h(c.weight) + '" style="width:72px"></td><td><input data-ivc="' + i + ':method" value="' + h(c.method || '') + '" maxlength="400" style="min-width:200px"></td>' +
          '<td><button class="btn sm bad" data-act="iv-crem" data-i="' + i + '">✕</button></td></tr>';
      }).join('') + '</tbody></table></div><div class="tabs" style="margin-top:6px"><button class="btn sm" data-act="iv-cadd">+ ' + h(T('معيار', 'Criterion')) + '</button> <button class="btn sm" data-act="iv-cdef">' + h(T('استرجاع المعايير الافتراضية', 'Restore defaults')) + '</button> <b id="iv-tot" class="pill ' + (tot === 100 ? 'ok' : 'warn') + '">' + h(T('المجموع: ', 'Total: ') + fmt(tot)) + '</b></div>' +
      '<div class="tabs" style="margin-top:8px"><button class="btn pri" data-act="iv-save">' + h(T('حفظ', 'Save')) + '</button> <button class="btn" data-act="iv-cancel">' + h(T('إلغاء', 'Cancel')) + '</button></div></div>';
  }
  function managePane() {
    var out = sessBar();
    if (V.form) out += critEditor();
    if (!V.det) return out + (V.list.length ? '' : '<div class="empty">' + h(T('لا مقابلات بعد. أنشئ أول مقابلة.', 'No interviews yet.')) + '</div>');
    var d = V.det, s = d.session, evIds = d.evaluators.map(function (e) { return e.user_id; }), candIds = d.candidates.map(function (c) { return c.user_id; });
    var tot = s.criteria.reduce(function (a, c) { return a + Number(c.weight); }, 0);
    out += '<div class="card"><b>👥 ' + h(T('لجنة التقييم', 'Committee')) + '</b> <span class="pill">' + evIds.length + '</span> <span class="sub">' + h(T('(الموصى به 4، ويمكن الزيادة أو النقصان)', '(4 recommended; add or remove freely)')) + '</span>' +
      '<input data-iv="staffq" placeholder="' + h(T('بحث عن موظف…', 'Search…')) + '" style="margin:6px 0"><div id="iv-evlist" style="max-height:220px;overflow:auto">' +
      V.staff.filter(function (p) { return candIds.indexOf(p.id) < 0; }).map(function (p) { return '<label class="ivrow" data-n="' + h(p.full_name) + '" style="display:flex;flex-direction:row;align-items:center;gap:8px;padding:4px 0"><input type="checkbox" class="iv-evc" style="width:auto" value="' + p.id + '"' + (evIds.indexOf(p.id) >= 0 ? ' checked' : '') + '> ' + h(p.full_name) + '</label>'; }).join('') +
      '</div><button class="btn sm pri" data-act="iv-evsave" style="margin-top:6px">' + h(T('حفظ اللجنة', 'Save committee')) + '</button></div>';
    var avail = V.staff.filter(function (p) { return candIds.indexOf(p.id) < 0 && evIds.indexOf(p.id) < 0; });
    out += '<div class="card"><b>🧑‍💼 ' + h(T('المرشحون', 'Candidates')) + '</b> <span class="pill">' + d.candidates.length + '</span><div class="form"><label>' + h(T('إضافة مرشح من الموظفين', 'Add from staff')) + '<select id="iv-cadd"><option value="">—</option>' + avail.map(function (p) { return '<option value="' + p.id + '">' + h(p.full_name) + '</option>'; }).join('') + '</select></label>' +
      '<label>' + h(T('أو اسم يدوي (بلا حساب)', 'Or a manual name')) + '<input id="iv-cname" maxlength="120"></label></div><button class="btn sm pri" data-act="iv-cand">+ ' + h(T('إضافة', 'Add')) + '</button>' +
      (Math.round(tot * 100) !== 10000 ? '<p class="pill warn">' + h(T('مجموع الأوزان ' + fmt(tot) + ' (تُحوَّل النتيجة إلى نسبة من 100)', 'Weights total ' + fmt(tot))) + '</p>' : '') + '</div>';
    var ranked = d.candidates.slice().sort(function (a, b) { return (Number(b.calc && b.calc.final) || -1) - (Number(a.calc && a.calc.final) || -1); });
    if (ranked.length) out += '<div class="card"><b>🏆 ' + h(T('الترتيب', 'Ranking')) + '</b> <button class="btn sm" data-act="iv-export">⬇ ' + h(T('تصدير النتائج Excel', 'Export results (Excel)')) + '</button><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><tbody>' + ranked.map(function (c, i) { return '<tr><td>' + (i + 1) + '</td><td>' + h(c.name) + '</td><td><b>' + fmt(c.calc && c.calc.final) + '</b></td><td>' + (c.calc && c.calc.complete ? '✔' : '…') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    out += d.candidates.map(function (c) { return candCard(c, s); }).join('');
    return out;
  }
  function calcHint(c) { return c.calc === 'degree' ? T('نسبة التخرج %', 'Grade %') : c.calc === 'years' ? T('سنوات', 'Years') : ''; }
  function candCard(k, s) {
    var cj = k.calc || {}, objc = s.criteria.filter(function (c) { return c.type === 'obj'; }), comc = s.criteria.filter(function (c) { return c.type === 'com'; });
    var open = V.open[k.id];
    return '<div class="card" style="margin:8px 0"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><div><b>' + h(k.name) + '</b> ' + (k.user_id ? '' : '<span class="pill">' + h(T('بلا حساب', 'no account')) + '</span>') + '</div>' +
      '<div><span class="pill ' + (cj.complete ? 'ok' : 'warn') + '">' + h(T('اعتمد ' + cj.nsub + ' من ' + cj.neval, cj.nsub + '/' + cj.neval + ' submitted')) + '</span> <b style="font-size:18px">' + fmt(cj.final) + '</b>/100</div></div>' +
      '<div class="sub">' + (k.visible ? '👁 ' + h(T('النتيجة ظاهرة للمرشح', 'Visible to candidate')) : '🙈 ' + h(T('النتيجة مخفية عن المرشح', 'Hidden from candidate'))) + '</div>' +
      '<div class="tabs" style="margin:6px 0"><button class="btn sm ' + (k.released ? 'bad' : 'pri') + '" data-act="iv-rel" data-id="' + k.id + '" data-v="' + (k.released ? 0 : 1) + '" data-confirm="1">' + h(k.released ? T('سحب العرض عن المرشح', 'Withdraw') : T('اعتماد عرض النتيجة للمرشح', 'Approve & show to candidate')) + '</button> ' +
      '<button class="btn sm" data-act="iv-open" data-id="' + k.id + '">' + h(open ? T('إخفاء التفاصيل', 'Hide details') : T('التفاصيل والدرجات', 'Details')) + '</button> <button class="btn sm bad" data-act="iv-cdel" data-id="' + k.id + '" data-confirm="1">' + h(T('حذف المرشح', 'Remove')) + '</button></div>' +
      (open ? '<div style="border-top:1px solid rgba(127,127,127,.25);padding-top:8px"><b>' + h(T('المعايير الموضوعية (تُدخلها الإدارة)', 'Objective criteria')) + '</b><div class="form">' +
        objc.map(function (c) { var v = k.obj && k.obj[c.id]; return '<label>' + h(c.name) + ' <span class="sub">/ ' + fmt(c.weight) + '</span><div style="display:flex;gap:6px"><input class="iv-obj" data-k="' + k.id + '" data-c="' + c.id + '" type="number" min="0" max="' + c.weight + '" step="0.5" value="' + (v == null ? '' : h(v)) + '" style="flex:1">' +
          (c.calc ? '<input data-ivcalc="' + k.id + ':' + c.id + ':' + c.calc + ':' + c.weight + '" type="number" step="0.5" placeholder="' + h(calcHint(c)) + '" style="width:110px" title="' + h(T('أدخل القيمة لاحتساب الدرجة تلقائياً', 'Enter to auto-fill points')) + '">' : '') + '</div></label>'; }).join('') + '</div>' +
        (objc.length ? '<button class="btn sm pri" data-act="iv-obj" data-id="' + k.id + '">' + h(T('حفظ الدرجات الموضوعية', 'Save objective scores')) + '</button>' : '') +
        '<b style="display:block;margin-top:10px">' + h(T('تقييم أعضاء اللجنة', 'Committee scores')) + '</b>' +
        (k.evals.map(function (e) {
          var sum = comc.reduce(function (a, c) { return a + (Number(e.scores[c.id]) || 0); }, 0);
          return '<div style="margin:6px 0;padding:6px;border:1px solid rgba(127,127,127,.25);border-radius:8px"><b>' + h(e.name) + '</b> ' + (e.submitted ? '<span class="pill ok">' + h(T('اعتمد', 'submitted')) + '</span> <button class="btn sm" data-act="iv-reopen" data-id="' + k.id + '" data-u="' + e.evaluator_id + '" data-confirm="1">' + h(T('إعادة فتح للتعديل', 'Reopen')) + '</button>' : Object.keys(e.scores).length ? '<span class="pill warn">' + h(T('مسودة', 'draft')) + '</span>' : '<span class="pill">' + h(T('لم يبدأ', 'not started')) + '</span>') +
            '<div class="sub">' + comc.map(function (c) { return h(c.name) + ': <b>' + (e.scores[c.id] == null ? '—' : fmt(e.scores[c.id])) + '</b>'; }).join(' · ') + ' — ' + h(T('المجموع ', 'Total ')) + fmt(sum) + '</div>' + (e.comment ? '<div class="sub">💬 ' + h(e.comment) + '</div>' : '') + '</div>';
        }).join('') || '<div class="sub">' + h(T('لا أعضاء في اللجنة بعد', 'No committee members yet')) + '</div>') + '</div>' : '') + '</div>';
  }
  function evalPane() {
    if (!V.my.length) return '<div class="card"><div class="empty">' + h(T('لست عضواً في أي لجنة حالياً', 'Not on any committee')) + '</div></div>';
    return V.my.map(function (s) {
      return '<div class="card"><h3 style="margin:0">' + h(s.title) + '</h3>' + (fmtDT(s.iv_date, s.iv_time) ? '<div class="sub">' + h(fmtDT(s.iv_date, s.iv_time)) + '</div>' : '') + (s.notes ? '<div class="sub">' + h(s.notes) + '</div>' : '') + (s.status === 'closed' ? '<p class="pill warn">' + h(T('المقابلة مغلقة', 'Closed')) + '</p>' : '') +
        '<p class="sub">' + h(T('أدخل درجة كل معيار (من 0 حتى الوزن). المعايير الموضوعية تدخلها الإدارة. بعد «الاعتماد النهائي» لا يمكن التعديل إلا بإعادة فتح من الإدارة.', 'Score each criterion (0 to its weight). Objective criteria are entered by admin. After final submit only admin can reopen.')) + '</p>' +
        s.candidates.map(function (k) {
          var ro = k.submitted || s.status !== 'open';
          return '<div class="card" style="margin:8px 0"><b>' + h(k.name) + '</b> ' + (k.submitted ? '<span class="pill ok">' + h(T('تم الاعتماد', 'Submitted')) + '</span>' : '') + '<div class="form">' +
            s.criteria.map(function (c) { return '<label>' + h(c.name) + ' <span class="sub">/ ' + fmt(c.weight) + '</span>' + (c.method ? '<span class="sub" style="display:block;font-size:12px">' + h(c.method) + '</span>' : '') + '<input class="iv-ev" data-k="' + k.id + '" data-c="' + c.id + '" type="number" min="0" max="' + c.weight + '" step="0.5" value="' + (V.dr[k.id + ':' + c.id] != null ? h(V.dr[k.id + ':' + c.id]) : k.scores[c.id] == null ? '' : h(k.scores[c.id])) + '"' + (ro ? ' disabled' : '') + '></label>'; }).join('') +
            '<label style="grid-column:1/-1">' + h(T('ملاحظات (اختياري)', 'Comments (optional)')) + '<textarea id="ivc-' + k.id + '" rows="2" maxlength="1000"' + (ro ? ' disabled' : '') + '>' + h(k.comment || '') + '</textarea></label></div>' +
            (ro ? '' : '<div class="tabs"><button class="btn sm" data-act="iv-esave" data-id="' + k.id + '" data-s="0">' + h(T('حفظ مسودة', 'Save draft')) + '</button> <button class="btn sm pri" data-act="iv-esave" data-id="' + k.id + '" data-s="1" data-confirm="1">' + h(T('الاعتماد النهائي', 'Final submit')) + '</button></div>') + '</div>';
        }).join('') + '</div>';
    }).join('');
  }
  function minePane() {
    if (!V.mine.length) return '<div class="card"><div class="empty">' + h(T('لا توجد مقابلات خاصة بك', 'No interviews for you')) + '</div></div>';
    return V.mine.map(function (r) {
      if (!r.visible) return '<div class="card"><b>' + h(r.title) + '</b> <span class="sub">' + h(fmtDT(r.iv_date, r.iv_time)) + '</span><p class="pill warn">⏳ ' + h(T('النتيجة قيد الاعتماد — ستظهر هنا عند إتاحتها من الإدارة.', 'Result pending approval — it will appear here.')) + '</p></div>';
      return '<div class="card"><b>' + h(r.title) + '</b> <span class="sub">' + h(fmtDT(r.iv_date, r.iv_time)) + '</span><div style="font-size:34px;font-weight:700;margin:6px 0">' + fmt(r.final) + ' <span class="sub" style="font-size:16px">/ 100</span></div>' +
        '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>' + h(T('المعيار', 'Criterion')) + '</th><th>' + h(T('الدرجة', 'Score')) + '</th><th>' + h(T('من', 'Out of')) + '</th></tr></thead><tbody>' +
        r.rows.map(function (c) { return '<tr><td>' + h(c.name) + '</td><td><b>' + fmt(c.points) + '</b></td><td>' + fmt(c.weight) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    }).join('');
  }


  /* ---------- تصدير النتائج النهائية (Excel) مرتبة من الأعلى إلى الأدنى ---------- */
  function saveBlob(name, blob) { var u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); }
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function (res, rej) { var sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; sc.onload = res; sc.onerror = function () { rej(new Error('xlsx')); }; document.head.appendChild(sc); });
  }
  function exportRows() {
    var d = V.det, s = d.session, hasF = function (c) { return c.calc && c.calc.final != null; };
    var list = d.candidates.slice().sort(function (a, b) { return (hasF(b) ? Number(b.calc.final) : -1) - (hasF(a) ? Number(a.calc.final) : -1); });
    var head = [T('الترتيب', 'Rank'), T('الاسم', 'Name')].concat(s.criteria.map(function (c) { return c.name + ' (' + fmt(c.weight) + ')'; }), [T('المجموع', 'Total'), T('المجموع الكلي الممكن', 'Max'), T('النتيجة من 100', 'Result /100'), T('اعتمد من اللجنة', 'Submitted'), T('اكتمال التقييم', 'Complete'), T('الظهور للمرشح', 'Visible to candidate')]);
    var rows = [[s.title + (s.iv_date ? ' — ' + s.iv_date + (s.iv_time ? ' ' + String(s.iv_time).slice(0, 5) : '') : '')], head];
    list.forEach(function (k, i) {
      var cj = k.calc || {}, byId = {}; (cj.rows || []).forEach(function (r) { byId[r.id] = r.points; });
      rows.push([hasF(k) ? i + 1 : '', k.name].concat(s.criteria.map(function (c) { return byId[c.id] == null ? '' : Number(byId[c.id]); }), [cj.total == null ? '' : Number(cj.total), cj.max == null ? '' : Number(cj.max), hasF(k) ? Number(cj.final) : '', (cj.nsub || 0) + '/' + (cj.neval || 0), cj.complete ? T('نعم', 'Yes') : T('لا', 'No'), k.visible ? T('ظاهرة', 'Yes') : T('مخفية', 'No')]));
    });
    return rows;
  }
  async function doExport() {
    if (!V.det) return;
    var rows = exportRows(), lab = String(V.det.session.title).replace(/[\\/:*?"<>|\s]+/g, '-'), name = 'نتائج-' + lab + '-' + new Date().toISOString().slice(0, 10);
    try {
      await loadXlsx();
      var ws = window.XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = [{ wch: 9 }, { wch: 28 }].concat(V.det.session.criteria.map(function () { return { wch: 16 }; }), [{ wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }]);
      ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
      var wb = window.XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; window.XLSX.utils.book_append_sheet(wb, ws, T('النتائج', 'Results'));
      saveBlob(name + '.xlsx', new Blob([window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' }));
    } catch (e) {
      var csv = '﻿' + rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
      saveBlob(name + '.csv', new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    }
  }

  /* ---------- أفعال ---------- */
  function newForm() { V.form = { id: null, title: '', notes: '', release_mode: 'admin', iv_date: '', iv_time: '' }; V.crit = DEF.map(function (c) { return Object.assign({}, c); }); draw(); }
  function curSess() { return V.det && V.det.session; }
  function readForm() {
    var title = val('iv-title').trim(); if (!title) { toast_(T('اكتب العنوان', 'Enter a title')); return null; }
    var cr = V.crit.map(function (c) { return { id: c.id, name: String(c.name || '').trim(), type: c.type, weight: num(c.weight), calc: c.calc || null, method: String(c.method || '').trim() }; });
    for (var i = 0; i < cr.length; i++) { if (!cr[i].name || !(cr[i].weight >= 0)) { toast_(T('أكمل اسم ووزن كل معيار', 'Complete every criterion')); return null; } }
    if (!cr.length) { toast_(T('أضف معياراً واحداً على الأقل', 'Add a criterion')); return null; }
    return { title: title, notes: val('iv-notes').trim() || null, mode: val('iv-mode'), crit: cr, date: val('iv-date') || null, time: val('iv-time') || null };
  }
  function degPts(p, w) { var v = p >= 95 ? 10 : p >= 90 ? 9 : p >= 85 ? 8 : p >= 80 ? 7 : p >= 75 ? 6 : p >= 70 ? 5 : p >= 65 ? 4 : p >= 60 ? 3 : 0; return Math.min(v, w); }
  var ACTS = {
    'iv-export': function () { doExport(); },
    'iv-tab': function (el) { V.tab = el.dataset.t; draw(); },
    'iv-new': function () { newForm(); },
    'iv-editform': function () { var s = curSess(); if (!s) return; V.form = { id: s.id, title: s.title, notes: s.notes, release_mode: s.release_mode, iv_date: s.iv_date, iv_time: s.iv_time }; V.crit = s.criteria.map(function (c) { return Object.assign({}, c); }); draw(); },
    'iv-cancel': function () { V.form = null; V.crit = null; draw(); },
    'iv-cadd': function () { var n = 1; V.crit.forEach(function (c) { var m = /^x(\d+)$/.exec(c.id); if (m) n = Math.max(n, Number(m[1]) + 1); }); V.crit.push({ id: 'x' + n, name: '', type: 'com', weight: 10, method: '' }); draw(); },
    'iv-crem': function (el) { V.crit.splice(Number(el.dataset.i), 1); draw(); },
    'iv-cdef': function () { V.crit = DEF.map(function (c) { return Object.assign({}, c); }); draw(); },
    'iv-save': function () {
      var f = readForm(); if (!f) return;
      run(async function () { var id = await rpc('iv_session_save', { p_id: V.form.id, p_title: f.title, p_notes: f.notes, p_criteria: f.crit, p_mode: f.mode, p_status: null, p_date: f.date, p_time: f.time }); V.sid = Number(id); V.form = null; V.crit = null; say(T('تم الحفظ', 'Saved')); await reloadAll(); });
    },
    'iv-toggle': function () { var s = curSess(); if (!s) return; run(async function () { await rpc('iv_session_save', { p_id: s.id, p_title: s.title, p_notes: s.notes, p_criteria: s.criteria, p_mode: s.release_mode, p_status: s.status === 'open' ? 'closed' : 'open' }); await reloadAll(); }); },
    'iv-del': function () { var s = curSess(); if (!s) return; run(async function () { await rpc('iv_session_delete', { p_id: s.id }); V.sid = 0; V.det = null; say(T('حُذفت المقابلة', 'Deleted')); await reloadAll(); }); },
    'iv-evsave': function () { var ids = Array.prototype.map.call(document.querySelectorAll('.iv-evc:checked'), function (x) { return x.value; }); run(async function () { await rpc('iv_set_evaluators', { p_session: V.sid, p_users: ids }); say(T('حُفظت اللجنة (' + ids.length + ')', 'Committee saved (' + ids.length + ')')); await reloadAll(); }); },
    'iv-cand': function () { var u = val('iv-cadd') || null, n = val('iv-cname').trim() || null; if (!u && !n) { toast_(T('اختر موظفاً أو اكتب اسماً', 'Pick or type a name')); return; } run(async function () { await rpc('iv_cand_add', { p_session: V.sid, p_user: u, p_name: n }); say(T('أُضيف المرشح', 'Added')); await reloadAll(); }); },
    'iv-cdel': function (el) { run(async function () { await rpc('iv_cand_delete', { p_cand: Number(el.dataset.id) }); await reloadAll(); }); },
    'iv-open': function (el) { V.open[el.dataset.id] = !V.open[el.dataset.id]; draw(); },
    'iv-obj': function (el) {
      var id = Number(el.dataset.id), o = {};
      Array.prototype.forEach.call(document.querySelectorAll('.iv-obj[data-k="' + id + '"]'), function (i) { if (i.value !== '') { var n = num(i.value); if (isFinite(n)) o[i.dataset.c] = n; } });
      run(async function () { await rpc('iv_cand_obj', { p_cand: id, p_obj: o }); say(T('حُفظت الدرجات الموضوعية', 'Saved')); await reloadAll(); });
    },
    'iv-rel': function (el) { run(async function () { await rpc('iv_release', { p_cand: Number(el.dataset.id), p_on: el.dataset.v === '1' }); say(el.dataset.v === '1' ? T('أُتيحت النتيجة للمرشح', 'Result shown to candidate') : T('سُحبت النتيجة عن المرشح', 'Result hidden')); await reloadAll(); }); },
    'iv-reopen': function (el) { run(async function () { await rpc('iv_reopen', { p_cand: Number(el.dataset.id), p_evaluator: el.dataset.u }); await reloadAll(); }); },
    'iv-esave': function (el) {
      var id = Number(el.dataset.id), sc = {};
      Array.prototype.forEach.call(document.querySelectorAll('.iv-ev[data-k="' + id + '"]'), function (i) { if (i.value !== '') { var n = num(i.value); if (isFinite(n)) sc[i.dataset.c] = n; } });
      var sub = el.dataset.s === '1', cm = val('ivc-' + id);
      run(async function () {
        var r = await rpc('iv_eval_save', { p_cand: id, p_scores: sc, p_comment: cm, p_submit: sub });
        if (!r.ok) { var m = { range: T('الدرجة خارج الوزن في «' + (r.name || '') + '» (الأقصى ' + r.max + ')', 'Out of range'), missing: T('أكمل درجة «' + (r.name || '') + '» قبل الاعتماد', 'Complete: ' + r.name), submitted: T('تم اعتماد هذا التقييم مسبقاً', 'Already submitted'), closed: T('المقابلة مغلقة', 'Closed'), notmember: T('لست في اللجنة', 'Not on the committee') }; say(m[r.err] || T('تعذّر الحفظ', 'Could not save'), true); }
        else say(sub ? T('تم الاعتماد النهائي', 'Submitted') : T('حُفظت المسودة', 'Draft saved'));
        V.my = (await rpc('iv_my_eval')) || []; if (r.ok) Object.keys(V.dr).forEach(function (kk) { if (kk.split(':')[0] === String(id)) delete V.dr[kk]; });
      });
    }
  };
  document.addEventListener('change', function (e) {
    var t = e.target, k = t && t.dataset && t.dataset.iv;
    if (k === 'sid') { V.sid = Number(t.value) || 0; V.form = null; run(async function () { V.det = V.sid ? await rpc('iv_admin_detail', { p_session: V.sid }) : null; }); }
  });
  document.addEventListener('input', function (e) {
    var t = e.target, d = t && t.dataset; if (!d) return;
    if (d.ivc) { var p = d.ivc.split(':'), c = V.crit && V.crit[Number(p[0])]; if (c) { c[p[1]] = t.value; if (p[1] === 'weight') { var tot = V.crit.reduce(function (a, x) { return a + (num(x.weight) || 0); }, 0), b = document.getElementById('iv-tot'); if (b) { b.textContent = T('المجموع: ', 'Total: ') + fmt(tot); b.className = 'pill ' + (tot === 100 ? 'ok' : 'warn'); } } } }
    else if (d.ivcalc) { var q = d.ivcalc.split(':'), v = num(t.value), box = document.querySelector('.iv-obj[data-k="' + q[0] + '"][data-c="' + q[1] + '"]'), w = Number(q[3]); if (box && isFinite(v)) box.value = q[2] === 'degree' ? degPts(v, w) : Math.min(Math.max(v, 0), w); }
    else if (t.classList && t.classList.contains('iv-ev')) V.dr[d.k + ':' + d.c] = t.value;
    else if (d.iv === 'staffq') { var s = String(t.value).trim().toLowerCase(); Array.prototype.forEach.call(document.querySelectorAll('#iv-evlist .ivrow'), function (r) { r.style.display = !s || (r.dataset.n || '').toLowerCase().indexOf(s) >= 0 ? 'flex' : 'none'; }); }
  });
  /* تحميل قائمة الموظفين عند أول عرض لحساب إداري */
  var _mount = window.ivMount;
  window.ivMount = function () { _mount(); if (role().manage && !V.staff.length && !V._st) { V._st = 1; rpc('iv_staff_list').then(function (r) { V.staff = r || []; draw(); }).catch(function () {}); } };
  window.EXTRA_ACT = window.EXTRA_ACT || {};
  Object.keys(ACTS).forEach(function (k) { window.EXTRA_ACT[k] = ACTS[k]; });
})();
