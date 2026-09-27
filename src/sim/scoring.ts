import type { Build, Formula, IngCounts, IngId, ModifierId, Recipe } from '../data/types.ts';
import { ING_IDS, SUBSTITUTES } from '../data/ingredients.ts';
import { BURN_AT, FORM_NEAR, heatFromTemp, heatIndex, VESSEL_NEAR } from '../data/processes.ts';
import { RECIPES } from '../data/recipes.ts';
import { ALLERGY_MODS, applyModifierToIdeal, MODIFIERS } from '../data/modifiers.ts';

export function emptyBuild(): Build {
  const ing = Object.fromEntries(ING_IDS.map((id) => [id, 0])) as Record<IngId, number>;
  return { ing, form: null, temp: 0, heated: false, topping: null, toppingSet: false, vessel: null };
}

export function totalUnits(ing: IngCounts): number {
  let s = 0;
  for (const id of ING_IDS) s += ing[id] ?? 0;
  return s;
}

export function buildToFormula(b: Build): Formula {
  const ing: IngCounts = {};
  for (const id of ING_IDS) if (b.ing[id] > 0) ing[id] = b.ing[id];
  return {
    ing,
    form: b.form ?? 'liquid',
    heat: heatFromTemp(Math.min(b.temp, BURN_AT)),
    topping: b.topping,
    vessel: b.vessel ?? 'plate',
  };
}

export function isBurnt(b: Build): boolean {
  return b.temp > BURN_AT;
}

/** 欠品素材を代替素材に置き換えたレシピ */
export function applyShortages(f: Formula, shortages: IngId[]): Formula {
  if (!shortages.length) return f;
  const ing: IngCounts = {};
  for (const id of ING_IDS) {
    const n = f.ing[id] ?? 0;
    if (!n) continue;
    const sub = shortages.includes(id) ? SUBSTITUTES[id] : undefined;
    if (sub) {
      for (const [sid, sn] of Object.entries(sub.ing) as [IngId, number][]) ing[sid] = (ing[sid] ?? 0) + sn * n;
    } else {
      ing[id] = (ing[id] ?? 0) + n;
    }
  }
  let topping = f.topping;
  if (topping && shortages.includes(topping)) topping = SUBSTITUTES[topping]?.topping ?? null;
  return { ...f, ing, topping };
}

export function usesShortage(f: Formula, shortages: IngId[]): boolean {
  return shortages.some((s) => (f.ing[s] ?? 0) > 0 || f.topping === s);
}

export interface Penalties {
  ing: number;
  form: number;
  heat: number;
  burnt: number;
  topping: number;
  vessel: number;
}

const near = <T>(pairs: [T, T][], a: T, b: T) => pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

export function penalties(made: Formula, target: Formula, burnt = false): Penalties {
  let l1 = 0;
  let sa = 0;
  let sb = 0;
  for (const id of ING_IDS) {
    const a = made.ing[id] ?? 0;
    const b = target.ing[id] ?? 0;
    l1 += Math.abs(a - b);
    sa += a;
    sb += b;
  }
  const ing = sa + sb === 0 ? 0 : (60 * l1) / (sa + sb);
  const form = made.form === target.form ? 0 : near(FORM_NEAR, made.form, target.form) ? 10 : 22;
  const d = Math.abs(heatIndex(made.heat) - heatIndex(target.heat));
  const heat = [0, 12, 24, 34, 40][d];
  let topping = 0;
  if (made.topping !== target.topping) topping = made.topping && target.topping ? 10 : 12;
  const vessel = made.vessel === target.vessel ? 0 : near(VESSEL_NEAR, made.vessel, target.vessel) ? 4 : 8;
  return { ing, form, heat, burnt: burnt ? 30 : 0, topping, vessel };
}

export function sumPenalties(p: Penalties): number {
  return p.ing + p.form + p.heat + p.burnt + p.topping + p.vessel;
}

