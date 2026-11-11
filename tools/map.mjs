// Prints a map of index.html: its section comments and the top-level functions under each, with line numbers.
// Usage: node tools/map.mjs [filter]   e.g. node tools/map.mjs sync   or   node tools/map.mjs isoCard
// Then read just that part, e.g.: sed -n '1471,1480p' index.html
import fs from 'node:fs';
const lines = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').split('\n');
const filter = (process.argv[2] || '').toLowerCase();
const out = []; let sec = null;
lines.forEach((l, i) => {
  const s = l.match(/^\/\* -{10} (.+?)(?: -{10}.*)?$/);
  if (s) { sec = { name: s[1].split(/: |; /)[0].slice(0, 70), line: i + 1, fns: [] }; out.push(sec); return; }
  const f = l.match(/^(?:async )?function ([\w$]+)/);
  if (f && sec) sec.fns.push(f[1] + ':' + (i + 1));
});
for (const s of out) {
  const hit = !filter || s.name.toLowerCase().includes(filter) || s.fns.some(f => f.toLowerCase().includes(filter));
  if (hit) console.log(`${s.line}  ${s.name}\n    ${s.fns.join(' ')}`);
}
