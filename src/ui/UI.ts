import type { Build, FormId, Formula, IngId, ModifierId, QuestionId, Recipe, VesselId } from '../data/types.ts';
import type { Citizen, Look } from '../data/characters.ts';
import { ING, INGREDIENTS } from '../data/ingredients.ts';
import { FORMS, HEATS, VESSELS, FORM, HEAT, VESSEL, TEMP_MIN, TEMP_MAX, BURN_AT, heatFromTemp } from '../data/processes.ts';
import { MODIFIERS } from '../data/modifiers.ts';
import { QUESTION_DEFS } from '../data/days.ts';
import { PROPAGANDA } from '../data/lines.ts';
import { parseMarkup } from '../sim/orders.ts';
import { RecipeDB, esc } from './RecipeDB.ts';
import { FORM_ICON, VESSEL_ICON, ICON } from './icons.ts';

export type Step = 'ing' | 'form' | 'heat' | 'top' | 'vessel' | 'serve';
export const STEPS: { id: Step; label: string }[] = [
  { id: 'ing', label: '素材' },
  { id: 'form', label: '成形' },
  { id: 'heat', label: '温度' },
  { id: 'top', label: '仕上げ' },
  { id: 'vessel', label: '器' },
  { id: 'serve', label: '提供' },
];

export interface UIHandlers {
  onIngredient(id: IngId): void;
  onUndo(): void;
  onNext(): void;
  onForm(f: FormId): void;
  onHeatHold(dir: -1 | 0 | 1): void;
  onTopping(id: IngId | null): void;
  onVessel(v: VesselId): void;
  onServe(): void;
  onDiscard(): void;
  onQuestion(q: QuestionId): void;
  onKeyword(key: string, value: string): void;
  onPin(id: string): void;
  onMemoAdd(m: ModifierId): void;
  onMemoRemove(m: ModifierId): void;
  onPause(): void;
  onMute(): void;
  onDBToggle(open: boolean): void;
  onTankHover(id: IngId | null, x: number, y: number): void;
  onSkipText(): void;
}

export interface OrderCardCtx {
  recipe: Recipe | null;
  /** 欠品・要望メモを反映した目標 */
  target: Formula | null;
  substituted: boolean;
  build: Build;
  step: Step;
  memo: ModifierId[];
}

export const MAX_UNITS = 6;
const MEMO_CHOICES: ModifierId[] = ['spicy', 'nospicy', 'sweet', 'lesssweet', 'nekojita', 'atsuatsu', 'oomori', 'sukuname', 'nosauce', 'yasai', 'allergy_yellow', 'allergy_milk', 'allergy_brown'];

function stepIndex(s: Step): number {
  return STEPS.findIndex((x) => x.id === s);
}

/** 見出しをタップして畳めるパネル */
type FoldKey = 'citizen' | 'order' | 'dialog';
/** スマホ・縦向きのタブレットなど（パネルを小さくまとめる）。style.css の同じ条件と合わせる */
const COMPACT_QUERY = '(max-width: 600px), (max-height: 520px), (orientation: portrait) and (max-width: 900px)';

/** 3D が見えている領域（CSS px） */
export interface FocusRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
const CHEV = '<span class="chev" aria-hidden="true"></span>';

export class UI {
  readonly root: HTMLElement;
  readonly db: RecipeDB;
  private h: UIHandlers;
  private hud!: HTMLElement;
  private satBar!: HTMLElement;
  private satNum!: HTMLElement;
  private satDelta!: HTMLElement;
  private dayEl!: HTMLElement;
  private tickerTrack!: HTMLElement;
  private tickerX = 0;
  private citizenEl!: HTMLElement;
  private patienceEl!: HTMLElement;
  private dialogEl!: HTMLElement;
  private logEl!: HTMLElement;
  private qEl!: HTMLElement;
  private orderEl!: HTMLElement;
  private consoleEl!: HTMLElement;
  private floatEl!: HTMLElement;
  private tankTip!: HTMLElement;
  private toastsEl!: HTMLElement;
  private tipEl: HTMLElement | null = null;
  private tipTarget: HTMLElement | null = null;
  private muteBtn!: HTMLButtonElement;
  private typing: { resolve: () => void; skip: () => void } | null = null;
  private needle: HTMLElement | null = null;
  private readout: HTMLElement | null = null;
  private heatBtns: HTMLElement[] = [];
  private memoOpen = false;
  step: Step = 'ing';
  private lastOrderCtx: OrderCardCtx | null = null;
  private discardArmed = false;
  /** 畳んだパネル。スマホでは市民照会と指示書を最初から畳む（見出しのタップで開閉） */
  private fold: Record<FoldKey, boolean> = { citizen: false, order: false, dialog: false };
  private foldTouched: Record<FoldKey, boolean> = { citizen: false, order: false, dialog: false };
  private compactMQ = window.matchMedia(COMPACT_QUERY);
  private focus: FocusRect | null = null;
  private focusT = 0;

  constructor(root: HTMLElement, handlers: UIHandlers) {
    this.root = root;
    this.h = handlers;
    this.buildHUD();
    this.buildCitizen();
    this.buildDialog();
    this.buildOrderCard();
    this.buildConsole();
    this.floatEl = this.div('float-label hidden');
    this.tankTip = this.div('tank-tip hidden');
    this.toastsEl = this.div('toasts');
    this.db = new RecipeDB(root);
    this.db.onPin = (id) => this.h.onPin(id);
    this.db.onToggle = (open) => this.h.onDBToggle(open);
    this.bindTankHover();
    this.bindFold(this.citizenEl, 'citizen');
    this.bindFold(this.orderEl, 'order');
    this.bindFold(this.dialogEl, 'dialog');
    this.applyFoldDefaults();
    this.compactMQ.addEventListener('change', () => this.applyFoldDefaults());
  }

  /** スマホなど狭い画面か */
  get compact(): boolean {
    return this.compactMQ.matches;
  }

