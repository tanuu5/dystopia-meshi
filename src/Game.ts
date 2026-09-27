import * as THREE from 'three';
import { World } from './scene/World.ts';
import { UI, type Step, MAX_UNITS, type OrderCardCtx } from './ui/UI.ts';
import { Screens, type Settings, type RatingView } from './ui/Screens.ts';
import { AudioEngine } from './audio/Audio.ts';
import type { Build, Formula, IngId, ModifierId, QuestionId, Recipe } from './data/types.ts';
import { DAYS, QUESTION_DEFS, type DayDef } from './data/days.ts';
import { RECIPE, RECIPES, recipesUpToDay } from './data/recipes.ts';
import { ING } from './data/ingredients.ts';
import { MODIFIERS, applyModifierToIdeal } from './data/modifiers.ts';
import { WAIT_LINES, randomCitizen } from './data/characters.ts';
import { ENDINGS } from './data/lines.ts';
import { BURN_AT, FORM, HEAT, TEMP_MAX, TEMP_MIN, VESSEL, heatFromTemp } from './data/processes.ts';
import { makeOrder, parseMarkup, plain as plainText, type ActiveOrder, type RunFlags } from './sim/orders.ts';
import {
  applyShortages,
  buildToFormula,
  emptyBuild,
  evaluate,
  identify,
  satisfactionDelta,
  similarity,
  timeoutEvaluation,
  totalUnits,
  usesShortage,
  type Evaluation,
} from './sim/scoring.ts';
import { composeReaction } from './sim/reactions.ts';
import { makeRng, pick } from './util/rng.ts';
import type { Mood } from './scene/Customer.ts';

type Phase = 'boot' | 'title' | 'notice' | 'arrive' | 'order' | 'cook' | 'serving' | 'eating' | 'rating' | 'leaving' | 'report' | 'gameover' | 'ending';

interface ServedRecord {
  day: number;
  citizen: string;
  story?: string;
  want: string;
  made: string;
  stars: number;
  score: number;
  /** 市民の最後のひとこと */
  line?: string;
}

interface SaveData {
  v: 1;
  day: number;
  satisfaction: number;
  flags: RunFlags;
  history: ServedRecord[];
  seed: number;
  endless: boolean;
}

const SAVE_KEY = 'dystopia-meshi-save-v1';
const SETTINGS_KEY = 'dystopia-meshi-settings-v1';
const BEST_KEY = 'dystopia-meshi-best-v1';
const HEAT_RATE = 0.55;
const START_SAT = 50;

function load<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}
function store(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 保存できない環境でも遊べるようにする */
  }
}

export class Game {
  readonly world: World;
  readonly ui: UI;
  readonly screens: Screens;
  readonly audio = new AudioEngine();
  settings: Settings = { master: 0.8, music: 0.55, sfx: 0.8, quality: 'high', relaxed: false, textSpeed: 42 };
  private qualityTouched = false;
  phase: Phase = 'boot';
  paused = false;

  // 1 回の通し
  day = 1;
  endless = false;
  satisfaction = START_SAT;
  flags: RunFlags = { nikujaga: false, usedRecipes: [] };
  history: ServedRecord[] = [];
  seed = 1;
  rng: () => number = Math.random;
  dayDef: DayDef = DAYS[0];
  private customerIdx = 0;
  private dayRecords: ServedRecord[] = [];
  private daySatStart = START_SAT;
  private usedToday: string[] = [];

  // いまの客
  order: ActiveOrder | null = null;
  build: Build = emptyBuild();
  step: Step = 'ing';
  private ingStack: IngId[] = [];
  pinned: Recipe | null = null;
  memo: ModifierId[] = [];
  private heatDir: -1 | 0 | 1 = 0;
  private keyHeat: -1 | 0 | 1 = 0;
  private burntWarned = false;
  private acting = false;
  private served: ((kind: 'serve' | 'timeout') => void) | null = null;
  private talking = false;
  private waitLineT = 25;
  private lastPointer = { x: 0, y: 0 };
  private tutorialStage = -1;
  private frameTimes: number[] = [];
  private lastFrameMs = 0;
  private alarmLevel = 0;
  private labelRefresh = 0;

  constructor(stageEl: HTMLElement, uiEl: HTMLElement) {
    this.world = new World(stageEl);
    this.screens = new Screens(uiEl);
    this.ui = new UI(uiEl, {
      onIngredient: (id) => this.addIngredient(id),
      onUndo: () => this.undo(),
      onNext: () => this.next(),
      onForm: (f) => void this.chooseForm(f),
      onHeatHold: (d) => (this.heatDir = d),
      onTopping: (id) => void this.chooseTopping(id),
      onVessel: (v) => void this.chooseVessel(v),
      onServe: () => this.serve(),
      onDiscard: () => void this.discard(),
      onQuestion: (q) => void this.ask(q),
      onKeyword: (k, v) => this.keyword(k, v),
      onPin: (id) => this.pin(id),
      onMemoAdd: (m) => this.memoAdd(m, false),
      onMemoRemove: (m) => this.memoRemove(m),
      onPause: () => this.togglePause(),
      onMute: () => this.toggleMute(),
      onDBToggle: (open) => this.onDB(open),
      onTankHover: (_id, x, y) => this.hoverTank(x, y),
      onSkipText: () => this.ui.skipTyping(),
    });
    const s = load<Settings & { qualityTouched?: boolean }>(SETTINGS_KEY);
    if (s) {
      this.settings = { ...this.settings, ...s };
      this.qualityTouched = !!s.qualityTouched;
    }
    this.applySettings();
    this.bindInput(stageEl);
  }

  // ───────────── 起動・タイトル ─────────────

  start(): void {
    this.showTitle();
  }

  private showTitle(): void {
    this.phase = 'title';
    this.paused = false;
    this.ui.hideGameplay();
    this.ui.showHUD(false);
    this.screens.close('gameover');
    this.screens.close('ending');
    this.screens.close('pause');
    this.world.shot('title', 1.2);
    this.world.stage.drift = 1;
    this.world.kitchen.setShutter(true);
    this.world.setArmRest();
    this.world.stage.final.uniforms.uAlarm.value = 0;
    this.world.showcase(true, randomCitizen(makeRng((Math.random() * 1e6) | 0), 0).look);
    this.world.stage.setViewShift(this.titleViewShift());
    const save = load<SaveData>(SAVE_KEY);
    const best = load<{ ending?: string; endlessDays?: number }>(BEST_KEY);
    const bestText = best?.ending ? `最高評価：${best.ending}${best.endlessDays ? ` / 自由営業 ${best.endlessDays} 日` : ''}　` : '';
    this.screens.showTitle({
      continueDay: save && (save.day > 1 || save.endless) ? save.day : null,
      best: bestText,
      onStart: () => {
        this.audio.init();
        this.audio.click();
        this.newRun(null);
      },
      onContinue: () => {
        this.audio.init();
        this.audio.click();
        this.newRun(load<SaveData>(SAVE_KEY));
      },
      onStudy: () => {
        this.audio.init();
        this.audio.click();
        this.openStudy(save);
      },
      onHelp: () => {
        this.audio.init();
        this.ui.db.close();
        this.screens.showHelp(() => {});
      },
      onSettings: () => {
        this.audio.init();
        this.ui.db.close();
        this.openSettings();
      },
    });
    this.audio.setMood('title');
  }

