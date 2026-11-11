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
const H = await import('../api/health.js');
await ok('health: numbers from Shortcuts in any format, sleep in hours, minutes or seconds', async () => {
  assert.equal(H.num('8,432'), 8432); assert.equal(H.num('8 432'), 8432); assert.equal(H.num('7,5'), 7.5); assert.equal(H.num(''), null);
  const r = H.readHealth({ steps: '8,432.0', sleep: '450', active: '420.6', weight: 'abc' }, 'Asia/Singapore', new Date('2026-10-31T15:30:00Z'));
  assert.equal(r.date, '2026-10-31');
  assert.deepEqual(r.fields, { stp: '8432', sl: '7.5', hx: 421 });
  assert.equal(H.readHealth({ sleep: 27000 }).fields.sl, '7.5');
  assert.equal(H.readHealth({ sleep: 7.25 }).fields.sl, '7.3');
  assert.equal(H.readHealth({ steps: 9, date: '2026-10-30' }).date, '2026-10-30');
  assert.equal(H.readHealth({}, 'Asia/Singapore', new Date('2026-10-31T16:30:00Z')).date, '2026-11-01', 'after midnight in Singapore');
  const d = H.applyHealth({ food: [{ b: 'Egg' }], stp: '100', mood: 4 }, { stp: '8432' }, 5);
  assert.deepEqual(d, { food: [{ b: 'Egg' }], stp: '8432', mood: 4, hs: { at: 5, f: ['stp'] }, _t: 5 });
});
await ok('health handler: finds the account by link, keeps the rest of the day, rejects bad links', async () => {
  const r1 = resMock(); await H.default({ query: { t: 'short' } }, r1); assert.equal(r1.code, 400);
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  const calls = []; const f0 = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => {
    calls.push([url, opt.method || 'GET', opt.body]);
    const ok = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => '' });
    if (url.includes('/cfg?')) return ok(url.includes('hl_tok=eq.goodtoken_goodtoken_1') ? [{ user_id: 'u1', tz: 'Asia/Singapore' }] : []);
    if (url.includes('/days?select')) return ok([{ data: { food: [{ b: 'Egg', k: 72 }], h2o: 3 } }]);
    return ok(null);
  };
  try {
    const r2 = resMock(); await H.default({ query: { t: 'unknown_token_123456789' , steps: '5' } }, r2); assert.equal(r2.code, 404);
    const r3 = resMock(); await H.default({ query: { t: 'goodtoken_goodtoken_1' } }, r3); assert.equal(r3.code, 400); assert.equal(r3.body.error, 'no_values');
    const r4 = resMock(); await H.default({ query: { t: 'goodtoken_goodtoken_1', date: '2026-10-31' }, body: { steps: 8000, sleep: 7 } }, r4);
    assert.equal(r4.code, 200); assert.deepEqual(r4.body.saved, { stp: '8000', sl: '7' });
    const post = calls.find(c => c[1] === 'POST'); assert.ok(post[0].includes('days?on_conflict=user_id,day'));
    const row = JSON.parse(post[2])[0];
    assert.equal(row.user_id, 'u1'); assert.equal(row.day, '2026-10-31');
    assert.equal(row.data.h2o, 3); assert.equal(row.data.food[0].b, 'Egg'); assert.equal(row.data.stp, '8000');
  } finally { globalThis.fetch = f0; delete process.env.SUPABASE_SERVICE_ROLE_KEY; }
});
await ok('health link also logs water, isotretinoin and supplements without touching the rest of the day', async () => {
  assert.deepEqual(H.readQuick({ water: ' 1', iso: '1', sup: 'AM' }), { water: 1, iso: true, sup: 'am' }, '"+1" arrives as " 1" in a query string');
  assert.deepEqual(H.readQuick({ water: '+1', iso: '0' }), { water: 1, iso: false });
  assert.deepEqual(H.readQuick({ water: '99', iso: 'x', sup: 'opt' }), {}, 'out of range or unknown values are ignored');
  const d = H.applyQuick({ food: [{ b: 'Egg' }], h2o: 3, sp: { multi: true }, hs: { at: 1, f: ['stp'] } }, { water: 1, iso: true, sup: 'pm' }, 9);
  assert.deepEqual(d, { food: [{ b: 'Egg' }], h2o: 4, sp: { multi: true, fo_pm: true, mg: true }, hs: { at: 1, f: ['stp'] }, iso: true, supp: false, _t: 9 });
  assert.equal(H.applyQuick(d, { sup: 'am' }, 10).supp, true, 'all morning and evening ones taken');
  assert.equal(H.applyQuick({ h2o: 0 }, { water: -1 }, 1).h2o, 0);
  const html = (await import('node:fs')).readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const ids = g => [...html.matchAll(/\['([a-z_0-9]+)','(am|pm)','/g)].filter(m => m[2] === g).map(m => m[1]);
  assert.deepEqual(H.SUP, { am: ids('am'), pm: ids('pm') }, 'same supplement ids as SUPS in index.html');
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  const calls = []; const f0 = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => {
    calls.push([url, opt.method || 'GET', opt.body]);
    const ok = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => '' });
    if (url.includes('/cfg?')) return ok([{ user_id: 'u1', tz: 'Asia/Singapore' }]);
    if (url.includes('/days?select')) return ok([{ data: { food: [{ b: 'Egg', k: 72 }], h2o: 3, stp: '100' } }]);
    return ok(null);
  };
  try {
    const r = resMock(); await H.default({ query: { t: 'goodtoken_goodtoken_1', water: ' 1', date: '2026-11-11' } }, r);
    assert.equal(r.code, 200); assert.deepEqual(r.body.quick, { water: 1 }); assert.match(r.body.msg, /喝水 4\/8/);
    const row = JSON.parse(calls.find(c => c[1] === 'POST')[2])[0];
    assert.equal(row.data.h2o, 4); assert.equal(row.data.food[0].b, 'Egg'); assert.equal(row.data.stp, '100');
    assert.equal(row.data.hs, undefined, 'a quick log is not a Health import');
  } finally { globalThis.fetch = f0; delete process.env.SUPABASE_SERVICE_ROLE_KEY; }
});
await ok('exam week: one summary a day and nothing else; one more water nudge after training', async () => {
  const EX = { ...DATA, rem: { push: true, exam: true } };
  const dg = dueReminders(EX, at(7, 30));
  assert.equal(dg.length, 1); assert.equal(dg[0].title, '今日安排');
  assert.match(dg[0].body, /08:30 早餐；15:30 下午加餐；20:00 健身/);
  assert.equal(dueReminders(EX, at(7, 30), new Set([dg[0].key])).length, 0, 'once');
  for (const [h, m] of [[15, 15], [18, 30], [11, 0], [22, 50]]) assert.equal(dueReminders(EX, at(h, m)).length, 0, `quiet at ${h}:${m}`);
  assert.ok(!icsFeed(EX).includes('BEGIN:VALARM'), 'no calendar alarms in exam week');
  const G = { ...DATA, stat: { d: day0, h2o: 5, dinner: true, gym: true } };
  assert.ok(dueReminders(G, at(21, 5)).some(r => r.key.endsWith('|water|gym') && r.body.includes('5 / 8')));
  assert.ok(!dueReminders({ ...G, stat: { ...G.stat, gym: false } }, at(21, 5)).some(r => r.key.endsWith('|water|gym')));
  assert.ok(!dueReminders({ ...G, stat: { ...G.stat, h2o: 8 } }, at(21, 5)).some(r => r.key.endsWith('|water|gym')));
});
console.log(`\n${n} api checks passed`);
