// レシピの検証: 同じ配合の重複がないか、紛らわしすぎる組がないか、注文文の書式が正しいか
import { RECIPES } from '../src/data/recipes.ts';
import { similarity, identify } from '../src/sim/scoring.ts';
import { MODIFIERS } from '../src/data/modifiers.ts';

let ok = true;
const KEYS = new Set(['name', 'cat', 'temp', 'form', 'color', 'taste', 'mod', 'ing', 'vessel']);

// 1) 自分自身として識別されるか
for (const r of RECIPES) {
  const id = identify(r);
  if (id.recipe?.id !== r.id) {
    console.log(`✗ ${r.name} は ${id.recipe?.name ?? '不明'} と識別される (${id.score})`);
    ok = false;
  }
}

// 2) 近すぎる組
const pairs: [number, string, string][] = [];
for (let i = 0; i < RECIPES.length; i++) {
  for (let j = i + 1; j < RECIPES.length; j++) {
    const s = similarity(RECIPES[i], RECIPES[j]);
    if (s >= 75) pairs.push([s, RECIPES[i].name, RECIPES[j].name]);
  }
}
pairs.sort((a, b) => b[0] - a[0]);
console.log(`\n近い組（類似度 75 以上）: ${pairs.length} 件`);
for (const [s, a, b] of pairs) console.log(`  ${s.toFixed(1)}  ${a} ⇔ ${b}`);

// 3) 注文文の書式
const re = /\{([^{}:]+):(\w+)=([^{}]+)\}/g;
function checkText(where: string, t: string) {
  const stripped = t.replace(re, (_m, _d, k: string) => {
    if (!KEYS.has(k)) {
      console.log(`✗ ${where}: 不明なキー ${k}`);
      ok = false;
    }
    return '';
  });
  if (/[{}]/.test(stripped)) {
    console.log(`✗ ${where}: 括弧の閉じ忘れ → ${t}`);
    ok = false;
  }
}
for (const r of RECIPES) {
  for (const lv of ['lv1', 'lv2', 'lv3'] as const) r.orders[lv].forEach((t, i) => checkText(`${r.name} ${lv}[${i}]`, t));
  if (r.day > 0 && (r.orders.lv1.length < 1 || r.orders.lv2.length < 1 || r.orders.lv3.length < 1)) {
    console.log(`✗ ${r.name}: 注文文が足りない`);
    ok = false;
  }
}
for (const m of Object.values(MODIFIERS)) m.say.forEach((t, i) => checkText(`要望 ${m.id} say[${i}]`, t));

// 4) 日ごとの解放数
const byDay = new Map<number, string[]>();
for (const r of RECIPES) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r.name]);
console.log('\n日ごとの解放:');
for (const [d, names] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) console.log(`  Day ${d}: ${names.length} 件  ${names.join('、')}`);

console.log(ok ? '\nOK' : '\nNG');
if (!ok) process.exit(1);
