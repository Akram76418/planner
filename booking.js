/* booking.js: «حجز المحاضرات» (للإدارة): فصول/مساقات، مواضيع، مجموعات بعدد المواضيع، أسماء الطلبة، رابط وتاريخ المحاضرة، تصدير Excel. */
(function () {
  'use strict';
  var PA = function () { return window.PLANNER_AUTH || null; };
  function sb() { return PA() && PA().sb(); }
  function ar() { return PA() ? PA().lang() === 'ar' : true; }
  function T(a, e) { return ar() ? a : e; }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function can() { return !!(window.CAN && window.CAN('book')); }
  function toast_(m) { if (typeof toast === 'function') toast(m); }
  function $q(s) { return document.querySelector(s); }
  function val(id) { var e = $q('#' + id); return e ? e.value : ''; }
  var DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  function fmtDate(d) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? DAYS[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] + ' ' + m[1] + '-' + m[2] + '-' + m[3] : '—'; }
  function norm(s) { return String(s || '').replace(/[ً-ٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function okUrl(u) { return /^https?:\/\/\S+$/i.test(u || ''); }

  var B = { offs: [], off: 0, topics: [], groups: [], loaded: false, busy: false, err: '', msg: '', tab: 'groups', q: '', filt: 'all', edit: null, tEdit: null, offPanel: false, pw: null, closeMsg: '', itop: '', igrp: '' };
  try { B.off = Number(localStorage.getItem('bk_off')) || 0; } catch (e) {}

  window.bookView = function () { return '<div id="bk-root"></div>'; };
  window.bookMount = function () { draw(); if (!B.loaded) load(); };

  function cur() { return B.offs.filter(function (o) { return o.id === B.off; })[0] || null; }
  function topicOf(id) { return B.topics.filter(function (t) { return t.id === id; })[0] || null; }
  function groupOwner(topicId) { return B.groups.filter(function (g) { return g.topic_id === topicId; })[0] || null; }
  function ro() { var o = cur(); return !o || o.archived; }
  function say(m, bad) { B.msg = m || ''; B.msgBad = !!bad; }

  async function load(keepMsg) {
    if (!can() || !sb()) return;
    B.busy = true; B.err = ''; if (!keepMsg) say(''); draw();
    try {
      var o = await sb().from('book_offerings').select('*').order('id', { ascending: false }).limit(500);
      if (o.error) throw o.error;
      B.offs = o.data || [];
      if (!cur()) { var live = B.offs.filter(function (x) { return !x.archived; }); B.off = (live[0] || B.offs[0] || {}).id || 0; }
      try { localStorage.setItem('bk_off', B.off || ''); } catch (e) {}
      B.topics = []; B.groups = [];
      if (B.off) {
        var t = await sb().from('book_topics').select('*').eq('offering_id', B.off).order('no', { ascending: true }).limit(2000); if (t.error) throw t.error;
        var g = await sb().from('book_groups').select('*').eq('offering_id', B.off).order('group_no', { ascending: true }).limit(2000); if (g.error) throw g.error;
        B.topics = t.data || []; B.groups = g.data || [];
      }
      B.loaded = true;
    } catch (e) {
      B.err = (e && e.message) || String(e);
      if (/book_|schema cache|does not exist|relation/i.test(B.err)) B.err += ' — ' + T('شغّل booking.sql في Supabase أولاً.', 'Run booking.sql in Supabase first.');
    }
    B.busy = false; draw();
  }
  function guard(fn) { B.busy = true; B.err = ''; draw(); return Promise.resolve().then(fn).catch(function (e) { B.err = (e && e.message) || String(e); }).then(function () { B.busy = false; draw(); }); }
  function reload() { return load(true); }

  /* ---------- العرض ---------- */
  function offBar() {
    var o = cur(), sems = []; B.offs.forEach(function (x) { if (sems.indexOf(x.semester) < 0) sems.push(x.semester); });
    var sem = o ? o.semester : sems[0];
    var courses = B.offs.filter(function (x) { return x.semester === sem; });
    var taken = B.groups.filter(function (g) { return g.topic_id; }).length, n = B.topics.length;
    return '<div class="card"><h2>' + h(T('حجز المحاضرات', 'Lecture booking')) + '</h2>' +
      (B.offs.length ? '<div class="form"><label>' + h(T('الفصل الدراسي', 'Semester')) + '<select data-bk="sem">' + sems.map(function (s) { return '<option' + (s === sem ? ' selected' : '') + ' value="' + h(s) + '">' + h(s) + '</option>'; }).join('') + '</select></label>' +
        '<label>' + h(T('المساق', 'Course')) + '<select data-bk="crs">' + courses.map(function (c) { return '<option value="' + c.id + '"' + (c.id === B.off ? ' selected' : '') + '>' + h(c.course + (c.archived ? ' — ' + T('مؤرشف', 'archived') : '')) + '</option>'; }).join('') + '</select></label></div>' : '<p class="sub">' + h(T('لا توجد مساقات بعد. أضف أول مساق.', 'No courses yet. Add one.')) + '</p>') +
      (o ? '<div class="sub" style="margin:8px 0 4px">' + h(T('تم حجز ' + taken + ' من ' + n, taken + ' of ' + n + ' booked')) + '</div><div style="height:7px;border-radius:5px;background:rgba(127,127,127,.2)"><div style="height:7px;border-radius:5px;background:var(--accent,#0b8a97);width:' + (n ? Math.round(taken * 100 / n) : 0) + '%"></div></div>' : '') +
      (o ? closeBar(o) : '') +
      (o && o.archived ? '<p class="pill warn" style="margin-top:8px">🗄 ' + h(T('مساق مؤرشف: للعرض فقط. استرجعه من الأرشيف للتعديل.', 'Archived: read-only. Restore it to edit.')) + '</p>' : '') +
      '<div class="tabs" style="margin-top:8px"><button class="btn sm pri" data-act="bk-offpanel">' + h(B.offPanel ? T('إخفاء إدارة المساقات', 'Hide course tools') : T('+ مساق / إدارة المساقات', '+ Course / manage')) + '</button>' +
      (o ? ' <button class="btn sm" data-act="bk-export">⬇ Excel</button> <button class="btn sm bad" data-act="bk-reset" data-confirm="1">' + h(T('تصفير الحجوزات', 'Reset bookings')) + '</button>' : '') + '</div>' +
      (B.offPanel ? offPanel() : '') + '</div>';
  }
  function offPanel() {
    var o = cur(), sems = []; B.offs.forEach(function (x) { if (sems.indexOf(x.semester) < 0) sems.push(x.semester); });
    return '<div class="card" style="margin-top:8px"><b>' + h(T('إضافة مساق في فصل', 'Add a course')) + '</b><div class="form">' +
      '<label>' + h(T('الفصل الدراسي', 'Semester')) + '<input id="bo-sem" list="bo-semlist" placeholder="الفصل الأول 2026-2027" maxlength="80"><datalist id="bo-semlist">' + sems.map(function (s) { return '<option value="' + h(s) + '">'; }).join('') + '</datalist></label>' +
      '<label>' + h(T('اسم المساق', 'Course name')) + '<input id="bo-crs" maxlength="80"></label>' +
      '<label style="grid-column:1/-1">' + h(T('نسخ المواضيع من (اختياري)', 'Copy topics from (optional)')) + '<select id="bo-copy"><option value="">' + h(T('بدون — قائمة فارغة', 'None — empty list')) + '</option>' + B.offs.map(function (x) { return '<option value="' + x.id + '">' + h(x.semester + ' — ' + x.course) + '</option>'; }).join('') + '</select></label></div>' +
      '<button class="btn pri" data-act="bk-offadd">' + h(T('إضافة المساق', 'Add')) + '</button>' +
      (o ? '<hr style="margin:12px 0;border:0;border-top:1px solid rgba(127,127,127,.3)"><b>' + h(T('المساق الحالي', 'Current course')) + '</b><div class="form"><label>' + h(T('الفصل', 'Semester')) + '<input id="bo-rsem" value="' + h(o.semester) + '" maxlength="80"></label><label>' + h(T('المساق', 'Course')) + '<input id="bo-rcrs" value="' + h(o.course) + '" maxlength="80"></label></div>' +
        '<div class="tabs"><button class="btn sm" data-act="bk-offren">' + h(T('حفظ الاسم', 'Save name')) + '</button> <button class="btn sm" data-act="bk-offarc" data-confirm="1">' + h(o.archived ? T('استرجاع من الأرشيف', 'Restore') : T('أرشفة', 'Archive')) + '</button></div>' : '') + '</div>';
  }
  function tabsBar() {
    var t = [['groups', T('المجموعات', 'Groups')], ['topics', T('المواضيع', 'Topics')], ['sched', T('الجدول', 'Schedule')], ['pw', T('كلمات المرور', 'Passwords')], ['imp', T('استيراد', 'Import')]];
    return '<div class="cm-tabs" style="margin:10px 0">' + t.map(function (x) { return '<button class="btn sm' + (B.tab === x[0] ? ' pri' : '') + '" data-act="bk-tab" data-t="' + x[0] + '">' + h(x[1]) + '</button>'; }).join('') + '</div>';
  }
  function groupCard(g) {
    var t = topicOf(g.topic_id), st = g.students || [];
    if (B.edit === g.group_no) return groupForm(g);
    return '<div class="card" style="margin:8px 0"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"><div><b>' + h(T('مجموعة ', 'Group ')) + g.group_no + '</b> <span class="pill ' + (t ? 'ok' : '') + '">' + h(t ? T('محجوزة', 'Booked') : T('بلا موضوع', 'No topic')) + '</span></div>' +
      (ro() ? '' : '<button class="btn sm" data-act="bk-edit" data-n="' + g.group_no + '">' + h(T('تعديل', 'Edit')) + '</button>') + '</div>' +
      (t ? '<div style="margin-top:6px"><b>#' + t.no + '</b> ' + h(t.title) + '</div>' : '') +
      (st.length ? '<div class="sub">' + h(st.join('، ')) + '</div>' : '<div class="sub">' + h(T('لا أسماء بعد', 'No names yet')) + '</div>') +
      '<div class="sub">📅 ' + h(fmtDate(g.lecture_date)) + (g.link ? ' · <a href="' + h(g.link) + '" target="_blank" rel="noopener noreferrer">🔗 ' + h(T('رابط المحاضرة', 'Lecture link')) + '</a>' : '') + '</div></div>';
  }
  function groupForm(g) {
    var free = B.topics.filter(function (t) { var o = groupOwner(t.id); return !o || o.group_no === g.group_no; });
    return '<div class="card" style="margin:8px 0;border:2px solid var(--accent,#0b8a97)"><b>' + h(T('مجموعة ', 'Group ')) + g.group_no + '</b><div class="form">' +
      '<label style="grid-column:1/-1">' + h(T('الموضوع', 'Topic')) + '<select id="bg-topic"><option value="">' + h(T('— بلا موضوع —', '— none —')) + '</option>' + free.map(function (t) { return '<option value="' + t.id + '"' + (t.id === g.topic_id ? ' selected' : '') + '>#' + t.no + ' ' + h(t.title) + '</option>'; }).join('') + '</select></label>' +
      '<label style="grid-column:1/-1">' + h(T('أسماء الطلبة (اسم في كل سطر، حتى 15)', 'Students (one per line, max 15)')) + '<textarea id="bg-names" rows="5">' + h((g.students || []).join('\n')) + '</textarea></label>' +
      '<label>' + h(T('تاريخ المحاضرة', 'Lecture date')) + '<input id="bg-date" type="date" value="' + h(g.lecture_date || '') + '"></label>' +
      '<label>' + h(T('رابط المحاضرة', 'Lecture link')) + '<input id="bg-link" dir="ltr" placeholder="https://…" maxlength="500" value="' + h(g.link || '') + '"></label></div>' +
      '<div class="tabs" style="margin-top:8px"><button class="btn pri" data-act="bk-save" data-n="' + g.group_no + '">' + h(T('حفظ', 'Save')) + '</button><button class="btn" data-act="bk-cancel">' + h(T('إلغاء', 'Cancel')) + '</button></div></div>';
  }
  function groupsPane() {
    var q = norm(B.q);
    var list = B.groups.filter(function (g) {
      var t = topicOf(g.topic_id);
      if (B.filt === 'free' && g.topic_id) return false;
      if (B.filt === 'taken' && !g.topic_id) return false;
      return !q || String(g.group_no) === q || norm((t ? t.title : '') + ' ' + (g.students || []).join(' ')).indexOf(q) >= 0;
    });
    return '<div class="tabs"><input id="bk-q" data-bk="q" placeholder="' + h(T('بحث (مجموعة/موضوع/اسم)…', 'Search…')) + '" value="' + h(B.q) + '" style="max-width:240px"> ' +
      [['all', T('الكل', 'All')], ['free', T('بلا موضوع', 'Unbooked')], ['taken', T('محجوزة', 'Booked')]].map(function (c) { return '<button class="btn sm' + (B.filt === c[0] ? ' pri' : '') + '" data-act="bk-filt" data-f="' + c[0] + '">' + h(c[1]) + '</button>'; }).join(' ') + '</div>' +
      (list.map(groupCard).join('') || '<div class="empty">' + h(T('لا نتائج', 'No results')) + '</div>');
  }
  function topicsPane() {
    var add = ro() ? '' : '<div class="card"><b>' + h(T('إضافة موضوع', 'Add topic')) + '</b> <span class="sub">' + h(T('(تُضاف مجموعة جديدة تلقائياً)', '(a group is added automatically)')) + '</span><div class="form"><label style="grid-column:1/-1">' + h(T('العنوان', 'Title')) + '<input id="bt-title" maxlength="200"></label><label style="grid-column:1/-1">' + h(T('الوصف (اختياري)', 'Description')) + '<textarea id="bt-desc" rows="2" maxlength="1500"></textarea></label></div><button class="btn pri" data-act="bk-tadd">+ ' + h(T('إضافة', 'Add')) + '</button></div>';
    var rows = B.topics.map(function (t) {
      var o = groupOwner(t.id);
      if (B.tEdit === t.id) return '<div class="card" style="margin:8px 0;border:2px solid var(--accent,#0b8a97)"><div class="form"><label style="grid-column:1/-1">' + h(T('العنوان', 'Title')) + '<input id="bt-etitle" value="' + h(t.title) + '" maxlength="200"></label><label style="grid-column:1/-1">' + h(T('الوصف', 'Description')) + '<textarea id="bt-edesc" rows="3" maxlength="1500">' + h(t.descr || '') + '</textarea></label></div><div class="tabs"><button class="btn pri" data-act="bk-tsave" data-id="' + t.id + '">' + h(T('حفظ', 'Save')) + '</button><button class="btn" data-act="bk-tcancel">' + h(T('إلغاء', 'Cancel')) + '</button></div></div>';
      return '<div class="row"><div class="main"><div class="t">#' + t.no + ' ' + h(t.title) + '</div>' + (t.descr ? '<div class="sub">' + h(t.descr) + '</div>' : '') + '<div class="sub">' + (o ? '<span class="pill warn">' + h(T('محجوز — مجموعة ', 'Booked — group ')) + o.group_no + '</span>' : '<span class="pill ok">' + h(T('متاح', 'Free')) + '</span>') + '</div></div>' +
        (ro() ? '' : '<div class="act"><button class="btn sm" data-act="bk-tedit" data-id="' + t.id + '">' + h(T('تعديل', 'Edit')) + '</button> <button class="btn sm bad" data-act="bk-tdel" data-id="' + t.id + '" data-confirm="1">' + h(T('حذف', 'Delete')) + '</button></div>') + '</div>';
    }).join('') || '<div class="empty">' + h(T('لا مواضيع بعد', 'No topics yet')) + '</div>';
    return add + '<div class="list" style="margin-top:8px">' + rows + '</div><p class="sub">' + h(T('حذف موضوع يلغي حجزه، ويعيد ترقيم المواضيع، ويحذف آخر مجموعة (عدد المجموعات = عدد المواضيع).', 'Deleting a topic cancels its booking, renumbers topics and removes the last group (groups = topics).')) + '</p>';
  }
  function schedPane() {
    var rows = B.groups.map(function (g) { var t = topicOf(g.topic_id); return '<tr><td>' + g.group_no + '</td><td>' + h(t ? '#' + t.no + ' ' + t.title : '—') + '</td><td>' + h(fmtDate(g.lecture_date)) + '</td><td>' + (g.students || []).length + '</td></tr>'; }).join('');
    return '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>' + h(T('المجموعة', 'Group')) + '</th><th>' + h(T('الموضوع', 'Topic')) + '</th><th>' + h(T('تاريخ المحاضرة', 'Date')) + '</th><th>' + h(T('عدد الطلبة', 'Students')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function draw() {
    var el = document.getElementById('bk-root'); if (!el) return;
    if (!can()) { el.innerHTML = '<div class="card"><div class="empty">' + h(T('هذه الصفحة للإدارة فقط', 'Admin only')) + '</div></div>'; return; }
    el.innerHTML = offBar() + (B.err ? '<p class="pill bad">' + h(B.err) + '</p>' : '') + (B.msg ? '<p class="pill ' + (B.msgBad ? 'bad' : 'ok') + '">' + h(B.msg) + '</p>' : '') + (B.busy ? '<p class="sub">…</p>' : '') +
      (cur() ? tabsBar() + (B.tab === 'groups' ? groupsPane() : B.tab === 'topics' ? topicsPane() : B.tab === 'pw' ? pwPane() : B.tab === 'imp' ? impPane() : schedPane()) : '');
  }


  /* ---------- إغلاق الحجز + كلمات المرور + رابط الطلبة ---------- */
  function studentUrl() { return location.origin + location.pathname.replace(/[^\/]*$/, '') + 'book.html'; }
  function closeBar(o) {
    return '<div style="margin-top:10px;padding:10px;border-radius:10px;border:1px solid ' + (o.closed ? 'var(--warn,#9a6700)' : 'rgba(127,127,127,.3)') + '">' +
      (o.closed ? '<b>⛔ ' + h(T('الحجز مغلق — الطلبة لا يستطيعون الحجز أو التعديل', 'Booking closed — students cannot book or edit')) + '</b>' + (o.closed_msg ? '<div class="sub">' + h(o.closed_msg) + '</div>' : '') +
        '<div class="tabs" style="margin-top:6px"><button class="btn sm pri" data-act="bk-close" data-v="0" data-confirm="1">✅ ' + h(T('إعادة فتح الحجز', 'Reopen booking')) + '</button></div>'
        : '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><input id="bk-cmsg" maxlength="300" placeholder="' + h(T('رسالة للطلبة عند الإغلاق (اختياري)', 'Message to students (optional)')) + '" value="' + h(B.closeMsg) + '" style="flex:1;min-width:200px"> <button class="btn sm bad" data-act="bk-close" data-v="1" data-confirm="1">⛔ ' + h(T('إيقاف الحجز وإغلاق التعديل', 'Stop booking & lock edits')) + '</button></div>') +
      '<div class="sub" style="margin-top:6px">' + h(T('رابط الطلبة: ', 'Student link: ')) + '<span dir="ltr">' + h(studentUrl()) + '</span> <button class="btn sm" data-act="bk-copy" data-v="' + h(studentUrl()) + '">' + h(T('نسخ', 'Copy')) + '</button></div></div>';
  }
  async function loadPw() {
    var r = await sb().rpc('book_admin_passwords', { p_off: B.off }); if (r.error) throw r.error; B.pw = r.data || [];
  }
  function pwPane() {
    var rows = (B.pw || []).map(function (p) {
      return '<tr><td>' + p.group_no + '</td><td dir="ltr" style="font-family:monospace">' + (p.temp_pw ? h(p.temp_pw) : '<span class="sub">' + h(T('غيّرتها المجموعة', 'changed by group')) + '</span>') + '</td><td>' + (p.locked ? '<span class="pill bad">' + h(T('مقفلة', 'locked')) + '</span>' : '') + '</td>' +
        '<td><button class="btn sm" data-act="bk-pwreset" data-g="' + p.group_id + '" data-confirm="1">' + h(T('إعادة تعيين', 'Reset')) + '</button> ' + (p.temp_pw ? '<button class="btn sm" data-act="bk-copy" data-v="' + h(T('المجموعة ', 'Group ') + p.group_no + T(' — كلمة المرور المؤقتة: ', ' — temp password: ') + p.temp_pw + '\n' + studentUrl()) + '">' + h(T('نسخ الرسالة', 'Copy msg')) + '</button>' : '') + '</td></tr>';
    }).join('');
    return '<p class="sub">' + h(T('لكل مجموعة كلمة مرور مؤقتة من 6 أرقام؛ تُطلب من الطلبة تغييرها عند أول دخول، وعندها تختفي من هنا. 5 محاولات خاطئة = قفل 10 دقائق.', 'Each group gets a temporary 6-digit password; students must change it on first login (it then disappears here). 5 wrong tries = 10-minute lock.')) + '</p>' +
      '<div class="tabs"><button class="btn sm" data-act="bk-pwload">' + h(T('تحديث', 'Refresh')) + '</button> <button class="btn sm" data-act="bk-copyall">' + h(T('نسخ كل الكلمات المؤقتة', 'Copy all temp codes')) + '</button> <button class="btn sm bad" data-act="bk-pwresetall" data-confirm="1">' + h(T('إعادة تعيين الكل', 'Reset all')) + '</button></div>' +
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>' + h(T('المجموعة', 'Group')) + '</th><th>' + h(T('كلمة المرور المؤقتة', 'Temp password')) + '</th><th></th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function copyText(t) { try { navigator.clipboard.writeText(t); toast_(T('تم النسخ', 'Copied')); } catch (e) { window.prompt(T('انسخ:', 'Copy:'), t); } }


  /* ---------- استيراد المواضيع وأسماء المجموعات ---------- */
  function parseTopics(txt) {
    var out = [], seen = {};
    String(txt || '').split(/\r?\n/).forEach(function (ln) {
      ln = ln.trim(); if (!ln) return;
      var p = ln.indexOf('\t') >= 0 ? ln.split('\t') : ln.split('|');
      var t = p[0].replace(/^\s*\d+\s*[-.)–:]\s*/, '').trim().slice(0, 200), d = (p.slice(1).join(' ').trim() || '').slice(0, 1500);
      if (!t || seen[norm(t)]) return; seen[norm(t)] = 1; out.push({ title: t, descr: d || null });
    });
    return out;
  }
  function parseGroups(txt) {
    var map = {}, last = 0, warn = [];
    String(txt || '').split(/\r?\n/).forEach(function (ln) {
      if (!ln.trim()) return;
      var cells = ln.indexOf('\t') >= 0 ? ln.split('\t') : ln.split(/\s*[;|:,]\s*/);
      if (cells.length === 1) { var sm = /^(\d{1,3})\s+(\S.*)$/.exec(ln.trim()); if (sm) cells = [sm[1], sm[2]]; }
      var first = (cells[0] || '').replace(/[٠-٩]/g, function (d) { return d.charCodeAt(0) - 1632; }).trim();
      var m = /^(?:مجموعة|المجموعة|group)?\s*(\d{1,3})$/i.exec(first), rest;
      if (m) { last = Number(m[1]); rest = cells.slice(1); } else if (!first && last) { rest = cells.slice(1); } else if (last && cells.length === 1) { rest = cells; } else { warn.push(ln.trim().slice(0, 40)); return; }
      var names = rest.join('،').split(/[،؛\n]/).map(function (s) { return s.replace(/^\s*\d+\s*[-.)]\s*/, '').trim().slice(0, 80); }).filter(Boolean);
      if (!last) return; map[last] = map[last] || []; names.forEach(function (n) { if (!map[last].some(function (x) { return norm(x) === norm(n); })) map[last].push(n); });
    });
    return { map: map, warn: warn };
  }
  function impSummary() {
    var t = parseTopics(B.itop), g = parseGroups(B.igrp), ks = Object.keys(g.map), names = 0; ks.forEach(function (k) { names += g.map[k].length; });
    return { t: t, g: g, ks: ks, names: names };
  }
  function impPane() {
    if (ro()) return '<p class="pill warn">' + h(T('المساق مؤرشف — لا استيراد.', 'Archived — no import.')) + '</p>';
    var s = impSummary();
    return '<div class="card"><b>1) ' + h(T('استيراد المواضيع', 'Import topics')) + '</b><p class="sub">' + h(T('موضوع في كل سطر (أو الصقها من Excel: العنوان ثم الوصف في عمود آخر، أو افصل بـ |). تُضاف بعد الموجود وتُنشأ مجموعة لكل موضوع جديد، والمكرّر يُتجاهل.', 'One topic per line (or paste from Excel: title, description column, or use |). Appended; one group is created per new topic; duplicates skipped.')) + '</p>' +
      '<textarea id="im-top" data-bk="itop" rows="6" placeholder="الكفاءة المهنية&#10;الموافقة المستنيرة | وصف اختياري">' + h(B.itop) + '</textarea>' +
      '<div class="tabs" style="margin-top:6px"><label class="btn sm">📂 ' + h(T('ملف Excel/CSV', 'Excel/CSV file')) + '<input type="file" accept=".xlsx,.xls,.csv,.txt" data-bk="ftop" hidden></label> <button class="btn sm pri" data-act="bk-imp-topics" data-confirm="1">' + h(T('استيراد المواضيع', 'Import topics')) + '</button> <span class="sub" id="im-tsum">' + h(T('جاهز: ', 'Ready: ') + s.t.length) + '</span></div></div>' +
      '<div class="card"><b>2) ' + h(T('استيراد أسماء المجموعات', 'Import group members')) + '</b><p class="sub">' + h(T('كل سطر: رقم المجموعة ثم الاسم (مفصولان بـ Tab أو فاصلة). الصقه من Excel مباشرة (عمودان: رقم المجموعة | الاسم)؛ تكفي كتابة رقم المجموعة في أول سطر لها. أو: «1: علي، سارة». يستبدل أسماء المجموعات المذكورة فقط. المجموعات تُنشأ بإضافة المواضيع أولاً.', 'Each line: group number then name (Tab/comma separated), or paste two Excel columns. "1: Ali, Sara" also works. Replaces members of the listed groups only. Add topics first so groups exist.')) + '</p>' +
      '<textarea id="im-grp" data-bk="igrp" rows="8" placeholder="1&#9;أحمد علي&#10;&#9;سارة محمد&#10;2&#9;ليلى خالد">' + h(B.igrp) + '</textarea>' +
      '<div class="tabs" style="margin-top:6px"><label class="btn sm">📂 ' + h(T('ملف Excel/CSV', 'Excel/CSV file')) + '<input type="file" accept=".xlsx,.xls,.csv,.txt" data-bk="fgrp" hidden></label> <button class="btn sm pri" data-act="bk-imp-groups" data-confirm="1">' + h(T('استيراد الأسماء', 'Import members')) + '</button> <span class="sub" id="im-gsum">' + h(T('جاهز: ', 'Ready: ') + s.ks.length + T(' مجموعة / ', ' groups / ') + s.names + T(' اسم', ' names')) + '</span></div></div>';
  }
  function parseCsvText(txt) {
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < txt.length; i++) { var c = txt[i];
      if (q) { if (c === '"' && txt[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',' || c === ';') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (c !== '\r') cur += c; }
    row.push(cur); rows.push(row);
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim(); }); }).map(function (r) { return r.join('\t'); }).join('\n');
  }
  async function fileToText(f) {
    if (/\.(xlsx|xls)$/i.test(f.name)) { await loadXlsx(); var wb = XLSX.read(await f.arrayBuffer(), { type: 'array' }); var ws = wb.Sheets[wb.SheetNames[0]]; return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false }).map(function (r) { return r.join('\t'); }).join('\n'); }
    var t = await f.text(); return /\.csv$/i.test(f.name) ? parseCsvText(t) : t;
  }

  /* ---------- تصدير ---------- */
  function exportRows() {
    var rows = [['رقم المجموعة', 'رقم الموضوع', 'عنوان الموضوع', 'اسم الطالب', 'رابط المحاضرة', 'تاريخ المحاضرة']];
    B.groups.forEach(function (g) {
      var t = topicOf(g.topic_id), names = (g.students && g.students.length) ? g.students : [''];
      names.forEach(function (n) { rows.push([g.group_no, t ? t.no : '', t ? t.title : 'لم تحجز موضوعاً بعد', n, g.link || '', g.lecture_date || '']); });
    });
    return rows;
  }
  function saveBlob(name, blob) { var u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); }
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function (res, rej) { var sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; sc.onload = res; sc.onerror = function () { rej(new Error('xlsx')); }; document.head.appendChild(sc); });
  }
  async function doExport() {
    var o = cur(), rows = exportRows(), lab = (o ? o.course + '-' + o.semester : 'booking').replace(/[\\/:*?"<>|\s]+/g, '-'), name = 'حجز-المحاضرات-' + lab + '-' + new Date().toISOString().slice(0, 10);
    try {
      await loadXlsx();
      var ws = window.XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 60 }, { wch: 36 }, { wch: 55 }, { wch: 16 }];
      var wb = window.XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; window.XLSX.utils.book_append_sheet(wb, ws, 'الحجوزات');
      saveBlob(name + '.xlsx', new Blob([window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' }));
    } catch (e) {
      var csv = '﻿' + rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
      saveBlob(name + '.csv', new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    }
  }

  /* ---------- الأوامر ---------- */
  function findG(n) { return B.groups.filter(function (g) { return g.group_no === Number(n); })[0]; }
  var ACTS = {
    'bk-tab': function (el) { B.tab = el.dataset.t; B.edit = null; B.tEdit = null; draw(); if (B.tab === 'pw') guard(loadPw); },
    'bk-close': function (el) { var on = el.dataset.v === '1'; var msg = val('bk-cmsg').trim(); B.closeMsg = '';
      guard(async function () { var r = await sb().rpc('book_admin_set_closed', { p_off: B.off, p_closed: on, p_msg: on ? (msg || null) : null }); if (r.error) throw r.error; say(on ? T('أُوقف الحجز وأُغلق التعديل للطلبة', 'Booking stopped, edits locked') : T('أُعيد فتح الحجز', 'Booking reopened')); await reloadQuiet(); }); },
    'bk-imp-topics': function () {
      var s = impSummary(), have = {}; B.topics.forEach(function (t) { have[norm(t.title)] = 1; });
      var add = s.t.filter(function (t) { return !have[norm(t.title)]; }); if (!add.length) { toast_(T('لا مواضيع جديدة للاستيراد', 'No new topics')); return; }
      guard(async function () { for (var i = 0; i < add.length; i++) { var r = await sb().rpc('book_add_topic', { p_off: B.off, p_title: add[i].title, p_desc: add[i].descr }); if (r.error) throw new Error(T('توقف عند «', 'Stopped at "') + add[i].title + '»: ' + r.error.message); }
        B.itop = ''; say(T('أُضيف ' + add.length + ' موضوعاً ومجموعاتها', add.length + ' topics added')); await reloadQuiet(); });
    },
    'bk-imp-groups': function () {
      var s = impSummary(); if (!s.ks.length) { toast_(T('لا أسماء للاستيراد', 'Nothing to import')); return; }
      var miss = s.ks.filter(function (k) { return !findG(k); }); var ok = s.ks.filter(function (k) { return !!findG(k); });
      var seen = {}, dup = []; ok.forEach(function (k) { s.g.map[k].forEach(function (n) { var x = norm(n); if (seen[x] && seen[x] !== k) dup.push(n); seen[x] = k; }); });
      if (dup.length) { B.err = T('اسم مكرر في أكثر من مجموعة: ', 'Name in several groups: ') + dup.slice(0, 5).join('، '); draw(); return; }
      guard(async function () { var n = 0;
        for (var i = 0; i < ok.length; i++) { var names = s.g.map[ok[i]].slice(0, 15), g = findG(ok[i]); var r = await sb().from('book_groups').update({ students: names }).eq('id', g.id); if (r.error) throw r.error; n++; }
        B.igrp = ''; say(T('حُدّثت أسماء ' + n + ' مجموعة', n + ' groups updated') + (miss.length ? T(' — غير موجودة (أضف مواضيع أولاً): ', ' — missing: ') + miss.join('، ') : '') + (s.g.warn.length ? T(' — أسطر تُجوهلت: ', ' — skipped lines: ') + s.g.warn.length : '')); await reloadQuiet(); });
    },
    'bk-copy': function (el) { copyText(el.dataset.v); },
    'bk-pwload': function () { guard(loadPw); },
    'bk-pwreset': function (el) { var g = Number(el.dataset.g); guard(async function () { var r = await sb().rpc('book_admin_reset_pw', { p_group: g, p_off: null }); if (r.error) throw r.error; await loadPw(); say(T('أُعيّنت كلمة مرور مؤقتة جديدة', 'New temporary password set')); }); },
    'bk-pwresetall': function () { guard(async function () { var r = await sb().rpc('book_admin_reset_pw', { p_group: null, p_off: B.off }); if (r.error) throw r.error; await loadPw(); say(T('أُعيّنت كلمات مرور جديدة لكل المجموعات', 'All passwords reset')); }); },
    'bk-copyall': function () { copyText((B.pw || []).filter(function (p) { return p.temp_pw; }).map(function (p) { return T('المجموعة ', 'Group ') + p.group_no + ': ' + p.temp_pw; }).join('\n')); },
    'bk-filt': function (el) { B.filt = el.dataset.f; draw(); },
    'bk-offpanel': function () { B.offPanel = !B.offPanel; draw(); },
    'bk-export': function () { doExport(); },
    'bk-edit': function (el) { B.edit = Number(el.dataset.n); draw(); },
    'bk-cancel': function () { B.edit = null; draw(); },
    'bk-save': function (el) {
      var n = Number(el.dataset.n), g = findG(n); if (!g) return;
      var topic = val('bg-topic') ? Number(val('bg-topic')) : null, link = val('bg-link').trim(), date = val('bg-date') || null;
      var names = val('bg-names').split(/\r?\n/).map(function (s) { return s.trim().slice(0, 80); }).filter(Boolean);
      if (names.length > 15) { toast_(T('الحد الأقصى 15 طالباً', 'Max 15 students')); return; }
      var seen = {};
      for (var i = 0; i < names.length; i++) { var k = norm(names[i]); if (seen[k]) { toast_(T('الاسم مكرر داخل المجموعة: ' + names[i], 'Duplicate in group: ' + names[i])); return; } seen[k] = 1; }
      for (var j = 0; j < names.length; j++) {
        var k2 = norm(names[j]), other = B.groups.filter(function (x) { return x.group_no !== n && (x.students || []).some(function (s) { return norm(s) === k2; }); })[0];
        if (other) { toast_(T('الاسم «' + names[j] + '» مسجّل في المجموعة ' + other.group_no, '"' + names[j] + '" is already in group ' + other.group_no)); return; }
      }
      if (link && !okUrl(link)) { toast_(T('الرابط غير صالح: يبدأ بـ http:// أو https:// بلا مسافات', 'Invalid link')); return; }
      if (link && !topic) { toast_(T('اختر موضوعاً أولاً ثم أضف الرابط', 'Pick a topic before adding a link')); return; }
      var row = { topic_id: topic, students: names, link: link || null, lecture_date: date, booked_at: topic ? (g.topic_id === topic && g.booked_at ? g.booked_at : new Date().toISOString()) : null };
      guard(async function () { var r = await sb().from('book_groups').update(row).eq('id', g.id); if (r.error) throw r.error; B.edit = null; say(T('تم الحفظ', 'Saved')); await reloadQuiet(); });
    },
    'bk-tadd': function () {
      var title = val('bt-title').trim(); if (!title) { toast_(T('اكتب العنوان', 'Enter a title')); return; }
      guard(async function () { var r = await sb().rpc('book_add_topic', { p_off: B.off, p_title: title, p_desc: val('bt-desc').trim() || null }); if (r.error) throw r.error; say(T('أُضيف الموضوع ومجموعة جديدة', 'Topic and group added')); await reloadQuiet(); });
    },
    'bk-tedit': function (el) { B.tEdit = Number(el.dataset.id); draw(); },
    'bk-tcancel': function () { B.tEdit = null; draw(); },
    'bk-tsave': function (el) {
      var title = val('bt-etitle').trim(); if (!title) { toast_(T('اكتب العنوان', 'Enter a title')); return; }
      guard(async function () { var r = await sb().from('book_topics').update({ title: title, descr: val('bt-edesc').trim() || null }).eq('id', Number(el.dataset.id)); if (r.error) throw r.error; B.tEdit = null; say(T('تم الحفظ', 'Saved')); await reloadQuiet(); });
    },
    'bk-tdel': function (el) {
      var id = Number(el.dataset.id), last = B.groups[B.groups.length - 1];
      if (last && ((last.students || []).length || last.topic_id) && !window.confirm(T('سيُحذف أيضاً آخر مجموعة (رقم ' + last.group_no + ') بما فيها من حجز وأسماء لأن عدد المجموعات = عدد المواضيع. متابعة؟', 'The last group (' + last.group_no + ') will also be deleted with its data. Continue?'))) return;
      guard(async function () { var r = await sb().rpc('book_delete_topic', { p_topic: id }); if (r.error) throw r.error; say(T('حُذف الموضوع وأُعيد الترقيم', 'Deleted and renumbered')); await reloadQuiet(); });
    },
    'bk-reset': function () { guard(async function () { var r = await sb().rpc('book_reset', { p_off: B.off }); if (r.error) throw r.error; say(T('مُسحت الحجوزات والأسماء والروابط (التواريخ محفوظة)', 'Bookings cleared (dates kept)')); await reloadQuiet(); }); },
    'bk-offadd': function () {
      var s = val('bo-sem').trim(), c = val('bo-crs').trim(); if (!s || !c) { toast_(T('اكتب الفصل واسم المساق', 'Enter semester and course')); return; }
      guard(async function () { var r = await sb().rpc('book_add_offering', { p_semester: s, p_course: c, p_copy: val('bo-copy') ? Number(val('bo-copy')) : null }); if (r.error) throw r.error; B.off = Number(r.data); B.offPanel = false; say(T('أُضيف المساق', 'Course added')); await reloadQuiet(); });
    },
    'bk-offren': function () {
      var s = val('bo-rsem').trim(), c = val('bo-rcrs').trim(); if (!s || !c) { toast_(T('اكتب الفصل واسم المساق', 'Enter semester and course')); return; }
      guard(async function () { var r = await sb().from('book_offerings').update({ semester: s, course: c }).eq('id', B.off); if (r.error) throw r.error; say(T('تم حفظ الاسم', 'Saved')); await reloadQuiet(); });
    },
    'bk-offarc': function () { var o = cur(); if (!o) return; guard(async function () { var r = await sb().from('book_offerings').update({ archived: !o.archived }).eq('id', o.id); if (r.error) throw r.error; say(o.archived ? T('استُرجع المساق', 'Restored') : T('أُرشف المساق', 'Archived')); await reloadQuiet(); }); }
  };
  async function reloadQuiet() {
    var o = await sb().from('book_offerings').select('*').order('id', { ascending: false }).limit(500); if (o.error) throw o.error; B.offs = o.data || [];
    if (!cur()) B.off = (B.offs[0] || {}).id || 0;
    try { localStorage.setItem('bk_off', B.off || ''); } catch (e) {}
    B.topics = []; B.groups = [];
    if (B.off) {
      var t = await sb().from('book_topics').select('*').eq('offering_id', B.off).order('no', { ascending: true }).limit(2000); if (t.error) throw t.error;
      var g = await sb().from('book_groups').select('*').eq('offering_id', B.off).order('group_no', { ascending: true }).limit(2000); if (g.error) throw g.error;
      B.topics = t.data || []; B.groups = g.data || [];
    }
  }
  document.addEventListener('change', function (e) {
    var k = e.target && e.target.dataset && e.target.dataset.bk; if (!k) return;
    if (k === 'sem') { var list = B.offs.filter(function (o) { return o.semester === e.target.value; }); if (list[0]) { B.off = list[0].id; B.edit = null; B.tEdit = null; load(); } }
    else if (k === 'crs') { B.off = Number(e.target.value); B.edit = null; B.tEdit = null; load(); }
  });
  document.addEventListener('input', function (e) { if (e.target && e.target.dataset && e.target.dataset.bk === 'q') { B.q = e.target.value; var pos = e.target.selectionStart; draw(); var q = document.getElementById('bk-q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} } } });

  document.addEventListener('input', function (e) {
    var k = e.target && e.target.dataset && e.target.dataset.bk; if (k !== 'itop' && k !== 'igrp') return;
    B[k] = e.target.value; var s = impSummary(), a = document.getElementById('im-tsum'), c = document.getElementById('im-gsum');
    if (a) a.textContent = T('جاهز: ', 'Ready: ') + s.t.length; if (c) c.textContent = T('جاهز: ', 'Ready: ') + s.ks.length + T(' مجموعة / ', ' groups / ') + s.names + T(' اسم', ' names');
  });
  document.addEventListener('change', function (e) {
    var k = e.target && e.target.dataset && e.target.dataset.bk; if (k !== 'ftop' && k !== 'fgrp') return;
    var f = e.target.files && e.target.files[0]; if (!f) return;
    fileToText(f).then(function (t) { if (k === 'ftop') B.itop = t; else B.igrp = t; e.target.value = ''; draw(); }).catch(function () { B.err = T('تعذّر قراءة الملف', 'Could not read file'); draw(); });
  });
  window.EXTRA_ACT = window.EXTRA_ACT || {};
  Object.keys(ACTS).forEach(function (k) { window.EXTRA_ACT[k] = ACTS[k]; });
})();