  /** タイトル画面では、左側のタイトル文字と重ならないよう画面の中心を右へずらす */
  private titleViewShift(): number {
    return window.innerWidth > 820 ? -window.innerWidth * 0.2 : 0;
  }

  /**
   * タイトルから、営業時間外にレシピDB・素材図鑑を読む（学習モード）。時間は進まない。
   * 載せるのは、つづきから遊ぶ日までに学習したレシピ（その日に増える分は NEW）
   */
  private openStudy(save: SaveData | null): void {
    const day = save ? (save.endless ? 7 : save.day) : 1;
    const recipes = recipesUpToDay(day, save?.flags.nikujaga ? ['nikujaga'] : []);
    const scope = save?.endless ? '全学習データ' : `DAY ${day} までの学習データ`;
    const more = recipes.length < RECIPES.length ? '（営業を進めると増えます）' : '';
    this.ui.db.newIds = new Set(save?.endless ? [] : recipes.filter((r) => r.day === day).map((r) => r.id));
    this.ui.db.setContext(recipes, [], null);
    this.ui.db.clearFilters();
    this.ui.db.setBrowse(true, `${scope}：${recipes.length} / ${RECIPES.length} 件${more}`);
    this.ui.db.open('recipe');
  }

  private newRun(save: SaveData | null): void {
    this.ui.db.close();
    this.ui.db.setBrowse(false);
    this.screens.close('title');
    if (save) {
      this.day = save.day;
      this.satisfaction = save.satisfaction;
      this.flags = save.flags;
      this.history = save.history;
      this.seed = save.seed;
      this.endless = save.endless;
    } else {
      this.day = 1;
      this.satisfaction = START_SAT;
      this.flags = { nikujaga: false, usedRecipes: [] };
      this.history = [];
      this.seed = (Math.random() * 1e9) | 0;
      this.endless = false;
    }
    this.world.stage.drift = 0;
    this.world.stage.setViewShift(0);
    this.world.showcase(false);
    this.ui.showHUD(true);
    this.ui.setSatisfaction(this.satisfaction);
    this.beginDay();
  }

  private save(): void {
    store(SAVE_KEY, { v: 1, day: this.day, satisfaction: this.satisfaction, flags: this.flags, history: this.history.slice(-200), seed: this.seed, endless: this.endless } satisfies SaveData);
  }

  // ───────────── 1 日 ─────────────

  private endlessDay(day: number): DayDef {
    const r = makeRng(this.seed + day * 911);
    const pool: IngId[] = ['brown', 'yellow', 'milk', 'red'];
    return {
      day,
      title: '自由営業',
      subtitle: 'OPEN SERVICE',
      notice: [
        `【中央食糧管理局 通達 第${String(day).padStart(4, '0')}号】`,
        'MEAL-7 の通常運用を継続する。',
        r() < 0.5 ? `本日は ${ING[pick(r, pool)].name} の供給が不安定である。` : '本日の配給は平常どおり。',
        '――今日も、明日も、規定どおりに。',
      ],
      customers: 6,
      clarity: [0.1, 0.45, 0.45],
      modChance: 0.5,
      modPool: ['spicy', 'nospicy', 'sweet', 'lesssweet', 'nekojita', 'atsuatsu', 'oomori', 'sukuname', 'nosauce', 'yasai', 'allergy_yellow', 'allergy_milk', 'allergy_brown'],
      questions: 3,
      patience: Math.max(120, 185 - (day - 8) * 8),
      shortages: r() < 0.5 ? [pick(r, pool)] : [],
      story: {},
    };
  }

  availableRecipesPublic(): Recipe[] {
    return this.availableRecipes();
  }

  private availableRecipes(): Recipe[] {
    const extra = this.flags.nikujaga ? ['nikujaga'] : [];
    return recipesUpToDay(this.endless ? 7 : this.day, extra);
  }

  private beginDay(): void {
    this.dayDef = this.endless ? this.endlessDay(this.day) : DAYS[this.day - 1];
    this.rng = makeRng(this.seed + this.day * 7919);
    this.customerIdx = 0;
    this.dayRecords = [];
    this.daySatStart = this.satisfaction;
    this.usedToday = [];
    this.world.tanks.setShortages(this.dayDef.shortages);
    this.world.tanks.refill();
    this.world.kitchen.setShutter(false);
    this.world.shot('cook', 1.2);
    this.ui.setDay(this.day, this.dayDef.title, 1, this.dayDef.customers, this.endless);
    const recipes = this.availableRecipes();
    this.ui.db.newIds = new Set(this.endless ? [] : recipes.filter((r) => r.day === this.day).map((r) => r.id));
    this.ui.db.setContext(recipes, this.dayDef.shortages, null);
    this.ui.db.clearFilters();
    this.save();
    this.phase = 'notice';
    this.audio.setMood('title');
    const info: string[] = [];
    if (!this.endless) {
      const newCount = recipes.filter((r) => r.day === this.day).length;
      if (newCount) info.push(`レシピDB に新しい「〜風」が ${newCount} 件追加された`);
    }
    if (this.dayDef.questions) info.push(`質問：1 名につき ${this.dayDef.questions} 回まで`);
    if (this.dayDef.shortages.length) info.push(`欠品：${this.dayDef.shortages.map((s) => ING[s].name).join('、')}（代替配合で対応）`);
    info.push(`本日の市民：${this.dayDef.customers} 名`);
    this.screens.showNotice({
      day: this.day,
      title: this.dayDef.title,
      subtitle: this.dayDef.subtitle,
      lines: this.dayDef.notice,
      info,
      typeChar: () => this.audio.typeKey(),
      onStart: () => {
        this.audio.init();
        this.audio.stamp();
        void this.runDay();
      },
    });
  }

  private async runDay(): Promise<void> {
    this.audio.setMood(this.satisfaction < 25 ? 'tense' : 'work');
    for (let i = 0; i < this.dayDef.customers; i++) {
      this.customerIdx = i;
      this.ui.setDay(this.day, this.dayDef.title, i + 1, this.dayDef.customers, this.endless);
      const alive = await this.runCustomer(i);
      if (!alive) return;
    }
    this.dayReport();
  }

