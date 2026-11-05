/* takaful.js: «التكافل» داخل المشاريع (للمدير الرئيسي وحده): تدوين مساهمات موظفي المشاريع وتوزيعها على الزملاء بلا مشروع. */
(function () {
  'use strict';
  var PA = function () { return window.PLANNER_AUTH || null; };
  function sb() { return PA() && PA().sb(); }
  function ar() { return PA() ? PA().lang() === 'ar' : true; }
  function T(a, e) { return ar() ? a : e; }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isMain() { return !!(window.CAN && window.CAN('tk')); }
  function hasProj() { return !!(window.CAN && window.CAN('proj')); }
  function $q(s) { return document.querySelector(s); }
  function val(id) { var e = $q('#' + id); return e ? e.value : ''; }
  function num(n) { return Number(n) || 0; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  var CUR = { ILS: '₪', USD: '$', JOD: 'د.أ', EUR: '€' };
  function money(n, c) { return (Math.round(num(n) * 100) / 100).toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ' + (CUR[c] || CUR.ILS); }
  var K = { pay: '', on: false, rounds: [], items: [], emps: [], sel: null, form: false, loaded: false, busy: false, err: '', ok: '' };

  window.takafulOn = function () { return isMain() && (K.on || !hasProj()); };
  window.takafulGo = function () { K.on = true; K.sel = null; };
  window.takafulEnsure = function () { if (!K.loaded && !K.busy) load(); };
  function redraw() { if (typeof window.projDraw === 'function') window.projDraw(); }
  async function load() {
    if (!isMain() || !sb()) return;
    K.busy = true; K.err = ''; redraw();
    try {
      var r = await sb().from('tk_rounds').select('*').order('round_date', { ascending: false }).order('id', { ascending: false }).limit(500); if (r.error) throw r.error;
      var i = await sb().from('tk_items').select('*').order('id', { ascending: true }).limit(20000); if (i.error) throw i.error;
      K.rounds = r.data || []; K.items = i.data || [];
      try { var st = await sb().from('tk_settings').select('*').limit(1); if (!st.error && st.data && st.data[0]) K.pay = st.data[0].pay_info || ''; } catch (e3) {}
      var e = await sb().from('external_projects').select('id,full_name,employee_number,has_project').order('full_name', { ascending: true }).limit(2000);
      K.emps = e.error ? [] : (e.data || []);
      K.loaded = true;
    } catch (e2) { K.err = (e2 && e2.message) || String(e2); if (/tk_|schema cache|does not exist|relation/i.test(K.err)) K.err += ' — ' + T('شغّل takaful.sql في Supabase أولاً.', 'Run takaful.sql in Supabase first.'); }
    K.busy = false; redraw();
  }
  async function guard(fn) { try { K.err = ''; K.ok = ''; await fn(); } catch (e) { K.err = (e && e.message) || String(e); } K.busy = false; redraw(); }

  function sums(r) {
    var it = K.items.filter(function (x) { return x.round_id === r.id; }), s = { inT: 0, inD: 0, outT: 0, outD: 0, nIn: 0, nOut: 0, extT: 0, extD: 0 };
    it.forEach(function (x) { if (x.kind === 'in') { s.nIn++; s.inT += num(x.amount); if (x.done) s.inD += num(x.amount); if (x.ext) { s.extT += num(x.amount); if (x.done) s.extD += num(x.amount); } } else { s.nOut++; s.outT += num(x.amount); if (x.done) s.outD += num(x.amount); } });
    s.bal = s.inD - s.outD; return s;
  }
  function box(label, value, cls) { return '<div class="card" style="flex:1;min-width:140px;padding:10px 12px"><div class="sub">' + h(label) + '</div><div style="font-size:18px;font-weight:700" class="' + (cls || '') + '">' + h(value) + '</div></div>'; }
  function summary(r) {
    var s = sums(r), c = r.currency;
    return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">' + box(T('تعهّدات المساهمين', 'Pledged'), money(s.inT, c)) + box(T('المستلَم فعلاً', 'Received'), money(s.inD, c)) + (s.extT ? box(T('منها مساهمات خارجية', 'of which external'), money(s.extT, c)) : '') + box(T('المخصّص للمستفيدين', 'Allocated'), money(s.outT, c)) + box(T('المصروف فعلاً', 'Paid out'), money(s.outD, c)) +
      box(T('الرصيد بيدك', 'Balance on hand'), money(s.bal, c), s.bal < 0 ? 'ex-late' : '') + '</div>' +
      (s.outT > s.inT + 0.0001 ? '<p class="pill warn">' + h(T('تنبيه: المخصّص للمستفيدين أكبر من تعهّدات المساهمين.', 'Allocated exceeds pledged.')) + '</p>' : '');
  }
  function itemRow(x, c) {
    var inn = x.kind === 'in';
    return '<div class="row"><div class="main"><div class="t">' + h(x.person) + (x.done ? ' <span class="pill ok">' + h(inn ? T('مستلَم', 'Received') : T('مصروف', 'Paid')) + '</span>' : ' <span class="pill">' + h(inn ? T('لم يُستلم', 'Pending') : T('لم يُصرف', 'Pending')) + '</span>') + (x.ext ? ' <span class="pill">' + h(x.ext === 'course' ? T('رسوم دورة تدريبية', 'Course fees') : T('تبرع خارجي', 'External donation')) + '</span>' : '') + (x.src === 'self' ? ' <span class="pill">' + h(T('تعهّد من الموظف نفسه', 'Pledged by the employee')) + '</span>' : '') + (!inn && x.recv_confirmed ? ' <span class="pill ok">' + h(T('أكّد الاستلام', 'Confirmed receipt')) + '</span>' : '') + '</div></div>' +
      '<div class="act"><input type="number" step="0.01" min="0" inputmode="decimal" style="width:110px" data-tk="amt" data-id="' + x.id + '" value="' + h(x.amount) + '" title="' + h(T('المبلغ', 'Amount')) + '"> <label class="ck"><input type="checkbox" data-tk="done" data-id="' + x.id + '"' + (x.done ? ' checked' : '') + '> ' + h(inn ? T('استُلم', 'Received') : T('صُرف', 'Paid')) + '</label> ' +
      '<button class="btn sm bad" data-act="tk-del" data-id="' + x.id + '" data-confirm="1">' + h(T('حذف', 'Delete')) + '</button></div></div>';
  }
  function addBox(r, kind) {
    var used = {}; K.items.forEach(function (x) { if (x.round_id === r.id && x.kind === kind) used[(x.emp || '') + '|' + x.person] = 1; });
    var free = function (e) { return !used[(e.employee_number || '') + '|' + e.full_name]; }, wp = K.emps.filter(function (e) { return !!e.has_project && free(e); }), np = K.emps.filter(function (e) { return !e.has_project && free(e); });
    var optH = function (l) { return l.map(function (e) { return '<option value="' + e.id + '">' + h(e.full_name) + '</option>'; }).join(''); };
    return '<div class="form" style="margin-top:8px"><label>' + h(kind === 'in' ? T('موظف (على مشروع أو بلا مشروع)', 'Employee (with or without a project)') : T('زميل بلا مشروع', 'Colleague without a project')) + '<select id="tk-p-' + kind + '"><option value="">—</option>' + (kind === 'in' ? '<optgroup label="' + h(T('على مشروع', 'With a project')) + '">' + optH(wp) + '</optgroup><optgroup label="' + h(T('بلا مشروع', 'Without a project')) + '">' + optH(np) + '</optgroup>' : optH(np)) + '</select></label>' +
      '<label>' + h(T('أو اسم آخر', 'Or other name')) + '<input id="tk-n-' + kind + '"></label>' +
      '<label>' + h(T('المبلغ', 'Amount')) + '<input id="tk-a-' + kind + '" type="number" step="0.01" min="0" inputmode="decimal"></label>' +
      '<div style="align-self:end"><button class="btn pri" data-act="tk-add" data-r="' + r.id + '" data-k="' + kind + '">+ ' + h(T('إضافة', 'Add')) + '</button> <button class="btn sm" data-act="tk-addall" data-r="' + r.id + '" data-k="' + kind + '">' + h(kind === 'in' ? T('إضافة كل أصحاب المشاريع', 'Add all with projects') : T('إضافة كل من بلا مشروع', 'Add all without projects')) + '</button></div></div>';
  }
  function detail(r) {
    var its = K.items.filter(function (x) { return x.round_id === r.id; }), ins = its.filter(function (x) { return x.kind === 'in' && !x.ext; }), exts = its.filter(function (x) { return x.kind === 'in' && x.ext; }), outs = its.filter(function (x) { return x.kind === 'out'; });
    return summary(r) +
      '<div class="tabs"><button class="btn sm' + (r.accepting ? ' pri' : '') + '" data-act="tk-accept" data-id="' + r.id + '">' + h(r.accepting ? '📣 ' + T('باب التبرع مفتوح للموظفين (اضغط للإغلاق)', 'Pledging open (click to close)') : '🔒 ' + T('فتح باب التبرع للموظفين', 'Open pledging to staff')) + '</button> <button class="btn sm' + (r.show_status ? ' pri' : '') + '" data-act="tk-show" data-id="' + r.id + '">' + h(r.show_status ? '👁 ' + T('التوزيع منشور للمستفيدين (اضغط للإخفاء)', 'Distribution published (click to hide)') : '🙈 ' + T('نشر التوزيع للمستفيدين', 'Publish distribution to beneficiaries')) + '</button> ' +
      '<button class="btn sm" data-act="tk-lock" data-id="' + r.id + '">' + h(r.closed ? T('إعادة فتح الدورة', 'Reopen') : T('إغلاق الدورة', 'Close round')) + '</button> <button class="btn sm" data-act="tk-xlsx" data-id="' + r.id + '">⬇ Excel</button> <button class="btn sm bad" data-act="tk-delround" data-id="' + r.id + '" data-confirm="1">' + h(T('حذف الدورة', 'Delete round')) + '</button></div>' +
      '<p class="sub">' + h(T('عند فتح باب التبرع يظهر زر «التكافل» للموظفين فيتعهّد كل واحد بمبلغه ويرى رسالة الشكر وبيانات التحويل. وعند نشر التوزيع يرى كل مستفيد نصيبه الذي حددته أنت وإجمالي المتبرَّع به ويؤكد استلامه، ولا يرى أحد بيانات غيره.', 'Open pledging so staff can pledge from the Takaful button; publish the distribution so beneficiaries see their share and confirm receipt.')) + '</p>' +
      '<h3>' + h(T('المساهمون (موظفو المشاريع)', 'Contributors')) + ' <span class="pill">' + ins.length + '</span></h3><div class="list">' + (ins.map(function (x) { return itemRow(x, r.currency); }).join('') || '<div class="empty">—</div>') + '</div>' + (r.closed ? '' : addBox(r, 'in')) +
      '<h3>' + h(T('مساهمات خارجية (تبرعات، دورات تدريبية)', 'External contributions (donations, training courses)')) + ' <span class="pill">' + exts.length + '</span></h3><div class="list">' + (exts.map(function (x) { return itemRow(x, r.currency); }).join('') || '<div class="empty">—</div>') + '</div>' +
      (r.closed ? '' : '<div class="form" style="margin-top:8px"><label>' + h(T('النوع', 'Type')) + '<select id="tk-xt"><option value="donation">' + h(T('تبرع خارجي', 'External donation')) + '</option><option value="course">' + h(T('رسوم دورة تدريبية', 'Training course fees')) + '</option></select></label><label>' + h(T('الجهة أو البيان *', 'Source / description *')) + '<input id="tk-xn" maxlength="120" placeholder="' + h(T('مثال: تبرع فاعل خير، دورة الإسعافات الأولية', 'e.g. donor, first-aid course')) + '"></label><label>' + h(T('المبلغ', 'Amount')) + '<input id="tk-xa" type="number" step="0.01" min="0" inputmode="decimal"></label><div style="align-self:end"><button class="btn pri" data-act="tk-addext" data-r="' + r.id + '">+ ' + h(T('إضافة مساهمة خارجية', 'Add external')) + '</button></div></div>') +
      '<h3>' + h(T('المستفيدون (زملاء بلا مشروع)', 'Beneficiaries')) + ' <span class="pill">' + outs.length + '</span></h3><div class="list">' + (outs.map(function (x) { return itemRow(x, r.currency); }).join('') || '<div class="empty">—</div>') + '</div>' + (r.closed ? '' : addBox(r, 'out'));
  }
  function roundCard(r) {
    var s = sums(r), open = K.sel === r.id;
    return '<div class="card" style="margin:10px 0"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><div><b>' + h(r.title) + '</b> <span class="sub">' + h(r.round_date) + '</span>' + (r.closed ? ' <span class="pill">' + h(T('مغلقة', 'Closed')) + '</span>' : '') + (r.show_status ? ' <span class="pill ok">👁</span>' : '') + '</div>' +
      '<button class="btn sm" data-act="tk-sel" data-id="' + r.id + '">' + h(open ? T('إخفاء التفاصيل', 'Hide') : T('التفاصيل', 'Details')) + '</button></div>' +
      '<div class="sub">' + h(T('مساهمون ', 'Contributors ') + s.nIn + ' · ' + T('مستفيدون ', 'Beneficiaries ') + s.nOut + ' · ' + T('المستلَم ', 'Received ') + money(s.inD, r.currency) + ' · ' + T('المصروف ', 'Paid ') + money(s.outD, r.currency) + ' · ' + T('الرصيد ', 'Balance ') + money(s.bal, r.currency)) + '</div>' +
      (r.note ? '<div class="sub">' + h(r.note) + '</div>' : '') + (open ? detail(r) : '') + '</div>';
  }
  window.takafulHtml = function () {
    var form = K.form ? '<div class="card" style="margin:8px 0"><b>' + h(T('دورة تكافل جديدة', 'New round')) + '</b><div class="form"><label>' + h(T('العنوان *', 'Title *')) + '<input id="tkf-title" placeholder="' + h(T('مثال: تكافل شهر نوفمبر', 'e.g. November')) + '"></label>' +
      '<label>' + h(T('التاريخ', 'Date')) + '<input id="tkf-date" type="date" value="' + today() + '"></label><label>' + h(T('العملة', 'Currency')) + '<select id="tkf-cur">' + Object.keys(CUR).map(function (k) { return '<option value="' + k + '">' + CUR[k] + ' ' + k + '</option>'; }).join('') + '</select></label>' +
      '<label style="grid-column:1/-1">' + h(T('ملاحظة', 'Note')) + '<input id="tkf-note"></label></div><div class="tabs"><button class="btn pri" data-act="tk-save"' + (K.busy ? ' disabled' : '') + '>' + h(T('حفظ', 'Save')) + '</button><button class="btn" data-act="tk-cancel">' + h(T('إلغاء', 'Cancel')) + '</button></div></div>' : '';
    return '<header class="top"><h1>🤝 ' + h(T('التكافل', 'Takaful')) + '</h1></header>' +
      '<p class="sub">' + h(T('تدوين داخلي فقط لتجنب الأخطاء، والتطبيق لا يحوّل أموالاً. المال يُحوَّل خارج التطبيق وتدوّن أنت استلامه وصرفه هنا.', 'Internal record only; the app does not move money.')) + '</p>' +
      (K.err ? '<p class="pill bad">' + h(K.err) + '</p>' : '') + (K.ok ? '<p class="pill ok">' + h(K.ok) + '</p>' : '') +
      '<div class="card" style="margin:8px 0"><b>' + h(T('بيانات استلام التبرعات (تظهر للمتبرع)', 'Where donors send money')) + '</b><label>' + h(T('رقم جوال باي أو الآيبان وأي تعليمات', 'Jawwal Pay number or IBAN and instructions')) + '<textarea id="tk-pay" class="cm-ta" maxlength="600" style="direction:rtl;font-family:inherit">' + h(K.pay) + '</textarea></label><div class="tabs"><button class="btn sm pri" data-act="tk-paysave">' + h(T('حفظ', 'Save')) + '</button></div></div>' +
      '<div class="tabs" style="margin:8px 0">' + (hasProj() ? '<button class="btn" data-act="tk-back">← ' + h(T('المشاريع', 'Projects')) + '</button>' : '') + '<button class="btn pri" data-act="tk-new">+ ' + h(T('دورة جديدة', 'New round')) + '</button></div>' + form +
      (K.busy && !K.loaded ? '<div class="empty">…</div>' : (K.rounds.map(roundCard).join('') || '<div class="card"><div class="empty">' + h(T('لا دورات بعد. أنشئ أول دورة.', 'No rounds yet.')) + '</div></div>'));
  };

  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function (res, rej) { var sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; sc.onload = res; sc.onerror = function () { rej(new Error(T('تعذّر تحميل مكتبة Excel (تحقق من الاتصال)', 'Could not load Excel library'))); }; document.head.appendChild(sc); });
  }
  var ACTS = {
    'tk-open': function () { K.on = true; K.sel = null; redraw(); load(); },
    'tk-back': function () { K.on = false; redraw(); },
    'tk-new': function () { K.form = true; redraw(); },
    'tk-cancel': function () { K.form = false; redraw(); },
    'tk-save': function () {
      var title = val('tkf-title').trim(); if (!title) { K.err = T('اكتب عنوان الدورة', 'Enter a title'); redraw(); return; }
      guard(async function () { var r = await sb().from('tk_rounds').insert({ title: title, round_date: val('tkf-date') || today(), currency: val('tkf-cur') || 'ILS', note: val('tkf-note').trim() || null }).select(); if (r.error) throw r.error; K.form = false; await load(); if (K.rounds[0]) K.sel = K.rounds[0].id; });
    },
    'tk-paysave': function () { var v = val('tk-pay').trim() || null; guard(async function () { var r = await sb().from('tk_settings').upsert({ id: 1, pay_info: v }); if (r.error) throw r.error; K.pay = v || ''; K.ok = T('حُفظت بيانات الاستلام', 'Saved'); }); },
    'tk-accept': function (el) { var id = Number(el.dataset.id), r = K.rounds.filter(function (x) { return x.id === id; })[0]; if (!r) return; var nv = !r.accepting; if (nv && !K.pay.trim()) { K.err = T('أدخل أولاً بيانات استلام التبرعات (جوال باي أو الآيبان) واحفظها', 'Enter payment details first'); redraw(); return; } guard(async function () { var u = await sb().from('tk_rounds').update({ accepting: nv }).eq('id', id); if (u.error) throw u.error; r.accepting = nv; K.ok = nv ? T('فُتح باب التبرع، وسيظهر زر «التكافل» للموظفين', 'Pledging is open') : T('أُغلق باب التبرع', 'Pledging closed'); }); },
    'tk-sel': function (el) { var id = Number(el.dataset.id); K.sel = K.sel === id ? null : id; redraw(); },
    'tk-show': function (el) { var id = Number(el.dataset.id), r = K.rounds.filter(function (x) { return x.id === id; })[0]; if (!r) return; var nv = !r.show_status; guard(async function () { var u = await sb().from('tk_rounds').update({ show_status: nv }).eq('id', id); if (u.error) throw u.error; r.show_status = nv; K.ok = r.show_status ? T('نُشر التوزيع: يرى كل مستفيد نصيبه ويؤكد استلامه', 'Distribution published') : T('أُخفي التوزيع عن المستفيدين', 'Hidden'); }); },
    'tk-lock': function (el) { var id = Number(el.dataset.id), r = K.rounds.filter(function (x) { return x.id === id; })[0]; if (!r) return; var nc = !r.closed; guard(async function () { var u = await sb().from('tk_rounds').update({ closed: nc }).eq('id', id); if (u.error) throw u.error; r.closed = nc; }); },
    'tk-delround': function (el) { var id = Number(el.dataset.id); guard(async function () { var d = await sb().from('tk_rounds').delete().eq('id', id); if (d.error) throw d.error; K.sel = null; K.rounds = K.rounds.filter(function (x) { return x.id !== id; }); K.items = K.items.filter(function (x) { return x.round_id !== id; }); }); },
    'tk-add': function (el) {
      var rid = Number(el.dataset.r), kind = el.dataset.k, pid = val('tk-p-' + kind), name = val('tk-n-' + kind).trim(), amt = num(val('tk-a-' + kind)), emp = null;
      if (pid) { var e = K.emps.filter(function (x) { return String(x.id) === pid; })[0]; if (e) { name = e.full_name; emp = e.employee_number || null; } }
      if (!name) { K.err = T('اختر موظفاً أو اكتب اسماً', 'Pick or type a name'); redraw(); return; }
      if (K.items.some(function (x) { return x.round_id === rid && x.kind === kind && x.person.replace(/\s+/g, ' ').trim() === name.replace(/\s+/g, ' ')})) { K.err = T('الاسم موجود مسبقاً في هذه الدورة', 'Already added'); redraw(); return; }
      guard(async function () { var r = await sb().from('tk_items').insert({ round_id: rid, kind: kind, person: name, emp: emp, amount: amt }).select(); if (r.error) throw r.error; K.items = K.items.concat(r.data || []); });
    },
    'tk-addext': function (el) {
      var rid = Number(el.dataset.r), ext = val('tk-xt') === 'course' ? 'course' : 'donation', name = val('tk-xn').trim(), amt = num(val('tk-xa'));
      if (!name) { K.err = T('اكتب الجهة أو البيان', 'Enter a description'); redraw(); return; }
      if (!(amt > 0)) { K.err = T('أدخل المبلغ', 'Enter the amount'); redraw(); return; }
      guard(async function () { var r = await sb().from('tk_items').insert({ round_id: rid, kind: 'in', person: name, ext: ext, amount: amt }).select(); if (r.error) throw r.error; K.items = K.items.concat(r.data || []); K.ok = T('أُضيفت المساهمة الخارجية وحُسبت ضمن الإجمالي', 'Added'); });
    },
    'tk-addall': function (el) {
      var rid = Number(el.dataset.r), kind = el.dataset.k, have = {}; K.items.forEach(function (x) { if (x.round_id === rid && x.kind === kind) have[x.person.replace(/\s+/g, ' ').trim()] = 1; });
      var rows = K.emps.filter(function (e) { return (kind === 'in' ? !!e.has_project : !e.has_project) && !have[String(e.full_name).replace(/\s+/g, ' ').trim()]; }).map(function (e) { return { round_id: rid, kind: kind, person: e.full_name, emp: e.employee_number || null, amount: 0 }; });
      if (!rows.length) { K.ok = T('لا أسماء جديدة للإضافة', 'Nothing to add'); redraw(); return; }
      guard(async function () { var r = await sb().from('tk_items').insert(rows).select(); if (r.error) throw r.error; K.items = K.items.concat(r.data || []); K.ok = T('أُضيف ' + rows.length + ' اسم، أدخل مبلغ كل واحد', rows.length + ' added'); });
    },
    'tk-del': function (el) { var id = Number(el.dataset.id); guard(async function () { var d = await sb().from('tk_items').delete().eq('id', id); if (d.error) throw d.error; K.items = K.items.filter(function (x) { return x.id !== id; }); }); },
    'tk-xlsx': function (el) {
      var id = Number(el.dataset.id), r = K.rounds.filter(function (x) { return x.id === id; })[0]; if (!r) return;
      guard(async function () {
        await loadXlsx();
        var its = K.items.filter(function (x) { return x.round_id === id; }), s = sums(r), c = CUR[r.currency] || '';
        var aoa = [[r.title, r.round_date, r.currency], [], [T('النوع', 'Type'), T('الاسم', 'Name'), T('المبلغ', 'Amount'), T('الحالة', 'Status')]];
        its.filter(function (x) { return x.kind === 'in'; }).forEach(function (x) { aoa.push([x.ext ? (x.ext === 'course' ? T('مساهمة خارجية: رسوم دورة', 'External: course') : T('مساهمة خارجية: تبرع', 'External: donation')) : T('مساهم', 'Contributor'), x.person, num(x.amount), x.done ? T('مستلَم', 'Received') : T('لم يُستلم', 'Pending')]); });
        its.filter(function (x) { return x.kind === 'out'; }).forEach(function (x) { aoa.push([T('مستفيد', 'Beneficiary'), x.person, num(x.amount), x.done ? T('مصروف', 'Paid') : T('لم يُصرف', 'Pending')]); });
        aoa.push([], [T('تعهّدات المساهمين', 'Pledged'), '', s.inT], [T('المستلَم', 'Received'), '', s.inD], [T('المخصّص للمستفيدين', 'Allocated'), '', s.outT], [T('المصروف', 'Paid out'), '', s.outD], [T('الرصيد', 'Balance'), '', s.bal]);
        var wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(aoa), 'takaful'); window.XLSX.writeFile(wb, 'takaful-' + r.round_date + '.xlsx');
      });
    }
  };
  window.EXTRA_ACT = Object.assign(window.EXTRA_ACT || {}, ACTS);
  document.addEventListener('change', function (e) {
    var t = e.target, k = t && t.dataset && t.dataset.tk; if (!k) return;
    var id = Number(t.dataset.id), it = K.items.filter(function (x) { return x.id === id; })[0]; if (!it) return;
    if (k === 'amt') { var v = Math.max(0, num(t.value)); guard(async function () { var u = await sb().from('tk_items').update({ amount: v }).eq('id', id); if (u.error) throw u.error; it.amount = v; }); }
    else if (k === 'done') { var on = !!t.checked; guard(async function () { var u = await sb().from('tk_items').update({ done: on, done_at: on ? today() : null }).eq('id', id); if (u.error) throw u.error; it.done = on; it.done_at = on ? today() : null; }); }
  });
})();
