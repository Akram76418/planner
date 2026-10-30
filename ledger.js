/* ledger.js: «دفتر الدفعات» للمدير: حسابات أشخاص، دفعات مستلمة/مدفوعة تُخصم من الإجمالي، وتقارير. */
(function () {
  'use strict';
  var PA = function () { return window.PLANNER_AUTH || null; };
  function sb() { return PA() && PA().sb(); }
  function ar() { return PA() ? PA().lang() === 'ar' : true; }
  function T(a, e) { return ar() ? a : e; }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isAdmin() { return !!(window.CAN && window.CAN('main')); }
  function toast_(m) { if (typeof toast === 'function') toast(m); }
  function $q(s) { return document.querySelector(s); }
  function val(id) { var e = $q('#' + id); return e ? e.value : ''; }

  var CUR = { ILS: ['₪', 'شيكل', 'ILS'], USD: ['$', 'دولار', 'USD'], JOD: ['د.أ', 'دينار أردني', 'JOD'], EUR: ['€', 'يورو', 'EUR'] };
  var L = { prof: {}, profForm: false, acc: [], pay: [], dir: '', q: '', open: {}, form: null, payForm: null, rep: false, from: '', to: '', loaded: false, busy: false, err: '' };

  function num(n) { return Number(n) || 0; }
  function money(n, cur) { var c = CUR[cur] || CUR.ILS; return (Math.round(num(n) * 100) / 100).toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ' + c[0]; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dayDate(ds) { try { return new Date(ds + 'T00:00:00').toLocaleDateString(ar() ? 'ar' : 'en', { weekday: 'long' }) + ' ' + ds; } catch (e) { return ds; } }
  function paidOf(id) { return L.pay.filter(function (p) { return p.account_id === id; }).reduce(function (s, p) { return s + num(p.amount); }, 0); }

  window.ledgerView = function () { return '<div id="lg2-root"></div>'; };
  window.ledgerMount = function () { draw(); if (!L.loaded) load(); };
  async function load() {
    if (!isAdmin() || !sb()) return;
    L.busy = true; L.err = ''; draw();
    try {
      var a = await sb().from('ledger_accounts').select('*').order('created_at', { ascending: false }).limit(2000);
      if (a.error) throw a.error;
      var p = await sb().from('ledger_payments').select('*').order('paid_at', { ascending: false }).order('id', { ascending: false }).limit(10000);
      if (p.error) throw p.error;
      L.acc = a.data || []; L.pay = p.data || []; L.loaded = true;
      try { var pf = await sb().from('ledger_profile').select('*').limit(1); if (!pf.error && pf.data && pf.data[0]) L.prof = pf.data[0]; } catch (e2) {}
    } catch (e) { L.err = (e && e.message) || String(e); if (/ledger_|schema cache|does not exist|relation/i.test(L.err)) L.err += ' — ' + T('شغّل ledger.sql في Supabase أولاً.', 'Run ledger.sql in Supabase first.'); }
    L.busy = false; draw();
  }

  /* ---------- ملخصات ---------- */
  function totals(accs) {
    var by = {};
    accs.forEach(function (a) {
      var c = by[a.currency] = by[a.currency] || { in: { t: 0, p: 0 }, out: { t: 0, p: 0 } };
      c[a.direction].t += num(a.total); c[a.direction].p += paidOf(a.id);
    });
    return by;
  }
  function visible() {
    var q = L.q.trim().toLowerCase();
    return L.acc.filter(function (a) { return (!L.dir || a.direction === L.dir) && (!q || a.person.toLowerCase().indexOf(q) > -1 || (a.note || '').toLowerCase().indexOf(q) > -1); });
  }

  /* ---------- العرض ---------- */
  function summaryHtml() {
    var by = totals(L.acc), keys = Object.keys(by);
    if (!keys.length) return '';
    return keys.map(function (cur) {
      var c = by[cur], rin = c.in.t - c.in.p, rout = c.out.t - c.out.p;
      var box = function (title, t, p, r, cls) { return '<div class="card" style="flex:1;min-width:230px"><div class="sub">' + h(title) + '</div><div style="font-size:22px;font-weight:700" class="' + cls + '">' + h(money(r, cur)) + '</div><div class="sub">' + h(T('الإجمالي ', 'Total ') + money(t, cur) + ' · ' + T('المستلم/المدفوع ', 'Settled ') + money(p, cur)) + '</div></div>'; };
      return '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">' + box(T('متبقٍ لي عند الآخرين (' + CUR[cur][1] + ')', 'Owed to me (' + cur + ')'), c.in.t, c.in.p, rin, '') + box(T('متبقٍ عليّ للآخرين (' + CUR[cur][1] + ')', 'I owe (' + cur + ')'), c.out.t, c.out.p, rout, '') +
        '<div class="card" style="flex:1;min-width:230px"><div class="sub">' + h(T('الصافي (لي − عليّ)', 'Net (owed to me − I owe)')) + '</div><div style="font-size:22px;font-weight:700">' + h(money(rin - rout, cur)) + '</div></div></div>';
    }).join('');
  }
  function accountForm() {
    var f = L.form; if (!f) return '';
    var curOpts = Object.keys(CUR).map(function (k) { return '<option value="' + k + '"' + ((f.currency || 'ILS') === k ? ' selected' : '') + '>' + h(CUR[k][0] + ' ' + CUR[k][1]) + '</option>'; }).join('');
    return '<div class="card" style="margin:8px 0"><b>' + h(f.id ? T('تعديل الحساب', 'Edit account') : T('حساب جديد', 'New account')) + '</b><div class="form">' +
      '<label>' + h(T('اسم الشخص *', 'Person *')) + '<input id="lf-person" value="' + h(f.person || '') + '"></label>' +
      '<label>' + h(T('نوع الحساب', 'Type')) + '<select id="lf-dir"><option value="in"' + (f.direction !== 'out' ? ' selected' : '') + '>' + h(T('أستلم منه (له عليه مبلغ لي)', 'I receive from him')) + '</option><option value="out"' + (f.direction === 'out' ? ' selected' : '') + '>' + h(T('أدفع له (مبلغ عليّ)', 'I pay him')) + '</option></select></label>' +
      '<label>' + h(T('إجمالي المبلغ *', 'Total amount *')) + '<input id="lf-total" type="number" step="0.01" min="0" inputmode="decimal" value="' + h(f.total == null ? '' : f.total) + '"></label>' +
      '<label>' + h(T('العملة', 'Currency')) + '<select id="lf-cur">' + curOpts + '</select></label>' +
      '<label style="grid-column:1/-1">' + h(T('ملاحظة', 'Note')) + '<input id="lf-note" value="' + h(f.note || '') + '"></label>' +
      '<div style="grid-column:1/-1"><b>' + h(T('بيانات القطعة (تظهر في الوصل)', 'Land details (shown on the receipt)')) + '</b> <button type="button" class="btn sm" data-act="lg-land-fill">' + h(T('تعبئة بيانات الأرض والوصف تلقائياً', 'Fill: parcel 2346 / plot 2 / 268 m² / contract 30-09-2023')) + '</button></div>' +
      '<label>' + h(T('رقم القسيمة', 'Plot no.')) + '<input id="lf-plot" value="' + h(f.plot_no || '') + '"></label>' +
      '<label>' + h(T('رقم القطعة', 'Parcel no.')) + '<input id="lf-parcel" value="' + h(f.parcel_no || '') + '"></label>' +
      '<label>' + h(T('المساحة', 'Area')) + '<input id="lf-area" placeholder="268 م²" value="' + h(f.area || '') + '"></label>' +
      '<label>' + h(T('الموقع / الأراضي', 'Location')) + '<input id="lf-loc" placeholder="أراضي النصيرات - قنى دير البلح" value="' + h(f.location || '') + '"></label>' +
      '<label>' + h(T('تاريخ العقد', 'Contract date')) + '<input id="lf-cdate" type="date" value="' + h(f.contract_date || '') + '"></label>' +
      '<label style="grid-column:1/-1">' + h(T('وصف الدفعة في الوصل (ثابت لهذا الحساب)', 'Payment description on the receipt (fixed per account)')) + '<textarea id="lf-desc" rows="3" placeholder="' + h(T('مثال: قسط شهري من باقي ثمن بيع قطعة أرض مساحتها (268) متر من أراضي النخيرات، قسيمة رقم (2) قطعة رقم (2346)، وذلك حسب الاتفاق الذي نص عليه عقد البيع بين الطرفين والذي أبرم وحرر بتاريخ 30/9/2023', 'e.g. monthly instalment of the balance of the sale price of ...')) + '">' + h(f.receipt_desc || '') + '</textarea></label></div>' +
      '<div class="tabs"><button class="btn pri" data-act="lg-acc-save"' + (L.busy ? ' disabled' : '') + '>' + h(T('حفظ', 'Save')) + '</button><button class="btn" data-act="lg-acc-cancel">' + h(T('إلغاء', 'Cancel')) + '</button></div></div>';
  }
  function payForm(a) {
    var f = L.payForm; if (!f || f.account_id !== a.id) return '';
    return '<div class="card" style="margin:8px 0"><b>' + h(f.id ? T('تعديل الدفعة', 'Edit payment') : (a.direction === 'in' ? T('تسجيل دفعة مستلمة', 'Record received payment') : T('تسجيل دفعة مدفوعة', 'Record payment made'))) + '</b><div class="form">' +
      '<label>' + h(T('المبلغ *', 'Amount *')) + '<input id="pf2-amount" type="number" step="0.01" min="0" inputmode="decimal" value="' + h(f.amount == null ? '' : f.amount) + '"></label>' +
      '<label>' + h(T('التاريخ *', 'Date *')) + '<input id="pf2-date" type="date" value="' + h(f.paid_at || today()) + '"></label>' +
      '<label style="grid-column:1/-1">' + h(T('ملاحظة', 'Note')) + '<input id="pf2-note" value="' + h(f.note || '') + '"></label></div>' +
      '<div class="tabs"><button class="btn pri" data-act="lg-pay-save"' + (L.busy ? ' disabled' : '') + '>' + h(T('حفظ الدفعة', 'Save payment')) + '</button><button class="btn" data-act="lg-pay-cancel">' + h(T('إلغاء', 'Cancel')) + '</button></div></div>';
  }
  function accountCard(a) {
    var paid = paidOf(a.id), rem = num(a.total) - paid, pc = num(a.total) ? Math.min(100, Math.round(paid * 100 / num(a.total))) : 100, open = !!L.open[a.id];
    var pays = L.pay.filter(function (p) { return p.account_id === a.id; });
    var done = rem <= 0.0001;
    return '<div class="card" style="margin:10px 0"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><div><b>' + h(a.person) + '</b> <span class="pill ' + (a.direction === 'in' ? 'ok' : 'warn') + '">' + h(a.direction === 'in' ? T('أستلم منه', 'Receivable') : T('أدفع له', 'Payable')) + '</span>' + (done ? ' <span class="pill ok">' + h(T('مسدَّد', 'Settled')) + '</span>' : '') + '</div>' +
      '<div class="tabs"><button class="btn sm pri" data-act="lg-pay-new" data-id="' + a.id + '">+ ' + h(T('دفعة', 'Payment')) + '</button> <button class="btn sm" data-act="lg-toggle" data-id="' + a.id + '">' + h(open ? T('إخفاء الكشف', 'Hide') : T('كشف الحساب (' + pays.length + ')', 'Statement (' + pays.length + ')')) + '</button> <button class="btn sm" data-act="lg-acc-edit" data-id="' + a.id + '">' + h(T('تعديل', 'Edit')) + '</button> <button class="btn sm bad" data-act="lg-acc-del" data-id="' + a.id + '" data-confirm="1">' + h(T('حذف', 'Delete')) + '</button></div></div>' +
      '<div class="sub" style="margin-top:6px">' + h(T('الإجمالي ', 'Total ') + money(a.total, a.currency) + ' · ' + (a.direction === 'in' ? T('المستلم ', 'Received ') : T('المدفوع ', 'Paid ')) + money(paid, a.currency)) + ' · <b>' + h(T('المتبقي ', 'Remaining ') + money(rem, a.currency)) + '</b></div>' +
      '<div style="height:7px;border-radius:5px;background:rgba(127,127,127,.2);margin:6px 0"><div style="height:7px;border-radius:5px;background:var(--accent,#0b8a97);width:' + pc + '%"></div></div>' +
      (a.note ? '<div class="sub">' + h(a.note) + '</div>' : '') + payForm(a) +
      (open ? '<div class="list" style="margin-top:6px">' + (pays.map(function (p) {
        return '<div class="row"><div class="main"><div class="t">' + h(money(p.amount, a.currency)) + '</div><div class="sub">' + h(dayDate(p.paid_at)) + (p.note ? ' · ' + h(p.note) : '') + '</div></div><div class="act"><button class="btn sm pri" data-act="lg-receipt" data-id="' + p.id + '">' + h(T('وصل', 'Receipt')) + '</button> <button class="btn sm" data-act="lg-receipt-word" data-id="' + p.id + '">Word</button> <button class="btn sm" data-act="lg-pay-edit" data-id="' + p.id + '">' + h(T('تعديل', 'Edit')) + '</button> <button class="btn sm bad" data-act="lg-pay-del" data-id="' + p.id + '" data-confirm="1">' + h(T('حذف', 'Delete')) + '</button></div></div>';
      }).join('') || '<div class="empty">' + h(T('لا دفعات بعد', 'No payments yet')) + '</div>') + '</div>' : '') + '</div>';
  }
  function reportData() {
    var from = L.from, to = L.to, rows = {};
    visible().forEach(function (a) {
      var pays = L.pay.filter(function (p) { return p.account_id === a.id && (!from || p.paid_at >= from) && (!to || p.paid_at <= to); });
      rows[a.id] = { a: a, inPeriod: pays.reduce(function (s, p) { return s + num(p.amount); }, 0), pays: pays, paid: paidOf(a.id) };
    });
    return Object.keys(rows).map(function (k) { return rows[k]; });
  }
  function reportHtml() {
    if (!L.rep) return '';
    var rows = reportData(), by = {};
    rows.forEach(function (r) { var c = by[r.a.currency] = by[r.a.currency] || { in: { t: 0, p: 0, per: 0 }, out: { t: 0, p: 0, per: 0 } }; c[r.a.direction].t += num(r.a.total); c[r.a.direction].p += r.paid; c[r.a.direction].per += r.inPeriod; });
    return '<div class="card" style="margin:10px 0"><h2>' + h(T('تقرير المبالغ', 'Amounts report')) + '</h2><div class="form"><label>' + h(T('من تاريخ', 'From')) + '<input id="rp-from" type="date" value="' + h(L.from) + '"></label><label>' + h(T('إلى تاريخ', 'To')) + '<input id="rp-to" type="date" value="' + h(L.to) + '"></label>' +
      '<div style="align-self:end"><button class="btn" data-act="lg-rep-run">' + h(T('تحديث', 'Update')) + '</button></div></div>' +
      '<p class="sub">' + h(T('يشمل الحسابات المعروضة حسب الفلتر والبحث الحاليين. «في الفترة» = دفعات الفترة المحددة، والباقي حسب كل الدفعات.', 'Uses the current filter and search. "In period" = payments within the dates.')) + '</p>' +
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>' + h(T('الشخص', 'Person')) + '</th><th>' + h(T('النوع', 'Type')) + '</th><th>' + h(T('الإجمالي', 'Total')) + '</th><th>' + h(T('في الفترة', 'In period')) + '</th><th>' + h(T('المستلم/المدفوع', 'Settled')) + '</th><th>' + h(T('المتبقي', 'Remaining')) + '</th></tr></thead><tbody>' +
      (rows.map(function (r) { var a = r.a; return '<tr><td>' + h(a.person) + '</td><td>' + h(a.direction === 'in' ? T('أستلم', 'In') : T('أدفع', 'Out')) + '</td><td>' + h(money(a.total, a.currency)) + '</td><td>' + h(money(r.inPeriod, a.currency)) + '</td><td>' + h(money(r.paid, a.currency)) + '</td><td><b>' + h(money(num(a.total) - r.paid, a.currency)) + '</b></td></tr>'; }).join('') || '<tr><td colspan="6" class="empty">—</td></tr>') + '</tbody></table></div>' +
      Object.keys(by).map(function (cur) { var c = by[cur]; return '<p class="sub"><b>' + h(CUR[cur][1]) + ':</b> ' + h(T('أستلم — إجمالي ', 'Receivable — total ') + money(c.in.t, cur) + T(' / مستلم ', ' / received ') + money(c.in.p, cur) + T(' / متبقٍ ', ' / remaining ') + money(c.in.t - c.in.p, cur) + ' | ' + T('أدفع — إجمالي ', 'Payable — total ') + money(c.out.t, cur) + T(' / مدفوع ', ' / paid ') + money(c.out.p, cur) + T(' / متبقٍ ', ' / remaining ') + money(c.out.t - c.out.p, cur)) + '</p>'; }).join('') +
      '<div class="tabs"><button class="btn pri" data-act="lg-rep-word">⬇ ' + h(T('تصدير Word', 'Export Word')) + '</button> <button class="btn" data-act="lg-rep-csv">⬇ CSV</button> <button class="btn" data-act="lg-rep-close">' + h(T('إغلاق التقرير', 'Close')) + '</button></div></div>';
  }
  function draw() {
    var el = document.getElementById('lg2-root'); if (!el) return;
    if (!isAdmin()) { el.innerHTML = ''; return; }
    var chips = [['', T('الكل', 'All')], ['in', T('أستلم منهم', 'Receivable')], ['out', T('أدفع لهم', 'Payable')]];
    var list = visible();
    el.innerHTML = '<div class="card"><h2>' + h(T('دفتر الدفعات', 'Payments ledger')) + '</h2><p class="sub">' + h(T('سجّل مبلغاً متفقاً عليه مع شخص، ثم وثّق كل دفعة (تُخصم من الإجمالي ويُحسب المتبقي) مع اليوم والتاريخ. البيانات خاصة بك وحدك.', 'Record an agreed amount with a person, then log each payment (deducted from the total). Private to you.')) + '</p>' +
      (L.err ? '<p class="pill bad">' + h(L.err) + '</p>' : '') + (L.busy ? '<p class="sub">…</p>' : '') + '</div>' + summaryHtml() +
      '<div class="card"><div class="tabs">' + chips.map(function (c) { return '<button class="btn sm' + (L.dir === c[0] ? ' pri' : '') + '" data-act="lg-dir" data-d="' + c[0] + '">' + h(c[1]) + '</button>'; }).join('') +
      ' <input id="lg-q" data-lg="q" placeholder="' + h(T('بحث بالاسم…', 'Search…')) + '" value="' + h(L.q) + '" style="max-width:200px"> <button class="btn pri" data-act="lg-acc-new">+ ' + h(T('حساب جديد', 'New account')) + '</button> <button class="btn" data-act="lg-prof-open">' + h(T('بيانات الوصل', 'Receipt details')) + '</button> <button class="btn" data-act="lg-rep-open">' + h(T('تقرير', 'Report')) + '</button></div>' +
      profForm() + accountForm() + reportHtml() + (list.map(accountCard).join('') || '<div class="empty">' + h(T('لا حسابات. اضغط «حساب جديد».', 'No accounts yet.')) + '</div>') + '</div>';
  }

  /* ---------- تصدير ---------- */
  function saveBlob(name, blob) { var u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function reportWord() {
    var rows = reportData(), th = 'style="background:#12304D;color:#fff;border:1px solid #12304D;padding:6px 8px;text-align:center;font-size:11pt"';
    var td = function (x, b) { return '<td style="border:1px solid #8aa0b4;padding:5px 8px;text-align:center;font-size:10.5pt' + (b ? ';font-weight:bold' : '') + '">' + esc(x) + '</td>'; };
    var by = {};
    rows.forEach(function (r) { var c = by[r.a.currency] = by[r.a.currency] || { in: { t: 0, p: 0 }, out: { t: 0, p: 0 } }; c[r.a.direction].t += num(r.a.total); c[r.a.direction].p += r.paid; });
    var range = (L.from || L.to) ? 'الفترة: ' + (L.from || '…') + ' إلى ' + (L.to || '…') : 'كل الفترات';
    var detail = rows.filter(function (r) { return r.pays.length; }).map(function (r) {
      return '<p style="margin:12pt 0 3pt;font-size:12pt;color:#12304D"><b>' + esc(r.a.person) + '</b> (' + (r.a.direction === 'in' ? 'أستلم منه' : 'أدفع له') + ') — الإجمالي ' + esc(money(r.a.total, r.a.currency)) + '، المتبقي ' + esc(money(num(r.a.total) - r.paid, r.a.currency)) + '</p>' +
        '<table dir="rtl" width="100%" border="1" cellspacing="0" cellpadding="4" style="width:100%;border-collapse:collapse"><tr><th ' + th + '>اليوم والتاريخ</th><th ' + th + '>المبلغ</th><th ' + th + '>ملاحظة</th></tr>' + r.pays.map(function (p) { return '<tr>' + td(dayDate(p.paid_at)) + td(money(p.amount, r.a.currency), true) + td(p.note || '') + '</tr>'; }).join('') + '</table>';
    }).join('');
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>تقرير الدفعات</title>' +
      '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->' +
      '<style>@page Section1{size:595.3pt 841.9pt;margin:40pt}div.Section1{page:Section1}body{font-family:Arial,sans-serif}table{border-collapse:collapse}tr{page-break-inside:avoid}</style></head><body dir="rtl"><div class="Section1">' +
      '<p style="text-align:center;font-size:20pt;color:#12304D;margin:0 0 2pt"><b>تقرير الدفعات المالية</b></p><p style="text-align:center;font-size:10pt;color:#6B7C8A;margin:0 0 10pt">' + esc(range) + ' — صدر في ' + esc(new Date().toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' })) + '</p>' +
      '<table dir="rtl" width="100%" border="1" cellspacing="0" cellpadding="4" style="width:100%;border-collapse:collapse"><tr><th ' + th + '>الشخص</th><th ' + th + '>النوع</th><th ' + th + '>الإجمالي</th><th ' + th + '>في الفترة</th><th ' + th + '>المستلم/المدفوع</th><th ' + th + '>المتبقي</th></tr>' +
      rows.map(function (r) { var a = r.a; return '<tr>' + td(a.person, true) + td(a.direction === 'in' ? 'أستلم' : 'أدفع') + td(money(a.total, a.currency)) + td(money(r.inPeriod, a.currency)) + td(money(r.paid, a.currency)) + td(money(num(a.total) - r.paid, a.currency), true) + '</tr>'; }).join('') + '</table>' +
      Object.keys(by).map(function (cur) { var c = by[cur]; return '<p style="font-size:11pt;margin:8pt 0 0"><b>' + esc(CUR[cur][1]) + ':</b> أستلم: الإجمالي ' + esc(money(c.in.t, cur)) + ' / المستلم ' + esc(money(c.in.p, cur)) + ' / المتبقي ' + esc(money(c.in.t - c.in.p, cur)) + ' &nbsp;|&nbsp; أدفع: الإجمالي ' + esc(money(c.out.t, cur)) + ' / المدفوع ' + esc(money(c.out.p, cur)) + ' / المتبقي ' + esc(money(c.out.t - c.out.p, cur)) + '</p>'; }).join('') +
      (detail ? '<p style="font-size:14pt;color:#0B8A97;margin:16pt 0 0"><b>تفصيل الدفعات</b></p>' + detail : '') + '</div></body></html>';
  }
  function reportCsv() {
    var rows = [['الشخص', 'النوع', 'العملة', 'الإجمالي', 'في الفترة', 'المستلم/المدفوع', 'المتبقي', 'ملاحظة']].concat(reportData().map(function (r) { var a = r.a; return [a.person, a.direction === 'in' ? 'أستلم' : 'أدفع', a.currency, a.total, r.inPeriod, r.paid, num(a.total) - r.paid, a.note || '']; }));
    return '﻿' + rows.map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); return /[",\n\r]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n');
  }


  /* ---------- وصل الاستلام ---------- */
  function profForm() {
    if (!L.profForm) return '';
    var p = L.prof || {};
    return '<div class="card" style="margin:8px 0"><b>' + h(T('بيانات الوصل (ثابتة)', 'Receipt details (fixed)')) + '</b><p class="sub">' + h(T('تُحفظ في حسابك الخاص وتظهر في كل وصل. التوقيع: ارفع صورة التوقيع مرة واحدة (يُفضَّل PNG بخلفية شفافة).', 'Saved privately and used on every receipt. Upload your signature image once.')) + '</p><div class="form">' +
      '<label>' + h(T('الاسم الكامل', 'Full name')) + '<input id="pr-name" value="' + h(p.full_name || '') + '"></label>' +
      '<label>' + h(T('رقم الهوية', 'ID number')) + '<input id="pr-id" inputmode="numeric" value="' + h(p.id_no || '') + '"></label>' +
      '<label style="grid-column:1/-1">' + h(T('صورة التوقيع', 'Signature image')) + '<input id="pr-sig" type="file" accept="image/*"></label>' +
      (p.sig ? '<div style="grid-column:1/-1"><img src="' + h(p.sig) + '" alt="" style="max-height:70px;background:#fff;border:1px solid #ccc;padding:4px;border-radius:6px"> <button class="btn sm bad" data-act="lg-prof-nosig">' + h(T('إزالة التوقيع', 'Remove signature')) + '</button></div>' : '') +
      '</div><div class="tabs"><button class="btn pri" data-act="lg-prof-save">' + h(T('حفظ', 'Save')) + '</button><button class="btn" data-act="lg-prof-cancel">' + h(T('إلغاء', 'Cancel')) + '</button></div></div>';
  }
  function readSig(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onerror = function () { rej(new Error('read')); };
      fr.onload = function () {
        var im = new Image();
        im.onerror = function () { rej(new Error('image')); };
        im.onload = function () {
          var k = Math.min(1, 500 / im.width), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/png'));
        };
        im.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function dotted(s, n) { s = (s || '').trim(); return s ? esc(s) : '.'.repeat(n || 30); }
  function dmy(d) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? m[3] + '-' + m[2] + '-' + m[1] : (d || ''); }
  function landBlock(a) {
    var cells = [['الموقع', a.location], ['رقم القسيمة', a.plot_no], ['رقم القطعة', a.parcel_no], ['المساحة', a.area], ['تاريخ العقد', a.contract_date ? dmy(a.contract_date) : '']].filter(function (c) { return c[1]; });
    if (!cells.length) return '';
    return '<p style="margin:10px 0 2px;font-size:12pt;color:#12304D"><b>بيانات القطعة محل العقد</b></p><table dir="rtl" width="100%" border="1" cellspacing="0" cellpadding="5" style="width:100%;border-collapse:collapse;font-size:12.5pt;text-align:center;margin:0 0 8px"><tr style="background:#eef3f7">' + cells.map(function (c) { return '<td>' + c[0] + '</td>'; }).join('') + '</tr><tr>' + cells.map(function (c) { return '<td><b>' + esc(c[1]) + '</b></td>'; }).join('') + '</tr></table>';
  }
  function receiptHtml(p, word) {
    var a = findAcc(p.account_id); if (!a) return '';
    var pr = L.prof || {}, cur = (CUR[a.currency] || CUR.ILS)[1], isIn = a.direction === 'in';
    var sorted = L.pay.filter(function (x) { return x.account_id === a.id; }).sort(function (x, y) { return x.paid_at < y.paid_at ? -1 : x.paid_at > y.paid_at ? 1 : Number(x.id) - Number(y.id); });
    var idx = sorted.findIndex(function (x) { return String(x.id) === String(p.id); }), upto = sorted.slice(0, idx + 1).reduce(function (t, x) { return t + num(x.amount); }, 0), rem = num(a.total) - upto;
    var fmt = function (n) { return (Math.round(num(n) * 100) / 100).toLocaleString('en', { maximumFractionDigits: 2 }); };
    var name = dotted(pr.full_name, 28), idn = dotted(pr.id_no, 14), who = '<span class="who"' + (word ? '' : ' contenteditable="true"') + '>' + esc(a.person) + '</span>';
    var desc = (a.receipt_desc || '').trim();
    var para = 'أقرّ أنا الموقّع أدناه / <b>' + name + '</b> هوية رقم / <b>' + idn + '</b> بأنني قد ' + (isIn ? 'استلمت من السيد/ <b>' + who + '</b>' : 'دفعت إلى السيد/ <b>' + who + '</b>') +
      ' مبلغاً وقدره (<b>' + fmt(p.amount) + '</b>) ' + esc(cur) + (desc ? '، وهذا المبلغ بمثابة دفعة ' + esc(desc) : '') + '.';
    var remLine = rem > 0.0001 ? 'ويتبقى <b>' + fmt(rem) + '</b> ' + esc(cur) + (isIn ? ' لدى السيد/ ' + who : ' في ذمتي للسيد/ ' + who) + '.' : 'وبهذه الدفعة يكون المبلغ قد سُدّد بالكامل.';
    var d = p.paid_at, day = '';
    try { day = new Date(d + 'T00:00:00').toLocaleDateString('ar', { weekday: 'long' }); } catch (e) {}
    var sig = pr.sig ? '<img src="' + pr.sig + '" alt="" style="height:60px;vertical-align:middle">' : '';
    var box = 'border:2px solid #12304D;padding:22px 26px;';
    return '<div dir="rtl" style="font-family:Arial,Tahoma,sans-serif;max-width:680px;margin:0 auto;' + box + 'line-height:2.1;font-size:15pt">' +
      '<table width="100%" style="width:100%"><tr><td style="font-size:12pt;color:#555">دفعة رقم ' + (idx + 1) + '</td><td style="text-align:left;font-size:12pt;color:#555">التاريخ: ' + esc(day) + ' ' + esc(d) + '</td></tr></table>' +
      '<p style="text-align:center;font-size:20pt;margin:4px 0 14px;color:#12304D"><b>' + (isIn ? 'وصل استلام دفعة' : 'وصل دفع') + '</b></p>' +
      '<p style="margin:0 0 8px;text-align:justify">' + para + '</p>' +
      landBlock(a) + '<table dir="rtl" width="100%" border="1" cellspacing="0" cellpadding="5" style="width:100%;border-collapse:collapse;font-size:13pt;text-align:center;margin:6px 0 10px"><tr style="background:#eef3f7"><td>الإجمالي الأصلي</td><td>المدفوع سابقاً</td><td>هذه الدفعة</td><td>المتبقي</td></tr><tr><td>' + fmt(a.total) + ' ' + esc(cur) + '</td><td>' + fmt(upto - num(p.amount)) + ' ' + esc(cur) + '</td><td><b>' + fmt(p.amount) + ' ' + esc(cur) + '</b></td><td><b>' + fmt(rem) + ' ' + esc(cur) + '</b></td></tr></table>' +
      '<p style="margin:0 0 14px">' + remLine + '</p>' +
      '<table width="100%" style="width:100%;margin-top:10px"><tr><td style="width:60%">' + (isIn ? 'توقيع المستلم' : 'توقيع الدافع') + ' / <b>' + name + '</b></td><td>' + sig + '</td></tr>' +
      (isIn ? '' : '<tr><td>توقيع المستلم / ' + who + '</td><td>..............................</td></tr>') +
      '<tr><td colspan="2" style="padding-top:8px">التاريخ: ' + esc(d) + '</td></tr>' +
      '<tr><td colspan="2" style="padding-top:14px">توقيع الشهود /</td></tr><tr><td colspan="2">1) ..................................................</td></tr><tr><td colspan="2">2) ..................................................</td></tr></table></div>';
  }
  function receiptWindow(p) {
    var w = window.open('', '_blank'); if (!w) { toast_(T('اسمح بالنوافذ المنبثقة لعرض الوصل', 'Allow pop-ups to view the receipt')); return; }
    w.document.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>وصل</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;background:#fff;color:#000}.who{border-bottom:1px dashed #0b8a97;outline:none;padding:0 3px}@media print{.who{border:0}}@media print{.np{display:none}body{margin:0}}</style></head><body><div class="np" style="text-align:center;margin-bottom:12px"><button onclick="window.print()" style="padding:8px 18px;font-size:15px">طباعة / حفظ PDF</button><div style="font-size:13px;color:#555;margin-top:6px">للتعديل: اضغط على اسم الشخص داخل الوصل واكتب أي اسم، ثم اطبع.</div></div>' + receiptHtml(p) + '<script>document.addEventListener("input",function(e){var t=e.target.closest&&e.target.closest(".who");if(!t)return;document.querySelectorAll(".who").forEach(function(x){if(x!==t)x.textContent=t.textContent})})<\/script></body></html>');
    w.document.close();
  }
  function receiptWord(p) {
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]--><style>@page Section1{size:595.3pt 841.9pt;margin:50pt}div.Section1{page:Section1}body{font-family:Arial}</style></head><body dir="rtl"><div class="Section1">' + receiptHtml(p, true) + '</div></body></html>';
  }

  /* ---------- الأوامر ---------- */
  function guard(fn) { L.busy = true; L.err = ''; draw(); return Promise.resolve().then(fn).catch(function (e) { L.err = (e && e.message) || String(e); }).then(function () { L.busy = false; draw(); }); }
  function findAcc(id) { return L.acc.filter(function (a) { return String(a.id) === String(id); })[0]; }
  function findPay(id) { return L.pay.filter(function (p) { return String(p.id) === String(id); })[0]; }
  var ACTS = {
    'lg-dir': function (el) { L.dir = el.dataset.d || ''; draw(); },
    'lg-acc-new': function () { L.form = { direction: L.dir || 'in', currency: 'ILS' }; draw(); },
    'lg-acc-cancel': function () { L.form = null; draw(); },
    'lg-acc-edit': function (el) { L.form = Object.assign({}, findAcc(el.dataset.id)); draw(); },
    'lg-acc-save': function () {
      var f = L.form || {}, person = val('lf-person').trim(), total = parseFloat(val('lf-total'));
      if (!person || !(total >= 0)) { toast_(T('اكتب الاسم والمبلغ', 'Enter name and amount')); return; }
      var row = { person: person, direction: val('lf-dir'), total: total, currency: val('lf-cur'), note: val('lf-note').trim() || null, receipt_desc: val('lf-desc').trim() || null, plot_no: val('lf-plot').trim() || null, parcel_no: val('lf-parcel').trim() || null, area: val('lf-area').trim() || null, location: val('lf-loc').trim() || null, contract_date: val('lf-cdate') || null };
      guard(async function () {
        var r = f.id ? await sb().from('ledger_accounts').update(row).eq('id', f.id) : await sb().from('ledger_accounts').insert(row);
        if (r.error) throw r.error; L.form = null; await load2();
      });
    },
    'lg-acc-del': function (el) { var a = findAcc(el.dataset.id); if (!a) return; var n = L.pay.filter(function (p) { return p.account_id === a.id; }).length;
      if (n && !window.confirm(T('سيُحذف الحساب مع ' + n + ' دفعة نهائياً. متابعة؟', 'This deletes the account and its ' + n + ' payments permanently. Continue?'))) return;
      guard(async function () { var r = await sb().from('ledger_accounts').delete().eq('id', a.id); if (r.error) throw r.error; await load2(); }); },
    'lg-toggle': function (el) { L.open[el.dataset.id] = !L.open[el.dataset.id]; draw(); },
    'lg-pay-new': function (el) { L.payForm = { account_id: Number(el.dataset.id) }; draw(); },
    'lg-pay-edit': function (el) { var p = findPay(el.dataset.id); if (p) { L.payForm = Object.assign({}, p); draw(); } },
    'lg-pay-cancel': function () { L.payForm = null; draw(); },
    'lg-pay-save': function () {
      var f = L.payForm || {}, amount = parseFloat(val('pf2-amount')), date = val('pf2-date'), a = findAcc(f.account_id);
      if (!(amount > 0) || !date) { toast_(T('اكتب المبلغ والتاريخ', 'Enter amount and date')); return; }
      var others = paidOf(a.id) - (f.id ? num((findPay(f.id) || {}).amount) : 0), rem = num(a.total) - others;
      if (amount > rem + 0.0001 && !window.confirm(T('المبلغ أكبر من المتبقي (' + money(rem, a.currency) + '). تسجيله سيجعل المتبقي بالسالب. متابعة؟', 'Amount exceeds the remaining ' + money(rem, a.currency) + '. Continue?'))) return;
      var row = { account_id: a.id, amount: amount, paid_at: date, note: val('pf2-note').trim() || null };
      guard(async function () {
        var r = f.id ? await sb().from('ledger_payments').update({ amount: row.amount, paid_at: row.paid_at, note: row.note }).eq('id', f.id) : await sb().from('ledger_payments').insert(row);
        if (r.error) throw r.error; L.payForm = null; L.open[a.id] = true; await load2();
      });
    },
    'lg-pay-del': function (el) { guard(async function () { var r = await sb().from('ledger_payments').delete().eq('id', el.dataset.id); if (r.error) throw r.error; await load2(); }); },
    'lg-receipt': function (el) { var p = findPay(el.dataset.id); if (p) receiptWindow(p); },
    'lg-receipt-word': function (el) { var p = findPay(el.dataset.id); if (p) saveBlob('receipt-' + p.paid_at + '.doc', new Blob(['﻿', receiptWord(p)], { type: 'application/msword;charset=utf-8' })); },
    'lg-land-fill': function () { var set = function (id, v) { var e = $q('#' + id); if (e) e.value = v; }; set('lf-plot', '2'); set('lf-parcel', '2346'); set('lf-area', '268 م²'); set('lf-loc', 'أراضي النصيرات - قنى دير البلح'); set('lf-cdate', '2023-09-30'); set('lf-desc', 'قسط شهري من باقي بيع قطعة أرض مساحتها (268) متر مربع من أراضي النصيرات - قنى دير البلح، قسيمة رقم (2)، قطعة رقم (2346)، وذلك حسب الاتفاق الذي نص عليه عقد البيع بين الطرفين والذي أبرم وحرر بتاريخ 30-09-2023'); },
    'lg-prof-open': function () { L.profForm = true; draw(); },
    'lg-prof-cancel': function () { L.profForm = false; draw(); },
    'lg-prof-nosig': function () { L.prof = Object.assign({}, L.prof, { sig: null }); draw(); },
    'lg-prof-save': function () {
      var f = ($q('#pr-sig') || {}).files, file = f && f[0], me = PA() && PA().user && PA().user();
      var base = { full_name: val('pr-name').trim() || null, id_no: val('pr-id').trim() || null, sig: L.prof && L.prof.sig || null };
      guard(async function () {
        if (file) base.sig = await readSig(file);
        var r = await sb().from('ledger_profile').upsert(Object.assign({ owner: me && me.id }, base));
        if (r.error) throw r.error; L.prof = base; L.profForm = false; toast_(T('تم الحفظ', 'Saved'));
      });
    },
    'lg-rep-open': function () { L.rep = true; draw(); },
    'lg-rep-close': function () { L.rep = false; draw(); },
    'lg-rep-run': function () { L.from = val('rp-from'); L.to = val('rp-to'); draw(); },
    'lg-rep-word': function () { L.from = val('rp-from') || L.from; L.to = val('rp-to') || L.to; saveBlob('payments-report-' + today() + '.doc', new Blob(['﻿', reportWord()], { type: 'application/msword;charset=utf-8' })); },
    'lg-rep-csv': function () { saveBlob('payments-report-' + today() + '.csv', new Blob([reportCsv()], { type: 'text/csv;charset=utf-8' })); }
  };
  async function load2() {
    var a = await sb().from('ledger_accounts').select('*').order('created_at', { ascending: false }).limit(2000);
    if (a.error) throw a.error;
    var p = await sb().from('ledger_payments').select('*').order('paid_at', { ascending: false }).order('id', { ascending: false }).limit(10000);
    if (p.error) throw p.error;
    L.acc = a.data || []; L.pay = p.data || [];
  }
  document.addEventListener('input', function (e) { if (e.target && e.target.dataset && e.target.dataset.lg === 'q') { L.q = e.target.value; var pos = e.target.selectionStart; draw(); var q = document.getElementById('lg-q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} } } });
  window.EXTRA_ACT = window.EXTRA_ACT || {};
  Object.keys(ACTS).forEach(function (k) { window.EXTRA_ACT[k] = ACTS[k]; });
})();
