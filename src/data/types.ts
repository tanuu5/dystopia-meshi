// ゲーム全体で使うデータ型（Node の型除去でも動くよう、enum などは使わない）

export type IngId =
  | 'grey'
  | 'brown'
  | 'white'
  | 'green'
  | 'yellow'
  | 'pink'
  | 'spice'
  | 'clear'
  | 'milk'
  | 'black'
  | 'red'
  | 'amber';

/** 素材の性状。見た目（タンクの中身・トッピングの描き方）に使う */
export type IngKind = 'solid' | 'paste' | 'grain' | 'gel' | 'crystal' | 'powder' | 'liquid';

export type FormId = 'liquid' | 'fizz' | 'grain' | 'noodle' | 'disc' | 'ball' | 'cube' | 'stick' | 'wedge' | 'dome';
export type HeatId = 'frozen' | 'chilled' | 'room' | 'warm' | 'hot';
export type VesselId = 'plate' | 'deep' | 'chawan' | 'bowl' | 'cup' | 'glass';
export type CategoryId = 'staple' | 'main' | 'soup' | 'sweet' | 'drink' | 'ration';

export type ColorTag = '茶' | '白' | '黄' | '赤' | '緑' | '黒' | '桃' | '橙' | '灰' | '透明' | '金';
export type TasteTag = '甘' | '辛' | '塩' | '酸' | '苦' | '旨' | '淡';

export type QuestionId = 'temp' | 'form' | 'taste' | 'color' | 'cat' | 'memory';

export interface Ingredient {
  id: IngId;
  code: string;
  /** 通称（謎の物体としての見た目の名前） */
  name: string;
  /** 管理局による正式名称 */
  official: string;
  kind: IngKind;
  color: string;
  /** どんな料理の「役」をこなすか（素材図鑑に表示） */
  roles: string;
  desc: string;
}

export type IngCounts = Partial<Record<IngId, number>>;

export interface Formula {
  ing: IngCounts;
  form: FormId;
  heat: HeatId;
  topping: IngId | null;
  vessel: VesselId;
}

export interface OrderTexts {
  /** はっきり料理名で頼む */
  lv1: string[];
  /** 特徴を並べて頼む */
  lv2: string[];
  /** 思い出や比喩で頼む（読み解きが必要） */
  lv3: string[];
}

export interface Recipe extends Formula {
  id: string;
  /** 「ハンバーグ風」 */
  name: string;
  /** 元の料理名「ハンバーグ」 */
  base: string;
  /** 検索用のひらがな */
  kana: string;
  cat: CategoryId;
  colors: ColorTag[];
  tastes: TasteTag[];
  /** 管理局のレシピ注記 */
  note: string;
  /** 旧時代アーカイブ（元の料理の記録） */
  archive: string;
  /** この日からレシピ DB に載る（0 はDBに載らない特別レシピ） */
  day: number;
  /** 大盛り・少なめのときに増減する素材 */
  primary: IngId;
  orders: OrderTexts;
  /** 「どんな思い出？」と聞かれたときの答え（市民の口調で） */
  memory: string[];
  /** 質問への個別の答え（なければ属性から自動生成） */
  answers?: Partial<Record<QuestionId, string[]>>;
}

/** 調理中の状態（プレイヤーが作っているもの） */
export interface Build {
  ing: Record<IngId, number>;
  form: FormId | null;
  /** 連続値の温度（-1 = 凍結 … 1 = 高温、1 を超えると焦げ） */
  temp: number;
  heated: boolean;
  topping: IngId | null;
  toppingSet: boolean;
  vessel: VesselId | null;
}

export type ModifierId =
  | 'spicy'
  | 'nospicy'
  | 'sweet'
  | 'lesssweet'
  | 'nekojita'
  | 'atsuatsu'
  | 'oomori'
  | 'sukuname'
  | 'nosauce'
  | 'yasai'
  | 'allergy_yellow'
  | 'allergy_milk'
  | 'allergy_brown';

export type Personality = 'polite' | 'casual' | 'gruff' | 'child' | 'elder' | 'official' | 'shady' | 'critic' | 'tired';
