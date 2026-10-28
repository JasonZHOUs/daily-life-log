// Runs the app script from index.html in a stubbed DOM and checks the pure logic.
// Usage: node tests/run.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const app = scripts[scripts.length - 1];

function makeEnv(lang = 'en-SG') {
  const els = {};
  const el = id => els[id] || (els[id] = { id, innerHTML: '', textContent: '', value: '', focus() {}, select() {} });
  const store = {};
  const ctx = {
    console, Date, Math, JSON, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
    navigator: { language: lang },
    document: {
      querySelector: s => el(s.replace('#', '')), addEventListener() {}, documentElement: {}, hidden: false,
      createElement: () => ({ click() {}, set href(v) {}, set download(v) {} }), body: { appendChild() {}, removeChild() {} },
    },
    addEventListener() {}, location: { reload() {} }, Blob: class {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(app, ctx, { filename: 'index.html' });
  return { run: code => vm.runInContext(code, ctx), els, store };
}

const env0 = makeEnv(); env0.els = env0.els;
const env = { run: code => { const v = env0.run(`JSON.stringify((()=>{return ${code}})())`); return v === undefined ? undefined : JSON.parse(v); } };
const P = s => env.run(`parseLine(${JSON.stringify(s)}).map(r=>r.e?{b:r.e.b,g:r.e.g,k:r.e.k}:null)`);
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok -', name); };

ok('english list with counts', () => {
  const r = P('2 eggs, chicken rice, kopi');
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], { b: 'Egg', g: 100, k: 143 });
  assert.equal(r[1].b, 'Chicken rice'); assert.equal(r[1].g, 380);
  assert.equal(r[2].b, 'Kopi (with condensed milk)');
});
ok('grams and trailing quantity', () => {
  const r = P('chicken breast 150g; rice x2');
  assert.equal(r[0].b, 'Chicken breast, cooked'); assert.equal(r[0].g, 150); assert.equal(r[0].k, 248);
  assert.equal(r[1].b, 'Rice, cooked, white'); assert.equal(r[1].g, 400);
});
ok('units and "of"', () => {
  const r = P('1 cup of milk, half bowl rice, 2 slices whole wheat bread');
  assert.equal(r[0].b, 'Milk, whole'); assert.equal(r[0].g, 250);
  assert.equal(r[1].g, 100);
  assert.equal(r[2].b, 'Whole wheat bread'); assert.equal(r[2].g, 70);
});
ok('chinese with numerals and units', () => {
  const r = P('两个鸡蛋，一碗米饭、鸡饭和咖啡');
  assert.deepEqual(r.map(x => x.b), ['Egg', 'Rice, cooked, white', 'Chicken rice', 'Kopi (with condensed milk)']);
  assert.equal(r[0].g, 100); assert.equal(r[1].g, 200);
});
ok('chinese name starting with a numeral is not a quantity', () => {
  const r = P('三文鱼 200克');
  assert.equal(r[0].b, 'Salmon, cooked'); assert.equal(r[0].g, 200);
});
ok('kopi o vs kopi', () => {
  assert.equal(P('kopi o')[0].b, 'Kopi O (black, sugar)');
  assert.equal(P('kopi-o')[0].b, 'Kopi O (black, sugar)');
});
ok('dish names containing "and" are kept whole', () => {
  const r = P('sweet and sour pork');
  assert.equal(r.length, 1); assert.equal(r[0].b, 'Sweet and sour pork');
  const r2 = P('eggs and toast');
  assert.equal(r2.length, 2);
});
ok('kcal-only items', () => {
  const r = P('300 kcal cake, 2 satay');
  assert.equal(r[0].k, 300); assert.equal(r[0].b, 'cake');
  assert.equal(r[1].b, 'Chicken satay'); assert.equal(r[1].k, 78);
});
ok('unknown food is reported, not guessed', () => {
  const r = P('2 eggs, zzzqqq');
  assert.equal(r[1], null);
});
ok('remembered portion is used', () => {
  env0.run(`S.gm['Greek yogurt']=200`);
  assert.equal(P('greek yogurt')[0].g, 200);
  assert.equal(P('2 greek yogurt')[0].g, 400);
});
ok('per-portion presets multiply', () => {
  const r = P('2 handful of nuts');
  assert.equal(r[0].b, 'Handful of nuts'); assert.equal(r[0].k, 360);
});
ok('recent meals are remembered and deduplicated', () => {
  env0.run(`lp=parseLine('2 eggs, kopi');addLine(day('2026-01-01'));lp=parseLine('2 eggs, kopi');addLine(day('2026-01-01'))`);
  assert.equal(env.run('S.meals.length'), 1);
  assert.equal(env.run('S.meals[0].n'), 2);
  assert.equal(env.run(`S.days['2026-01-01'].food.length`), 4);
});
ok('every dish converts to sane per-100 g values', () => {
  const bad = env.run('DISH.filter(x=>!(x.k>0&&x.k<1000&&x.u&&x.u[1]>0&&x.p>=0&&x.f>=0&&x.c>=0)).map(x=>x.b)');
  assert.deepEqual(bad, []);
});
ok('every I string has English and Chinese', () => {
  const bad = env.run('Object.keys(I).filter(k=>!(I[k].length===2&&I[k][0]&&I[k][1]))');
  assert.deepEqual(bad, []);
});

