# Daily Life Log: project notes for Claude Code

## What this is
A mobile-first personal tracker for one user (Xin Zhou, MSc student in Singapore, Mandarin native, building muscle, studying, doing lab work, building AI side projects). Goal: log food, exercise, study/lab time, habits and a daily plan in under 2 minutes a day, on iPhone and computer, with data synced across devices.

## Stack (no build step)
- Static site on Vercel (GitHub repo auto-deploys on push to main). Files: `index.html` (all HTML, CSS, JS), `config.js`, `manifest.webmanifest`, `icon-180.png`, `icon-512.png`, `sw.js` (service worker). `tests/` and docs are excluded from deploys by `.vercelignore`.
- Supabase (project ref `krsixzjzdwmxtxsybcsm`, region ap-southeast-1): email and password login, Postgres with row level security.
- `config.js` holds the Supabase URL and the public anon key. Never commit service-role keys or any secret.
- `api/food-photo.js` is a Vercel Node function (the only server code). It checks the caller's Supabase login, sends the photo to Claude (`claude-opus-5-5`, structured JSON output, `fallbacks: "default"`), and returns food items with grams and macros. Needs `ANTHROPIC_API_KEY` in Vercel env; optional `ALLOWED_EMAILS` limits who can use it. `package.json` pins `@anthropic-ai/sdk`; there is still no build step. The client shrinks photos to 1280 px JPEG before upload.
- supabase-js v2 loaded from jsdelivr CDN. Open Food Facts public API is used as a fallback food search.

## Data model
- `public.days(user_id uuid, day date, data jsonb, updated_at)`, primary key (user_id, day). One row per day.
- `public.cfg(user_id uuid primary key, data jsonb, updated_at)`: foods (saved custom foods), dbx (foods found online), t (targets and body), gm (remembered portions in grams), meals (recent multi-food meals: {key, it[], n, t}), tpl (user's weekly plan template, same shape as `TPL`; null means use `TPL`), lang.
- RLS: each user can only read and write rows where `user_id = auth.uid()`.
- Day object fields: food[], gym[], min{study,lab,ai,career}, eng, supp, win, next, wt, ex[], plan[], mood (1–5, 0 = unset), nrg (energy 1–5), sl (sleep hours, string), h2o (cups of 250 ml), stp (steps, string), wk[] (workout: {x: exercise key, s:[{r reps, kg}]}; x is the English name from `EXS` when known), `_t` (last-modified ms). Food entry: {b (English name), z (Chinese name), g, k, p, f, c}.
- Sync is local-first: state `S` lives in localStorage (key `dl1`) and in memory; per-day rows are upserted 0.9 s after a change; newer `_t` wins on pull.

## UI structure
Four bottom tabs: Today (kcal/protein/fat/carbs left, plan, habits, night note), Food (search box that also parses a whole meal, recent meals, one-tap shelf of frequent foods, quick kcal add, custom food), Activity (gym parts, study/lab minutes with 10-minute timer, exercise and energy balance), Review (week bars, weekly summary with suggestions, weight trend, 12-week heatmap, targets, weekly plan template editor, backup and CSV export).

### Key pieces
- One-line meal entry: `parseLine()` splits on commas (also `，、;+和`), `parseItem()` reads a quantity and unit (digits, Chinese numerals, `half`, `x2`, `200g`, `一碗`), `findFood()` scores matches across custom foods, `DB` (per 100 g, includes `DISH`: Singapore hawker and Chinese dishes stored per serving and converted), online finds and presets. A Chinese numeral only counts as a quantity when a unit follows it (so 三文鱼 stays salmon). Meals with 2+ foods are remembered in `S.meals`.
- Offline: `sw.js` serves the shell (index, config, icons, the pinned supabase-js build) from cache, then refreshes it in the background. If index.html or a script changed, it messages the page, which shows a Reload banner. Supabase and Open Food Facts requests always go to the network. Bump the supabase-js version in both `index.html` and `sw.js` together. Failed syncs retry after 20 s and when the device comes back online.
- Workout log: `EXS` lists exercises [en, zh, body part]; adding one ticks its gym part. Each block shows the last session (`lastEx`) and marks a PR when a set's estimated 1RM (Epley) beats every earlier set (`bestBefore`).
- Adaptive calories (`adaptive`, MacroFactor-style): real burn = average intake on logged days − weight slope (least squares over the last 28 days) × 7700. Needs 10+ food days and 2 weigh-ins 10+ days apart. Target = burn + 275 (≈ +0.25 kg a week).
- Patterns (`patterns`, Exist-style): compares mood, work minutes and energy between groups (sleep 7h+, gym day, 8,000+ steps) over 60 days, shown only when both groups have 5+ days.
- Research on similar products and open-source options: `docs/research.md`.
- Weekly review: `weekSummary(day)` returns averages and up to 3 rule-based suggestions; `toCSV()` exports all non-empty days (UTF-8 BOM for Excel).
All UI strings live in the `I` dictionary as [English, 中文]; use `t('key')`. Every new string must have both languages.

## Design principles (from research on other trackers)
Fewest taps for repeated actions; frequent-foods shelf and remembered portions; show remaining nutrients live; forgiving streaks (one skipped day does not reset); uncluttered screens; installs to the iPhone Home Screen.

## Rules for working here
- Keep the app usable on a 390 px wide iPhone screen. Inputs at least 16 px font. Respect safe-area insets.
- Keep light and dark themes working (CSS variables). Visual system: warm paper background with soft glows and grain (`body::before/::after`), 22 px cards with layered shadow `--sh`, accent gradient `--ac`→`--ac2`, macro colours `--fat` and `--carb`, rounded numerals (ui-rounded), floating frosted tab bar with inline SVG icons, calorie progress ring on Today. Reuse these tokens instead of hard-coded colours.
- Do not break existing user data: old days may lack newer fields, so always normalise with `norm()`.
- Each release: bump `VER` in index.html and rewrite the `new1`–`new4` strings. Users see a one-time "New in this version" card on Today, and the version is shown in Review. iPhone Home Screen apps keep the old page in memory until the app is swiped away, so tell the user to fully close and reopen it after a deploy.
- Run `npm test` after every change (`tests/run.mjs` for the page, `tests/api.mjs` for the photo endpoint with a fake Claude client). It runs the inline script in a stubbed DOM and checks the parser, summary, CSV, i18n completeness and that every tab renders in both languages. Add a check for each new feature.
- Service workers do not run in the Claude desktop browser pane. Test `sw.js` with headless Chrome (CDP) or a real phone.
- Energy balance assumes a male body (Mifflin-St Jeor BMR x 1.2 plus MET-based exercise).

## Backlog ideas
1. Split `index.html` into modules or a small build (Vite) once it grows; add tests for calculations.
2. ~~Real offline support (service worker) and update prompts.~~ Done.
3. ~~Larger bilingual food database, including Singapore and Chinese dishes~~ (about 50 dishes added); still to do: barcode scan via Open Food Facts.
4. ~~Weekly review screen with suggestions; export to CSV.~~ Done.
5. Reminders: web push for the daily plan (needs the app installed on the Home Screen), or a calendar feed.
6. ~~Editable weekly plan template.~~ Done (`S.tpl`, Review tab).
7. Charts for calories/protein over time and training volume.
8. Accessibility pass and Chinese typography polish.
