// Report only: UI string keys in the I dictionary that no code seems to use. Deletes nothing.
// Usage: node tools/unused.mjs
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const a = src.indexOf('const I={'), b = src.indexOf('\n};', a);
const dict = src.slice(a, b), rest = src.slice(0, a) + src.slice(b);
const keys = [...dict.matchAll(/(?:^|[,{\n])\s*([A-Za-z_$][\w$]*):\[/g)].map(m => m[1]);
// keys built at run time, like t('sm'+x) or t('g_'+id)
const prefixes = [...new Set([...rest.matchAll(/['"`]([A-Za-z_$][\w$]*)['"`]\s*\+/g)].map(m => m[1]))];
const unused = [], maybe = [];
for (const k of keys) {
  if (new RegExp(`['"\`]${k.replace(/\$/g, '\$')}['"\`]`).test(rest)) continue;
  (prefixes.some(p => k.startsWith(p) && k !== p) ? maybe : unused).push(k);
}
console.log(`${keys.length} keys`);
console.log(`unused (${unused.length}): ${unused.join(' ')}`);
console.log(`possibly built at run time (${maybe.length}): ${maybe.join(' ')}`);