  private applyFoldDefaults(): void {
    const c = this.compact;
    if (!this.foldTouched.citizen) this.fold.citizen = c;
    if (!this.foldTouched.order) this.fold.order = c;
    this.applyFold();
  }

  private applyFold(): void {
    this.citizenEl.classList.toggle('folded', this.fold.citizen);
    this.orderEl.classList.toggle('folded', this.fold.order);
    this.dialogEl.classList.toggle('folded', this.fold.dialog);
  }

  /** 見出しのタップで開閉（中身は作り直されても、パネル本体で受ける） */
  private bindFold(el: HTMLElement, key: FoldKey): void {
    el.addEventListener('click', (e) => {
      const head = (e.target as HTMLElement).closest('.panel-head');
      if (!head || !el.contains(head)) return;
      this.fold[key] = !this.fold[key];
      this.foldTouched[key] = true;
      this.applyFold();
      if (key === 'dialog' && !this.fold.dialog) this.scrollLog();
    });
  }

  /**
   * スマホなどで、まわりのパネルに囲まれて 3D が見えている領域（CSS px）。
   * カメラはこの領域の中央に注目点が来るようにずらす。広い画面では null（画面の中央のまま）
   */
  focusRect(): FocusRect | null {
    return this.focus;
  }

  private measureFocus(): FocusRect | null {
    if (!this.compact) return null;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const f: FocusRect = { left: 0, right: W, top: this.hud.classList.contains('hidden') ? 0 : this.hud.getBoundingClientRect().bottom, bottom: H };
    const els = [this.citizenEl, this.orderEl, this.dialogEl, this.consoleEl, this.root.querySelector<HTMLElement>('.rating'), this.db.isOpen ? this.db.el : null];
    for (const el of els) {
      if (!el || el.classList.contains('off')) continue;
      // 開いた市民照会・指示書は一時的に重ねて読むものなので数えない（開くたびに画面が動かないように）
      if ((el === this.citizenEl || el === this.orderEl) && !el.classList.contains('folded')) continue;
      const r = el.getBoundingClientRect();
      if (r.height <= 0 || r.width <= 0) continue;
      // 横向きの右側に縦長に置かれたもの（操作盤・評価・レシピDB）は右端を狭める。それ以外は上下を狭める
      if (r.left > W * 0.4 && r.height > H * 0.5) f.right = Math.min(f.right, r.left);
      else if (r.top + r.height / 2 < H / 2) f.top = Math.max(f.top, r.bottom);
      else f.bottom = Math.min(f.bottom, r.top);
    }
    return f.bottom - f.top > 80 && f.right - f.left > 120 ? f : null;
  }

  private div(cls: string, html = ''): HTMLElement {
    const d = document.createElement('div');
    d.className = cls;
    d.innerHTML = html;
    this.root.appendChild(d);
    return d;
  }

  // ───────────── HUD ─────────────

  private buildHUD(): void {
    this.hud = this.div(
      'hud-top hidden',
      `<div class="hud-day"><span class="canteen">第7配給食堂</span><b class="dn">DAY 1</b><span class="title"></span><span class="count"></span></div>
       <div class="ticker"><div class="ticker-track"></div></div>
       <div class="hud-sat"><label>市民満足度</label><div class="sat-bar"><i></i><em></em></div><b>50</b><span class="delta"></span></div>
       <button class="icon-btn mute" title="音 (M)">${ICON.sound}</button>
       <button class="icon-btn pause" title="一時停止 (Esc)">${ICON.pause}</button>`,
    );
    this.satBar = this.hud.querySelector('.sat-bar')!;
    this.satNum = this.hud.querySelector('.hud-sat b')!;
    this.satDelta = this.hud.querySelector('.hud-sat .delta')!;
    this.dayEl = this.hud.querySelector('.hud-day')!;
    this.tickerTrack = this.hud.querySelector('.ticker-track')!;
    this.muteBtn = this.hud.querySelector('.mute')!;
    this.muteBtn.addEventListener('click', () => this.h.onMute());
    this.hud.querySelector('.pause')!.addEventListener('click', () => this.h.onPause());
    const items = [...PROPAGANDA].sort(() => Math.random() - 0.5);
    this.tickerTrack.innerHTML = items.map((p) => `<span>${esc(p)}</span>`).join('') + items.map((p) => `<span>${esc(p)}</span>`).join('');
    this.tickerX = 0;
  }

  setMuted(m: boolean): void {
    this.muteBtn.innerHTML = m ? ICON.mute : ICON.sound;
  }

  showHUD(on: boolean): void {
    this.hud.classList.toggle('hidden', !on);
  }

  setDay(day: number, title: string, idx: number, total: number, endless = false): void {
    (this.dayEl.querySelector('.dn') as HTMLElement).textContent = `DAY ${day}`;
    (this.dayEl.querySelector('.title') as HTMLElement).textContent = endless ? `自由営業` : title;
    (this.dayEl.querySelector('.count') as HTMLElement).textContent = endless ? `市民 ${idx}` : `市民 ${Math.min(idx, total)}/${total}`;
  }

  setSatisfaction(v: number, delta = 0): void {
    const c = Math.max(0, Math.min(100, v));
    (this.satBar.querySelector('i') as HTMLElement).style.width = `${c}%`;
    this.satBar.classList.toggle('warn', c < 40 && c >= 20);
    this.satBar.classList.toggle('danger', c < 20);
    this.satNum.textContent = String(Math.round(c));
    this.satNum.style.color = c < 20 ? 'var(--red)' : c < 40 ? 'var(--amber)' : 'var(--text)';
    if (delta) {
      this.satDelta.textContent = delta > 0 ? `+${delta}` : String(delta);
      this.satDelta.style.color = delta > 0 ? 'var(--green)' : 'var(--red)';
      this.satDelta.classList.add('show');
      setTimeout(() => this.satDelta.classList.remove('show'), 2200);
    }
  }

