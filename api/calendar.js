// GET /api/calendar?t=<token>  → iCalendar feed of the plan for today and the next 13 days.
// The token is a random string the app stores in the user's cfg row (cal_tok); anyone with the link can read
// the plan names and times, so the app lets the user create a new link at any time.
// Environment: SUPABASE_SERVICE_ROLE_KEY.
import { admin } from "./_lib.js";
import { icsFeed } from "./_reminders.js";

export default async function handler(req, res) {
  const t = String((req.query && req.query.t) || "");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return res.status(400).send("bad link");
  const db = admin();
  if (!db) return res.status(503).send("not configured");
  try {
    const rows = await db.get(`cfg?select=data&data->>cal_tok=eq.${encodeURIComponent(t)}&limit=1`);
    if (!rows || !rows.length) return res.status(404).send("not found");
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", 'inline; filename="daily-life-log.ics"');
    return res.status(200).send(icsFeed(rows[0].data || {}));
  } catch (e) {
    console.error("calendar", e && e.message);
    return res.status(500).send("error");
  }
}
