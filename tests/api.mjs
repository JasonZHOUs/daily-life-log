// Checks api/food-photo.js without calling the real Claude API or Supabase.
// Usage: node tests/api.mjs
import assert from 'node:assert/strict';
import handler, { analyze, checkUser } from '../api/food-photo.js';

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
console.log(`\n${n} api checks passed`);