if (env.run('typeof tpl') === 'function') {
  ok('template drives new day plans', () => {
    env0.run(`S.tpl=[['1','09:00','Lab','实验']]`);
    const p = env.run(`plan(norm({}),'2026-10-26').map(x=>x.n)`); // a Monday
    assert.deepEqual(p, ['Lab']);
    const p2 = env.run(`plan(norm({}),'2026-10-27').length`);
    assert.equal(p2, 0);
    env0.run('S.tpl=null');
  });
}
if (env.run('typeof weekSummary') === 'function') {
  ok('weekly summary numbers', () => {
    env0.run(`S.days={};S.t={k:2800,p:120};
      for(let i=0;i<7;i++){const k=shift('2026-10-26',-i);S.days[k]=norm({food:[{b:'x',k:2500,p:i<3?130:90,f:0,c:0}],gym:i%2?['Chest']:[],eng:i<2})}`);
    const s = env.run(`(()=>{const s=weekSummary('2026-10-26');return {ak:s.ak,ap:s.ap,pd:s.pd,fd:s.fd,gy:s.gy,sug:s.sug}})()`);
    assert.equal(s.ak, 2500); assert.equal(s.pd, 3); assert.equal(s.fd, 7); assert.equal(s.gy, 3);
    assert.ok(s.sug.length >= 1 && s.sug.length <= 3);
  });
}
if (env.run('typeof toCSV') === 'function') {
  ok('csv export escapes and has a row per day', () => {
    env0.run(`S.days={'2026-10-01':norm({food:[{b:'Egg, "big"',k:70,p:6,f:5,c:0}],win:'a,b'})}`);
    const csv = env.run('toCSV()');
    const lines = csv.replace(/^﻿/, '').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[1].includes('"Egg, ""big"""'));
    assert.ok(lines[1].includes('"a,b"'));
  });
}
ok('every tab renders in both languages without throwing', () => {
  for (const lang of ['en', 'zh']) for (const tb of ['today', 'food', 'act', 'rev']) {
    env0.run(`S.lang='${lang}';tab='${tb}';render()`);
    assert.ok(env0.els.app.innerHTML.length > 200, `${lang}/${tb} rendered`);
  }
});
ok('what is new card shows once', () => {
  env0.run(`S.lang='en';S.seen=undefined;tab='food';render()`);
  assert.ok(env0.els.app.innerHTML.includes('data-a="seen"'));
  env0.run(`S.seen=VER;render()`);
  assert.ok(!env0.els.app.innerHTML.includes('data-a="seen"'));
});
ok('adaptive calories from intake and weight trend', () => {
  // 28 days at 3000 kcal, weight rising 0.5 kg over 21 days => slope ~0.0238 kg/day => burn ~ 3000-183 = ~2820
  env0.run(`S.days={};for(let i=0;i<28;i++){const k=shift('2026-10-26',-i);S.days[k]=norm({food:[{b:'x',k:3000,p:0,f:0,c:0}]})}
    S.days['2026-10-26'].wt='65.5';S.days['2026-10-05'].wt='65.0'`);
  const a = env.run(`adaptive('2026-10-26')`);
  assert.equal(a.ok, true); assert.equal(a.ai, 3000);
  assert.ok(Math.abs(a.burn - 2820) <= 10, 'burn ' + a.burn);
  assert.equal(a.target, 3100);
  env0.run(`delete S.days['2026-10-05'].wt`);
  assert.equal(env.run(`adaptive('2026-10-26').ok`), false);
});
ok('patterns compare sleep groups', () => {
  env0.run(`S.days={};for(let i=0;i<12;i++){const k=shift('2026-10-26',-i);S.days[k]=norm({sl:i<6?'8':'5',mood:i<6?5:2,min:{study:i<6?120:30}})}`);
  const p = env.run(`patterns('2026-10-26')`);
  assert.equal(p.length, 2);
  assert.ok(p[0].includes('5') && p[0].includes('2'));
  assert.ok(p[1].includes('120') && p[1].includes('30'));
});
ok('workout log: canonical names, last time, PR', () => {
  env0.run(`S.lang='en';S.days={};S.days['2026-10-20']=norm({wk:[{x:'Bench press',s:[{r:8,kg:60},{r:8,kg:60}]}]});
    S.days['2026-10-26']=norm({wk:[{x:'Bench press',s:[{r:8,kg:62.5}]}]});cur='2026-10-26';tab='act';render()`);
  const h = env0.els.app.innerHTML;
  assert.ok(h.includes('Last time (10-20): 8×60, 8×60'));
  assert.ok(h.includes('🏆'));
  assert.equal(env.run(`exF('卧推')[0]`), 'Bench press');
  env0.run(`S.lang='zh';render()`);
  assert.ok(env0.els.app.innerHTML.includes('卧推'));
  const s = env.run(`weekSummary('2026-10-26').vol`);
  assert.equal(s.Chest, 3);
});
ok('check-in renders and csv has new columns', () => {
  env0.run(`S.lang='en';S.days={'2026-10-26':norm({mood:4,nrg:3,sl:'7.5',h2o:5,stp:'9000'})};cur='2026-10-26';tab='today';render()`);
  const h = env0.els.app.innerHTML;
  assert.ok(h.includes('data-a="mood" data-v="4"') && h.includes('5 / 8'));
  const row = env.run('toCSV()').trim().split('\n')[1];
  assert.ok(row.endsWith('4,3,7.5,5,9000,'), row);
});
ok('photo results rescale with grams and render', () => {
  env0.run(`S.lang='en';tab='food';ph={st:'done',img:'',note:'',it:[{b:'Chicken rice',z:'鸡饭',g:380,k:607,p:25,f:23,c:75,o:{g:380,k:607,p:25,f:23,c:75}}]};phScale(ph.it[0],190);render()`);
  const x = env.run('ph.it[0]');
  assert.equal(x.k, 304); assert.equal(x.p, 12.5);
  assert.ok(env0.els.app.innerHTML.includes('data-a="phadd"'));
  env0.run(`ph={st:''}`);
});
ok('AI app replies are parsed: lines, joined lines, units, numbering, headers', () => {
  const P = s => env.run(`parsePipe(${JSON.stringify(s)}).map(x=>[x.b,x.g,x.k,x.p,x.f,x.c])`);
  const lines = '名称 | 克数 | 热量 | 蛋白质 | 脂肪 | 碳水\n鸡饭 | 380 | 607 | 25 | 23 | 75\n冰柠檬茶 | 400 | 160 | 0 | 0 | 40';
  assert.deepEqual(P(lines), [['鸡饭', 380, 607, 25, 23, 75], ['冰柠檬茶', 400, 160, 0, 0, 40]]);
  assert.deepEqual(P(lines.replace(/\n/g, ' ')), P(lines));           // pasted into a one-line input
  assert.deepEqual(P('1. Chicken rice ｜ 380g ｜ 607 kcal ｜ 25g ｜ 23g ｜ 75g\n- Kopi | 250 | 125 | 2 | 3.5 | 21'),
    [['Chicken rice', 380, 607, 25, 23, 75], ['Kopi', 250, 125, 2, 3.5, 21]]);
  assert.deepEqual(P('hello, no table here'), []);
  assert.equal(env.run(`parsePipe('鸡饭 | 380 | 607 | 25 | 23 | 75')[0].z`), '鸡饭');
});
ok('pasting an AI reply into the search box opens the editable list', () => {
  env0.run(`S.lang='zh';tab='food';ph={st:''};render();aiLoad('鸡饭 | 380 | 607 | 25 | 23 | 75');render()`);
  const h = env0.els.app.innerHTML;
  assert.ok(h.includes('data-a="phadd"') && h.includes('鸡饭') && h.includes('607'));
  env0.run(`ph={st:'err',msg:'x'};render()`);
  assert.ok(env0.els.app.innerHTML.includes('data-a="aicopy"'));
  env0.run(`ph={st:''}`);
});
ok('supplements: toggle, group all, completion flag, summary, csv', () => {
  env0.run(`S.lang='zh';S.days={};cur='2026-10-28';tab='food';render()`);
  let h = env0.els.app.innerHTML;
  assert.ok(h.includes('复合维生素矿物质片') && h.includes('肌酸') && h.includes('6 克') && h.includes('护肝茶'));
  assert.ok(h.indexOf('class="c hero"') < h.indexOf('补剂'), 'ring above supplements');
  env0.run(`{const d=day();['multi','fo_am','crea'].forEach(id=>{d.sp[id]=true});supSync(d)}`);
  assert.equal(env.run(`day().supp`), false);
  env0.run(`{const d=day();SUPS.filter(s=>s[1]==='pm').forEach(s=>{d.sp[s[0]]=true});d.sp.goji=true;supSync(d)}`);
  assert.equal(env.run(`day().supp`), true);
  assert.ok(env.run('toCSV()').includes('multi fo_am crea fo_pm mg goji'));
  const w = env.run(`weekSummary('2026-10-28')`);
  assert.equal(w.spl, 1); assert.equal(w.spc, 1);
  env0.run(`render()`);
  assert.ok(env0.els.tabs.innerHTML.indexOf('data-t="food"') < env0.els.tabs.innerHTML.indexOf('data-t="today"'));
  assert.ok(env0.els.tabs.innerHTML.includes('计划'));
});
console.log(`\n${n} checks passed`);