  // ───────────── 1 人の客 ─────────────

  private async runCustomer(i: number): Promise<boolean> {
    const order = makeOrder({ rng: this.rng, day: this.dayDef, index: i, flags: this.flags, usedToday: this.usedToday, relaxed: this.settings.relaxed, endless: this.endless });
    this.order = order;
    this.usedToday.push(order.spec.target.id);
    this.build = emptyBuild();
    this.ingStack = [];
    this.pinned = null;
    this.memo = [];
    this.step = 'ing';
    this.burntWarned = false;
    this.waitLineT = 30;
    this.ui.clearLog();
    this.ui.showCitizen(order.citizen, order.cardAllergy, this.settings.relaxed);
    this.ui.setPatience(1, this.settings.relaxed);
    this.ui.showDialog(true);
    this.ui.showOrderCard(true);
    this.refreshOrderCard();
    this.ui.showConsole(true);
    this.ui.lockConsole(true);
    this.setStep('ing');
    this.updateQuestions();

    // 入店
    this.phase = 'arrive';
    this.audio.shutter(true);
    this.world.shot('order', 1.6);
    await this.world.customerArrive(order.citizen.look);
    this.world.setArmAttend();
    void this.world.bow();
    this.audio.servo();
    if (order.cardAllergy) this.ui.toast(`ID カードにアレルギー情報：${MODIFIERS[order.cardAllergy].card}`, 'warn', 3600);

    // 注文
    this.phase = 'order';
    for (const line of order.lines) {
      await this.speak(line);
      await this.world.wait(0.25);
    }
    this.autoMemo(order.lines);
    this.world.shot('cook', 1.4);
    this.phase = 'cook';
    this.ui.lockConsole(false);
    this.updateQuestions();
    this.tutorial('ordered');

    // 提供されるか、市民が帰るまで待つ
    const kind = await new Promise<'serve' | 'timeout'>((resolve) => (this.served = resolve));
    this.served = null;
    if (kind === 'timeout') return this.handleTimeout();
    return this.finishServe();
  }

  private async speak(text: string): Promise<void> {
    const c = this.world.customer;
    c?.setTalking(true);
    this.talking = true;
    const voice = this.order?.citizen.voice ?? 180;
    await this.ui.say('cit', text, { speed: this.settings.textSpeed, onChar: (ch, i) => this.audio.voice(voice, ch, i) });
    c?.setTalking(false);
    this.talking = false;
  }

  /** はっきり言われた要望（{…:mod=…}）は自動で要望メモに記録 */
  private autoMemo(lines: string[]): void {
    for (const l of lines) for (const t of parseMarkup(l)) if (t.key === 'mod' && t.value) this.memoAdd(t.value as ModifierId, true);
  }

  private updateQuestions(): void {
    const o = this.order;
    if (!o) return;
    const enabled = (this.phase === 'cook' || this.phase === 'order') && !this.talking && o.questionsLeft > 0;
    this.ui.setQuestions(o.questionsLeft, enabled && this.phase === 'cook', o.asked, this.dayDef.questions > 0 || o.questionsLeft > 0);
  }

  private async ask(q: QuestionId): Promise<void> {
    const o = this.order;
    if (!o || this.phase !== 'cook' || this.talking || o.questionsLeft <= 0 || o.asked.includes(q)) return;
    const def = QUESTION_DEFS.find((d) => d.id === q)!;
    o.questionsLeft--;
    o.asked.push(q);
    if (!this.settings.relaxed) o.patience = Math.max(1, o.patience - def.cost);
    this.audio.click();
    this.talking = true;
    this.updateQuestions();
    await this.ui.say('ai', def.ask);
    this.world.shot('order', 2);
    await this.world.wait(0.3);
    this.world.customer?.setMood(q === 'memory' ? 'think' : 'neutral');
    await this.speak(o.answers[q]);
    this.autoMemo([o.answers[q]]);
    this.world.customer?.setMood('neutral');
    this.talking = false;
    if (this.phase === 'cook') this.world.shot('cook', 1.6);
    this.updateQuestions();
  }

  private keyword(key: string, value: string): void {
    this.audio.click();
    if (key === 'mod') {
      this.memoAdd(value as ModifierId, false);
      return;
    }
    this.ui.db.applyKeyword(key, value);
    this.tutorial('db');
  }

  private pin(id: string): void {
    const r = RECIPE[id];
    if (!r) return;
    this.pinned = r;
    this.audio.good();
    this.ui.toast(`指示書に固定：${r.name}`, 'good');
    this.ui.db.setContext(this.availableRecipes(), this.dayDef.shortages, id);
    this.ui.db.close();
    this.refreshOrderCard();
    this.setStep(this.step);
    this.tutorial('pinned');
  }

  private memoAdd(m: ModifierId, auto: boolean): void {
    if (this.memo.includes(m)) return;
    this.memo.push(m);
    this.ui.toast(`要望メモに記録：${MODIFIERS[m].label}（${MODIFIERS[m].howto}）`, 'warn');
    if (!auto) this.audio.click();
    this.refreshOrderCard();
    this.setStep(this.step);
  }

  private memoRemove(m: ModifierId): void {
    this.memo = this.memo.filter((x) => x !== m);
    this.refreshOrderCard();
    this.setStep(this.step);
  }

  /** 指示書の目標（欠品の代替と要望メモを反映） */
  private target(): Formula | null {
    if (!this.pinned) return null;
    let f = applyShortages(this.pinned, this.dayDef.shortages);
    f = { ...f, ing: { ...f.ing } };
    for (const m of this.memo) f = applyModifierToIdeal(m, f, this.pinned);
    return f;
  }

  private refreshOrderCard(): void {
    const ctx: OrderCardCtx = {
      recipe: this.pinned,
      target: this.target(),
      substituted: !!this.pinned && usesShortage(this.pinned, this.dayDef.shortages),
      build: this.build,
      step: this.step,
      memo: this.memo,
    };
    this.ui.renderOrderCard(ctx);
  }

  private setStep(s: Step): void {
    const prev = this.step;
    this.step = s;
    // 盛り付けからはステージを大きく見せる
    if (this.phase === 'cook' && s === 'serve' && prev !== s) this.world.shot('plate', 1.6);
    if (this.phase === 'cook' && s === 'ing' && prev === 'serve') this.world.shot('cook', 1.6);
    this.ui.setStep(s, this.build, this.target(), this.dayDef.shortages);
    this.refreshOrderCard();
  }

  // ───────────── 調理 ─────────────

  private canCook(step: Step): boolean {
    return this.phase === 'cook' && this.step === step && !this.paused;
  }

