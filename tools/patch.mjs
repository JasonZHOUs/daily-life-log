// Safe text patches: every anchor must occur exactly once, and nothing is written unless all of them do.
// Usage: node tools/patch.mjs <spec.mjs>
// The spec file's default export is a list of steps:
//   { file: 'index.html', find: 'exact text', replace: 'new text' }   replace the anchor
//   { file: 'tests/run.mjs', before: 'exact text', insert: 'new text' } insert in front of the anchor
//   { file: 'index.html', after: 'exact text', insert: 'new text' }    insert behind the anchor
// Paths are relative to the repo root. Keep spec files outside the repo (for example in a scratch folder).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = process.argv[2];
if (!spec) { console.error('usage: node tools/patch.mjs <spec.mjs>'); process.exit(2); }
const steps = (await import(pathToFileURL(path.resolve(spec)).href)).default;
const files = new Map();
const text = f => { if (!files.has(f)) files.set(f, fs.readFileSync(path.join(root, f), 'utf8')); return files.get(f); };
const errors = [];
steps.forEach((s, i) => {
  const anchor = s.find ?? s.before ?? s.after;
  const src = text(s.file);
  const count = anchor ? src.split(anchor).length - 1 : 0;
  if (count !== 1) { errors.push(`step ${i + 1} (${s.file}): anchor found ${count} times: ${String(anchor).slice(0, 70)}`); return; }
  const out = s.find != null ? s.replace : s.before != null ? s.insert + anchor : anchor + s.insert;
  files.set(s.file, src.replace(anchor, () => out));
});
if (errors.length) { console.error(errors.join('\n')); console.error('nothing written'); process.exit(1); }
for (const [f, src] of files) fs.writeFileSync(path.join(root, f), src);
console.log('patched', [...files.keys()].join(', '), '(' + steps.length + ' steps)');
