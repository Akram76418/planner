/* rs.js: «أبحاث الماجستير»: مجموعات (مشرف + طلبة) ← محادثة جماعية وفردية بمرفقات (Word/Excel/PDF/صور)،
   مكتبة ملفات بنسخ، ومتتبّع مراحل البحث. تعتمد على supabase/research.sql. تظهر لمن له مجموعة، وللمدرّسين والمدير (للإنشاء). */
(function () {
  'use strict';
  var BUCKET = 'research-files', MAXB = 25 * 1024 * 1024;
  var EXT = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
  var ACCEPT = Object.keys(EXT).map(function (e) { return '.' + e; }).join(',');
  var P = function () { return window.PLANNER_AUTH || null; };
  function sb() { return P() && P().sb(); }
  function ar() { return P() ? P().lang() === 'ar' : true; }
  function T(a, e) { return ar() ? a : e; }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $q(s) { return document.querySelector(s); }
  function myId() { return ((P() && P().user()) || {}).id; }
  function role() { return (window.CTX || {}).role; }
  function canCreate() { return role() === 'professor' || (role() === 'admin' && !!window.CAN && window.CAN('rs')); }
  async function rpc(n, a) { var r = await sb().rpc(n, a || {}); if (r.error) throw new Error(r.error.message); return r.data; }
  function fext(n) { var m = /\.([A-Za-z0-9]{2,5})$/.exec(n || ''); return m ? m[1].toLowerCase() : ''; }
  function isImg(n) { return ['png', 'jpg', 'jpeg', 'gif', 'webp'].indexOf(fext(n)) > -1; }
  function icon(n) { var e = fext(n); return e === 'pdf' ? '📄' : (e === 'doc' || e === 'docx') ? '📝' : (e === 'xls' || e === 'xlsx' || e === 'csv') ? '📊' : (e === 'ppt' || e === 'pptx') ? '📽' : isImg(n) ? '🖼' : '📎'; }
  function fsize(b) { b = Number(b) || 0; return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function fdt(iso) { if (!iso) return ''; try { return new Date(iso).toLocaleString(ar() ? 'ar' : 'en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } }
  function fdate(d) { if (!d) return '—'; try { return new Date(d + 'T00:00:00').toLocaleDateString(ar() ? 'ar' : 'en', { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return d; } }
  function daysTo(d) { return Math.round((new Date(d + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000); }
  function today() { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }

  var css = document.createElement('style');
  css.textContent = '.rs-msgs{height:min(52vh,470px);overflow:auto;border:1px solid var(--line);border-radius:12px;padding:10px;background:var(--bg)}.rs-m{display:flex;margin:8px 0;gap:6px;align-items:flex-start}.rs-m.me{flex-direction:row}.rs-m.other{flex-direction:row-reverse}' +
    '.rs-b{max-width:84%;padding:8px 12px;border-radius:14px;background:var(--surface);border:1px solid var(--line);word-break:break-word}.rs-m.me .rs-b{background:rgba(11,138,151,.14);border-color:var(--accent,#0b8a97)}.rs-n{font-size:12px;color:var(--muted);margin-bottom:2px}' +
    '.rs-t{white-space:pre-wrap;line-height:1.7}.rs-file{display:flex;gap:8px;align-items:center;margin-top:6px;padding:6px 10px;border:1px dashed var(--line);border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:start;cursor:pointer}.rs-file:hover{border-color:var(--accent,#0b8a97)}' +
    '.rs-img{display:block;max-width:230px;max-height:190px;border-radius:8px;margin-top:6px;cursor:pointer;background:rgba(127,127,127,.15);min-width:80px;min-height:50px}.rs-comp{display:flex;gap:6px;align-items:flex-end;margin-top:8px}.rs-comp textarea{flex:1;min-height:46px;max-height:140px;resize:vertical}' +
    '.rs-thr{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}.rs-thr button{position:relative}.rs-dot{background:#dc2626;color:#fff;border-radius:99px;font-size:11px;padding:0 6px;margin-inline-start:4px}' +
    '.rs-bar{height:8px;background:rgba(127,127,127,.2);border-radius:99px;overflow:hidden}.rs-bar i{display:block;height:100%;background:var(--accent,#0b8a97)}.rs-ms{display:grid;grid-template-columns:1fr auto;gap:6px 10px;align-items:center;padding:8px 0;border-top:1px solid var(--line)}.rs-ms.late .rs-due{color:#dc2626;font-weight:700}' +
    '.rs-ms input[type=date],.rs-ms select{width:auto!important;min-width:0;max-width:150px;padding:4px 8px}.rs-ms .btn{white-space:nowrap}.rs-ms>div:last-child{flex-wrap:wrap;justify-content:flex-end}.rs-due input{vertical-align:middle;margin-inline-start:4px}.rs-comp .btn{white-space:nowrap}.rs-addms input{width:auto!important}.rs-addms input:not([type]){flex:1;min-width:150px;width:auto!important}.rs-st-done{color:#15803d}.rs-st-review{color:#d97706}.rs-st-doing{color:#0b8a97}.rs-ver{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:5px 0;border-top:1px dashed var(--line)}.rs-cp{margin:6px 0 10px;padding:10px;border:1px solid var(--accent,#0b8a97);border-radius:12px;background:rgba(11,138,151,.06)}.rs-cm{padding:8px 0;border-top:1px dashed var(--line)}.rs-cm:first-of-type{border-top:0}.rs-cm.fixed .rs-t{opacity:.65;text-decoration:line-through}.rs-cp textarea{width:100%;min-height:60px;margin-top:6px}.rs-rem{border-inline-start:4px solid #d97706;background:rgba(217,119,6,.08);padding:8px 12px;border-radius:10px;margin:8px 0}.rs-rem.late{border-color:#dc2626;background:rgba(220,38,38,.08)}.rs-nb{background:#dc2626;color:#fff;border-radius:99px;font-size:11px;padding:0 6px;margin-inline-start:4px}';
  document.head.appendChild(css);

  var R = { loaded: false, groups: [], g: null, tab: 'chat', members: [], threads: [], tid: null, msgs: [], files: [], ms: [], draft: '', attach: null, busy: false, err: '', msg: '', gform: null, gedit: false, found: [], urls: {}, sig: '', fq: '', cmts: [], copen: null, cdraft: '', cplace: '', rem: [] };

  window.rsVisible = function () { return !!window.RSG && (window.RSG.length > 0 || canCreate()); };
  function root() { return $q('#rs-root'); }
  function redraw() { var r = root(); if (r) { var keep = R.draft; r.innerHTML = html(); var ta = $q('#rs-text'); if (ta) ta.value = keep; var ct = $q('#rs-cm-t'); if (ct) ct.value = R.cdraft; var cp = $q('#rs-cm-p'); if (cp) cp.value = R.cplace; afterDraw(); } }
  window.rsView = function () { return '<div id="rs-root"></div>'; };
  window.rsMount = function () { redraw(); if (!R.loaded && !R.busy) go(loadGroups); startPoll(); };
  async function go(fn) { R.busy = true; R.err = ''; try { await fn(); } catch (e) { R.err = (e && e.message) || String(e); if (/rs_|function|schema cache/i.test(R.err)) R.err += ' — ' + T('شغّل research.sql في Supabase أولاً.', 'Run research.sql in Supabase first.'); } R.busy = false; redraw(); }

  /* ───────── تحميل ───────── */
  async function loadGroups() { R.groups = (await rpc('rs_my_groups')) || []; R.loaded = true; window.RSG = R.groups; try { R.rem = (await rpc('rs_reminders', { p_days: 7 })) || []; } catch (e) { R.rem = []; } navBadge(); }
  async function loadCmts() { try { R.cmts = (await rpc('rs_cmt_list', { p_group: R.g.id })) || []; } catch (e) { R.cmts = []; } }
  function navBadge() { var b = $q('#side [data-v="rs"]'); if (!b) return; var n = (window.RSG || []).reduce(function (s, g) { return s + (Number(g.unread) || 0) + (Number(g.cmt_new) || 0) + (Number(g.overdue) || 0) + (Number(g.soon) || 0); }, 0), o = b.querySelector('.rs-nb'); if (o) o.remove(); if (n > 0) { var sp = document.createElement('span'); sp.className = 'rs-nb'; sp.textContent = n > 99 ? '99+' : n; b.appendChild(sp); } }
  setTimeout(navBadge, 1500); setInterval(async function () { try { if (document.hidden || !window.RSG) return; var r = await rpc('rs_my_groups'); window.RSG = r || []; navBadge(); } catch (e) {} }, 60000);
  async function openGroup(id) {
    R.g = R.groups.filter(function (g) { return String(g.id) === String(id); })[0]; if (!R.g) return;
    R.tab = 'chat'; R.members = (await rpc('rs_members_list', { p_group: R.g.id })) || []; R.found = []; R.files = []; R.ms = []; R.cmts = []; R.copen = null; R.cdraft = ''; R.cplace = ''; R.msg = ''; R.gedit = false;
    if (R.g.my_role !== 'admin') { await loadThreads(); R.tid = (R.threads.filter(function (t) { return t.kind === 'group'; })[0] || {}).id || null; if (R.tid) await loadMsgs(true); } else { R.threads = []; R.tid = null; R.msgs = []; R.tab = 'members'; }
  }
  async function loadThreads() { R.threads = (await rpc('rs_threads', { p_group: R.g.id })) || []; }
  async function loadMsgs(markRead) {
    if (!R.tid) { R.msgs = []; return; }
    var rows = (await rpc('rs_msgs', { p_thread: R.tid, p_before: null, p_limit: 80 })) || [];
    R.msgs = rows.slice().reverse(); R.sig = sigOf(R.msgs);
    if (markRead) { try { await rpc('rs_mark_read', { p_thread: R.tid }); } catch (e) {} var t = R.threads.filter(function (x) { return x.id === R.tid; })[0]; if (t) t.unread = 0; }
  }
  function sigOf(a) { return a.length + ':' + (a.length ? a[a.length - 1].id : 0) + ':' + a.filter(function (m) { return m.deleted; }).length; }
  async function loadFiles() { R.files = (await rpc('rs_files_list', { p_group: R.g.id })) || []; await loadCmts(); if (isMem() && R.g.cmt_new > 0) { try { await rpc('rs_cmt_mark_seen', { p_group: R.g.id }); R.g.cmt_new = 0; } catch (e) {} } }
  async function loadMs() { R.ms = (await rpc('rs_ms_list', { p_group: R.g.id })) || []; }
  function isSup() { return R.g && (R.g.my_role === 'supervisor' || R.g.my_role === 'admin'); }
  function isMem() { return R.g && R.g.my_role !== 'admin'; }

  /* ───────── العرض ───────── */
  function html() {
    var top = (R.err ? '<p class="pill bad">⚠ ' + h(R.err) + '</p>' : '') + (R.msg ? '<p class="pill ok">' + h(R.msg) + '</p>' : '');
    if (!R.loaded && !R.err) return '<div class="card"><p class="sub">' + h(T('جارٍ التحميل…', 'Loading…')) + '</p></div>';
    return top + (R.g ? groupHtml() : listHtml());
  }
  function listHtml() {
    var rows = R.groups.map(function (g) {
      return '<div class="row"><div class="main"><div class="t">🎓 ' + h(g.name) + ' <span class="pill">' + h(({ supervisor: T('مشرف', 'Supervisor'), student: T('طالب', 'Student'), member: T('عضو', 'Member'), admin: T('إدارة', 'Admin') })[g.my_role] || g.my_role) + '</span>' + (g.archived ? ' <span class="pill">' + h(T('مؤرشفة', 'Archived')) + '</span>' : '') +
        (g.unread > 0 ? ' <span class="rs-dot">' + g.unread + '</span>' : '') + (g.cmt_new > 0 ? ' <span class="pill warn">💬 ' + g.cmt_new + ' ' + h(T('تعليق جديد', 'new comment(s)')) + '</span>' : '') + (g.overdue > 0 ? ' <span class="pill bad">⏰ ' + g.overdue + ' ' + h(T('متأخرة', 'late')) + '</span>' : '') + (g.soon > 0 ? ' <span class="pill warn">⏳ ' + g.soon + ' ' + h(T('قريبة الموعد', 'due soon')) + '</span>' : '') + '</div>' +
        '<div class="sub">' + g.members + ' ' + h(T('عضو', 'members')) + (g.description ? ' · ' + h(g.description) : '') + '</div></div><div class="act"><button class="btn sm pri" data-act="rs-open" data-id="' + g.id + '">' + h(T('فتح', 'Open')) + '</button></div></div>';
    }).join('');
    var form = R.gform ? '<div class="card" style="margin:8px 0"><b>' + h(T('مجموعة بحثية جديدة', 'New research group')) + '</b><div class="form"><label>' + h(T('الاسم *', 'Name *')) + '<input id="rs-gname" maxlength="160" placeholder="' + h(T('مثال: ماجستير التمريض 2026', 'e.g. MSc Nursing 2026')) + '" value="' + h(R.gform.name) + '"></label><label>' + h(T('وصف (اختياري)', 'Description (optional)')) + '<input id="rs-gdesc" maxlength="500" value="' + h(R.gform.desc) + '"></label></div><div class="tabs"><button class="btn pri" data-act="rs-gsave">' + h(T('إنشاء', 'Create')) + '</button><button class="btn" data-act="rs-gcancel">' + h(T('إلغاء', 'Cancel')) + '</button></div></div>' : '';
    return '<div class="card"><h2>🎓 ' + h(T('أبحاث الماجستير', 'Master research')) + '</h2><p class="sub">' + h(T('مجموعات للتواصل والمتابعة بين المشرف وطلبة الماجستير: محادثة جماعية وفردية، ملفات Word وExcel وPDF وصور بنسخ، ومتتبّع لمراحل كل بحث.', 'Groups for supervisors and master students: group & direct chat, versioned files (Word/Excel/PDF/images) and a research milestone tracker.')) + '</p>' +
      remHtml() + (canCreate() ? '<button class="btn pri" data-act="rs-gnew">+ ' + h(T('مجموعة جديدة', 'New group')) + '</button>' : '') + form + '<div class="list" style="margin-top:8px">' + (rows || '<div class="empty">' + h(canCreate() ? T('لا مجموعات بعد. أنشئ أول مجموعة.', 'No groups yet. Create the first one.') : T('لم تُضف إلى أي مجموعة بعد.', 'You are not in any group yet.')) + '</div>') + '</div></div>';
  }
  function groupHtml() {
    var g = R.g, un = R.threads.reduce(function (s, t) { return s + (Number(t.unread) || 0); }, 0);
    var tabs = [['chat', '💬 ' + T('المحادثة', 'Chat') + (un ? ' <span class="rs-dot">' + un + '</span>' : ''), isMem()], ['members', '👥 ' + T('الأعضاء', 'Members'), true], ['files', '📁 ' + T('الملفات', 'Files') + (g.cmt_new > 0 ? ' <span class="rs-dot">' + g.cmt_new + '</span>' : ''), true], ['ms', '🎯 ' + T('مراحل البحث', 'Milestones'), true]].filter(function (x) { return x[2]; });
    var edit = R.gedit ? '<div class="card" style="margin:8px 0"><div class="form"><label>' + h(T('الاسم', 'Name')) + '<input id="rs-gname" value="' + h(g.name) + '"></label><label>' + h(T('الوصف', 'Description')) + '<input id="rs-gdesc" value="' + h(g.description || '') + '"></label></div><label class="ck"><input type="checkbox" id="rs-garch"' + (g.archived ? ' checked' : '') + '> ' + h(T('مؤرشفة (للقراءة فقط عملياً)', 'Archived')) + '</label><div class="tabs"><button class="btn pri" data-act="rs-gupd">' + h(T('حفظ', 'Save')) + '</button><button class="btn" data-act="rs-gedit-off">' + h(T('إلغاء', 'Cancel')) + '</button><button class="btn bad" data-act="rs-gdel" data-confirm="1" data-confirm-text="' + h(T('اضغط لتأكيد حذف المجموعة بكل ملفاتها ورسائلها', 'Click to confirm deleting the group with all files and messages')) + '">' + h(T('حذف المجموعة', 'Delete group')) + '</button></div></div>' : '';
    var body = R.tab === 'chat' ? chatHtml() : R.tab === 'members' ? membersHtml() : R.tab === 'files' ? filesHtml() : msHtml();
    return '<div class="card"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn sm" data-act="rs-back">←</button><b style="font-size:17px">🎓 ' + h(g.name) + '</b> <span class="pill">' + h(({ supervisor: T('مشرف', 'Supervisor'), student: T('طالب', 'Student'), member: T('عضو', 'Member'), admin: T('إدارة', 'Admin') })[g.my_role]) + '</span>' + (isSup() ? '<button class="btn sm" data-act="rs-gedit">⚙ ' + h(T('إعدادات', 'Settings')) + '</button>' : '') + '</div>' + (g.description ? '<p class="sub">' + h(g.description) + '</p>' : '') + edit +
      '<div class="tabs" style="margin:10px 0">' + tabs.map(function (t) { return '<button class="btn sm' + (R.tab === t[0] ? ' pri' : '') + '" data-act="rs-tab" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' + body + '</div>';
  }

  /* ---- المحادثة ---- */
  function thrChips() {
    var me = myId(), direct = {};
    R.threads.forEach(function (t) { if (t.kind === 'direct') direct[t.other_id] = t; });
    var gt = R.threads.filter(function (t) { return t.kind === 'group'; })[0];
    var chip = function (cls, label, att, un) { return '<button class="btn sm' + cls + '" ' + att + '>' + label + (un > 0 ? ' <span class="rs-dot">' + un + '</span>' : '') + '</button>'; };
    var out = chip(R.tid && gt && R.tid === gt.id ? ' pri' : '', '👥 ' + h(T('المجموعة', 'Group')), 'data-act="rs-thread" data-id="' + (gt ? gt.id : '') + '"', gt ? Number(gt.unread) : 0);
    R.members.filter(function (m) { return m.user_id !== me; }).forEach(function (m) {
      var t = direct[m.user_id]; out += chip(t && R.tid === t.id ? ' pri' : '', '💬 ' + h(m.full_name), 'data-act="rs-dm" data-u="' + m.user_id + '"', t ? Number(t.unread) : 0);
    });
    return out;
  }
  function curThreadTitle() {
    var t = R.threads.filter(function (x) { return x.id === R.tid; })[0];
    return !t || t.kind === 'group' ? T('محادثة المجموعة', 'Group chat') : T('محادثة خاصة مع ', 'Private chat with ') + (t.other_name || '');
  }
  function msgHtml(m) {
    var me = m.sender_id === myId(), t = R.threads.filter(function (x) { return x.id === R.tid; })[0] || {};
    var can = !m.deleted && (me || (t.kind === 'group' && isSup()));
    var body;
    if (m.deleted) body = '<i class="sub">' + h(T('حُذفت هذه الرسالة', 'This message was deleted')) + '</i>';
    else {
      body = (m.body ? '<div class="rs-t">' + h(m.body) + '</div>' : '');
      if (m.file_path) body += isImg(m.file_name) ? '<img class="rs-img" data-rs-img="' + h(m.file_path) + '" data-act="rs-dl" data-p="' + h(m.file_path) + '" data-n="' + h(m.file_name) + '" alt="' + h(m.file_name) + '">' : '';
      if (m.file_path) body += '<button class="rs-file" data-act="rs-dl" data-p="' + h(m.file_path) + '" data-n="' + h(m.file_name) + '"><span>' + icon(m.file_name) + '</span><span dir="auto">' + h(m.file_name) + ' · ' + fsize(m.file_size) + '</span><span>⬇</span></button>';
    }
    return '<div class="rs-m ' + (me ? 'me' : 'other') + '"><div class="rs-b"><div class="rs-n">' + (me ? h(T('أنا', 'Me')) : h(m.sender_name || '')) + ' · ' + h(fdt(m.created_at)) + '</div>' + body + '</div>' + (can ? '<button class="btn sm" title="' + h(T('حذف', 'Delete')) + '" data-act="rs-mdel" data-id="' + m.id + '" data-confirm="1" data-confirm-text="' + h(T('تأكيد؟', 'Sure?')) + '">✕</button>' : '') + '</div>';
  }
  function chatHtml() {
    return '<div id="rs-thr" class="rs-thr">' + thrChips() + '</div>' +
      '<div style="display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap;align-items:center"><b>' + h(curThreadTitle()) + '</b><span class="tabs"><span class="sub">' + h(T('تصدير المحادثة:', 'Export chat:')) + '</span><button class="btn sm" data-act="rs-exp" data-k="doc">Word</button><button class="btn sm" data-act="rs-exp" data-k="csv">Excel</button><button class="btn sm" data-act="rs-exp" data-k="pdf">PDF</button></span></div>' +
      '<div id="rs-msgs" class="rs-msgs">' + (R.msgs.map(msgHtml).join('') || '<div class="empty">' + h(T('لا رسائل بعد. ابدأ المحادثة.', 'No messages yet.')) + '</div>') + '</div>' +
      '<div id="rs-comp"><div id="rs-att">' + attHtml() + '</div><div class="rs-comp"><button class="btn" data-act="rs-pick" title="' + h(T('إرفاق ملف', 'Attach file')) + '">📎</button><textarea id="rs-text" data-rs="draft" maxlength="4000" placeholder="' + h(T('اكتب رسالة…', 'Write a message…')) + '"></textarea><button class="btn pri" data-act="rs-send"' + (R.busy ? ' disabled' : '') + '>' + h(T('إرسال', 'Send')) + '</button></div>' +
      '<div class="sub">' + h(T('الملفات المسموحة: Word وExcel وPDF وPowerPoint وصور (حتى 25 ميغابايت).', 'Allowed: Word, Excel, PDF, PowerPoint, images (up to 25 MB).')) + '</div></div>';
  }
  function attHtml() { return R.attach ? '<div class="pill" style="margin-top:6px">' + icon(R.attach.name) + ' ' + h(R.attach.name) + ' · ' + fsize(R.attach.size) + ' <button class="btn sm" data-act="rs-unattach">✕</button></div>' : ''; }

  /* ---- الأعضاء ---- */
  function membersHtml() {
    var me = myId();
    var rows = R.members.map(function (m) {
      var self = m.user_id === me;
      return '<div class="row"><div class="main"><div class="t">' + h(m.full_name) + (self ? ' <span class="sub">(' + h(T('أنت', 'you')) + ')</span>' : '') + ' <span class="pill">' + h(({ supervisor: T('مشرف', 'Supervisor'), student: T('طالب', 'Student'), member: T('عضو', 'Member') })[m.role]) + '</span></div><div class="sub" dir="auto">' + h(m.university_id || '') + '</div></div><div class="act">' +
        (isSup() ? '<select data-rs="mrole" data-u="' + m.user_id + '">' + ['supervisor', 'student', 'member'].map(function (r) { return '<option value="' + r + '"' + (m.role === r ? ' selected' : '') + '>' + ({ supervisor: T('مشرف', 'Supervisor'), student: T('طالب', 'Student'), member: T('عضو', 'Member') })[r] + '</option>'; }).join('') + '</select> <button class="btn sm bad" data-act="rs-mrem" data-u="' + m.user_id + '" data-confirm="1" data-confirm-text="' + h(T('تأكيد الإزالة؟', 'Remove?')) + '">' + h(T('إزالة', 'Remove')) + '</button>' : (self ? '<button class="btn sm bad" data-act="rs-mrem" data-u="' + m.user_id + '" data-confirm="1" data-confirm-text="' + h(T('تأكيد المغادرة؟', 'Leave?')) + '">' + h(T('مغادرة', 'Leave')) + '</button>' : '')) + '</div></div>';
    }).join('');
    var add = isSup() ? '<div class="card" style="margin:8px 0"><b>' + h(T('إضافة عضو', 'Add member')) + '</b><label>' + h(T('ابحث بالاسم أو الرقم الجامعي (حرفان على الأقل)', 'Search by name or number (min 2 characters)')) + '<input id="rs-find" autocomplete="off"></label><div id="rs-found">' + foundHtml() + '</div></div>' : '';
    return add + '<div class="list">' + rows + '</div>';
  }
  function foundHtml() {
    var ids = {}; R.members.forEach(function (m) { ids[m.user_id] = 1; });
    var l = R.found.filter(function (p) { return !ids[p.id]; });
    return l.length ? l.map(function (p) { return '<div class="row"><div class="main"><div class="t">' + h(p.full_name) + ' <span class="sub" dir="auto">' + h(p.university_id || '') + '</span></div></div><div class="act"><select id="rs-fr-' + p.id + '"><option value="student">' + h(T('طالب', 'Student')) + '</option><option value="member">' + h(T('عضو', 'Member')) + '</option><option value="supervisor"' + (p.acct_role === 'professor' ? ' selected' : '') + '>' + h(T('مشرف', 'Supervisor')) + '</option></select> <button class="btn sm pri" data-act="rs-madd" data-u="' + p.id + '">+ ' + h(T('إضافة', 'Add')) + '</button></div></div>'; }).join('') : '';
  }

  /* ---- الملفات ---- */
  function filesHtml() {
    var by = {}, order = [], q = R.fq.trim().toLowerCase();
    R.files.forEach(function (f) { var k = f.title.toLowerCase(); if (!by[k]) { by[k] = []; order.push(k); } by[k].push(f); });
    var me = myId();
    var groups = order.filter(function (k) { return !q || k.indexOf(q) > -1 || by[k].some(function (f) { return (f.file_name || '').toLowerCase().indexOf(q) > -1; }); }).map(function (k) {
      var l = by[k], top = l[0];
      return '<div class="card" style="margin:8px 0"><div style="display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap"><b>' + icon(top.file_name) + ' ' + h(top.title) + '</b>' + (isMem() ? '<button class="btn sm" data-act="rs-fver" data-t="' + h(top.title) + '">⬆ ' + h(T('نسخة جديدة', 'New version')) + '</button>' : '') + '</div>' +
        (isImg(top.file_name) ? '<img class="rs-img" data-rs-img="' + h(top.file_path) + '" data-act="rs-dl" data-p="' + h(top.file_path) + '" data-n="' + h(top.file_name) + '" alt="">' : '') +
        (carryHtml(l)) + l.map(function (f) { return '<div class="rs-ver"><span class="pill">v' + f.version + '</span><button class="rs-file" style="margin:0" data-act="rs-dl" data-p="' + h(f.file_path) + '" data-n="' + h(f.file_name) + '"><span dir="auto">' + h(f.file_name) + ' · ' + fsize(f.file_size) + '</span><span>⬇</span></button><span class="sub">' + h(f.uploader_name || '') + ' · ' + h(fdt(f.created_at)) + '</span>' + (f.note ? '<span class="sub">— ' + h(f.note) + '</span>' : '') + ((f.uploader === me || isSup()) ? '<button class="btn sm bad" data-act="rs-fdel" data-id="' + f.id + '" data-confirm="1" data-confirm-text="' + h(T('تأكيد الحذف؟', 'Delete?')) + '">✕</button>' : '') + cmtBtn(f) + '</div>' + (R.copen === f.id ? cmtPanel(f) : ''); }).join('') + '</div>';
    }).join('');
    return '<div class="card" style="margin:0 0 8px">' + (isMem() ? '<button class="btn pri" data-act="rs-fup">⬆ ' + h(T('رفع ملفات (Word / Excel / PDF / صور)', 'Upload files (Word / Excel / PDF / images)')) + '</button> ' : '') + '<button class="btn" data-act="rs-fcsv" ' + (R.files.length ? '' : 'disabled') + '>⬇ ' + h(T('تصدير قائمة الملفات (Excel)', 'Export file list (Excel)')) + '</button> <button class="btn" data-act="rs-ccsv" ' + (R.cmts.length ? '' : 'disabled') + '>💬⬇ ' + h(T('تصدير ملاحظات المشرف (Excel)', 'Export comments (Excel)')) + '</button> <button class="btn" data-act="rs-cdoc" ' + (R.cmts.length ? '' : 'disabled') + '>💬⬇ ' + h(T('(Word)', '(Word)')) + '</button>' +
      '<div class="sub">' + h(T('رفع ملف بنفس العنوان يُنشئ نسخة جديدة (v2، v3…) وتبقى النسخ القديمة. يمكنك اختيار عدة ملفات دفعة واحدة.', 'Uploading a file with the same title creates a new version. You can select several files at once.')) + '</div><input id="rs-fq" type="search" placeholder="' + h(T('بحث في الملفات…', 'Search files…')) + '" value="' + h(R.fq) + '" style="width:100%;margin-top:6px"></div>' + (groups || '<div class="empty">' + h(T('لا ملفات بعد.', 'No files yet.')) + '</div>');
  }

  /* ---- تعليقات النسخ ---- */
  function cmtsOf(id) { return R.cmts.filter(function (c) { return c.file_id === id; }); }
  function cmtBtn(f) { var l = cmtsOf(f.id), op = l.filter(function (c) { return c.status === 'open'; }).length; return '<button class="btn sm' + (R.copen === f.id ? ' pri' : '') + '" data-act="rs-cmt" data-id="' + f.id + '">💬 ' + h(T('تعليقات', 'Comments')) + ' (' + l.length + ')' + (op ? ' <span class="rs-dot">' + op + '</span>' : '') + '</button>'; }
  function carryHtml(l) {
    if (l.length < 2) return ''; var prev = null, n = 0;
    for (var i = 1; i < l.length; i++) { var o = cmtsOf(l[i].id).filter(function (c) { return c.status === 'open'; }).length; if (o) { n += o; if (!prev) prev = l[i]; } }
    return n ? '<div class="rs-rem" style="margin:6px 0">⚠ ' + h(T('تعليقات مفتوحة من نسخ سابقة: ', 'Open comments on earlier versions: ')) + '<b>' + n + '</b> — ' + h(T('تحقّق هل عُدّلت في النسخة الجديدة.', 'check whether the new version fixes them.')) + ' <button class="btn sm" data-act="rs-cmt" data-id="' + prev.id + '">' + h(T('عرض (v' + prev.version + ')', 'View (v' + prev.version + ')')) + '</button></div>' : '';
  }
  function cmtPanel(f) {
    var me = myId(), l = cmtsOf(f.id);
    var rows = l.map(function (c) {
      var mine = c.author === me, fx = c.status === 'fixed';
      return '<div class="rs-cm' + (fx ? ' fixed' : '') + '"><div class="sub"><b>' + h(c.author_name || '') + '</b>' + (c.place ? ' · 📍 ' + h(c.place) : '') + ' · ' + h(fdt(c.created_at)) + ' · <span class="pill ' + (fx ? 'ok' : 'warn') + '">' + h(fx ? T('تم التعديل', 'Fixed') + (c.fixed_by_name ? ' — ' + c.fixed_by_name : '') : T('مفتوح', 'Open')) + '</span></div><div class="rs-t">' + h(c.body) + '</div><div class="tabs" style="margin-top:4px">' +
        (isMem() && !fx ? '<button class="btn sm" data-act="rs-cfix" data-id="' + c.id + '" data-s="fixed">✓ ' + h(T('تم التعديل', 'Mark fixed')) + '</button>' : '') +
        (fx && (isSup() || mine) ? '<button class="btn sm" data-act="rs-cfix" data-id="' + c.id + '" data-s="open">↩ ' + h(T('إعادة فتح', 'Reopen')) + '</button>' : '') +
        (mine || isSup() ? '<button class="btn sm bad" data-act="rs-cdel" data-id="' + c.id + '" data-confirm="1" data-confirm-text="' + h(T('تأكيد الحذف؟', 'Delete?')) + '">✕</button>' : '') + '</div></div>';
    }).join('');
    var form = isMem() ? '<input id="rs-cm-p" maxlength="120" placeholder="' + h(T('الموضع (اختياري): ص 12، المبحث 2.3…', 'Location (optional): p. 12, section 2.3…')) + '" style="width:100%;margin-top:8px"><textarea id="rs-cm-t" maxlength="2000" placeholder="' + h(isSup() ? T('اكتب ملاحظتك على هذه النسخة…', 'Write your comment on this version…') : T('اكتب ردّك أو تعليقك…', 'Write your reply or comment…')) + '"></textarea><button class="btn pri sm" data-act="rs-cadd" data-id="' + f.id + '">' + h(T('إرسال التعليق', 'Post comment')) + '</button>' : '';
    return '<div class="rs-cp"><b>💬 ' + h(f.title) + ' — v' + f.version + '</b>' + (rows || '<div class="sub" style="margin:6px 0">' + h(T('لا تعليقات على هذه النسخة بعد.', 'No comments on this version yet.')) + '</div>') + form + '</div>';
  }
  function remHtml() {
    if (!R.rem || !R.rem.length) return '';
    var late = R.rem.filter(function (r) { return r.days_left < 0; }), soon = R.rem.filter(function (r) { return r.days_left >= 0; });
    function line(r) { var d = r.days_left; return '<div class="sub">• ' + h(r.student_name || '') + ' — <b>' + h(r.title) + '</b> <span class="pill">' + h(r.group_name) + '</span> ' + (d < 0 ? '<span style="color:#dc2626">⏰ ' + h(T('متأخرة ' + (-d) + ' يوماً', (-d) + ' day(s) late')) + '</span>' : d === 0 ? '<b>' + h(T('اليوم', 'Today')) + '</b>' : h(T('بعد ' + d + ' يوماً', 'in ' + d + ' day(s)'))) + ' · ' + h(fdate(r.due_date)) + '</div>'; }
    return (late.length ? '<div class="rs-rem late"><b>⏰ ' + h(T('مراحل متأخرة', 'Late milestones')) + ' (' + late.length + ')</b>' + late.slice(0, 8).map(line).join('') + '</div>' : '') + (soon.length ? '<div class="rs-rem"><b>⏳ ' + h(T('مواعيد خلال 7 أيام', 'Due within 7 days')) + ' (' + soon.length + ')</b>' + soon.slice(0, 8).map(line).join('') + '</div>' : '');
  }
  function cmtRows() { var st = { open: T('مفتوح', 'Open'), fixed: T('تم التعديل', 'Fixed') }; return R.cmts.map(function (c) { return [c.file_title, 'v' + c.version, c.place || '', c.body, c.author_name || '', new Date(c.created_at).toLocaleString(ar() ? 'ar' : 'en'), st[c.status]]; }); }
  function cmtHead() { return [T('الملف', 'File'), T('النسخة', 'Version'), T('الموضع', 'Location'), T('التعليق', 'Comment'), T('الكاتب', 'Author'), T('التاريخ', 'Date'), T('الحالة', 'Status')]; }

  /* ---- المراحل ---- */
  var STL = { todo: ['لم تبدأ', 'To do'], doing: ['قيد العمل', 'In progress'], review: ['بانتظار المشرف', 'Awaiting supervisor'], done: ['معتمدة', 'Approved'] };
  function msHtml() {
    var by = {}, order = [], td = today();
    R.ms.forEach(function (m) { if (!by[m.student_id]) { by[m.student_id] = { name: m.student_name, list: [] }; order.push(m.student_id); } by[m.student_id].list.push(m); });
    var studs = isSup() ? R.members.filter(function (m) { return m.role === 'student'; }) : R.members.filter(function (m) { return m.user_id === myId(); });
    var cards = studs.map(function (s) {
      var l = (by[s.user_id] || { list: [] }).list, done = l.filter(function (m) { return m.status === 'done'; }).length, late = l.filter(function (m) { return m.status !== 'done' && m.due_date && m.due_date < td; }).length, pc = l.length ? Math.round(done * 100 / l.length) : 0;
      var rows = l.map(function (m, ix) {
        var lateRow = m.status !== 'done' && m.due_date && m.due_date < td;
        var stSel = '<select data-rs="mstat" data-id="' + m.id + '">' + ['todo', 'doing', 'review'].concat(isSup() ? ['done'] : []).map(function (k) { return '<option value="' + k + '"' + (m.status === k ? ' selected' : '') + '>' + STL[k][ar() ? 0 : 1] + '</option>'; }).join('') + '</select>';
        if (m.status === 'done' && !isSup()) stSel = '<span class="rs-st-done">✓ ' + h(STL.done[ar() ? 0 : 1]) + '</span>';
        return '<div class="rs-ms' + (lateRow ? ' late' : '') + '"><div>' + (isSup() ? '<span style="white-space:nowrap"><button class="btn sm" data-act="rs-mmove" data-id="' + m.id + '" data-d="-1" title="' + h(T('أعلى', 'Up')) + '"' + (ix === 0 ? ' disabled' : '') + '>▲</button><button class="btn sm" data-act="rs-mmove" data-id="' + m.id + '" data-d="1" title="' + h(T('أسفل', 'Down')) + '"' + (ix === l.length - 1 ? ' disabled' : '') + '>▼</button></span> ' : '') + '<span class="sub">' + (ix + 1) + '.</span> <b class="rs-st-' + m.status + '">' + h(m.title) + '</b> ' + (isSup() ? '<button class="btn sm" data-act="rs-mdel2" data-id="' + m.id + '" data-confirm="1" data-confirm-text="' + h(T('تأكيد؟', 'Sure?')) + '">✕</button>' : '') +
          '<div class="sub rs-due">' + h(T('الموعد: ', 'Due: ')) + (isSup() ? '<input type="date" data-rs="mdue" data-id="' + m.id + '" value="' + h(m.due_date || '') + '">' : h(fdate(m.due_date))) + (lateRow ? ' ⏰ ' + h(T('متأخرة', 'late')) : (m.status !== 'done' && m.due_date && daysTo(m.due_date) <= 3 ? ' ⏳ ' + h(daysTo(m.due_date) === 0 ? T('اليوم', 'today') : T('بعد ' + daysTo(m.due_date) + ' يوماً', 'in ' + daysTo(m.due_date) + ' day(s)')) : '')) + (m.approved_at ? ' · ✓ ' + h(fdate((m.approved_at || '').slice(0, 10))) : '') + '</div>' +
          (m.sup_note ? '<div class="sub">💬 ' + h(m.sup_note) + '</div>' : '') + '</div><div style="display:flex;gap:4px;align-items:center">' + stSel + (isSup() && m.status !== 'done' ? '<button class="btn sm pri" data-act="rs-mok" data-id="' + m.id + '">✔ ' + h(T('اعتماد', 'Approve')) + '</button>' : '') + '</div></div>';
      }).join('');
      var tools = isSup() ? '<div class="tabs rs-addms" style="margin-top:6px">' + (l.length > 1 ? '<button class="btn sm" data-act="rs-msort" data-u="' + s.user_id + '">⇅ ' + h(T('ترتيب حسب الموعد', 'Sort by due date')) + '</button>' : '') + (l.length ? '' : '<button class="btn sm" data-act="rs-mtpl" data-u="' + s.user_id + '">⚡ ' + h(T('إضافة مراحل رسالة الماجستير الافتراضية', 'Add default thesis milestones')) + '</button>') + '<input id="rs-mt-' + s.user_id + '" placeholder="' + h(T('مرحلة جديدة…', 'New milestone…')) + '" style="flex:1;min-width:140px"><input type="date" id="rs-md-' + s.user_id + '"><button class="btn sm" data-act="rs-madd2" data-u="' + s.user_id + '">+ ' + h(T('إضافة', 'Add')) + '</button></div>' : '';
      return '<div class="card" style="margin:8px 0"><div style="display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap"><b>🎓 ' + h(s.full_name) + '</b><span class="sub">' + done + ' / ' + l.length + ' · ' + pc + '%' + (late ? ' · <span style="color:#dc2626">⏰ ' + late + ' ' + h(T('متأخرة', 'late')) + '</span>' : '') + '</span></div><div class="rs-bar" style="margin:6px 0"><i style="width:' + pc + '%"></i></div>' + rows + tools + '</div>';
    }).join('');
    return '<div class="sub">' + h(isSup() ? T('تابع تقدّم كل طالب، وحدّد الموعد، واعتمد المراحل المنجَزة. الطالب يرى مراحله فقط.', 'Track each student, set due dates and approve finished milestones. Students see only their own.') : T('غيّر حالة مرحلتك عند البدء أو عند جاهزيتها لمراجعة المشرف، والاعتماد النهائي للمشرف.', 'Update your milestone status; the supervisor gives final approval.')) + '</div>' +
      (isSup() && R.ms.length ? '<div class="tabs" style="margin:6px 0"><button class="btn sm" data-act="rs-mcsv">⬇ ' + h(T('تصدير المراحل (Excel)', 'Export milestones (Excel)')) + '</button></div>' : '') + (cards || '<div class="empty">' + h(T('لا طلبة في المجموعة بعد. أضف الطلبة من تبويب الأعضاء بدور «طالب».', 'No students yet. Add students from the Members tab.')) + '</div>');
  }

  /* ───────── ما بعد الرسم ───────── */
  function afterDraw() {
    var box = $q('#rs-msgs'); if (box) box.scrollTop = box.scrollHeight;
    hydrateImgs();
  }
  async function signed(path, name) {
    var c = R.urls[path + '|' + (name || '')]; if (c && Date.now() - c.t < 480000) return c.u;
    var r = await sb().storage.from(BUCKET).createSignedUrl(path, 600, name ? { download: name } : undefined);
    if (r.error) throw new Error(r.error.message); R.urls[path + '|' + (name || '')] = { u: r.data.signedUrl, t: Date.now() }; return r.data.signedUrl;
  }
  function hydrateImgs() {
    document.querySelectorAll('img[data-rs-img]').forEach(function (im) {
      if (im.getAttribute('data-ok')) return; im.setAttribute('data-ok', '1');
      signed(im.getAttribute('data-rs-img')).then(function (u) { im.src = u; }).catch(function () { im.alt = '⚠'; });
    });
  }

  /* ───────── الرفع والتنزيل ───────── */
  function okFile(f) { if (!EXT[fext(f.name)]) return T('نوع غير مسموح: ' + f.name, 'Type not allowed: ' + f.name); if (f.size > MAXB) return T('أكبر من 25 ميغابايت: ' + f.name, 'Over 25 MB: ' + f.name); if (!f.size) return T('ملف فارغ: ' + f.name, 'Empty file: ' + f.name); return ''; }
  function mkPath(prefix, f) { var base = f.name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_{2,}/g, '_').slice(-70); return prefix + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '-' + base; }
  async function upload(prefix, f) {
    var path = mkPath(prefix, f), r = await sb().storage.from(BUCKET).upload(path, f, { contentType: EXT[fext(f.name)] || f.type || 'application/octet-stream', upsert: false });
    if (r.error) throw new Error(T('تعذّر رفع الملف: ', 'Upload failed: ') + r.error.message); return path;
  }
  /* خانة اختيار ملفات ثابتة خارج الواجهة المُعاد رسمها (فلا تضيع الملفات عند التحديث) */
  function pickFiles(multiple, cb) {
    var I = document.getElementById('rs-picker');
    if (!I) { I = document.createElement('input'); I.type = 'file'; I.id = 'rs-picker'; I.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0'; document.body.appendChild(I); }
    I.accept = ACCEPT; I.multiple = !!multiple;
    I.onchange = function () { var fs = [].slice.call(I.files || []); I.value = ''; if (fs.length) cb(fs); };
    I.click();
  }
  async function download(path, name) {
    var u = await signed(path, name), a = document.createElement('a'); a.href = u; a.download = name || ''; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
  }
  function saveBlob(name, blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
  function csvQ(v) { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }
  function csvBlob(rows) { return new Blob(['﻿' + rows.map(function (r) { return r.map(csvQ).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' }); }

  /* ───────── تصدير المحادثة ───────── */
  async function allMsgs() {
    var out = [], before = null;
    for (var i = 0; i < 12; i++) {
      var rows = (await rpc('rs_msgs', { p_thread: R.tid, p_before: before, p_limit: 200 })) || []; if (!rows.length) break;
      out = rows.concat(out); before = rows[rows.length - 1].id; if (rows.length < 200) break;
    }
    return out.filter(function (m) { return !m.deleted; });
  }
  async function exportChat(kind) {
    var ms = await allMsgs(), title = curThreadTitle(), gname = R.g.name, stamp = new Date().toISOString().slice(0, 10);
    if (!ms.length) { R.msg = T('لا رسائل للتصدير', 'No messages to export'); return; }
    if (kind === 'csv') { saveBlob('chat-' + stamp + '.csv', csvBlob([[T('الوقت', 'Time'), T('المرسل', 'Sender'), T('الرسالة', 'Message'), T('الملف المرفق', 'Attachment')]].concat(ms.map(function (m) { return [new Date(m.created_at).toLocaleString(ar() ? 'ar' : 'en'), m.sender_name, m.body, m.file_name || '']; })))); return; }
    var rows = ms.map(function (m) { return '<tr><td style="white-space:nowrap">' + h(new Date(m.created_at).toLocaleString(ar() ? 'ar' : 'en')) + '</td><td><b>' + h(m.sender_name || '') + '</b></td><td>' + h(m.body).replace(/\n/g, '<br>') + (m.file_name ? '<br><i>📎 ' + h(m.file_name) + '</i>' : '') + '</td></tr>'; }).join('');
    var doc = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>' + h(title) + '</title><style>body{font-family:Arial,Tahoma,sans-serif;direction:rtl}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px;vertical-align:top;text-align:right}th{background:#e8eef4}h2{margin:0}</style></head><body dir="rtl"><h2>' + h(gname) + '</h2><p>' + h(title) + ' — ' + h(stamp) + '</p><table><tr><th>' + h(T('الوقت', 'Time')) + '</th><th>' + h(T('المرسل', 'Sender')) + '</th><th>' + h(T('الرسالة', 'Message')) + '</th></tr>' + rows + '</table></body></html>';
    if (kind === 'doc') { saveBlob('chat-' + stamp + '.doc', new Blob(['﻿' + doc], { type: 'application/msword' })); return; }
    var w = window.open('', '_blank'); if (!w) throw new Error(T('اسمح بالنوافذ المنبثقة لتصدير PDF', 'Allow pop-ups to export PDF'));
    w.document.open(); w.document.write(doc.replace('</body>', '<script>setTimeout(function(){window.print()},300)<\/script></body>')); w.document.close();
  }

  /* ───────── الإجراءات ───────── */
  var ACTS = {
    'rs-back': function () { R.g = null; R.msg = ''; go(loadGroups); },
    'rs-open': function (el) { go(function () { return openGroup(el.dataset.id); }); },
    'rs-gnew': function () { R.gform = { name: '', desc: '' }; redraw(); },
    'rs-gcancel': function () { R.gform = null; redraw(); },
    'rs-gsave': function () { var n = (($q('#rs-gname') || {}).value || '').trim(), d = (($q('#rs-gdesc') || {}).value || '').trim(); if (!n) { R.err = T('اكتب اسم المجموعة', 'Enter a name'); return redraw(); } go(async function () { var id = await rpc('rs_group_create', { p_name: n, p_desc: d || null }); R.gform = null; await loadGroups(); await openGroup(id); R.msg = T('أُنشئت المجموعة. أضف الأعضاء من تبويب «الأعضاء».', 'Group created. Add members from the Members tab.'); R.tab = 'members'; }); },
    'rs-gedit': function () { R.gedit = true; redraw(); },
    'rs-gedit-off': function () { R.gedit = false; redraw(); },
    'rs-gupd': function () { var n = (($q('#rs-gname') || {}).value || '').trim(); if (!n) { R.err = T('الاسم مطلوب', 'Name required'); return redraw(); } go(async function () { await rpc('rs_group_update', { p_id: R.g.id, p_name: n, p_desc: (($q('#rs-gdesc') || {}).value || '').trim(), p_archived: !!($q('#rs-garch') || {}).checked }); var id = R.g.id; await loadGroups(); R.g = R.groups.filter(function (g) { return g.id === id; })[0]; R.gedit = false; R.msg = T('حُفظت الإعدادات', 'Saved'); }); },
    'rs-gdel': function () { go(async function () { var paths = (await rpc('rs_group_delete', { p_id: R.g.id })) || []; for (var i = 0; i < paths.length; i += 100) { try { await sb().storage.from(BUCKET).remove(paths.slice(i, i + 100)); } catch (e) {} } R.g = null; await loadGroups(); R.msg = T('حُذفت المجموعة', 'Group deleted'); }); },
    'rs-tab': function (el) { var t = el.dataset.t; go(async function () { R.tab = t; R.msg = ''; if (t === 'files') await loadFiles(); else if (t === 'ms') { await loadMs(); } else if (t === 'chat' && isMem()) { await loadThreads(); await loadMsgs(true); } }); },
    'rs-thread': function (el) { var id = Number(el.dataset.id); if (!id) return; go(async function () { R.tid = id; await loadMsgs(true); await loadThreads(); R.attach = null; }); },
    'rs-dm': function (el) { var u = el.dataset.u; go(async function () { R.tid = await rpc('rs_direct_open', { p_group: R.g.id, p_other: u }); await loadThreads(); await loadMsgs(true); R.attach = null; }); },
    'rs-pick': function () { pickFiles(false, function (fs) { var f = fs[0], e = okFile(f); if (e) { R.err = e; return redraw(); } R.attach = f; R.err = ''; var a = $q('#rs-att'); if (a) a.innerHTML = attHtml(); else redraw(); }); },
    'rs-unattach': function () { R.attach = null; var a = $q('#rs-att'); if (a) a.innerHTML = ''; },
    'rs-send': function () {
      var body = (($q('#rs-text') || {}).value || '').trim(); if (!body && !R.attach) return;
      go(async function () {
        var t = R.threads.filter(function (x) { return x.id === R.tid; })[0] || {}, path = null, f = R.attach;
        if (f) path = await upload(t.kind === 'direct' ? 'd' + R.tid : 'g' + R.g.id, f);
        try { await rpc('rs_msg_send', { p_thread: R.tid, p_body: body, p_path: path, p_name: f ? f.name : null, p_type: f ? (EXT[fext(f.name)] || f.type) : null, p_size: f ? f.size : null }); }
        catch (e) { if (path) { try { await sb().storage.from(BUCKET).remove([path]); } catch (e2) {} } throw e; }
        R.draft = ''; R.attach = null; await loadMsgs(true); await loadThreads();
      });
    },
    'rs-mdel': function (el) { go(async function () { var p = await rpc('rs_msg_delete', { p_id: Number(el.dataset.id) }); if (p) { try { await sb().storage.from(BUCKET).remove([p]); } catch (e) {} } await loadMsgs(false); }); },
    'rs-dl': function (el) { download(el.dataset.p, el.dataset.n).catch(function (e) { R.err = (e && e.message) || String(e); redraw(); }); },
    'rs-exp': function (el) { go(function () { return exportChat(el.dataset.k); }); },
    'rs-madd': function (el) { var u = el.dataset.u; go(async function () { await rpc('rs_member_set', { p_group: R.g.id, p_user: u, p_role: ($q('#rs-fr-' + u) || {}).value || 'student' }); R.members = (await rpc('rs_members_list', { p_group: R.g.id })) || []; R.found = []; var i = $q('#rs-find'); if (i) i.value = ''; }); },
    'rs-mrem': function (el) { var u = el.dataset.u, self = u === myId(); go(async function () { await rpc('rs_member_remove', { p_group: R.g.id, p_user: u }); if (self) { R.g = null; await loadGroups(); } else R.members = (await rpc('rs_members_list', { p_group: R.g.id })) || []; }); },
    'rs-fup': function () {
      pickFiles(true, function (fs) {
        go(async function () {
          var bad = fs.map(okFile).filter(Boolean); if (bad.length) throw new Error(bad.join(' | '));
          var n = 0; for (var i = 0; i < fs.length; i++) { var f = fs[i], path = await upload('g' + R.g.id, f); try { await rpc('rs_file_add', { p_group: R.g.id, p_title: f.name.replace(/\.[^.]+$/, '').slice(0, 200), p_note: null, p_path: path, p_name: f.name, p_type: EXT[fext(f.name)] || f.type, p_size: f.size }); n++; } catch (e) { try { await sb().storage.from(BUCKET).remove([path]); } catch (e2) {} throw e; } }
          await loadFiles(); R.msg = T('رُفع ' + n + ' ملف', n + ' file(s) uploaded');
        });
      });
    },
    'rs-fver': function (el) {
      var title = el.dataset.t;
      pickFiles(false, function (fs) { go(async function () { var f = fs[0], e = okFile(f); if (e) throw new Error(e); var note = window.prompt(T('ملاحظة على هذه النسخة (اختياري):', 'Note for this version (optional):'), '') || null, path = await upload('g' + R.g.id, f); try { await rpc('rs_file_add', { p_group: R.g.id, p_title: title, p_note: note, p_path: path, p_name: f.name, p_type: EXT[fext(f.name)] || f.type, p_size: f.size }); } catch (e2) { try { await sb().storage.from(BUCKET).remove([path]); } catch (e3) {} throw e2; } await loadFiles(); R.msg = T('أُضيفت نسخة جديدة', 'New version added'); }); });
    },
    'rs-fdel': function (el) { go(async function () { var p = await rpc('rs_file_delete', { p_id: Number(el.dataset.id) }); if (p) { try { await sb().storage.from(BUCKET).remove([p]); } catch (e) {} } await loadFiles(); }); },
    'rs-fcsv': function () { saveBlob('research-files.csv', csvBlob([[T('العنوان', 'Title'), T('النسخة', 'Version'), T('اسم الملف', 'File'), T('الحجم KB', 'Size KB'), T('رفعه', 'Uploader'), T('التاريخ', 'Date'), T('ملاحظة', 'Note')]].concat(R.files.map(function (f) { return [f.title, f.version, f.file_name, Math.round((f.file_size || 0) / 1024), f.uploader_name, f.created_at, f.note || '']; })))); },
    'rs-cmt': function (el) { var id = Number(el.dataset.id); R.copen = R.copen === id ? null : id; R.cdraft = ''; R.cplace = ''; redraw(); },
    'rs-cadd': function (el) { var b = (($q('#rs-cm-t') || {}).value || '').trim(), pl = (($q('#rs-cm-p') || {}).value || '').trim(); if (!b) { R.err = T('اكتب التعليق', 'Write a comment'); return redraw(); } go(async function () { await rpc('rs_cmt_add', { p_file: Number(el.dataset.id), p_body: b, p_place: pl || null }); R.cdraft = ''; R.cplace = ''; await loadCmts(); }); },
    'rs-cfix': function (el) { go(async function () { await rpc('rs_cmt_status', { p_id: Number(el.dataset.id), p_status: el.dataset.s }); await loadCmts(); }); },
    'rs-cdel': function (el) { go(async function () { await rpc('rs_cmt_delete', { p_id: Number(el.dataset.id) }); await loadCmts(); }); },
    'rs-ccsv': function () { saveBlob('supervisor-comments.csv', csvBlob([cmtHead()].concat(cmtRows()))); },
    'rs-cdoc': function () {
      var rows = cmtRows().map(function (r) { return '<tr>' + r.map(function (x) { return '<td>' + h(x).replace(/\n/g, '<br>') + '</td>'; }).join('') + '</tr>'; }).join('');
      var doc = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>' + h(R.g.name) + '</title><style>body{font-family:Arial,Tahoma,sans-serif;direction:rtl}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px;vertical-align:top;text-align:right}th{background:#e8eef4}</style></head><body dir="rtl"><h2>' + h(R.g.name) + '</h2><p>' + h(T('ملاحظات المشرف على نسخ الملفات', 'Supervisor comments on file versions')) + ' — ' + h(today()) + '</p><table><tr>' + cmtHead().map(function (x) { return '<th>' + h(x) + '</th>'; }).join('') + '</tr>' + rows + '</table></body></html>';
      saveBlob('supervisor-comments.doc', new Blob(['\ufeff' + doc], { type: 'application/msword' }));
    },
    'rs-mmove': function (el) { go(async function () { await rpc('rs_ms_move', { p_id: Number(el.dataset.id), p_dir: Number(el.dataset.d) }); await loadMs(); }); },
    'rs-msort': function (el) { go(async function () { await rpc('rs_ms_sort_by_date', { p_group: R.g.id, p_student: el.dataset.u }); await loadMs(); }); },
    'rs-mtpl': function (el) { go(async function () { await rpc('rs_ms_template', { p_group: R.g.id, p_student: el.dataset.u }); await loadMs(); }); },
    'rs-madd2': function (el) { var u = el.dataset.u, t = (($q('#rs-mt-' + u) || {}).value || '').trim(), d = ($q('#rs-md-' + u) || {}).value || null; if (!t) { R.err = T('اكتب اسم المرحلة', 'Enter a milestone name'); return redraw(); } go(async function () { await rpc('rs_ms_save', { p_id: null, p_group: R.g.id, p_student: u, p_title: t, p_due: d || null, p_note: null }); await loadMs(); }); },
    'rs-mok': function (el) { var note = window.prompt(T('ملاحظة المشرف على هذه المرحلة (اختياري):', 'Supervisor note (optional):'), ''); if (note === null) return; go(async function () { await rpc('rs_ms_approve', { p_id: Number(el.dataset.id), p_note: note || null }); await loadMs(); }); },
    'rs-mdel2': function (el) { go(async function () { await rpc('rs_ms_delete', { p_id: Number(el.dataset.id) }); await loadMs(); }); },
    'rs-mcsv': function () { var st = { todo: T('لم تبدأ', 'To do'), doing: T('قيد العمل', 'In progress'), review: T('بانتظار المشرف', 'Awaiting'), done: T('معتمدة', 'Approved') }; saveBlob('research-milestones.csv', csvBlob([[T('الطالب', 'Student'), T('المرحلة', 'Milestone'), T('الموعد', 'Due'), T('الحالة', 'Status'), T('تاريخ الاعتماد', 'Approved'), T('ملاحظة المشرف', 'Supervisor note')]].concat(R.ms.map(function (m) { return [m.student_name, m.title, m.due_date || '', st[m.status], m.approved_at ? m.approved_at.slice(0, 10) : '', m.sup_note || '']; })))); }
  };
  window.EXTRA_ACT = Object.assign(window.EXTRA_ACT || {}, ACTS);

  var findT = null;
  document.addEventListener('input', function (e) {
    var t = e.target; if (!t) return;
    if (t.id === 'rs-text') { R.draft = t.value; return; }
    if (t.id === 'rs-cm-t') { R.cdraft = t.value; return; }
    if (t.id === 'rs-cm-p') { R.cplace = t.value; return; }
    if (t.id === 'rs-fq') { R.fq = t.value; var pos = t.selectionStart; var r = root(); if (r) { var hold = t.value; r.innerHTML = html(); var n = $q('#rs-fq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } afterDraw(); } return; }
    if (t.id === 'rs-find') { clearTimeout(findT); var q = t.value.trim(); findT = setTimeout(async function () { if (q.length < 2) { R.found = []; } else { try { R.found = (await rpc('rs_find_people', { p_q: q })) || []; } catch (er) { R.err = er.message; redraw(); return; } } var f = $q('#rs-found'); if (f) f.innerHTML = foundHtml(); }, 300); }
  });
  document.addEventListener('keydown', function (e) { if (e.target && e.target.id === 'rs-text' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ACTS['rs-send'](); } });
  document.addEventListener('change', function (e) {
    var t = e.target, k = t && t.dataset && t.dataset.rs; if (!k) return;
    if (k === 'mrole') go(async function () { await rpc('rs_member_set', { p_group: R.g.id, p_user: t.dataset.u, p_role: t.value }); R.members = (await rpc('rs_members_list', { p_group: R.g.id })) || []; });
    else if (k === 'mstat') go(async function () { await rpc('rs_ms_status', { p_id: Number(t.dataset.id), p_status: t.value }); await loadMs(); });
    else if (k === 'mdue') { var m = R.ms.filter(function (x) { return String(x.id) === t.dataset.id; })[0]; if (m) go(async function () { await rpc('rs_ms_save', { p_id: m.id, p_group: R.g.id, p_student: m.student_id, p_title: m.title, p_due: t.value || null, p_note: m.note || null }); await loadMs(); }); }
  });

  /* ───────── تحديث دوري خفيف (لا يعيد رسم خانة الكتابة) ───────── */
  var polling = null;
  function startPoll() { if (polling) return; polling = setInterval(poll, 7000); }
  async function poll() {
    if (!root() || document.hidden || R.busy) return;
    try {
      if (!R.g) { var before = JSON.stringify(R.groups.map(function (g) { return [g.id, g.unread, g.overdue, g.members]; })); await loadGroups(); if (!R.gform && before !== JSON.stringify(R.groups.map(function (g) { return [g.id, g.unread, g.overdue, g.members]; }))) redraw(); return; }
      if (R.tab !== 'chat' || !isMem() || !R.tid) return;
      var tb = JSON.stringify(R.threads.map(function (t) { return [t.id, t.unread]; })); await loadThreads();
      var rows = ((await rpc('rs_msgs', { p_thread: R.tid, p_before: null, p_limit: 80 })) || []).slice().reverse();
      if (sigOf(rows) !== R.sig) {
        var box = $q('#rs-msgs'), near = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 90;
        R.msgs = rows; R.sig = sigOf(rows); try { await rpc('rs_mark_read', { p_thread: R.tid }); } catch (e) {} await loadThreads();
        if (box) { box.innerHTML = R.msgs.map(msgHtml).join('') || ''; if (near) box.scrollTop = box.scrollHeight; hydrateImgs(); }
      }
      var th = $q('#rs-thr'); if (th && tb !== JSON.stringify(R.threads.map(function (t) { return [t.id, t.unread]; }))) th.innerHTML = thrChips();
    } catch (e) { /* صامت: يُعاد المحاولة في الدورة التالية */ }
  }

  window.RS = { visible: window.rsVisible, parseCsv: csvBlob };
})();
