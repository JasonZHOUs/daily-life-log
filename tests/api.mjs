// Checks api/food-photo.js without calling the real Claude API or Supabase.
// Usage: node tests/api.mjs
import assert from 'node:assert/strict';
import handler, { analyze, analyzeGemini, checkUser, geminiText, pickProvider } from '../api/food-photo.js';

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok -', name); };
const fakeClient = (reply, stop = 'end_turn') => {
  const calls = [];
  return { calls, beta: { messages: { create: async (p) => { calls.push(p); return { stop_reason: stop, content: [{ type: 'text', text: JSON.stringify(reply) }] }; } } } };
};
const resMock = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };

await ok('analyze sends the image with structured output and fallbacks', async () => {
  const c = fakeClient({ items: [{ name_en: 'Chicken rice', name_zh: '鸡饭', grams: 382, kcal: 610.4, protein_g: 25.26, fat_g: 23, carbs_g: 75 }], note: 'Oil is hard to see.' });
  const out = await analyze(c, 'AAAA', 'en');
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.items[0], { name_en: 'Chicken rice', name_zh: '鸡饭', grams: 382, kcal: 610, protein_g: 25.3, fat_g: 23, carbs_g: 75 });
  const p = c.calls[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.equal(p.messages[0].content[0].source.data, 'AAAA');
  assert.ok(!('thinking' in p) && !('temperature' in p));
});
await ok('analyze drops junk items and handles refusals', async () => {
  const out = await analyze(fakeClient({ items: [{ name_en: '', grams: 10 }, { name_en: 'Air', name_zh: '', grams: 0, kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 }], note: 'no food' }), 'AAAA', 'zh');
  assert.deepEqual(out.body.items, []);
  const r = await analyze(fakeClient({}, 'refusal'), 'AAAA', 'en');
  assert.equal(r.status, 422);
});
await ok('checkUser enforces login and the optional allow list', async () => {
  const f = (okk, email) => async () => ({ ok: okk, json: async () => ({ id: 'u1', email }) });
  assert.equal(await checkUser('', f(true, 'a@b.c')), null);
  assert.equal(await checkUser('Bearer x', f(false, 'a@b.c')), null);
  assert.equal((await checkUser('Bearer x', f(true, 'a@b.c'))).id, 'u1');
  process.env.ALLOWED_EMAILS = 'me@x.com';
  assert.equal(await checkUser('Bearer x', f(true, 'a@b.c')), null);
  assert.equal((await checkUser('Bearer x', f(true, 'ME@x.com'))).id, 'u1');
  delete process.env.ALLOWED_EMAILS;
});
await ok('handler rejects bad requests before calling Claude', async () => {
  let r = resMock(); await handler({ method: 'GET', headers: {} }, r); assert.equal(r.code, 405);
  delete process.env.ANTHROPIC_API_KEY;
  r = resMock(); await handler({ method: 'POST', headers: {}, body: {} }, r); assert.equal(r.code, 503);
  process.env.ANTHROPIC_API_KEY = 'test';
  r = resMock(); await handler({ method: 'POST', headers: {}, body: { image: 'AAAA' } }, r); assert.equal(r.code, 401);
});
await ok('provider choice: Gemini key wins, AIza key in ANTHROPIC_API_KEY counts as Gemini', async () => {
  assert.equal(pickProvider({}), null);
  assert.deepEqual(pickProvider({ ANTHROPIC_API_KEY: ' AIzaXYZ ' }), { kind: 'gemini', key: 'AIzaXYZ' });
  assert.deepEqual(pickProvider({ ANTHROPIC_API_KEY: 'sk-ant-1' }), { kind: 'claude' });
  assert.deepEqual(pickProvider({ ANTHROPIC_API_KEY: 'AQ.newstyle' }), { kind: 'gemini', key: 'AQ.newstyle' });
  assert.deepEqual(pickProvider({ ANTHROPIC_API_KEY: 'sk-ant-1', GEMINI_API_KEY: 'AIzaG' }), { kind: 'gemini', key: 'AIzaG' });
});
await ok('Gemini request shape and response parsing', async () => {
  const reply = JSON.stringify({ items: [{ name_en: 'Laksa', name_zh: '叻沙', grams: 500, kcal: 589, protein_g: 22, fat_g: 32, carbs_g: 52 }], note: 'ok' });
  let sent;
  const f = async (url, opt) => { sent = { url, opt, body: JSON.parse(opt.body) }; return { ok: true, json: async () => ({ id: 'i1', status: 'completed', steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'text', text: reply }] }] }) }; };
  const out = await analyzeGemini('AIzaK', 'BBBB', 'zh', f, 'gemini-3.8-flash');
  assert.equal(out.status, 200); assert.equal(out.body.items[0].name_zh, '叻沙');
  assert.equal(sent.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(sent.opt.headers['x-goog-api-key'], 'AIzaK');
  assert.equal(sent.body.store, false);
  assert.deepEqual(sent.body.input[1], { type: 'image', data: 'BBBB', mime_type: 'image/jpeg' });
  assert.equal(sent.body.response_format.mime_type, 'application/json');
  assert.equal(geminiText({ output_text: reply }), reply);
  assert.equal(geminiText({ outputs: [{ type: 'text', text: reply }] }), reply);
});
await ok('Gemini errors map to friendly codes', async () => {
  const f = (status) => async () => ({ ok: false, status, text: async () => JSON.stringify([{ error: { code: status, status: 'PERMISSION_DENIED', message: 'Key AIzaSECRET is blocked' } }]) });
  const orig = console.error; console.error = () => {};
  const d = (await analyzeGemini('k', 'B', 'en', f(403))).body;
  assert.equal(d.error, 'not_configured');
  assert.equal(d.detail, 'Gemini 403 PERMISSION_DENIED: Key [key] is blocked');
  assert.equal((await analyzeGemini('k', 'B', 'en', f(429))).body.error, 'busy');
  assert.equal((await analyzeGemini('k', 'B', 'en', f(502))).status, 502);
  console.error = orig;
});
await ok('a busy model falls through to the next one', async () => {
  const reply = JSON.stringify({ items: [{ name_en: 'Egg', name_zh: '鸡蛋', grams: 50, kcal: 72, protein_g: 6, fat_g: 5, carbs_g: 0 }], note: '' });
  const tried = [];
  const f = async (url, opt) => {
    const m = JSON.parse(opt.body).model; tried.push(m);
    if (m === 'gemini-3.8-flash') return { ok: false, status: 503, text: async () => JSON.stringify([{ error: { status: 'UNAVAILABLE', message: 'high demand' } }]) };
    return { ok: true, json: async () => ({ output_text: reply }) };
  };
  const orig = console.error; console.error = () => {};
  const out = await analyzeGemini('k', 'B', 'en', f);
  console.error = orig;
  assert.equal(out.status, 200); assert.equal(out.body.items[0].name_en, 'Egg');
  assert.deepEqual(tried, ['gemini-3.8-flash', 'gemini-3.6-flash']);
  assert.ok(!('retry' in out));
});

