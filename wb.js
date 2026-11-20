/* wb.js: «ويبنار»: جدولة وتسجيل وحضور وأسئلة واستطلاعات وتقييم وشهادات، ومسجّل صوت/صورة للطلبة (تنزيل أو إرسال للمحاضر).
   البث نفسه عبر رابط خارجي (Zoom/Meet/Teams/Jitsi) يظهر للمسجّلين عند الموعد. تعتمد على supabase/webinar.sql. */
(function () {
  'use strict';
  var BUCKET = 'webinar-files', MAXB = 60 * 1024 * 1024, MAXSEC = 14400;
  var P = function () { return window.PLANNER_AUTH || null; };
  function sb() { return P() && P().sb(); }
  function ar() { return P() ? P().lang() === 'ar' : true; }
  function T(a, e) { return ar() ? a : e; }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $q(s) { return document.querySelector(s); }
  function myId() { return ((P() && P().user()) || {}).id; }
  function role() { return (window.CTX || {}).role; }
  function canCreate() { return role() === 'professor' || (role() === 'admin' && !!window.CAN && window.CAN('wb')); }
  async function rpc(n, a) { var r = await sb().rpc(n, a || {}); if (r.error) throw new Error(r.error.message); return r.data; }
  function fsize(b) { b = Number(b) || 0; return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function fdt(iso) { if (!iso) return ''; try { return new Date(iso).toLocaleString(ar() ? 'ar' : 'en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } }
  function fshort(iso) { if (!iso) return ''; try { return new Date(iso).toLocaleString(ar() ? 'ar' : 'en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } }
  function p2(n) { return String(n).padStart(2, '0'); }
  function toLocalInput(d) { d = new Date(d); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function stamp() { var d = new Date(); return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()); }
  function saveBlob(name, blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
  function csvQ(v) { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }
  function csvBlob(rows) { return new Blob(['﻿' + rows.map(function (r) { return r.map(csvQ).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' }); }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }

  var css = document.createElement('style');
  css.textContent = '.wb-card{border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin:10px 0;background:var(--surface)}.wb-card.live{border-color:#16a34a;box-shadow:0 0 0 2px rgba(22,163,74,.15)}.wb-card.cancel{opacity:.6}' +
    '.wb-h{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.wb-h b{font-size:16px}.wb-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.wb-t{white-space:pre-wrap;line-height:1.7}' +
    '.wb-q{padding:8px 0;border-top:1px dashed var(--line)}.wb-q:first-child{border-top:0}.wb-bar{height:10px;background:rgba(127,127,127,.2);border-radius:99px;overflow:hidden;margin:3px 0}.wb-bar i{display:block;height:100%;background:var(--accent,#0b8a97)}' +
    '.wb-stars button{font-size:22px;background:none;border:0;cursor:pointer;opacity:.35}.wb-stars button.on{opacity:1}.wb-form{display:grid;gap:8px}.wb-form label{display:grid;gap:3px;font-size:13px}.wb-form input,.wb-form textarea,.wb-form select{width:100%}' +
    '#wb-recbox{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:12px}#wb-recbox .box{background:var(--bg,#fff);color:var(--fg,inherit);border-radius:16px;width:min(560px,100%);max-height:94vh;overflow:auto;padding:14px}' +
    '#wb-recbox .box{font-size:13px}#wb-recbox .pill{white-space:normal;text-align:start}#wb-recbox.mini{inset:auto;bottom:12px;inset-inline-end:12px;background:none;padding:0;display:block;width:auto;height:auto}#wb-recbox.mini .box{width:270px;padding:10px;box-shadow:0 6px 24px rgba(0,0,0,.45);pointer-events:auto}#wb-recbox video{width:100%;max-height:46vh;background:#000;border-radius:10px;display:block}#wb-recbox .rdot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#dc2626;margin-inline-end:6px;animation:wbp 1s infinite}@keyframes wbp{50%{opacity:.25}}' +
    '#wb-cert{position:fixed;inset:0;z-index:95;background:rgba(0,0,0,.65);overflow:auto;padding:12px}#wb-cert .bar{display:flex;gap:8px;justify-content:center;margin-bottom:10px;flex-wrap:wrap}' +
    '.wb-cr{background:#fff;color:#111;width:min(900px,100%);margin:0 auto;padding:34px 40px;border:10px double #0b6e78;text-align:center;box-sizing:border-box;font-family:Tahoma,Arial,sans-serif}.wb-cr h1{margin:8px 0;font-size:34px;color:#0b6e78}.wb-cr .nm{font-size:30px;font-weight:700;margin:14px 0;border-bottom:2px solid #999;display:inline-block;padding:0 24px}.wb-cr p{font-size:18px;line-height:2;margin:6px 0}.wb-cr .sg{display:flex;justify-content:space-around;margin-top:34px;font-size:15px}.wb-cr .sg div{border-top:1px solid #333;padding-top:6px;min-width:180px}' +
    '@media print{body>*:not(#wb-cert){display:none!important}#wb-cert{position:static!important;background:#fff!important;padding:0!important}#wb-cert .bar{display:none!important}@page{size:landscape;margin:8mm}}';
  document.head.appendChild(css);

  var W = { loaded: false, ev: [], id: null, tab: 'info', q: [], polls: [], att: [], fb: [], recs: [], form: null, cohorts: null, busy: false, err: '', msg: '', qd: '', qanon: false, pq: '', po: '', fbr: 0, fbc: '', urls: {}, play: null };

  window.wbVisible = function () { return !!role(); };
  window.wbView = function () { return '<div id="wb-root"></div>'; };
  window.wbMount = function () { redraw(); if (!W.loaded && !W.busy) go(loadEvents); startPoll(); };
  function root() { return $q('#wb-root'); }
  function redraw() {
    var r = root(); if (!r) return;
    var a = $q('#wb-q-t'), b = $q('#wb-fbc'), c = $q('#wb-po'), d = $q('#wb-pq');
    r.innerHTML = html();
    if ($q('#wb-q-t')) $q('#wb-q-t').value = W.qd; if ($q('#wb-fbc')) $q('#wb-fbc').value = W.fbc; if ($q('#wb-po')) $q('#wb-po').value = W.po; if ($q('#wb-pq')) $q('#wb-pq').value = W.pq;
  }
  async function go(fn) {
    W.busy = true; W.err = ''; try { await fn(); } catch (e) { W.err = (e && e.message) || String(e); if (/wb_|function|schema cache/i.test(W.err)) W.err += ' — ' + T('شغّل webinar.sql في Supabase أولاً.', 'Run webinar.sql in Supabase first.'); }
    W.busy = false; redraw();
  }

  /* ───────── تحميل ───────── */
  async function loadEvents() { W.ev = (await rpc('wb_list')) || []; W.loaded = true; }
  function cur() { return W.ev.filter(function (e) { return e.id === W.id; })[0]; }
  function isMgr(e) { return !!(e && e.is_mgr); }
  async function loadTab() {
    var e = cur(); if (!e) return;
    if (W.tab === 'qa') W.q = (await rpc('wb_q_list', { p_id: e.id })) || [];
    else if (W.tab === 'polls') W.polls = (await rpc('wb_poll_list', { p_id: e.id })) || [];
    else if (W.tab === 'att') W.att = (await rpc('wb_attendees', { p_id: e.id })) || [];
    else if (W.tab === 'fb' && isMgr(e)) W.fb = (await rpc('wb_fb_list', { p_id: e.id })) || [];
    else if (W.tab === 'rec') W.recs = (await rpc('wb_rec_list', { p_event: e.id })) || [];
  }
  function status(e) {
    if (e.cancelled) return 'cancel';
    var now = Date.now(), s = new Date(e.starts_at).getTime(), en = s + e.duration_min * 60000;
    return now < s ? 'soon' : now <= en ? 'live' : 'past';
  }
  function pill(e) {
    var s = status(e), M = { cancel: ['bad', T('ملغي', 'Cancelled')], soon: ['warn', T('قريباً', 'Upcoming')], live: ['ok', T('🔴 مباشر الآن', '🔴 Live now')], past: ['', T('انتهى', 'Ended')] }[s];
    return '<span class="pill ' + M[0] + '">' + h(M[1]) + '</span>';
  }

  /* ───────── العرض ───────── */
  function html() {
    var msg = (W.err ? '<div class="pill bad" style="display:block;margin:8px 0">' + h(W.err) + '</div>' : '') + (W.msg ? '<div class="pill ok" style="display:block;margin:8px 0">' + W.msg + '</div>' : '');
    if (W.form) return msg + formHtml();
    if (W.id && cur()) return msg + eventHtml(cur());
    return msg + listHtml();
  }
  function listHtml() {
    var up = W.ev.filter(function (e) { return status(e) === 'soon' || status(e) === 'live'; }).sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });
    var past = W.ev.filter(function (e) { return up.indexOf(e) < 0; });
    return '<div class="wb-h" style="margin:4px 0 8px"><h2 style="margin:0">🎥 ' + h(T('ويبنار', 'Webinars')) + '</h2><span style="flex:1"></span>' +
      (canCreate() ? '<button class="btn pri" data-act="wb-new">＋ ' + h(T('ويبنار جديد', 'New webinar')) + '</button>' : '') +
      '<button class="btn" data-act="wb-rec-open">🎙 ' + h(T('مسجّل صوت وصورة', 'Audio/video recorder')) + '</button><button class="btn" data-act="wb-refresh">⟳</button></div>' +
      (W.loaded ? '' : '<div class="sub">' + h(T('جارٍ التحميل…', 'Loading…')) + '</div>') +
      (up.length ? '<h3 style="margin:12px 0 0">' + h(T('القادمة والمباشرة', 'Upcoming & live')) + '</h3>' + up.map(card).join('') : (W.loaded ? '<div class="empty">' + h(T('لا ويبنارات قادمة.', 'No upcoming webinars.')) + '</div>' : '')) +
      (past.length ? '<h3 style="margin:16px 0 0">' + h(T('السابقة', 'Past')) + '</h3>' + past.map(card).join('') : '');
  }
  function regBtns(e) {
    var s = status(e), out = '';
    if (s === 'cancel' || s === 'past') return '';
    if (e.link_open) out += '<button class="btn pri" data-act="wb-join" data-id="' + e.id + '">🎥 ' + h(T('انضمام الآن', 'Join now')) + '</button>';
    if (!e.registered) out += '<button class="btn' + (e.link_open ? '' : ' pri') + '" data-act="wb-reg" data-id="' + e.id + '">✅ ' + h(T('سجّلني', 'Register me')) + '</button>';
    else if (!e.joined) out += '<button class="btn sm" data-act="wb-unreg" data-id="' + e.id + '">' + h(T('إلغاء تسجيلي', 'Cancel my registration')) + '</button>';
    return out;
  }
  function card(e) {
    var s = status(e);
    return '<div class="wb-card ' + s + '"><div class="wb-h"><b>' + h(e.title) + '</b> ' + pill(e) + (e.registered ? ' <span class="pill ok">✓ ' + h(T('مسجّل', 'Registered')) + '</span>' : '') + (e.joined ? ' <span class="pill">' + h(T('حضرتَ', 'Attended')) + '</span>' : '') + '</div>' +
      '<div class="sub" style="margin-top:4px">' + (e.speaker ? '🎤 ' + h(e.speaker) + ' · ' : '') + '🗓 ' + h(fdt(e.starts_at)) + ' · ⏱ ' + e.duration_min + ' ' + h(T('دقيقة', 'min')) + '</div>' +
      (isMgr(e) ? '<div class="sub">👥 ' + e.regs + ' ' + h(T('مسجّل', 'registered')) + ' · ✔ ' + e.attended + ' ' + h(T('حضر', 'attended')) + ' · ❓ ' + e.questions + '</div>' : '') +
      '<div class="wb-row">' + regBtns(e) + '<button class="btn" data-act="wb-open" data-id="' + e.id + '">' + h(T('التفاصيل', 'Details')) + '</button></div></div>';
  }
  function eventHtml(e) {
    var tabs = [['info', 'ℹ ' + T('التفاصيل', 'Details')], ['qa', '❓ ' + T('الأسئلة', 'Q&A')], ['polls', '📊 ' + T('الاستطلاعات', 'Polls')], ['rec', '🎙 ' + T('تسجيلات', 'Recordings')], ['fb', '⭐ ' + T('التقييم', 'Feedback')]];
    if (isMgr(e)) tabs.push(['att', '👥 ' + T('الحضور', 'Attendance')]);
    var body = '';
    if (W.tab === 'info') body = infoTab(e); else if (W.tab === 'qa') body = qaTab(e); else if (W.tab === 'polls') body = pollsTab(e);
    else if (W.tab === 'rec') body = recTab(e); else if (W.tab === 'fb') body = fbTab(e); else if (W.tab === 'att') body = attTab(e);
    return '<div class="wb-h"><button class="btn sm" data-act="wb-back">← ' + h(T('كل الويبنارات', 'All webinars')) + '</button><b style="font-size:17px">' + h(e.title) + '</b> ' + pill(e) + '</div>' +
      '<div class="tabs" style="margin:10px 0">' + tabs.map(function (t) { return '<button class="btn sm' + (W.tab === t[0] ? ' pri' : '') + '" data-act="wb-tab" data-t="' + t[0] + '">' + h(t[1]) + '</button>'; }).join('') + '</div>' + body;
  }
  function infoTab(e) {
    var aud = [];
    if (e.aud_students) aud.push(T('كل الطلبة', 'All students')); if (e.aud_staff) aud.push(T('الموظفون وأعضاء هيئة التدريس', 'Staff & faculty'));
    (e.cohort_ids || []).forEach(function (id) { var c = (W.cohorts || []).filter(function (x) { return x.id === id; })[0]; aud.push(c ? c.name : T('شعبة #', 'Cohort #') + id); });
    return '<div class="wb-card"><div class="sub">' + (e.speaker ? '🎤 ' + h(e.speaker) + '<br>' : '') + '🗓 ' + h(fdt(e.starts_at)) + ' · ⏱ ' + e.duration_min + ' ' + h(T('دقيقة', 'min')) + (e.creator_name ? '<br>👤 ' + h(T('المنظّم: ', 'Organizer: ')) + h(e.creator_name) : '') + (isMgr(e) && aud.length ? '<br>🎯 ' + h(aud.join('، ')) : '') + '</div>' +
      (e.descr ? '<p class="wb-t">' + h(e.descr) + '</p>' : '') +
      (e.link_open ? '' : '<div class="sub">' + h(T('رابط البث يظهر قبل الموعد بـ 15 دقيقة للمسجّلين.', 'The join link appears 15 minutes before start for registered people.')) + '</div>') +
      '<div class="wb-row">' + regBtns(e) +
      (safeUrl(e.materials_url) ? '<a class="btn" target="_blank" rel="noopener" href="' + h(e.materials_url) + '">📎 ' + h(T('المرفقات', 'Materials')) + '</a>' : '') +
      (safeUrl(e.record_url) ? '<a class="btn" target="_blank" rel="noopener" href="' + h(e.record_url) + '">▶ ' + h(T('تسجيل الجلسة', 'Session recording')) + '</a>' : '') +
      (e.joined ? '<button class="btn" data-act="wb-cert" data-id="' + e.id + '">🎓 ' + h(T('شهادة الحضور', 'Attendance certificate')) + '</button>' : '') + '</div>' +
      (isMgr(e) ? '<div class="wb-row" style="border-top:1px dashed var(--line);padding-top:8px"><button class="btn sm" data-act="wb-edit" data-id="' + e.id + '">✎ ' + h(T('تعديل', 'Edit')) + '</button><button class="btn sm" data-act="wb-cancel" data-id="' + e.id + '" data-on="' + (e.cancelled ? 0 : 1) + '">' + h(e.cancelled ? T('استعادة', 'Restore') : T('إلغاء الويبنار', 'Cancel webinar')) + '</button><button class="btn sm bad" data-act="wb-del" data-id="' + e.id + '" data-confirm="1" data-confirm-text="' + h(T('تأكيد حذف الويبنار وكل بياناته؟', 'Delete webinar and all its data?')) + '">✕ ' + h(T('حذف', 'Delete')) + '</button></div>' : '') + '</div>';
  }

  /* ── الأسئلة ── */
  function qList() {
    return W.q.map(function (q) {
      return '<div class="wb-q"><div class="wb-t">' + h(q.body) + '</div><div class="sub">' + (q.author ? h(q.author) + ' · ' : '') + h(fshort(q.created_at)) + '</div>' +
        (q.answer ? '<div class="wb-t" style="margin-top:4px;padding:6px 10px;border-inline-start:3px solid var(--accent,#0b8a97)">💬 ' + h(q.answer) + '</div>' : '') +
        '<div class="wb-row" style="margin-top:4px"><button class="btn sm' + (q.voted ? ' pri' : '') + '" data-act="wb-qvote" data-id="' + q.id + '">👍 ' + q.votes + '</button>' +
        (isMgr(cur()) ? '<button class="btn sm" data-act="wb-qans" data-id="' + q.id + '">' + h(q.answer ? T('تعديل الجواب', 'Edit answer') : T('إجابة', 'Answer')) + '</button>' : '') +
        (q.mine || isMgr(cur()) ? '<button class="btn sm bad" data-act="wb-qdel" data-id="' + q.id + '" data-confirm="1">✕</button>' : '') + '</div></div>';
    }).join('') || '<div class="empty">' + h(T('لا أسئلة بعد.', 'No questions yet.')) + '</div>';
  }
  function qaTab(e) {
    return '<div class="wb-card"><div class="wb-form"><label>' + h(T('اطرح سؤالك للمتحدث', 'Ask the speaker')) + '<textarea id="wb-q-t" maxlength="1000" rows="3"></textarea></label>' +
      '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="wb-q-anon" style="width:auto"' + (W.qanon ? ' checked' : '') + '> ' + h(T('بلا اسم (لا يراه المشاركون، ويراه المنظّم)', 'Anonymous (hidden from attendees, visible to organizer)')) + '</label>' +
      '<div><button class="btn pri" data-act="wb-qadd">' + h(T('إرسال السؤال', 'Send question')) + '</button></div></div></div><div class="wb-card" id="wb-live">' + qList() + '</div>';
  }

  /* ── الاستطلاعات ── */
  function pollList() {
    var e = cur();
    return W.polls.map(function (p) {
      var tot = Number(p.total) || 0;
      return '<div class="wb-q"><b>' + h(p.question) + '</b>' + (p.closed ? ' <span class="pill">' + h(T('مغلق', 'Closed')) + '</span>' : '') +
        p.options.map(function (o, i) { var c = (p.counts || [])[i] || 0, pc = tot ? Math.round(c * 100 / tot) : 0; return '<div style="margin-top:6px"><div class="wb-h" style="justify-content:space-between"><span>' + (p.closed ? '' : '<button class="btn sm' + (p.my_vote === i ? ' pri' : '') + '" data-act="wb-pvote" data-id="' + p.id + '" data-o="' + i + '">' + (p.my_vote === i ? '✓' : '○') + '</button> ') + h(o) + '</span><span class="sub">' + c + ' · ' + pc + '%</span></div><div class="wb-bar"><i style="width:' + pc + '%"></i></div></div>'; }).join('') +
        '<div class="sub">' + tot + ' ' + h(T('صوت', 'votes')) + '</div>' +
        (isMgr(e) ? '<div class="wb-row"><button class="btn sm" data-act="wb-pclose" data-id="' + p.id + '" data-on="' + (p.closed ? 0 : 1) + '">' + h(p.closed ? T('فتح', 'Reopen') : T('إغلاق', 'Close')) + '</button><button class="btn sm bad" data-act="wb-pdel" data-id="' + p.id + '" data-confirm="1">✕</button></div>' : '') + '</div>';
    }).join('') || '<div class="empty">' + h(T('لا استطلاعات.', 'No polls.')) + '</div>';
  }
  function pollsTab(e) {
    return (isMgr(e) ? '<div class="wb-card"><div class="wb-form"><label>' + h(T('سؤال الاستطلاع', 'Poll question')) + '<input id="wb-pq" maxlength="300"></label><label>' + h(T('الخيارات (سطر لكل خيار، من 2 إلى 8)', 'Options (one per line, 2–8)')) + '<textarea id="wb-po" rows="4"></textarea></label><div><button class="btn pri" data-act="wb-padd">' + h(T('إطلاق الاستطلاع', 'Launch poll')) + '</button></div></div></div>' : '') +
      '<div class="wb-card" id="wb-live">' + pollList() + '</div>';
  }

  /* ── التسجيلات ── */
  function recTab(e) {
    var can = e.allow_recordings || isMgr(e);
    return '<div class="wb-card"><div class="sub">' + h(can ? T('سجّل صوتاً وصورة أو شاشة العرض (بلا حد زمني) ونزّله على جهازك، أو أرسل المقاطع القصيرة (حتى 60 ميغابايت) إلى المنظّم.', 'Record audio/video or your screen (no time limit) and download it, or send short clips (≤60 MB) to the organizer.') : T('هذا الويبنار لا يستقبل تسجيلات، ويمكنك التسجيل للتنزيل على جهازك فقط.', 'This webinar does not accept submissions; you can record for download only.')) + '</div>' +
      '<div class="wb-row"><button class="btn pri" data-act="wb-rec-open" data-ev="' + (can ? e.id : '') + '">🎙 ' + h(T('تسجيل جديد', 'New recording')) + '</button></div></div>' +
      '<div class="wb-card">' + (W.recs.map(function (r) {
        return '<div class="wb-q"><b>' + h(r.file_name) + '</b> <span class="sub">' + (isMgr(e) && r.author ? h(r.author) + ' · ' : '') + fsize(r.size_bytes) + ' · ' + (r.seconds || 0) + h(T('ث', 's')) + ' · ' + h(fshort(r.created_at)) + '</span>' +
          (W.play === r.id && W.urls[r.id] ? '<' + (/^audio/.test(r.mime || '') ? 'audio' : 'video') + ' controls playsinline src="' + h(W.urls[r.id]) + '" style="width:100%;margin-top:6px;border-radius:8px"></' + (/^audio/.test(r.mime || '') ? 'audio' : 'video') + '>' : '') +
          '<div class="wb-row"><button class="btn sm" data-act="wb-rplay" data-id="' + r.id + '" data-p="' + h(r.file_path) + '">▶ ' + h(T('مشاهدة', 'Play')) + '</button><button class="btn sm" data-act="wb-rdl" data-p="' + h(r.file_path) + '" data-n="' + h(r.file_name) + '">⬇ ' + h(T('تنزيل', 'Download')) + '</button>' +
          (r.mine || isMgr(e) ? '<button class="btn sm bad" data-act="wb-rdel" data-id="' + r.id + '" data-confirm="1">✕</button>' : '') + '</div></div>';
      }).join('') || '<div class="empty">' + h(T('لا تسجيلات مرسلة.', 'No submitted recordings.')) + '</div>') + '</div>';
  }

  /* ── التقييم ── */
  function fbTab(e) {
    var mine = '';
    if (e.registered) {
      var r = W.fbr || e.my_rating || 0;
      mine = '<div class="wb-card"><b>' + h(T('قيّم الويبنار', 'Rate this webinar')) + '</b><div class="wb-stars">' + [1, 2, 3, 4, 5].map(function (i) { return '<button data-act="wb-star" data-r="' + i + '" class="' + (i <= r ? 'on' : '') + '">★</button>'; }).join('') + '</div><textarea id="wb-fbc" rows="3" maxlength="1000" placeholder="' + h(T('ملاحظاتك (اختياري)', 'Comments (optional)')) + '" style="width:100%"></textarea><div class="wb-row"><button class="btn pri" data-act="wb-fbsave"' + (r ? '' : ' disabled') + '>' + h(T('حفظ التقييم', 'Save rating')) + '</button></div></div>';
    } else mine = '<div class="sub">' + h(T('التقييم للمسجّلين في الويبنار.', 'Rating is for registered people.')) + '</div>';
    var res = '';
    if (isMgr(e)) {
      var n = W.fb.length, avg = n ? (W.fb.reduce(function (s, x) { return s + x.rating; }, 0) / n).toFixed(1) : '—';
      res = '<div class="wb-card"><b>' + h(T('نتائج التقييم', 'Results')) + '</b> · ★ ' + avg + ' (' + n + ')' + W.fb.filter(function (x) { return x.comment; }).map(function (x) { return '<div class="wb-q"><span>' + '★'.repeat(x.rating) + '</span> <span class="wb-t">' + h(x.comment) + '</span></div>'; }).join('') + '</div>';
    }
    return mine + res;
  }

  /* ── الحضور ── */
  function attTab(e) {
    var att = W.att.filter(function (a) { return a.joined_at; }).length;
    return '<div class="wb-card"><div class="wb-h"><b>👥 ' + W.att.length + ' ' + h(T('مسجّل', 'registered')) + ' · ✔ ' + att + ' ' + h(T('حاضر', 'attended')) + '</b><span style="flex:1"></span><button class="btn sm" data-act="wb-acsv">⬇ ' + h(T('تصدير الحضور (Excel)', 'Export (Excel)')) + '</button></div>' +
      '<div class="sub">' + h(T('يُسجَّل الحضور عند ضغط «انضمام» من التطبيق. ومن دخل Zoom مباشرة تؤكد حضوره يدوياً بالزر.', 'Attendance is recorded when people press “Join” in the app. Confirm others manually.')) + '</div>' +
      W.att.map(function (a) { return '<div class="wb-q wb-h" style="justify-content:space-between"><span>' + (a.joined_at ? '✔ ' : '○ ') + h(a.full_name || '') + ' <span class="sub">' + h(a.university_id || '') + ' · ' + h(a.acct_role || '') + (a.joined_at ? ' · ' + h(fshort(a.joined_at)) : '') + '</span></span><button class="btn sm' + (a.joined_at ? '' : ' pri') + '" data-act="wb-att" data-u="' + h(a.user_id) + '" data-on="' + (a.joined_at ? 0 : 1) + '">' + h(a.joined_at ? T('إلغاء الحضور', 'Unmark') : T('تأكيد الحضور', 'Mark attended')) + '</button></div>'; }).join('') + '</div>';
  }

  /* ── نموذج الإنشاء/التعديل ── */
  function formHtml() {
    var f = W.form, ck = function (k, t) { return '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" style="width:auto" data-wbf="' + k + '"' + (f[k] ? ' checked' : '') + '> ' + h(t) + '</label>'; };
    return '<div class="wb-card"><h3 style="margin:0 0 8px">' + h(f.id ? T('تعديل الويبنار', 'Edit webinar') : T('ويبنار جديد', 'New webinar')) + '</h3><div class="wb-form">' +
      '<label>' + h(T('العنوان *', 'Title *')) + '<input data-wbf="title" value="' + h(f.title) + '" maxlength="200"></label>' +
      '<label>' + h(T('المتحدث', 'Speaker')) + '<input data-wbf="speaker" value="' + h(f.speaker) + '" maxlength="200"></label>' +
      '<label>' + h(T('الوصف', 'Description')) + '<textarea data-wbf="descr" rows="3" maxlength="4000">' + h(f.descr) + '</textarea></label>' +
      '<label>' + h(T('الموعد *', 'Date & time *')) + '<input type="datetime-local" data-wbf="start" value="' + h(f.start) + '"></label>' +
      '<label>' + h(T('المدة (دقيقة)', 'Duration (min)')) + '<input type="number" min="5" max="720" data-wbf="dur" value="' + h(f.dur) + '"></label>' +
      '<label>' + h(T('رابط البث (Zoom / Meet / Teams / Jitsi)', 'Join link (Zoom / Meet / Teams / Jitsi)')) + '<input dir="ltr" data-wbf="link" value="' + h(f.link) + '" placeholder="https://"></label>' +
      '<div><b style="font-size:13px">' + h(T('الجمهور', 'Audience')) + '</b>' + ck('students', T('كل الطلبة (طلبة الكلية)', 'All college students')) + ck('staff', T('الموظفون وأعضاء هيئة التدريس', 'Staff & faculty')) +
      ((W.cohorts || []).length ? '<div class="sub" style="margin-top:4px">' + h(T('شعب محددة (تشمل الخارجية):', 'Specific cohorts (incl. external):')) + '</div>' + W.cohorts.map(function (c) { return '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" style="width:auto" data-wbc="' + c.id + '"' + (f.cohorts.indexOf(c.id) > -1 ? ' checked' : '') + '> ' + h(c.name) + (c.is_external ? ' 🌐' : '') + '</label>'; }).join('') : '') + '</div>' +
      '<label>' + h(T('رابط المرفقات (اختياري)', 'Materials link (optional)')) + '<input dir="ltr" data-wbf="materials" value="' + h(f.materials) + '" placeholder="https://"></label>' +
      '<label>' + h(T('رابط تسجيل الجلسة بعد انتهائها (اختياري)', 'Recording link after the session (optional)')) + '<input dir="ltr" data-wbf="record" value="' + h(f.record) + '" placeholder="https://"></label>' +
      ck('allowRec', T('السماح للمشاركين بإرسال تسجيلات صوت/صورة إليّ', 'Let participants send me audio/video recordings')) +
      '<div class="wb-row"><button class="btn pri" data-act="wb-save">' + h(T('حفظ', 'Save')) + '</button><button class="btn" data-act="wb-fcancel">' + h(T('إلغاء', 'Cancel')) + '</button></div></div></div>';
  }
  function newForm(e) {
    var d = new Date(Date.now() + 86400000); d.setMinutes(0, 0, 0);
    return e ? { id: e.id, title: e.title, speaker: e.speaker || '', descr: e.descr || '', start: toLocalInput(e.starts_at), dur: e.duration_min, link: e.link || '', students: !!e.aud_students, staff: !!e.aud_staff, cohorts: (e.cohort_ids || []).slice(), materials: e.materials_url || '', record: e.record_url || '', allowRec: !!e.allow_recordings }
      : { id: null, title: '', speaker: '', descr: '', start: toLocalInput(d), dur: 60, link: '', students: true, staff: false, cohorts: [], materials: '', record: '', allowRec: false };
  }
  async function loadCohorts() {
    if (W.cohorts) return;
    try { var api = window.COMM_API; W.cohorts = ((api && (await api.rpc('comm_list_cohorts'))) || []).filter(function (c) { return c.is_active !== false; }); } catch (e) { W.cohorts = []; }
  }

  /* ───────── المسجّل (صوت/صورة): بلا حد زمني، إيقاف مؤقت، حفظ احتياطي في الجهاز ───────── */
  var REC = { ev: null, mode: 'cam', stream: null, extra: [], mr: null, chunks: [], blob: null, url: null, timer: null, secs: 0, state: 'idle', msg: '', ext: 'webm', mime: '', audio: false, saved: false, rescue: 0, lock: null, pip: null };
  function idb() { return new Promise(function (res, rej) { try { var r = indexedDB.open('wb-rec', 1); r.onupgradeneeded = function () { r.result.createObjectStore('c', { autoIncrement: true }); r.result.createObjectStore('m'); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; } catch (e) { rej(e); } }); }
  function idbDo(store, mode, fn) { return idb().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction(store, mode), out = fn(tx); tx.oncomplete = function () { res(out && out.result); db.close(); }; tx.onerror = tx.onabort = function () { rej(tx.error); db.close(); }; }); }); }
  function idbAdd(b) { return idbDo('c', 'readwrite', function (tx) { tx.objectStore('c').add(b); }).catch(function () {}); }
  function idbMeta() { return idbDo('m', 'readwrite', function (tx) { tx.objectStore('m').put({ type: REC.mime, ext: REC.ext, audio: REC.audio, secs: REC.secs }, 'meta'); }).catch(function () {}); }
  function idbClear() { return idb().then(function (db) { var tx = db.transaction(['c', 'm'], 'readwrite'); tx.objectStore('c').clear(); tx.objectStore('m').clear(); tx.oncomplete = function () { db.close(); }; }).catch(function () {}); }
  function idbLoad() { return idb().then(function (db) { return new Promise(function (res) { var tx = db.transaction(['c', 'm'], 'readonly'), c = tx.objectStore('c').getAll(), m = tx.objectStore('m').get('meta'); tx.oncomplete = function () { db.close(); res({ chunks: c.result || [], meta: m.result || null }); }; tx.onerror = function () { res({ chunks: [], meta: null }); }; }); }).catch(function () { return { chunks: [], meta: null }; }); }
  function pickMime(audioOnly) {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    var c = audioOnly ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'] : ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (var i = 0; i < c.length; i++) { try { if (MediaRecorder.isTypeSupported(c[i])) return c[i]; } catch (e) {} }
    return '';
  }
  function extOf(type, audio) { return /mp4/.test(type) ? (audio ? 'm4a' : 'mp4') : /ogg/.test(type) ? 'ogg' : 'webm'; }
  function tmStr() { return p2(Math.floor(REC.secs / 3600)) + ':' + p2(Math.floor(REC.secs / 60) % 60) + ':' + p2(REC.secs % 60); }
  function recOpen(ev) {
    recCleanup(true); REC.ev = ev || null; REC.mode = 'cam'; REC.state = 'idle'; REC.msg = ''; REC.saved = false; REC.rescue = 0;
    var b = document.getElementById('wb-recbox'); if (b) b.remove();
    b = document.createElement('div'); b.id = 'wb-recbox'; b.dir = ar() ? 'rtl' : 'ltr';
    b.innerHTML = '<div class="box"><div class="wb-h" style="justify-content:space-between"><b>🎙 ' + h(T('مسجّل صوت وصورة', 'Audio/video recorder')) + '</b><button class="btn sm" data-act="wb-rec-close">✕</button></div><video id="wb-rv" playsinline></video><div id="wb-rc"></div></div>';
    document.body.appendChild(b); recRender();
    idbLoad().then(function (d) { if (REC.state === 'idle' && d.chunks.length && d.meta) { REC.rescue = d.chunks.reduce(function (s, x) { return s + x.size; }, 0); recRender(); } });
  }
  function recCleanup(full) {
    clearInterval(REC.timer); REC.timer = null;
    try { if (REC.mr && REC.mr.state !== 'inactive') { REC.mr.onstop = null; REC.mr.stop(); } } catch (e) {}
    [REC.stream].concat(REC.extra || []).forEach(function (s) { try { s && s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} });
    REC.stream = null; REC.extra = []; REC.mr = null;
    try { if (REC.lock) { REC.lock.release(); REC.lock = null; } } catch (e) {}
    try { if (REC.pip) { REC.pip.close(); REC.pip = null; } } catch (e) {}
    window.onbeforeunload = null;
    if (full) { if (REC.url) { try { URL.revokeObjectURL(REC.url); } catch (e) {} } REC.url = null; REC.blob = null; REC.chunks = []; REC.secs = 0; }
  }
  function recClose() {
    if ((REC.state === 'recording' || REC.state === 'paused') && !window.confirm(T('التسجيل جارٍ وسيُنهى الآن. متابعة؟', 'Recording is in progress and will end. Continue?'))) return;
    if (REC.state === 'recording' || REC.state === 'paused') { var keep = REC.mr; try { REC.mr && (REC.mr.onstop = null); } catch (e) {} }
    if (REC.state === 'done' && !REC.saved && !window.confirm(T('لم تنزّل التسجيل ولم ترسله. إغلاق الآن؟ (تبقى نسخة احتياطية في هذا الجهاز لاسترجاعها)', 'Not downloaded or sent yet. Close? (A backup copy stays on this device for recovery)'))) return;
    if (REC.saved) idbClear();
    recCleanup(true); var b = document.getElementById('wb-recbox'); if (b) b.remove();
  }
  function ctrlBtns() {
    var P = REC.state === 'paused';
    return '<div class="wb-row" style="margin-top:10px"><button class="btn' + (P ? ' pri' : '') + '" style="font-size:17px;padding:10px 18px" data-act="wb-rec-pause">' + (P ? '▶ ' + h(T('استئناف', 'Resume')) : '⏸ ' + h(T('إيقاف مؤقت', 'Pause'))) + '</button><button class="btn bad" style="font-size:17px;padding:10px 18px" data-act="wb-rec-stop">⏹ ' + h(T('إنهاء وحفظ', 'Finish & save')) + '</button></div>';
  }
  function recRender() {
    var c = document.getElementById('wb-rc'); if (!c) return;
    var v = document.getElementById('wb-rv'), S = REC.state, audioOnly = REC.mode === 'audio';
    var mini = REC.mode === 'screen' && (S === 'recording' || S === 'paused'), bx = document.getElementById('wb-recbox'); if (bx) bx.classList.toggle('mini', mini);
    if (v) { if (S === 'ready' || ((S === 'recording' || S === 'paused') && !mini)) { if (v.srcObject !== REC.stream) v.srcObject = REC.stream; v.muted = true; v.controls = false; v.style.display = audioOnly ? 'none' : ''; try { v.play(); } catch (e) {} } else if (mini) { v.style.display = 'none'; } else if (S === 'done') { v.srcObject = null; v.src = REC.url; v.muted = false; v.controls = true; v.style.display = ''; } else { v.srcObject = null; v.removeAttribute('src'); v.style.display = 'none'; } }
    var modes = '<div class="wb-row">' + [['cam', '📹 ' + T('كاميرا + ميكروفون', 'Camera + mic')], ['audio', '🎙 ' + T('صوت فقط', 'Audio only')]].concat(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia ? [['screen', '🖥 ' + T('الشاشة / PowerPoint + ميكروفون', 'Screen / PowerPoint + mic')]] : []).map(function (m) { return '<button class="btn sm' + (REC.mode === m[0] ? ' pri' : '') + '" data-act="wb-rec-mode" data-m="' + m[0] + '">' + h(m[1]) + '</button>'; }).join('') + '</div>';
    var big = REC.blob && REC.blob.size > MAXB;
    c.innerHTML = (REC.msg ? '<div class="pill bad" style="display:block;margin:8px 0">' + h(REC.msg) + '</div>' : '') +
      (S === 'idle' ? (REC.rescue ? '<div class="wb-card" style="border-color:#d97706"><b>⚠ ' + h(T('يوجد تسجيل غير مكتمل على هذا الجهاز (', 'An unfinished recording exists on this device (')) + fsize(REC.rescue) + ')</b><div class="wb-row"><button class="btn pri" data-act="wb-rec-rescue">' + h(T('استرجاعه', 'Recover')) + '</button><button class="btn sm bad" data-act="wb-rec-discard">' + h(T('حذفه', 'Discard')) + '</button></div></div>' : '') + modes +
          (REC.mode === 'screen' ? '<div class="pill warn" style="display:block;margin:8px 0;line-height:1.8">' + h(T('الأسهل والأضمن: اضغط «اختيار الشاشة» ثم تبويب «Entire Screen» ثم Share، وبعد بدء التسجيل افتح PowerPoint أو أي ملف من شريط المهام وسيُسجَّل كل ما يظهر على الشاشة. وفعّل «Share with system audio» إن أردت تسجيل صوت الفيديوهات. إن أردت تبويب «Window» فلن تظهر فيه النوافذ المصغَّرة: افتح ملف PowerPoint على الشاشة (غير مصغَّر) قبل الضغط.', 'Easiest and most reliable: press “Pick screen”, choose “Entire Screen”, Share; after recording starts open PowerPoint or any file from the taskbar — everything on screen is recorded. Turn on “Share with system audio” for video sound. The “Window” tab does not list minimized windows: restore the PowerPoint window before pressing pick.')) + '</div>' : '') +
          '<div class="sub" style="margin:8px 0">' + h(T('لا يوجد حد زمني. المحاضرة الطويلة تُحفظ تدريجياً في الجهاز، فلا تضيع إن أُغلقت الصفحة بالخطأ. للمحاضرات الطويلة نزّل الملف على جهازك (الإرسال للمنظّم حتى 60 ميغابايت فقط).', 'No time limit. Long recordings are saved progressively on this device. For long lectures download the file (sending to organizer is limited to 60 MB).')) + '</div><button class="btn pri" style="font-size:17px;padding:10px 18px" data-act="wb-rec-start">' + (REC.mode === 'screen' ? '🖥 ' + h(T('اختيار الشاشة / النافذة', 'Pick screen / window')) : '⏺ ' + h(T('بدء التسجيل', 'Start recording'))) + '</button>' :
S === 'ready' ? '<div class="pill ok" style="display:block;margin:8px 0;line-height:1.8">' + h(T('✓ تمت مشاركة الشاشة. المعاينة أعلاه هي ما سيُسجَّل. اضغط «بدء التسجيل» ثم انتقل إلى الملف أو العرض الذي تريد شرحه.', '✓ Screen shared. The preview above is what will be recorded. Press “Start recording”, then switch to the file you want to present.')) + '</div><div class="wb-row"><button class="btn pri" style="font-size:17px;padding:10px 18px" data-act="wb-rec-begin">⏺ ' + h(T('بدء التسجيل', 'Start recording')) + '</button><button class="btn" data-act="wb-rec-repick">🔄 ' + h(T('اختيار شاشة/نافذة أخرى', 'Pick another screen/window')) + '</button><button class="btn sm" data-act="wb-rec-cancel">' + h(T('إلغاء', 'Cancel')) + '</button></div>' :
        S === 'recording' || S === 'paused' ? '<div style="margin:10px 0;font-size:20px">' + (S === 'recording' ? '<span class="rdot"></span>' : '⏸ ') + '<b id="wb-tm">' + tmStr() + '</b> <span class="sub">' + h(S === 'paused' ? T('متوقف مؤقتاً', 'Paused') : T('جارٍ التسجيل', 'Recording')) + '</span></div>' + ctrlBtns() :
        '<div class="sub" style="margin:8px 0">' + h(T('المدة ', 'Length ')) + tmStr() + ' · ' + fsize(REC.blob && REC.blob.size) + ' · .' + REC.ext + '</div><div class="wb-row"><button class="btn pri" data-act="wb-rec-dl">⬇ ' + h(T('تنزيل على الجهاز', 'Download')) + '</button>' + (REC.ev && !big ? '<button class="btn" data-act="wb-rec-send">📤 ' + h(T('إرسال إلى المنظّم', 'Send to organizer')) + '</button>' : '') + '<button class="btn" data-act="wb-rec-again">↺ ' + h(T('تسجيل جديد', 'New recording')) + '</button></div>' +
          (big && REC.ev ? '<div class="sub" style="margin-top:6px">' + h(T('الحجم أكبر من 60 ميغابايت فلا يمكن إرساله عبر التطبيق؛ نزّله على جهازك.', 'Larger than 60 MB: download it instead of sending.')) + '</div>' : '') +
          (/webm/.test(REC.ext) ? '<div class="sub" style="margin-top:6px">' + h(T('صيغة WebM تعمل في VLC وChrome؛ ويمكن تحويلها إلى MP4 ببرنامج مجاني مثل HandBrake.', 'WebM plays in VLC and Chrome; convert to MP4 with a free tool like HandBrake.')) + '</div>' : ''));
    pipSync();
  }
  /* نافذة عائمة صغيرة (Chrome/Edge للكمبيوتر) للتحكم أثناء عرض PowerPoint */
  async function pipOpen() {
    try {
      if (!window.documentPictureInPicture) return;
      var w = await window.documentPictureInPicture.requestWindow({ width: 300, height: 130 }); REC.pip = w;
      w.document.body.style.cssText = 'margin:0;padding:8px;font-family:Tahoma,Arial;text-align:center;background:#fff;color:#111';
      w.document.body.innerHTML = '<div id="t" style="font-size:22px;font-weight:700;margin:2px 0 8px">00:00:00</div><button id="p" style="font-size:16px;padding:8px 12px;margin:2px">⏸</button><button id="s" style="font-size:16px;padding:8px 12px;margin:2px;background:#dc2626;color:#fff;border:0;border-radius:6px">⏹</button>';
      w.document.getElementById('p').onclick = function () { recPause(); }; w.document.getElementById('s').onclick = function () { recStop(); };
      w.addEventListener('pagehide', function () { REC.pip = null; });
    } catch (e) { REC.pip = null; }
  }
  function pipSync() {
    try { if (!REC.pip) return; var d = REC.pip.document, t = d.getElementById('t'), p = d.getElementById('p'); if (t) t.textContent = tmStr(); if (p) p.textContent = REC.state === 'paused' ? '▶' : '⏸'; if (REC.state === 'done' || REC.state === 'idle') { REC.pip.close(); REC.pip = null; } } catch (e) {}
  }
  async function recStart() {
    REC.msg = '';
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { REC.msg = T('هذا المتصفح لا يدعم التسجيل. حدّثه أو استخدم Chrome/Safari حديث.', 'This browser cannot record. Update it or use a recent Chrome/Safari.'); return recRender(); }
    try {
      var audioOnly = REC.mode === 'audio', stream, screen = REC.mode === 'screen';
      if (screen) {
        var d; try { d = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor', frameRate: { ideal: 10, max: 15 } }, audio: true, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', monitorTypeSurfaces: 'include' }); } catch (e1) { if (e1 && /NotAllowed|Abort/i.test(e1.name)) throw e1; d = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); }
        var m = null; try { m = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) {}
        REC.extra = [d, m].filter(Boolean);
        var tracks = d.getVideoTracks();
        if (m && d.getAudioTracks().length && window.AudioContext) { try { var ac = new AudioContext(), dest = ac.createMediaStreamDestination(); ac.createMediaStreamSource(m).connect(dest); ac.createMediaStreamSource(new MediaStream(d.getAudioTracks())).connect(dest); tracks = tracks.concat(dest.stream.getAudioTracks()); REC.ac = ac; } catch (e) { tracks = tracks.concat(m.getAudioTracks()); } }
        else tracks = tracks.concat(m ? m.getAudioTracks() : d.getAudioTracks());
        stream = new MediaStream(tracks);
      } else stream = await navigator.mediaDevices.getUserMedia(audioOnly ? { audio: true } : { audio: true, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
      REC.stream = stream; REC.audio = audioOnly;
      stream.getTracks().forEach(function (t) { t.onended = function () { if (REC.state === 'recording' || REC.state === 'paused') recStop(); else if (REC.state === 'ready') { recCleanup(false); REC.state = 'idle'; REC.msg = T('توقفت مشاركة الشاشة. اختر من جديد.', 'Screen sharing stopped. Pick again.'); recRender(); } }; });
      if (screen) { REC.state = 'ready'; recRender(); } else recBegin();
    } catch (e) {
      recCleanup(false);
      REC.msg = e && /NotAllowed|Permission/i.test(e.name + e.message) ? T('لم تسمح للتطبيق بالكاميرا/الميكروفون/مشاركة الشاشة. اسمح من إعدادات المتصفح (وعلى ماك: إعدادات النظام ← الخصوصية والأمان ← تسجيل الشاشة ← فعّل Chrome) ثم أعد المحاولة.', 'Permission denied (camera/mic/screen). Allow it in browser settings (on Mac: System Settings → Privacy & Security → Screen Recording → enable Chrome) and retry.') : e && /NotFound|Devices/i.test(e.name + e.message) ? T('لا توجد كاميرا أو ميكروفون على هذا الجهاز.', 'No camera or microphone found.') : (e && e.message) || String(e);
      REC.state = 'idle'; recRender();
    }
  }
  async function recBegin() {
    try {
      var audioOnly = REC.audio, screen = REC.mode === 'screen', stream = REC.stream; if (!stream) return;
      var mime = pickMime(audioOnly), opts = { videoBitsPerSecond: screen ? 1000000 : 500000, audioBitsPerSecond: 64000 }; if (mime) opts.mimeType = mime;
      var mr; try { mr = new MediaRecorder(stream, opts); } catch (e) { mr = new MediaRecorder(stream); }
      REC.mr = mr; REC.chunks = []; REC.mime = (mr.mimeType || mime || (audioOnly ? 'audio/webm' : 'video/webm')).split(';')[0]; REC.ext = extOf(REC.mime, audioOnly); REC.saved = false; REC.rescue = 0;
      await idbClear(); idbMeta();
      mr.ondataavailable = function (ev) { if (ev.data && ev.data.size) { REC.chunks.push(ev.data); idbAdd(ev.data); } };
      mr.onstop = function () {
        var type = REC.mime; REC.blob = new Blob(REC.chunks, { type: type });
        if (REC.url) { try { URL.revokeObjectURL(REC.url); } catch (e) {} } REC.url = URL.createObjectURL(REC.blob);
        clearInterval(REC.timer); [REC.stream].concat(REC.extra).forEach(function (s) { try { s && s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} });
        try { REC.ac && REC.ac.close(); } catch (e) {} try { if (REC.lock) { REC.lock.release(); REC.lock = null; } } catch (e) {} window.onbeforeunload = null;
        idbMeta(); REC.state = REC.blob.size ? 'done' : 'idle'; if (!REC.blob.size) REC.msg = T('لم يُسجَّل شيء. حاول مرة أخرى.', 'Nothing was recorded. Try again.'); recRender();
      };
      mr.start(2000); REC.state = 'recording'; REC.secs = 0;
      try { if (navigator.wakeLock) REC.lock = await navigator.wakeLock.request('screen'); } catch (e) {}
      window.onbeforeunload = function (e) { e.preventDefault(); e.returnValue = ''; return ''; };
      REC.timer = setInterval(function () { if (REC.state !== 'recording') return; REC.secs++; if (REC.secs % 30 === 0) idbMeta(); var c = document.getElementById('wb-tm'); if (c) c.textContent = tmStr(); pipSync(); }, 1000);
      recRender(); if (screen) pipOpen();
    } catch (e) { recCleanup(false); REC.msg = (e && e.message) || String(e); REC.state = 'idle'; recRender(); }
  }
  function recPause() {
    try {
      if (!REC.mr) return;
      if (REC.state === 'recording' && REC.mr.state === 'recording') { REC.mr.pause(); REC.state = 'paused'; }
      else if (REC.state === 'paused') { REC.mr.resume(); REC.state = 'recording'; }
      recRender();
    } catch (e) { REC.msg = (e && e.message) || String(e); recRender(); }
  }
  function recStop() { try { if (REC.mr && REC.mr.state !== 'inactive') REC.mr.stop(); } catch (e) {} }
  async function recRescue() {
    var d = await idbLoad(); if (!d.chunks.length || !d.meta) { REC.rescue = 0; return recRender(); }
    REC.mime = d.meta.type || 'video/webm'; REC.ext = d.meta.ext || 'webm'; REC.audio = !!d.meta.audio; REC.secs = d.meta.secs || 0;
    REC.blob = new Blob(d.chunks, { type: REC.mime }); if (REC.url) { try { URL.revokeObjectURL(REC.url); } catch (e) {} } REC.url = URL.createObjectURL(REC.blob); REC.state = 'done'; REC.rescue = 0; REC.saved = false; recRender();
  }
  function recName() { return 'recording-' + stamp() + '.' + REC.ext; }
  async function recSend() {
    if (!REC.blob || !REC.ev) return;
    if (REC.blob.size > MAXB) { REC.msg = T('الحجم أكبر من 60 ميغابايت. نزّله على جهازك.', 'Larger than 60 MB. Download it instead.'); return recRender(); }
    var c = document.getElementById('wb-rc'); if (c) c.innerHTML = '<div class="sub">' + h(T('جارٍ الرفع… لا تغلق الصفحة.', 'Uploading… keep this page open.')) + '</div>';
    var path = 'w' + REC.ev + '/' + myId() + '/' + Date.now() + '.' + REC.ext;
    try {
      var up = await sb().storage.from(BUCKET).upload(path, REC.blob, { contentType: REC.blob.type, upsert: false }); if (up.error) throw up.error;
      try { await rpc('wb_rec_add', { p_event: REC.ev, p_path: path, p_name: recName(), p_mime: REC.blob.type, p_size: REC.blob.size, p_seconds: REC.secs }); }
      catch (e) { try { await sb().storage.from(BUCKET).remove([path]); } catch (x) {} throw e; }
      W.msg = h(T('✅ أُرسل تسجيلك إلى المنظّم.', '✅ Your recording was sent to the organizer.')); REC.saved = true; idbClear(); var b = document.getElementById('wb-recbox'); if (b) b.remove(); recCleanup(true);
      if (W.id) { W.tab = 'rec'; go(loadTab); } else redraw();
    } catch (e) { REC.msg = (e && e.message || String(e)) + (/wb_|bucket|not found|policy/i.test(e && e.message) ? ' — ' + T('تأكد من تشغيل webinar.sql.', 'Make sure webinar.sql was run.') : ''); recRender(); }
  }

  /* ───────── شهادة الحضور ───────── */
  function certHtml(c) {
    var d = new Date(c.starts_at).toLocaleDateString(ar() ? 'ar' : 'en', { year: 'numeric', month: 'long', day: 'numeric' });
    return '<div class="wb-cr" dir="' + (ar() ? 'rtl' : 'ltr') + '"><img src="logo.png" alt="" style="height:70px"><h1>' + h(T('شهادة حضور', 'Certificate of Attendance')) + '</h1><p>' + h(T('تشهد الكلية بأن', 'This is to certify that')) + '</p><div class="nm">' + h(c.full_name) + '</div><p>' + h(T('قد حضر/ت الويبنار', 'attended the webinar')) + '</p><p><b style="font-size:22px">' + h(c.title) + '</b></p>' + (c.speaker ? '<p>' + h(T('المتحدث: ', 'Speaker: ')) + h(c.speaker) + '</p>' : '') + '<p>' + h(d) + ' · ' + c.duration_min + ' ' + h(T('دقيقة', 'min')) + '</p><div class="sg"><div>' + h(T('منظّم الويبنار', 'Organizer')) + '</div><div>' + h(T('إدارة الكلية', 'College administration')) + '</div></div></div>';
  }

  /* ───────── الأوامر ───────── */
  var ACTS = {
    'wb-refresh': function () { go(async function () { await loadEvents(); if (W.id) await loadTab(); }); },
    'wb-open': function (el) { W.id = Number(el.dataset.id); W.tab = 'info'; W.msg = ''; go(async function () { await loadCohorts(); }); },
    'wb-back': function () { W.id = null; W.msg = ''; go(loadEvents); },
    'wb-tab': function (el) { W.tab = el.dataset.t; W.msg = ''; W.play = null; go(loadTab); },
    'wb-new': function () { go(async function () { await loadCohorts(); W.form = newForm(null); }); },
    'wb-edit': function () { W.form = newForm(cur()); redraw(); },
    'wb-fcancel': function () { W.form = null; redraw(); },
    'wb-save': function () {
      var f = W.form; if (!f) return;
      if (!f.title.trim()) { W.err = T('اكتب عنوان الويبنار', 'Enter a title'); return redraw(); }
      if (!f.start) { W.err = T('حدّد الموعد', 'Set the date/time'); return redraw(); }
      if (f.link && !safeUrl(f.link)) { W.err = T('رابط البث يجب أن يبدأ بـ https://', 'Join link must start with https://'); return redraw(); }
      if (!f.students && !f.staff && !f.cohorts.length) { W.err = T('اختر جمهوراً واحداً على الأقل', 'Pick at least one audience'); return redraw(); }
      go(async function () {
        var id = await rpc('wb_save', { p_id: f.id, p_title: f.title, p_speaker: f.speaker, p_descr: f.descr, p_starts: new Date(f.start).toISOString(), p_dur: Number(f.dur) || 60, p_link: f.link, p_students: !!f.students, p_staff: !!f.staff, p_cohorts: f.cohorts, p_materials: f.materials, p_record: f.record, p_allow_rec: !!f.allowRec });
        W.form = null; await loadEvents(); W.id = id; W.tab = 'info'; W.msg = h(T('✅ تم الحفظ.', '✅ Saved.'));
      });
    },
    'wb-cancel': function (el) { go(async function () { await rpc('wb_cancel', { p_id: Number(el.dataset.id), p_cancel: el.dataset.on === '1' }); await loadEvents(); }); },
    'wb-del': function (el) { go(async function () { await rpc('wb_delete', { p_id: Number(el.dataset.id) }); W.id = null; await loadEvents(); }); },
    'wb-reg': function (el) { go(async function () { await rpc('wb_register', { p_id: Number(el.dataset.id), p_on: true }); await loadEvents(); W.msg = h(T('✅ تم تسجيلك. سيظهر زر الانضمام قبل الموعد بـ 15 دقيقة.', '✅ Registered. The join button appears 15 minutes before start.')); }); },
    'wb-unreg': function (el) { go(async function () { await rpc('wb_register', { p_id: Number(el.dataset.id), p_on: false }); await loadEvents(); }); },
    'wb-join': function (el) {
      var w = null; try { w = window.open('', '_blank'); } catch (e) {}
      go(async function () {
        try { var link = await rpc('wb_join', { p_id: Number(el.dataset.id) }); await loadEvents(); if (w && !w.closed) { w.opener = null; w.location.href = link; W.msg = h(T('✅ سُجّل حضورك. إن لم تُفتح الصفحة: ', '✅ Attendance recorded. If it did not open: ')) + '<a href="' + h(link) + '" target="_blank" rel="noopener">' + h(T('افتح رابط البث', 'open the join link')) + '</a>'; } else W.msg = h(T('✅ سُجّل حضورك. ', '✅ Attendance recorded. ')) + '<a class="btn pri" href="' + h(link) + '" target="_blank" rel="noopener">🎥 ' + h(T('افتح رابط البث', 'Open join link')) + '</a>'; }
        catch (e) { try { w && w.close(); } catch (x) {} throw e; }
      });
    },
    'wb-qadd': function () { var t = (($q('#wb-q-t') || {}).value || '').trim(); if (!t) { W.err = T('اكتب السؤال', 'Write a question'); return redraw(); } go(async function () { await rpc('wb_q_add', { p_id: W.id, p_body: t, p_anon: !!W.qanon }); W.qd = ''; await loadTab(); }); },
    'wb-qvote': function (el) { go(async function () { await rpc('wb_q_vote', { p_qid: Number(el.dataset.id) }); await loadTab(); }); },
    'wb-qans': function (el) { var q = W.q.filter(function (x) { return String(x.id) === el.dataset.id; })[0], a = window.prompt(T('اكتب الجواب (اتركه فارغاً لحذف الجواب):', 'Write the answer (empty removes it):'), (q && q.answer) || ''); if (a === null) return; go(async function () { await rpc('wb_q_answer', { p_qid: Number(el.dataset.id), p_answer: a }); await loadTab(); }); },
    'wb-qdel': function (el) { go(async function () { await rpc('wb_q_delete', { p_qid: Number(el.dataset.id) }); await loadTab(); }); },
    'wb-padd': function () { var q = (($q('#wb-pq') || {}).value || '').trim(), o = (($q('#wb-po') || {}).value || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); if (q.length < 2 || o.length < 2) { W.err = T('اكتب السؤال وخيارين على الأقل', 'Enter a question and at least 2 options'); return redraw(); } go(async function () { await rpc('wb_poll_save', { p_id: W.id, p_question: q, p_options: o }); W.pq = ''; W.po = ''; await loadTab(); }); },
    'wb-pvote': function (el) { go(async function () { await rpc('wb_poll_vote', { p_poll: Number(el.dataset.id), p_opt: Number(el.dataset.o) }); await loadTab(); }); },
    'wb-pclose': function (el) { go(async function () { await rpc('wb_poll_close', { p_poll: Number(el.dataset.id), p_closed: el.dataset.on === '1' }); await loadTab(); }); },
    'wb-pdel': function (el) { go(async function () { await rpc('wb_poll_delete', { p_poll: Number(el.dataset.id) }); await loadTab(); }); },
    'wb-star': function (el) { W.fbr = Number(el.dataset.r); W.fbc = (($q('#wb-fbc') || {}).value || W.fbc); redraw(); },
    'wb-fbsave': function () { var e = cur(); go(async function () { await rpc('wb_fb_save', { p_id: e.id, p_rating: W.fbr || e.my_rating, p_comment: (($q('#wb-fbc') || {}).value || '') }); await loadEvents(); W.msg = h(T('✅ شكراً على تقييمك.', '✅ Thanks for your rating.')); }); },
    'wb-att': function (el) { go(async function () { await rpc('wb_mark_attended', { p_id: W.id, p_user: el.dataset.u, p_on: el.dataset.on === '1' }); await loadTab(); await loadEvents(); }); },
    'wb-acsv': function () { var e = cur(); saveBlob('attendance-' + String(e.title).slice(0, 30) + '.csv', csvBlob([[T('الاسم', 'Name'), T('الرقم', 'Number'), T('النوع', 'Type'), T('وقت التسجيل', 'Registered'), T('وقت الحضور', 'Joined'), T('حضر؟', 'Attended')]].concat(W.att.map(function (a) { return [a.full_name, a.university_id, a.acct_role, a.registered_at ? new Date(a.registered_at).toLocaleString() : '', a.joined_at ? new Date(a.joined_at).toLocaleString() : '', a.joined_at ? T('نعم', 'Yes') : T('لا', 'No')]; })))); },
    'wb-rplay': function (el) { var id = Number(el.dataset.id); go(async function () { var r = await sb().storage.from(BUCKET).createSignedUrl(el.dataset.p, 900); if (r.error) throw new Error(r.error.message); W.urls[id] = r.data.signedUrl; W.play = id; }); },
    'wb-rdl': function (el) { go(async function () { var r = await sb().storage.from(BUCKET).createSignedUrl(el.dataset.p, 600, { download: el.dataset.n }); if (r.error) throw new Error(r.error.message); var a = document.createElement('a'); a.href = r.data.signedUrl; a.download = el.dataset.n || ''; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); }); },
    'wb-rdel': function (el) { go(async function () { var p = await rpc('wb_rec_delete', { p_id: Number(el.dataset.id) }); if (p) { try { await sb().storage.from(BUCKET).remove([p]); } catch (e) {} } await loadTab(); }); },
    'wb-cert': function (el) {
      go(async function () {
        var rows = await rpc('wb_cert', { p_id: Number(el.dataset.id) }), c = (rows || [])[0]; if (!c) throw new Error(T('الشهادة لمن سُجّل حضوره', 'Certificate is for attendees'));
        var o = document.getElementById('wb-cert'); if (o) o.remove(); o = document.createElement('div'); o.id = 'wb-cert';
        o.innerHTML = '<div class="bar"><button class="btn pri" data-act="wb-cert-print">🖨 ' + h(T('طباعة / حفظ PDF', 'Print / Save PDF')) + '</button>' + (window.lgReceiptPng ? '<button class="btn" data-act="wb-cert-png">🖼 ' + h(T('حفظ كصورة', 'Save as image')) + '</button>' : '') + '<button class="btn" data-act="wb-cert-close">✕ ' + h(T('إغلاق', 'Close')) + '</button></div>' + certHtml(c);
        document.body.appendChild(o);
      });
    },
    'wb-cert-print': function () { window.print(); },
    'wb-cert-png': function () { var cr = document.querySelector('#wb-cert .wb-cr'); if (!cr || !window.lgReceiptPng) return; window.lgReceiptPng('<div style="background:#fff;padding:12px">' + cr.outerHTML + '</div>').then(function (u) { var a = document.createElement('a'); a.href = u; a.download = 'certificate.png'; document.body.appendChild(a); a.click(); a.remove(); }).catch(function (e) { W.err = (e && e.message) || String(e); redraw(); }); },
    'wb-cert-close': function () { var o = document.getElementById('wb-cert'); if (o) o.remove(); },
    'wb-rec-open': function (el) { recOpen(el && el.dataset && el.dataset.ev ? Number(el.dataset.ev) : null); },
    'wb-rec-close': function () { recClose(); },
    'wb-rec-pause': function () { recPause(); },
    'wb-rec-rescue': function () { recRescue(); },
    'wb-rec-discard': function () { idbClear(); REC.rescue = 0; recRender(); },
    'wb-rec-mode': function (el) { REC.mode = el.dataset.m; recRender(); },
    'wb-rec-start': function () { recStart(); },
    'wb-rec-begin': function () { recBegin(); },
    'wb-rec-repick': function () { recCleanup(false); REC.state = 'idle'; recStart(); },
    'wb-rec-cancel': function () { recCleanup(false); REC.state = 'idle'; REC.msg = ''; recRender(); },
    'wb-rec-stop': function () { recStop(); },
    'wb-rec-again': function () { if (!REC.saved && !window.confirm(T('لم تنزّل التسجيل الحالي. بدء تسجيل جديد سيحذفه. متابعة؟', 'Current recording not downloaded; a new one replaces it. Continue?'))) return; recCleanup(true); REC.state = 'idle'; REC.msg = ''; REC.saved = false; recRender(); },
    'wb-rec-dl': function () { if (REC.blob) { saveBlob(recName(), REC.blob); REC.saved = true; } },
    'wb-rec-send': function () { recSend(); }
  };
  window.EXTRA_ACT = Object.assign(window.EXTRA_ACT || {}, ACTS);

  document.addEventListener('input', function (e) {
    var t = e.target; if (!t) return;
    if (t.id === 'wb-q-t') { W.qd = t.value; return; } if (t.id === 'wb-fbc') { W.fbc = t.value; return; } if (t.id === 'wb-po') { W.po = t.value; return; } if (t.id === 'wb-pq') { W.pq = t.value; return; }
    var k = t.dataset && t.dataset.wbf; if (k && W.form && t.type !== 'checkbox') W.form[k] = t.value;
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t || !t.dataset) return;
    if (t.id === 'wb-q-anon') { W.qanon = t.checked; return; }
    if (t.dataset.wbf && W.form && t.type === 'checkbox') W.form[t.dataset.wbf] = t.checked;
    if (t.dataset.wbc && W.form) { var id = Number(t.dataset.wbc), i = W.form.cohorts.indexOf(id); if (t.checked && i < 0) W.form.cohorts.push(id); if (!t.checked && i > -1) W.form.cohorts.splice(i, 1); }
  });

  /* ───────── تحديث دوري خفيف لقوائم الأسئلة/الاستطلاعات فقط ───────── */
  var polling = null;
  function startPoll() { if (polling) return; polling = setInterval(poll, 10000); }
  async function poll() {
    if (!root() || document.hidden || W.busy || !W.id || W.form) return;
    try {
      if (W.tab === 'qa') { W.q = (await rpc('wb_q_list', { p_id: W.id })) || []; var a = $q('#wb-live'); if (a) a.innerHTML = qList(); }
      else if (W.tab === 'polls') { W.polls = (await rpc('wb_poll_list', { p_id: W.id })) || []; var b = $q('#wb-live'); if (b) b.innerHTML = pollList(); }
    } catch (e) { /* صامت */ }
  }

  window.WB = { visible: window.wbVisible };
})();
