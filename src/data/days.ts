import type { IngId, ModifierId, QuestionId } from './types.ts';
import type { StoryId } from './characters.ts';

export interface StoryOrder {
  story: StoryId;
  /** 目標レシピ（'@usual' はゲンゾウの「いつもの」、'@free' は自由課題、'@nikujaga' は創作） */
  recipe: string;
  lines: string[];
  modifiers?: ModifierId[];
  weight?: number;
  /** 質問への個別の答え */
  answers?: Partial<Record<QuestionId, string>>;
  /** 評価後の固有の台詞（星の数ごと。なければ通常の反応） */
  after?: { good: string[]; mid: string[]; bad: string[] };
}

export interface DayDef {
  day: number;
  title: string;
  subtitle: string;
  notice: string[];
  customers: number;
  /** 注文のはっきり度の重み [名前で, 特徴で, 思い出で] */
  clarity: [number, number, number];
  modChance: number;
  modPool: ModifierId[];
  questions: number;
  patience: number;
  shortages: IngId[];
  story: Record<number, StoryOrder>;
  /** チュートリアルで最初の客の料理を固定する */
  fixed?: Record<number, { recipe: string; clarity: 1 | 2 | 3 }>;
}

export const DAYS: DayDef[] = [
  {
    day: 1,
    title: '起動',
    subtitle: 'BOOT SEQUENCE',
    notice: [
      '【中央食糧管理局 通達 第0001号】',
      '調理ユニット MEAL-7 の試験運用を開始する。',
      '配属先：第7配給食堂。期間：7日間。',
      '市民の要求に応じ、規定の素材から「〜風」料理を調製・提供せよ。',
      '市民満足度が 0 に達した場合、当該ユニットは廃棄処分とする。',
      '――幸福は、義務である。',
    ],
    customers: 5,
    clarity: [1, 0, 0],
    modChance: 0,
    modPool: [],
    questions: 0,
    patience: 260,
    shortages: [],
    fixed: { 0: { recipe: 'hamburg', clarity: 1 } },
    story: {
      1: {
        story: 'genzo',
        recipe: 'misoshiru',
        lines: ['{味噌汁:name=味噌汁}を一杯…頼めるかな。', 'AI が作るのか。…まあ、何事も経験じゃ。'],
        after: {
          good: ['……ああ。懐かしい、とは言わんが…温かいな。', 'ごちそうさん。また来るよ。'],
          mid: ['ふむ。まあ、こんなもんじゃろう。', '味噌汁は毎日飲むものじゃ。また来る。'],
          bad: ['……これは、味噌汁ではないな。', 'まあ、君もまだ一日目じゃ。'],
        },
      },
      3: {
        story: 'sato',
        recipe: 'coffee',
        lines: ['{コーヒー:name=コーヒー}。{熱い:temp=hot}やつ。', '……夜勤明けなんだ。目を覚まさないと、帰り道で寝る。'],
        after: {
          good: ['……ふぅ。生き返った。', 'これで家まで起きていられる。ありがとう。'],
          mid: ['まあ、カフェインっぽい味はする。', '……うん。とりあえず目は覚めた。'],
          bad: ['……逆に眠くなった。', 'これ、コーヒーか…？'],
        },
      },
    },
  },
  {
    day: 2,
    title: '曖昧',
    subtitle: 'AMBIGUITY',
    notice: [
      '【中央食糧管理局 通達 第0002号】',
      '市民の要求表現は、しばしば曖昧である。',
      '旧時代の料理名を正確に記憶している市民は減少傾向にある。',
      '要求を推論せよ。本日より「質問」機能の使用を許可する（1名につき2回まで）。',
      'なお、質問は市民の忍耐を消費する。',
    ],
    customers: 5,
    clarity: [0.2, 0.7, 0.1],
    modChance: 0,
    modPool: [],
    questions: 2,
    patience: 220,
    shortages: [],
    story: {
      1: {
        story: 'hirano',
        recipe: 'omurice',
        lines: [
          'あら、AI の料理？ お手並み拝見ね。',
          '{黄色い:color=黄}ふわふわで{ごはん:cat=staple}を包んで、上に{赤いソース:color=赤}。{ぷっくりした山の形:form=dome}で、{焼きたて:temp=hot}。…分かるかしら？',
        ],
        after: {
          good: ['……悪くないわね。卵の代わりの乳剤、うまく使ってるじゃない。', '合格よ。…今日のところはね。'],
          mid: ['まあまあね。愛情が足りないわ。AI に言っても仕方ないけど。', '及第点。精進なさい。'],
          bad: ['これをオムライスと呼ぶのは、オムライスに失礼よ。', 'レシピを読みなさい。読めるんでしょう？'],
        },
      },
      2: {
        story: 'mina',
        recipe: 'milk',
        lines: [
          'あのね！ {白くて:color=白}、{つめたくて:temp=chilled}、のむやつ！',
          'ママがね、「ほねがつよくなる」っていってたの。ミナ、ほねつよくしたい！',
        ],
        answers: {
          memory: 'がっこうのきゅうしょくでね、まいにちでてくるの！ びんにはいってるの！',
        },
        after: {
          good: ['ぷはー！ ほねつよくなった！', 'AI さん、ありがと！ またくるね！'],
          mid: ['んー、なんかちがうけど、のめる！', 'ほね、ちょっとだけつよくなったかも！'],
          bad: ['これ、しろくない…', 'ママのいってたのと、ちがう…'],
        },
      },
    },
  },
  {
    day: 3,
    title: '配給制限',
    subtitle: 'RATIONING',
    notice: [
      '【中央食糧管理局 通達 第0003号】',
      '第2合成プラントの不具合により、褐色ペースト（BP-07）を本日欠品とする。',
      '該当レシピは代替配合で調製せよ（レシピDBに自動反映済み）。',
      'また本日より、市民の「好み」の申告を受け付ける。',
      '要求に含まれる要望を見落とさないこと。',
    ],
    customers: 6,
    clarity: [0.15, 0.6, 0.25],
    modChance: 0.4,
    modPool: ['spicy', 'sweet', 'oomori', 'sukuname', 'lesssweet'],
    questions: 2,
    patience: 200,
    shortages: ['brown'],
    story: {
      1: {
        story: 'nezumi',
        recipe: 'mapo',
        lines: [
          '……よう。ここだけの話だ。',
          '刺激物規制で、食堂のメニューから消されたアレがあるだろ。{赤くて:color=赤}、{舌がしびれる:taste=辛}、{四角いの:form=cube}が沈んでるやつ。…作れるか？',
        ],
        after: {
          good: ['……これだ。この痛み。俺はまだ生きてる。', '恩に着る。このことは誰にも言うな。'],
          mid: ['まあ、辛さは足りないが…気持ちは受け取った。', '悪くない。次はもっと攻めてくれ。'],
          bad: ['……これじゃ、管理局の飯と変わらねえよ。', 'お前も結局、あっち側か。'],
        },
      },
      3: {
        story: 'genzo',
        recipe: 'yakizakana',
        lines: [
          '昔はな、朝の食卓に必ずあったもんじゃ。',
          '{細長くて:form=stick}、皮が{パリッと焼けて:temp=hot}、{醤油:ing=black}をちょろっとたらす。…わしの店でも、一番よく出た。',
        ],
        after: {
          good: ['……うむ。骨がないのは寂しいが、これは焼き魚じゃ。', '君は筋がいい。店を継がせたいくらいじゃ。'],
          mid: ['焼き加減がもう一歩じゃな。まあ、ええ。', 'ふむ。魚の顔はしとらんが、気持ちは伝わる。'],
          bad: ['……これは、魚ではないな。', 'わしの店なら、客は二度と来んぞ。'],
        },
      },
      4: {
        story: 'sato',
        recipe: 'cafeaulait',
        lines: [
          '……また夜勤明けだ。',
          '今日は、{苦すぎない:taste=甘}のがいい。コーヒーに{ミルク:ing=milk}が入った、{茶色い:color=茶}の。{あったかい:temp=warm}やつ。',
        ],
        after: {
          good: ['……ああ、やさしい味だ。泣きそう。', '明日も来る。たぶん明後日も。'],
          mid: ['うん。まあ、ほっとはする。', 'とりあえず、ありがとう。'],
          bad: ['……今日はもう、何も考えたくない。', 'これじゃない…'],
        },
      },
    },
  },
  {
    day: 4,
    title: '好み',
    subtitle: 'PREFERENCES',
    notice: [
      '【中央食糧管理局 通達 第0004号】',
      '本日より、市民IDカードにアレルギー情報を記載する制度を開始した。',
      '提供前に必ず確認せよ。アレルギー事故は重大な満足度低下を招く。',
      '（なお、猫舌は疾病ではない。だが配慮は推奨される。）',
    ],
    customers: 6,
    clarity: [0.1, 0.5, 0.4],
    modChance: 0.5,
    modPool: ['spicy', 'nospicy', 'sweet', 'lesssweet', 'nekojita', 'atsuatsu', 'oomori', 'nosauce', 'yasai', 'allergy_yellow', 'allergy_milk'],
    questions: 2,
    patience: 190,
    shortages: [],
    story: {
      1: {
        story: 'mina',
        recipe: 'creamsoda',
        lines: [
          'AI さん！ きょうはね、すごいのがのみたいの！',
          'おほしさまみたいに{シュワシュワ:form=fizz}してて、{みどりいろ:color=緑}で、うえに{しろいくも:color=白}がのってるの！ えほんでみたの！',
        ],
        answers: {
          memory: 'えほんのね、きっさてんのページ！ まどのところで、ほうせきみたいにひかってたの！',
        },
        after: {
          good: ['わあああ！ ほんとにひかってる！ ほうせきだ！', 'AI さん、まほうつかいなの？'],
          mid: ['シュワシュワしてる！ …くもはどこ？', 'ちょっとちがうけど、きれい！'],
          bad: ['これ…えほんのとちがう…', 'シュワシュワしない…'],
        },
      },
      3: {
        story: 'hirano',
        recipe: 'gratin',
        modifiers: ['nekojita'],
        lines: [
          '今日は{グラタン:name=グラタン}をいただこうかしら。',
          'それとね、私、{猫舌:mod=nekojita}なの。本来は熱々で出すものだけれど…加減、できるわね？',
        ],
        after: {
          good: ['……火傷しない、でも冷めてもいない。やるじゃない。', 'あなた、料理人の気遣いが分かってきたわね。'],
          mid: ['味はともかく、気遣いは受け取ったわ。', 'まだまだね。でも、嫌いじゃないわ。'],
          bad: ['私の話、聞いていたのかしら？', '料理は、食べる人のためのものよ。'],
        },
      },
    },
  },
  {
    day: 5,
    title: '監査',
    subtitle: 'INSPECTION',
    notice: [
      '【中央食糧管理局 通達 第0005号】',
      '本日、中央食糧管理局 監査部による抜き打ち監査を実施する。',
      '監査官の評価は、通常の 2 倍の重みで満足度に反映される。',
      '黄色乳剤（YE-05）は本日欠品。代替配合で対応せよ。',
    ],
    customers: 6,
    clarity: [0.1, 0.5, 0.4],
    modChance: 0.45,
    modPool: ['spicy', 'nospicy', 'sweet', 'lesssweet', 'nekojita', 'atsuatsu', 'oomori', 'sukuname', 'nosauce', 'yasai', 'allergy_milk', 'allergy_brown'],
    questions: 2,
    patience: 180,
    shortages: ['yellow'],
    story: {
      0: {
        story: 'kurosawa',
        recipe: 'ration',
        weight: 2,
        lines: [
          '中央食糧管理局 監査部、クロサワだ。抜き打ち監査を行う。',
          '{規定第十二条:cat=ration}に基づく、標準的な昼食を。{灰色:color=灰}の、{四角い:form=cube}、{温度調整不要:temp=room}のものだ。余計なものは入れるな。',
        ],
        after: {
          good: ['規定値どおり。…面白みはないが、それが正しい。', '記録しておく。MEAL-7、規定遵守。'],
          mid: ['許容範囲内だ。だが規定からの逸脱は記録する。', '次は規定どおりに。'],
          bad: ['規定違反だ。報告書に記載する。', '……これが試験運用の成果か。'],
        },
      },
      2: {
        story: 'genzo',
        recipe: '@nikujaga',
        lines: [
          '今日はな…ひとつ、無理を言ってもいいかな。',
          '女房がよく作ってくれた料理があってな。名前は…思い出せんのじゃ。{茶色い汁:color=茶}で、{芋:ing=white}と{肉:ing=brown}が{ごろごろ:form=cube}しとって…{甘くて、しょっぱくて:taste=甘}…。',
          'データベースには、きっと無いんじゃろう？',
        ],
        answers: {
          temp: 'あったかかった。湯気が立っとった。',
          form: '芋も肉も、ごろごろと…角ばったかたまりじゃったな。',
          taste: '甘くて、しょっぱい。甘辛い、ちゅうやつじゃ。醤油と砂糖の。',
          color: '茶色じゃ。醤油の色が芋に染みて。',
          cat: 'おかずじゃよ。飯が進む。器は深めの皿じゃった。',
          memory: '女房が大きな鍋でな…。芋が煮崩れかけて、汁が茶色く染みて…肉は、ほんの少ししか入っとらんかった。',
        },
      },
      4: {
        story: 'nezumi',
        recipe: 'curry',
        lines: [
          '……監査官が来てたろ。あいつに出したのと同じもんは食いたくない。',
          '{茶色くて:color=茶}、{辛くて:taste=辛}、{ごはんにかかってる:cat=staple}やつ。金曜日の匂いがするやつだ。',
        ],
        after: {
          good: ['……これだよ。管理局の連中には、この味は分からない。', 'お前、いい奴だな。…AI に言うのも変だが。'],
          mid: ['悪くない。辛さがもう一歩だな。', 'まあ、灰色のキューブよりはマシだ。'],
          bad: ['これ、金曜日の匂いがしないな。', '……期待しすぎたか。'],
        },
      },
    },
  },
  {
    day: 6,
    title: '記憶',
    subtitle: 'MEMORIES',
    notice: [
      '【中央食糧管理局 通達 第0006号】',
      '市民の要求に、旧時代の記憶に基づく表現が増加している。',
      '記憶の扱いには注意せよ。記憶は、時に食欲より強い。',
      '白濁液（MK-04）は本日欠品。',
    ],
    customers: 6,
    clarity: [0.05, 0.35, 0.6],
    modChance: 0.45,
    modPool: ['spicy', 'nospicy', 'sweet', 'lesssweet', 'nekojita', 'atsuatsu', 'oomori', 'sukuname', 'nosauce', 'yasai', 'allergy_yellow', 'allergy_brown'],
    questions: 3,
    patience: 180,
    shortages: ['milk'],
    story: {
      1: {
        story: 'sato',
        recipe: 'beer',
        lines: [
          '今日で、夜勤が終わるんだ。212 日ぶりの昼の仕事。',
          '仕事終わりの「とりあえず」ってやつ…ここで出せる？ {金色:color=金}で、{シュワシュワ:form=fizz}の、{キンキン:temp=chilled}の。泡は…今日は欠品なんだっけ。まあいいや。',
        ],
        after: {
          good: ['……乾杯。誰とって？ 君とだよ。', 'アルコールが入ってなくても、酔える気がする。'],
          mid: ['うん、気分は出た。ありがとう。', 'とりあえず、ね。'],
          bad: ['……とりあえず、じゃなかったな。', 'まあ、夜勤明けの頭にはこれくらいで。'],
        },
      },
      3: {
        story: 'hirano',
        recipe: 'harumaki',
        lines: [
          '本物を知っている者として、言わせてもらうわ。',
          '噛むと「パリッ」、次に「あつっ」となるもの。春なのに、なんて名前のね。…作れて？',
        ],
        after: {
          good: ['……パリッ。あつっ。……ふふ、覚えてたのね、この感じ。', 'あなたに、私の料理書を見せてあげてもいいわ。'],
          mid: ['パリッ、とはいかないわね。でも熱さは合格。', '惜しいわ。本当に。'],
          bad: ['……春は、まだ遠いわね。', '記憶って、難しいものよ。'],
        },
      },
      4: {
        story: 'mina',
        recipe: 'shortcake',
        lines: [
          'きょうね、ミナのおたんじょうびなの！',
          'えほんでみたの。{しろくて:color=白}、{さんかくで:form=wedge}、{あかいの:color=赤}がのってて、{つめたくて:temp=chilled}、{あまいの:taste=甘}！ ろうそくもたってたよ！',
        ],
        answers: {
          memory: 'えほんではね、みんなでうたをうたって、ふーってして、それからたべるの！',
        },
        after: {
          good: ['……！ おたんじょうびの、ケーキだ…！', 'AI さん、ありがとう。ミナ、きょうのこと、ずっとおぼえてる。'],
          mid: ['ケーキだ！ …たぶん！ ありがとう！', 'えほんのとちょっとちがうけど、うれしい！'],
          bad: ['これ…ケーキ？', 'おたんじょうび…なのに…'],
        },
      },
    },
  },
  {
    day: 7,
    title: '最後の注文',
    subtitle: 'LAST ORDER',
    notice: [
      '【中央食糧管理局 通達 第0007号】',
      '本日をもって、MEAL-7 の試験運用を終了する。',
      '本日の結果をもって、正式採用の可否を判定する。',
      '――最後まで、規定どおりに。',
    ],
    customers: 5,
    clarity: [0.1, 0.45, 0.45],
    modChance: 0.4,
    modPool: ['spicy', 'nospicy', 'sweet', 'lesssweet', 'nekojita', 'atsuatsu', 'oomori', 'sukuname', 'nosauce', 'yasai', 'allergy_yellow', 'allergy_milk', 'allergy_brown'],
    questions: 3,
    patience: 190,
    shortages: [],
    story: {
      0: {
        story: 'kurosawa',
        recipe: 'coffee',
        weight: 2,
        lines: [
          '最終監査だ。',
          '{覚醒作用のある:taste=苦}{黒色:color=黒}の{温飲料:cat=drink}を。糖分・乳分は不要。{温度は高く:temp=hot}。',
        ],
        after: {
          good: ['……規定どおりだ。', '個人的な感想を述べることは、職務規程に反する。……うまい。'],
          mid: ['許容範囲。記録する。', '報告書には「おおむね良好」と書いておく。'],
          bad: ['最終日にこれか。', '報告書を書くのが憂鬱だ。'],
        },
      },
      2: {
        story: 'nezumi',
        recipe: 'ramen',
        lines: [
          '……今日で最後なんだってな。俺も、この街を出る。',
          '最後に食っておきたいもんがある。{湯気で眼鏡が曇る:temp=hot}やつだ。…眼鏡はかけてないけどな。',
        ],
        after: {
          good: ['……うまい。これを覚えて出ていける。', 'あばよ、AI。お前は、あっち側じゃなかったな。'],
          mid: ['悪くない。旅の思い出にはなる。', 'じゃあな。元気でやれよ。'],
          bad: ['……最後がこれか。まあ、俺らしいか。', 'じゃあな。'],
        },
      },
      3: {
        story: 'mina',
        recipe: '@free',
        lines: [
          'AI さん！ きょうでさいごって、ほんと？',
          'ねえ、AI さんは、なにがすき？ AI さんのすきなの、ミナ、たべてみたい！',
        ],
        answers: {
          temp: 'AI さんのすきなのでいいよ！',
          form: 'なんでもいいの！ AI さんがきめて！',
          taste: 'AI さんがおいしいとおもうあじ！',
          color: 'AI さんのすきないろ！',
          cat: 'なんでも！ ごはんでも、おやつでも！',
          memory: 'あのね、AI さんのつくったの、ぜんぶおぼえてるよ。',
        },
      },
      4: {
        story: 'genzo',
        recipe: '@usual',
        lines: ['やあ。今日で最後なんじゃってな。', '……いつものを、頼めるかな。'],
        answers: {
          memory: '君が、わしのために作ってくれたもんじゃよ。忘れたとは言わせんぞ。',
          cat: 'わかっとるじゃろう？',
        },
      },
    },
  },
];

export const QUESTION_DEFS: { id: QuestionId; label: string; ask: string; cost: number }[] = [
  { id: 'temp', label: '温度', ask: '温かいものですか？ 冷たいものですか？', cost: 12 },
  { id: 'form', label: '形', ask: 'どんな形をしていますか？', cost: 12 },
  { id: 'taste', label: '味', ask: 'どんな味ですか？', cost: 12 },
  { id: 'color', label: '色', ask: '何色ですか？', cost: 12 },
  { id: 'cat', label: '分類', ask: '食事ですか？ おやつ？ 飲み物？', cost: 12 },
  { id: 'memory', label: '思い出', ask: 'それを食べたときのことを、教えてもらえますか？', cost: 20 },
];
