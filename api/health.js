// GET or POST /api/health?t=<token>&steps=8432&sleep=7.5&active=420[&weight=64.2][&date=YYYY-MM-DD]
// Called by an iPhone Shortcut once a day: a web app cannot read Apple Health, but a Shortcut can, and it
// sends the numbers here. The token is a random string the app stores in the user's cfg row (hl_tok);
// the app can replace it at any time. Values go into that day's row; the date defaults to today in the
// user's time zone. Environment: SUPABASE_SERVICE_ROLE_KEY.
import { admin } from "./_lib.js";
import { localNow } from "./_reminders.js";

// "8,432" / "8 432" → 8432; "7,5" → 7.5 (a comma followed by 1–2 digits is a decimal comma)
export function num(v) {
  if (v == null || v === "") return null;
  let s = String(v).trim().replace(/[\s ]/g, "");
  s = /^\d+,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  const n = parseFloat(s.replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function readHealth(q, tz, now = new Date()) {
  const f = {};
  const steps = num(q.steps);
  if (steps != null && steps >= 0 && steps < 200000) f.stp = String(Math.round(steps));
  // Shortcuts may hand over sleep in hours, minutes or seconds depending on how it was summed
  let sl = num(q.sleep);
  if (sl != null) {
    if (sl > 1440) sl /= 3600;
    else if (sl > 24) sl /= 60;
    if (sl > 0 && sl <= 24) f.sl = String(Math.round(sl * 10) / 10);
  }
  const act = num(q.active);
  if (act != null && act >= 0 && act < 10000) f.hx = Math.round(act);
  const wt = num(q.weight);
  if (wt != null && wt >= 20 && wt <= 300) f.wt = String(Math.round(wt * 10) / 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(q.date || "")) ? String(q.date) : localNow(tz || "Asia/Singapore", now).d;
  return { date, fields: f };
}

// hs = when Health last wrote this day and which fields, so a merge on the phone keeps the newer values.
export function applyHealth(day, fields, at) {
  return { ...(day || {}), ...fields, hs: { at, f: Object.keys(fields) }, _t: at };
}

export default async function handler(req, res) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const q = { ...(req.query || {}), ...body };
  const t = String(q.t || "");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return res.status(400).json({ error: "bad_link" });
  const db = admin();
  if (!db) return res.status(503).json({ error: "not_configured" });
  try {
    const rows = await db.get(`cfg?select=user_id,tz:data->>tz&data->>hl_tok=eq.${encodeURIComponent(t)}&limit=1`);
    if (!rows || !rows.length) return res.status(404).json({ error: "unknown_link" });
    const uid = rows[0].user_id;
    const { date, fields } = readHealth(q, rows[0].tz);
    if (!Object.keys(fields).length) return res.status(400).json({ error: "no_values" });
    const cur = await db.get(`days?select=data&user_id=eq.${uid}&day=eq.${date}&limit=1`);
    const data = applyHealth(cur && cur[0] && cur[0].data, fields, Date.now());
    await db.post("days?on_conflict=user_id,day", [{ user_id: uid, day: date, data, updated_at: new Date().toISOString() }], "resolution=merge-duplicates");
    const msg = [`${date}`, fields.stp && `steps ${fields.stp}`, fields.sl && `sleep ${fields.sl} h`, fields.hx != null && `active ${fields.hx} kcal`, fields.wt && `weight ${fields.wt} kg`].filter(Boolean).join(" · ");
    return res.status(200).json({ ok: true, date, saved: fields, msg });
  } catch (e) {
    console.error("health", e && e.message);
    return res.status(500).json({ error: "server" });
  }
}
