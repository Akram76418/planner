// admin-accounts: ينشئ حسابات الطلبة/الموظفين من قائمة، ويعيد كلمة المرور الافتراضية. للمدير فقط.
// يستخدم مفتاح الخدمة الموجود تلقائياً في بيئة الدالة (لا يُوضع في التطبيق ولا يُرسل لأحد).
import { createClient } from 'npm:@supabase/supabase-js@2';

const DEFAULT_PW = '12345678';
const DOMAIN = 'planner.local';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ error: 'unauthorized' }, 401);
    const { data: me } = await admin.from('profiles').select('role').eq('id', u.user.id).maybeSingle();
    if (!me || me.role !== 'admin') return json({ error: 'admin only' }, 403);

    const body = await req.json();

    if (body.action === 'reset') {
      // إعادة كلمة المرور إلى الافتراضية: لحساب واحد (user_id) أو لقائمة (ids) أو لمجموعة كاملة (scope + after، على دفعات).
      const resetOne = async (id: string) => {
        const { data: t } = await admin.from('profiles').select('id, role').eq('id', id).maybeSingle();
        if (!t) return 'missing';
        if (t.role === 'admin') return 'skipped';
        const r = await admin.auth.admin.updateUserById(t.id, { password: DEFAULT_PW });
        if (r.error) return 'error:' + r.error.message;
        await admin.from('comm_pw_status').upsert({ user_id: t.id, must_change: true, changed_at: null });
        return 'ok';
      };
      let ids: string[] = [];
      let next: string | null = null, done = true;
      if (body.scope) {
        const roles = body.scope === 'students' ? ['student'] : body.scope === 'staff' ? ['professor', 'staff'] : ['student', 'professor', 'staff'];
        let q = admin.from('profiles').select('id').in('role', roles).order('id', { ascending: true }).limit(40);
        if (typeof body.after === 'string' && body.after) q = q.gt('id', body.after);
        const { data: rows } = await q;
        ids = (rows ?? []).map((x: any) => x.id);
        if (ids.length === 40) { next = ids[ids.length - 1]; done = false; }
      } else {
        ids = (Array.isArray(body.ids) ? body.ids : body.user_id ? [body.user_id] : []).filter((x: unknown) => typeof x === 'string').slice(0, 40);
      }
      let okN = 0, skipped = 0; const errs: string[] = [];
      for (const id of ids) {
        const res = await resetOne(id);
        if (res === 'ok') okN++; else if (res.startsWith('error:')) errs.push(res.slice(6)); else skipped++;
      }
      if (!body.scope && ids.length === 1 && errs.length) return json({ error: errs[0] }, 400);
      return json({ ok: true, reset: okN, skipped, errors: errs.slice(0, 3), next, done });
    }

    if (body.action === 'delete') {
      // حذف أي حساب غير مدير (طالب/موظف). المدراء لا يُحذفون أبداً. كل حساب يُحذف على حدة وتُرجَع نتيجته.
      const ids: string[] = (Array.isArray(body.ids) ? body.ids : []).filter((x: unknown) => typeof x === 'string').slice(0, 200);
      const results: Array<Record<string, unknown>> = [];
      for (const id of ids) {
        if (id === u.user.id) { results.push({ id, status: 'skipped', message: 'self' }); continue; }
        const { data: t } = await admin.from('profiles').select('role').eq('id', id).maybeSingle();
        if (!t) { results.push({ id, status: 'missing' }); continue; }
        if (t.role === 'admin') { results.push({ id, status: 'skipped', message: 'admin' }); continue; }
        // الحذف الكامل (محادثات ورسائل وطلبات) داخل معاملة واحدة عبر comm_purge_student؛ وإن لم تُثبَّت بعد نرجع للحذف البسيط
        let msgs = 0;
        let pg = await admin.rpc('comm_purge_user', { p_id: id });
        if (pg.error && /comm_purge_user|schema cache|does not exist/i.test(pg.error.message) && t.role === 'student') pg = await admin.rpc('comm_purge_student', { p_id: id });
        if (pg.error) {
          if (!/comm_purge_user|comm_purge_student|schema cache|does not exist/i.test(pg.error.message)) { results.push({ id, status: 'error', message: pg.error.message }); continue; }
          const pr = await admin.from('profiles').delete().eq('id', id);
          if (pr.error) { results.push({ id, status: 'error', message: pr.error.message + ' (شغّل staff-accounts.sql للحذف مع الرسائل)' }); continue; }
        } else { msgs = Number((pg.data as any)?.messages || 0); }
        const au = await admin.auth.admin.deleteUser(id);
        if (au.error) { results.push({ id, status: 'error', message: au.error.message }); continue; }
        results.push({ id, status: 'deleted', messages: msgs });
      }
      return json({ results });
    }

    if (body.action === 'wipe') {
      // مسح كل المراسلات (قاعدة البيانات ثم الملفات المرفقة). الحسابات تبقى.
      const w = await admin.rpc('comm_wipe_messages');
      if (w.error) return json({ error: w.error.message }, 400);
      let removed = 0;
      const walk = async (prefix: string, depth: number): Promise<void> => {
        if (depth > 6) return;
        const { data: items } = await admin.storage.from('comm-files').list(prefix, { limit: 1000 });
        const files: string[] = [];
        for (const it of items ?? []) {
          const path = prefix ? `${prefix}/${it.name}` : it.name;
          if (it.id) files.push(path); else await walk(path, depth + 1);
        }
        for (let i = 0; i < files.length; i += 100) {
          const rm = await admin.storage.from('comm-files').remove(files.slice(i, i + 100));
          if (!rm.error) removed += files.slice(i, i + 100).length;
        }
      };
      try { await walk('', 0); } catch (_e) { /* الملفات تُحذف بأفضل جهد */ }
      return json({ ok: true, counts: w.data, files: removed });
    }

    if (body.action === 'create') {
      const rows = Array.isArray(body.rows) ? body.rows.slice(0, 300) : [];
      const allowSameName = body.allow_same_name === true;
      const norm = (t: string) => String(t || '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim().toLowerCase();
      // الموجودون الآن: للمقارنة فقط (الاسم، الرقم الجامعي، رقم الهوية)
      const { data: ex } = await admin.from('profiles').select('full_name, university_id, national_id, employee_number').limit(20000);
      const names = new Set<string>(), nums = new Set<string>(), nids = new Set<string>();
      const addKnown = (n: string, num: string, nid: string) => { if (n) names.add(norm(n)); if (num) { nums.add(num); } if (nid) { nids.add(nid); nums.add(nid); } };
      (ex ?? []).forEach((e: any) => { if (e.university_id) nums.add(String(e.university_id).trim()); if (e.national_id) { nids.add(String(e.national_id).trim()); nums.add(String(e.national_id).trim()); } if (e.employee_number) nums.add(String(e.employee_number).trim()); if (e.full_name) names.add(norm(e.full_name)); });
      const results: Array<Record<string, unknown>> = [];
      for (const r of rows) {
        const number = String(r.number || '').trim();
        const name = String(r.name || '').trim();
        const nid = String(r.national_id || '').trim();
        const role = ['student', 'professor', 'staff'].includes(r.role) ? r.role : 'student';
        if (!/^[A-Za-z0-9]{3,20}$/.test(number) || !name || (nid && !/^[A-Za-z0-9]{5,20}$/.test(nid))) { results.push({ number, status: 'invalid' }); continue; }
        if (nums.has(number) || (nid && (nids.has(nid) || nums.has(nid)))) { results.push({ number, status: 'exists' }); continue; }
        if (!allowSameName && names.has(norm(name))) { results.push({ number, name, status: 'dup_name' }); continue; }
        const c = await admin.auth.admin.createUser({
          email: `${number.toLowerCase()}@${DOMAIN}`, password: DEFAULT_PW, email_confirm: true,
          user_metadata: { full_name: name },
        });
        if (c.error || !c.data.user) { results.push({ number, status: 'error', message: c.error?.message || 'create failed' }); continue; }
        const id = c.data.user.id;
        const prof: Record<string, unknown> = { id, role, full_name: name, university_id: number, major: r.major ? String(r.major) : null };
        if (nid) prof.national_id = nid;
        if (role !== 'student') prof.employee_number = number; // الرقم الوظيفي = اسم المستخدم
        const p = await admin.from('profiles').upsert(prof);
        if (p.error) {
          await admin.auth.admin.deleteUser(id);
          results.push({ number, status: 'error', message: 'profile: ' + p.error.message });
          continue;
        }
        addKnown(name, number, nid);
        await admin.from('comm_pw_status').upsert({ user_id: id, must_change: true });
        if (role === 'student' && Number.isInteger(r.cohort_id)) await admin.from('comm_cohort_members').upsert({ user_id: id, cohort_id: r.cohort_id });
        if (role !== 'student' && ['academic', 'practical', 'admin'].includes(r.category)) await admin.from('comm_staff_categories').upsert({ user_id: id, category: r.category });
        results.push({ number, status: 'created' });
      }
      return json({ results });
    }
    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
