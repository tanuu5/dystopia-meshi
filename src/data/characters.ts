import type { Personality } from './types.ts';

export type HairStyle = 'short' | 'bob' | 'long' | 'pigtails' | 'bun' | 'bald' | 'buzz' | 'messy' | 'ponytail' | 'side';
export type HatStyle = 'none' | 'cap' | 'peaked' | 'hood' | 'beanie' | 'kerchief';

export interface Look {
  body: 'child' | 'adult' | 'elder';
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  hat: HatStyle;
  hatColor: string;
  outfit: string;
  accent: string;
  glasses: 'none' | 'round' | 'square';
  glassesColor: string;
  mask: boolean;
  eyes: 'normal' | 'big' | 'sleepy' | 'narrow';
  brows: 'normal' | 'thick' | 'thin';
  cheek: boolean;
  eyebags: boolean;
  beard: boolean;
}

export interface Citizen {
  key: string;
  name: string;
  number: string;
  age: number;
  job: string;
  personality: Personality;
  /** しゃべるときの声の高さ（Hz） */
  voice: number;
  patienceMul: number;
  look: Look;
  /** ID カードの備考 */
  note?: string;
  story?: StoryId;
}

export type StoryId = 'genzo' | 'mina' | 'kurosawa' | 'sato' | 'hirano' | 'nezumi';

const L = (p: Partial<Look>): Look => ({
  body: 'adult',
  skin: '#e9c3a2',
  hair: '#2a2420',
  hairStyle: 'short',
  hat: 'none',
  hatColor: '#3a3f46',
  outfit: '#59616b',
  accent: '#c9a23a',
  glasses: 'none',
  glassesColor: '#222',
  mask: false,
  eyes: 'normal',
  brows: 'normal',
  cheek: false,
  eyebags: false,
  beard: false,
  ...p,
});

export const STORY_CAST: Record<StoryId, Citizen> = {
  genzo: {
    key: 'genzo',
    name: 'イワサキ・ゲンゾウ',
    number: '01-0078',
    age: 78,
    job: '年金受給者（元・定食屋店主）',
    personality: 'elder',
    voice: 112,
    patienceMul: 1.3,
    story: 'genzo',
    note: '旧時代の飲食業従事歴あり',
    look: L({
      body: 'elder',
      skin: '#e3b894',
      hair: '#e8e6e0',
      hairStyle: 'bald',
      glasses: 'round',
      glassesColor: '#5a4a3a',
      outfit: '#8a7560',
      accent: '#5b4b3c',
      brows: 'thick',
      beard: false,
    }),
  },
  mina: {
    key: 'mina',
    name: 'ミナ',
    number: '09-2231',
    age: 8,
    job: '第4配給学校 2年生',
    personality: 'child',
    voice: 360,
    patienceMul: 1.0,
    story: 'mina',
    note: '保護者同伴義務：免除（本人の強い希望による）',
    look: L({
      body: 'child',
      skin: '#f1cdb0',
      hair: '#3a2a22',
      hairStyle: 'pigtails',
      outfit: '#e2b43c',
      accent: '#d8433b',
      eyes: 'big',
      cheek: true,
    }),
  },
  kurosawa: {
    key: 'kurosawa',
    name: 'クロサワ監査官',
    number: 'CFA-0012',
    age: 45,
    job: '中央食糧管理局 監査部',
    personality: 'official',
    voice: 138,
    patienceMul: 0.9,
    story: 'kurosawa',
    note: '監査権限：第1級',
    look: L({
      skin: '#dcb391',
      hair: '#1a1a1c',
      hairStyle: 'short',
      hat: 'peaked',
      hatColor: '#1b1e24',
      outfit: '#23272e',
      accent: '#c9a23a',
      glasses: 'square',
      glassesColor: '#111',
      eyes: 'narrow',
      brows: 'thick',
    }),
  },
  sato: {
    key: 'sato',
    name: 'サトウ・ケンジ',
    number: '03-5512',
    age: 34,
    job: '第3工場 夜勤作業員',
    personality: 'tired',
    voice: 150,
    patienceMul: 1.0,
    story: 'sato',
    note: '連続夜勤 212 日',
    look: L({
      skin: '#e2b996',
      hair: '#231d1a',
      hairStyle: 'messy',
      hat: 'cap',
      hatColor: '#c86a2a',
      outfit: '#7c6a52',
      accent: '#c86a2a',
      eyes: 'sleepy',
      eyebags: true,
    }),
  },
  hirano: {
    key: 'hirano',
    name: 'ヒラノ・サチコ',
    number: '02-3061',
    age: 61,
    job: '無職（元・料理研究家）',
    personality: 'critic',
    voice: 215,
    patienceMul: 1.0,
    story: 'hirano',
    note: '旧時代の料理書 3 冊を無許可所持（黙認）',
    look: L({
      skin: '#efcfb6',
      hair: '#9a9aa0',
      hairStyle: 'bob',
      glasses: 'round',
      glassesColor: '#b32a3a',
      outfit: '#5a3d6a',
      accent: '#d9b56a',
      brows: 'thin',
    }),
  },
  nezumi: {
    key: 'nezumi',
    name: '「ネズミ」',
    number: '██-████',
    age: 0,
    job: '登録情報：閲覧制限',
    personality: 'shady',
    voice: 128,
    patienceMul: 0.9,
    story: 'nezumi',
    note: '本人照会：エラー',
    look: L({
      skin: '#d6ae8c',
      hair: '#2b2b2b',
      hairStyle: 'short',
      hat: 'hood',
      hatColor: '#2f3a33',
      outfit: '#2f3a33',
      accent: '#6b8f5a',
      mask: true,
      eyes: 'narrow',
    }),
  },
};

