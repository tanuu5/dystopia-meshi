import type { Ingredient, IngId } from './types.ts';

// 配給食堂で使える素材。どれも「何でできているか」は公開されていない。
export const INGREDIENTS: Ingredient[] = [
  {
    id: 'grey',
    code: 'NC-01',
    name: '灰色キューブ',
    official: '標準栄養キューブ',
    kind: 'solid',
    color: '#9aa1a8',
    roles: '豆腐・魚・鶏・その他ほぼすべて',
    desc: '国民食の基礎。原材料は非公開。味はおおむね「無」。何にでもなれる素直な子。',
  },
  {
    id: 'brown',
    code: 'BP-07',
    name: '褐色ペースト',
    official: 'タンパク質ペースト（褐）',
    kind: 'paste',
    color: '#7a4428',
    roles: '肉・ひき肉・味噌・ルー',
    desc: '「肉っぽさ」担当。昆虫由来とも藻類由来とも言われるが、答えを知る者はいない。',
  },
  {
    id: 'white',
    code: 'WG-02',
    name: '白色粒子',
    official: '炭水化物顆粒',
    kind: 'grain',
    color: '#efe8d6',
    roles: '米・小麦・麺・パン・芋',
    desc: '米、小麦、芋の「記憶」を持つ粒。成形しだいで麺にもパンにもなる。',
  },
  {
    id: 'green',
    code: 'VG-03',
    name: '緑色ゲル',
    official: '植物性ゲル',
    kind: 'gel',
    color: '#4fd068',
    roles: '野菜・海藻・抹茶・メロン',
    desc: '野菜っぽさ担当。ほのかに青臭い。子どもの残食率がもっとも高い素材。',
  },
  {
    id: 'yellow',
    code: 'YE-05',
    name: '黄色乳剤',
    official: '脂質乳剤',
    kind: 'paste',
    color: '#f4c030',
    roles: '卵・油・バター・チーズ・衣',
    desc: '卵、バター、チーズ、揚げ油の代役を一手に担う働き者。アレルギー申告の多い素材。',
  },
  {
    id: 'pink',
    code: 'SW-08',
    name: '甘味結晶',
    official: '合成甘味結晶',
    kind: 'crystal',
    color: '#ff86c4',
    roles: '砂糖・みりん・果物の甘さ',
    desc: '甘い。とても甘い。支給量は厳格に管理されている。',
  },
  {
    id: 'spice',
    code: 'HT-13',
    name: '辛味因子',
    official: '刺激性香辛粉末',
    kind: 'powder',
    color: '#ff5a1c',
    roles: '唐辛子・カレー粉・からし',
    desc: '刺激物規制の対象。一部の市民に熱狂的な支持者がいる。',
  },
  {
    id: 'clear',
    code: 'H2-00',
    name: '透明液',
    official: '基礎溶媒',
    kind: 'liquid',
    color: '#a9dcff',
    roles: '水・だしの素・氷・ゼラチン',
    desc: '水。たぶん水。凍らせると氷になり、固めるとゼリーになる。',
  },
  {
    id: 'milk',
    code: 'MK-04',
    name: '白濁液',
    official: '乳化液',
    kind: 'liquid',
    color: '#f5f2ea',
    roles: '牛乳・クリーム・白身・マヨネーズ',
    desc: '牛を見たことのない乳。泡立てるとクリームにも泡にもなる。',
  },
  {
    id: 'black',
    code: 'BK-09',
    name: '黒色液',
    official: '焙煎抽出液',
    kind: 'liquid',
    color: '#2b1a12',
    roles: '醤油・ソース・コーヒー・コーラ・カラメル',
    desc: '苦味と旨味と甘い香り。醤油にもコーヒーにもなる、この国でいちばん忙しい液体。',
  },
  {
    id: 'red',
    code: 'RD-06',
    name: '赤色液',
    official: '酸性着色液',
    kind: 'liquid',
    color: '#d92b2b',
    roles: 'トマト・ケチャップ・いちご・梅',
    desc: 'トマト、いちご、梅干しの記憶。酸っぱい。',
  },
  {
    id: 'amber',
    code: 'GD-11',
    name: '黄金液',
    official: '旨味抽出液',
    kind: 'liquid',
    color: '#e0a13a',
    roles: 'スープ・だし・はちみつ・麦の液',
    desc: '旨味の塊。温めればスープ、冷やして泡立てれば、大人たちがなぜか喜ぶ。',
  },
];

export const ING: Record<IngId, Ingredient> = Object.fromEntries(INGREDIENTS.map((i) => [i.id, i])) as Record<
  IngId,
  Ingredient
>;

export const ING_IDS: IngId[] = INGREDIENTS.map((i) => i.id);

/** 液体として注げるもの（トッピングで「汁」「ソース」になる） */
export function isLiquid(id: IngId): boolean {
  return ING[id].kind === 'liquid';
}

/** 欠品時の代替（1 単位あたり）。レシピ DB にも表示する */
export const SUBSTITUTES: Partial<Record<IngId, { ing: Partial<Record<IngId, number>>; topping: IngId | null; text: string }>> = {
  brown: { ing: { grey: 1, black: 1 }, topping: 'black', text: '灰色キューブ＋黒色液で代替（トッピング時は黒色液）' },
  yellow: { ing: { milk: 1 }, topping: 'milk', text: '白濁液で代替' },
  milk: { ing: { clear: 1 }, topping: null, text: '透明液で代替（トッピング時は省略）' },
  red: { ing: { pink: 1 }, topping: 'pink', text: '甘味結晶で代替（色だけでも赤く、という意向）' },
};
