// Pure reminder logic shared by push-tick and calendar (and the tests).
//
// The app keeps these fields in the user's cfg row (public.cfg.data):
//   sched: [{ d:"YYYY-MM-DD", t:"HH:MM", n:"name in the user's language", c:"plan"|"sup"|"note", k:[kinds], x:done, nx:"next item" }]
//          for today and the next 13 days (today's x mirrors the plan ticks)
//   stat:  { d:"YYYY-MM-DD", h2o:cups, dinner:bool }   today's water and whether dinner is logged
//   rem:   { push, plan, sup, water, note, calPre }      reminder settings; calPre = 15-minute alerts come from the calendar
//   tz:    IANA time zone, e.g. "Asia/Singapore"
//   lang:  "zh" | "en"

const DEF = { plan: true, sup: true, water: true, note: true, calPre: false };
export const settings = (rem) => ({ ...DEF, ...(rem || {}) });
const hm = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };

export function localNow(tz = "Asia/Singapore", date = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  } catch {
    return localNow("Asia/Singapore", date);
  }
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { d: `${p.year}-${p.month}-${p.day}`, m: (+p.hour % 24) * 60 + +p.minute };
}

const T = {
  pre: ["Starts in 15 minutes.", "15 分钟后开始。"],
  next: ["Then: ", "接下来："],
  late: ["Not ticked yet. Tick it when done, or move it.", "还没勾选。做完记得勾上，来不及就调整一下。"],
  sumT: ["Today's wrap-up", "今日小结"],
  left: ["Still open: ", "还剩："],
  allDone: ["Everything on today's plan is done.", "今天的计划都完成了。"],
  first: ["Tomorrow starts with ", "明天第一件事："],
  dinT: ["Dinner before the gym", "健身前记得吃晚饭"],
  dinB: ["No dinner logged yet. Eat about 1 to 2 hours before training.", "今天还没记晚饭，训练前 1 到 2 小时吃比较好。"],
  watT: ["Water", "喝水"],
  watB: ["{n} of 8 cups so far. Have a glass now.", "今天喝了 {n} / 8 杯，现在喝一杯吧。"],
};
const tr = (lang, k, n) => T[k][lang === "en" ? 0 : 1].replace("{n}", n);

// Returns the reminders due at `now` that are not in `sent` (a Set of keys).
export function dueReminders(data, now, sent = new Set()) {
  const out = [];
  const rem = settings(data && data.rem);
  const lang = (data && data.lang) || "zh";
  const sched = (data && Array.isArray(data.sched) ? data.sched : []).filter((x) => x && x.d && x.t && x.n);
  const today = sched.filter((x) => x.d === now.d).sort((a, b) => hm(a.t) - hm(b.t));
  const push = (key, title, body, tag) => { if (!sent.has(key)) out.push({ key, title, body, tag: tag || key }); };

  for (const x of today) {
    if (x.x || !rem[x.c || "plan"]) continue;
    const t = hm(x.t), base = `${x.d}|${x.t}|${x.n}`;
    if (!rem.calPre && now.m >= t - 15 && now.m < t)
      push(`${base}|pre`, `${x.t} ${x.n}`, tr(lang, "pre") + (x.nx ? " " + tr(lang, "next") + x.nx : ""), base);
    if (now.m >= t + 10 && now.m < t + 90) push(`${base}|late`, `${x.t} ${x.n}`, tr(lang, "late"), base);
  }

  // Dinner before the gym: only when no dinner is logged today (roadmap D).
  const stat = data && data.stat && data.stat.d === now.d ? data.stat : null;
  const gym = today.find((x) => (x.k || []).includes("gym") && !x.x);
  if (rem.plan && gym && stat && !stat.dinner) {
    const g = hm(gym.t);
    if (now.m >= g - 120 && now.m < g - 60) push(`${now.d}|dinner`, tr(lang, "dinT"), tr(lang, "dinB"));
  }

  // Water at 11:00, 15:00 and 19:00 when behind an 8-cup day (08:00 to 22:00).
  if (rem.water && stat) {
    for (const cp of [660, 900, 1140]) {
      if (now.m >= cp && now.m < cp + 30) {
        const expected = Math.round((8 * (cp - 480)) / 840);
        if ((stat.h2o || 0) < expected - 1) push(`${now.d}|water|${cp}`, tr(lang, "watT"), tr(lang, "watB", stat.h2o || 0));
      }
    }
  }

  // Evening wrap-up at 22:45: what is still open and tomorrow's first item.
  if (rem.note && now.m >= 1365) {
    const open = today.filter((x) => !x.x).map((x) => x.n);
    const nd = new Date(now.d + "T12:00:00Z"); nd.setUTCDate(nd.getUTCDate() + 1);
    const tomorrow = nd.toISOString().slice(0, 10);
    const first = sched.filter((x) => x.d === tomorrow).sort((a, b) => hm(a.t) - hm(b.t))[0];
    const body = (open.length ? tr(lang, "left") + open.slice(0, 5).join("、") + (open.length > 5 ? "…" : "") : tr(lang, "allDone"))
      + (first ? " " + tr(lang, "first") + first.t + " " + first.n : "");
    push(`${now.d}|summary`, tr(lang, "sumT"), body);
  }
  return out;
}

// iCalendar feed for the next two weeks. Floating local times, so the phone shows them in its own time zone.
export function icsFeed(data, stamp = new Date()) {
  const rem = settings(data && data.rem);
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const dt = (d, t) => d.replace(/-/g, "") + "T" + String(t).replace(":", "").padEnd(4, "0") + "00";
  const end = (d, t) => { const m = hm(t) + 15; return dt(d, `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`); };
  const st = stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const hash = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)) >>> 0; return h.toString(36); };
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Daily Life Log//Plan//ZH", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:" + ((data && data.lang) === "en" ? "Daily Life Log plan" : "每日计划"), "X-PUBLISHED-TTL:PT15M", "REFRESH-INTERVAL;VALUE=DURATION:PT15M"];
  for (const x of (data && data.sched) || []) {
    if (!x || !x.d || !x.t || !x.n) continue;
    lines.push("BEGIN:VEVENT", `UID:${x.d}-${x.t.replace(":", "")}-${hash(x.n)}@daily-life-log`, `DTSTAMP:${st}`,
      `DTSTART:${dt(x.d, x.t)}`, `DTEND:${end(x.d, x.t)}`, "SUMMARY:" + esc((x.x ? "✓ " : "") + x.n));
    if (x.nx) lines.push("DESCRIPTION:" + esc(((data && data.lang) === "en" ? "Then: " : "接下来：") + x.nx));
    if (!x.x && rem[x.c || "plan"]) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + esc(x.n), "TRIGGER:-PT15M", "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