export function similarity(made: Formula, target: Formula): number {
  return Math.max(0, 100 - sumPenalties(penalties(made, target)));
}

/** 作ったものが何に一番近いか（市民から見て「何風」に見えるか） */
export function identify(made: Formula, pool: Recipe[] = RECIPES): { recipe: Recipe | null; score: number } {
  let best: Recipe | null = null;
  let bestScore = -1;
  for (const r of pool) {
    const s = similarity(made, r);
    if (s > bestScore) {
      bestScore = s;
      best = r;
    }
  }
  if (bestScore < 45) return { recipe: null, score: bestScore };
  return { recipe: best, score: bestScore };
}

export type IssueKind =
  | 'timeout'
  | 'allergy'
  | 'unknown'
  | 'wrongDish'
  | 'burnt'
  | 'heatLow'
  | 'heatHigh'
  | 'form'
  | 'ingMissing'
  | 'ingExtra'
  | 'toppingMissing'
  | 'toppingExtra'
  | 'toppingWrong'
  | 'vessel'
  | 'mod'
  | 'slow';

export interface Issue {
  kind: IssueKind;
  weight: number;
  ing?: IngId;
  mod?: ModifierId;
}

export interface OrderSpec {
  target: Recipe;
  modifiers: ModifierId[];
  shortages: IngId[];
  /** 満足度への影響倍率（監査官は 2） */
  weight: number;
  /** 特別注文（創作料理）の判定 */
  special?: (made: Formula, burnt: boolean) => { score: number; notes: string[] };
}

export interface Evaluation {
  score: number;
  stars: number;
  target: Recipe;
  ideal: Formula;
  made: Formula;
  burnt: boolean;
  identity: Recipe | null;
  identityScore: number;
  correctDish: boolean;
  pen: Penalties;
  modResults: { id: ModifierId; ok: boolean }[];
  allergyHit: boolean;
  substituted: boolean;
  patienceBonus: number;
  issues: Issue[];
  specialNotes: string[];
  timeout: boolean;
}

export function idealFor(spec: OrderSpec): { base: Formula; ideal: Formula } {
  const base = applyShortages(spec.target, spec.shortages);
  let ideal: Formula = { ...base, ing: { ...base.ing } };
  for (const m of spec.modifiers) ideal = applyModifierToIdeal(m, ideal, spec.target);
  return { base, ideal };
}

export function starsFor(score: number): number {
  if (score >= 90) return 5;
  if (score >= 75) return 4;
  if (score >= 55) return 3;
  if (score >= 35) return 2;
  return 1;
}

