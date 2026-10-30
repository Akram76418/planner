/* المشاريع الخارجية للموظفين (للمدير فقط). يستخدم جدول tawasul الموجود external_projects كما هو، وصلاحيته للمدير فقط (is_admin()).
   رقم الهوية لا يُحمَّل في القوائم ولا في الشاشة، ويُقرأ فقط عند اختيار تضمينه في التصدير. */
(function () {
  'use strict';
  var P = window.PLANNER_AUTH;
  if (!P) return;
  var h = P.h;
  var COLS = 'id,full_name,employee_number,category,has_project,department,project_org,project_org_other,project_nature,start_date,duration,expected_end_date,updated_at';
  var CATS = ['أكاديمي', 'إداري', 'شركة نظافة', 'متطوع'];
  var EX = { rows: null, q: '', f: 'all', cat: 'all', edit: null, imp: null, busy: false, err: '', ok: '', loaded: false };
  // [حقل، عنوان عربي، عنوان إنجليزي، نمط التعرف على العنوان في الملف]
  var FIELDS = [
    ['full_name', 'الاسم الكامل', 'Full name', /اسم|full.?name|^name$/i],
    ['employee_number', 'الرقم الوظيفي', 'Employee number', /وظيف|employee/i],
    ['national_id', 'رقم الهوية', 'National ID', /هوية|national/i],
    ['category', 'التصنيف', 'Category', /تصنيف|فئة|category/i],
    ['has_project', 'لديه مشروع', 'Has project', /لديه|has.?project|مشروع\s*\(?نعم/i],
    ['department', 'القسم', 'Department', /قسم|department/i],
    ['project_org', 'جهة المشروع', 'Project organization', /جهة\s*المشروع|project.?org(?!.*other)/i],
    ['project_org_other', 'جهة أخرى', 'Other organization', /جهة\s*أخرى|جهة\s*اخرى|org.?other|other.?org/i],
    ['project_nature', 'طبيعة المشروع', 'Project nature', /طبيعة|nature/i],
    ['start_date', 'تاريخ البداية', 'Start date', /بداية|بدء|start/i],
    ['duration', 'المدة', 'Duration', /مدة|duration/i],
    ['expected_end_date', 'تاريخ الانتهاء المتوقع', 'Expected end date', /انتهاء|نهاية|end/i]
  ];
  function ar() { return P.lang() === 'ar'; }
  function T(a, e) { return ar() ? a : e; }
  function sb() { return P.sb(); }
  function $x(s) { return document.querySelector(s); }
  function toast_(m) { if (typeof toast === 'function') toast(m); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function isAdmin() { return !!(window.CAN && window.CAN('proj')); }

  var css = document.createElement('style');
  css.textContent = '.ex-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:12px}.ex-stats .card{padding:10px 12px}.ex-stats b{font-size:22px;display:block}' +
    '.ex-f{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.ex-f label{display:flex;flex-direction:column;gap:4px;font-size:13px}.ex-late{color:var(--bad,#c0392b);font-weight:600}';
  document.head.appendChild(css);

  window.projView = function () { return '<div id="ex-root"></div>'; };
  window.projMount = function () { draw(); if (!EX.loaded) { EX.loaded = true; load(); } };

  async function load() {
    try {
      var r = await sb().from('external_projects').select(COLS).order('full_name', { ascending: true }).limit(2000);
      if (r.error) throw r.error;
      EX.rows = r.data || []; EX.err = '';
    } catch (e) { EX.err = e.message || String(e); EX.rows = EX.rows || []; }
    draw();
  }
  function canon(v) { return String(v == null ? '' : v).replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, '').toLowerCase(); }
  var ALIAS = { academic: 'أكاديمي', faculty: 'أكاديمي', admin: 'إداري', administrative: 'إداري', admin_staff: 'إداري', cleaning: 'شركة نظافة', cleaningcompany: 'شركة نظافة', cleaner: 'شركة نظافة', volunteer: 'متطوع', volunteers: 'متطوع' };
  function catOf(v) { var c = canon(v).replace(/[_\-]/g, ''); if (ALIAS[c]) return ALIAS[c]; c = canon(v); for (var i = 0; i < CATS.length; i++) if (canon(CATS[i]) === c) return CATS[i]; return v ? String(v).trim() : ''; }
  function allCats() { var m = CATS.slice(); (EX.rows || []).forEach(function (r) { var c = catOf(r.category); if (c && m.indexOf(c) < 0) m.push(c); }); return m; }
  function inCat(r, cat) { return cat === 'all' ? true : cat === '_none' ? !catOf(r.category) : catOf(r.category) === cat; }
  function inStatus(r, f) { return f === 'all' || (f === 'yes' && r.has_project) || (f === 'no' && !r.has_project) || (f === 'late' && r.has_project && r.expected_end_date && r.expected_end_date < today()); }
  function distinct(k) { var m = {}; (EX.rows || []).forEach(function (r) { if (r[k]) m[r[k]] = 1; }); return Object.keys(m).sort(); }
  function dl(id, k) { return '<datalist id="' + id + '">' + distinct(k).map(function (v) { return '<option value="' + h(v) + '">'; }).join('') + '</datalist>'; }

  function filtered() {
    var q = EX.q.trim().toLowerCase();
    return (EX.rows || []).filter(function (r) {
      if (!inCat(r, EX.cat) || !inStatus(r, EX.f)) return false;
      if (!q) return true;
      return [r.full_name, r.employee_number, r.department, r.category, r.project_org, r.project_org_other, r.project_nature].join(' ').toLowerCase().indexOf(q) > -1;
    });
  }
  function listHtml() {
    var list = filtered();
    return '<div class="list">' + (list.map(function (r) {
      var org = r.project_org === 'أخرى' || r.project_org === 'other' ? (r.project_org_other || r.project_org) : (r.project_org || r.project_org_other);
      var late = r.has_project && r.expected_end_date && r.expected_end_date < today();
      return '<div class="row"><div class="main"><div class="t">' + h(r.full_name) + (r.has_project ? ' <span class="pill ok">' + h(T('لديه مشروع', 'Has project')) + '</span>' : ' <span class="pill">' + h(T('بلا مشروع', 'No project')) + '</span>') + '</div>' +
        '<div class="sub">' + [r.category, r.department, r.employee_number].filter(Boolean).map(h).join(' · ') + '</div>' +
        (r.has_project ? '<div class="sub">' + [org, r.project_nature].filter(Boolean).map(h).join(' · ') + (r.start_date || r.expected_end_date ? ' · ' + h(r.start_date || '') + ' → <span class="' + (late ? 'ex-late' : '') + '">' + h(r.expected_end_date || '') + '</span>' : '') + (r.duration ? ' · ' + h(r.duration) : '') + '</div>' : '') +
        '</div><div class="act"><button class="btn sm" data-act="ex-edit" data-id="' + r.id + '">' + h(T('تعديل', 'Edit')) + '</button> <button class="btn sm bad" data-act="ex-del" data-id="' + r.id + '" data-confirm="1">' + h(T('حذف', 'Delete')) + '</button></div></div>';
    }).join('') || '<div class="empty">' + h(T('لا نتائج', 'No results')) + '</div>') + '</div>';
  }
  function statsHtml() {
    var rows = (EX.rows || []).filter(function (r) { return inCat(r, EX.cat); }), withP = rows.filter(function (r) { return r.has_project; }).length, late = rows.filter(function (r) { return r.has_project && r.expected_end_date && r.expected_end_date < today(); }).length;
    var s = function (n, l) { return '<div class="card"><b>' + n + '</b><span class="sub">' + h(l) + '</span></div>'; };
    return '<div class="ex-stats">' + s(rows.length, T('إجمالي الموظفين', 'Total staff')) + s(withP, T('لديهم مشروع', 'With a project')) + s(rows.length - withP, T('بلا مشروع', 'Without')) + s(late, T('تجاوزوا تاريخ الانتهاء', 'Past end date')) + '</div>';
  }

  function chipsHtml() {
    var base = EX.rows || [];
    var cnt = function (cat, f) { return base.filter(function (r) { return inCat(r, cat) && inStatus(r, f); }).length; };
    var cats = [['all', T('الجميع', 'All')]].concat(allCats().map(function (c) { return [c, c]; }));
    if (base.some(function (r) { return !catOf(r.category); })) cats.push(['_none', T('بلا تصنيف', 'Unclassified')]);
    var sts = [['all', T('الكل', 'All')], ['yes', T('على مشروع', 'On a project')], ['no', T('ليس على مشروع', 'Not on a project')], ['late', T('تجاوزوا تاريخ الانتهاء', 'Past end date')]];
    var chip = function (on, attr, label, n) { return '<button class="btn sm' + (on ? ' pri' : '') + '" ' + attr + '>' + h(label) + ' (' + n + ')</button>'; };
    return '<div class="cm-tabs" style="margin:10px 0 4px"><b class="sub" style="align-self:center">' + h(T('التصنيف:', 'Category:')) + '</b>' + cats.map(function (c) { return chip(EX.cat === c[0], 'data-act="ex-cat" data-v="' + h(c[0]) + '"', c[1], cnt(c[0], EX.f)); }).join('') + '</div>' +
      '<div class="cm-tabs" style="margin:0 0 10px"><b class="sub" style="align-self:center">' + h(T('المشروع:', 'Project:')) + '</b>' + sts.map(function (c) { return chip(EX.f === c[0], 'data-act="ex-st" data-v="' + c[0] + '"', c[1], cnt(EX.cat, c[0])); }).join('') + '</div>';
  }

  function formHtml() {
    var e = EX.edit, v = function (k) { return h(e[k] == null ? '' : e[k]); };
    var inp = function (k, label, type, extra) { return '<label>' + h(label) + '<input id="ef-' + k + '" type="' + (type || 'text') + '" value="' + v(k) + '"' + (extra || '') + '></label>'; };
    return '<div class="card"><h2>' + h(e.id ? T('تعديل بيانات موظف', 'Edit staff record') : T('إضافة موظف', 'Add staff')) + '</h2>' +
      dl('dl-dep', 'department') + dl('dl-org', 'project_org') + dl('dl-nat', 'project_nature') +
      '<div class="ex-f">' + inp('full_name', T('الاسم الكامل *', 'Full name *')) + inp('employee_number', T('الرقم الوظيفي', 'Employee number'), 'text', ' dir="ltr"') +
      '<label>' + h(T('رقم الهوية', 'National ID')) + '<input id="ef-national_id" dir="ltr" autocomplete="off" placeholder="' + h(e.id ? T('اتركه فارغاً للإبقاء على الموجود', 'Leave blank to keep the existing one') : '') + '"></label>' +
      '<label>' + h(T('التصنيف', 'Category')) + '<select id="ef-category"><option value="">—</option>' + allCats().map(function (c) { return '<option value="' + h(c) + '"' + (catOf(e.category) === c ? ' selected' : '') + '>' + h(c) + '</option>'; }).join('') + '</select></label>' + inp('department', T('القسم', 'Department'), 'text', ' list="dl-dep"') +
      '<label class="ck" style="align-self:end"><input id="ef-has_project" type="checkbox"' + (e.has_project ? ' checked' : '') + '> ' + h(T('لديه مشروع خارجي', 'Has an external project')) + '</label></div>' +
      '<div id="ef-proj" class="ex-f" style="margin-top:10px' + (e.has_project ? '' : ';display:none') + '">' +
      inp('project_org', T('جهة المشروع', 'Project organization'), 'text', ' list="dl-org"') + inp('project_org_other', T('جهة أخرى (إن لزم)', 'Other organization')) +
      inp('project_nature', T('طبيعة المشروع', 'Project nature'), 'text', ' list="dl-nat"') + inp('start_date', T('تاريخ البداية', 'Start date'), 'date') +
      inp('duration', T('المدة', 'Duration')) + inp('expected_end_date', T('تاريخ الانتهاء المتوقع', 'Expected end date'), 'date') + '</div>' +
      '<div class="tabs" style="margin-top:12px"><button class="btn pri" data-act="ex-save"' + (EX.busy ? ' disabled' : '') + '>' + h(T('حفظ', 'Save')) + '</button><button class="btn" data-act="ex-cancel">' + h(T('إلغاء', 'Cancel')) + '</button></div></div>';
  }

  function importHtml() {
    var I = EX.imp;
    return '<div class="card"><h2>' + h(T('معاينة الاستيراد', 'Import preview')) + '</h2><p class="sub">' +
      h(T('جديد: ' + I.add.length + ' · تحديث: ' + I.upd.length + ' · غير صالح: ' + I.bad, 'New: ' + I.add.length + ' · Update: ' + I.upd.length + ' · Invalid: ' + I.bad)) + '</p>' +
      '<p class="sub">' + h(T('التحديث يطابق الرقم الوظيفي، وإن لم يوجد فرقم الهوية، وإن لم يوجد فالاسم الكامل. الخلايا الفارغة في الملف لا تمسح البيانات الموجودة.', 'Matching uses employee number, then national ID, then full name. Blank cells never erase existing data.')) + '</p>' +
      '<div class="list">' + I.add.slice(0, 5).concat(I.upd.slice(0, 5).map(function (u) { return u.data; })).map(function (r) { return '<div class="row"><div class="main"><div class="t">' + h(r.full_name) + '</div><div class="sub">' + h([r.employee_number, r.department].filter(Boolean).join(' · ')) + '</div></div></div>'; }).join('') + '</div>' +
      '<div class="tabs" style="margin-top:10px"><button class="btn pri" data-act="ex-import-go"' + (EX.busy ? ' disabled' : '') + '>' + h(T('تنفيذ الاستيراد', 'Run import')) + '</button><button class="btn" data-act="ex-import-cancel">' + h(T('إلغاء', 'Cancel')) + '</button></div></div>';
  }

  function draw() {
    var root = $x('#ex-root'); if (!root) return;
    if (!isAdmin()) { root.innerHTML = '<div class="card"><div class="empty">' + h(T('هذه الصفحة للإدارة فقط', 'Admin only')) + '</div></div>'; return; }
    var body;
    if (EX.edit) body = formHtml();
    else if (EX.imp) body = importHtml();
    else {
      body = statsHtml() + '<div class="card"><div class="tabs" style="margin-bottom:10px"><button class="btn pri" data-act="ex-new">+ ' + h(T('إضافة موظف', 'Add staff')) + '</button>' +
        '<label class="btn" style="cursor:pointer">⬆ ' + h(T('استيراد Excel / CSV', 'Import Excel / CSV')) + '<input type="file" hidden accept=".xlsx,.xls,.csv" data-ex="file"></label>' +
        '<button class="btn" data-act="ex-xlsx">⬇ ' + h(T('تصدير المعروض Excel', 'Export shown (Excel)')) + '</button><button class="btn" data-act="ex-csv">⬇ CSV</button><button class="btn" data-act="ex-xlsx-all">⬇ ' + h(T('كل تصنيف في ورقة', 'One sheet per category')) + '</button><button class="btn sm" data-act="ex-tpl">' + h(T('نموذج فارغ', 'Blank template')) + '</button>' +
        '<label class="ck"><input id="ex-withid" type="checkbox"> ' + h(T('تضمين رقم الهوية في التصدير', 'Include national ID in export')) + '</label></div>' +
        '<div class="form"><label>' + h(T('بحث', 'Search')) + '<input id="ex-q" value="' + h(EX.q) + '" data-ex="q" placeholder="' + h(T('اسم، رقم وظيفي، قسم، جهة…', 'name, number, department…')) + '"></label>' +
        '</div>' + chipsHtml() +
        '<div id="ex-list">' + (EX.rows ? listHtml() : '<div class="empty">' + h(T('جارٍ التحميل…', 'Loading…')) + '</div>') + '</div></div>';
    }
    root.innerHTML = '<header class="top"><h1>' + h(T('المشاريع الخارجية', 'External projects')) + '</h1></header>' +
      (EX.err ? '<p class="pill bad">' + h(EX.err) + '</p>' : '') + (EX.ok ? '<p class="pill ok">' + h(EX.ok) + '</p>' : '') + body;
  }

  /* ---------- helpers: values ---------- */
  function norm(v) { return String(v == null ? '' : v).replace(/[٠-٩]/g, function (d) { return d.charCodeAt(0) - 1632; }).trim(); }
  function parseBool(v) { return /^(نعم|yes|y|true|1|✓|لديه)$/i.test(norm(v)); }
  function parseDate(v) {
    var s = norm(v); if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
    if (m) { var d = +m[1], mo = +m[2]; if (mo > 12 && d <= 12) { var t = d; d = mo; mo = t; } return m[3] + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2); }
    if (/^\d{5}$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + (+s) * 86400000).toISOString().slice(0, 10);
    return null;
  }
  function cleanRow(o) {
    var r = {};
    FIELDS.forEach(function (f) {
      var k = f[0], v = o[k];
      if (v == null || norm(v) === '') return;
      if (k === 'has_project') r[k] = typeof v === 'boolean' ? v : parseBool(v);
      else if (k === 'start_date' || k === 'expected_end_date') { var d = parseDate(v); if (d) r[k] = d; }
      else if (k === 'category') r[k] = catOf(norm(v));
      else r[k] = norm(v);
    });
    return r;
  }

  /* ---------- save / delete ---------- */
  async function guard(fn) { try { EX.err = ''; EX.ok = ''; await fn(); } catch (e) { EX.err = e.message || String(e); } EX.busy = false; draw(); }
  function readForm() {
    var g = function (k) { return ((document.getElementById('ef-' + k) || {}).value || '').trim(); };
    var o = { full_name: g('full_name'), employee_number: g('employee_number') || null, category: g('category') || null, department: g('department') || null,
      has_project: !!(document.getElementById('ef-has_project') || {}).checked };
    ['project_org', 'project_org_other', 'project_nature', 'duration'].forEach(function (k) { o[k] = o.has_project ? (g(k) || null) : null; });
    ['start_date', 'expected_end_date'].forEach(function (k) { o[k] = o.has_project ? (g(k) || null) : null; });
    var nid = g('national_id'); if (nid) o.national_id = nid;
    return o;
  }
  async function save() {
    var o = readForm(), id = EX.edit.id;
    var old = (EX.rows || []).filter(function (r) { return r.id === id; })[0];
    if (old && old.category && catOf(old.category) === o.category) o.category = old.category;   // keep the original spelling if the class did not change
    EX.edit = Object.assign({}, EX.edit, o);   // keep what was typed if validation or saving fails
    if (!o.full_name) { EX.err = T('الاسم مطلوب', 'Name is required'); return draw(); }
    if (o.has_project && o.start_date && o.expected_end_date && o.expected_end_date < o.start_date) { EX.err = T('تاريخ الانتهاء قبل البداية', 'End date is before start date'); return draw(); }
    EX.busy = true; draw();
    await guard(async function () {
      o.updated_at = new Date().toISOString();
      var r = id ? await sb().from('external_projects').update(o).eq('id', id) : await sb().from('external_projects').insert(o);
      if (r.error) throw r.error;
      EX.edit = null; EX.ok = T('تم الحفظ', 'Saved'); await load();
    });
  }

  /* ---------- export / import ---------- */
  function scopeName() { return (EX.cat === 'all' ? 'all' : EX.cat === '_none' ? 'unclassified' : EX.cat.replace(/\s+/g, '-')) + '-' + EX.f; }
  async function fetchForExport(onlyCat) {
    var withId = !!(document.getElementById('ex-withid') || {}).checked;
    var r = await sb().from('external_projects').select(withId ? COLS + ',national_id' : COLS).order('full_name', { ascending: true }).limit(5000);
    if (r.error) throw r.error;
    var fields = FIELDS.filter(function (f) { return withId || f[0] !== 'national_id'; });
    var head = fields.map(function (f) { return ar() ? f[1] : f[2]; });
    var ids = {}; (onlyCat ? (EX.rows || []).filter(function (x) { return inCat(x, onlyCat); }) : filtered()).forEach(function (x) { ids[x.id] = 1; });
    var rows = (r.data || []).filter(function (x) { return ids[x.id]; }).map(function (x) { return fields.map(function (f) { var v = x[f[0]]; return f[0] === 'has_project' ? (v ? T('نعم', 'Yes') : T('لا', 'No')) : (v == null ? '' : v); }); });
    return [head].concat(rows);
  }
  function csvOf(aoa) { return '﻿' + aoa.map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); return /[",\n\r]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n'); }
  function saveBlob(name, blob) { var u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 2000); }
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function (res, rej) { var sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; sc.onload = res; sc.onerror = function () { rej(new Error(T('تعذّر تحميل مكتبة Excel. استخدم CSV أو تحقق من الاتصال', 'Could not load the Excel library; use CSV'))); }; document.head.appendChild(sc); });
  }
  function parseSheet(data) {
    data = data.filter(function (r) { return r.some(function (c) { return norm(c); }); });
    if (data.length < 2) throw new Error(T('الملف فارغ أو بلا بيانات', 'File is empty'));
    var head = data[0].map(function (c) { return norm(c); }), idx = {};
    FIELDS.forEach(function (f) { for (var i = 0; i < head.length; i++) if (idx[f[0]] == null && f[3].test(head[i]) && !Object.keys(idx).some(function (k) { return idx[k] === i; })) { idx[f[0]] = i; break; } });
    if (idx.full_name == null) throw new Error(T('لم أجد عمود «الاسم الكامل» في السطر الأول', 'No "Full name" column found in the first row'));
    return data.slice(1).map(function (r) { var o = {}; Object.keys(idx).forEach(function (k) { o[k] = r[idx[k]]; }); return cleanRow(o); });
  }
  async function readFile(file) {
    if (!file) return;
    await guard(async function () {
      var data;
      if (/\.csv$/i.test(file.name)) {
        var txt = (await file.text()).replace(/^﻿/, ''), rows = [], row = [], cell = '', q = false;
        for (var i = 0; i < txt.length; i++) {
          var c = txt[i];
          if (q) { if (c === '"') { if (txt[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
          else if (c === '"') q = true;
          else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; }
          else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
          else if (c !== '\r') cell += c;
        }
        if (cell || row.length) { row.push(cell); rows.push(row); }
        data = rows;
      } else {
        await loadXlsx();
        var wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
        data = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
      }
      var parsed = parseSheet(data), add = [], upd = [], bad = 0;
      var withNid = parsed.some(function (r) { return r.national_id; });
      var cur = EX.rows || [], nidMap = {};
      if (withNid) { var rr = await sb().from('external_projects').select('id,national_id'); if (rr.error) throw rr.error; (rr.data || []).forEach(function (x) { if (x.national_id) nidMap[x.national_id] = x.id; }); }
      var seen = {};
      parsed.forEach(function (r) {
        if (!r.full_name) { bad++; return; }
        var m = null;
        if (r.employee_number) m = cur.filter(function (x) { return x.employee_number === r.employee_number; })[0];
        if (!m && r.national_id && nidMap[r.national_id]) m = { id: nidMap[r.national_id] };
        if (!m) m = cur.filter(function (x) { return x.full_name === r.full_name; })[0];
        var key = m ? 'u' + m.id : 'n' + (r.employee_number || r.full_name);
        if (seen[key]) { bad++; return; } seen[key] = 1;
        if (r.has_project === false) { r.project_org = r.project_org || null; }
        if (m) upd.push({ id: m.id, data: r }); else add.push(r);
      });
      EX.imp = { add: add, upd: upd, bad: bad };
    });
  }
  async function runImport() {
    var I = EX.imp; EX.busy = true; draw();
    await guard(async function () {
      var now = new Date().toISOString();
      if (I.add.length) { var r = await sb().from('external_projects').insert(I.add.map(function (x) { return Object.assign({ has_project: false, updated_at: now }, x); })); if (r.error) throw r.error; }
      for (var i = 0; i < I.upd.length; i++) { var u = await sb().from('external_projects').update(Object.assign({}, I.upd[i].data, { updated_at: now })).eq('id', I.upd[i].id); if (u.error) throw u.error; }
      EX.ok = T('تم الاستيراد: جديد ' + I.add.length + '، تحديث ' + I.upd.length, 'Imported: ' + I.add.length + ' new, ' + I.upd.length + ' updated');
      EX.imp = null; await load();
    });
  }

  /* ---------- events ---------- */
  var ACTS = {
    'ex-new': function () { EX.edit = { has_project: false }; EX.ok = ''; draw(); },
    'ex-edit': function (el) { EX.edit = (EX.rows || []).filter(function (r) { return String(r.id) === el.dataset.id; })[0]; EX.ok = ''; draw(); },
    'ex-cancel': function () { EX.edit = null; EX.err = ''; draw(); },
    'ex-save': function () { save(); },
    'ex-del': function (el) { guard(async function () { var r = await sb().from('external_projects').delete().eq('id', Number(el.dataset.id)); if (r.error) throw r.error; EX.ok = T('تم الحذف', 'Deleted'); await load(); }); },
    'ex-import-cancel': function () { EX.imp = null; draw(); },
    'ex-import-go': function () { runImport(); },
    'ex-csv': function () { guard(async function () { saveBlob('external-projects-' + scopeName() + '-' + today() + '.csv', new Blob([csvOf(await fetchForExport())], { type: 'text/csv;charset=utf-8' })); }); },
    'ex-xlsx': function () { guard(async function () { var a = await fetchForExport(); await loadXlsx(); var wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(a), 'Projects'); window.XLSX.writeFile(wb, 'external-projects-' + scopeName() + '-' + today() + '.xlsx'); }); },
    'ex-xlsx-all': function () { guard(async function () { await loadXlsx(); var wb = window.XLSX.utils.book_new(); var cats = allCats(); for (var i = 0; i < cats.length; i++) { var a = await fetchForExport(cats[i]); if (a.length > 1) window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(a), cats[i].slice(0, 30)); } if (!wb.SheetNames.length) throw new Error(T('لا بيانات للتصدير', 'Nothing to export')); window.XLSX.writeFile(wb, 'external-projects-by-category-' + today() + '.xlsx'); }); },
    'ex-cat': function (el) { EX.cat = el.dataset.v; draw(); },
    'ex-st': function (el) { EX.f = el.dataset.v; draw(); },
    'ex-tpl': function () { saveBlob('external-projects-template.csv', new Blob([csvOf([FIELDS.map(function (f) { return ar() ? f[1] : f[2]; }), []])], { type: 'text/csv;charset=utf-8' })); }
  };
  window.EXTRA_ACT = Object.assign(window.EXTRA_ACT || {}, ACTS);
  document.addEventListener('input', function (e) {
    var k = e.target.dataset && e.target.dataset.ex;
    if (k === 'q') { EX.q = e.target.value; var l = $x('#ex-list'); if (l) l.innerHTML = listHtml(); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target, k = t.dataset && t.dataset.ex;
    if (k === 'file') { var f = t.files[0]; t.value = ''; readFile(f); }
    else if (t.id === 'ef-has_project') { var p = $x('#ef-proj'); if (p) p.style.display = t.checked ? '' : 'none'; }
  });
})();
