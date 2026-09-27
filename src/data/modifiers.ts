import type { Formula, IngId, ModifierId, Recipe } from './types.ts';
import { heatIndex, HEATS } from './processes.ts';

// 市民の「要望」。レシピに上乗せされる条件。
export interface ModifierDef {
  id: ModifierId;
  /** 指示書の要望メモに出す短い説明 */
  label: string;
  /** どう対応すればいいか（要望メモ用） */
  howto: string;
  /** はっきり言うとき（{表示:mod=id} でキーワード化） */
  say: string[];
  /** 遠回しに言うとき（キーワード化しない） */
  hint: string[];
  /** アレルギーのように ID カードにだけ書かれていることがある */
  card?: string;
  applies(r: Recipe): boolean;
  apply(f: Formula): Formula;
  check(made: Formula, ideal: Formula, base: Formula): boolean;
  good: string[];
  bad: string[];
}

function count(f: Formula, id: IngId): number {
  return (f.ing[id] ?? 0) + (f.topping === id ? 1 : 0);
}
function total(f: Formula): number {
  return Object.values(f.ing).reduce((a, b) => a + (b ?? 0), 0);
}
function withIng(f: Formula, id: IngId, delta: number): Formula {
  const ing = { ...f.ing };
  const v = Math.max(0, (ing[id] ?? 0) + delta);
  if (v === 0) delete ing[id];
  else ing[id] = v;
  return { ...f, ing };
}
function hasIng(r: Formula, id: IngId): boolean {
  return (r.ing[id] ?? 0) > 0 || r.topping === id;
}
function shiftHeat(f: Formula, d: number): Formula {
  const i = Math.min(HEATS.length - 1, Math.max(0, heatIndex(f.heat) + d));
  return { ...f, heat: HEATS[i].id };
}
const savory = (r: Recipe) => r.cat === 'staple' || r.cat === 'main' || r.cat === 'soup';

