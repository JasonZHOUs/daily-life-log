# Daily Life Log: details and history

Moved out of CLAUDE.md on 2026-11-11 to keep it short. Read the part you need before changing that area.
The roadmap list is history: some names in it no longer exist (the Phase 3 "today card" became the Today home, `vHome`).

## Plan ↔ records (Phase 1)
Plan items get kinds from their text (`kindsOf`: breakfast, snack, morning/evening supplements, gym, spoken English, night note, weigh-in, lab, AI project). The tick `x` is the only done state; records are evidence (`itemEv`). `linkPlan` runs after user actions only: a record appearing ticks the item (`auto:true`), its removal unticks only auto ticks, with a toast. Viewing a day never changes it; recorded-but-unticked items show amber. Food entries logged for today carry `at` (ms) so meals can be matched to breakfast (before 11:30) or snack (14:00–18:00); older entries without `at` show "time unknown, confirm".

## Apple Health (Phase 5)
A web app cannot read HealthKit. An iPhone Shortcut sums steps, active energy and sleep and calls `GET/POST /api/health?t=<hl_tok>&steps=&active=&sleep=[&weight=][&date=]`. `hl_tok` is a random string in cfg (separate from `cal_tok`). The server finds the cfg row by token, writes `stp`, `sl`, `hx` (active kcal), `wt` into that day (default: today in the cfg time zone) and sets `hs={at,f}`; `mergeDay` lets the newer `hs` win for those fields. Sleep may arrive in hours, minutes or seconds (`readHealth` converts). Activity balance uses max(manual exercise, `hx`).

## Reminders (Phase 2)
- The app writes `sched` (today + 13 days of plan items, future days from the template without creating day rows), `stat` (today's water, dinner logged), `rem` (settings) and `tz` into the cfg row (`updSched()` on every save, accounts only).
- `api/_reminders.js` has the pure rules: 15 min before (skipped when `rem.calPre`, i.e. the calendar does it), one follow-up 10–90 min after if not ticked, dinner before gym only if no dinner logged, water at 11/15/19 when behind, 22:45 wrap-up. `api/push-tick.js` sends them via Web Push (`web-push`), logging each key in `public.push_log` so nothing is sent twice; called every 5 min by Supabase pg_cron + pg_net. `api/calendar.js?t=<cal_tok>` serves an ICS feed with 15-minute alarms.
- Tables: `public.push_subs` (RLS: own rows), `public.push_log` (server only). Env: `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY` (public key is in `api/_lib.js` and index.html). The generated private key is in the git-ignored `secrets.local.txt`.
- The service worker shows pushes and never caches `/api/`. An in-app banner shows items due within 15 min or overdue when the app is open.

## Roadmap
`docs/roadmap.md` is the user's phased checklist. Done: Phase 0, Phase 1, Phase 2, Phase 6 (sign-in errors, reset, modes), extras A (timer with pause/note, `S.timer` stored locally), C (7-day recycle bin `S.bin` + Undo toast), E (built-in day templates `BTPL` + saved `S.tpls`), F (copy yesterday's plan), I (photo-first pending meals with a 640 px thumbnail), L (±10 g steppers), Phase 3 (today card with next item and one-tap water on the first page, food favourites `S.favs` and a shelf ordered favourites → last 7 days by recency → 30-day frequency, tab bar hidden while typing, per-day merge on sync conflicts), Phase 4 (Review tab: goal bars, 7/30-day trend chart per metric, streaks, Monday–Sunday weekly report shareable as text or PNG). Phase 5 (Apple Health via an iPhone Shortcut calling `api/health.js`; plan time edits, batch move of open items, same-time warning, template edits reach today's open item). Phase 7 (next-meal ideas `nmCard`, night-note drafts `fillDraft`, display settings `dispCard` with theme and large text kept per device in prefs `theme`/`fs`, search `srch`, gentle alerts `alerts` dismissed for 7 days in `S.al`), extras D (dinner reminder only without dinner, categories, one more water reminder at 21:00 on training days via `stat.gym`, exam week `rem.exam`: one digest a day and no calendar alarms), G (one tap on list rows, already in place), J (`wrapCard` on Plan from 20:00 sets `d.wr`), K (`kCard`: yesterday's open items not already on today's plan; choices kept in yesterday's `d.kd`). H (voice) was dropped by the user. Next: nothing planned; ask the user.