  // ───────────── 市民カード ─────────────

  private buildCitizen(): void {
    this.citizenEl = this.div('panel citizen off', '');
  }

  showCitizen(c: Citizen | null, allergy: ModifierId | null, relaxed: boolean): void {
    if (!c) {
      this.citizenEl.classList.add('off');
      return;
    }
    const allergyText = allergy ? MODIFIERS[allergy].card : null;
    this.citizenEl.innerHTML = `
      <div class="panel-head" title="タップで開閉"><span>CITIZEN ID</span><span class="spacer"></span><span class="jp">市民照会</span>${CHEV}</div>
      <div class="idcard">
        <div class="avatar"><canvas width="108" height="128"></canvas></div>
        <div>
          <div class="name">${esc(c.name)}</div>
          <div class="num">No.${esc(c.number)}${c.age ? ` / ${c.age}歳` : ''}</div>
          <div class="job">${esc(c.job)}</div>
        </div>
        ${c.note ? `<div class="note">備考：${esc(c.note)}</div>` : ''}
        ${allergyText ? `<div class="allergy flash">⚠ アレルギー：${esc(allergyText)}</div>` : ''}
      </div>
      <div class="patience${relaxed ? ' relaxed' : ''}"><div class="row"><span>忍耐</span><span class="pt">${relaxed ? 'のんびりモード' : ''}</span></div><div class="bar"><i></i></div></div>`;
    this.patienceEl = this.citizenEl.querySelector('.patience')!;
    drawPortrait(this.citizenEl.querySelector('canvas')!, c.look);
    this.citizenEl.classList.remove('off');
  }

  setPatience(ratio: number, relaxed: boolean): void {
    if (!this.patienceEl) return;
    const r = Math.max(0, Math.min(1, ratio));
    (this.patienceEl.querySelector('.bar i') as HTMLElement).style.width = `${relaxed ? 100 : r * 100}%`;
    this.patienceEl.classList.toggle('warn', !relaxed && r < 0.5 && r >= 0.25);
    this.patienceEl.classList.toggle('danger', !relaxed && r < 0.25);
    if (!relaxed) (this.patienceEl.querySelector('.pt') as HTMLElement).textContent = r < 0.25 ? 'いらいら' : r < 0.5 ? 'そわそわ' : 'おだやか';
  }

  // ───────────── 会話 ─────────────

