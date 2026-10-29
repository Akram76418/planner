/* التواصل: محادثات فردية (tawasul) + قنوات الموظفين + إعلانات الشعب + إدارة الحسابات.
   يعتمد على sync.js (window.PLANNER_AUTH) وعلى ملفي comm-schema.sql و accounts.sql. */
(function () {
  'use strict';
  var P = window.PLANNER_AUTH;
  if (!P) return;
  var h = P.h;
  var ST = { tab: null, conv: null, convs: [], msgs: [], recips: null, q: '', chan: 'all', cohorts: [], cohort: null,
    items: [], home: { sup: null, ann: [] }, sched: { rows: [], form: null }, polls: { rows: [], form: false }, week: { rows: [], note: '' }, unread: {}, dmUnread: 0, busy: false, err: '', draft: '', file: null, admin: { pending: [], students: [], staff: [], reqs: [], rows: null, rowsInfo: '', sheet: null, sel: {}, dups: null, dupSel: {}, note: '', q: '', res: null, sub: 'create' }, timer: null, loaded: false };
  var CHAN = { all: ['الجميع', 'Everyone'], academic: ['أكاديمي', 'Academic'], practical: ['مشرف عملي', 'Practical supervisor'], admin: ['إداري', 'Administrative'] };
  var ROLE = { student: ['طالب', 'Student'], professor: ['عضو هيئة تدريس', 'Faculty'], staff: ['موظف', 'Staff'], admin: ['إدارة', 'Admin'] };

  function ar() { return P.lang() === 'ar'; }
  function T(a, e) { return ar() ? a : e; }
  function sb() { return P.sb(); }
  function me() { return (P.user() || {}).id; }
  function ctx() { return window.CTX || {}; }
  function role() { return ctx().role; }
  function isAdmin() { return role() === 'admin'; }
  function isStaff() { return role() === 'admin' || role() === 'professor' || role() === 'staff'; }
  function toast_(m) { if (typeof toast === 'function') toast(m); }
  function $c(s) { return document.querySelector(s); }
  function fmt(d) { try { var x = new Date(d); return x.toLocaleDateString(ar() ? 'ar' : 'en', { month: 'short', day: 'numeric' }) + ' ' + x.toLocaleTimeString(ar() ? 'ar' : 'en', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function size(n) { n = Number(n) || 0; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  async function rpc(name, args) {
    var r = await sb().rpc(name, args || {});
    if (r.error) throw new Error(r.error.message);
    return r.data;
  }
  function fail(e) { ST.err = (e && e.message) || String(e); draw(); }

  /* ---------- CSS (once) ---------- */
  var css = document.createElement('style');
  css.textContent = '.cm-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}.cm-tabs .btn{position:relative}.cm-b{background:var(--bad,#c0392b);color:#fff;border-radius:99px;font-size:11px;padding:1px 6px;margin-inline-start:6px}' +
    '.cm-grid{display:grid;grid-template-columns:minmax(220px,300px) 1fr;gap:12px}@media(max-width:860px){.cm-grid{grid-template-columns:1fr}.cm-grid.open .cm-side{display:none}.cm-grid:not(.open) .cm-main{display:none}}' +
    '.cm-msgs{display:flex;flex-direction:column;gap:8px;max-height:58vh;overflow-y:auto;padding:4px}.cm-m{max-width:82%;padding:8px 12px;border-radius:12px;background:var(--card-2,rgba(127,127,127,.12));align-self:flex-start;white-space:pre-wrap;word-break:break-word}' +
    '.cm-m.me{align-self:flex-end;background:var(--accent-soft,#dbeafe)}.cm-m small{display:block;color:var(--muted);font-size:11px;margin-top:4px}.cm-m .nm{font-weight:600;font-size:12px;color:var(--muted)}' +
    '.cm-comp{display:flex;gap:8px;align-items:flex-end;margin-top:10px}.cm-comp textarea{flex:1;min-height:44px;max-height:140px}.cm-file{display:inline-flex;gap:6px;align-items:center;margin-top:6px;font-size:13px}' +
    '.cm-list .row.sel{outline:2px solid var(--accent)}.cm-ta{width:100%;min-height:120px;font-family:monospace;direction:ltr}';
  document.head.appendChild(css);

  /* ---------- entry points used by app.html ---------- */
  window.commView = function () { return '<div id="cm-root"></div>'; };
  window.commMount = function () {
    if (!ST.tab) ST.tab = role() === 'student' ? 'home' : 'dm';
    draw();
    if (!ST.loaded) { ST.loaded = true; boot(); }
    clearInterval(ST.timer); ST.timer = setInterval(poll, 8000);
  };
  async function boot() {
    try {
      if (!isAdmin()) { try { ST.admNames = {}; (await rpc('comm_admin_names') || []).forEach(function (x) { ST.admNames[String(x).trim()] = 1; }); ST.admIds = {}; (await rpc('comm_admin_ids') || []).forEach(function (x) { ST.admIds[x] = 1; }); } catch (e) {} }
      if (isStaff()) ST.cohorts = await rpc('comm_list_cohorts');
      if (role() === 'student' && ctx().cohort_id) ST.cohort = ctx().cohort_id;
      else if (ST.cohorts[0]) ST.cohort = ST.cohorts[0].id;
      if (isAdmin()) { ST.admin.pending = await rpc('comm_pending_passwords'); ST.admin.reqs = await rpc('comm_list_requests').catch(function () { return []; }); }
      await loadDm(); await loadUnread(); await loadTab();
      if (role() === 'student') { try { await loadPolls(); } catch (e) {} }
    } catch (e) { ST.err = e.message; }
    draw();
  }
  async function poll() {
    if (typeof UI === 'undefined' || UI.view !== 'comm' || document.hidden || !navigator.onLine) { if (UI && UI.view !== 'comm') clearInterval(ST.timer); return; }
    try {
      await loadUnread();
      if (ST.tab === 'dm') { await loadDm(); if (ST.conv) await loadMsgs(true); }
      else if (ST.tab === 'staff' || ST.tab === 'ann') await loadTab(true);
      softDraw();
    } catch (e) {}
  }
  async function loadUnread() {
    var u = {}, rows = await rpc('comm_unread_counts').catch(function () { return []; });
    (rows || []).forEach(function (r) { u[r.scope] = Number(r.unread) || 0; });
    ST.unread = u;
    try { ST.dmUnread = Number(await rpc('communication_unread_total')) || 0; } catch (e) { ST.dmUnread = 0; }
  }
  async function loadDm() { ST.convs = (await rpc('list_communication_conversations', { folder: 'inbox', page_size: 50 })) || []; }
  async function loadMsgs(keepScroll) {
    var rows = await rpc('comm_dm_messages', { p_conv: ST.conv.id, p_limit: 60 });
    ST.msgs = (rows || []).slice().reverse();
    if (!keepScroll) { try { await rpc('mark_communication_conversation_read', { target_conversation_id: ST.conv.id }); } catch (e) {} }
  }
  async function loadTab(quiet) {
    if (ST.tab === 'home') return loadHome();
    if (ST.tab === 'sched') return loadSched();
    if (ST.tab === 'poll') return loadPolls();
    if (ST.tab === 'week') return loadWeek();
    if (ST.tab === 'staff') {
      var rows = await rpc('comm_channel_list', { p_channel: ST.chan, p_limit: 60 });
      ST.items = (rows || []).slice().reverse();
      await sb().from('comm_reads').upsert({ user_id: me(), scope: 'ch:' + ST.chan, last_read_at: new Date().toISOString() });
    } else if (ST.tab === 'ann' && ST.cohort) {
      ST.items = (await rpc('comm_ann_list', { p_cohort: ST.cohort })) || [];
      await sb().from('comm_reads').upsert({ user_id: me(), scope: 'ann', last_read_at: new Date().toISOString() });
      if (!isAdmin()) { try { await rpc('comm_ann_mark_read', { p_cohort: ST.cohort }); } catch (e) {} }
    } else if (ST.tab === 'admin') {
      if (ST.admin.sub === 'requests') ST.admin.reqs = await rpc('comm_list_requests');
      if (ST.admin.sub === 'pending') ST.admin.pending = await rpc('comm_pending_passwords');
      if (ST.admin.sub === 'students') ST.admin.students = await rpc('comm_list_students', { p_search: ST.admin.q || '' });
      if (ST.admin.sub === 'staff') ST.admin.staff = await rpc('comm_list_staff');
      if (ST.admin.sub === 'assign') { ST.admin.staff = await rpc('comm_list_staff'); ST.admin.cp = await rpc('comm_cohort_professors'); }
      if (ST.admin.sub === 'cohorts') ST.cohorts = await rpc('comm_list_cohorts');
    }
  }

  /* ---------- files ---------- */
  function safeName(n) { var m = /\.[A-Za-z0-9]{1,8}$/.exec(n || ''); return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6) + (m ? m[0] : ''); }
  async function upload(prefix, f) {
    if (f.size > 20 * 1048576) throw new Error(T('الحجم الأقصى 20 ميغابايت', 'Max file size is 20 MB'));
    var path = prefix + '/' + me() + '/' + safeName(f.name);
    var r = await sb().storage.from('comm-files').upload(path, f, { contentType: f.type || 'application/octet-stream' });
    if (r.error) throw new Error(r.error.message);
    return { file_path: path, file_name: f.name.slice(0, 200), file_type: f.type || '', file_size: f.size };
  }
  async function openFile(path) {
    var r = await sb().storage.from('comm-files').createSignedUrl(path, 120);
    if (r.error) return toast_(r.error.message);
    window.open(r.data.signedUrl, '_blank', 'noopener');
  }
  function fileChip(m) { return m.file_path ? '<div><button class="btn sm" data-act="cm-file" data-p="' + h(m.file_path) + '">📎 ' + h(m.file_name || 'file') + ' · ' + size(m.file_size) + '</button></div>' : ''; }

  /* ---------- drawing ---------- */
  function badge(n) { return n > 0 ? '<span class="cm-b">' + n + '</span>' : ''; }
  function tabs() {
    var chU = 0; Object.keys(ST.unread).forEach(function (k) { if (k.indexOf('ch:') === 0) chU += ST.unread[k]; });
    var t = role() === 'student' ? [['home', T('الرئيسية', 'Home'), 0]] : [];
    t.push(['dm', T('المحادثات', 'Chats'), ST.dmUnread]);
    if (isStaff()) t.push(['staff', T('قنوات الموظفين', 'Staff channels'), chU]);
    t.push(['ann', T('إعلانات الشعب', 'Cohort announcements'), ST.unread.ann || 0]);
    t.push(['sched', T('الجدول', 'Schedule'), 0]);
    t.push(['poll', T('استبيانات', 'Polls'), role() === 'student' ? unvoted() : 0]);
    if (isStaff()) t.push(['week', T('جدول الدوام', 'Weekly roster'), 0]);
    if (isAdmin()) t.push(['admin', T('إدارة', 'Admin'), 0]);
    t.push(['me', T('حسابي', 'My account'), 0]);
    return '<div class="cm-tabs">' + t.map(function (x) { return '<button class="btn' + (ST.tab === x[0] ? ' pri' : '') + '" data-act="cm-tab" data-t="' + x[0] + '">' + h(x[1]) + badge(x[2]) + '</button>'; }).join('') + '</div>';
  }
  function draw() {
    var root = $c('#cm-root'); if (!root) return;
    var body = '';
    if (ST.tab === 'dm') body = dmHtml(); else if (ST.tab === 'staff') body = staffHtml(); else if (ST.tab === 'ann') body = annHtml();
    else if (ST.tab === 'home') body = homeHtml(); else if (ST.tab === 'sched') body = schedHtml(); else if (ST.tab === 'poll') body = pollHtml(); else if (ST.tab === 'week') body = weekHtml();
    else if (ST.tab === 'admin') body = adminHtml(); else body = meHtml();
    root.innerHTML = '<header class="top"><h1>' + h(T('التواصل', 'Communication')) + '</h1></header>' + tabs() +
      (ST.err ? '<p class="pill bad">' + h(ST.err) + '</p>' : '') + body;
    var box = root.querySelector('.cm-msgs'); if (box) box.scrollTop = ST.tab === 'ann' ? 0 : box.scrollHeight;
    var ta = root.querySelector('#cm-text'); if (ta) ta.value = ST.draft;
  }
  function softDraw() { var a = document.activeElement; if (a && (a.id === 'cm-text' || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) return; draw(); }

  function composer(ph) {
    return '<div class="cm-comp"><textarea id="cm-text" placeholder="' + h(ph) + '" data-cm="draft"></textarea>' +
      '<label class="btn" style="cursor:pointer">📎<input id="cm-file" type="file" hidden data-cm="file"></label>' +
      '<button class="btn pri" data-act="cm-send"' + (ST.busy ? ' disabled' : '') + '>' + h(T('إرسال', 'Send')) + '</button></div>' +
      (ST.file ? '<div class="cm-file">📎 ' + h(ST.file.name) + ' (' + size(ST.file.size) + ') <button class="btn sm" data-act="cm-unfile">✕</button></div>' : '');
  }
  /* أسماء المدراء تظهر لغير المدراء باسم «PCN» */
  function dn(n, id) { if (isAdmin()) return n; if (id && ST.admIds && ST.admIds[id]) return 'PCN'; return ST.admNames && ST.admNames[String(n || '').trim()] ? 'PCN' : n; }
  function msgHtml(m, mine, showName) {
    return '<div class="cm-m' + (mine ? ' me' : '') + '">' + (showName && !mine ? '<div class="nm">' + h(dn(m.sender_name || '', m.sender_id)) + '</div>' : '') +
      (m.title ? '<b>' + h(m.title) + '</b><br>' : '') + h(m.body || '') + fileChip(m) + '<small>' + h(fmt(m.created_at)) + '</small></div>';
  }

  function dmHtml() {
    var open = ST.conv ? ' open' : '';
    var list = '';
    if (ST.recips) {
      list = '<div class="form" style="margin-bottom:8px"><label>' + h(T('ابحث بالاسم أو الرقم', 'Search by name or number')) + '<input id="cm-q" value="' + h(ST.q) + '" data-cm="q"></label></div><div class="list cm-list">' +
        (ST.recips.map(function (r) { return '<button class="row click" data-act="cm-start" data-id="' + h(r.id) + '" data-n="' + h(dn(r.full_name, r.id)) + '"><div class="main"><div class="t">' + h(dn(r.full_name, r.id)) + '</div><div class="sub">' + h((ROLE[r.role] || [r.role, r.role])[ar() ? 0 : 1]) + (r.university_id ? ' · ' + h(r.university_id) : '') + '</div></div></button>'; }).join('') || '<div class="empty">' + h(T('لا نتائج', 'No results')) + '</div>') +
        '</div><button class="btn sm" data-act="cm-newclose">' + h(T('رجوع', 'Back')) + '</button>';
    } else {
      list = '<button class="btn pri" data-act="cm-new" style="margin-bottom:8px">' + h(T('+ محادثة جديدة', '+ New chat')) + '</button><div class="list cm-list">' +
        (ST.convs.map(function (c) { return '<button class="row click' + (ST.conv && ST.conv.id === c.id ? ' sel' : '') + '" data-act="cm-open" data-id="' + h(c.id) + '"><div class="main"><div class="t">' + h(dn(c.counterpart_name, c.counterpart_id || c.other_user_id || c.counterpart_user_id || c.participant_id) || '—') + badge(c.unread_count) + '</div><div class="sub">' + h(c.last_message_preview || '') + '</div></div></button>'; }).join('') || '<div class="empty">' + h(T('لا محادثات بعد', 'No chats yet')) + '</div>') + '</div>';
    }
    var main = ST.conv ? '<div class="card"><div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><button class="btn sm" data-act="cm-back">' + h(T('رجوع', 'Back')) + '</button><b>' + h(ST.conv.name || '') + '</b></div><div class="cm-msgs">' +
      ST.msgs.map(function (m) { return msgHtml(m, m.sender_id === me(), false); }).join('') + '</div>' + composer(T('اكتب رسالة…', 'Type a message…')) + '</div>'
      : '<div class="card"><div class="empty">' + h(T('اختر محادثة أو ابدأ محادثة جديدة', 'Pick a chat or start a new one')) + '</div></div>';
    return '<div class="cm-grid' + open + '"><div class="cm-side">' + list + '</div><div class="cm-main">' + main + '</div></div>';
  }

  function chanOptions() {
    var out = ['all'];
    if (isAdmin() || role() === 'professor') out = ['all', 'academic', 'practical', 'admin']; else if (ctx().category) out.push(ctx().category);
    return out;
  }
  function staffHtml() {
    var opts = chanOptions();
    if (opts.indexOf(ST.chan) < 0) ST.chan = 'all';
    return '<div class="card"><label>' + h(T('القناة', 'Channel')) + ' <select id="cm-chan" data-cm="chan">' + opts.map(function (c) { return '<option value="' + c + '"' + (c === ST.chan ? ' selected' : '') + '>' + h(CHAN[c][ar() ? 0 : 1]) + (ST.unread['ch:' + c] ? ' (' + ST.unread['ch:' + c] + ')' : '') + '</option>'; }).join('') + '</select></label>' +
      (!isAdmin() && role() !== 'professor' && !ctx().category ? '<p class="sub">' + h(T('لم تحدّد الإدارة تصنيفك بعد، لذلك ترى قناة «الجميع» فقط.', 'Your category is not set yet; you only see the Everyone channel.')) + '</p>' : '') +
      '<div class="cm-msgs" style="margin-top:10px">' + (ST.items.map(function (m) { return msgHtml(m, m.sender_id === me(), true); }).join('') || '<div class="empty">' + h(T('لا رسائل', 'No messages')) + '</div>') + '</div>' +
      composer(T('اكتب للقناة…', 'Write to the channel…')) + '</div>';
  }

  function annHtml() {
    var sel = '';
    if (isStaff()) sel = '<label>' + h(T('الشعبة', 'Cohort')) + ' <select id="cm-coh" data-cm="coh">' + ST.cohorts.filter(function (c) { return c.is_active; }).map(function (c) { return '<option value="' + c.id + '"' + (c.id === ST.cohort ? ' selected' : '') + '>' + h(c.name) + '</option>'; }).join('') + '</select></label>';
    else if (!ST.cohort) return '<div class="card"><div class="empty">' + h(T('لم تُسنَد إلى شعبة بعد. تواصل مع الإدارة.', 'You are not assigned to a cohort yet. Contact the administration.')) + '</div></div>';
    else sel = '<b>' + h(ctx().cohort_name || '') + '</b>';
    var post = isAdmin() ? '<div style="margin-top:10px"><label class="ck" style="margin-bottom:6px"><input type="checkbox" data-cm="annall"' + (ST.annAll ? ' checked' : '') + '> ' + h(T('إرسال إلى جميع الشعب دفعة واحدة', 'Send to all cohorts at once')) + '</label><input id="cm-title" placeholder="' + h(T('عنوان الإعلان (اختياري)', 'Title (optional)')) + '" data-cm="title" style="width:100%;margin-bottom:6px">' + composer(T('نص الإعلان…', 'Announcement…')) + '</div>' : '';
    return '<div class="card">' + sel + '<p class="sub">' + h(T('الإعلانات من الإدارة فقط، ولا يمكن الرد عليها.', 'Announcements come from the administration only; replies are not possible.')) + '</p>' +
      '<div class="cm-msgs">' + (ST.items.map(annMsg).join('') || '<div class="empty">' + h(T('لا إعلانات', 'No announcements')) + '</div>') + '</div>' + post + '</div>';
  }

  function meHtml() {
    var c = ctx();
    return '<div class="card"><h2>' + h(c.name || '') + '</h2><p class="sub">' + h((ROLE[c.role] || ['', ''])[ar() ? 0 : 1]) + (c.cohort_name ? ' · ' + h(c.cohort_name) : '') + '</p>' +
      '<div class="form"><label>' + h(T('كلمة مرور جديدة (8 أحرف على الأقل)', 'New password (min 8)')) + '<input id="cm-np" type="password" autocomplete="new-password"></label></div>' +
      '<div class="tabs"><button class="btn pri" data-act="cm-pw">' + h(T('تغيير كلمة المرور', 'Change password')) + '</button><button class="btn" data-act="push-enable">' + h(T('تفعيل إشعارات الرسائل على هذا الجهاز', 'Enable message notifications on this device')) + '</button><button class="btn" data-act="sign-out">' + h(T('تسجيل الخروج', 'Sign out')) + '</button></div></div>';
  }

  function adminHtml() {
    var A = ST.admin, subs = [['create', T('إنشاء حسابات', 'Create accounts')], ['requests', T('طلبات التسجيل', 'Sign-up requests') + ' (' + A.reqs.length + ')'], ['pending', T('لم يغيّروا كلمتهم', 'Not changed yet') + ' (' + A.pending.length + ')'], ['students', T('الطلبة والشعب', 'Students & cohorts')], ['dups', T('التكرار', 'Duplicates')], ['staff', T('تصنيف الموظفين', 'Staff categories')], ['assign', T('ربط الأكاديميين', 'Assign academics')], ['cohorts', T('الشعب', 'Cohorts')]];
    var nav = '<div class="cm-tabs">' + subs.map(function (s) { return '<button class="btn sm' + (A.sub === s[0] ? ' pri' : '') + '" data-act="cm-sub" data-s="' + s[0] + '">' + h(s[1]) + '</button>'; }).join('') + '</div>';
    var cohOpt = function (selId) { return ST.cohorts.map(function (c) { return '<option value="' + c.id + '"' + (c.id === selId ? ' selected' : '') + '>' + h(c.name) + '</option>'; }).join(''); };
    var body = '';
    if (A.sub === 'create') {
      body = '<p class="sub">' + h(T('ألصق سطراً لكل شخص: الرقم الأكاديمي (للموظف: الرقم الوظيفي) ثم فاصلة أو Tab ثم الاسم. كلمة المرور الافتراضية 12345678 ويُلزَم تغييرها عند أول دخول.', 'One person per line: academic number, comma or Tab, name. Default password 12345678; they must change it at first sign-in.')) + '</p>' +
        '<div style="margin:8px 0"><label class="btn" style="cursor:pointer">📄 ' + h(T('رفع ملف Excel أو CSV', 'Upload Excel or CSV')) + '<input type="file" hidden accept=".xlsx,.xls,.csv" data-cm="xlsx"></label> <span class="sub">' + h(T('أعمدة الملف: الرقم الجامعي، الاسم (اختياري: التخصص، الشعبة)', 'Columns: number, name (optional: major, cohort)')) + '</span></div>' +
        (A.rows ? '<p class="pill ok">' + h(A.rowsInfo) + ' <button class="btn sm" data-act="cm-clearrows">✕</button></p>' : '') +
        (A.sheet ? sheetHtml() : '') +
        '<textarea id="ac-list" class="cm-ta" data-cm="cf" data-k="list" placeholder="20250071, الاسم"' + (A.rows ? ' disabled' : '') + '>' + h(A.clist || '') + '</textarea>' +
        '<label class="ck" style="margin:6px 0"><input id="ac-same" type="checkbox" data-cm="cf" data-k="same"' + (A.csame ? ' checked' : '') + '> ' + h(T('السماح بأسماء متشابهة (الافتراضي: يُتخطى من اسمه موجود)', 'Allow similar names (default: skip existing names)')) + '</label>' +
        '<div class="form"><label>' + h(T('النوع', 'Type')) + '<select id="ac-role" data-cm="cf" data-k="role">' + ['student', 'staff', 'professor'].map(function (k) { return '<option value="' + k + '"' + ((A.crole || 'student') === k ? ' selected' : '') + '>' + h(ROLE[k][ar() ? 0 : 1]) + '</option>'; }).join('') + '</select></label>' +
        '<label>' + h(T('التخصص (اختياري)', 'Major (optional)')) + '<input id="ac-major" data-cm="cf" data-k="major" value="' + h(A.cmajor || '') + '"></label>' +
        '<label>' + h(T('الشعبة (للطلبة)', 'Cohort (students)')) + '<select id="ac-coh" data-cm="cf" data-k="coh"><option value="">—</option>' + cohOpt(Number(A.ccoh) || 0) + '</select></label>' +
        '<label>' + h(T('تصنيف (للموظفين)', 'Category (staff)')) + '<select id="ac-cat" data-cm="cf" data-k="cat"><option value="">—</option>' + ['academic', 'practical', 'admin'].map(function (k) { return '<option value="' + k + '"' + (A.ccat === k ? ' selected' : '') + '>' + h(CHAN[k][ar() ? 0 : 1]) + '</option>'; }).join('') + '</select></label></div>' +
        '<button class="btn pri" data-act="cm-create"' + (ST.busy ? ' disabled' : '') + '>' + h(ST.busy ? T('جارٍ الإنشاء…', 'Creating…') : T('إنشاء الحسابات', 'Create accounts')) + '</button>' +
        (A.res ? '<p class="sub">' + h(A.res) + '</p>' : '');
    } else if (A.sub === 'requests') {
      body = '<p class="sub">' + h(T('عند الموافقة يُنشأ الحساب بكلمة المرور 12345678 ويُلزَم الطالب بتغييرها.', 'On approval the account is created with password 12345678; the student must change it.')) + '</p>' +
        (A.reqs.length ? '<div class="form"><label>' + h(T('الشعبة عند الموافقة', 'Cohort on approval')) + '<select id="rq-coh"><option value="">—</option>' + cohOpt(0) + '</select></label><div style="align-self:end"><button class="btn pri" data-act="cm-approve-all" data-confirm="1"' + (ST.busy ? ' disabled' : '') + '>' + h(T('موافقة على الكل', 'Approve all')) + '</button></div></div>' : '') +
        '<div class="list">' + (A.reqs.map(function (r) { return '<div class="row"><div class="main"><div class="t">' + h(r.full_name) + '</div><div class="sub">' + (r.kind === 'staff' ? h(T('موظف', 'Staff')) + ' · ' : '') + h(r.number) + (r.major ? ' · ' + h(r.major) : '') + (r.phone ? ' · ' + h(r.phone) : '') + '</div></div><div class="act"><button class="btn sm pri" data-act="cm-approve" data-id="' + r.id + '">' + h(T('موافقة', 'Approve')) + '</button> <button class="btn sm bad" data-act="cm-reject" data-id="' + r.id + '" data-confirm="1">' + h(T('رفض', 'Reject')) + '</button></div></div>'; }).join('') || '<div class="empty">' + h(T('لا طلبات', 'No requests')) + '</div>') + '</div>';
    } else if (A.sub === 'pending') {
      body = '<p class="sub">' + h(T('هؤلاء لم يغيّروا كلمة المرور الافتراضية بعد.', 'These people have not changed the default password yet.')) + '</p>' +
        (A.pending.length ? '<div class="tabs" style="margin:8px 0"><label class="ck"><input type="checkbox" data-cm="pselall"' + (A.pending.length && pendSelCount() === A.pending.length ? ' checked' : '') + '> ' + h(T('تحديد الكل', 'Select all')) + '</label><button class="btn sm bad" data-act="cm-del-pend"' + (pendSelCount() ? '' : ' disabled') + '>' + h(T('حذف المحدد', 'Delete selected')) + ' (' + pendSelCount() + ')</button></div>' : '') + '<div class="list">' +
        (A.pending.map(function (p) { return '<div class="row"><label style="padding-inline-end:8px"><input type="checkbox" data-cm="psel" data-id="' + h(p.user_id) + '"' + (A.sel[p.user_id] ? ' checked' : '') + '></label><div class="main"><div class="t">' + h(p.full_name) + '</div><div class="sub">' + h(p.university_id || '') + ' · ' + h(fmt(p.created_at)) + '</div></div></div>'; }).join('') || '<div class="empty">' + h(T('الجميع غيّروا كلمتهم', 'Everyone has changed it')) + '</div>') + '</div>';
    } else if (A.sub === 'students') {
      body = '<div class="form"><label>' + h(T('بحث', 'Search')) + '<input id="cm-sq" value="' + h(A.q) + '" data-cm="sq"></label><div style="align-self:end"><button class="btn" data-act="cm-sfind">' + h(T('بحث', 'Search')) + '</button></div></div>' +
        '<details style="margin:8px 0"><summary>' + h(T('إسناد جماعي بالأرقام', 'Bulk assign by numbers')) + '</summary><textarea id="bk-ids" class="cm-ta" placeholder="20250071&#10;20250072"></textarea><select id="bk-coh">' + cohOpt(0) + '</select> <button class="btn pri" data-act="cm-bulk">' + h(T('إسناد', 'Assign')) + '</button></details>' +
        '<div class="tabs" style="margin:8px 0"><label class="ck"><input type="checkbox" data-cm="selall"' + ((A.students || []).length && selCount() === (A.students || []).length ? ' checked' : '') + '> ' + h(T('تحديد الكل المعروض', 'Select all shown')) + '</label><button class="btn sm bad" data-act="cm-del-sel"' + (selCount() ? '' : ' disabled') + '>' + h(T('حذف المحدد', 'Delete selected')) + ' (' + selCount() + ')</button><span class="sub">' + h(T('المعروض: ', 'Shown: ') + (A.students || []).length) + '</span></div>' +
        '<div class="list">' + ((A.students || []).map(function (s) { return '<div class="row"><label style="padding-inline-end:8px"><input type="checkbox" data-cm="sel" data-id="' + h(s.id) + '"' + (A.sel[s.id] ? ' checked' : '') + '></label><div class="main"><div class="t">' + h(s.full_name) + '</div><div class="sub">' + h(s.university_id || '') + ' · ' + h(s.major || '') + '</div></div><div class="act"><select data-cm="assign" data-id="' + h(s.id) + '"><option value="">—</option>' + cohOpt(s.cohort_id) + '</select> <button class="btn sm bad" data-act="cm-reset" data-id="' + h(s.id) + '" data-confirm="1">' + h(T('كلمة افتراضية', 'Reset pw')) + '</button></div></div>'; }).join('') || '<div class="empty">' + h(T('اكتب اسماً أو رقماً ثم ابحث', 'Search by name or number')) + '</div>') + '</div>';
    } else if (A.sub === 'assign') {
      var profs = (A.staff || []).filter(function (x) { return x.role === 'professor'; });
      body = '<p class="sub">' + h(T('حدّد عضواً أو أكثر من الهيئة التدريسية لكل شعبة ثم اضغط «حفظ»: يُربطون بكل طلبة الشعبة. الأول في القائمة يصبح المشرف الأساسي. يظهر هنا من نوعه «عضو هيئة تدريس» فقط (غيّر النوع من «تصنيف الموظفين»).', 'Tick one or more faculty members per cohort and press Save. They are linked to all cohort students. Only faculty-type accounts are listed (change the type in Staff categories).')) + '</p>' +
        (A.note ? '<p class="pill ok">' + h(A.note) + '</p>' : '') +
        (profs.length ? '' : '<p class="pill bad">' + h(T('لا يوجد أعضاء هيئة تدريس. حوّل نوع الأكاديمي من «تصنيف الموظفين» إلى «عضو هيئة تدريس».', 'No faculty members yet. Change a person\'s type in Staff categories.')) + '</p>') +
        '<div class="list">' + ((A.cp || []).map(function (c) {
          var cur = {}; (c.profs || []).forEach(function (p) { cur[p.id] = 1; });
          return '<div class="row" style="align-items:flex-start"><div class="main"><div class="t" dir="ltr" style="text-align:start">' + h(c.cohort_name) + '</div><div class="sub">' + h(c.members + ' ' + T('طالب', 'students')) + ' · ' + h((c.profs || []).length ? T('الحاليون: ', 'Current: ') + (c.profs || []).map(function (p) { return p.name; }).join('، ') : T('غير مربوطة', 'Not assigned')) + '</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px">' + profs.map(function (p) { return '<label class="ck"><input type="checkbox" class="ap-c-' + c.cohort_id + '" value="' + h(p.id) + '"' + (cur[p.id] ? ' checked' : '') + '> ' + h(p.full_name) + '</label>'; }).join('') + '</div></div>' +
            '<div class="act"><button class="btn sm pri" data-act="cm-assign-prof" data-id="' + c.cohort_id + '">' + h(T('حفظ', 'Save')) + '</button></div></div>';
        }).join('') || '<div class="empty">—</div>') + '</div>';
    } else if (A.sub === 'dups') {
      body = dupsHtml();
    } else if (A.sub === 'staff') {
      var stf = A.staff || [], stSel = stf.filter(function (x) { return A.sel[x.id]; }).length;
      body = '<p class="sub">' + h(T('اسم الدخول للموظف هو رقمه الوظيفي، وكلمة المرور الافتراضية 12345678.', 'Staff sign in with their employee number; default password 12345678.')) + '</p>' +
        (A.note ? '<p class="pill ok">' + h(A.note) + '</p>' : '') +
        '<div class="tabs" style="margin:8px 0"><button class="btn sm" data-act="cm-exp-staff-xlsx">⬇ ' + h(T('تصدير الموظفين Excel', 'Export staff (Excel)')) + '</button> <button class="btn sm" data-act="cm-exp-staff-csv">⬇ CSV</button></div>' +
        '<div class="tabs" style="margin:8px 0"><label class="ck"><input type="checkbox" data-cm="stselall"' + (stf.length && stSel === stf.length ? ' checked' : '') + '> ' + h(T('تحديد الكل', 'Select all')) + ' (' + stf.length + ')</label><button class="btn sm bad" data-act="cm-del-staff"' + (stSel ? '' : ' disabled') + '>' + h(T('حذف المحدد', 'Delete selected')) + (stSel ? ' (' + stSel + ')' : '') + '</button></div>' +
        '<div class="list">' + (stf.map(function (s) { return '<div class="row"><label style="padding-inline-end:8px"><input type="checkbox" data-cm="stsel" data-id="' + h(s.id) + '"' + (A.sel[s.id] ? ' checked' : '') + '></label><div class="main"><div class="t">' + h(s.full_name) + '</div><div class="sub">' + h((ROLE[s.role] || [s.role, s.role])[ar() ? 0 : 1]) + (s.university_id ? ' · ' + h(s.university_id) : '') + '</div></div><div class="act"><select data-cm="srole" data-id="' + h(s.id) + '"><option value="staff"' + (s.role === 'staff' ? ' selected' : '') + '>' + h(ROLE.staff[ar() ? 0 : 1]) + '</option><option value="professor"' + (s.role === 'professor' ? ' selected' : '') + '>' + h(ROLE.professor[ar() ? 0 : 1]) + '</option></select> <select data-cm="cat" data-id="' + h(s.id) + '"><option value="">—</option>' + ['academic', 'practical', 'admin'].map(function (k) { return '<option value="' + k + '"' + (s.category === k ? ' selected' : '') + '>' + h(CHAN[k][ar() ? 0 : 1]) + '</option>'; }).join('') + '</select> <button class="btn sm bad" data-act="cm-reset" data-id="' + h(s.id) + '" data-confirm="1">' + h(T('كلمة افتراضية', 'Reset pw')) + '</button></div></div>'; }).join('') || '<div class="empty">—</div>') + '</div>';
    } else {
      body = '<div class="form"><label>' + h(T('اسم شعبة جديدة', 'New cohort')) + '<input id="co-name" dir="ltr"></label><div style="align-self:end"><button class="btn pri" data-act="cm-addcoh">' + h(T('إضافة', 'Add')) + '</button></div></div>' +
        '<button class="btn sm" data-act="cm-preset" style="margin:6px 0">' + h(T('إنشاء الشعب المعتمدة (11) وحذف الشعب الخمس القديمة الفارغة', 'Create the 11 standard cohorts and remove the old empty five')) + '</button>' +
        '<div class="list">' + ST.cohorts.map(function (c) { return '<div class="row"><div class="main"><input id="coe-' + c.id + '" value="' + h(c.name) + '" dir="ltr" style="width:100%;max-width:260px"><div class="sub">' + c.members + ' ' + h(T('طالب', 'students')) + '</div></div><div class="act"><button class="btn sm" data-act="cm-coren" data-id="' + c.id + '">' + h(T('حفظ الاسم', 'Save name')) + '</button> <button class="btn sm bad" data-act="cm-codel" data-id="' + c.id + '">' + h(T('حذف', 'Delete')) + '</button></div></div>'; }).join('') + '</div>';
    }
    return '<div class="card">' + nav + (A.note ? '<p class="pill ok">' + h(A.note) + '</p>' : '') + body + '</div>';
  }

  /* ---------- actions ---------- */
  async function guard(fn) { try { ST.err = ''; await fn(); } catch (e) { ST.err = e.message || String(e); } ST.busy = false; draw(); }
  var ACTS = {
    'cm-tab': function (el) { ST.tab = el.dataset.t; ST.err = ''; ST.items = []; ST.file = null; ST.draft = ''; draw(); guard(async function () { await loadTab(); if (ST.tab === 'dm') await loadDm(); }); },
    'cm-new': function () { ST.recips = []; ST.q = ''; draw(); searchRecips(); },
    'cm-newclose': function () { ST.recips = null; draw(); },
    'cm-start': function (el) { guard(async function () { var id = await rpc('ensure_direct_communication_conversation', { target_user_id: el.dataset.id, conversation_subject: null }); ST.recips = null; ST.tab = 'dm'; ST.conv = { id: id, name: el.dataset.n }; ST.msgs = []; await loadMsgs(); await loadDm(); }); },
    'cm-open': function (el) { var c = ST.convs.filter(function (x) { return x.id === el.dataset.id; })[0]; if (!c) return; guard(async function () { ST.conv = { id: c.id, name: dn(c.counterpart_name, c.counterpart_id || c.other_user_id || c.counterpart_user_id || c.participant_id) }; await loadMsgs(); await loadDm(); await loadUnread(); }); },
    'cm-back': function () { ST.conv = null; draw(); },
    'cm-file': function (el) { openFile(el.dataset.p); },
    'cm-unfile': function () { ST.file = null; draw(); },
    'cm-send': function () { send(); },
    'cm-sub': function (el) { ST.admin.sub = el.dataset.s; draw(); guard(loadTab); },
    'cm-create': function () { createAccounts(); },
    'cm-clearrows': function () { ST.admin.rows = null; ST.admin.rowsInfo = ''; ST.admin.sheet = null; draw(); },
    'cm-map-ok': function () { applyMap(); draw(); },
    'cm-del-sel': function () { var ids = Object.keys(ST.admin.sel).filter(function (k) { return ST.admin.sel[k]; }); deleteIds(ids, loadTab); },
    'cm-dups-find': function () { findDups(); },
    'cm-exp-staff-xlsx': function () { guard(async function () { var a = staffAoa(); await loadXlsx(); var wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(a), 'Staff'); var out = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' }); saveFile('staff-' + new Date().toISOString().slice(0, 10) + '.xlsx', new Blob([out], { type: 'application/octet-stream' })); }); },
    'cm-exp-staff-csv': function () { var a = staffAoa(); var csv = '\ufeff' + a.map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); return /[",\n\r]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n'); saveFile('staff-' + new Date().toISOString().slice(0, 10) + '.csv', new Blob([csv], { type: 'text/csv;charset=utf-8' })); },
    'cm-assign-prof': function (el) { var ids = Array.prototype.map.call(document.querySelectorAll('.ap-c-' + el.dataset.id + ':checked'), function (x) { return x.value; }); assignProf(Number(el.dataset.id), ids); },
    'cm-pin': function (el) { guard(async function () { await rpc('comm_ann_pin', { p_id: Number(el.dataset.id), p_pinned: el.dataset.p === '1' }); await loadTab(); }); },
    'sc-new': function () { ST.sched.form = { kind: 'lecture' }; draw(); },
    'sc-cancel': function () { ST.sched.form = null; draw(); },
    'sc-edit': function (el) { ST.sched.form = (ST.sched.rows.filter(function (x) { return String(x.id) === el.dataset.id; })[0]) || null; draw(); },
    'sc-save': function () {
      var f = ST.sched.form || {}, title = val('sf-title').trim(), date = val('sf-date');
      if (!title || !date) { toast_(T('العنوان والتاريخ مطلوبان', 'Title and date are required')); return; }
      guard(async function () {
        await rpc('comm_sched_save', { p_id: f.id || null, p_cohort: val('sf-cohort') ? Number(val('sf-cohort')) : null, p_kind: val('sf-kind'), p_title: title, p_date: date, p_start: val('sf-start') || null, p_end: val('sf-end') || null, p_place: val('sf-place'), p_notes: val('sf-notes') });
        ST.sched.form = null; await loadSched(); toast_(T('تم الحفظ', 'Saved'));
      });
    },
    'sc-del': function (el) { guard(async function () { await rpc('comm_sched_delete', { p_id: Number(el.dataset.id) }); await loadSched(); }); },
    'pl-new': function () { ST.polls.form = true; draw(); },
    'pl-cancel': function () { ST.polls.form = false; draw(); },
    'pl-create': function () {
      var q = val('pf-q').trim(), opts = val('pf-opts').split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
      if (!q || opts.length < 2) { toast_(T('اكتب السؤال وخيارين على الأقل', 'Write a question and at least two options')); return; }
      guard(async function () { await rpc('comm_poll_create', { p_cohort: val('pf-cohort') ? Number(val('pf-cohort')) : null, p_question: q, p_options: opts }); ST.polls.form = false; await loadPolls(); toast_(T('تم النشر', 'Published')); });
    },
    'pl-vote': function (el) { guard(async function () { await rpc('comm_poll_vote', { p_poll: Number(el.dataset.p), p_opt: Number(el.dataset.o) }); await loadPolls(); toast_(T('تم تسجيل إجابتك', 'Answer recorded')); }); },
    'pl-close': function (el) { guard(async function () { await rpc('comm_poll_close', { p_id: Number(el.dataset.id), p_closed: el.dataset.c === '1' }); await loadPolls(); }); },
    'pl-del': function (el) { guard(async function () { await rpc('comm_poll_delete', { p_id: Number(el.dataset.id) }); await loadPolls(); }); },
    'wk-add': function () { var n = window.prompt(T('اسم الموظف:', 'Name:')); if (!n || !n.trim()) return; guard(async function () { await rpc('comm_weekly_save', { p_id: null, p_name: n.trim(), p_cells: {}, p_notes: '', p_user: null }); await loadWeek(); }); },
    'wk-fill': function () { guard(async function () { var n = await rpc('comm_weekly_fill'); await loadWeek(); ST.week.note = T('أُضيف ' + n + ' موظف', n + ' added'); }); },
    'wk-del': function (el) { guard(async function () { await rpc('comm_weekly_delete', { p_id: Number(el.dataset.id) }); await loadWeek(); }); },
    'wk-clear': function () { guard(async function () { await rpc('comm_weekly_clear'); await loadWeek(); ST.week.note = T('تم مسح الجدول', 'Cleared'); }); },
    'wk-export': function () { saveWord('weekly-schedule-' + new Date().toISOString().slice(0, 10) + '.doc', weekDoc()); },
    'cm-del-staff': function () { var ids = (ST.admin.staff || []).filter(function (p) { return ST.admin.sel[p.id]; }).map(function (p) { return p.id; }); deleteIds(ids, async function () { ST.admin.staff = await rpc('comm_list_staff'); }); },
    'cm-del-pend': function () { var ids = ST.admin.pending.filter(function (p) { return ST.admin.sel[p.user_id]; }).map(function (p) { return p.user_id; }); deleteIds(ids, async function () { ST.admin.pending = await rpc('comm_pending_passwords'); }); },
    'cm-del-dups': function () { var ids = Object.keys(ST.admin.dupSel).filter(function (k) { return ST.admin.dupSel[k]; }); deleteIds(ids, findDups); },
    'cm-approve': function (el) { approve([Number(el.dataset.id)]); },
    'cm-approve-all': function () { approve(ST.admin.reqs.map(function (r) { return r.id; })); },
    'cm-reject': function (el) { guard(async function () { await rpc('comm_decide_request', { p_id: Number(el.dataset.id), p_status: 'rejected' }); await loadTab(); }); },
    'cm-sfind': function () { ST.admin.q = ($c('#cm-sq') || {}).value || ''; guard(loadTab); },
    'cm-bulk': function () { guard(async function () { var ids = ($c('#bk-ids').value || '').split(/[\s,;]+/).filter(Boolean), c = Number($c('#bk-coh').value); var n = await rpc('comm_bulk_assign_cohort', { p_university_ids: ids, p_cohort: c }); toast_(T('تم إسناد ' + n, 'Assigned ' + n)); await loadTab(); }); },
    'cm-reset': function (el) { guard(async function () { var r = await sb().functions.invoke(((window.PLANNER_CONFIG||{}).ADMIN_FN||'admin-accounts'), { body: { action: 'reset', user_id: el.dataset.id } }); if (r.error || (r.data && r.data.error)) throw new Error((r.data && r.data.error) || await ferr(r)); toast_(T('أُعيدت كلمة المرور إلى 12345678 وسيُلزَم بتغييرها', 'Password reset to 12345678; change required')); }); },
    'cm-addcoh': function () { guard(async function () { var n = ($c('#co-name').value || '').trim(); if (!n) return; await rpc('comm_add_cohort', { p_name: n }); await loadTab(); }); },
    'cm-preset': function () { guard(async function () {
      var codes = ['BSN20240', 'BSN20230', 'BSN20231', 'BSN20241', 'BSM20231', 'BSM20241', 'BSN20250', 'BSN20251', 'BSM20251', 'BSN20261', 'BSN20260'];
      var old = ['شعبة 2023 تمريض', 'شعبة 2023 قبالة', 'شعبة 2024 تمريض وقبالة', 'شعبة 2025 تمريض وقبالة', 'شعبة 2026 تمريض وقبالة'], removed = 0, kept = [];
      for (var i = 0; i < codes.length; i++) await rpc('comm_add_cohort', { p_name: codes[i] });
      var cur = await rpc('comm_list_cohorts');
      for (var k = 0; k < cur.length; k++) if (old.indexOf(cur[k].name) > -1) { var r = await rpc('comm_delete_cohort', { p_id: cur[k].id, p_force: false }); if (r && r.deleted) removed++; else kept.push(cur[k].name); }
      ST.admin.note = T('أُضيفت الشعب المعتمدة. حُذفت ' + removed + ' شعبة قديمة' + (kept.length ? '، وبقيت (فيها طلبة أو إعلانات): ' + kept.join('، ') : '') + '.', 'Standard cohorts added. Removed ' + removed + ' old cohort(s)' + (kept.length ? '; kept (not empty): ' + kept.join(', ') : '') + '.');
      await loadTab();
    }); },
    'cm-coren': function (el) { guard(async function () { var v = ($c('#coe-' + el.dataset.id) || {}).value || ''; await rpc('comm_rename_cohort', { p_id: Number(el.dataset.id), p_name: v }); ST.admin.note = T('تم تعديل الاسم', 'Renamed'); await loadTab(); }); },
    'cm-codel': function (el) { guard(async function () {
      var id = Number(el.dataset.id), c = ST.cohorts.filter(function (x) { return x.id === id; })[0] || {};
      var r = await rpc('comm_delete_cohort', { p_id: id, p_force: false });
      if (r && r.blocked) {
        if (!window.confirm(T('في الشعبة «' + c.name + '» ' + r.members + ' طالب و' + r.announcements + ' إعلان. عند الحذف يصير طلبتها بلا شعبة وتُحذف إعلاناتها نهائياً. هل تريد الحذف؟', 'Cohort "' + c.name + '" has ' + r.members + ' student(s) and ' + r.announcements + ' announcement(s). Deleting makes the students unassigned and removes the announcements. Delete?'))) return;
        r = await rpc('comm_delete_cohort', { p_id: id, p_force: true });
      }
      ST.admin.note = T('تم حذف الشعبة', 'Cohort deleted'); await loadTab();
    }); },
    'cm-pw': function () { guard(async function () { var v = ($c('#cm-np').value || ''); if (v.length < 8) throw new Error(T('8 أحرف على الأقل', 'At least 8 characters')); var r = await sb().auth.updateUser({ password: v }); if (r.error) throw r.error; toast_(T('تم تغيير كلمة المرور', 'Password changed')); }); }
  };
  window.EXTRA_ACT = Object.assign(window.EXTRA_ACT || {}, ACTS);

  async function searchRecips() {
    try { ST.recips = (await rpc('search_communication_recipients', { search_text: ST.q || '', page_size: 40 })) || []; } catch (e) { ST.err = e.message; }
    var a = document.activeElement, keep = a && a.id === 'cm-q'; draw();
    if (keep) { var q = $c('#cm-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }
  var qT; 
  document.addEventListener('input', function (e) {
    var k = e.target.dataset && e.target.dataset.cm; if (!k) return;
    if (k === 'draft') ST.draft = e.target.value; else if (k === 'title') ST.title = e.target.value; else if (k === 'sq') ST.admin.q = e.target.value;
    else if (k === 'q') { ST.q = e.target.value; clearTimeout(qT); qT = setTimeout(searchRecips, 350); }
  });
  document.addEventListener('change', function (e) {
    var k = e.target.dataset && e.target.dataset.cm; if (!k) return;
    if (k === 'file') { ST.file = e.target.files[0] || null; draw(); }
    else if (k === 'xlsx') { var f0 = e.target.files[0]; e.target.value = ''; readSheet(f0); }
    else if (k === 'map') { ST.admin.sheet.map[e.target.dataset.k] = Number(e.target.value); draw(); }
    else if (k === 'sel') { ST.admin.sel[e.target.dataset.id] = e.target.checked; draw(); }
    else if (k === 'psel') { ST.admin.sel[e.target.dataset.id] = e.target.checked; draw(); }
    else if (k === 'pselall') { ST.admin.pending.forEach(function (x) { ST.admin.sel[x.user_id] = e.target.checked; }); draw(); }
    else if (k === 'dsel') { ST.admin.dupSel[e.target.dataset.id] = e.target.checked; draw(); }
    else if (k === 'selall') { (ST.admin.students || []).forEach(function (x) { ST.admin.sel[x.id] = e.target.checked; }); draw(); }
    else if (k === 'stsel') { ST.admin.sel[e.target.dataset.id] = e.target.checked; draw(); }
    else if (k === 'stselall') { (ST.admin.staff || []).forEach(function (x) { ST.admin.sel[x.id] = e.target.checked; }); draw(); }
    else if (k === 'cf') { var cv = e.target.type === 'checkbox' ? e.target.checked : e.target.value; ST.admin['c' + e.target.dataset.k] = cv; }
    else if (k === 'srole') guard(async function () { await rpc('comm_set_staff_role', { p_user: e.target.dataset.id, p_role: e.target.value }); ST.admin.staff = await rpc('comm_list_staff'); toast_('OK'); });
    else if (k === 'wk') {
      var wid = e.target.dataset.id, v = weekRowValues(wid), row = (ST.week.rows || []).filter(function (x) { return String(x.id) === wid; })[0] || {};
      if (!(v.name || '').trim()) { toast_(T('الاسم مطلوب', 'Name is required')); return; }
      rpc('comm_weekly_save', { p_id: Number(wid), p_name: v.name, p_cells: v.cells, p_notes: v.notes, p_user: row.user_id || null }).then(function () { row.name = v.name; row.cells = v.cells; row.notes = v.notes; toast_(T('تم الحفظ', 'Saved')); }, function (er) { toast_((er && er.message) || 'error'); });
    }
    else if (k === 'annall') { ST.annAll = e.target.checked; draw(); }
    else if (k === 'chan') { ST.chan = e.target.value; guard(loadTab); }
    else if (k === 'coh') { ST.cohort = Number(e.target.value); guard(loadTab); }
    else if (k === 'assign') guard(async function () { await rpc('comm_assign_cohort', { p_user: e.target.dataset.id, p_cohort: e.target.value ? Number(e.target.value) : null }); toast_('OK'); });
    else if (k === 'cat') guard(async function () { await rpc('comm_set_staff_category', { p_user: e.target.dataset.id, p_category: e.target.value || null }); toast_('OK'); });
  });

  async function send() {
    var body = (ST.draft || '').trim(), f = ST.file;
    if (!body && !f) return;
    if (!navigator.onLine) { ST.err = T('لا يوجد اتصال', 'You are offline'); return draw(); }
    ST.busy = true; draw();
    await guard(async function () {
      if (ST.tab === 'dm' && ST.conv) {
        var up = f ? await upload('dm/' + ST.conv.id, f) : null;
        var id = await rpc('send_communication_message', { target_conversation_id: ST.conv.id, message_subject: '', message_body: body || (up ? up.file_name : '') });
        if (up) await rpc('comm_dm_attach', { p_message: id, p_path: up.file_path, p_name: up.file_name, p_type: up.file_type, p_size: up.file_size });
        ST.draft = ''; ST.file = null; await loadMsgs(true); await loadDm();
      } else if (ST.tab === 'staff') {
        var u2 = f ? await upload('ch/' + ST.chan, f) : null;
        var r = await sb().from('comm_channel_messages').insert(Object.assign({ channel: ST.chan, body: body || (u2 ? u2.file_name : '') }, u2 || {}));
        if (r.error) throw r.error;
        ST.draft = ''; ST.file = null; await loadTab();
      } else if (ST.tab === 'ann' && isAdmin() && ST.cohort) {
        var tgt = ST.annAll ? ST.cohorts.filter(function (c) { return c.is_active; }).map(function (c) { return c.id; }) : [ST.cohort];
        if (ST.annAll && !window.confirm(T('سيُرسل الإعلان إلى جميع الشعب (' + tgt.length + ' شعبة). متابعة؟', 'This will be sent to all cohorts (' + tgt.length + '). Continue?'))) { ST.busy = false; return draw(); }
        var rows3 = [];
        for (var ci = 0; ci < tgt.length; ci++) {
          var u3 = f ? await upload('ann/' + tgt[ci], f) : null;
          rows3.push(Object.assign({ cohort_id: tgt[ci], title: (ST.title || '').trim() || null, body: body || (u3 ? u3.file_name : '') }, u3 || {}));
        }
        var r2 = await sb().from('comm_announcements').insert(rows3);
        if (r2.error) throw r2.error;
        ST.annAll = false;
        ST.draft = ''; ST.title = ''; ST.file = null; await loadTab();
      }
    });
  }

  function assignProf(coh, ids) {
    guard(async function () {
      var n = await rpc('comm_assign_professors', { p_cohort: coh, p_profs: ids });
      ST.admin.cp = await rpc('comm_cohort_professors');
      ST.admin.note = T('تم الحفظ: ' + ids.length + ' أكاديمي، وربط ' + n + ' طالب', 'Saved: ' + ids.length + ' academics, ' + n + ' students linked');
    });
  }
  async function ferr(r) { try { var b = await r.error.context.json(); if (b && b.error) return b.error; } catch (e) {} return (r.error && r.error.message) || 'error'; }
  function staffAoa() {
    var rows = ST.admin.staff || [];
    var cn = { academic: ['أكاديمي', 'Academic'], practical: ['مشرف عملي', 'Practical supervisor'], admin: ['إداري', 'Administrative'] };
    var out = [[T('الرقم الوظيفي', 'Employee number'), T('الاسم', 'Name'), T('النوع', 'Type'), T('التصنيف', 'Category')]];
    rows.forEach(function (x) { out.push([x.university_id || '', x.full_name || '', (ROLE[x.role] || [x.role, x.role])[ar() ? 0 : 1], x.category && cn[x.category] ? cn[x.category][ar() ? 0 : 1] : '']); });
    return out;
  }
  function saveFile(name, blob) { var u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); }
  /* ---------- ميزات الطلبة: الرئيسية، الجدول، الاستبيانات ---------- */
  var KINDS = { lecture: ['محاضرة', 'Lecture', ''], clinical: ['تدريب عملي', 'Clinical', 'warn'], exam: ['امتحان', 'Exam', 'bad'], event: ['فعالية', 'Event', 'ok'], other: ['أخرى', 'Other', ''] };
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dayLabel(ds) {
    var t = todayStr(); if (ds === t) return T('اليوم', 'Today');
    var d = new Date(ds + 'T00:00:00'), n = new Date(t + 'T00:00:00'), diff = Math.round((d - n) / 86400000);
    if (diff === 1) return T('غداً', 'Tomorrow');
    return d.toLocaleDateString(ar() ? 'ar' : 'en', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function hhmm(t) { return t ? String(t).slice(0, 5) : ''; }
  async function loadSched() { ST.sched.rows = (await rpc('comm_sched_list', { p_from: todayStr() })) || []; }
  async function loadPolls() { ST.polls.rows = (await rpc('comm_poll_list')) || []; }
  async function loadHome() {
    try { ST.home.sup = (await rpc('comm_my_supervisor')) || []; } catch (e) { ST.home.sup = []; }
    try { await loadSched(); } catch (e) {}
    try { await loadPolls(); } catch (e) {}
    try { ST.home.ann = ST.cohort ? ((await rpc('comm_ann_list', { p_cohort: ST.cohort, p_limit: 3 })) || []) : []; } catch (e) { ST.home.ann = []; }
  }
  function unvoted() { return (ST.polls.rows || []).filter(function (p) { return !p.closed && p.my_vote == null; }).length; }

  function homeHtml() {
    var c = ctx(), sups = ST.home.sup || [], nx = (ST.sched.rows || []).slice(0, 4), an = (ST.home.ann || [])[0], uv = unvoted();
    var quick = '<div class="tabs" style="margin:10px 0">' +
      '<button class="btn pri" data-act="cm-tab" data-t="dm">💬 ' + h(T('المحادثات', 'Chats')) + (ST.dmUnread ? ' (' + ST.dmUnread + ')' : '') + '</button>' +
      sups.map(function (sup) { return '<button class="btn" data-act="cm-start" data-id="' + h(sup.id) + '" data-n="' + h(sup.full_name) + '">✉ ' + h(T('راسل: ', 'Message: ')) + h(dn(sup.full_name, sup.id)) + '</button>'; }).join('') +
      '<button class="btn" data-act="cm-tab" data-t="ann">📢 ' + h(T('الإعلانات', 'Announcements')) + (ST.unread.ann ? ' (' + ST.unread.ann + ')' : '') + '</button></div>';
    var annCard = '<div class="card"><h2>' + h(T('آخر إعلان', 'Latest announcement')) + '</h2>' + (an ? '<div class="cm-msgs" style="max-height:none">' + annMsg(an) + '</div><button class="btn sm" data-act="cm-tab" data-t="ann">' + h(T('كل الإعلانات', 'All announcements')) + '</button>' : '<div class="empty">' + h(T('لا إعلانات', 'No announcements')) + '</div>') + '</div>';
    var schCard = '<div class="card"><h2>' + h(T('الأقرب في الجدول', 'Coming up')) + '</h2>' + (nx.length ? '<div class="list">' + nx.map(schedRow).join('') + '</div><button class="btn sm" data-act="cm-tab" data-t="sched">' + h(T('الجدول كاملاً', 'Full schedule')) + '</button>' : '<div class="empty">' + h(T('لا مواعيد قادمة', 'Nothing scheduled')) + '</div>') + '</div>';
    var pollCard = uv ? '<div class="card"><h2>' + h(T('استبيانات بانتظارك', 'Polls waiting for you')) + '</h2><p class="sub">' + h(T('لديك ' + uv + ' استبيان لم تجب عنه.', 'You have ' + uv + ' unanswered poll(s).')) + '</p><button class="btn pri" data-act="cm-tab" data-t="poll">' + h(T('أجب الآن', 'Answer now')) + '</button></div>' : '';
    return '<div class="card"><h2>' + h(T('مرحباً ', 'Welcome ') + (c.name || '')) + '</h2><p class="sub">' + h(c.cohort_name ? T('شعبتك: ', 'Your cohort: ') + c.cohort_name : T('لم تُسنَد إلى شعبة بعد، راجع الإدارة.', 'No cohort assigned yet.')) + '</p>' + quick + '</div>' + annCard + schCard + pollCard;
  }

  function schedRow(s) {
    var k = KINDS[s.kind] || KINDS.other, tm = hhmm(s.start_time) + (s.end_time ? ' – ' + hhmm(s.end_time) : '');
    return '<div class="row"><div class="main"><div class="t"><span class="pill ' + k[2] + '">' + h(k[ar() ? 0 : 1]) + '</span> ' + h(s.title) + '</div><div class="sub">' + h(dayLabel(s.event_date)) + (tm.trim() ? ' · ' + h(tm) : '') + (s.place ? ' · ' + h(s.place) : '') + (isStaff() ? ' · ' + h(s.cohort_name || T('كل الشعب', 'All cohorts')) : '') + (s.notes ? ' · ' + h(s.notes) : '') + '</div></div>' +
      (isAdmin() ? '<div class="act"><button class="btn sm" data-act="sc-edit" data-id="' + s.id + '">' + h(T('تعديل', 'Edit')) + '</button> <button class="btn sm bad" data-act="sc-del" data-id="' + s.id + '" data-confirm="1">' + h(T('حذف', 'Delete')) + '</button></div>' : '') + '</div>';
  }
  function schedForm() {
    var f = ST.sched.form; if (!f) return '';
    var coh = '<option value="">' + h(T('كل الشعب', 'All cohorts')) + '</option>' + ST.cohorts.filter(function (c) { return c.is_active; }).map(function (c) { return '<option value="' + c.id + '"' + (String(f.cohort_id || '') === String(c.id) ? ' selected' : '') + '>' + h(c.name) + '</option>'; }).join('');
    var kinds = Object.keys(KINDS).map(function (k) { return '<option value="' + k + '"' + ((f.kind || 'lecture') === k ? ' selected' : '') + '>' + h(KINDS[k][ar() ? 0 : 1]) + '</option>'; }).join('');
    return '<div class="card" style="margin:8px 0"><b>' + h(f.id ? T('تعديل موعد', 'Edit entry') : T('إضافة موعد', 'Add entry')) + '</b><div class="form">' +
      '<label>' + h(T('الشعبة', 'Cohort')) + '<select id="sf-cohort">' + coh + '</select></label>' +
      '<label>' + h(T('النوع', 'Type')) + '<select id="sf-kind">' + kinds + '</select></label>' +
      '<label>' + h(T('العنوان *', 'Title *')) + '<input id="sf-title" value="' + h(f.title || '') + '"></label>' +
      '<label>' + h(T('التاريخ *', 'Date *')) + '<input id="sf-date" type="date" value="' + h(f.event_date || todayStr()) + '"></label>' +
      '<label>' + h(T('من', 'From')) + '<input id="sf-start" type="time" value="' + h(hhmm(f.start_time)) + '"></label>' +
      '<label>' + h(T('إلى', 'To')) + '<input id="sf-end" type="time" value="' + h(hhmm(f.end_time)) + '"></label>' +
      '<label>' + h(T('المكان', 'Place')) + '<input id="sf-place" value="' + h(f.place || '') + '"></label>' +
      '<label>' + h(T('ملاحظات', 'Notes')) + '<input id="sf-notes" value="' + h(f.notes || '') + '"></label></div>' +
      '<div class="tabs"><button class="btn pri" data-act="sc-save"' + (ST.busy ? ' disabled' : '') + '>' + h(T('حفظ', 'Save')) + '</button><button class="btn" data-act="sc-cancel">' + h(T('إلغاء', 'Cancel')) + '</button></div></div>';
  }
  function schedHtml() {
    var rows = ST.sched.rows || [], byDay = {}, days = [];
    rows.forEach(function (s) { if (!byDay[s.event_date]) { byDay[s.event_date] = []; days.push(s.event_date); } byDay[s.event_date].push(s); });
    return '<div class="card"><h2>' + h(T('الجدول والمواعيد', 'Schedule')) + '</h2>' +
      '<p class="sub">' + h(isAdmin() ? T('أضف المحاضرات والتدريب العملي والامتحانات لشعبة أو لكل الشعب، فتظهر للطلبة في جدولهم.', 'Add lectures, clinical sessions and exams for a cohort or all cohorts.') : T('المواعيد القادمة لشعبتك.', 'Upcoming entries for your cohort.')) + '</p>' +
      (isAdmin() && !ST.sched.form ? '<button class="btn pri" data-act="sc-new">+ ' + h(T('إضافة موعد', 'Add entry')) + '</button>' : '') + schedForm() +
      (days.map(function (d) { return '<h3 style="margin:12px 0 4px">' + h(dayLabel(d)) + '</h3><div class="list">' + byDay[d].map(schedRow).join('') + '</div>'; }).join('') || '<div class="empty">' + h(T('لا مواعيد قادمة', 'Nothing scheduled')) + '</div>') + '</div>';
  }

  function pollHtml() {
    var rows = ST.polls.rows || [], form = '';
    if (isAdmin()) {
      form = ST.polls.form ? '<div class="card" style="margin:8px 0"><b>' + h(T('استبيان جديد', 'New poll')) + '</b><div class="form"><label>' + h(T('لمن؟', 'For')) + '<select id="pf-cohort"><option value="">' + h(T('كل الطلبة', 'All students')) + '</option>' + ST.cohorts.filter(function (c) { return c.is_active; }).map(function (c) { return '<option value="' + c.id + '">' + h(c.name) + '</option>'; }).join('') + '</select></label>' +
        '<label style="grid-column:1/-1">' + h(T('السؤال *', 'Question *')) + '<input id="pf-q"></label></div><label>' + h(T('الخيارات: خيار في كل سطر (2 إلى 8)', 'Options: one per line (2 to 8)')) + '<textarea id="pf-opts" class="cm-ta" style="direction:rtl;font-family:inherit"></textarea></label>' +
        '<div class="tabs"><button class="btn pri" data-act="pl-create"' + (ST.busy ? ' disabled' : '') + '>' + h(T('نشر', 'Publish')) + '</button><button class="btn" data-act="pl-cancel">' + h(T('إلغاء', 'Cancel')) + '</button></div></div>'
        : '<button class="btn pri" data-act="pl-new">+ ' + h(T('استبيان جديد', 'New poll')) + '</button>';
    }
    return '<div class="card"><h2>' + h(T('الاستبيانات', 'Polls')) + '</h2>' + form +
      (rows.map(function (p) {
        var canVote = !isStaff() && !p.closed, showRes = p.counts != null, total = Number(p.total) || 0;
        var opts = (p.options || []).map(function (o, i) {
          var n = showRes ? Number((p.counts || [])[i]) || 0 : 0, pc = total ? Math.round(n * 100 / total) : 0, mine = p.my_vote === i;
          var bar = showRes ? '<div style="height:6px;border-radius:4px;background:rgba(127,127,127,.2);margin-top:4px"><div style="height:6px;border-radius:4px;background:var(--accent,#0b8a97);width:' + pc + '%"></div></div>' : '';
          var label = h(o) + (showRes ? ' — ' + n + ' (' + pc + '%)' : '');
          return canVote ? '<button class="btn" style="display:block;width:100%;text-align:start;margin:4px 0' + (mine ? ';outline:2px solid var(--accent,#0b8a97)' : '') + '" data-act="pl-vote" data-p="' + p.id + '" data-o="' + i + '">' + (mine ? '✓ ' : '') + label + bar + '</button>' : '<div style="margin:6px 0">' + (mine ? '✓ ' : '') + label + bar + '</div>';
        }).join('');
        return '<div class="card" style="margin:10px 0"><b>' + h(p.question) + '</b> ' + (p.closed ? '<span class="pill">' + h(T('مغلق', 'Closed')) + '</span>' : '') +
          '<div class="sub">' + h(p.cohort_name || T('كل الطلبة', 'All students')) + (isStaff() ? ' · ' + h(T('أجاب ', 'Answered ') + total + T(' من ', ' of ') + p.eligible) : '') + '</div>' + opts +
          (isAdmin() ? '<div class="tabs"><button class="btn sm" data-act="pl-close" data-id="' + p.id + '" data-c="' + (p.closed ? 0 : 1) + '">' + h(p.closed ? T('إعادة فتح', 'Reopen') : T('إغلاق', 'Close')) + '</button> <button class="btn sm bad" data-act="pl-del" data-id="' + p.id + '" data-confirm="1">' + h(T('حذف', 'Delete')) + '</button></div>' : '') + '</div>';
      }).join('') || '<div class="empty">' + h(T('لا استبيانات', 'No polls')) + '</div>') + '</div>';
  }

  function annMsg(m) {
    var base = msgHtml(m, false, true), extra = '';
    if (m.pinned) extra += '<div><span class="pill warn">📌 ' + h(T('مثبّت', 'Pinned')) + '</span></div>';
    if (isAdmin() && m.id) {
      var coh = ST.cohorts.filter(function (c) { return c.id === ST.cohort; })[0], mem = coh ? Number(coh.members) : 0;
      extra += '<div class="sub">👁 ' + h(T('اطّلع ' + (m.readers || 0) + ' من ' + mem, 'Seen by ' + (m.readers || 0) + ' of ' + mem)) + ' · <button class="btn sm" data-act="cm-pin" data-id="' + m.id + '" data-p="' + (m.pinned ? 0 : 1) + '">' + h(m.pinned ? T('إلغاء التثبيت', 'Unpin') : T('📌 تثبيت', '📌 Pin')) + '</button></div>';
    }
    return base.slice(0, -6) + extra + '</div>';
  }
  function val(id) { var e = $c('#' + id); return e ? e.value : ''; }
  /* ---------- الجدول الأسبوعي للمحاضرين والموظفين ---------- */
  var DAYS = [['sun', 'الأحد', 'Sun'], ['mon', 'الاثنين', 'Mon'], ['tue', 'الثلاثاء', 'Tue'], ['wed', 'الأربعاء', 'Wed'], ['thu', 'الخميس', 'Thu']];
  async function loadWeek() { ST.week.rows = (await rpc('comm_weekly_list')) || []; }
  function weekHtml() {
    var adm = isAdmin(), rows = ST.week.rows || [];
    var head = '<tr><th>#</th><th>' + h(T('الاسم', 'Name')) + '</th>' + DAYS.map(function (d) { return '<th>' + h(d[ar() ? 1 : 2]) + '</th>'; }).join('') + '<th>' + h(T('ملاحظات', 'Notes')) + '</th>' + (adm ? '<th></th>' : '') + '</tr>';
    var body = rows.map(function (r, i) {
      var c = r.cells || {};
      var cell = function (k, v, ph) { return adm ? '<input data-cm="wk" data-id="' + r.id + '" data-k="' + k + '" value="' + h(v || '') + '" placeholder="' + h(ph || '') + '" style="width:100%;min-width:90px">' : h(v || ''); };
      return '<tr><td>' + (i + 1) + '</td><td>' + (adm ? cell('name', r.name) : '<b>' + h(r.name) + '</b>') + '</td>' + DAYS.map(function (d) { return '<td>' + cell(d[0], c[d[0]]) + '</td>'; }).join('') + '<td>' + cell('notes', r.notes) + '</td>' +
        (adm ? '<td><button class="btn sm bad" data-act="wk-del" data-id="' + r.id + '" data-confirm="1">' + h(T('حذف', 'Delete')) + '</button></td>' : '') + '</tr>';
    }).join('');
    return '<div class="card"><h2>' + h(T('الجدول الأسبوعي للمحاضرين والموظفين', 'Weekly schedule: faculty & staff')) + '</h2>' +
      '<p class="sub">' + h(adm ? T('اكتب مكان عمل كل موظف في كل يوم (مثل: الكلية، مستشفى الشفاء، إجازة). يُحفظ التعديل تلقائياً عند الخروج من الخانة.', 'Type each person\'s workplace per day. Edits save automatically when you leave a cell.') : T('جدول أماكن العمل الأسبوعي.', 'Weekly workplace table.')) + '</p>' +
      (ST.week.note ? '<p class="pill ok">' + h(ST.week.note) + '</p>' : '') +
      '<div class="tabs" style="margin:8px 0">' + (adm ? '<button class="btn pri" data-act="wk-add">+ ' + h(T('إضافة صف', 'Add row')) + '</button><button class="btn" data-act="wk-fill">' + h(T('إضافة كل الموظفين المسجلين', 'Add all registered staff')) + '</button>' : '') +
      '<button class="btn" data-act="wk-export">⬇ ' + h(T('تصدير Word', 'Export to Word')) + '</button>' + (adm && rows.length ? '<button class="btn sm bad" data-act="wk-clear" data-confirm="1">' + h(T('مسح الجدول', 'Clear table')) + '</button>' : '') + '</div>' +
      '<div style="overflow-x:auto"><table class="cm-wk" style="border-collapse:collapse;width:100%">' + head + (body || '<tr><td colspan="9" class="empty">' + h(T('لا بيانات. أضف صفاً أو أضف الموظفين المسجلين.', 'No rows yet.')) + '</td></tr>') + '</table></div></div>';
  }
  function weekRowValues(id) {
    var o = { cells: {}, notes: '' };
    Array.prototype.forEach.call(document.querySelectorAll('[data-cm=wk][data-id="' + id + '"]'), function (e) {
      var k = e.dataset.k; if (k === 'name') o.name = e.value; else if (k === 'notes') o.notes = e.value; else o.cells[k] = e.value;
    });
    return o;
  }
  function weekDoc() {
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var rows = ST.week.rows || [], d = new Date();
    var th = 'style="background:#12304D;color:#ffffff;border:1px solid #12304D;padding:6px 8px;text-align:center;font-size:12pt"';
    var td = function (x, b) { return '<td style="border:1px solid #8aa0b4;padding:6px 8px;text-align:center;font-size:11pt' + (b ? ';font-weight:bold' : '') + '">' + esc(x) + '</td>'; };
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>الجدول الأسبوعي</title>' +
      '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->' +
      '<style>@page Section1{size:841.9pt 595.3pt;mso-page-orientation:landscape;margin:40pt 40pt 40pt 40pt}div.Section1{page:Section1}body{font-family:Arial,sans-serif}table{border-collapse:collapse;width:100%}tr{page-break-inside:avoid}</style></head>' +
      '<body dir="rtl"><div class="Section1">' +
      '<p style="text-align:center;font-size:13pt;color:#0B8A97;margin:0"><b>كلية فلسطين للتمريض - غزة</b></p>' +
      '<p style="text-align:center;font-size:20pt;color:#12304D;margin:4pt 0 2pt"><b>الجدول الأسبوعي للمحاضرين والموظفين</b></p>' +
      '<p style="text-align:center;font-size:10pt;color:#6B7C8A;margin:0 0 10pt">تاريخ الإصدار: ' + esc(d.toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' })) + '</p>' +
      '<table dir="rtl" width="100%" border="1" cellspacing="0" cellpadding="4" style="width:100%;border-collapse:collapse"><thead><tr><th ' + th + ' width="4%">#</th><th ' + th + ' width="20%">الاسم</th>' + DAYS.map(function (x) { return '<th ' + th + ' width="13%">' + x[1] + '</th>'; }).join('') + '<th ' + th + ' width="12%">ملاحظات</th></tr></thead><tbody>' +
      rows.map(function (r, i) { var c = r.cells || {}; return '<tr>' + td(i + 1) + td(r.name, true) + DAYS.map(function (x) { return td(c[x[0]]); }).join('') + td(r.notes) + '</tr>'; }).join('') +
      '</tbody></table></div></body></html>';
  }
  function saveWord(name, html) {
    var blob = new Blob(['﻿', html], { type: 'application/msword;charset=utf-8' }), u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  function pendSelCount() { return ST.admin.pending.filter(function (p) { return ST.admin.sel[p.user_id]; }).length; }
  function selCount() { return Object.keys(ST.admin.sel).filter(function (k) { return ST.admin.sel[k]; }).length; }
  function dupSelCount() { return Object.keys(ST.admin.dupSel).filter(function (k) { return ST.admin.dupSel[k]; }).length; }
  var REASON = { name: ['الاسم متشابه', 'Same name'], number: ['الرقم الجامعي مكرر', 'Same academic number'], national_id: ['رقم الهوية مكرر', 'Same national ID'], number_vs_id: ['رقم جامعي يطابق رقم هوية طالب آخر', 'Academic number equals another student\'s national ID'] };
  function dupsHtml() {
    var A = ST.admin, d = A.dups;
    var head = '<p class="sub">' + h(T('يفحص التطبيق الطلبة المتشابهين بالاسم أو الرقم الجامعي أو رقم الهوية. يُقترح بقاء الأحدث وحذف الأقدم ممن لم يدخل أبداً. راجع القائمة قبل الحذف.', 'Finds students sharing a name, academic number or national ID. The newest is kept and older ones that never signed in are suggested for deletion. Review before deleting.')) + '</p>' +
      '<div class="tabs"><button class="btn pri" data-act="cm-dups-find"' + (ST.busy ? ' disabled' : '') + '>' + h(T('فحص التكرار', 'Scan for duplicates')) + '</button>' +
      (d && d.groups.length ? '<button class="btn bad" data-act="cm-del-dups"' + (dupSelCount() ? '' : ' disabled') + '>' + h(T('حذف المحدد', 'Delete selected')) + ' (' + dupSelCount() + ')</button>' : '') + '</div>';
    if (!d) return head;
    if (!d.groups.length) return head + '<div class="empty">' + h(T('لا يوجد تكرار', 'No duplicates found')) + '</div>';
    return head + '<p class="sub">' + h(T(d.groups.length + ' مجموعة تكرار', d.groups.length + ' duplicate group(s)')) + '</p>' + d.groups.map(function (g) {
      return '<div class="card" style="margin:8px 0"><b>' + h(REASON[g.reason] ? REASON[g.reason][ar() ? 0 : 1] : g.reason) + '</b><div class="list">' + g.rows.map(function (r) {
        return '<div class="row"><label style="padding-inline-end:8px"><input type="checkbox" data-cm="dsel" data-id="' + h(r.id) + '"' + (A.dupSel[r.id] ? ' checked' : '') + '></label><div class="main"><div class="t">' + h(r.full_name) + '</div><div class="sub">' + h(r.university_id || '') + (r.cohort_name ? ' · ' + h(r.cohort_name) : '') + ' · ' + h(T('أُنشئ ', 'created ') + fmt(r.created_at)) + ' · ' + h(r.last_sign_in ? T('آخر دخول ', 'last sign-in ') + fmt(r.last_sign_in) : T('لم يدخل أبداً', 'never signed in')) + (r.must_change ? ' · ' + h(T('كلمة افتراضية', 'default password')) : '') + '</div></div></div>';
      }).join('') + '</div></div>';
    }).join('');
  }
  async function findDups() {
    ST.busy = true; draw();
    await guard(async function () {
      var rows = await rpc('comm_find_duplicates'), by = {}, order = [];
      (rows || []).forEach(function (r) { var k = r.reason + '|' + r.grp; if (!by[k]) { by[k] = { reason: r.reason, rows: [] }; order.push(k); } if (!by[k].rows.some(function (x) { return x.id === r.id; })) by[k].rows.push(r); });
      var groups = order.map(function (k) { return by[k]; }), sel = {};
      groups.forEach(function (g) {
        var newest = g.rows.slice().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); })[0];
        g.rows.forEach(function (r) { if (r.id !== newest.id && !r.last_sign_in) sel[r.id] = true; });
      });
      ST.admin.dups = { groups: groups }; ST.admin.dupSel = sel; ST.admin.note = '';
    });
  }
  async function deleteIds(ids, after) {
    if (!ids.length) return;
    var withMsgs = 0, totalMsgs = 0;
    try {
      var act = await rpc('comm_student_activity', { p_ids: ids });
      (act || []).forEach(function (a) { if (Number(a.msgs) > 0) { withMsgs++; totalMsgs += Number(a.msgs); } });
    } catch (e) {}
    var warn = withMsgs ? T('\n\nتنبيه: ' + withMsgs + ' منهم لديهم رسائل سابقة (' + totalMsgs + ' رسالة) وستُحذف المحادثات كلها نهائياً حتى من جهة الطرف الآخر.', '\n\nNote: ' + withMsgs + ' of them have previous messages (' + totalMsgs + ' messages). Those conversations will be permanently deleted for the other side too.') : '';
    var big = ids.length > 20 ? T('\n\nالعدد كبير (' + ids.length + '). تأكد أنك حدّدت الصحيح فقط.', '\n\nThat is a large number (' + ids.length + '). Make sure the selection is right.') : '';
    var w = window.prompt(T('سيُحذف ' + ids.length + ' حساب نهائياً.', 'This permanently deletes ' + ids.length + ' account(s).') + warn + big + T('\n\nللتأكيد اكتب كلمة: حذف', '\n\nTo confirm type: delete'));
    if (!w || ['حذف', 'delete'].indexOf(w.trim().toLowerCase()) < 0) return;
    ST.busy = true; draw();
    await guard(async function () {
      var del = 0, skip = 0, errs = [], gone = 0;
      for (var i = 0; i < ids.length; i += 100) {
        var r = await sb().functions.invoke(((window.PLANNER_CONFIG || {}).ADMIN_FN || 'admin-accounts'), { body: { action: 'delete', ids: ids.slice(i, i + 100) } });
        if (r.error || (r.data && r.data.error)) throw new Error((r.data && r.data.error) || await ferr(r));
        r.data.results.forEach(function (x) { if (x.status === 'deleted') { del++; gone += Number(x.messages || 0); } else if (x.status === 'error') errs.push(x.message); else skip++; });
      }
      ST.admin.note = T('تم حذف ' + del + (gone ? ' (مع ' + gone + ' رسالة)' : '') + (skip ? ' · تخطّى ' + skip : '') + (errs.length ? ' · تعذّر ' + errs.length + ': ' + errs[0] : ''), 'Deleted ' + del + (skip ? ' · skipped ' + skip : '') + (errs.length ? ' · failed ' + errs.length + ': ' + errs[0] : ''));
      ST.admin.sel = {}; ST.admin.dupSel = {};
      await after();
    });
  }
  function sheetHtml() {
    var S = ST.admin.sheet, m = S.map;
    var opts = function (cur, optional) { return (optional ? '<option value="-1">—</option>' : '') + S.head.map(function (c, i) { return '<option value="' + i + '"' + (cur === i ? ' selected' : '') + '>' + h((c || T('عمود ', 'Column ') + (i + 1)) + (S.body[0] && S.body[0][i] ? '  ← ' + String(S.body[0][i]).slice(0, 22) : '')) + '</option>'; }).join(''); };
    var sel = function (k, label, optional) { return '<label>' + h(label) + '<select data-cm="map" data-k="' + k + '">' + opts(m[k], optional) + '</select></label>'; };
    var nine = S.body.slice(0, 50).filter(function (r) { return /^\d{9}$/.test(normNum(r[m.num])); }).length;
    var warn = nine > Math.min(S.body.length, 50) / 2 && m.nid < 0;
    return '<div class="card" style="margin:8px 0"><b>' + h(T('تحديد أعمدة الملف', 'Map the file columns')) + '</b><p class="sub">' + h(T('تأكد أن «الرقم الأكاديمي» هو عمود الرقم الجامعي وليس رقم الهوية. المثال بجانب كل عمود من أول سطر.', 'Make sure "Academic number" is the university number, not the national ID. An example from the first row is shown next to each column.')) + '</p>' +
      (warn ? '<p class="pill bad">' + h(T('الأرقام المختارة 9 خانات وتشبه أرقام هوية. اختر عمود الرقم الجامعي الصحيح.', 'The chosen numbers have 9 digits and look like national IDs. Pick the university number column.')) + '</p>' : '') +
      '<div class="form">' + sel('num', T('الرقم الأكاديمي / الوظيفي *', 'Academic / employee number *')) + sel('name', T('الاسم *', 'Name *')) + sel('nid', T('رقم الهوية (اختياري، للتحقق من التكرار)', 'National ID (optional, duplicate check)'), 1) + sel('maj', T('التخصص', 'Major'), 1) + sel('coh', T('الشعبة (للطلبة فقط)', 'Cohort (students only)'), 1) + '</div>' +
      '<div class="tabs"><button class="btn pri" data-act="cm-map-ok">' + h(T('اعتماد الأعمدة (' + S.body.length + ' سطر)', 'Use these columns (' + S.body.length + ' rows)')) + '</button><button class="btn" data-act="cm-clearrows">' + h(T('إلغاء', 'Cancel')) + '</button></div></div>';
  }
  function normNum(v) { return String(v == null ? '' : v).replace(/[\u0660-\u0669]/g, function (d) { return d.charCodeAt(0) - 1632; }).replace(/[\u200b-\u200f\u202a-\u202e\ufeff\s\-_\/]/g, '').replace(/\.0+$/, ''); }
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function (res, rej) { var sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; sc.onload = res; sc.onerror = function () { rej(new Error(T('تعذّر تحميل مكتبة Excel (تحقق من الاتصال)', 'Could not load the Excel library'))); }; document.head.appendChild(sc); });
  }
  async function readSheet(file) {
    if (!file) return;
    await guard(async function () {
      await loadXlsx();
      var wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      var data = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
      data = data.filter(function (r) { return r.some(function (c) { return String(c).trim(); }); });
      if (!data.length) throw new Error(T('الملف فارغ', 'Empty file'));
      var head = data[0].map(function (c) { return String(c).trim(); });
      var find = function (re, not) { for (var i = 0; i < head.length; i++) if (re.test(head[i]) && !(not && not.test(head[i]))) return i; return -1; };
      var NID = /هوي|national|identity/i;
      var iNid = find(NID), iName = find(/اسم|name/i);
      var iNum = find(/وظيف|employee|staff|جامع|اكاديم|أكاديم|academic|university|student|الطالب/i, NID);
      if (iNum < 0) iNum = find(/رقم|number|\bid\b|no\.?$/i, /هوي|national|identity|جوال|هاتف|موبايل|phone|mobile|tel/i);
      var iMaj = find(/تخصص|major/i), iCoh = find(/شعب|cohort/i);
      var hasHead = iName >= 0 && iNum >= 0 && iName !== iNum;
      var body;
      if (hasHead) body = data.slice(1);
      else { body = data; head = data[0].map(function () { return ''; }); iNum = 0; iName = Math.min(1, head.length - 1); iNid = -1; iMaj = -1; iCoh = -1; }
      ST.admin.rows = null; ST.admin.rowsInfo = '';
      ST.admin.sheet = { head: head, body: body, map: { num: iNum, name: iName, nid: iNid, maj: iMaj, coh: iCoh } };
    });
  }
  function applyMap() {
    var S = ST.admin.sheet, m = S.map;
    var byName = {}; ST.cohorts.forEach(function (c) { byName[c.name.replace(/\s+/g, ' ').trim()] = c.id; });
    var unmatched = 0, rows = S.body.map(function (r) {
      var o = { number: normNum(r[m.num]), name: String(r[m.name] || '').trim() };
      if (m.nid >= 0 && normNum(r[m.nid])) o.national_id = normNum(r[m.nid]);
      if (m.maj >= 0 && String(r[m.maj]).trim()) o.major = String(r[m.maj]).trim();
      if (m.coh >= 0 && String(r[m.coh]).trim()) { var id = byName[String(r[m.coh]).replace(/\s+/g, ' ').trim()]; if (id) o.cohort_id = id; else unmatched++; }
      return o;
    }).filter(function (o) { return o.number || o.name; });
    ST.admin.rows = rows; ST.admin.sheet = null;
    ST.admin.rowsInfo = T('تمت قراءة ' + rows.length + ' سطراً من الملف' + (unmatched ? ' (شعب غير مطابقة: ' + unmatched + ')' : '') + '. راجع النوع والشعبة ثم اضغط إنشاء.', rows.length + ' rows read' + (unmatched ? ' (unmatched cohorts: ' + unmatched + ')' : '') + '. Check type/cohort, then create.');
  }
  async function approve(ids) {
    var list = ST.admin.reqs.filter(function (r) { return ids.indexOf(r.id) > -1; });
    if (!list.length) return;
    var coh = ($c('#rq-coh') || {}).value;
    ST.busy = true; draw();
    await guard(async function () {
      var heldNames = [];
      for (var i = 0; i < list.length; i += 100) {
        var part = list.slice(i, i + 100);
        var r = await sb().functions.invoke(((window.PLANNER_CONFIG || {}).ADMIN_FN || 'admin-accounts'), { body: { action: 'create', rows: part.map(function (q) { return { number: q.number, name: q.full_name, role: q.kind === 'staff' ? 'staff' : 'student', major: q.major, cohort_id: q.kind === 'staff' ? null : (coh ? Number(coh) : null) }; }) } });
        if (r.error || (r.data && r.data.error)) throw new Error((r.data && r.data.error) || await ferr(r));
        for (var j = 0; j < r.data.results.length; j++) {
          var x = r.data.results[j];
          if (x.status === 'created' || x.status === 'exists') await rpc('comm_decide_request', { p_id: part[j].id, p_status: 'approved' }); else if (x.status === 'dup_name') heldNames.push(part[j].full_name);
        }
      }
      ST.admin.reqs = await rpc('comm_list_requests'); ST.admin.pending = await rpc('comm_pending_passwords');
      toast_(heldNames.length ? T('لم يُنشأ (اسم موجود مسبقاً): ' + heldNames.slice(0, 3).join('، ') + '. راجعهم.', 'Not created (name exists): ' + heldNames.slice(0, 3).join(', ')) : T('تمت الموافقة', 'Approved'));
    });
  }

  async function createAccounts() {
    var same = !!($c('#ac-same') || {}).checked;
    var txt = ($c('#ac-list').value || ''), role_ = $c('#ac-role').value, major = $c('#ac-major').value.trim(), coh = $c('#ac-coh').value, cat = $c('#ac-cat').value;
    var rows = ST.admin.rows ? ST.admin.rows.map(function (r) { return Object.assign({}, r, { role: role_, major: r.major || major || null, cohort_id: r.cohort_id || (coh ? Number(coh) : null), category: cat || null }); }) : txt.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var m = /^([A-Za-z0-9]+)\s*[,\t;،]\s*(.+)$/.exec(l) || /^([A-Za-z0-9]+)\s+(.+)$/.exec(l);
      return m ? { number: normNum(m[1]), name: m[2].trim(), role: role_, major: major || null, cohort_id: coh ? Number(coh) : null, category: cat || null } : { number: '', name: l };
    });
    if (!rows.length) { window.alert(T('لا توجد أسطر للإنشاء. ألصق القائمة أو ارفع ملفاً واضغط «اعتماد الأعمدة» أولاً.', 'No rows to create. Paste a list or upload a file and press "Use these columns" first.')); return; }
    var rl = ({ student: T('طلبة', 'students'), staff: T('موظفين', 'staff'), professor: T('أعضاء هيئة تدريس', 'faculty') })[role_];
    if (!window.confirm(T('سيتم إنشاء ' + rows.length + ' حساب بنوع: ' + rl + '. متابعة؟', 'Create ' + rows.length + ' accounts as: ' + rl + '. Continue?'))) return;
    ST.busy = true; ST.admin.res = ''; draw();
    await guard(async function () {
      var tot = { created: 0, exists: 0, invalid: 0, error: 0, dup_name: 0 }, errs = [], dups = [], bad = [], ex = [];
      for (var i = 0; i < rows.length; i += 100) {
        var r = await sb().functions.invoke(((window.PLANNER_CONFIG||{}).ADMIN_FN||'admin-accounts'), { body: { action: 'create', allow_same_name: same, rows: rows.slice(i, i + 100) } });
        if (r.error || (r.data && r.data.error)) throw new Error((r.data && r.data.error) || await ferr(r));
        r.data.results.forEach(function (x) { tot[x.status] = (tot[x.status] || 0) + 1; if (x.status === 'error') errs.push(x.number + ': ' + x.message); if (x.status === 'dup_name') dups.push(x.name); if (x.status === 'invalid') bad.push(x.number || '(فارغ)'); if (x.status === 'exists') ex.push(x.number); });
      }
      ST.admin.res = T('أُنشئ ' + tot.created + ' · موجود مسبقاً ' + tot.exists + ' · اسم متشابه تُخطّي ' + tot.dup_name + ' · غير صالح ' + tot.invalid + ' · أخطاء ' + tot.error, 'Created ' + tot.created + ' · existing ' + tot.exists + ' · invalid ' + tot.invalid + ' · similar-name skipped ' + tot.dup_name + ' · errors ' + tot.error) + (dups.length ? ' — ' + T('أسماء مُتخطّاة: ', 'Skipped names: ') + dups.slice(0, 5).join('، ') : '') + (errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : '');
      if (bad.length) ST.admin.res += ' — ' + T('أرقام غير صالحة (أمثلة): ', 'Invalid numbers (examples): ') + bad.slice(0, 5).join('، ') + T(' (المسموح 3–20 حرفاً أو رقماً إنجليزياً بلا رموز)', ' (3–20 letters/digits only)');
      if (ex.length) ST.admin.res += ' — ' + T('موجودة مسبقاً (أمثلة): ', 'Already exist (examples): ') + ex.slice(0, 5).join('، ');
      try { window.alert(ST.admin.res); } catch (e) {}
      ST.admin.pending = await rpc('comm_pending_passwords'); ST.cohorts = await rpc('comm_list_cohorts'); ST.admin.rows = null; ST.admin.rowsInfo = ''; ST.admin.clist = '';
    });
  }
})();