// ───────────── ランダム市民 ─────────────

const SURNAMES = [
  'サトウ', 'スズキ', 'タカハシ', 'タナカ', 'ワタナベ', 'イトウ', 'ヤマモト', 'ナカムラ', 'コバヤシ', 'カトウ',
  'ヨシダ', 'ヤマダ', 'ササキ', 'ヤマグチ', 'マツモト', 'イノウエ', 'キムラ', 'ハヤシ', 'シミズ', 'ヤマザキ',
  'モリ', 'アベ', 'イケダ', 'ハシモト', 'イシカワ', 'ナカジマ', 'マエダ', 'フジタ', 'オガワ', 'ゴトウ',
  'オカダ', 'ハセガワ', 'ムラカミ', 'コンドウ', 'イシイ', 'サイトウ', 'エンドウ', 'アオキ', 'ノムラ', 'ホンダ',
];
const GIVEN_ADULT = [
  'ユウジ', 'ケンタ', 'ショウ', 'ダイキ', 'ヒロシ', 'タクヤ', 'マコト', 'リョウ', 'カズキ', 'ツヨシ',
  'ユウコ', 'アヤ', 'ミサキ', 'ハルカ', 'ナオミ', 'メグミ', 'エリ', 'サヤカ', 'チヒロ', 'ユイ',
  'アキラ', 'ヒカル', 'マサミ', 'カオル', 'ナギサ', 'ツバサ', 'シノブ', 'ジュン', 'レン', 'ミオ',
];
const GIVEN_CHILD = ['ソウタ', 'ハルト', 'ユナ', 'ヒナ', 'コハル', 'リク', 'メイ', 'ユウト', 'サクラ', 'イオリ'];
const GIVEN_ELDER = ['トメ', 'ゲンジ', 'シゲル', 'ハル', 'キヨシ', 'フミ', 'マサオ', 'ヨシエ', 'タケシ', 'セツコ'];

