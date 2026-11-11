# Daily Life Log: project notes for Claude Code

## What this is
A mobile-first personal tracker for one user (Xin Zhou, MSc student in Singapore, Mandarin native, building muscle, studying, doing lab work, building AI side projects). Goal: log food, exercise, study/lab time, habits and a daily plan in under 2 minutes a day, on iPhone and computer, with data synced across devices.

## Stack (no build step)
- Static site on Vercel (GitHub repo auto-deploys on push to main). Files: `index.html` (all HTML, CSS, JS), `config.js`, `manifest.webmanifest`, `icon-180.png`, `icon-512.png`, `sw.js` (service worker). `tests/` and docs are excluded from deploys by `.vercelignore`.
- Supabase (project ref `krsixzjzdwmxtxsybcsm`, region ap-southeast-1): email and password login, Postgres with row level security.
- `config.js` holds the Supabase URL and the public anon key. Never commit service-role keys or any secret.
- Server code is five Vercel Node functions in `api/`: `food-photo.js`, `push-tick.js`, `calendar.js`, `health.js` plus helpers `_lib.js` and `_reminders.js`. `api/food-photo.js` checks the caller's Supabase login, sends the photo to Claude (`claude-opus-5-5`, structured JSON output, `fallbacks: "default"`), and returns food items with grams and macros. Provider: `GEMINI_API_KEY` (Gemini Interactions API, `gemini-3.8-flash` by default via `GEMINI_MODEL`, falling back to 3.6 Flash then 2.5 Flash on 503/429/500/404, `store:false`) is used first; otherwise `ANTHROPIC_API_KEY` for Claude. Any ANTHROPIC_API_KEY value not starting with "sk-ant-" is treated as a Gemini key. Upstream errors return a `detail` string (Google or Claude message, key redacted) that the app shows. Optional `ALLOWED_EMAILS` limits who can use it. Env changes apply only to new deployments. `package.json` pins `@anthropic-ai/sdk`; there is still no build step. The client shrinks photos to 1280 px JPEG before upload. Free route kept alongside it: "Use an AI app (free)" copies `aiPrompt`; the user asks 豆包/Claude/ChatGPT and pastes the reply (rows `name | g | kcal | p | f | c`) into the search box or via Paste reply; `parsePipe()` finds rows by pattern because a one-line input joins pasted lines. Any photo error also offers this route.
- supabase-js v2 loaded from jsdelivr CDN. Open Food Facts public API is used as a fallback food search.