/* ---------- Phase 2 reminders ---------- */
const { dueReminders, icsFeed, localNow } = await import('../api/_reminders.js');
const { sendAll } = await import('../api/push-tick.js');
const day0 = '2026-10-30';
const DATA = { lang: 'zh', tz: 'Asia/Singapore', rem: { push: true },
  sched: [
    { d: day0, t: '15:30', n: '下午加餐', c: 'plan', k: ['meal_s'], x: false, nx: '16:00 上课' },
    { d: day0, t: '20:00', n: '健身', c: 'plan', k: ['gym'], x: false, nx: '' },
    { d: day0, t: '23:00', n: '晚上补剂', c: 'sup', k: ['sup_pm'], x: false, nx: '' },
    { d: day0, t: '08:30', n: '早餐', c: 'plan', k: ['meal_b'], x: true, nx: '' },
    { d: '2026-10-31', t: '08:30', n: '早餐', c: 'plan', k: ['meal_b'], x: false, nx: '' },
  ],
  stat: { d: day0, h2o: 1, dinner: false } };
const at = (h, m) => ({ d: day0, m: h * 60 + m });
const DW = { ...DATA, rem: { push: true, water: false } }; // plan-timing checks without water nudges
await ok('15 minutes before, then once more if still not done', async () => {
  const pre = dueReminders(DW, at(15, 15));
  assert.equal(pre.length, 1); assert.equal(pre[0].title, '15:30 下午加餐'); assert.ok(pre[0].body.includes('16:00 上课'));
  assert.equal(dueReminders(DW, at(15, 35)).length, 0, 'nothing between the two');
  const late = dueReminders(DW, at(15, 40));
  assert.equal(late.length, 1); assert.ok(late[0].key.endsWith('|late'));
  assert.equal(dueReminders(DW, at(15, 40), new Set([late[0].key])).length, 0, 'never twice');
  assert.equal(dueReminders(DW, at(17, 30)).length, 0, 'no endless follow-ups');
});
await ok('done items, disabled categories and calendar-handled alerts are skipped', async () => {
  const done = { ...DW, sched: DATA.sched.map(x => ({ ...x, x: true })) };
  assert.equal(dueReminders(done, at(15, 15)).length, 0);
  assert.equal(dueReminders({ ...DATA, rem: { plan: false, water: false } }, at(15, 15)).length, 0);
  const cal = dueReminders({ ...DATA, rem: { calPre: true, water: false } }, at(15, 15));
  assert.equal(cal.length, 0, 'calendar gives the 15-minute alert');
  assert.equal(dueReminders({ ...DATA, rem: { calPre: true, water: false } }, at(15, 45)).length, 1, 'follow-up still comes from push');
});
await ok('dinner before the gym only when dinner is not logged', async () => {
  assert.ok(dueReminders(DATA, at(18, 10)).some(r => r.key.endsWith('|dinner')));
  assert.ok(!dueReminders({ ...DATA, stat: { ...DATA.stat, dinner: true } }, at(18, 10)).some(r => r.key.endsWith('|dinner')));
});
await ok('water nudges only when behind; evening wrap-up lists what is open and tomorrow', async () => {
  assert.ok(dueReminders(DATA, at(15, 5)).some(r => r.key.includes('|water|900')));
  assert.ok(!dueReminders({ ...DATA, stat: { ...DATA.stat, h2o: 5 } }, at(15, 5)).some(r => r.key.includes('water')));
  const sum = dueReminders(DATA, at(22, 50)).find(r => r.key.endsWith('|summary'));
  assert.ok(sum.body.includes('下午加餐') && sum.body.includes('明天第一件事：08:30 早餐'));
});
await ok('local time follows the stored time zone', async () => {
  const n = localNow('Asia/Singapore', new Date('2026-10-30T16:30:00Z'));
  assert.deepEqual(n, { d: '2026-10-31', m: 30 });
});
await ok('calendar feed has events with 15-minute alarms for open items', async () => {
  const ics = icsFeed(DATA, new Date('2026-10-30T00:00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR') && ics.includes('DTSTART:20261030T153000') && ics.includes('TRIGGER:-PT15M'));
  assert.ok(ics.includes('SUMMARY:✓ 早餐'), 'done items are marked');
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 5);
});
await ok('sender sends each due reminder once, logs it, and drops expired devices', async () => {
  const calls = { posts: [], dels: [] };
  const db = {
    get: async (p) => p.startsWith('cfg') ? [{ user_id: 'u1', data: DW }] : p.startsWith('push_subs') ? [{ endpoint: 'e1', user_id: 'u1', sub: {} }, { endpoint: 'e2', user_id: 'u1', sub: {} }] : [],
    post: async (p, b) => { calls.posts.push([p, b]); }, del: async (p) => { calls.dels.push(p); },
  };
  const sent = [];
  const send = async (sub, payload) => { sent.push(payload.title); return sent.length === 2 ? 'gone' : 'ok'; };
  const n = await sendAll(db, send, new Date('2026-10-30T07:15:00Z')); // 15:15 in Singapore
  assert.equal(n, 1); assert.deepEqual(sent, ['15:30 下午加餐', '15:30 下午加餐']);
  assert.equal(calls.posts[0][0], 'push_log'); assert.ok(calls.posts[0][1].key.endsWith('|pre'));
  assert.ok(calls.dels.some(p => p.includes('endpoint=eq.e2')));
});
console.log(`\n${n} api checks passed`);