const JOBS_ADULT = [
  '第3工場 組立工', '配給センター 仕分け係', '監視カメラ 保守員', '栄養研究所 助手', '公共放送 原稿係',
  '地下鉄 清掃員', '都市農場 藻類管理', 'データ入力係', '夜間警備員', '中央病院 看護師',
  '記憶アーカイブ 司書', '配給食堂 清掃係', '水質管理局 検査員', '集合住宅 管理人', '第9区 郵便配達員',
  '幸福度調査 面接員', '工業団地 溶接工', '交通管制センター 監視員', '雨水処理場 技術員', '公共体操 指導員',
];
const JOBS_ELDER = ['年金受給者', '年金受給者（元・教員）', '年金受給者（元・漁師）', '地域見守り員', '公園清掃ボランティア'];
const JOBS_CHILD = ['第2配給学校 1年生', '第4配給学校 3年生', '第7配給学校 5年生', '第1配給学校 4年生'];

const SKINS = ['#f1cdb0', '#e9c3a2', '#e0b48f', '#d6a57e', '#c99470', '#b8805c', '#9e6a48', '#f3d6c0'];
const HAIRS = ['#1d1916', '#2a2420', '#3a2c22', '#4a3526', '#5a4636', '#6b5a48', '#8a6b4a', '#2c2c34', '#3b3440'];
const OUTFITS = ['#59616b', '#4c5a66', '#5f6a55', '#6b6a5a', '#4a4f5a', '#5a6470', '#6a5f55', '#3f4a52', '#566158', '#6d7178'];
const ACCENTS = ['#c9a23a', '#b8443a', '#3a7ab8', '#4a9a6a', '#c86a2a', '#8a5ab8'];
const ADULT_HAIR: HairStyle[] = ['short', 'bob', 'long', 'bun', 'buzz', 'messy', 'ponytail', 'side', 'short', 'bob'];
const CHILD_HAIR: HairStyle[] = ['pigtails', 'bob', 'short', 'messy', 'ponytail'];
const ELDER_HAIR: HairStyle[] = ['bald', 'short', 'bun', 'buzz', 'bob'];
const HATS: HatStyle[] = ['none', 'none', 'none', 'none', 'cap', 'beanie', 'kerchief'];

export type Rng = () => number;
const pick = <T>(rng: Rng, a: T[]): T => a[Math.floor(rng() * a.length) % a.length];

export function randomCitizen(rng: Rng, index: number): Citizen {
  const r = rng();
  const body: Look['body'] = r < 0.14 ? 'child' : r < 0.3 ? 'elder' : 'adult';
  let personality: Personality;
  if (body === 'child') personality = 'child';
  else if (body === 'elder') personality = rng() < 0.7 ? 'elder' : 'polite';
  else {
    const q = rng();
    personality = q < 0.28 ? 'polite' : q < 0.56 ? 'casual' : q < 0.74 ? 'tired' : q < 0.9 ? 'gruff' : 'critic';
  }
  const given = body === 'child' ? GIVEN_CHILD : body === 'elder' ? GIVEN_ELDER : GIVEN_ADULT;
  const name = body === 'child' ? pick(rng, given) : `${pick(rng, SURNAMES)}・${pick(rng, given)}`;
  const age = body === 'child' ? 6 + Math.floor(rng() * 6) : body === 'elder' ? 68 + Math.floor(rng() * 20) : 19 + Math.floor(rng() * 42);
  const job = body === 'child' ? pick(rng, JOBS_CHILD) : body === 'elder' ? pick(rng, JOBS_ELDER) : pick(rng, JOBS_ADULT);
  const voiceBase = body === 'child' ? 300 : body === 'elder' ? 125 : 140;
  const voice = voiceBase + rng() * (body === 'child' ? 60 : 100);
  const patienceMul = { polite: 1.1, casual: 1.0, gruff: 0.85, tired: 0.9, child: 0.95, elder: 1.2, critic: 1.0, official: 0.9, shady: 0.9 }[personality];
  const hairStyle = body === 'child' ? pick(rng, CHILD_HAIR) : body === 'elder' ? pick(rng, ELDER_HAIR) : pick(rng, ADULT_HAIR);
  const hair = body === 'elder' ? pick(rng, ['#d8d6d0', '#b8b6b0', '#9a9894', '#e8e6e0']) : pick(rng, HAIRS);
  const look = L({
    body,
    skin: pick(rng, SKINS),
    hair,
    hairStyle,
    hat: body === 'child' ? 'none' : pick(rng, HATS),
    hatColor: pick(rng, OUTFITS),
    outfit: pick(rng, OUTFITS),
    accent: pick(rng, ACCENTS),
    glasses: rng() < (body === 'elder' ? 0.6 : 0.22) ? pick(rng, ['round', 'square'] as const) : 'none',
    glassesColor: pick(rng, ['#222', '#5a4a3a', '#7a7a80', '#2a3a5a']),
    mask: body === 'adult' && rng() < 0.08,
    eyes: personality === 'tired' ? 'sleepy' : body === 'child' ? 'big' : pick(rng, ['normal', 'normal', 'narrow', 'big'] as const),
    brows: pick(rng, ['normal', 'thick', 'thin'] as const),
    cheek: body === 'child' || rng() < 0.2,
    eyebags: personality === 'tired' || (body === 'elder' && rng() < 0.4),
    beard: body !== 'child' && rng() < 0.1,
  });
  const num = `${String(1 + Math.floor(rng() * 12)).padStart(2, '0')}-${String(Math.floor(rng() * 10000)).padStart(4, '0')}`;
  return { key: `c${index}`, name, number: num, age, job, personality, voice, patienceMul, look };
}

