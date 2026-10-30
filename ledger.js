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
  var L = { acc: [], pay: [], dir: '', q: '', open: {}, form: null, payForm: null, rep: false, from: '', to: '', loaded: false, busy: false, err: '' };

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
      '<label style="grid-column:1/-1">' + h(T('ملاحظة', 'Note')) + '<input id="lf-note" value="' + h(f.note || '') + '"></label></div>' +
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
        return '<div class="row"><div class="main"><div class="t">' + h(money(p.amount, a.currency)) + '</div><div class="sub">' + h(dayDate(p.paid_at)) + (p.note ? ' · ' + h(p.note) : '') + '</div></div><div class="act"><button class="btn sm" data-act="lg-pay-edit" data-id="' + p.id + '">' + h(T('تعديل', 'Edit')) + '</button> <button class="btn sm bad" data-act="lg-pay-del" data-id="' + p.id + '" data-confirm="1">' + h(T('حذف', 'Delete')) + '</button></div></div>';
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
      ' <input id="lg-q" data-lg="q" placeholder="' + h(T('بحث بالاسم…', 'Search…')) + '" value="' + h(L.q) + '" style="max-width:200px"> <button class="btn pri" data-act="lg-acc-new">+ ' + h(T('حساب جديد', 'New account')) + '</button> <button class="btn" data-act="lg-rep-open">' + h(T('تقرير', 'Report')) + '</button></div>' +
      accountForm() + reportHtml() + (list.map(accountCard).join('') || '<div class="empty">' + h(T('لا حسابات. اضغط «حساب جديد».', 'No accounts yet.')) + '</div>') + '</div>';
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
      var row = { person: person, direction: val('lf-dir'), total: total, currency: val('lf-cur'), note: val('lf-note').trim() || null };
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
