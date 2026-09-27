import type { Formula, IngId, ModifierId, Personality, QuestionId, Recipe } from '../data/types.ts';
import type { Citizen } from '../data/characters.ts';
import { ANSWER_WRAP, GREETINGS, STORY_CAST, randomCitizen } from '../data/characters.ts';
import type { DayDef, StoryOrder } from '../data/days.ts';
import { RECIPE, recipesUpToDay } from '../data/recipes.ts';
import { CATEGORY, FORM, HEAT } from '../data/processes.ts';
import { ALLERGY_MODS, MODIFIERS } from '../data/modifiers.ts';
import { identify, type OrderSpec } from './scoring.ts';
import { pick, weightedPick } from '../util/rng.ts';

export type SpecialKind = 'nikujaga' | 'free' | 'usual';

export interface ActiveOrder {
  citizen: Citizen;
  spec: OrderSpec;
  clarity: 1 | 2 | 3;
  /** 注文の台詞（キーワード書式つき） */
  lines: string[];
  story?: StoryOrder;
  special?: SpecialKind;
  questionsLeft: number;
  asked: QuestionId[];
  patienceMax: number;
  patience: number;
  answers: Record<QuestionId, string>;
  /** ID カードに書かれた注意（アレルギー） */
  cardAllergy: ModifierId | null;
}

export interface RunFlags {
  nikujaga: boolean;
  usedRecipes: string[];
}

// ───────────── キーワード書式 ─────────────

export interface Token {
  text: string;
  key?: string;
  value?: string;
}

const RE = /\{([^{}:]+):(\w+)=([^{}]+)\}/g;

