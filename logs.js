/* logs.js: سجل الدخول والأخطاء (للمدير) + مسح كل المراسلات (الإعدادات) + تسجيل أخطاء التطبيق. */
(function () {
  'use strict';
  var PA = function () { return window.PLANNER_AUTH || null; };
  function sb() { return PA() && PA().sb(); }
  function ar() { return PA() ? PA().lang() === 'ar' : true; }
  function T(a, e) { return ar() ? a : e; }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isAdmin() { return window.CTX && window.CTX.role === 'admin'; }
  function toast_(m) { if (typeof toast === 'function') toast(m); }

  /* ---------- تسجيل أخطاء التطبيق (للمستخدم المسجَّل فقط، بحد أقصى) ---------- */
  var sent = {}, count = 0;
  function logError(msg) {
    try {
      msg = String(msg || '').slice(0, 400);
      if (!msg || /ResizeObserver|Script error/i.test(msg) || sent[msg] || count >= 10) return;
      var a = PA(); if (!a || !a.user() || !navigator.onLine) return;
      sent[msg] = 1; count++;
      a.sb().rpc('comm_log_event', { p_kind: 'error', p_msg: msg, p_ua: navigator.userAgent }).then(function () {}, function () {});
    } catch (e) {}
  }
  window.addEventListener('error', function (e) { logError((e.message || 'error') + (e.filename ? ' @' + String(e.filename).split('/').pop() + ':' + (e.lineno || 0) : '')); });
  window.addEventListener('unhandledrejection', function (e) { var r = e.reason; logError('promise: ' + ((r && (r.message || r)) || '')); });

  /* ---------- شاشة السجلات ---------- */
  var L = { kind: '', rows: [], err: '', busy: false };
  var KIND = { login: ['دخول', 'Login', 'ok'], login_fail: ['فشل دخول', 'Failed login', 'bad'], logout: ['خروج', 'Logout', ''], error: ['خطأ في التطبيق', 'App error', 'bad'], wipe: ['مسح المراسلات', 'Messages wiped', 'warn'], admin: ['إدارة', 'Admin', ''] };
  window.logsView = function () { return '<div id="lg-root"></div>'; };
  window.logsMount = function () { draw(); load(); };
  function fmt(d) { try { var x = new Date(d); return x.toLocaleDateString(ar() ? 'ar' : 'en', { month: 'short', day: 'numeric' }) + ' ' + x.toLocaleTimeString(ar() ? 'ar' : 'en', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  async function load() {
    if (!isAdmin() || !sb()) return;
    L.busy = true; L.err = ''; draw();
    try { var r = await sb().rpc('comm_list_logs', { p_kind: L.kind || null, p_limit: 300 }); if (r.error) throw r.error; L.rows = r.data || []; }
    catch (e) { L.err = (e && e.message) || String(e); if (/comm_list_logs|schema cache|does not exist/i.test(L.err)) L.err += ' — ' + T('شغّل admin-tools.sql في Supabase أولاً.', 'Run admin-tools.sql in Supabase first.'); }
    L.busy = false; draw();
  }
  function draw() {
    var el = document.getElementById('lg-root'); if (!el) return;
    if (!isAdmin()) { el.innerHTML = ''; return; }
    var chips = [['', T('الكل', 'All')], ['login', T('دخول', 'Login')], ['login_fail', T('فشل دخول', 'Failed')], ['error', T('أخطاء التطبيق', 'App errors')], ['logout', T('خروج', 'Logout')], ['wipe', T('مسح', 'Wipe')]];
    el.innerHTML = '<div class="card"><h2>' + h(T('سجل الدخول ومشاكل التطبيق', 'Sign-in & app log')) + '</h2>' +
      '<p class="sub">' + h(T('آخر 300 حدث. يُحذف ما يزيد عمره على 90 يوماً تلقائياً. لا تُسجَّل كلمات المرور.', 'Last 300 events. Entries older than 90 days are removed automatically. Passwords are never logged.')) + '</p>' +
      '<div class="cm-tabs">' + chips.map(function (c) { return '<button class="btn sm' + (L.kind === c[0] ? ' pri' : '') + '" data-act="lg-kind" data-k="' + c[0] + '">' + h(c[1]) + '</button>'; }).join('') +
      ' <button class="btn sm" data-act="lg-refresh">⟳ ' + h(T('تحديث', 'Refresh')) + '</button> <button class="btn sm" data-act="lg-csv">⬇ CSV</button> <button class="btn sm bad" data-act="lg-clear" data-confirm="1">' + h(T('مسح السجل', 'Clear log')) + '</button></div>' +
      (L.err ? '<p class="pill bad">' + h(L.err) + '</p>' : '') + (L.busy ? '<p class="sub">…</p>' : '') +
      '<div class="list">' + (L.rows.map(function (r) {
        var k = KIND[r.kind] || [r.kind, r.kind, ''];
        var who = r.full_name ? r.full_name + (r.university_id ? ' · ' + r.university_id : '') : (r.who || '—');
        return '<div class="row"><div class="main"><div class="t"><span class="pill ' + k[2] + '">' + h(k[ar() ? 0 : 1]) + '</span> ' + h(who) + '</div><div class="sub">' + h(fmt(r.ts)) + (r.msg ? ' · ' + h(r.msg) : '') + (r.ua ? ' · ' + h(shortUa(r.ua)) : '') + '</div></div></div>';
      }).join('') || '<div class="empty">' + h(T('لا أحداث', 'No events')) + '</div>') + '</div></div>';
  }
  function shortUa(u) { var os = /Android/i.test(u) ? 'Android' : /iPhone|iPad/i.test(u) ? 'iOS' : /Windows/i.test(u) ? 'Windows' : /Mac/i.test(u) ? 'Mac' : /Linux/i.test(u) ? 'Linux' : ''; var br = /Edg\//.test(u) ? 'Edge' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : /Firefox\//.test(u) ? 'Firefox' : ''; return (os + ' ' + br).trim(); }
  function csv() {
    var rows = [['الوقت', 'النوع', 'المستخدم', 'الرقم', 'التفاصيل', 'الجهاز']].concat(L.rows.map(function (r) { return [r.ts, (KIND[r.kind] || [r.kind])[0], r.full_name || r.who || '', r.university_id || '', r.msg || '', r.ua || '']; }));
    var s = '﻿' + rows.map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); return /[",\n\r]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n');
    var u = URL.createObjectURL(new Blob([s], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a'); a.href = u; a.download = 'app-log-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }

  /* ---------- الإعدادات: مسح كل المراسلات (للمدير) ---------- */
  window.adminToolsSection = function () {
    if (!isAdmin()) return '';
    return '<section class="card" style="grid-column:1/-1;border:1px solid var(--bad,#c0392b)"><h2>' + h(T('إرجاع التواصل إلى البداية', 'Reset messaging to a clean start')) + '</h2>' +
      '<p class="sub">' + h(T('يمسح نهائياً كل المحادثات والرسائل وقنوات الموظفين وإعلانات الشعب والملفات المرفقة عند الجميع. الحسابات والشعب وبيانات المخطط الشخصية تبقى كما هي. لا يمكن التراجع، فخذ نسخة احتياطية أولاً إن لزم.', 'Permanently deletes all chats, messages, staff channels, cohort announcements and attachments for everyone. Accounts, cohorts and personal planner data stay. This cannot be undone.')) + '</p>' +
      '<button class="btn bad" data-act="lg-wipe">' + h(T('مسح كل المراسلات عند الجميع', 'Delete all messages for everyone')) + '</button></section>';
  };

  var ACTS = {
    'lg-kind': function (el) { L.kind = el.dataset.k || ''; load(); },
    'lg-refresh': function () { load(); },
    'lg-csv': function () { csv(); },
    'lg-clear': async function () { try { var r = await sb().rpc('comm_clear_logs'); if (r.error) throw r.error; L.rows = []; draw(); toast_(T('تم مسح السجل', 'Log cleared')); } catch (e) { L.err = e.message; draw(); } },
    'lg-wipe': async function () {
      try {
        var c = await sb().rpc('comm_wipe_counts'); if (c.error) throw c.error; var n = c.data || {};
        var w = window.prompt(T('سيُمسح نهائياً عند الجميع:\n• ' + n.conversations + ' محادثة (' + n.messages + ' رسالة)\n• ' + n.channel + ' رسالة في قنوات الموظفين\n• ' + n.announcements + ' إعلان شعب\n• كل الملفات المرفقة\n\nالحسابات تبقى. لا يمكن التراجع.\n\nللتأكيد اكتب: مسح الكل',
          'Permanently deletes for everyone:\n• ' + n.conversations + ' chats (' + n.messages + ' messages)\n• ' + n.channel + ' staff-channel messages\n• ' + n.announcements + ' announcements\n• all attachments\n\nAccounts stay. Cannot be undone.\n\nTo confirm type: wipe all'));
        if (!w || ['مسح الكل', 'wipe all'].indexOf(w.trim().toLowerCase()) < 0) return;
        toast_(T('جارٍ المسح…', 'Wiping…'));
        var r = await sb().functions.invoke(((window.PLANNER_CONFIG || {}).ADMIN_FN || 'admin-accounts'), { body: { action: 'wipe' } });
        if (r.error || (r.data && r.data.error)) throw new Error((r.data && r.data.error) || r.error.message);
        window.alert(T('تم المسح: ' + r.data.counts.messages + ' رسالة، ' + r.data.counts.conversations + ' محادثة، ' + (r.data.files || 0) + ' ملف.', 'Done: ' + r.data.counts.messages + ' messages, ' + r.data.counts.conversations + ' chats, ' + (r.data.files || 0) + ' files.'));
      } catch (e) { window.alert(T('تعذّر المسح: ', 'Wipe failed: ') + ((e && e.message) || e) + (/comm_wipe|schema cache|does not exist/i.test((e && e.message) || '') ? T(' — شغّل admin-tools.sql أولاً.', ' — run admin-tools.sql first.') : '')); }
    }
  };
  window.EXTRA_ACT = window.EXTRA_ACT || {};
  Object.keys(ACTS).forEach(function (k) { window.EXTRA_ACT[k] = ACTS[k]; });
})();