export const MODIFIERS: Record<ModifierId, ModifierDef> = {
  spicy: {
    id: 'spicy',
    label: '辛め',
    howto: '辛味因子を +1',
    say: ['あ、{辛め:mod=spicy}でお願い。', '{辛いの:mod=spicy}が好きなんだ。ピリッとさせて。'],
    hint: ['最近、何を食べても味がしなくてさ。舌がしびれるくらいのが欲しい。', '汗をかきたい気分なんだよね。'],
    applies: (r) => savory(r) && (r.ing.spice ?? 0) === 0,
    apply: (f) => withIng(f, 'spice', 1),
    check: (m, _i, b) => count(m, 'spice') >= count(b, 'spice') + 1,
    good: ['おっ、ちゃんと辛い。わかってるね。', 'この辛さ！ 覚えててくれたんだ。'],
    bad: ['辛くしてって言ったのに…', 'ぜんぜん辛くない。言ったよね？'],
  },
  nospicy: {
    id: 'nospicy',
    label: '辛さ抜き',
    howto: '辛味因子を入れない',
    say: ['{辛いのはダメ:mod=nospicy}なんだ。抜いてくれる？', '{辛くしないで:mod=nospicy}ね。'],
    hint: ['胃の調子が悪くてさ。刺激物はちょっと…', '辛いのを食べると次の日つらいんだよね。'],
    applies: (r) => hasIng(r, 'spice'),
    apply: (f) => ({ ...withIng(f, 'spice', -99), topping: f.topping === 'spice' ? null : f.topping }),
    check: (m) => count(m, 'spice') === 0,
    good: ['辛くない。助かる…', 'ちゃんと抜いてくれたんだ。ありがとう。'],
    bad: ['うっ…辛い！ 抜いてって言ったのに！', 'ひー、からい…水、水…'],
  },
  sweet: {
    id: 'sweet',
    label: '甘め',
    howto: '甘味結晶を +1',
    say: ['{甘め:mod=sweet}にしてくれる？', '{甘いのが好き:mod=sweet}なの。うんと甘くして。'],
    hint: ['今日はとことん自分を甘やかしたい日なんだ。', '疲れたから、糖分がほしい…'],
    applies: (r) => r.cat === 'sweet' || r.cat === 'drink' || hasIng(r, 'pink'),
    apply: (f) => withIng(f, 'pink', 1),
    check: (m, _i, b) => count(m, 'pink') >= count(b, 'pink') + 1,
    good: ['あまーい！ これこれ。', 'ちゃんと甘くしてくれたんだ。'],
    bad: ['甘めって言ったのに、ふつうだ…', 'もうちょっと甘いのがよかったな。'],
  },
  lesssweet: {
    id: 'lesssweet',
    label: '甘さ控えめ',
    howto: '甘味結晶を -1',
    say: ['{甘さは控えめ:mod=lesssweet}で。', '{甘すぎるのは苦手:mod=lesssweet}で…少なめにして。'],
    hint: ['最近、血糖値を気にしてて…', '甘ったるいのは、どうもね。'],
    applies: (r) => (r.ing.pink ?? 0) >= 1,
    apply: (f) => withIng(f, 'pink', -1),
    check: (m, _i, b) => count(m, 'pink') <= count(b, 'pink') - 1,
    good: ['甘さ控えめ。ちょうどいい。', 'うん、この甘さなら食べられる。'],
    bad: ['あまっ…控えめって言ったのに。', '甘すぎる…'],
  },
  nekojita: {
    id: 'nekojita',
    label: '猫舌',
    howto: '温度を一段階下げる',
    say: ['{猫舌:mod=nekojita}なんで、熱すぎないようにしてもらえます？', '{あつあつは苦手:mod=nekojita}。ぬるめでね。'],
    hint: ['この前、熱いもので口の中をやけどしちゃって…まだヒリヒリするんだ。', 'ふーふーするの、面倒なんだよね。'],
    applies: (r) => r.heat === 'hot' || r.heat === 'warm',
    apply: (f) => shiftHeat(f, -1),
    check: (m, _i, b) => heatIndex(m.heat) <= heatIndex(b.heat) - 1,
    good: ['ちょうどいい温度。気が利くね。', 'これなら食べられる。ありがとう。'],
    bad: ['あつっ！ 猫舌だって言ったのに…', 'ふーっ、ふーっ…熱いよ…'],
  },
  atsuatsu: {
    id: 'atsuatsu',
    label: '熱々',
    howto: '温度を一段階上げる',
    say: ['{熱々:mod=atsuatsu}でね！', 'とにかく{熱いのがいい:mod=atsuatsu}。'],
    hint: ['外が寒くてさ。体の芯から温まりたいんだ。', '湯気が立ってないと、食べた気がしないんだよね。'],
    applies: (r) => r.heat === 'warm',
    apply: (f) => shiftHeat(f, 1),
    check: (m, _i, b) => heatIndex(m.heat) >= heatIndex(b.heat) + 1,
    good: ['熱々だ！ これだよ。', 'はふっ、はふっ…最高。'],
    bad: ['熱々って言ったのに、ぬるいな。', 'もっと熱いのがよかった。'],
  },
  oomori: {
    id: 'oomori',
    label: '大盛り',
    howto: '主材料を +1',
    say: ['{大盛り:mod=oomori}で！', '腹ぺこなんだ。{多めに:mod=oomori}頼む。'],
    hint: ['今日は十二時間働いたんだ。腹が減って倒れそうだよ。', '朝から何も食べてなくてさ。'],
    applies: (r) => (r.cat === 'staple' || r.cat === 'main') && total(r) <= 4,
    apply: (f) => f,
    check: (m, _i, b) => total(m) >= total(b) + 1,
    good: ['おお、たっぷり！ 助かる。', 'この量！ 生き返る。'],
    bad: ['大盛りって言ったのに、ふつうだ…', '足りない。ぜんぜん足りない。'],
  },
  sukuname: {
    id: 'sukuname',
    label: '少なめ',
    howto: '主材料を -1',
    say: ['{少なめ:mod=sukuname}でお願いします。食欲なくて。', '{量は少しでいい:mod=sukuname}です。'],
    hint: ['最近あまり食べられなくて…残すのは悪いから。', '健康診断で、食べ過ぎって言われちゃって。'],
    applies: (r) => total(r) >= 3,
    apply: (f) => f,
    check: (m, _i, b) => total(m) <= total(b) - 1,
    good: ['ちょうどいい量。ありがとう。', 'これなら残さずに食べられる。'],
    bad: ['多い…食べきれないよ。', '少なめって言ったのに…'],
  },
  nosauce: {
    id: 'nosauce',
    label: '仕上げなし',
    howto: 'トッピングをしない',
    say: ['上には{何もかけないで:mod=nosauce}。', '{ソースはいらない:mod=nosauce}から。'],
    hint: ['素材の味ってやつを味わいたいんだよね。', 'シャツを汚したくないんだ。これ一枚しかなくて。'],
    applies: (r) => r.topping !== null && (r.cat === 'main' || r.cat === 'staple'),
    apply: (f) => ({ ...f, topping: null }),
    check: (m) => m.topping === null,
    good: ['何もかかってない。そう、これ。', 'シンプルでいいね。'],
    bad: ['かけないでって言ったのに…', 'あー、かかってる…'],
  },
  yasai: {
    id: 'yasai',
    label: '野菜多め',
    howto: '緑色ゲルを +1',
    say: ['{野菜多め:mod=yasai}で。', '{緑のやつ、多めに:mod=yasai}入れて。'],
    hint: ['医者に「もっと野菜を」って言われちゃってさ。', '最近、肌の調子が悪くて。緑のものが足りてない気がする。'],
    applies: (r) => savory(r),
    apply: (f) => withIng(f, 'green', 1),
    check: (m, _i, b) => count(m, 'green') >= count(b, 'green') + 1,
    good: ['野菜たっぷり。健康になった気がする。', '緑がいっぱい。ありがとう。'],
    bad: ['野菜多めって言ったのに…', '緑が足りないよ。'],
  },
  allergy_yellow: {
    id: 'allergy_yellow',
    label: '黄色乳剤アレルギー',
    howto: '黄色乳剤（YE-05）を使わない',
    say: ['あ、私、{卵がダメ:mod=allergy_yellow}なんです。黄色いのは抜いてください。'],
    hint: ['IDカード、ちゃんと見てくれてるよね？', '前に別の食堂で、ひどい目にあってね…'],
    card: 'YE-05 黄色乳剤',
    applies: (r) => hasIng(r, 'yellow'),
    apply: (f) => ({ ...withIng(f, 'yellow', -99), topping: f.topping === 'yellow' ? null : f.topping }),
    check: (m) => count(m, 'yellow') === 0,
    good: ['ちゃんと抜いてくれてる。…安心して食べられる。', 'IDカード、見てくれたんだ。'],
    bad: ['…これ、黄色乳剤が入ってる。アレルギーだって書いてあるのに！', 'かゆっ…！ 黄色いの入ってるでしょ、これ！'],
  },
  allergy_milk: {
    id: 'allergy_milk',
    label: '白濁液アレルギー',
    howto: '白濁液（MK-04）を使わない',
    say: ['{乳製品がダメ:mod=allergy_milk}なんだ。白いの、抜いてね。'],
    hint: ['IDカードの注意書き、見た？', '牛乳を飲むと、ろくなことがなくてね。'],
    card: 'MK-04 白濁液',
    applies: (r) => hasIng(r, 'milk'),
    apply: (f) => ({ ...withIng(f, 'milk', -99), topping: f.topping === 'milk' ? null : f.topping }),
    check: (m) => count(m, 'milk') === 0,
    good: ['白濁液、抜いてあるね。ありがとう。', 'ちゃんとIDカードを見てくれたんだね。'],
    bad: ['これ、白濁液入ってるよね…？ ダメだって書いてあったのに！', 'うっ、お腹が…白いの入ってる…'],
  },
  allergy_brown: {
    id: 'allergy_brown',
    label: '褐色ペーストアレルギー',
    howto: '褐色ペースト（BP-07）を使わない',
    say: ['{褐色ペーストはダメ:mod=allergy_brown}なんだ。…原料が合わないらしくて。'],
    hint: ['IDカード、読んでくれた？ 大事なことが書いてあるから。', 'あの茶色いのの原料、知ってる？ 僕の体は知ってるみたい。'],
    card: 'BP-07 褐色ペースト',
    applies: (r) => hasIng(r, 'brown'),
    apply: (f) => ({ ...withIng(f, 'brown', -99), topping: f.topping === 'brown' ? null : f.topping }),
    check: (m) => count(m, 'brown') === 0,
    good: ['茶色いの、入ってないね。助かったよ。', 'IDカード、ちゃんと見てくれてる。'],
    bad: ['…これ、褐色ペーストだよね？ ダメだって書いてあったのに！', 'う、うう…じんましんが…'],
  },
};

/** 大盛り・少なめは主材料の増減として理想形を作る */
export function applyModifierToIdeal(id: ModifierId, f: Formula, r: Recipe): Formula {
  if (id === 'oomori') return withIng(f, r.primary, 1);
  if (id === 'sukuname') return withIng(f, r.primary, -1);
  return MODIFIERS[id].apply(f);
}

export const ALLERGY_MODS: ModifierId[] = ['allergy_yellow', 'allergy_milk', 'allergy_brown'];