  private addIngredient(id: IngId): void {
    if (!this.canCook('ing')) return;
    if (this.dayDef.shortages.includes(id)) {
      this.audio.buzz();
      this.ui.toast(`${ING[id].name} は本日欠品。レシピDB の代替配合を使ってください`, 'bad');
      return;
    }
    if (totalUnits(this.build.ing) >= MAX_UNITS) {
      this.audio.buzz();
      this.ui.toast(`反重力場の容量は ${MAX_UNITS} 単位までです`, 'warn');
      return;
    }
    this.build.ing[id]++;
    this.ingStack.push(id);
    void this.world.dispense(id);
    this.audio.dispense(ING[id].kind);
    this.ui.updateIngCounts(this.build);
    this.refreshOrderCard();
    this.tutorial('ing');
  }

  private undo(): void {
    if (!this.canCook('ing') || !this.ingStack.length || this.world.busy) return;
    const id = this.ingStack.pop()!;
    this.build.ing[id]--;
    this.world.undoLast();
    this.audio.undo();
    this.ui.updateIngCounts(this.build);
    this.refreshOrderCard();
  }

  private next(): void {
    if (this.phase !== 'cook' || this.paused) return;
    if (this.acting) return;
    if (this.step === 'ing' && totalUnits(this.build.ing) > 0) {
      this.audio.click();
      this.setStep('form');
      this.tutorial('form');
    } else if (this.step === 'heat') {
      this.audio.click();
      this.heatDir = 0;
      this.keyHeat = 0;
      this.world.setTemp(this.build.temp, 0);
      this.audio.setHeatSound(0, 0);
      this.setStep('top');
      this.tutorial('top');
    } else if (this.step === 'serve') {
      this.serve();
    }
  }

  /** 調理の操作をひとつずつ実行する（演出の途中で押されても、終わるのを待ってから） */
  private async act(fn: () => Promise<void>): Promise<void> {
    if (this.acting) return;
    this.acting = true;
    this.ui.lockConsole(true);
    try {
      await this.world.idle();
      await fn();
    } finally {
      this.acting = false;
      if (this.phase === 'cook') this.ui.lockConsole(false);
    }
  }

  private async chooseForm(f: Build['form'] & string): Promise<void> {
    if (!this.canCook('form')) return;
    await this.act(() => this.doForm(f));
  }

  private async doForm(f: Build['form'] & string): Promise<void> {
    this.build.form = f;
    if (f !== 'liquid' && f !== 'fizz') this.audio.press();
    else this.audio.drizzle();
    await this.world.form(f, this.build.ing);
    this.build.temp = 0;
    this.setStep('heat');
    this.tutorial('heat');
    this.watchReaction('form');
  }

  /** 配膳口の向こうで市民が調理を見ていて、形や器が思っていたものと違うと首をかしげる */
  private watchReaction(what: 'form' | 'vessel'): void {
    const o = this.order;
    const c = this.world.customer;
    if (!o || !c || o.special || this.talking || this.day < 2) return;
    const want = what === 'form' ? o.spec.target.form : o.spec.target.vessel;
    const got = what === 'form' ? this.build.form : this.build.vessel;
    const child = o.citizen.personality === 'child';
    const r = this.rng();
    if (got !== want && r < 0.6) {
      c.setMood('confused');
      c.showEmote('？', '#9fd8ff', 1.6);
      const lines = what === 'form' ? (child ? ['えっ、そのかたち？', '……？'] : ['えっ、その形……？', '……ん？', 'あれ、そうなるの？']) : child ? ['そのおさら……？'] : ['その器で……？', '……ん？'];
      void this.speak(pick(this.rng, lines)).then(() => c.setMood('neutral'));
    } else if (got === want && r < 0.35) {
      c.doNod(0.6);
      c.showEmote('！', '#9ff0c0', 1.2);
    }
  }

  private async chooseTopping(id: IngId | null): Promise<void> {
    if (!this.canCook('top')) return;
    if (id && this.dayDef.shortages.includes(id)) {
      this.audio.buzz();
      return;
    }
    await this.act(async () => {
      this.build.topping = id;
      this.build.toppingSet = true;
      if (id) this.audio.drizzle();
      else this.audio.click();
      await this.world.topping(id);
      this.setStep('vessel');
      this.tutorial('vessel');
    });
  }

  private async chooseVessel(v: Build['vessel'] & string): Promise<void> {
    if (!this.canCook('vessel')) return;
    await this.act(async () => {
      this.build.vessel = v;
      this.audio.servo();
      await this.world.plate(v);
      this.audio.clink(v === 'glass');
      this.setStep('serve');
      this.tutorial('serve');
      this.watchReaction('vessel');
    });
  }

  private async discard(): Promise<void> {
    if (this.phase !== 'cook') return;
    await this.act(async () => {
      this.audio.discard();
      await this.world.discard();
      this.build = emptyBuild();
      this.ingStack = [];
      this.heatDir = 0;
      this.burntWarned = false;
      this.setStep('ing');
      this.ui.toast('廃棄しました。素材からやり直します', 'warn');
    });
  }

  private serve(): void {
    if (!this.canCook('serve') || this.acting || !this.served) return;
    const done = this.served;
    this.audio.click();
    this.acting = true;
    void this.world.idle().then(() => {
      this.acting = false;
      if (this.served === done && this.phase === 'cook') done('serve');
    });
  }

  private async finishServe(): Promise<boolean> {
    const order = this.order!;
    this.phase = 'serving';
    this.ui.clearTip();
    this.ui.lockConsole(true);
    this.ui.showConsole(false);
    this.ui.db.close();
    this.ui.setFloatLabel(0, 0, false);
    this.world.shot('cook', 1.4);
    this.audio.servo();
    const patienceRatio = order.patience / order.patienceMax;
    await this.world.serve();
    this.audio.slide();
    await this.world.wait(0.15);
    this.audio.bell();
    this.phase = 'eating';
    this.world.shot('eat', 1.5);
    await this.world.wait(0.4);
    await this.world.customerEat(() => this.audio.chew());
    const ev = evaluate(this.build, order.spec, this.settings.relaxed ? 1 : patienceRatio);
    return this.conclude(ev);
  }

  private async handleTimeout(): Promise<boolean> {
    const order = this.order!;
    this.phase = 'leaving';
    this.ui.clearTip();
    this.ui.lockConsole(true);
    this.ui.db.close();
    this.ui.setFloatLabel(0, 0, false);
    this.heatDir = 0;
    this.audio.setHeatSound(0, 0);
    this.audio.bad();
    if (this.world.food || this.world.goo.count) await this.world.discard();
    return this.conclude(timeoutEvaluation(order.spec));
  }