## Phase 7 notes
- Drafts only fill empty boxes and return before `linkPlan`, so a draft never ticks the night-note item; the user ticks it after editing.
- Next-meal ideas pair 1–2 items from the shelf and a few high-protein staples (`NMC`), sized to the meal (`nmTarget`: breakfast 1/3, lunch 1/2, snack 1/3, dinner all that is left, capped at 1200 kcal). Breakfast presets only before 11:00. Nothing is logged until "Log this".
- Alerts: calories or protein under 70% of target on both of the last two days with food logged; sleep empty for 3+ days, only once the user has filled sleep before.
- `mergeDay` unions `kd` and keeps `wr`.

## Key pieces
- One-line meal entry: `parseLine()` splits on commas (also `，、;+和`), `parseItem()` reads a quantity and unit (digits, Chinese numerals, `half`, `x2`, `200g`, `一碗`), `findFood()` scores matches across custom foods, `DB` (per 100 g, includes `DISH`: Singapore hawker and Chinese dishes stored per serving and converted), online finds and presets. A Chinese numeral only counts as a quantity when a unit follows it (so 三文鱼 stays salmon). Meals with 2+ foods are remembered in `S.meals`.
- Offline: `sw.js` serves the shell (index, config, icons, the pinned supabase-js build) from cache, then refreshes it in the background. If index.html or a script changed, it messages the page, which shows a Reload banner. Supabase and Open Food Facts requests always go to the network. Bump the supabase-js version in both `index.html` and `sw.js` together. Failed syncs retry after 20 s and when the device comes back online.
- Workout log: `EXS` lists exercises [en, zh, body part]; adding one ticks its gym part. Each block shows the last session (`lastEx`) and marks a PR when a set's estimated 1RM (Epley) beats every earlier set (`bestBefore`).
- Adaptive calories (`adaptive`, MacroFactor-style): real burn = average intake on logged days − weight slope (least squares over the last 28 days) × 7700. Needs 10+ food days and 2 weigh-ins 10+ days apart. Target = burn + 275 (≈ +0.25 kg a week).
- Patterns (`patterns`, Exist-style): compares mood, work minutes and energy between groups (sleep 7h+, gym day, 8,000+ steps) over 60 days, shown only when both groups have 5+ days.
- Research on similar products and open-source options: `docs/research.md`.
- Recorded on the day: `save()`/`touchDay()` set `d.lv=1` when the change happens before 03:00 the next morning (`markLive`); older days fall back to food `at` / timer `at` / `_t` (`isLive`). Streaks (`streak(goal)`) only count live days that hit the goal; today stays open; back-filled days end a streak. Goals (`goalHit`): calories 90–115% of target, protein ≥ target, water ≥ 8, all required supplements, plan ≥ 80%.
- Weekly report: `weekReport(monday)` (hits per goal, top 2 missed goals or recurring plan items, compared with the same weekdays last week); `rpText` for sharing, `rpImage` draws it on a canvas.
- Weekly review: `weekSummary(day)` returns averages and up to 3 rule-based suggestions; `toCSV()` exports all non-empty days (UTF-8 BOM for Excel).

## Backlog ideas
1. Split `index.html` into modules or a small build (Vite) once it grows; add tests for calculations.
2. ~~Real offline support (service worker) and update prompts.~~ Done.
3. ~~Larger bilingual food database, including Singapore and Chinese dishes~~ (about 50 dishes added); still to do: barcode scan via Open Food Facts.
4. ~~Weekly review screen with suggestions; export to CSV.~~ Done.
5. Reminders: web push for the daily plan (needs the app installed on the Home Screen), or a calendar feed.
6. ~~Editable weekly plan template.~~ Done (`S.tpl`, Review tab).
7. Charts for calories/protein over time and training volume.
8. Accessibility pass and Chinese typography polish.