export function parseMarkup(s: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of s.matchAll(RE)) {
    if (m.index! > last) out.push({ text: s.slice(last, m.index) });
    out.push({ text: m[1], key: m[2], value: m[3] });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

export function plain(s: string): string {
  return s.replace(RE, (_m, t: string) => t);
}

// ───────────── 答えの自動生成 ─────────────

const TASTE_WORD: Record<string, [string, string]> = {
  甘: ['甘い', '甘くて'],
  辛: ['辛い', '辛くて'],
  塩: ['しょっぱい', 'しょっぱくて'],
  酸: ['すっぱい', 'すっぱくて'],
  苦: ['苦い', '苦くて'],
  旨: ['旨みがある', '旨みがあって'],
  淡: ['あっさりしてる', 'あっさりしてて'],
};
const COLOR_WORD: Record<string, string> = {
  茶: '茶色',
  白: '白',
  黄: '黄色',
  赤: '赤',
  緑: '緑',
  黒: '黒',
  桃: 'ピンク',
  橙: 'オレンジ色',
  灰: '灰色',
  透明: '透明',
  金: '金色',
};

function tasteAnswer(r: Recipe): string {
  const t = r.tastes.slice(0, 2);
  if (t.length === 1) return TASTE_WORD[t[0]][0];
  return `${TASTE_WORD[t[0]][1]}、${TASTE_WORD[t[1]][0]}`;
}
function colorAnswer(r: Recipe): string {
  const c = r.colors.slice(0, 2).map((x) => COLOR_WORD[x]);
  return c.length === 1 ? `${c[0]}っぽい` : `${c[0]}と${c[1]}`;
}

function wrap(p: Personality, rng: () => number, a: string): string {
  return pick(rng, ANSWER_WRAP[p]).replace('{a}', a);
}

export function buildAnswers(r: Recipe, c: Citizen, rng: () => number, story?: StoryOrder): Record<QuestionId, string> {
  const p = c.personality;
  // 答えの中心部分はキーワード（押すとレシピ DB の絞り込みに使える）にする
  const kw = (text: string, key: string, value: string) => `{${text}:${key}=${value}}`;
  const base: Record<QuestionId, string> = {
    temp: wrap(p, rng, kw(pick(rng, HEAT[r.heat].talk), 'temp', r.heat)),
    form: wrap(p, rng, kw(pick(rng, FORM[r.form].talk), 'form', r.form)),
    taste: wrap(p, rng, kw(tasteAnswer(r), 'taste', r.tastes[0])),
    color: wrap(p, rng, kw(colorAnswer(r), 'color', r.colors[0])),
    cat: wrap(p, rng, kw(CATEGORY[r.cat].talk, 'cat', r.cat)),
    memory: pick(rng, r.memory),
  };
  if (story?.answers) for (const [k, v] of Object.entries(story.answers)) base[k as QuestionId] = v;
  return base;
}

// ───────────── 注文の組み立て ─────────────

function chooseClarity(rng: () => number, w: [number, number, number]): 1 | 2 | 3 {
  return weightedPick(rng, [1, 2, 3] as const, w);
}

function chooseRecipe(rng: () => number, day: DayDef, flags: RunFlags, usedToday: string[], endless: boolean): Recipe {
  const pool = recipesUpToDay(endless ? 7 : day.day).filter((r) => r.orders.lv1.length > 0 && r.cat !== 'ration');
  const weights = pool.map((r) => {
    if (usedToday.includes(r.id)) return 0.05;
    let w = 1;
    if (!endless && r.day === day.day) w *= 2.6;
    const used = flags.usedRecipes.filter((x) => x === r.id).length;
    w /= 1 + used * 0.8;
    return w;
  });
  return weightedPick(rng, pool, weights);
}

function chooseModifier(rng: () => number, r: Recipe, day: DayDef, citizen: Citizen): ModifierId | null {
  if (!day.modPool.length || rng() > day.modChance) return null;
  const options = day.modPool.filter((m) => MODIFIERS[m].applies(r));
  // 子どもは大盛り・猫舌・甘めが多め
  if (!options.length) return null;
  const weights = options.map((m) => {
    if (ALLERGY_MODS.includes(m)) return 0.9;
    if (citizen.personality === 'child' && (m === 'sweet' || m === 'nekojita' || m === 'nospicy')) return 2.2;
    if (citizen.personality === 'tired' && (m === 'oomori' || m === 'atsuatsu')) return 1.8;
    return 1;
  });
  return weightedPick(rng, options, weights);
}

function orderText(r: Recipe, clarity: 1 | 2 | 3, rng: () => number): string {
  const lv = clarity === 1 ? r.orders.lv1 : clarity === 2 ? r.orders.lv2 : r.orders.lv3;
  return pick(rng, lv);
}

export interface MakeOrderArgs {
  rng: () => number;
  day: DayDef;
  index: number;
  flags: RunFlags;
  usedToday: string[];
  relaxed: boolean;
  endless: boolean;
}

export function makeOrder(a: MakeOrderArgs): ActiveOrder {
  const { rng, day, index, flags } = a;
  const story = a.endless ? undefined : day.story[index];
  if (story) return makeStoryOrder(a, story);

  const citizen = randomCitizen(rng, index + day.day * 100);
  const fixed = a.endless ? undefined : day.fixed?.[index];
  const recipe = fixed ? RECIPE[fixed.recipe] : chooseRecipe(rng, day, flags, a.usedToday, a.endless);
  const clarity = fixed ? fixed.clarity : chooseClarity(rng, day.clarity);
  const mod = fixed ? null : chooseModifier(rng, recipe, day, citizen);

  const lines: string[] = [pick(rng, GREETINGS[citizen.personality])];
  let text = orderText(recipe, clarity, rng);
  let cardAllergy: ModifierId | null = null;
  if (mod) {
    const def = MODIFIERS[mod];
    if (ALLERGY_MODS.includes(mod)) {
      cardAllergy = mod;
      // アレルギーは ID カードに必ず書かれる。口で言うかは半々
      if (rng() < 0.45) text += ' ' + pick(rng, def.say);
      else if (rng() < 0.5) text += ' ' + pick(rng, def.hint);
    } else if (clarity === 3 && rng() < 0.6) {
      text += ' ' + pick(rng, def.hint);
    } else {
      text += ' ' + pick(rng, def.say);
    }
  }
  lines.push(text);

  const spec: OrderSpec = { target: recipe, modifiers: mod ? [mod] : [], shortages: day.shortages, weight: 1 };
  const patienceMax = day.patience * citizen.patienceMul;
  return {
    citizen,
    spec,
    clarity,
    lines,
    questionsLeft: day.questions,
    asked: [],
    patienceMax,
    patience: patienceMax,
    answers: buildAnswers(recipe, citizen, rng),
    cardAllergy,
  };
}

function makeStoryOrder(a: MakeOrderArgs, story: StoryOrder): ActiveOrder {
  const { rng, day, flags } = a;
  const citizen = STORY_CAST[story.story];
  let recipe: Recipe;
  let special: SpecialKind | undefined;
  let specialFn: OrderSpec['special'];
  if (story.recipe === '@nikujaga') {
    recipe = RECIPE.nikujaga;
    special = 'nikujaga';
    specialFn = nikujagaEval;
  } else if (story.recipe === '@usual') {
    recipe = flags.nikujaga ? RECIPE.nikujaga : RECIPE.misoshiru;
    special = 'usual';
  } else if (story.recipe === '@free') {
    recipe = RECIPE.shortcake;
    special = 'free';
    specialFn = freeEval;
  } else {
    recipe = RECIPE[story.recipe];
  }
  const mods = story.modifiers ?? [];
  const spec: OrderSpec = {
    target: recipe,
    modifiers: mods,
    shortages: special === 'nikujaga' || special === 'free' ? [] : day.shortages,
    weight: story.weight ?? 1,
    special: specialFn,
  };
  const patienceMax = day.patience * citizen.patienceMul * (special ? 1.35 : 1);
  return {
    citizen,
    spec,
    clarity: 3,
    lines: [...story.lines],
    story,
    special,
    questionsLeft: Math.max(day.questions, special === 'nikujaga' ? 3 : 0),
    asked: [],
    patienceMax,
    patience: patienceMax,
    answers: buildAnswers(recipe, citizen, rng, story),
    cardAllergy: null,
  };
}

// ───────────── 特別注文の判定 ─────────────

function n(f: Formula, id: IngId): number {
  return (f.ing[id] ?? 0) + (f.topping === id ? 1 : 0);
}

/** ゲンゾウの「名前を思い出せない料理」（肉じゃが）。レシピ DB に無いので、要素ごとに判定する */
export function nikujagaEval(made: Formula, burnt: boolean): { score: number; notes: string[] } {
  let s = 0;
  const notes: string[] = [];
  if (n(made, 'brown') >= 1) {
    s += 22;
    notes.push('肉がちゃんと入っとる');
  } else if (n(made, 'grey') >= 1) s += 10;
  else notes.push('肉が…見当たらんな');
  if (n(made, 'white') >= 1) {
    s += 20;
    notes.push('芋じゃ。ほくほくしとる');
  } else notes.push('芋が…ない');
  if (n(made, 'black') >= 1) {
    s += 16;
    notes.push('醤油の香りじゃ');
  }
  if (n(made, 'pink') >= 1) {
    s += 16;
    notes.push('甘い…そう、甘かったんじゃ');
  }
  if (made.form === 'cube') s += 12;
  else if (made.form === 'ball') s += 8;
  else if (made.form === 'liquid') s += 3;
  if (made.heat === 'warm') s += 10;
  else if (made.heat === 'hot') s += 6;
  else notes.push('冷たいのう');
  if (made.vessel === 'deep' || made.vessel === 'bowl' || made.vessel === 'chawan') s += 4;
  for (const odd of ['spice', 'milk', 'red', 'amber'] as IngId[]) if (n(made, odd) > 0) s -= 8;
  if (n(made, 'green') > 1) s -= 5;
  if (burnt) {
    s -= 30;
    notes.push('焦げとる…');
  }
  return { score: Math.max(0, Math.min(100, s)), notes };
}

/** ミナの「AI さんのすきなもの」。ちゃんと何かの料理になっていれば喜ぶ */
export function freeEval(made: Formula, burnt: boolean): { score: number; notes: string[] } {
  if (burnt) return { score: 38, notes: [] };
  const id = identify(made);
  if (id.recipe && id.score >= 85) return { score: 97, notes: [id.recipe.base] };
  if (id.recipe && id.score >= 65) return { score: 84, notes: [id.recipe.base] };
  return { score: 66, notes: [] };
}