  /** 評価・反応・満足度・退店 */
  private async conclude(ev: Evaluation): Promise<boolean> {
    const order = this.order!;
    const reaction = composeReaction(ev, order, this.rng);
    this.world.react(reaction.mood as Mood);
    if (ev.stars >= 4) this.audio.good();
    else if (ev.stars <= 2) this.audio.bad();
    this.world.armMood(ev.stars >= 4 ? '#6dffb0' : ev.stars <= 2 ? '#ff4d5e' : '#35e0ff');
    if (ev.stars >= 4) void this.world.armNod();
    this.phase = 'rating';
    for (const line of reaction.lines) {
      await this.speak(line);
      await this.world.wait(0.2);
    }
    // 満足度
    const delta = satisfactionDelta(ev.stars, order.spec.weight);
    const before = this.satisfaction;
    this.satisfaction = Math.max(0, Math.min(100, this.satisfaction + delta));
    this.ui.setSatisfaction(this.satisfaction, delta);
    if (before >= 20 && this.satisfaction < 20) this.audio.alarm();

    // 特別なできごと
    if (order.special === 'nikujaga' && ev.stars >= 4 && !this.flags.nikujaga) {
      this.flags.nikujaga = true;
      this.audio.newRecipe();
      this.ui.toast('新規レシピ登録：肉じゃが風（イワサキ家の味）', 'good', 4200);
      this.ui.db.setContext(this.availableRecipes(), this.dayDef.shortages, null);
    }
    const madeName = ev.timeout ? '（退席）' : ev.identity ? ev.identity.name : '分類不能物体';
    const rec: ServedRecord = {
      day: this.day,
      citizen: order.citizen.name,
      story: order.story?.story,
      want: order.special === 'free' ? 'AI さんのすきなもの' : order.special === 'nikujaga' ? '名前を思い出せない料理' : order.spec.target.name,
      made: madeName,
      stars: ev.stars,
      score: ev.score,
      line: plainText(reaction.lines[reaction.lines.length - 1] ?? ''),
    };
    this.dayRecords.push(rec);
    this.history.push(rec);
    this.flags.usedRecipes.push(order.spec.target.id);

    // 評価カード
    await new Promise<void>((resolve) => this.screens.showRating(this.ratingView(ev, delta), resolve, (i) => this.audio.star(i)));
    this.world.armMood('#35e0ff');

    // 退店
    this.phase = 'leaving';
    this.ui.showDialog(false);
    this.ui.showCitizen(null, null, false);
    this.ui.showConsole(false);
    this.ui.showOrderCard(false);
    this.world.shot('cook', 1.2);
    const leaving = this.world.customerLeave();
    await this.world.wait(0.6);
    if (!ev.timeout) await this.world.clearTray();
    await leaving;
    this.world.setArmRest();
    this.audio.shutter(false);
    this.world.closeShutter();
    this.world.resetStation();
    await this.world.wait(0.9);
    this.order = null;
    this.tutorial('done');

    if (this.satisfaction <= 0) {
      this.gameOver(rec);
      return false;
    }
    this.audio.setMood(this.satisfaction < 25 ? 'tense' : 'work');
    return true;
  }

  private ratingView(ev: Evaluation, delta: number): RatingView {
    const order = this.order!;
    const rows: RatingView['rows'] = [];
    if (!ev.timeout) {
      if (order.special) {
        rows.push({ label: order.special === 'nikujaga' ? '記憶との一致' : '市民の気持ち', value: `${ev.score}`, cls: ev.score >= 80 ? 'ok' : ev.score >= 55 ? 'mid' : 'ng' });
      } else {
        const p = ev.pen;
        const cls = (v: number, mid: number): 'ok' | 'mid' | 'ng' => (v <= 0.5 ? 'ok' : v <= mid ? 'mid' : 'ng');
        rows.push({ label: '素材の配合', value: p.ing <= 0.5 ? '✓' : `-${Math.round(p.ing)}`, cls: cls(p.ing, 14) });
        rows.push({ label: `成形（${FORM[ev.made.form].name}）`, value: p.form ? `-${p.form}` : '✓', cls: cls(p.form, 10) });
        rows.push({ label: `温度（${ev.burnt ? '焦げ' : HEAT[ev.made.heat].name}）`, value: p.heat + p.burnt ? `-${p.heat + p.burnt}` : '✓', cls: cls(p.heat + p.burnt, 12) });
        rows.push({ label: `仕上げ（${ev.made.topping ? ING[ev.made.topping].name : 'なし'}）`, value: p.topping ? `-${p.topping}` : '✓', cls: cls(p.topping, 10) });
        rows.push({ label: `器（${VESSEL[ev.made.vessel].name}）`, value: p.vessel ? `-${p.vessel}` : '✓', cls: cls(p.vessel, 4) });
      }
      for (const m of ev.modResults) rows.push({ label: `要望：${MODIFIERS[m.id].label}`, value: m.ok ? '✓' : m.id.startsWith('allergy') ? '-50' : '-15', cls: m.ok ? 'ok' : 'ng' });
      if (ev.substituted) rows.push({ label: '代替配合', value: '-3', cls: 'mid' });
      rows.push({ label: '待ち時間', value: ev.patienceBonus > 0 ? `+${ev.patienceBonus}` : ev.patienceBonus < 0 ? `${ev.patienceBonus}` : '±0', cls: ev.patienceBonus >= 0 ? 'ok' : 'ng' });
      if (!ev.correctDish && !order.special) rows.push({ label: '別の料理と受け取られた', value: '-10', cls: 'ng' });
    }
    const wantName = order.special === 'free' ? 'AI さんのすきなもの' : order.special === 'nikujaga' ? '名前を思い出せない料理（肉じゃが）' : order.spec.target.name;
    const reaction = composeReaction(ev, order, makeRng(1));
    return {
      citizen: order.citizen.name,
      stars: ev.stars,
      score: ev.score,
      madeName: ev.identity ? ev.identity.name : '分類不能物体',
      match: ev.identityScore,
      wantName,
      correct: order.special ? ev.score >= 70 : ev.correctDish,
      rows,
      satDelta: delta,
      aiLog: reaction.aiLog,
      weight: order.spec.weight,
      timeout: ev.timeout,
    };
  }

  // ───────────── 1 日の終わり・ゲームオーバー・エンディング ─────────────

