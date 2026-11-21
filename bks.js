/* bks.js: «حجز المحاضرة» للطالب (كلية أو خارجي): يدخل بحسابه فيرى مساقات شعبته، ينضم إلى مجموعة ضمن السعة، يحجز موضوعاً لمجموعته. تعتمد على supabase/booking-cohort.sql */
(function () {
  'use strict';
  var P = function () { return window.PLANNER_AUTH || null; };
  function sb() { return P() && P().sb(); }
  function ar() { return P() ? P().lang() === 'ar' : true; }
  function T(a, e) { return ar() ? a : e; }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $q(s) { return document.querySelector(s); }
  function role() { return (window.CTX || {}).role; }
  var DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  function fmtDate(d) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? DAYS[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] + ' ' + m[1] + '-' + m[2] + '-' + m[3] : ''; }

  var S = { loaded: false, offs: [], off: 0, st: null, busy: false, err: '', msg: '', bad: false, link: '' };
  try { S.off = Number(localStorage.getItem('bs_off')) || 0; } catch (e) {}
  function say(m, bad) { S.msg = m || ''; S.bad = !!bad; }

  window.bsVisible = function () { return role() === 'student' && S.offs.length > 0; };
  window.bsView = function () { return '<div id="bs-root"></div>'; };
  window.bsMount = function () { draw(); load(); startPoll(); };
  async function rpc(n, a) { var r = await sb().rpc(n, a || {}); if (r.error) throw new Error(r.error.message); return r.data; }

  async function loadOffs() { S.offs = (await rpc('bk_my_offerings')) || []; S.loaded = true; if (!S.offs.some(function (o) { return o.id === S.off; })) S.off = (S.offs[0] || {}).id || 0; try { localStorage.setItem('bs_off', S.off || ''); } catch (e) {} }
  async function loadState() { S.st = S.off ? await rpc('bk_state', { p_off: S.off }) : null; if (S.st && S.st.ok === false) S.st = null; }
  async function load() { if (S.busy) return; S.busy = true; try { await loadOffs(); await loadState(); S.err = ''; } catch (e) { S.err = (e && e.message) || String(e); if (/bk_|schema cache/i.test(S.err)) S.err += ' — ' + T('شغّل booking-cohort.sql في Supabase.', 'Run booking-cohort.sql in Supabase.'); } S.busy = false; draw(); }
  async function act(fn) { if (S.busy) return; S.busy = true; S.err = ''; draw(); try { await fn(); await loadState(); } catch (e) { S.err = (e && e.message) || String(e); } S.busy = false; draw(); }
  var ERR = { closed: T('الحجز مغلق حالياً', 'Booking is closed'), cohort: T('هذا المساق ليس لشعبتك', 'Not for your cohort'), already: T('أنت منضم لمجموعة في هذا المساق. غادرها أولاً', 'You are already in a group. Leave it first'), full: T('المجموعة اكتمل عددها، اختر مجموعة أخرى. وقد أُبلغ المحاضر.', 'This group is full; pick another. The lecturer was notified.'), nogroup: T('لست في مجموعة', 'You are not in a group'), has: T('لمجموعتك موضوع محجوز', 'Your group already has a topic'), taken: T('الموضوع حُجز لمجموعة أخرى', 'Topic already taken'), notopic: T('الموضوع غير موجود', 'No such topic'), link: T('رابط غير صالح (يبدأ بـ https://)', 'Invalid link (must start with https://)') };
  function chk(r) { if (r && r.ok === false) { say(ERR[r.err] || r.err, true); return false; } return true; }

  function draw() {
    var el = $q('#bs-root'); if (!el) return;
    var o = S.offs.filter(function (x) { return x.id === S.off; })[0], st = S.st;
    var html = '<div class="card"><h2>📅 ' + h(T('حجز المحاضرة', 'Lecture booking')) + '</h2>' +
      (S.offs.length > 1 ? '<label class="sub">' + h(T('المساق', 'Course')) + '<select data-bs="off">' + S.offs.map(function (x) { return '<option value="' + x.id + '"' + (x.id === S.off ? ' selected' : '') + '>' + h(x.course + ' — ' + x.semester) + '</option>'; }).join('') + '</select></label>' : (o ? '<div><b>' + h(o.course) + '</b> <span class="sub">' + h(o.semester) + '</span></div>' : '')) + '</div>' +
      (S.err ? '<p class="pill bad" style="white-space:normal">' + h(S.err) + '</p>' : '') + (S.msg ? '<p class="pill ' + (S.bad ? 'bad' : 'ok') + '" style="white-space:normal">' + h(S.msg) + '</p>' : '') + (S.busy ? '<p class="sub">…</p>' : '');
    if (!S.loaded) html += '<div class="sub">' + h(T('جارٍ التحميل…', 'Loading…')) + '</div>';
    else if (!o) html += '<div class="empty">' + h(T('لا توجد مساقات للحجز لشعبتك حالياً.', 'No bookable courses for your cohort.')) + '</div>';
    else if (st) html += body(st);
    el.innerHTML = html;
    var l = $q('#bs-link'); if (l) l.value = S.link;
  }
  function body(st) {
    var mine = st.groups.filter(function (g) { return g.mine; })[0], closed = st.closed;
    var out = closed ? '<p class="pill warn" style="white-space:normal">🔒 ' + h(st.closed_msg || T('الحجز مغلق حالياً', 'Booking is closed')) + '</p>' : '';
    out += '<div class="sub" style="margin:6px 0">' + h(st.cap ? T('أقصى عدد أعضاء المجموعة: ', 'Max members per group: ') + st.cap : T('عدد أعضاء المجموعة غير محدد', 'No member limit')) + '</div>';
    if (mine) {
      var free = st.topics.filter(function (t) { return !t.group_no; });
      out += '<div class="card" style="border:2px solid var(--accent,#0b8a97)"><b>⭐ ' + h(T('مجموعتي: ', 'My group: ')) + mine.group_no + '</b> <span class="pill ' + (mine.cap && mine.count >= mine.cap ? 'ok' : '') + '">' + mine.count + (mine.cap ? '/' + mine.cap : '') + '</span>' +
        '<div class="sub">' + mine.members.map(function (m) { return h(m.name) + (m.me ? ' (' + h(T('أنا', 'me')) + ')' : ''); }).concat((mine.manual || []).map(h)).join('، ') + '</div>' +
        (mine.topic_id ? '<div style="margin-top:6px">📌 <b>#' + mine.topic_no + '</b> ' + h(mine.topic_title) + '</div>' + (mine.date ? '<div class="sub">📅 ' + h(fmtDate(mine.date)) + '</div>' : '') +
          (closed ? (mine.link ? '<div class="sub"><a href="' + h(mine.link) + '" target="_blank" rel="noopener noreferrer">🔗 ' + h(T('رابط المحاضرة', 'Lecture link')) + '</a></div>' : '') :
            '<div class="form" style="margin-top:6px"><label>' + h(T('رابط المحاضرة (اختياري)', 'Lecture link (optional)')) + '<input id="bs-link" dir="ltr" placeholder="https://…" maxlength="500"></label></div><div class="tabs"><button class="btn sm pri" data-act="bs-link">' + h(T('حفظ الرابط', 'Save link')) + '</button><button class="btn sm bad" data-act="bs-cancel" data-confirm="1" data-confirm-text="' + h(T('اضغط لتأكيد إلغاء الموضوع', 'Press to confirm')) + '">' + h(T('إلغاء الموضوع', 'Cancel topic')) + '</button></div>') :
          (closed ? '<div class="sub">' + h(T('لم تحجز موضوعاً', 'No topic booked')) + '</div>' : '<div class="sub" style="margin-top:6px">' + h(T('اختر موضوع مجموعتك (يستطيع أي عضو الحجز):', 'Pick your group topic (any member can book):')) + '</div>' +
            (free.length ? free.map(function (t) { return '<div class="wb-q" style="padding:6px 0;border-top:1px dashed rgba(127,127,127,.3)"><button class="btn sm pri" data-act="bs-book" data-t="' + t.id + '" data-confirm="1" data-confirm-text="' + h(T('اضغط لتأكيد حجز هذا الموضوع', 'Press to confirm')) + '">' + h(T('حجز', 'Book')) + '</button> <b>#' + t.no + '</b> ' + h(t.title) + (t.descr ? '<div class="sub">' + h(t.descr) + '</div>' : '') + '</div>'; }).join('') : '<div class="sub">' + h(T('لا مواضيع متاحة', 'No free topics')) + '</div>'))) +
        (closed ? '' : '<div style="margin-top:8px"><button class="btn sm" data-act="bs-leave" data-confirm="1" data-confirm-text="' + h(T('اضغط لتأكيد مغادرة المجموعة', 'Press to confirm leaving')) + '">' + h(T('مغادرة المجموعة', 'Leave group')) + '</button></div>') + '</div>';
    } else if (!closed) out += '<p class="pill" style="white-space:normal">' + h(T('اختر مجموعة وانضم إليها بحسابك (مجموعة واحدة فقط).', 'Pick a group and join it with your account (one group only).')) + '</p>';
    out += '<h3 style="margin:12px 0 4px">' + h(T('المجموعات', 'Groups')) + '</h3>' + st.groups.map(function (g) {
      var full = g.cap && g.count >= g.cap;
      return '<div class="card" style="margin:6px 0' + (g.mine ? ';opacity:.85' : '') + '"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div><b>' + h(T('مجموعة ', 'Group ')) + g.group_no + '</b> <span class="pill ' + (full ? 'warn' : '') + '">' + g.count + (g.cap ? '/' + g.cap : '') + '</span>' + (full ? ' <span class="pill bad">' + h(T('مكتملة', 'Full')) + '</span>' : '') + (g.topic_id ? ' <span class="pill ok">' + h(T('محجوز موضوع', 'Topic booked')) + '</span>' : '') + '</div>' +
        (!mine && !closed ? '<button class="btn sm' + (full ? '' : ' pri') + '" data-act="bs-join" data-g="' + g.id + '"' + (full ? ' disabled' : '') + '>' + h(full ? T('مكتملة', 'Full') : T('انضمام', 'Join')) + '</button>' : '') + '</div>' +
        (g.topic_id ? '<div class="sub">📌 #' + g.topic_no + ' ' + h(g.topic_title) + '</div>' : '') +
        '<div class="sub">' + (g.members.length || (g.manual || []).length ? g.members.map(function (m) { return h(m.name) + (m.me ? ' (' + h(T('أنا', 'me')) + ')' : ''); }).concat((g.manual || []).map(h)).join('، ') : h(T('لا أعضاء بعد', 'No members yet'))) + '</div></div>';
    }).join('');
    return out;
  }

  var ACTS = {
    'bs-join': function (el) { act(async function () { var r = await rpc('bk_join', { p_group: Number(el.dataset.g) }); if (chk(r)) say(r.full ? T('انضممت. اكتمل عدد المجموعة وأُبلغ المحاضر.', 'Joined. The group is now full; the lecturer was notified.') : T('تم انضمامك إلى المجموعة', 'Joined'), false); }); },
    'bs-leave': function () { act(async function () { var r = await rpc('bk_leave', { p_off: S.off }); if (chk(r)) say(T('غادرت المجموعة', 'Left the group'), false); }); },
    'bs-book': function (el) { act(async function () { var r = await rpc('bk_book_topic', { p_off: S.off, p_topic: Number(el.dataset.t) }); if (chk(r)) say(T('تم حجز الموضوع لمجموعتك', 'Topic booked'), false); }); },
    'bs-cancel': function () { act(async function () { var r = await rpc('bk_cancel_topic', { p_off: S.off }); if (chk(r)) say(T('أُلغي الموضوع', 'Topic cancelled'), false); }); },
    'bs-link': function () { var v = (($q('#bs-link') || {}).value || '').trim(); act(async function () { var r = await rpc('bk_set_link', { p_off: S.off, p_link: v }); if (chk(r)) { S.link = v; say(T('تم حفظ الرابط', 'Saved'), false); } }); }
  };
  window.EXTRA_ACT = Object.assign(window.EXTRA_ACT || {}, ACTS);
  document.addEventListener('input', function (e) { if (e.target && e.target.id === 'bs-link') S.link = e.target.value; });
  document.addEventListener('change', function (e) { var t = e.target; if (t && t.dataset && t.dataset.bs === 'off') { S.off = Number(t.value); try { localStorage.setItem('bs_off', S.off); } catch (x) {} say(''); S.st = null; draw(); act(async function () {}); } });

  var poll = null;
  function startPoll() { if (poll) return; poll = setInterval(async function () { var el = document.activeElement; if (!$q('#bs-root') || document.hidden || S.busy || (el && el.id === 'bs-link')) return; try { await loadState(); draw(); } catch (e) {} }, 12000); }
  function bg() { if (role() !== 'student' || !sb()) return; rpc('bk_my_offerings').then(function (d) { var had = S.offs.length; S.offs = d || []; S.loaded = true; if (!S.off) S.off = (S.offs[0] || {}).id || 0; if ((had > 0) !== (S.offs.length > 0) && typeof window.render === 'function') { try { window.render(); } catch (e) {} } }, function () {}); }
  setTimeout(bg, 3500); setInterval(bg, 300000);
})();
