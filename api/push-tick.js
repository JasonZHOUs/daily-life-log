// Sends due Web Push reminders. Called every 5 minutes by a Supabase pg_cron job (POST, no body).
// POST with ?test=1 and "Authorization: Bearer <Supabase access token>" sends one test notification
// to the caller's devices.
//
// Environment: SUPABASE_SERVICE_ROLE_KEY and VAPID_PRIVATE_KEY (see secrets.local.txt, never committed).
// Calling it more often is harmless: every reminder is logged in public.push_log and sent once.
import webpush from "web-push";
import { VAPID_PUBLIC, admin, checkUser } from "./_lib.js";
import { dueReminders, localNow, settings } from "./_reminders.js";

export async function sendAll(db, send, now = new Date()) {
  const [cfgs, subs, logs] = await Promise.all([
    db.get("cfg?select=user_id,data"),
    db.get("push_subs?select=endpoint,user_id,sub"),
    db.get(`push_log?select=user_id,key&sent_at=gte.${new Date(now - 3 * 864e5).toISOString()}`),
  ]);
  const sentBy = new Map();
  for (const l of logs || []) (sentBy.get(l.user_id) || sentBy.set(l.user_id, new Set()).get(l.user_id)).add(l.key);
  let sent = 0;
  for (const c of cfgs || []) {
    const mine = (subs || []).filter((s) => s.user_id === c.user_id);
    const data = c.data || {};
    if (!mine.length || !settings(data.rem).push) continue;
    const due = dueReminders(data, localNow(data.tz, now), sentBy.get(c.user_id) || new Set());
    for (const r of due) {
      for (const s of mine) {
        const ok = await send(s.sub, { title: r.title, body: r.body, tag: r.tag, url: "/?tab=today" });
        if (ok === "gone") await db.del(`push_subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`);
      }
      await db.post("push_log", { user_id: c.user_id, key: r.key }, "resolution=ignore-duplicates");
      sent++;
    }
  }
  await db.del(`push_log?sent_at=lt.${new Date(now - 4 * 864e5).toISOString()}`);
  return sent;
}

function sender() {
  webpush.setVapidDetails("https://daily-life-log.vercel.app", VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);
  return async (sub, payload) => {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 });
      return "ok";
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) return "gone";
      console.error("push", e && e.statusCode, e && e.body);
      return "error";
    }
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "method" });
  const db = admin();
  if (!db || !process.env.VAPID_PRIVATE_KEY) return res.status(503).json({ error: "not_configured" });
  try {
    if (req.query && req.query.test) {
      const user = await checkUser(req.headers.authorization);
      if (!user) return res.status(401).json({ error: "sign_in" });
      const subs = await db.get(`push_subs?select=endpoint,sub&user_id=eq.${user.id}`);
      const send = sender();
      let n = 0;
      for (const s of subs || []) if ((await send(s.sub, { title: "Daily Life Log", body: "通知已开启 ✓ Notifications are on.", tag: "test", url: "/" })) === "ok") n++;
      return res.status(200).json({ devices: n });
    }
    const sent = await sendAll(db, sender());
    return res.status(200).json({ sent });
  } catch (e) {
    console.error("push-tick", e && e.message);
    return res.status(500).json({ error: "server" });
  }
}
