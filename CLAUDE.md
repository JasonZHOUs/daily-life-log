# Daily Life Log: project notes for Claude Code

## What this is
A mobile-first personal tracker for one user (Xin Zhou, MSc student in Singapore, Mandarin native, building muscle, studying, doing lab work, building AI side projects). Goal: log food, exercise, study/lab time, habits and a daily plan in under 2 minutes a day, on iPhone and computer, with data synced across devices.

## Stack (no build step)
- Static site on Vercel (GitHub repo auto-deploys on push to main). Files: `index.html` (all HTML, CSS, JS), `config.js`, `manifest.webmanifest`, `icon-180.png`, `icon-512.png`.
- Supabase (project ref `krsixzjzdwmxtxsybcsm`, region ap-southeast-1): email and password login, Postgres with row level security.
- `config.js` holds the Supabase URL and the public anon key. Never commit service-role keys or any secret.
- supabase-js v2 loaded from jsdelivr CDN. Open Food Facts public API is used as a fallback food search.

## Data model
- `public.days(user_id uuid, day date, data jsonb, updated_at)`, primary key (user_id, day). One row per day.
- `public.cfg(user_id uuid primary key, data jsonb, updated_at)`: foods (saved custom foods), dbx (foods found online), t (targets and body), gm (remembered portions in grams), lang.
- RLS: each user can only read and write rows where `user_id = auth.uid()`.
- Day object fields: food[], gym[], min{study,lab,ai,career}, eng, supp, win, next, wt, ex[], plan[], `_t` (last-modified ms). Food entry: {b (English name), z (Chinese name), g, k, p, f, c}.
- Sync is local-first: state `S` lives in localStorage (key `dl1`) and in memory; per-day rows are upserted 0.9 s after a change; newer `_t` wins on pull.

## UI structure
Four bottom tabs: Today (kcal/protein/fat/carbs left, plan, habits, night note), Food (search, one-tap shelf of frequent foods, quick kcal add, custom food), Activity (gym parts, study/lab minutes with 10-minute timer, exercise and energy balance), Review (week bars, weight trend, 12-week heatmap, targets, backup).
All UI strings live in the `I` dictionary as [English, 中文]; use `t('key')`. Every new string must have both languages.

## Design principles (from research on other trackers)
Fewest taps for repeated actions; frequent-foods shelf and remembered portions; show remaining nutrients live; forgiving streaks (one skipped day does not reset); uncluttered screens; installs to the iPhone Home Screen.

## Rules for working here
- Keep the app usable on a 390 px wide iPhone screen. Inputs at least 16 px font. Respect safe-area insets.
- Keep light and dark themes working (CSS variables).
- Do not break existing user data: old days may lack newer fields, so always normalise with `norm()`.
- Test changes with a stubbed DOM in node (`node --check` on the script at minimum).
- Energy balance assumes a male body (Mifflin-St Jeor BMR x 1.2 plus MET-based exercise).

## Backlog ideas
1. Split `index.html` into modules or a small build (Vite) once it grows; add tests for calculations.
2. Real offline support (service worker) and update prompts.
3. Larger bilingual food database, including Singapore and Chinese dishes; barcode scan via Open Food Facts.
4. Weekly review screen with suggestions; export to CSV.
5. Reminders: web push for the daily plan (needs the app installed on the Home Screen), or a calendar feed.
6. Editable weekly plan template (currently hard-coded as `TPL`).
7. Charts for calories/protein over time and training volume.
8. Accessibility pass and Chinese typography polish.