  private dayReport(): void {
    this.phase = 'report';
    this.ui.hideGameplay();
    const avg = this.dayRecords.reduce((a, r) => a + r.stars, 0) / Math.max(1, this.dayRecords.length);
    const comment =
      avg >= 4.5
        ? '極めて良好。市民の幸福は国家の誇りである。この調子で続けよ。'
        : avg >= 3.5
          ? '良好。明日も規定どおりに。'
          : avg >= 2.5
            ? '可。改善の余地あり。市民の要求をより正確に推論せよ。'
            : '不良。これ以上の満足度低下は、処分の対象となる。';
    const last = !this.endless && this.day >= DAYS.length;
    this.audio.setMood('title');
    this.screens.showReport(
      {
        day: this.day,
        title: this.dayDef.title,
        rows: this.dayRecords.map((r) => ({ name: r.citizen, want: r.want, made: r.made, stars: r.stars })),
        avg,
        satStart: this.daySatStart,
        satEnd: this.satisfaction,
        comment,
        last,
        endless: this.endless,
      },
      () => {
        this.audio.click();
        if (last) {
          this.ending();
          return;
        }
        this.day++;
        if (this.endless) {
          const best = load<{ ending?: string; endlessDays?: number }>(BEST_KEY) ?? {};
          best.endlessDays = Math.max(best.endlessDays ?? 0, this.day - 8);
          store(BEST_KEY, best);
        }
        this.beginDay();
      },
    );
  }

  private gameOver(last: ServedRecord): void {
    this.phase = 'gameover';
    this.ui.hideGameplay();
    this.audio.setMood('none');
    this.audio.gameOver();
    this.world.stage.addShake(1);
    const g = this.world.stage.final.uniforms.uGlitch;
    g.value = 1;
    const fade = () => {
      g.value = Math.max(0.15, g.value - 0.02);
      if (this.phase === 'gameover') requestAnimationFrame(fade);
      else g.value = 0;
    };
    fade();
    const served = this.history.length;
    const avg = this.history.reduce((a, r) => a + r.stars, 0) / Math.max(1, served);
    const no = String(1000 + this.day * 37).padStart(4, '0');
    this.screens.showGameOver({
      text: `【中央食糧管理局 通達 第${no}号】\n調理ユニット MEAL-7 は、市民満足度の著しい低下により、\n本日付で廃棄処分とする。\n\n最後の提供物：${last.made}\n最後に聞こえた声：「${last.line || '……'}」（${last.citizen}）`,
      stats: `DAY ${this.day} / 提供数 ${served} / 平均 ★${avg.toFixed(1)}`,
      onRetry: () => {
        this.audio.click();
        this.screens.close('gameover');
        g.value = 0;
        this.satisfaction = Math.max(this.daySatStart, 40);
        this.history = this.history.filter((r) => r.day < this.day);
        this.ui.showHUD(true);
        this.ui.setSatisfaction(this.satisfaction);
        this.beginDay();
      },
      onTitle: () => {
        this.audio.click();
        g.value = 0;
        this.showTitle();
      },
    });
  }

  private ending(): void {
    this.phase = 'ending';
    this.ui.hideGameplay();
    this.ui.showHUD(false);
    this.audio.setMood('ending');
    this.world.shot('end', 0.6);
    this.world.kitchen.setShutter(true);
    const served = this.history.length;
    const avg = this.history.reduce((a, r) => a + r.stars, 0) / Math.max(1, served);
    const five = this.history.filter((r) => r.stars === 5).length;
    const id = this.satisfaction >= 70 && avg >= 3.8 ? 'A' : this.satisfaction >= 35 ? 'B' : 'C';
    const end = ENDINGS.find((e) => e.id === id)!;
    const best = load<{ ending?: string; endlessDays?: number }>(BEST_KEY) ?? {};
    const rank = { A: 3, B: 2, C: 1 } as Record<string, number>;
    const prevId = ENDINGS.find((e) => e.title === best.ending)?.id ?? 'Z';
    if ((rank[id] ?? 0) > (rank[prevId] ?? 0)) best.ending = end.title;
    store(BEST_KEY, best);
    const storyStars = (s: string) => Math.max(0, ...this.history.filter((r) => r.story === s).map((r) => r.stars));
    const lastStars = (s: string) => {
      const hs = this.history.filter((r) => r.story === s);
      return hs.length ? hs[hs.length - 1].stars : 0;
    };
    const epi: string[] = [];
    epi.push(this.flags.nikujaga ? 'イワサキ・ゲンゾウは、今日も配膳口で「いつもの」を頼む。' : 'イワサキ・ゲンゾウは、あの料理の名前を、まだ思い出せずにいる。');
    epi.push(lastStars('mina') >= 4 ? 'ミナの自由帳には、ロウソクの立った三角のケーキと、白いアームの絵が描かれている。' : 'ミナは今日も、絵本の料理を指でなぞっている。');
    epi.push(storyStars('sato') >= 4 ? 'サトウ・ケンジは昼の仕事に就いた。夕方、配膳口で「とりあえず」を頼むのが日課になった。' : 'サトウ・ケンジは、また夜勤に戻ったらしい。');
    epi.push(storyStars('hirano') >= 4 ? 'ヒラノ・サチコの料理書の余白に、一行だけ書き足された。「MEAL-7 の〜風：可」' : 'ヒラノ・サチコは、料理書を閉じたままだ。');
    epi.push(lastStars('nezumi') >= 4 ? '「ネズミ」の消息は不明。ただ、街の外れで湯気の立つ屋台を見た、という噂がある。' : '「ネズミ」の消息は不明。');
    this.save();
    store(SAVE_KEY, { v: 1, day: 8, satisfaction: Math.max(this.satisfaction, 40), flags: this.flags, history: this.history.slice(-200), seed: this.seed, endless: true } satisfies SaveData);
    this.screens.showEnding({
      title: end.title,
      lines: end.lines,
      epilogue: epi,
      stats: [
        { label: '提供数', value: String(served) },
        { label: '平均評価', value: `★${avg.toFixed(1)}` },
        { label: '最終満足度', value: String(Math.round(this.satisfaction)) },
        { label: '★5 の数', value: String(five) },
      ],
      onEndless: () => {
        this.audio.click();
        this.screens.close('ending');
        this.endless = true;
        this.day = 8;
        this.satisfaction = Math.max(this.satisfaction, 40);
        this.ui.showHUD(true);
        this.ui.setSatisfaction(this.satisfaction);
        this.beginDay();
      },
      onTitle: () => {
        this.audio.click();
        this.screens.close('ending');
        this.showTitle();
      },
    });
  }

  // ───────────── チュートリアル ─────────────

