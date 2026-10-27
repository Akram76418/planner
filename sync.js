/* My Daily Planner — accounts + offline-first sync (Supabase).
   Loaded before the app script. Uses the app's globals (S, UI, DB, idbGet, idbPut, render, toast, t, L, esc, $) lazily.
   Without config.js values the app runs in local-only mode. */
(function () {
  'use strict';
  var C = window.PLANNER_CONFIG || {};
  var enabled = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY && window.supabase);
  var sb = null, user = null, authResolve = null;
  var st = { access: null, users: null, usersErr: '', online: navigator.onLine, syncing: false, err: '', last: 0, needLogin: false, pushOn: false };
  var outbox = {}, shadow = {}, cursor = '1970-01-01T00:00:00Z', timer = null, pulling = false, chan = null;
  var KINDS = ['appts', 'tasks', 'follows', 'reports', 'settings'];
  var LAST_USER_KEY = 'planner_last_user';

  var AUTH_T = {
    ar: { title: 'منظّم أعمالي اليومية', login: 'تسجيل الدخول', signup: 'إنشاء حساب بالبريد', request: 'طلب تسجيل (طلبة / موظفون)', forgot: 'نسيت كلمة المرور', email: 'البريد الإلكتروني', ident: 'البريد الإلكتروني أو الرقم الأكاديمي / الوظيفي', pass: 'كلمة المرور', local: 'المتابعة دون حساب (على هذا الجهاز فقط)', back: 'رجوع', sendReset: 'إرسال رابط الاستعادة', newPass: 'كلمة مرور جديدة', setPass: 'حفظ كلمة المرور', checkMail: 'تحقق من بريدك الإلكتروني لإكمال الخطوة.', short: 'كلمة المرور 8 أحرف على الأقل', bad: 'تحقق من البريد وكلمة المرور', hint: 'يمكنك فتح التطبيق من أجهزة متعددة بالحساب نفسه. كل حساب مستقل عن الحسابات الأخرى.' },
    en: { title: 'My Daily Planner', login: 'Sign in', signup: 'Create account by email', request: 'Request registration (students / staff)', forgot: 'Forgot password', email: 'Email', ident: 'Email, academic or employee number', pass: 'Password', local: 'Continue without an account (this device only)', back: 'Back', sendReset: 'Send reset link', newPass: 'New password', setPass: 'Save password', checkMail: 'Check your email to finish.', short: 'Password must be at least 8 characters', bad: 'Check the email and password', hint: 'Open the app on several devices with the same account. Every account is separate from the others.' }
  };
  function lang() { try { var l = (typeof S !== 'undefined' && S.meta && S.meta.lang) || localStorage.getItem('planner_lang') || (navigator.language || 'ar').slice(0, 2); return l === 'en' ? 'en' : 'ar'; } catch (e) { return 'ar'; } }
  function A(k) { var l = lang(); return (AUTH_T[l] || AUTH_T.ar)[k]; }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- auth screen ---------- */
  function authScreen(mode, msg) {
    var el = document.getElementById('auth');
    if (!el) { el = document.createElement('div'); el.id = 'auth'; document.body.appendChild(el); }
    el.style.cssText = 'position:fixed;inset:0;z-index:100;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
    el.dir = lang() === 'ar' ? 'rtl' : 'ltr';
    var recovery = mode === 'recovery';
    el.innerHTML = '<form id="auth-form" class="card" style="width:min(400px,100%);display:flex;flex-direction:column;gap:12px" onsubmit="return false">' +
      '<img src="logo.png" alt="" width="84" height="80" style="align-self:center"><h1 style="font-size:22px;text-align:center">' + h(A('title')) + '</h1><p class="sub" style="margin:0;color:var(--muted)">' + h(A('hint')) + '</p>' +
      (mode === 'request' ? '<p class="sub" style="margin:0;color:var(--muted)">' + (lang() === 'ar' ? 'أدخل بياناتك وسترسل الإدارة موافقتها. بعد الموافقة ادخل برقمك (الأكاديمي أو الوظيفي) وكلمة المرور 12345678 ثم غيّرها.' : 'Enter your details; the administration will approve. After approval sign in with your academic number and 12345678, then change it.') + '</p>' +
        '<label>' + (lang() === 'ar' ? 'أنا' : 'I am') + '<select id="rq-kind"><option value="student">' + (lang() === 'ar' ? 'طالب' : 'Student') + '</option><option value="staff">' + (lang() === 'ar' ? 'موظف / عضو هيئة تدريس' : 'Staff / faculty') + '</option></select></label>' +
        '<label>' + (lang() === 'ar' ? 'الرقم الأكاديمي (للموظف: الرقم الوظيفي)' : 'Academic number (staff: employee number)') + '<input id="rq-num" dir="ltr" required></label>' +
        '<label>' + (lang() === 'ar' ? 'الاسم الكامل' : 'Full name') + '<input id="rq-name" required></label>' +
        '<label>' + (lang() === 'ar' ? 'التخصص / القسم (اختياري)' : 'Major (optional)') + '<input id="rq-major"></label>' +
        '<label>' + (lang() === 'ar' ? 'رقم الجوال (اختياري)' : 'Phone (optional)') + '<input id="rq-phone" dir="ltr"></label>' :
      recovery ? '' : mode === 'login' ? '<label>' + h(A('ident')) + '<input id="au-email" type="text" dir="ltr" autocomplete="username" autocapitalize="none" required></label>' : '<label>' + h(A('email')) + '<input id="au-email" type="email" autocomplete="email" required></label>') +
      (mode === 'forgot' || mode === 'request' ? '' : '<label>' + h(recovery ? A('newPass') : A('pass')) + '<input id="au-pass" type="password" autocomplete="' + (mode === 'signup' || recovery ? 'new-password' : 'current-password') + '" minlength="8" required></label>') +
      '<div id="au-msg" class="pill ' + (msg && msg.ok ? 'ok' : 'bad') + '"' + (msg ? '' : ' hidden') + '>' + h(msg ? msg.t : '') + '</div>' +
      '<button class="btn pri" id="au-go" type="submit" style="justify-content:center">' + h(recovery ? A('setPass') : mode === 'request' ? A('request') : mode === 'forgot' ? A('sendReset') : mode === 'signup' ? A('signup') : A('login')) + '</button>' +
      (recovery ? '' : '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between">' +
        (mode !== 'login' ? '<button class="btn sm" type="button" data-m="login">' + h(A('login')) + '</button>' : '') +
        (mode !== 'signup' ? '<button class="btn sm" type="button" data-m="signup">' + h(A('signup')) + '</button>' : '') +
        (mode !== 'request' ? '<button class="btn sm" type="button" data-m="request">' + h(A('request')) + '</button>' : '') +
        (mode !== 'forgot' ? '<button class="btn sm" type="button" data-m="forgot">' + h(A('forgot')) + '</button>' : '') + '</div>' +
        '') +
      '</form>';
    var form = el.querySelector('form');
    Array.prototype.forEach.call(el.querySelectorAll('[data-m]'), function (b) { b.onclick = function () { authScreen(b.getAttribute('data-m')); }; });
    
    form.onsubmit = async function (e) {
      e.preventDefault();
      var typed = '', email = (document.getElementById('au-email') || {}).value, pass = (document.getElementById('au-pass') || {}).value;
      if (mode === 'request') {
        var g = function (i) { return ((document.getElementById(i) || {}).value || '').trim(); };
        var num = g('rq-num').replace(/[\u0660-\u0669]/g, function (d) { return d.charCodeAt(0) - 1632; });
        try {
          var rr = await sb.rpc('comm_request_signup', { p_number: num, p_name: g('rq-name'), p_major: g('rq-major'), p_phone: g('rq-phone'), p_kind: g('rq-kind') || 'student' });
          if (rr.error) throw rr.error;
          var M = { ok: [1, 'تم إرسال الطلب. انتظر موافقة الإدارة ثم ادخل برقمك وكلمة المرور 12345678.', 'Request sent. Wait for approval, then sign in with your number and 12345678.'], exists: [1, 'لديك حساب بالفعل: ادخل برقمك وكلمة المرور.', 'You already have an account: sign in.'], pending: [1, 'طلبك قيد المراجعة بالفعل.', 'Your request is already pending.'], invalid: [0, 'تحقق من الرقم والاسم.', 'Check the number and name.'], full: [0, 'تعذّر استلام الطلب الآن. تواصل مع الإدارة.', 'Cannot accept requests now. Contact the administration.'] }[rr.data] || [0, 'خطأ', 'Error'];
          return authScreen(M[0] ? 'login' : 'request', { ok: M[0], t: lang() === 'ar' ? M[1] : M[2] });
        } catch (err) { return authScreen('request', { t: (err && err.message) || A('bad') }); }
      }
      if (mode !== 'forgot' && (!pass || pass.length < 8)) return authScreen(mode, { t: A('short') });
      try {
        var r;
        if (recovery) { r = await sb.auth.updateUser({ password: pass }); if (r.error) throw r.error; el.remove(); await takeSession(); return; }
        if (mode === 'login') { typed = email; email = await resolveLogin(email); r = await sb.auth.signInWithPassword({ email: email, password: pass }); if (r.error) throw r.error; try { sb.rpc('comm_log_event', { p_kind: 'login', p_ua: navigator.userAgent }).then(function () {}, function () {}); } catch (e0) {} el.remove(); await takeSession(); }
        else if (mode === 'signup') { r = await sb.auth.signUp({ email: email, password: pass, options: { emailRedirectTo: location.origin + location.pathname } }); if (r.error) throw r.error; if (r.data.session) { el.remove(); await takeSession(); } else authScreen('login', { ok: 1, t: A('checkMail') }); }
        else { r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (r.error) throw r.error; authScreen('login', { ok: 1, t: A('checkMail') }); }
      } catch (err) { if (mode === 'login') { try { sb.rpc('comm_log_event', { p_kind: 'login_fail', p_who: typed, p_msg: (err && err.message) || '', p_ua: navigator.userAgent }).then(function () {}, function () {}); } catch (e1) {} } authScreen(mode, { t: (err && err.message) || A('bad') }); }
    };
  }
  async function resolveLogin(id) {
    id = String(id || '').trim();
    if (id.indexOf('@') > -1) return id;
    try { var r = await sb.rpc('comm_resolve_login', { p_id: id }); if (r && r.data) return r.data; } catch (e) {}
    return id.toLowerCase() + '@planner.local';
  }
  /* ---------- role context: what this account may see ---------- */
  window.CTX = null; window.COMM_ONLY = false; window.HAS_COMM = false;
  function applyCtx(c) {
    window.CTX = c || null;
    var role = c && c.role;
    window.HAS_COMM = !!role;
    window.COMM_ONLY = !!role && role !== 'admin' && !c.planner;
  }
  async function loadCtx() {
    var key = 'planner_ctx_' + (user && user.id);
    try {
      var r = await sb.rpc('comm_my_context');
      if (!r.error && r.data) { applyCtx(r.data); try { localStorage.setItem(key, JSON.stringify(r.data)); } catch (e) {} return; }
      if (r.error && /comm_my_context|function/i.test(r.error.message || '')) { applyCtx(null); return; }   // comm-schema.sql not installed
    } catch (e) {}
    try { applyCtx(JSON.parse(localStorage.getItem(key) || 'null')); } catch (e) { applyCtx(null); }       // offline: last known context
  }
  function forceChange() {
    return new Promise(function (resolve) {
      var el = document.getElementById('auth') || document.createElement('div'); el.id = 'auth';
      document.body.appendChild(el);
      el.style.cssText = 'position:fixed;inset:0;z-index:100;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
      el.dir = lang() === 'ar' ? 'rtl' : 'ltr';
      var ar = lang() === 'ar';
      function draw(msg) {
        el.innerHTML = '<form class="card" style="width:min(400px,100%);display:flex;flex-direction:column;gap:12px" onsubmit="return false">' +
          '<h1 style="font-size:20px">' + (ar ? 'غيّر كلمة المرور' : 'Change your password') + '</h1>' +
          '<p class="sub" style="margin:0;color:var(--muted)">' + (ar ? 'هذه أول مرة تدخل فيها بكلمة المرور الافتراضية. اختر كلمة مرور جديدة قبل المتابعة.' : 'You signed in with the default password. Choose a new one to continue.') + '</p>' +
          '<label>' + (ar ? 'كلمة المرور الجديدة (8 أحرف على الأقل)' : 'New password (min 8)') + '<input id="fc-1" type="password" autocomplete="new-password" minlength="8" required></label>' +
          '<label>' + (ar ? 'أعد كتابتها' : 'Repeat it') + '<input id="fc-2" type="password" autocomplete="new-password" minlength="8" required></label>' +
          '<div class="pill bad"' + (msg ? '' : ' hidden') + '>' + h(msg || '') + '</div>' +
          '<button class="btn pri" type="submit" style="justify-content:center">' + (ar ? 'حفظ ومتابعة' : 'Save and continue') + '</button>' +
          '<button class="btn sm" type="button" id="fc-out">' + (ar ? 'تسجيل الخروج' : 'Sign out') + '</button></form>';
        el.querySelector('#fc-out').onclick = async function () { try { await sb.auth.signOut(); } catch (e) {} try { localStorage.removeItem(LAST_USER_KEY); } catch (e) {} location.reload(); };
        el.querySelector('form').onsubmit = async function (e) {
          e.preventDefault();
          var a = el.querySelector('#fc-1').value, b = el.querySelector('#fc-2').value;
          if (a.length < 8) return draw(ar ? 'كلمة المرور 8 أحرف على الأقل' : 'At least 8 characters');
          if (a !== b) return draw(ar ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match');
          if (a === '12345678' || /^(\d)\1+$/.test(a)) return draw(ar ? 'اختر كلمة مرور أقوى من الافتراضية' : 'Choose something stronger than the default');
          var r = await sb.auth.updateUser({ password: a });
          if (r.error) return draw(r.error.message);
          await sb.rpc('comm_password_changed');
          if (window.CTX) window.CTX.must_change = false;
          el.remove(); resolve();
        };
      }
      draw();
    });
  }
  async function takeSession() {
    var r = await sb.auth.getSession();
    var s = r && r.data && r.data.session;
    if (s) { user = { id: s.user.id, email: s.user.email }; try { localStorage.setItem(LAST_USER_KEY, JSON.stringify(user)); } catch (e) {} st.needLogin = false; }
    finishAuth();
  }
  function finishAuth() { if (authResolve) { var f = authResolve; authResolve = null; f(); } }

  window.authInit = function () {
    if (!enabled) return Promise.resolve();
    sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    sb.auth.onAuthStateChange(function (ev) { if (ev === 'PASSWORD_RECOVERY') authScreen('recovery'); if (ev === 'SIGNED_OUT' && user) { user = null; location.reload(); } });
    return new Promise(async function (resolve) {
      authResolve = resolve;
      var s = null;
      try { var r = await sb.auth.getSession(); s = r && r.data && r.data.session; } catch (e) {}
      if (s) { user = { id: s.user.id, email: s.user.email }; try { localStorage.setItem(LAST_USER_KEY, JSON.stringify(user)); } catch (e) {} return finishAuth(); }
      var last = null; try { last = JSON.parse(localStorage.getItem(LAST_USER_KEY) || 'null'); } catch (e) {}
      if (last && !navigator.onLine) { user = last; st.needLogin = true; return finishAuth(); }   // offline: open the last account's local data
      if (/type=recovery/.test(location.hash)) return;                                          // recovery screen opens from the auth event
      authScreen('login');
    }).then(async function () {
      if (user) {
        await loadCtx();
        if (window.CTX && window.CTX.must_change && navigator.onLine) await forceChange();
        window.setDbName('my-daily-planner-' + user.id); window.SKIP_SEED = true;
      }
    });
  };

  /* ---------- change tracking ---------- */
  function recs() {
    var re = Object.keys(S.meta.reportEdits || {}).map(function (k) { return Object.assign({ id: 'r_' + k.replace('|', '_'), key: k }, S.meta.reportEdits[k]); });
    return { appts: S.appts, tasks: S.tasks, follows: S.follows, reports: re, settings: [{ id: 'prefs', lang: S.meta.lang, theme: S.meta.theme }] };
  }
  function strip(r) { var c = Object.assign({}, r); delete c._u; return JSON.stringify(c); }
  function diff(kind) {
    if (!user) return;
    var list = recs()[kind] || [], seen = {}, now = Date.now();
    list.forEach(function (r) {
      var key = kind + '|' + r.id; seen[key] = 1;
      var j = strip(r);
      if (shadow[key] !== j) { shadow[key] = j; if (kind !== 'settings' && kind !== 'reports') r._u = now; outbox[key] = { kind: kind, id: r.id, del: false, u: now }; }
    });
    Object.keys(shadow).forEach(function (key) {
      if (key.indexOf(kind + '|') === 0 && !seen[key]) { delete shadow[key]; outbox[key] = { kind: kind, id: key.slice(kind.length + 1), del: true, u: now }; }
    });
    persist();
  }
  function persist() {
    if (typeof DB === 'undefined' || !DB) return;
    try { idbPut('sync_outbox', outbox); idbPut('sync_shadow', shadow); idbPut('sync_cursor', cursor); } catch (e) {}
  }
  window.onLocalSave = function (k) {
    if (!enabled || !user || window.COMM_ONLY) return;
    if (k === 'meta') { diff('reports'); diff('settings'); } else diff(k);
    clearTimeout(timer); timer = setTimeout(sync, 1200);
  };

  /* ---------- sync ---------- */
  function pending() { return Object.keys(outbox).length; }
  function findRec(kind, id) { return (recs()[kind] || []).filter(function (r) { return r.id === id; })[0]; }
  async function push() {
    var keys = Object.keys(outbox).slice(0, 60), needPull = false;
    for (var i = 0; i < keys.length; i++) {
      var o = outbox[keys[i]], rec = o.del ? null : findRec(o.kind, o.id);
      if (!o.del && !rec) { delete outbox[keys[i]]; continue; }
      var data = rec ? JSON.parse(strip(rec)) : {};
      var r = await sb.rpc('upsert_record', { p_kind: o.kind, p_id: String(o.id), p_data: data, p_updated: new Date(o.u).toISOString(), p_deleted: !!o.del });
      if (r.error) throw r.error;
      if (r.data && r.data.applied === false) {            // the server copy is newer: keep our losing copy in a local conflict log, then take the server copy
        (S.meta.conflicts = S.meta.conflicts || []).push({ kind: o.kind, id: o.id, at: new Date().toISOString(), local: data });
        S.meta.conflicts = S.meta.conflicts.slice(-20); needPull = true;
        delete shadow[keys[i]];
      }
      delete outbox[keys[i]];
    }
    persist();
    return needPull;
  }
  function applyRemote(row, touched) {
    var key = row.kind + '|' + row.id, ob = outbox[key];
    var localRec = row.kind === 'settings' || row.kind === 'reports' ? null : findRec(row.kind, row.id);
    if (ob && localRec && (localRec._u || 0) > new Date(row.updated_at).getTime()) return;   // newer local edit still waiting to be pushed
    var d = row.data || {};
    if (row.kind === 'settings') { if (!row.deleted) { if (d.lang) S.meta.lang = d.lang; if (d.theme) S.meta.theme = d.theme; shadow[key] = strip({ id: 'prefs', lang: S.meta.lang, theme: S.meta.theme }); } touched.meta = 1; return; }
    if (row.kind === 'reports') {
      if (row.deleted) delete S.meta.reportEdits[d.key]; else if (d.key) { var v = Object.assign({}, d); delete v.id; delete v.key; S.meta.reportEdits[d.key] = v; shadow[key] = strip(Object.assign({ id: row.id, key: d.key }, v)); }
      touched.meta = 1; return;
    }
    var arr = S[row.kind], idx = arr.findIndex(function (x) { return x.id === row.id; });
    if (row.deleted) { if (idx > -1) arr.splice(idx, 1); delete shadow[key]; }
    else { var rec = Object.assign({}, d, { _u: new Date(row.updated_at).getTime() }); if (idx > -1) arr[idx] = rec; else arr.push(rec); shadow[key] = strip(rec); }
    delete outbox[key];
    touched[row.kind] = 1;
  }
  async function pull() {
    if (pulling) return; pulling = true;
    try {
      for (;;) {
        var r = await sb.from('records').select('kind,id,data,updated_at,deleted,synced_at').gt('synced_at', cursor).order('synced_at', { ascending: true }).limit(500);
        if (r.error) throw r.error;
        var rows = r.data || [], touched = {};
        rows.forEach(function (row) { applyRemote(row, touched); cursor = row.synced_at; });
        for (var k in touched) await idbPut(k, S[k]);
        if (touched.meta) { await idbPut('meta', S.meta); }
        persist();
        if (Object.keys(touched).length && typeof render === 'function') render();
        if (rows.length < 500) break;
      }
    } finally { pulling = false; }
  }
  async function loadAccess() {
    try {
      var r = await sb.rpc('planner_me');
      if (r.error) { st.access = null; return; }              // access-control.sql not installed: no restriction
      st.access = r.data || null;
      if (st.access && st.access.admin) await loadUsers(true);
    } catch (e) { st.access = null; }
  }
  async function loadUsers(quiet) {
    try {
      var r = await sb.rpc('planner_list_users');
      if (r.error) throw r.error;
      st.users = r.data || []; st.usersErr = '';
    } catch (e) { st.usersErr = (e && e.message) || 'error'; }
    if (!quiet && typeof render === 'function' && UI.view === 'settings') render();
  }
  async function sync() {
    if (!enabled || !user || !sb || st.syncing) return;
    st.online = navigator.onLine;
    if (!st.online) { if (typeof render === 'function' && UI.view === 'settings') render(); return; }
    st.syncing = true; st.err = '';
    try {
      if (!st.access) await loadAccess();
      if (st.access && !st.access.allowed) { st.syncing = false; if (typeof render === 'function' && (UI.view === 'dash' || UI.view === 'settings')) render(); return; }
      var s = await sb.auth.getSession();
      if (!(s.data && s.data.session)) { st.needLogin = true; throw new Error('login'); }
      st.needLogin = false;
      KINDS.forEach(diff);
      var again = await push(); await pull(); if (again) { await push(); }
      st.last = Date.now();
    } catch (e) { st.err = (e && e.message) || 'sync error'; }
    st.syncing = false;
    if (typeof render === 'function' && (UI.view === 'dash' || UI.view === 'settings') && !document.getElementById('modal').classList.contains('on')) render();
  }
  window.syncStart = async function () {
    if (!enabled || !user || window.COMM_ONLY) return;
    try { var o = await idbGet('sync_outbox'), sh = await idbGet('sync_shadow'), c = await idbGet('sync_cursor'); if (o) outbox = o; if (sh) shadow = sh; if (c) cursor = c; } catch (e) {}
    window.addEventListener('online', function () { st.online = true; sync(); });
    window.addEventListener('offline', function () { st.online = false; if (UI.view === 'dash') render(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); });
    setInterval(sync, 60000);
    try {
      chan = sb.channel('records-' + user.id).on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: 'user_id=eq.' + user.id }, function () { sync(); }).subscribe();
    } catch (e) {}
    sync();
  };

  window.PLANNER_AUTH = { sb: function () { return sb; }, user: function () { return user; }, lang: lang, h: h };

  /* ---------- UI hooks ---------- */
  window.syncBanner = function () {
    var ar = lang() === 'ar';
    if (!enabled) return ar ? 'وضع محلي: البيانات محفوظة على هذا الجهاز فقط ولا تتم مزامنتها. فعّل Supabase في config.js لتفعيل الحسابات والمزامنة.' : 'Local mode: data is stored on this device only and is not synced. Set up Supabase in config.js to enable accounts and sync.';
    if (!user) return ar ? 'أنت تعمل دون حساب: البيانات على هذا الجهاز فقط ولن تتم مزامنتها.' : 'No account: data stays on this device and will not sync.';
    if (st.access && !st.access.allowed) return ar ? 'هذا الحساب (' + (user.email || '') + ') غير مسموح له باستخدام التطبيق. اطلب من المسؤول إضافة بريدك ثم أعد فتح التطبيق.' : 'This account (' + (user.email || '') + ') is not allowed to use the app. Ask the administrator to add your email, then reopen the app.';
    if (st.needLogin) return ar ? 'انتهت جلسة الدخول. سجّل الدخول مجدداً لمزامنة ' + pending() + ' تغيير معلّق.' : 'Your session expired. Sign in again to sync ' + pending() + ' pending change(s).';
    if (!navigator.onLine) return ar ? 'لا يوجد اتصال. التغييرات تُحفظ على الجهاز وتُزامن عند عودة الاتصال (' + pending() + ' معلّق).' : 'Offline. Changes are saved on the device and sync when you reconnect (' + pending() + ' pending).';
    if (st.err) return (ar ? 'تعذّرت المزامنة: ' : 'Sync failed: ') + st.err + ' (' + pending() + ')';
    if (pending() > 0) return ar ? pending() + ' تغيير بانتظار المزامنة.' : pending() + ' change(s) waiting to sync.';
    return '';
  };
  window.accountSection = function () {
    var ar = lang() === 'ar';
    if (!enabled) return '<section class="card"><h2>' + (ar ? 'الحساب والمزامنة' : 'Account & sync') + '</h2><p class="sub">' + h(window.syncBanner()) + '</p></section>';
    if (!user) return '<section class="card"><h2>' + (ar ? 'الحساب والمزامنة' : 'Account & sync') + '</h2><p class="sub">' + h(window.syncBanner()) + '</p><button class="btn pri" data-act="auth-open">' + h(A('login')) + '</button></section>';
    var last = st.last ? new Date(st.last).toLocaleString() : '—';
    return '<section class="card"><h2>' + (ar ? 'الحساب والمزامنة' : 'Account & sync') + '</h2><p class="sub">' + h(user.email || '') + '</p>' +
      '<p class="sub">' + (ar ? 'الاتصال: ' : 'Connection: ') + (navigator.onLine ? (ar ? 'متصل' : 'online') : (ar ? 'غير متصل' : 'offline')) + ' · ' + (ar ? 'معلّق: ' : 'Pending: ') + pending() + ' · ' + (ar ? 'آخر مزامنة: ' : 'Last sync: ') + h(last) + '</p>' +
      (st.err ? '<p class="pill bad">' + h(st.err) + '</p>' : '') +
      ((S.meta.conflicts || []).length ? '<p class="sub">' + (ar ? 'تعارضات حُلّت بالأحدث: ' : 'Conflicts resolved by newest: ') + S.meta.conflicts.length + '</p>' : '') +
      '<div class="tabs"><button class="btn pri" data-act="sync-now">' + (ar ? 'مزامنة الآن' : 'Sync now') + '</button>' +
      (C.VAPID_PUBLIC_KEY ? '<button class="btn" data-act="push-enable">' + (ar ? 'تفعيل إشعارات الخادم (Web Push)' : 'Enable server push') + '</button>' : '') +
      '<button class="btn" data-act="sign-out">' + (ar ? 'تسجيل الخروج' : 'Sign out') + '</button></div></section>' + adminSection();
  };
  function adminSection() {
    if (!(st.access && st.access.admin)) return '';
    var ar = lang() === 'ar';
    var rows = (st.users || []).map(function (u) {
      var me = user && (user.email || '').toLowerCase() === u.email;
      return '<div class="row"><div class="main"><div class="t" style="direction:ltr;text-align:start">' + h(u.email) + '</div></div><div class="act">' +
        (u.is_admin ? '<span class="pill">' + (ar ? 'مسؤول' : 'Admin') + '</span>' : '') +
        (me ? '' : '<button class="btn sm bad" data-act="user-remove" data-email="' + h(u.email) + '" data-confirm="1">' + (ar ? 'إزالة' : 'Remove') + '</button>') + '</div></div>';
    }).join('');
    return '<section class="card" style="grid-column:1/-1"><h2>' + (ar ? 'إدارة المستخدمين' : 'Manage users') + '</h2>' +
      '<p class="sub">' + (ar ? 'يستطيع استخدام التطبيق من تضيف بريده هنا فقط. يسجّل الشخص حسابه من شاشة «إنشاء حساب» بالبريد نفسه.' : 'Only emails listed here can use the app. The person signs up from the sign-up screen with the same email.') + '</p>' +
      (st.usersErr ? '<p class="pill bad">' + h(st.usersErr) + '</p>' : '') +
      '<div class="form" style="margin-bottom:12px"><label>' + (ar ? 'بريد الشخص' : 'Email') + '<input id="pu-email" type="email" dir="ltr" autocomplete="off"></label>' +
      '<label class="ck" style="align-self:end"><input id="pu-admin" type="checkbox">' + (ar ? 'مسؤول أيضاً' : 'Also admin') + '</label>' +
      '<div style="align-self:end"><button class="btn pri" data-act="user-add">' + (ar ? 'إضافة' : 'Add') + '</button></div></div>' +
      (rows ? '<div class="list">' + rows + '</div>' : '<div class="empty">' + (ar ? 'جارٍ التحميل…' : 'Loading…') + '</div>') + '</section>';
  }
  function b64(s) { var p = '='.repeat((4 - s.length % 4) % 4), b = (s + p).replace(/-/g, '+').replace(/_/g, '/'), raw = atob(b), a = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i); return a; }
  window.EXTRA_ACT = {
    'sync-now': function () { st.access = null; sync(); },
    'user-add': async function () {
      var em = (document.getElementById('pu-email') || {}).value || '', adm = !!(document.getElementById('pu-admin') || {}).checked;
      em = em.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { st.usersErr = lang() === 'ar' ? 'بريد غير صالح' : 'Invalid email'; return render(); }
      var r = await sb.rpc('planner_add_user', { p_email: em, p_admin: adm });
      if (r.error) { st.usersErr = r.error.message; return render(); }
      toast(lang() === 'ar' ? 'تمت الإضافة' : 'Added'); loadUsers();
    },
    'user-remove': async function (el) {
      var r = await sb.rpc('planner_remove_user', { p_email: el.dataset.email });
      if (r.error) { st.usersErr = r.error.message; return render(); }
      toast(lang() === 'ar' ? 'تمت الإزالة' : 'Removed'); loadUsers();
    },
    'auth-open': function () { authResolve = function () { location.reload(); }; authScreen('login'); },
    'sign-out': async function () { try { await sb.rpc('comm_log_event', { p_kind: 'logout', p_ua: navigator.userAgent }); } catch (e) {} try { await sb.auth.signOut(); } catch (e) {} try { localStorage.removeItem(LAST_USER_KEY); } catch (e) {} location.reload(); },
    'push-enable': async function () {
      try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return toast('Push not supported here');
        var perm = await Notification.requestPermission(); if (perm !== 'granted') return;
        var reg = await navigator.serviceWorker.ready;
        var sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(C.VAPID_PUBLIC_KEY) });
        var j = sub.toJSON();
        var r = await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, keys: j.keys, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }, { onConflict: 'user_id,endpoint' });
        if (r.error) throw r.error; st.pushOn = true; toast('OK');
      } catch (e) { toast(e.message || 'push error'); }
    }
  };
})();