// ───────────── 口調 ─────────────

export const GREETINGS: Record<Personality, string[]> = {
  polite: ['こんにちは。', 'お願いします。', '失礼します。'],
  casual: ['やあ。', 'どうも〜。', 'おつかれさま。'],
  gruff: ['……おい。', '早くしてくれ。', '……。'],
  tired: ['はぁ……。', '……どうも。', 'おなかすいた……。'],
  child: ['こんにちは！', 'ねえねえ！', 'あのね！'],
  elder: ['やあ、どうも。', 'こんにちは。今日も世話になるよ。', 'よっこらしょ…。'],
  official: ['中央食糧管理局だ。', '監査を行う。'],
  shady: ['……よう。', '静かに頼む。'],
  critic: ['あら、AI の料理？', 'お手並み拝見ね。'],
};

/** 質問への答えを口調で包む。{a} が答えの本体 */
export const ANSWER_WRAP: Record<Personality, string[]> = {
  polite: ['{a}…だと思います。', 'えっと、{a}です。'],
  casual: ['{a}かな。', 'んー、{a}！'],
  gruff: ['{a}だ。', '……{a}。'],
  tired: ['……{a}…たぶん。', '{a}…だったかな…'],
  child: ['えっとね、{a}！', '{a}なの！'],
  elder: ['そうじゃなあ…{a}。', '{a}、じゃったかな。'],
  official: ['{a}。以上だ。', '回答する。{a}。'],
  shady: ['{a}…ってとこだな。', '……{a}。これ以上は言えない。'],
  critic: ['{a}よ。そのくらい分かるでしょう？', '{a}。基本中の基本ね。'],
};

export const WAIT_LINES: Record<Personality, string[]> = {
  polite: ['まだかな…', 'ゆっくりでいいですよ。…でも、お腹すいたな。'],
  casual: ['まだ〜？', 'ふんふふーん♪'],
  gruff: ['遅い。', 'まだか。'],
  tired: ['……ねむい。', 'zzz…はっ。'],
  child: ['まだー？', 'おなかすいたー！'],
  elder: ['ゆっくりでええよ。', 'のんびり待つかのう。'],
  official: ['時間は記録されている。', '遅延は減点対象だ。'],
  shady: ['……長居はしたくないんだが。', '急いでくれ。'],
  critic: ['手際も腕のうちよ。', 'あら、まだかしら。'],
};