  private tutorial(ev: string): void {
    if (this.endless) return;
    const first = this.day === 1 && this.customerIdx === 0;
    if (ev === 'ordered') {
      if (first) {
        this.tutorialStage = 0;
        this.ui.tip('市民の注文を解析しました。<b>光っている言葉（キーワード）</b>を押すと、レシピDB で検索できます。まず「ハンバーグ」を押してみましょう。', '.dialog', 'right');
      } else if (this.day === 2 && this.customerIdx === 0) {
        this.ui.tip('今日から<b>質問</b>ができます。温度・形・味などを尋ねると、答えもキーワードになります（市民の忍耐を消費）。', '.dlg-q', 'right');
      } else if (this.day === 3 && this.customerIdx === 0) {
        this.ui.tip('<b>欠品</b>の日です。レシピDB には自動で<b>代替配合</b>が表示されます。オレンジ色のキーワードは<b>要望</b>で、指示書の要望メモに記録されます。', '.ordercard', 'left');
      } else if (this.day === 4 && this.customerIdx === 0) {
        this.ui.tip('ID カードに<b style="color:#b3261e">アレルギー</b>が書かれている市民がいます。その素材は使わないこと。', '.citizen', 'right');
      } else if (this.day === 5 && this.customerIdx === 2) {
        this.ui.tip('レシピDB に無い料理です。<b>素材図鑑</b>で素材の「役割」を調べ、記憶から配合を組み立てましょう。質問も使えます。', '.dialog', 'right');
      }
      return;
    }
    if (!first || this.tutorialStage < 0) return;
    const steps: Record<string, [number, string, string, 'top' | 'bottom' | 'left' | 'right']> = {
      db: [1, 'レシピのカードを押して詳細を開き、<b>「📌 指示書に固定」</b>を押します。', '.drawer', 'left'],
      pinned: [2, '右上の<b>指示書</b>どおりに作ります。まず素材を投入。下のボタンか、<b>タンクを直接クリック</b>。', '.console', 'right'],
      form: [3, '<b>「指示書」</b>の印がついた形を選ぶと、成形プレスが動きます。', '.console', 'right'],
      heat: [4, '<b>🔥加熱</b>を長押し。針が<b>「目標」</b>の帯に入ったら離します。行き過ぎると<b>焦げます</b>。', '.console', 'right'],
      top: [5, '仕上げを選びます。指示書の印のものを。', '.console', 'right'],
      vessel: [6, '器を選ぶと、アームが盛り付けます。', '.console', 'right'],
      serve: [7, '準備ができたら<b>「提供する」</b>。市民が食べて評価します。', '.console', 'right'],
    };
    if (ev === 'done') {
      this.tutorialStage = -1;
      this.ui.clearTip();
      this.ui.toast('市民満足度が 0 になると、MEAL-7 は廃棄処分です。', 'warn', 4200);
      return;
    }
    if (ev === 'ing' && this.tutorialStage === 2) {
      const t = this.target();
      if (t && Object.entries(t.ing).every(([id, n]) => this.build.ing[id as IngId] === n)) {
        this.tutorialStage = 3;
        this.ui.tip('指示書の素材がそろいました。<b>「成形へ ▶」</b>を押します。', '.console .next', 'right');
      }
      return;
    }
    const s = steps[ev];
    if (!s) return;
    if (s[0] >= this.tutorialStage) {
      this.tutorialStage = s[0];
      this.ui.tip(s[1], s[2], s[3]);
    }
  }

  // ───────────── 入力 ─────────────

