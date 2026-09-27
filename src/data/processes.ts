import type { CategoryId, FormId, HeatId, VesselId } from './types.ts';

export interface FormDef {
  id: FormId;
  name: string;
  /** 市民が形を説明するときの言い方 */
  talk: string[];
  hint: string;
}

export const FORMS: FormDef[] = [
  { id: 'liquid', name: '液状', talk: ['形はない…液体、かな', 'すするやつ。飲むのに近い'], hint: '成形しない。スープ・飲み物に' },
  { id: 'fizz', name: '発泡', talk: ['シュワシュワしてる', '泡がぷちぷち上がってくる'], hint: '液体に気泡を圧入する' },
  { id: 'grain', name: '粒', talk: ['粒々してる', 'パラパラした、細かい粒の集まり'], hint: 'ごはん・刻み・かき氷に' },
  { id: 'noodle', name: '麺', talk: ['細長くて、ずるずるっとすするやつ', '長い。とにかく長い'], hint: '押し出して麺状にする' },
  { id: 'disc', name: '円盤', talk: ['丸くて、平べったい', '手のひらくらいの、平たい丸'], hint: 'ハンバーグ・焼き物に' },
  { id: 'ball', name: '球', talk: ['コロコロした丸いのが、いくつか', '一口サイズの玉'], hint: '一口大の玉を 3 つ' },
  { id: 'cube', name: '角', talk: ['四角い', 'きっちりした四角いかたまり'], hint: '豆腐・卵焼き・配給キューブに' },
  { id: 'stick', name: '棒', talk: ['細長い棒みたいな', '箸でつまめる、長細いの'], hint: '魚・フライ・ソーセージに' },
  { id: 'wedge', name: '三角', talk: ['三角のやつ', 'とがってる。三角'], hint: 'おにぎり・ケーキに' },
  { id: 'dome', name: 'ドーム', talk: ['ぷっくり山みたいな', 'ころんとした、お山の形'], hint: 'プリン・オムライスに' },
];

export interface HeatDef {
  id: HeatId;
  name: string;
  /** 温度ゲージ上の範囲（-1 … 1） */
  min: number;
  max: number;
  talk: string[];
}

// 温度ゲージは -1（凍結）から 1（高温）まで。1 を超えると焦げる
export const HEATS: HeatDef[] = [
  { id: 'frozen', name: '凍結', min: -1.0, max: -0.6, talk: ['凍ってるくらい冷たいの', 'キーンとくるほど冷たい'] },
  { id: 'chilled', name: '冷却', min: -0.6, max: -0.2, talk: ['冷たいやつ', 'ひんやりしてるの'] },
  { id: 'room', name: '常温', min: -0.2, max: 0.2, talk: ['冷たくも熱くもない…ふつう？', '温めなくていいやつ'] },
  { id: 'warm', name: '加温', min: 0.2, max: 0.6, talk: ['あったかいの', 'ほっとする温かさ'] },
  { id: 'hot', name: '高温', min: 0.6, max: 1.0, talk: ['熱々のやつ！', '焼きたて…いや、ジュウジュウいってるやつ'] },
];

export const BURN_AT = 1.0;
export const TEMP_MIN = -1.0;
export const TEMP_MAX = 1.25;

export function heatIndex(id: HeatId): number {
  return HEATS.findIndex((h) => h.id === id);
}

export function heatFromTemp(t: number): HeatId {
  if (t < -0.6) return 'frozen';
  if (t < -0.2) return 'chilled';
  if (t <= 0.2) return 'room';
  if (t <= 0.6) return 'warm';
  return 'hot';
}

export interface VesselDef {
  id: VesselId;
  name: string;
  hint: string;
}

export const VESSELS: VesselDef[] = [
  { id: 'plate', name: '平皿', hint: '主菜・焼き物・甘味' },
  { id: 'deep', name: '深皿', hint: 'カレー・パスタ・シチュー' },
  { id: 'chawan', name: '茶碗', hint: 'ごはん・味噌汁・おかゆ' },
  { id: 'bowl', name: '丼', hint: 'ラーメン・うどん・丼もの' },
  { id: 'cup', name: 'カップ', hint: '温かい飲み物・スープ' },
  { id: 'glass', name: 'グラス', hint: '冷たい飲み物・デザート' },
];

export interface CategoryDef {
  id: CategoryId;
  name: string;
  talk: string;
}

export const CATEGORIES: CategoryDef[] = [
  { id: 'staple', name: '主食', talk: 'ごはん…というか、お腹にたまるやつ' },
  { id: 'main', name: '主菜', talk: 'おかず。メインのやつ' },
  { id: 'soup', name: '汁物', talk: '汁物。お椀で飲むような' },
  { id: 'sweet', name: '甘味', talk: 'おやつ。甘いもの' },
  { id: 'drink', name: '飲料', talk: '飲み物' },
  { id: 'ration', name: '規定食', talk: '規定の食事だ' },
];

export const FORM: Record<FormId, FormDef> = Object.fromEntries(FORMS.map((f) => [f.id, f])) as Record<FormId, FormDef>;
export const HEAT: Record<HeatId, HeatDef> = Object.fromEntries(HEATS.map((h) => [h.id, h])) as Record<HeatId, HeatDef>;
export const VESSEL: Record<VesselId, VesselDef> = Object.fromEntries(VESSELS.map((v) => [v.id, v])) as Record<
  VesselId,
  VesselDef
>;
export const CATEGORY: Record<CategoryId, CategoryDef> = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<
  CategoryId,
  CategoryDef
>;

/** 似ている形（完全一致でなくても半分くらいは許される組） */
export const FORM_NEAR: [FormId, FormId][] = [
  ['liquid', 'fizz'],
  ['ball', 'dome'],
  ['disc', 'cube'],
  ['cube', 'wedge'],
];

export const VESSEL_NEAR: [VesselId, VesselId][] = [
  ['plate', 'deep'],
  ['deep', 'bowl'],
  ['chawan', 'bowl'],
  ['cup', 'glass'],
  ['chawan', 'cup'],
];
