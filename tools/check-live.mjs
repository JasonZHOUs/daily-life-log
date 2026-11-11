// After a deploy: does the live site serve this version?
// Usage: node tools/check-live.mjs [identifier ...]   (each identifier must appear in the live page)
// Waits up to 3 minutes for Vercel to finish.
import fs from 'node:fs';
const URL_ = 'https://daily-life-log.vercel.app/';
const local = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ver = s => (s.match(/VER='([^']+)'/) || [])[1];
const want = ver(local), ids = process.argv.slice(2);
for (let i = 0; i < 18; i++) {
  let live = '';
  try { live = await (await fetch(URL_ + '?_=' + Date.now(), { cache: 'no-store' })).text(); } catch (e) { live = ''; }
  const missing = ids.filter(x => !live.includes(x));
  if (ver(live) === want && !missing.length) { console.log('live: VER ' + want + (ids.length ? ', found ' + ids.join(', ') : '')); process.exit(0); }
  console.log('waiting: live VER ' + ver(live) + ', want ' + want + (missing.length ? ', missing ' + missing.join(', ') : ''));
  await new Promise(r => setTimeout(r, 10000));
}
console.error('not live after 3 minutes'); process.exit(1);
