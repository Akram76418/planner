// Supabase Edge Function: sends due appointment reminders via Web Push.
// Run every minute with pg_cron (see README). Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET.
// The service_role key is available to Edge Functions as SUPABASE_SERVICE_ROLE_KEY and never reaches the browser.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

// Convert a wall-clock "YYYY-MM-DD" + "HH:MM" in a time zone to a UTC timestamp (ms).
function zonedToUtc(date: string, time: string, tz: string): number {
  const guess = Date.parse(`${date}T${time || '09:00'}:00Z`);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
  const g = (t: string) => Number(parts.find(p => p.type === t)!.value);
  const asLocal = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
  return guess - (asLocal - guess);
}

async function reminders(): Promise<number> {
  const now = Date.now(), windowMs = 3 * 60_000;
  const { data: subs } = await sb.from('push_subscriptions').select('*');
  const byUser = new Map<string, any[]>();
  (subs ?? []).forEach(s => byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]));
  let sent = 0;
  for (const [userId, list] of byUser) {
    const tz = list[0].tz || 'UTC';
    const { data: rows } = await sb.from('records').select('id,data').eq('user_id', userId).eq('kind', 'appts').eq('deleted', false);
    for (const r of rows ?? []) {
      const a = r.data; if (!a || a.status === 'done' || a.status === 'cancelled') continue;
      const base = zonedToUtc(a.date, a.start, tz);
      const times: { at: number; off: number }[] = (a.rem?.offs ?? []).map((o: number) => ({ at: base - o * 60000, off: o }));
      if (a.rem?.custom) times.push({ at: zonedToUtc(a.rem.custom.slice(0, 10), a.rem.custom.slice(11, 16), tz), off: -1 });
      for (const t of times) {
        if (t.at > now || t.at < now - windowMs) continue;
        const key = `${r.id}|${t.at}`;
        const ins = await sb.from('reminders_sent').insert({ user_id: userId, key });   // primary key blocks duplicates
        if (ins.error) continue;
        for (const s of list) {
          try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: a.title, body: `${a.date} ${a.start ?? ''}`, tag: key })); sent++; }
          catch (e: any) { if (e.statusCode === 404 || e.statusCode === 410) await sb.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', s.endpoint); }
        }
      }
    }
    // المتابعات اليومية: تنبيه عند حلول تاريخ الاستحقاق (9 صباحاً بتوقيت المستخدم) كأنها مهمة
    const { data: fl } = await sb.from('records').select('id,data').eq('user_id', userId).eq('kind', 'follows').eq('deleted', false);
    for (const r of fl ?? []) {
      const f = r.data; if (!f || f.status === 'done' || !f.due) continue;
      const at = zonedToUtc(f.due, '09:00', tz);
      if (at > now || at < now - windowMs) continue;
      const key = `${r.id}|due|${f.due}`;
      const ins = await sb.from('reminders_sent').insert({ user_id: userId, key });
      if (ins.error) continue;
      for (const s of list) {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: '⏰ ' + f.title, body: 'انتهت المدة المخصصة لهذه المتابعة', tag: key })); sent++; }
        catch (e: any) { if (e.statusCode === 404 || e.statusCode === 410) await sb.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', s.endpoint); }
      }
    }
  }
  return sent;
}

// ───── إشعارات التواصل: رسائل فردية، قنوات الموظفين، إعلانات الشعب ─────
const CH_NAME: Record<string, string> = { all: 'الجميع', academic: 'أكاديمي', practical: 'مشرف عملي', admin: 'إداري' };
const clip = (t: string, n = 120) => (t ?? '').length > n ? t.slice(0, n) + '…' : (t ?? '');

async function messages(): Promise<number> {
  const nowIso = new Date().toISOString();
  const st = await sb.from('comm_push_state').select('last_ts').eq('id', 1).maybeSingle();
  if (st.error) return 0;                                   // comm-push.sql not installed yet
  if (!st.data) { await sb.from('comm_push_state').upsert({ id: 1, last_ts: nowIso }); return 0; }   // first run: start from now
  const from = st.data.last_ts as string;
  const items = new Map<string, { title: string; body: string }[]>();
  const add = (uid: string, title: string, body: string) => items.set(uid, [...(items.get(uid) ?? []), { title, body: clip(body) }]);

  const dm = await sb.from('communication_notifications').select('user_id,title,body').gt('created_at', from).lte('created_at', nowIso).limit(500);
  (dm.data ?? []).forEach((n: any) => add(n.user_id, n.title || 'رسالة جديدة', n.body));

  const ch = await sb.from('comm_channel_messages').select('channel,sender_id,body').gt('created_at', from).lte('created_at', nowIso).limit(300);
  if (ch.data?.length) {
    const { data: staff } = await sb.from('profiles').select('id,role,full_name').in('role', ['admin', 'professor', 'staff']);
    const { data: cats } = await sb.from('comm_staff_categories').select('user_id,category');
    const catOf = new Map((cats ?? []).map((c: any) => [c.user_id, c.category]));
    const roleOf = new Map((staff ?? []).map((u: any) => [u.id, u.role]));
    const nameOf = new Map((staff ?? []).map((u: any) => [u.id, u.full_name]));
    for (const m of ch.data) for (const u of staff ?? []) {
      if (u.id === m.sender_id) continue;
      if (u.role === 'admin' || u.role === 'professor' || m.channel === 'all' || catOf.get(u.id) === m.channel) add(u.id, `قناة ${CH_NAME[m.channel] ?? m.channel}`, `${u.role !== 'admin' && roleOf.get(m.sender_id) === 'admin' ? 'PCN' : (nameOf.get(m.sender_id) ?? '')}: ${m.body}`);
    }
  }

  const an = await sb.from('comm_announcements').select('cohort_id,title,body').gt('created_at', from).lte('created_at', nowIso).limit(100);
  if (an.data?.length) {
    const { data: mem } = await sb.from('comm_cohort_members').select('user_id,cohort_id').in('cohort_id', [...new Set(an.data.map((a: any) => a.cohort_id))]);
    for (const a of an.data) for (const m of (mem ?? []).filter((x: any) => x.cohort_id === a.cohort_id)) add(m.user_id, a.title || 'إعلان جديد من الإدارة', a.body);
  }

  let sent = 0;
  if (items.size) {
    const { data: subs } = await sb.from('push_subscriptions').select('*').in('user_id', [...items.keys()]);
    for (const [uid, list] of items) {
      const my = (subs ?? []).filter((s: any) => s.user_id === uid);
      if (!my.length) continue;
      const out = list.length > 3 ? [{ title: 'التواصل', body: `${list.length} رسائل جديدة` }] : list;
      for (const n of out) for (const s of my) {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: n.title, body: n.body, tag: 'comm-' + uid, url: './index.html' })); sent++; }
        catch (e: any) { if (e.statusCode === 404 || e.statusCode === 410) await sb.from('push_subscriptions').delete().eq('user_id', uid).eq('endpoint', s.endpoint); }
      }
    }
  }
  await sb.from('comm_push_state').upsert({ id: 1, last_ts: nowIso });
  return sent;
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('forbidden', { status: 403 });
  let sent = 0, msgs = 0;
  try { sent = await reminders(); } catch (e) { console.error('reminders', e); }
  try { msgs = await messages(); } catch (e) { console.error('messages', e); }
  return new Response(JSON.stringify({ sent, msgs }), { headers: { 'content-type': 'application/json' } });
});