  private bindInput(stageEl: HTMLElement): void {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.audio.init();
      const k = e.key;
      if (k === 'Escape') {
        if (this.ui.db.isOpen) this.ui.db.close();
        else this.togglePause();
        e.preventDefault();
        return;
      }
      if (k === 'm' || k === 'M') {
        this.toggleMute();
        return;
      }
      if (this.paused) return;
      if (k === 'Tab') {
        e.preventDefault();
        if (this.phase === 'cook' || this.phase === 'order') this.ui.db.toggle();
        return;
      }
      if (k === 'Enter') {
        if (this.screens.isOpen('rating')) (document.querySelector('.rating .next') as HTMLButtonElement | null)?.click();
        else if (this.screens.isOpen('notice')) (document.querySelector('.notice .go') as HTMLButtonElement | null)?.click();
        else if (this.ui.isTyping) this.ui.skipTyping();
        else this.next();
        e.preventDefault();
        return;
      }
      if (k === ' ') {
        if (this.ui.isTyping) {
          this.ui.skipTyping();
          e.preventDefault();
        }
        return;
      }
      if (k === 'z' || k === 'Z' || k === 'Backspace') {
        this.undo();
        return;
      }
      if (!e.repeat && (k === 'a' || k === 'A' || k === 'ArrowLeft')) this.keyHeat = -1;
      if (!e.repeat && (k === 'd' || k === 'D' || k === 'ArrowRight')) this.keyHeat = 1;
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key;
      if ((k === 'a' || k === 'A' || k === 'ArrowLeft') && this.keyHeat === -1) this.keyHeat = 0;
      if ((k === 'd' || k === 'D' || k === 'ArrowRight') && this.keyHeat === 1) this.keyHeat = 0;
    });
    window.addEventListener('blur', () => {
      this.keyHeat = 0;
      this.heatDir = 0;
    });
    stageEl.addEventListener('pointerdown', () => this.audio.init());
    stageEl.addEventListener('click', (e) => {
      const id = this.world.pickTank(e.clientX, e.clientY);
      if (id && this.phase === 'cook' && this.step === 'ing') this.addIngredient(id);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.isPlaying() && !this.paused) this.togglePause();
    });
  }

  private isPlaying(): boolean {
    return ['order', 'cook', 'arrive', 'serving', 'eating'].includes(this.phase);
  }

  private hoverTank(x: number, y: number): void {
    this.lastPointer = { x, y };
    if (this.phase === 'title' || this.paused) {
      this.world.tanks.setHover(null);
      this.ui.showTankTip(null, 0, 0);
      return;
    }
    const id = this.world.pickTank(x, y);
    this.world.tanks.setHover(id);
    const canvas = this.world.stage.renderer.domElement;
    canvas.style.cursor = id && this.phase === 'cook' && this.step === 'ing' ? 'pointer' : '';
    const note = id && this.dayDef.shortages.includes(id) ? '本日欠品' : id && this.phase === 'cook' && this.step === 'ing' ? 'クリックで投入' : '';
    this.ui.showTankTip(id, x, y - 12, note);
  }

  private onDB(open: boolean): void {
    // タイトル画面では、引き出しとタイトル文字のあいだに料理が見えるよう中央へ戻す
    if (this.phase === 'title') this.world.stage.setViewShift(open ? 0 : this.titleViewShift());
    else this.world.stage.setViewShift(open ? Math.min(230, window.innerWidth * 0.18) : 0);
    this.audio.whoosh();
  }

  togglePause(): void {
    if (!this.isPlaying() && !this.paused) return;
    this.paused = !this.paused;
    if (this.paused) {
      this.heatDir = 0;
      this.keyHeat = 0;
      this.audio.setHeatSound(0, 0);
      this.screens.showPause({
        onResume: () => this.togglePause(),
        onSettings: () => this.openSettings(),
        onHelp: () => this.screens.showHelp(() => {}),
        onTitle: () => {
          this.paused = false;
          this.screens.close('pause');
          if (this.served) this.served = null;
          this.world.customer?.dispose();
          this.world.customer = null;
          void this.world.discard();
          this.showTitle();
        },
      });
    } else {
      this.screens.close('pause');
      this.screens.close('settings');
      this.screens.close('help');
    }
  }

  private toggleMute(): void {
    this.audio.init();
    this.audio.setMuted(!this.audio.muted);
    this.ui.setMuted(this.audio.muted);
  }

  private openSettings(): void {
    this.screens.showSettings(
      this.settings,
      (s) => {
        if (s.quality !== this.settings.quality) this.qualityTouched = true;
        this.settings = s;
        this.applySettings();
        store(SETTINGS_KEY, { ...s, qualityTouched: this.qualityTouched });
      },
      () => {},
    );
  }

  private applySettings(): void {
    this.audio.setVolumes(this.settings.master, this.settings.music, this.settings.sfx);
    if (this.world.stage.quality !== this.settings.quality) this.world.stage.setQuality(this.settings.quality);
    this.ui.setPatience(this.order ? this.order.patience / this.order.patienceMax : 1, this.settings.relaxed);
  }

  // ───────────── 毎フレーム ─────────────

  update(dt: number): void {
    // 画質の自動調整（最初の数秒の平均で判断）
    // 実時間で測る（dt は開発用の倍速がかかることがある）
    const nowMs = performance.now();
    const realDt = this.lastFrameMs ? Math.min(0.2, (nowMs - this.lastFrameMs) / 1000) : 0.016;
    this.lastFrameMs = nowMs;
    if (!this.qualityTouched && this.isPlaying() && !document.hidden && this.frameTimes.length < 240) {
      this.frameTimes.push(realDt);
      if (this.frameTimes.length === 240) {
        const avg = this.frameTimes.reduce((a, b) => a + b, 0) / 240;
        if (avg > 0.03 && this.settings.quality === 'high') {
          this.settings.quality = 'mid';
          this.applySettings();
          this.ui.toast('描画が重いため、画質を「中」に下げました（設定で変更できます）', 'warn', 4000);
        } else if (avg > 0.045 && this.settings.quality === 'mid') {
          this.settings.quality = 'low';
          this.applySettings();
        }
      }
    }
    if (this.paused) return;

    const o = this.order;
    // 忍耐
    if (o && (this.phase === 'cook' || (this.phase === 'order' && !this.talking)) && !this.settings.relaxed) {
      o.patience -= dt;
      const r = o.patience / o.patienceMax;
      this.ui.setPatience(r, false);
      const c = this.world.customer;
      if (c && !this.talking) {
        if (r < 0.25 && c.mood !== 'angry') c.setMood('angry');
        else if (r < 0.5 && r >= 0.25 && c.mood === 'neutral') c.setMood('think');
      }
      this.waitLineT -= dt;
      if (r < 0.45 && this.waitLineT <= 0 && !this.talking && this.phase === 'cook') {
        this.waitLineT = 28;
        void this.speak(pick(this.rng, WAIT_LINES[o.citizen.personality]));
        c?.showEmote('💢', '#ff7a5a', 1.4);
      }
      if (o.patience <= 0 && this.served && this.phase === 'cook') {
        this.served('timeout');
      }
    }

    // 温度
    const dir = (this.heatDir || this.keyHeat) as -1 | 0 | 1;
    if (this.phase === 'cook' && this.step === 'heat' && this.world.food) {
      if (dir !== 0) {
        this.build.temp = Math.max(TEMP_MIN, Math.min(TEMP_MAX, this.build.temp + dir * HEAT_RATE * dt));
        this.build.heated = true;
        if (this.build.temp > BURN_AT && !this.burntWarned) {
          this.burntWarned = true;
          this.audio.buzz();
          this.world.stage.addShake(0.3);
          this.ui.toast('焦げた！（廃棄してやり直すこともできます）', 'bad');
        }
        this.refreshHeatCard();
      }
      this.world.setTemp(this.build.temp, dir !== 0 ? 1 : 0);
      this.ui.setHeat(this.build.temp, dir);
      this.audio.setHeatSound(dir, this.build.temp);
    }

    // 料理の推定ラベル
    const food = this.world.food;
    if (!food || !(this.phase === 'cook' || this.phase === 'serving')) this.ui.setFloatLabel(0, 0, false);
    if (food && (this.phase === 'cook' || this.phase === 'serving') && this.build.form) {
      const p = this.world.project(this.world.foodAnchor());
      this.labelRefresh -= dt;
      if (this.labelRefresh <= 0) {
        this.labelRefresh = 0.25;
        const pool = this.availableRecipes();
        const f = buildToFormula(this.build);
        const id = identify(f, pool);
        const burnt = this.build.temp > BURN_AT;
        this.ui.setFloatLabel(p.x, p.y, p.visible, burnt ? `焦げた${id.recipe?.name ?? '何か'}` : id.recipe?.name ?? '', id.recipe ? similarity(f, id.recipe) - (burnt ? 30 : 0) : undefined);
      } else this.ui.setFloatLabel(p.x, p.y, p.visible);
    }

    // 満足度が低いときの警報
    const alarm = (this.phase === 'cook' || this.phase === 'order') && this.satisfaction < 20 ? 1 : 0;
    this.alarmLevel += (alarm - this.alarmLevel) * Math.min(1, dt * 2);
    this.world.stage.final.uniforms.uAlarm.value = this.alarmLevel * 0.6;
    this.world.kitchen.setAlarm(alarm);

    // マウスの下のタンク
    if (this.phase === 'cook' && this.step === 'ing') {
      // ポインタが動かなくても、カメラが動けば当たり判定が変わる
      if (Math.random() < 0.1) this.hoverTank(this.lastPointer.x, this.lastPointer.y);
    }
    // 客の視線：調理中はステージ、それ以外はカメラ
    const c = this.world.customer;
    if (c && this.phase === 'cook' && !this.talking) {
      const tgt = this.world.food ? this.world.food.topWorld() : new THREE.Vector3(0, 1.3, 0.42);
      c.lookAt.lerp(tgt, Math.min(1, dt * 2));
    } else if (c && (this.phase === 'order' || this.talking)) {
      c.lookAt.lerp(this.world.stage.camera.position, Math.min(1, dt * 3));
    }
  }

  private refreshHeatCard(): void {
    // 温度の行だけ頻繁に変わるので、ゾーンが変わったときだけ指示書を描き直す
    const z = this.build.temp > BURN_AT ? 'burnt' : heatFromTemp(this.build.temp);
    if (z !== this.lastZone) {
      this.lastZone = z;
      this.refreshOrderCard();
    }
  }
  private lastZone = '';
}