export function evaluate(build: Build, spec: OrderSpec, patienceRatio: number, pool: Recipe[] = RECIPES): Evaluation {
  const made = buildToFormula(build);
  const burnt = isBurnt(build);
  const { base, ideal } = idealFor(spec);
  const pen = penalties(made, ideal, burnt);
  const id = identify(made, pool);
  // 市民の目にも、それが頼んだ料理に見えるか（欠品の代替や要望を反映した形と比べる）。
  // 別の料理のほうがはっきり近ければ「別物」と受け取られる。
  const simIdeal = similarity(made, ideal);
  let correctDish: boolean;
  if (id.recipe && id.recipe.id !== spec.target.id) correctDish = id.score <= simIdeal + 5 && simIdeal >= 60;
  else correctDish = !!id.recipe && simIdeal >= 55;

  let score = 100 - sumPenalties(pen);
  const issues: Issue[] = [];
  let specialNotes: string[] = [];

  if (spec.special) {
    const r = spec.special(made, burnt);
    score = r.score;
    specialNotes = r.notes;
  } else if (!correctDish) {
    score -= 10;
    issues.push({ kind: id.recipe ? 'wrongDish' : 'unknown', weight: 90 });
  }

  const modResults = spec.modifiers.map((m) => ({ id: m, ok: MODIFIERS[m].check(made, ideal, base) }));
  let allergyHit = false;
  for (const r of modResults) {
    if (ALLERGY_MODS.includes(r.id)) {
      if (!r.ok) {
        allergyHit = true;
        score -= 50;
        issues.push({ kind: 'allergy', weight: 200, mod: r.id });
      } else score += 2;
    } else if (r.ok) score += 3;
    else {
      score -= 15;
      issues.push({ kind: 'mod', weight: 40, mod: r.id });
    }
  }

  const substituted = usesShortage(spec.target, spec.shortages);
  if (substituted) score -= 3;

  let patienceBonus = 0;
  if (patienceRatio > 0.6) patienceBonus = 4;
  else if (patienceRatio < 0.3) patienceBonus = -6;
  score += patienceBonus;
  if (patienceBonus < 0) issues.push({ kind: 'slow', weight: 6 });

  if (!spec.special) {
    if (burnt) issues.push({ kind: 'burnt', weight: 80 });
    const dh = heatIndex(made.heat) - heatIndex(ideal.heat);
    if (!burnt && dh !== 0) issues.push({ kind: dh < 0 ? 'heatLow' : 'heatHigh', weight: pen.heat + 5 });
    if (pen.form > 0) issues.push({ kind: 'form', weight: pen.form + 4 });
    if (pen.ing > 0) {
      // いちばん足りない素材・いちばん余計な素材
      let missing: IngId | null = null;
      let extra: IngId | null = null;
      let md = 0;
      let ed = 0;
      for (const iid of ING_IDS) {
        const d = (ideal.ing[iid] ?? 0) - (made.ing[iid] ?? 0);
        if (d > md) {
          md = d;
          missing = iid;
        }
        if (-d > ed) {
          ed = -d;
          extra = iid;
        }
      }
      if (missing && md >= ed) issues.push({ kind: 'ingMissing', weight: pen.ing, ing: missing });
      else if (extra) issues.push({ kind: 'ingExtra', weight: pen.ing, ing: extra });
    }
    if (pen.topping > 0) {
      const kind = !made.topping ? 'toppingMissing' : !ideal.topping ? 'toppingExtra' : 'toppingWrong';
      issues.push({ kind, weight: pen.topping, ing: made.topping ?? ideal.topping ?? undefined });
    }
    if (pen.vessel > 0) issues.push({ kind: 'vessel', weight: pen.vessel });
  }

  score = Math.round(Math.max(0, Math.min(100, score)));
  issues.sort((a, b) => b.weight - a.weight);
  // 頼んだ料理として受け取られたなら、見え方もその料理にそろえる（同点のときの食い違いを防ぐ）
  const identity = correctDish && !spec.special ? spec.target : id.recipe;
  const identityScore = correctDish && !spec.special ? simIdeal : id.score;

  return {
    score,
    stars: starsFor(score),
    target: spec.target,
    ideal,
    made,
    burnt,
    identity,
    identityScore,
    correctDish,
    pen,
    modResults,
    allergyHit,
    substituted,
    patienceBonus,
    issues,
    specialNotes,
    timeout: false,
  };
}

export function timeoutEvaluation(spec: OrderSpec): Evaluation {
  const { ideal } = idealFor(spec);
  return {
    score: 0,
    stars: 1,
    target: spec.target,
    ideal,
    made: ideal,
    burnt: false,
    identity: null,
    identityScore: 0,
    correctDish: false,
    pen: { ing: 0, form: 0, heat: 0, burnt: 0, topping: 0, vessel: 0 },
    modResults: [],
    allergyHit: false,
    substituted: false,
    patienceBonus: 0,
    issues: [{ kind: 'timeout', weight: 999 }],
    specialNotes: [],
    timeout: true,
  };
}

/** 星の数から市民満足度の増減 */
export function satisfactionDelta(stars: number, weight: number): number {
  const base = [0, -14, -7, 0, 3, 6][stars] ?? 0;
  return base * weight;
}
