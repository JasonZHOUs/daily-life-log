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
  assert.equal((await analyzeGemini('k', 'B', 'en', f(429))).status, 429);
  assert.equal((await analyzeGemini('k', 'B', 'en', f(500))).status, 502);
  console.error = orig;
});
console.log(`\n${n} api checks passed`);