## Data model
- `public.days(user_id uuid, day date, data jsonb, updated_at)`, primary key (user_id, day). One row per day.
- `public.cfg(user_id uuid primary key, data jsonb, updated_at)`: foods (saved custom foods), dbx (foods found online), t (targets and body), gm (remembered portions in grams), meals (recent multi-food meals: {key, it[], n, t}), tpl (user's weekly plan template, same shape as `TPL`; null means use `TPL`), lang.
- RLS: each user can only read and write rows where `user_id = auth.uid()`.
- Day object fields: food[], gym[], min{study,lab,ai,career}, eng, supp, win, next, wt, ex[], plan[], sp {supplement id: true} (ids in `SUPS`; `supp` is derived = all morning and evening ones taken), mood (1–5, 0 = unset), nrg (energy 1–5), sl (sleep hours, string), h2o (cups of 250 ml), stp (steps, string), wk[] (workout: {x: exercise key, s:[{r reps, kg}]}; x is the English name from `EXS` when known), `_t` (last-modified ms). Food entry: {b (English name), z (Chinese name), g, k, p, f, c}.
- Storage slots: `dl1:local` (this device only) and `dl1:u:<user id>` (per account) never mix; the old single key `dl1` is copied into the first slot opened and kept as `dl1:legacy`. `dl1:mode` remembers local mode, `dl1:lang` the UI language (default Chinese). Details: `docs/data-model.md`.
- Sync conflicts: each day carries `_t` (last change) and `_s` (version last synced). `syncDay()` takes whichever side changed; if both changed since `_s` it merges with `mergeDay()` (lists joined, items in the recycle bin stay deleted, ticks/habits OR'd, counters max, text keeps this device's) and shows a toast. `flush()` keeps a day dirty if it changed during the upload.
- Sync is local-first: state `S` lives in its slot in localStorage and in memory; per-day rows are upserted 0.9 s after a change; newer `_t` wins on pull.

## More detail (read only when working on that area)
`docs/details.md`: plan ↔ records linking, Apple Health, reminders, the roadmap history, Phase 7 notes, key pieces (meal parser, offline, workout log, adaptive calories, patterns, streaks, weekly report) and backlog ideas. `docs/data-model.md`: storage. `docs/roadmap.md`: the user's checklist; every phase is done, so ask the user what is next.

## Tools (use these instead of ad-hoc commands)
- `node tools/map.mjs [filter]`: sections and functions of `index.html` with line numbers. Find the function, then read only those lines; do not read the whole file (about 65k tokens).
- `node tools/patch.mjs <spec.mjs>`: anchored edits to any repo file (find/replace, before/after + insert); every anchor must match exactly once or nothing is written. Keep spec files in a scratch folder. Shell heredocs with backticks have corrupted files before; use this.
- Preview: the `daily-life-log` entry in `.claude/launch.json` (`node tools/serve.mjs 8791`), mobile preset. Screenshots can be stale, so confirm with page text.
- `node tools/check-live.mjs [identifier ...]`: after a push, waits until the live site serves the local `VER` and contains the identifiers.
- `node tools/unused.mjs`: report of UI string keys nothing uses (report only).

## Working agreement with the user
Reply in Chinese. No paid services. Implement → `npm test` → check at phone size → commit → ask before pushing (a push to main deploys). For a new region or a layout change, show a mockup first and build after the user agrees. Batch small changes from one sitting into one release unless the user asks to ship now.

## UI structure
Four bottom tabs since 2026-11-06 (the user found the old layout clumsy): Today (key `home`, opens first), Plan (key `today`), Review (key `rev`), More (key `more`).
- **Today** (`vHome`): what-is-new line, alerts, yesterday's open items, a one-tap "how long did you sleep" card before 14:00 when sleep is empty, the wrap-up card from 20:00, water +1/− and the next plan item with a tick box. Then an isotretinoin card (`isoCard`, day field `iso` stored as true/false so an un-mark wins in merge): one-tap toggle, 14-day strip, last dose and 7/30-day counts. Below that are six tiles: Food (protein/target, kcal left), Study (minutes, start/stop timer), Gym (parts, days in the last 7), Status (mood emoji and energy; sleep hours or 7-day average as the small line; sheet `sleep` has mood, energy, then sleep), Supplements (one-tap all-taken for the group due now; sheet `sup` reuses `supCard`), Weight (today or last weigh-in, change vs 7 days ago; sheet `wt` with `#wt2` and same-as-last). Each tile opens a bottom sheet (`sh` = food/study/gym/sleep/sup/wt, `shView`) so logging never leaves the page. The food sheet has a one-line input (`#shq` → `lineBox`, Enter adds), saved meals, the top 8 of `shelf()`, supplements all-taken, copy yesterday, next-meal ideas and a link to the full Food page. Sleep sheet also holds mood and energy.
- Food (`vFood`: ring, search/photo, supplements, shelf, eaten list) and Activity (`vAct`) are detail pages reached from tiles or More, with a "‹ Today" button; the nav highlights Today on them. Review keeps the analysis (goals, trends, streaks, report, search, adaptive, patterns, heatmap, weight). More holds the links plus targets, templates, account, display, reminders, Apple Health, bin and backup.

All UI strings live in the `I` dictionary as [English, 中文]; use `t('key')`. Every new string must have both languages.

## Design principles (from research on other trackers)
Fewest taps for repeated actions; frequent-foods shelf and remembered portions; show remaining nutrients live; honest streaks (back-filled days do not count, but the best run is kept); uncluttered screens; installs to the iPhone Home Screen.

## Rules for working here
- Keep the app usable on a 390 px wide iPhone screen. Inputs at least 16 px font. Respect safe-area insets.
- Keep light and dark themes working (CSS variables). Visual system: warm paper background with soft glows and grain (`body::before/::after`), 22 px cards with layered shadow `--sh`, accent gradient `--ac`→`--ac2`, macro colours `--fat` and `--carb`, rounded numerals (ui-rounded), floating frosted tab bar with inline SVG icons, calorie progress ring on Today. Reuse these tokens instead of hard-coded colours.
- Do not break existing user data: old days may lack newer fields, so always normalise with `norm()`.
- Each release: bump `VER` in index.html and rewrite the `hmUpd` string (the one-time "what is new" line on Today; a test fails if `VER` changes and `hmUpd` does not). The version is shown in Review. iPhone Home Screen apps keep the old page in memory until the app is swiped away, so tell the user to fully close and reopen it after a deploy.
- Run `npm test` after every change (`tests/run.mjs` for the page, `tests/api.mjs` for the photo endpoint with a fake Claude client). It runs the inline script in a stubbed DOM and checks the parser, summary, CSV, i18n completeness and that every tab renders in both languages. Add a check for each new feature.
- Service workers do not run in the Claude desktop browser pane. Test `sw.js` with headless Chrome (CDP) or a real phone.
- Energy balance assumes a male body (Mifflin-St Jeor BMR x 1.2 plus MET-based exercise).