  private buildDialog(): void {
    this.dialogEl = this.div(
      'panel dialog off',
      `<div class="panel-head" title="タップで開閉"><span>DIALOGUE</span><span class="spacer"></span><span class="jp">要求ログ</span>${CHEV}</div>
       <div class="dlg-log"></div>
       <div class="dlg-q"><div class="qhead"><span>質問（市民の忍耐を消費）</span><span>残り <b class="ql">0</b></span></div><div class="qbtns"></div></div>`,
    );
    this.logEl = this.dialogEl.querySelector('.dlg-log')!;
    this.qEl = this.dialogEl.querySelector('.dlg-q')!;
    this.logEl.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.classList.contains('kw')) {
        t.classList.add('used');
        this.h.onKeyword(t.dataset.k!, t.dataset.v!);
        return;
      }
      if (this.typing) this.typing.skip();
    });
    const qb = this.qEl.querySelector('.qbtns')!;
    qb.innerHTML = QUESTION_DEFS.map((q) => `<button class="qbtn" data-q="${q.id}" title="${esc(q.ask)}">${q.label}${q.id === 'memory' ? '（重）' : ''}</button>`).join('');
    qb.querySelectorAll<HTMLButtonElement>('.qbtn').forEach((b) => b.addEventListener('click', () => this.h.onQuestion(b.dataset.q as QuestionId)));
  }

  showDialog(on: boolean): void {
    this.dialogEl.classList.toggle('off', !on);
  }

  clearLog(): void {
    this.logEl.innerHTML = '';
  }

  setQuestions(left: number, enabled: boolean, asked: QuestionId[], show: boolean): void {
    this.qEl.classList.toggle('hidden', !show);
    (this.qEl.querySelector('.ql') as HTMLElement).textContent = String(left);
    this.qEl.querySelectorAll<HTMLButtonElement>('.qbtn').forEach((b) => {
      const q = b.dataset.q as QuestionId;
      b.disabled = !enabled || left <= 0 || asked.includes(q);
      b.classList.toggle('asked', asked.includes(q));
    });
  }

  private renderTokens(text: string, upto: number): string {
    const tokens = parseMarkup(text);
    let left = upto;
    let html = '';
    for (const t of tokens) {
      if (left <= 0) break;
      const chars = [...t.text];
      const shown = chars.slice(0, left).join('');
      left -= chars.length;
      if (t.key) {
        const cls = t.key === 'mod' ? 'kw mod' : 'kw';
        html += `<button class="${cls}" data-k="${t.key}" data-v="${esc(t.value!)}">${esc(shown)}</button>`;
      } else html += esc(shown);
    }
    return html;
  }

  /** 1 行を書き出す（市民の台詞はタイプライター） */
  say(kind: 'cit' | 'ai' | 'sys', text: string, opts: { speed?: number; onChar?: (ch: string, i: number) => void } = {}): Promise<void> {
    const el = document.createElement('div');
    el.className = `line ${kind}`;
    this.logEl.appendChild(el);
    const total = [...parseMarkup(text).map((t) => t.text).join('')].length;
    const plainChars = [...parseMarkup(text).map((t) => t.text).join('')];
    if (kind !== 'cit' || !opts.speed) {
      el.innerHTML = this.renderTokens(text, total);
      this.scrollLog();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let i = 0;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.innerHTML = this.renderTokens(text, total);
        this.typing = null;
        this.scrollLog();
        resolve();
      };
      this.typing = { resolve: finish, skip: finish };
      const tick = () => {
        if (done) return;
        i++;
        el.innerHTML = this.renderTokens(text, i) + '<span class="caret">▍</span>';
        opts.onChar?.(plainChars[i - 1] ?? '', i);
        if (i % 6 === 0) this.scrollLog();
        if (i >= total) {
          setTimeout(finish, 120);
          return;
        }
        const ch = plainChars[i - 1];
        const pause = '。！？…'.includes(ch) ? 7 : '、'.includes(ch) ? 3.5 : 1;
        setTimeout(tick, (1000 / opts.speed!) * pause);
      };
      tick();
    });
  }

  skipTyping(): void {
    this.typing?.skip();
  }

  get isTyping(): boolean {
    return !!this.typing;
  }

  private scrollLog(): void {
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  // ───────────── 指示書 ─────────────

  private buildOrderCard(): void {
    this.orderEl = this.div('panel ordercard off', '');
  }

  showOrderCard(on: boolean): void {
    this.orderEl.classList.toggle('off', !on);
  }

  renderOrderCard(ctx: OrderCardCtx): void {
    this.lastOrderCtx = ctx;
    const b = ctx.build;
    const si = stepIndex(ctx.step);
    let body = '';
    // 畳んだときの 1 行（料理名と、配合・工程の進み具合を小さなチップで）
    let mini = `<span class="mn none">未設定</span><span class="mhint">キーワードかレシピDBから</span>`;
    if (!ctx.recipe || !ctx.target) {
      body = `<div class="oc-empty">指示書は未設定です。<br/>会話の<b style="color:var(--cyan)">光るキーワード</b>や<br/>レシピDB からレシピを選んで固定してください。</div>`;
    } else {
      const t = ctx.target;
      const rows: string[] = [];
      const chips: string[] = [];
      const ids = new Set<IngId>([...(Object.keys(t.ing) as IngId[]), ...(Object.keys(b.ing) as IngId[]).filter((id) => b.ing[id] > 0)]);
      for (const id of INGREDIENTS.map((i) => i.id)) {
        if (!ids.has(id)) continue;
        const need = t.ing[id] ?? 0;
        const have = b.ing[id] ?? 0;
        const cls = need === 0 ? 'extra' : have === need ? 'ok' : have > need ? 'ng' : '';
        const count = need === 0 ? `+${have}` : `${have}/${need}`;
        rows.push(
          `<li class="${cls}"><span class="k">素材</span><span><i class="swatch" style="background:${ING[id].color}"></i>${ING[id].name}${need ? ` ×${need}` : ''}</span><span class="st">${count}</span></li>`,
        );
        chips.push(`<span class="mc ${cls === 'extra' ? 'ng' : cls}" title="${esc(ING[id].name)}"><i class="swatch" style="background:${ING[id].color}"></i>${count}</span>`);
      }
      const formDone = si > 0 && b.form;
      const formCls = formDone ? (b.form === t.form ? 'ok' : 'ng') : '';
      rows.push(`<li class="${formCls}"><span class="k">成形</span><span>${FORM[t.form].name}</span><span class="st">${formDone ? (b.form === t.form ? '✓' : FORM[b.form!].name) : '—'}</span></li>`);
      chips.push(`<span class="mc ${formCls}">${FORM[t.form].name}</span>`);
      const curHeat = b.temp > BURN_AT ? null : heatFromTemp(b.temp);
      const heatTouched = si >= 2;
      const heatCls = heatTouched ? (b.temp > BURN_AT ? 'ng' : curHeat === t.heat ? 'ok' : '') : '';
      rows.push(
        `<li class="${heatCls}"><span class="k">温度</span><span>${HEAT[t.heat].name}</span><span class="st">${heatTouched ? (b.temp > BURN_AT ? '焦げ' : curHeat === t.heat ? '✓' : HEAT[curHeat!].name) : '—'}</span></li>`,
      );
      chips.push(`<span class="mc ${heatCls}">${HEAT[t.heat].name}</span>`);
      const topDone = si > 3;
      const topCls = topDone ? (b.topping === t.topping ? 'ok' : 'ng') : '';
      rows.push(
        `<li class="${topCls}"><span class="k">仕上げ</span><span>${t.topping ? `<i class="swatch" style="background:${ING[t.topping].color}"></i>${ING[t.topping].name}` : 'なし'}</span><span class="st">${topDone ? (b.topping === t.topping ? '✓' : b.topping ? ING[b.topping].name.slice(0, 3) : 'なし') : '—'}</span></li>`,
      );
      chips.push(`<span class="mc ${topCls}">${t.topping ? `<i class="swatch" style="background:${ING[t.topping].color}"></i>仕上` : '仕上なし'}</span>`);
      const vDone = si > 4 && b.vessel;
      const vCls = vDone ? (b.vessel === t.vessel ? 'ok' : 'ng') : '';
      rows.push(`<li class="${vCls}"><span class="k">器</span><span>${VESSEL[t.vessel].name}</span><span class="st">${vDone ? (b.vessel === t.vessel ? '✓' : VESSEL[b.vessel!].name) : '—'}</span></li>`);
      chips.push(`<span class="mc ${vCls}">${VESSEL[t.vessel].name}</span>`);
      body = `<div class="oc-name">${esc(ctx.recipe.name)}${ctx.substituted ? '<span class="badge sub">代替配合</span>' : ''}</div>
        <ul class="checklist">${rows.join('')}</ul>
        ${ctx.substituted ? '<div class="oc-sub">欠品素材を代替配合に置き換えています。</div>' : ''}`;
      mini = `<span class="mn">${esc(ctx.recipe.name)}${ctx.substituted ? '<span class="badge sub">代替</span>' : ''}</span><span class="mchips">${chips.join('')}</span>`;
    }
    const memoCount = ctx.memo.length ? `<span class="mc memo-n">要望 ${ctx.memo.length}</span>` : '';
    const memo = `<div class="memo">
        <div class="mh"><span>要望メモ（目標に反映）</span><button class="memo-add">＋ 追加</button></div>
        <div class="memo-list">${ctx.memo.length ? ctx.memo.map((m) => `<span class="memo-item" title="${esc(MODIFIERS[m].howto)}">${esc(MODIFIERS[m].label)}：${esc(MODIFIERS[m].howto)}<button data-rm="${m}">✕</button></span>`).join('') : '<span style="color:var(--faint);font-size:0.85em">なし</span>'}</div>
        ${this.memoOpen ? `<div class="memo-pick">${MEMO_CHOICES.filter((m) => !ctx.memo.includes(m)).map((m) => `<button data-add="${m}">${esc(MODIFIERS[m].label)}</button>`).join('')}</div>` : ''}
      </div>`;
    this.orderEl.innerHTML = `
      <div class="panel-head" title="タップで開閉"><span>ORDER SHEET</span><span class="spacer"></span><span class="jp">指示書</span>${CHEV}</div>
      <div class="oc-mini">${mini}${memoCount}<button class="btn mini-db" title="レシピDB">${ICON.book}</button></div>
      <div class="oc-body">${body}${memo}
        <div class="oc-actions"><button class="btn db-open">${ICON.book} レシピDB <span class="kbd">Tab</span></button></div>
      </div>`;
    this.orderEl.querySelector('.db-open')!.addEventListener('click', () => this.db.toggle());
    this.orderEl.querySelector('.mini-db')!.addEventListener('click', () => this.db.toggle());
    this.orderEl.querySelector('.memo-add')!.addEventListener('click', () => {
      this.memoOpen = !this.memoOpen;
      this.renderOrderCard(ctx);
    });
    this.orderEl.querySelectorAll<HTMLButtonElement>('[data-rm]').forEach((btn) => btn.addEventListener('click', () => this.h.onMemoRemove(btn.dataset.rm as ModifierId)));
    this.orderEl.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((btn) =>
      btn.addEventListener('click', () => {
        this.memoOpen = false;
        this.h.onMemoAdd(btn.dataset.add as ModifierId);
      }),
    );
  }

  refreshOrderCard(build?: Build): void {
    if (this.lastOrderCtx) this.renderOrderCard({ ...this.lastOrderCtx, build: build ?? this.lastOrderCtx.build, step: this.step });
  }

  // ───────────── 調理コンソール ─────────────

  private buildConsole(): void {
    this.consoleEl = this.div(
      'panel console off',
      `<div class="steps">${STEPS.map((s, i) => `<div class="s" data-s="${s.id}"><b>${i + 1}</b>${s.label}</div>`).join('')}</div>
       <div class="c-body"><div class="c-main"></div><div class="c-side"></div></div>`,
    );
  }

  showConsole(on: boolean): void {
    this.consoleEl.classList.toggle('off', !on);
  }

  lockConsole(on: boolean): void {
    this.consoleEl.classList.toggle('locked', on);
  }

  setStep(step: Step, build: Build, target: Formula | null, shortages: IngId[]): void {
    this.step = step;
    this.discardArmed = false;
    const si = stepIndex(step);
    this.consoleEl.querySelectorAll<HTMLElement>('.steps .s').forEach((el, i) => {
      el.classList.toggle('cur', i === si);
      el.classList.toggle('done', i < si);
    });
    const main = this.consoleEl.querySelector('.c-main') as HTMLElement;
    const side = this.consoleEl.querySelector('.c-side') as HTMLElement;
    this.needle = null;
    this.readout = null;
    this.heatBtns = [];
    const discardBtn = `<button class="btn danger discard">${ICON.trash} 廃棄</button>`;
    const units = Object.values(build.ing).reduce((a, b) => a + b, 0);
    switch (step) {
      case 'ing': {
        main.innerHTML = `<div class="c-hint"><span>素材を投入 <b>${units}/${MAX_UNITS}</b>　（タンクを直接押してもOK）</span><span class="keys">取り消し <span class="kbd">Z</span></span></div>
          <div class="grid-ing">${INGREDIENTS.map((i) => {
            const n = build.ing[i.id];
            const short = shortages.includes(i.id);
            return `<button class="ing-btn${short ? ' short' : ''}" data-ing="${i.id}" style="--c:${i.color}" title="${esc(i.name)}（${esc(i.roles)}）"><span class="dot"></span><span class="nm">${esc(i.name)}<span class="cd">${i.code}</span></span>${n ? `<span class="cnt">${n}</span>` : ''}</button>`;
          }).join('')}</div>`;
        side.innerHTML = `<button class="btn undo" ${units ? '' : 'disabled'}>↶ 取り消し</button><button class="btn primary next" ${units ? '' : 'disabled'}>成形へ ▶ <span class="kbd">Enter</span></button>`;
        main.querySelectorAll<HTMLButtonElement>('.ing-btn').forEach((b) => b.addEventListener('click', () => this.h.onIngredient(b.dataset.ing as IngId)));
        side.querySelector('.undo')!.addEventListener('click', () => this.h.onUndo());
        side.querySelector('.next')!.addEventListener('click', () => this.h.onNext());
        break;
      }
      case 'form': {
        main.innerHTML = `<div class="c-hint"><span>成形プレス：形を選ぶ（液体・飲み物は「液状」か「発泡」）</span></div>
          <div class="grid-5">${FORMS.map((f) => `<button class="opt${target?.form === f.id ? ' target' : ''}" data-form="${f.id}" title="${esc(f.hint)}">${FORM_ICON[f.id]}<span>${f.name}</span>${target?.form === f.id ? '<span class="tg">指示書</span>' : ''}</button>`).join('')}</div>`;
        side.innerHTML = discardBtn;
        main.querySelectorAll<HTMLButtonElement>('.opt').forEach((b) => b.addEventListener('click', () => this.h.onForm(b.dataset.form as FormId)));
        break;
      }
      case 'heat': {
        const span = TEMP_MAX - TEMP_MIN;
        const zones = [...HEATS.map((h) => ({ id: h.id as string, name: h.name, min: h.min, max: h.max })), { id: 'burnt', name: '焦げ', min: BURN_AT, max: TEMP_MAX }];
        const colors: Record<string, string> = {
          frozen: '#5a8ad8',
          chilled: '#4aa6c8',
          room: '#4a5a66',
          warm: '#c88a3a',
          hot: '#d8582a',
          burnt: '#3a1a14',
        };
        main.innerHTML = `<div class="heat">
            <button class="heat-btn cool" data-dir="-1">❄ 冷却<small>長押し <span class="kbd">A</span></small></button>
            <div class="gauge">
              <div class="zones">${zones.map((z) => `<div class="z${target?.heat === z.id ? ' target' : ''}" style="width:${((z.max - z.min) / span) * 100}%;background:${colors[z.id]}">${z.name}</div>`).join('')}</div>
              <div class="needle"></div>
              <div class="readout">現在：<b>常温</b></div>
            </div>
            <button class="heat-btn hot" data-dir="1">🔥 加熱<small>長押し <span class="kbd">D</span></small></button>
          </div>`;
        side.innerHTML = `${discardBtn}<button class="btn primary next">仕上げへ ▶ <span class="kbd">Enter</span></button>`;
        this.needle = main.querySelector('.needle');
        this.readout = main.querySelector('.readout b');
        this.heatBtns = [...main.querySelectorAll<HTMLElement>('.heat-btn')];
        for (const btn of this.heatBtns) {
          const dir = Number(btn.dataset.dir) as -1 | 1;
          const start = (e: PointerEvent) => {
            e.preventDefault();
            btn.setPointerCapture(e.pointerId);
            this.h.onHeatHold(dir);
          };
          const stop = () => this.h.onHeatHold(0);
          btn.addEventListener('pointerdown', start);
          btn.addEventListener('pointerup', stop);
          btn.addEventListener('pointercancel', stop);
          btn.addEventListener('lostpointercapture', stop);
          btn.addEventListener('contextmenu', (e) => e.preventDefault());
        }
        side.querySelector('.next')!.addEventListener('click', () => this.h.onNext());
        this.setHeat(build.temp, 0);
        break;
      }
      case 'top': {
        const opts = [
          `<button class="opt${target && target.topping === null ? ' target' : ''}" data-top=""><span class="none"></span><span>なし</span>${target && target.topping === null ? '<span class="tg">指示書</span>' : ''}</button>`,
          ...INGREDIENTS.map((i) => {
            const short = shortages.includes(i.id);
            return `<button class="opt${target?.topping === i.id ? ' target' : ''}" data-top="${i.id}" style="--c:${i.color}" ${short ? 'disabled title="欠品"' : `title="${esc(i.name)}"`}><span class="dot"></span><span style="font-size:0.85em">${esc(i.name.replace(/(キューブ|ペースト|粒子|乳剤|結晶|因子)$/, ''))}</span>${target?.topping === i.id ? '<span class="tg">指示書</span>' : ''}</button>`;
          }),
        ];
        main.innerHTML = `<div class="c-hint"><span>仕上げ：上からかける・のせるもの（汁物の「だし」もここ）</span></div><div class="grid-7">${opts.join('')}</div>`;
        side.innerHTML = discardBtn;
        main.querySelectorAll<HTMLButtonElement>('.opt').forEach((b) => b.addEventListener('click', () => this.h.onTopping((b.dataset.top || null) as IngId | null)));
        break;
      }
      case 'vessel': {
        main.innerHTML = `<div class="c-hint"><span>器を選ぶと、アームが盛り付けます</span></div>
          <div class="grid-6">${VESSELS.map((v) => `<button class="opt${target?.vessel === v.id ? ' target' : ''}" data-v="${v.id}" title="${esc(v.hint)}">${VESSEL_ICON[v.id]}<span>${v.name}</span>${target?.vessel === v.id ? '<span class="tg">指示書</span>' : ''}</button>`).join('')}</div>`;
        side.innerHTML = discardBtn;
        main.querySelectorAll<HTMLButtonElement>('.opt').forEach((b) => b.addEventListener('click', () => this.h.onVessel(b.dataset.v as VesselId)));
        break;
      }
      case 'serve': {
        const chips: string[] = [];
        for (const i of INGREDIENTS) if (build.ing[i.id]) chips.push(`<span class="chip"><i class="swatch" style="background:${i.color}"></i>${esc(i.name)}×${build.ing[i.id]}</span>`);
        chips.push(`<span class="chip">${build.form ? FORM[build.form].name : '—'}</span>`);
        chips.push(`<span class="chip">${build.temp > BURN_AT ? '焦げ' : HEAT[heatFromTemp(build.temp)].name}</span>`);
        chips.push(`<span class="chip">仕上げ:${build.topping ? esc(ING[build.topping].name) : 'なし'}</span>`);
        chips.push(`<span class="chip">${build.vessel ? VESSEL[build.vessel].name : '—'}</span>`);
        main.innerHTML = `<div class="c-hint"><span>できあがり。市民に提供しますか？</span></div><div class="serve-summary">${chips.join('')}</div>`;
        side.innerHTML = `${discardBtn}<button class="btn primary big serve">提供する ▶</button>`;
        side.querySelector('.serve')!.addEventListener('click', () => this.h.onServe());
        break;
      }
    }
    // 狭い画面で会話ウィンドウをコンソールの上に置くため、高さを CSS に渡す
    requestAnimationFrame(() => document.documentElement.style.setProperty('--console-h', `${this.consoleEl.offsetHeight}px`));
    side.querySelector('.discard')?.addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      if (!this.discardArmed) {
        this.discardArmed = true;
        btn.innerHTML = '本当に廃棄？';
        setTimeout(() => {
          if (this.discardArmed && btn.isConnected) {
            this.discardArmed = false;
            btn.innerHTML = `${ICON.trash} 廃棄`;
          }
        }, 2500);
        return;
      }
      this.discardArmed = false;
      this.h.onDiscard();
    });
  }

  /** 素材の個数表示だけ更新（投入のたびに全部作り直さない） */
  updateIngCounts(build: Build): void {
    if (this.step !== 'ing') return;
    const units = Object.values(build.ing).reduce((a, b) => a + b, 0);
    this.consoleEl.querySelectorAll<HTMLButtonElement>('.ing-btn').forEach((b) => {
      const n = build.ing[b.dataset.ing as IngId];
      let cnt = b.querySelector('.cnt');
      if (n) {
        if (!cnt) {
          cnt = document.createElement('span');
          cnt.className = 'cnt';
          b.appendChild(cnt);
        }
        cnt.textContent = String(n);
      } else cnt?.remove();
    });
    const hint = this.consoleEl.querySelector('.c-hint b');
    if (hint) hint.textContent = `${units}/${MAX_UNITS}`;
    const undo = this.consoleEl.querySelector('.undo') as HTMLButtonElement | null;
    const next = this.consoleEl.querySelector('.next') as HTMLButtonElement | null;
    if (undo) undo.disabled = !units;
    if (next) next.disabled = !units;
  }

  setHeat(temp: number, dir: number): void {
    if (!this.needle) return;
    const k = (temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN);
    this.needle.style.left = `${Math.max(0, Math.min(1, k)) * 100}%`;
    if (this.readout) {
      const burnt = temp > BURN_AT;
      this.readout.textContent = burnt ? '焦げ！' : HEAT[heatFromTemp(temp)].name;
      this.readout.style.color = burnt ? 'var(--red)' : '';
    }
    for (const b of this.heatBtns) b.classList.toggle('on', Number(b.dataset.dir) === dir);
  }

  // ───────────── 料理ラベル・タンクの説明 ─────────────

  setFloatLabel(x: number, y: number, visible: boolean, name?: string, match?: number): void {
    if (!visible) {
      this.floatEl.classList.add('hidden');
      return;
    }
    this.floatEl.classList.remove('hidden');
    this.floatEl.style.left = `${x}px`;
    this.floatEl.style.top = `${y}px`;
    if (name !== undefined) {
      const unknown = match === undefined || match < 45;
      this.floatEl.classList.toggle('unknown', unknown);
      this.floatEl.innerHTML = `<span>推定：</span><b>${esc(unknown ? '分類不能物体' : name)}</b><span>${unknown ? '一致率 —' : `一致率 ${Math.round(match!)}%`}</span><div class="bar"><i style="width:${Math.max(0, Math.min(100, match ?? 0))}%"></i></div>`;
    }
  }

  private bindTankHover(): void {
    const canvasHost = document.getElementById('stage')!;
    canvasHost.addEventListener('pointermove', (e) => this.h.onTankHover(null, e.clientX, e.clientY));
    canvasHost.addEventListener('pointerleave', () => this.showTankTip(null, 0, 0));
  }

  showTankTip(id: IngId | null, x: number, y: number, note = ''): void {
    if (!id) {
      this.tankTip.classList.add('hidden');
      return;
    }
    const i = ING[id];
    this.tankTip.classList.remove('hidden');
    this.tankTip.style.left = `${x}px`;
    this.tankTip.style.top = `${y}px`;
    this.tankTip.innerHTML = `<span class="cd">${i.code}</span><b>${esc(i.name)}</b> <span style="color:var(--muted)">— ${esc(i.roles)}</span>${note ? `<div style="color:var(--amber);font-size:0.9em">${esc(note)}</div>` : ''}`;
  }

  // ───────────── トースト・チュートリアル ─────────────

  toast(text: string, kind: '' | 'warn' | 'bad' | 'good' = '', ms = 2600): void {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.toastsEl.appendChild(t);
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 500);
  }

  tip(html: string, target: string | HTMLElement | null, place: 'top' | 'bottom' | 'left' | 'right' = 'top'): void {
    this.clearTip();
    const el = document.createElement('div');
    el.className = 'tip';
    el.innerHTML = `<div class="tip-h">MEAL-7 補助 // GUIDE</div>${html}<button class="tip-x">わかった</button>`;
    this.root.appendChild(el);
    this.tipEl = el;
    el.querySelector('.tip-x')!.addEventListener('click', () => this.clearTip());
    const tgt = typeof target === 'string' ? (this.root.querySelector(target) as HTMLElement | null) : target;
    this.tipTarget = tgt;
    if (tgt) tgt.classList.add('pulse-target');
    const place2 = () => {
      if (!this.tipEl) return;
      const r = tgt?.getBoundingClientRect();
      const w = el.offsetWidth;
      const hgt = el.offsetHeight;
      let x = window.innerWidth / 2 - w / 2;
      let y = window.innerHeight / 2 - hgt / 2;
      // スマホでは横に置く余地がないので、対象の上か下へ。画面いっぱいの対象（レシピDB）なら画面の下端へ
      let pl = place;
      let dockBottom = false;
      if (r && this.compact && (pl === 'left' || pl === 'right')) {
        if (r.height > window.innerHeight * 0.6) dockBottom = true;
        else pl = r.top + r.height / 2 > window.innerHeight / 2 ? 'top' : 'bottom';
      }
      if (dockBottom) {
        y = window.innerHeight - hgt - 8;
      } else if (r) {
        if (pl === 'top') {
          x = r.left + r.width / 2 - w / 2;
          y = r.top - hgt - 14;
        } else if (pl === 'bottom') {
          x = r.left + r.width / 2 - w / 2;
          y = r.bottom + 14;
        } else if (pl === 'left') {
          x = r.left - w - 14;
          y = r.top + r.height / 2 - hgt / 2;
        } else {
          x = r.right + 14;
          y = r.top + r.height / 2 - hgt / 2;
        }
      }
      el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x))}px`;
      el.style.top = `${Math.max(52, Math.min(window.innerHeight - hgt - 8, y))}px`;
    };
    requestAnimationFrame(place2);
    setTimeout(place2, 400);
  }

  clearTip(): void {
    this.tipEl?.remove();
    this.tipEl = null;
    this.tipTarget?.classList.remove('pulse-target');
    this.tipTarget = null;
  }

  // ───────────── 毎フレーム ─────────────

  update(dt: number): void {
    // 3D が見えている領域を測り直す（パネルの出し入れはたまにしか起きないので間引く）
    this.focusT -= dt;
    if (this.focusT <= 0) {
      this.focusT = 0.2;
      this.focus = this.measureFocus();
    }
    // ニュースティッカー
    if (!this.hud.classList.contains('hidden')) {
      this.tickerX -= dt * 55;
      const w = this.tickerTrack.scrollWidth / 2;
      if (w > 0 && -this.tickerX > w) this.tickerX += w;
      this.tickerTrack.style.transform = `translateX(${this.tickerX}px)`;
    }
  }

  hideGameplay(): void {
    this.showCitizen(null, null, false);
    this.showDialog(false);
    this.showOrderCard(false);
    this.showConsole(false);
    this.setFloatLabel(0, 0, false);
    this.db.close();
    this.clearTip();
  }
}

/** ID カードの顔写真（2D で簡略に描く） */
export function drawPortrait(c: HTMLCanvasElement, look: Look): void {
  const g = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  g.fillStyle = '#0c151d';
  g.fillRect(0, 0, W, H);
  // 身長計の目盛り
  g.strokeStyle = 'rgba(70,216,255,0.18)';
  g.lineWidth = 1;
  for (let y = 8; y < H; y += 12) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(y % 36 === 8 ? 14 : 8, y);
    g.stroke();
  }
  const cx = W / 2;
  const cy = H * 0.46;
  const r = W * 0.27;
  // 肩
  g.fillStyle = look.outfit;
  g.beginPath();
  g.ellipse(cx, H * 1.02, W * 0.46, H * 0.3, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = look.accent;
  g.fillRect(cx - 10, H * 0.74, 20, 6);
  // 首
  g.fillStyle = look.skin;
  g.fillRect(cx - r * 0.35, cy + r * 0.6, r * 0.7, r * 0.7);
  // 後ろ髪
  g.fillStyle = look.hair;
  if (['bob', 'long', 'pigtails'].includes(look.hairStyle)) {
    g.beginPath();
    g.ellipse(cx, cy + r * 0.2, r * 1.15, r * (look.hairStyle === 'long' ? 1.5 : 1.2), 0, 0, Math.PI * 2);
    g.fill();
  }
  if (look.hairStyle === 'pigtails') {
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + s * r * 1.25, cy + r * 0.2, r * 0.3, r * 0.55, s * 0.4, 0, Math.PI * 2);
      g.fill();
    }
  }
  // 顔
  g.fillStyle = look.skin;
  g.beginPath();
  g.ellipse(cx, cy, r, r * 1.08, 0, 0, Math.PI * 2);
  g.fill();
  // 前髪
  g.fillStyle = look.hair;
  if (look.hairStyle !== 'bald') {
    g.beginPath();
    g.ellipse(cx, cy - r * 0.55, r * 1.04, r * 0.62, 0, Math.PI, Math.PI * 2);
    g.fill();
    if (look.hairStyle === 'bun') {
      g.beginPath();
      g.arc(cx, cy - r * 1.2, r * 0.38, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    g.fillRect(cx - r * 1.02, cy - r * 0.2, r * 0.2, r * 0.5);
    g.fillRect(cx + r * 0.82, cy - r * 0.2, r * 0.2, r * 0.5);
  }
  // 帽子
  if (look.hat !== 'none') {
    g.fillStyle = look.hatColor;
    g.beginPath();
    g.ellipse(cx, cy - r * 0.62, r * 1.12, r * 0.6, 0, Math.PI, Math.PI * 2);
    g.fill();
    if (look.hat === 'peaked' || look.hat === 'cap') {
      g.fillStyle = look.hat === 'peaked' ? '#07080a' : look.hatColor;
      g.fillRect(cx - r * 0.9, cy - r * 0.66, r * 1.8, r * 0.16);
    }
    if (look.hat === 'hood') {
      g.strokeStyle = look.hatColor;
      g.lineWidth = r * 0.35;
      g.beginPath();
      g.ellipse(cx, cy, r * 1.2, r * 1.3, 0, Math.PI * 0.85, Math.PI * 2.15);
      g.stroke();
    }
  }
  // 目・口
  g.fillStyle = '#1c1614';
  const ey = cy + r * 0.05;
  const ew = look.eyes === 'big' ? 3.2 : 2.5;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(cx + s * r * 0.42, ey, ew, look.eyes === 'sleepy' ? 1.4 : ew * 1.3, 0, 0, Math.PI * 2);
    g.fill();
  }
  if (look.mask) {
    g.fillStyle = '#2d3530';
    g.beginPath();
    g.ellipse(cx, cy + r * 0.55, r * 0.75, r * 0.4, 0, 0, Math.PI * 2);
    g.fill();
  } else {
    g.strokeStyle = '#5a2a24';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(cx - r * 0.2, cy + r * 0.52);
    g.lineTo(cx + r * 0.2, cy + r * 0.52);
    g.stroke();
  }
  if (look.glasses !== 'none') {
    g.strokeStyle = look.glassesColor === '#222' ? '#555' : look.glassesColor;
    g.lineWidth = 1.5;
    for (const s of [-1, 1]) {
      g.beginPath();
      if (look.glasses === 'round') g.arc(cx + s * r * 0.42, ey, r * 0.24, 0, Math.PI * 2);
      else g.rect(cx + s * r * 0.42 - r * 0.26, ey - r * 0.17, r * 0.52, r * 0.34);
      g.stroke();
    }
  }
  // 走査線
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
}
