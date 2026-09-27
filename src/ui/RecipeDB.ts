import type { CategoryId, ColorTag, FormId, HeatId, IngId, Recipe, TasteTag, VesselId, Formula } from '../data/types.ts';
import { ING, INGREDIENTS, SUBSTITUTES } from '../data/ingredients.ts';
import { CATEGORIES, FORM, FORMS, HEAT, HEATS, VESSEL, VESSELS, CATEGORY } from '../data/processes.ts';
import { applyShortages, usesShortage } from '../sim/scoring.ts';

// レシピ DB（右の引き出し）と素材図鑑

type FilterKey = 'cat' | 'temp' | 'form' | 'color' | 'taste' | 'vessel';

const COLORS: ColorTag[] = ['茶', '白', '黄', '赤', '緑', '黒', '桃', '橙', '灰', '透明', '金'];
const TASTES: TasteTag[] = ['甘', '辛', '塩', '酸', '苦', '旨', '淡'];

export function toHira(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).toLowerCase();
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** 配合を HTML で（色の点・名前・個数） */
export function formulaHTML(f: Formula, compact = false): string {
  const parts: string[] = [];
  for (const [id, n] of Object.entries(f.ing) as [IngId, number][]) {
    if (!n) continue;
    const ing = ING[id];
    parts.push(`<span><i class="swatch" style="background:${ing.color}"></i>${compact ? ing.name.replace(/(色|キューブ|ペースト|粒子|ゲル|乳剤|結晶|因子)$/, '') : ing.name}×${n}</span>`);
  }
  parts.push('<span class="sep">▸</span>');
  parts.push(`<span>${FORM[f.form].name}</span>`);
  parts.push(`<span>${HEAT[f.heat].name}</span>`);
  parts.push(`<span>仕上げ:${f.topping ? `<i class="swatch" style="background:${ING[f.topping].color}"></i>${ING[f.topping].name}` : 'なし'}</span>`);
  parts.push(`<span>${VESSEL[f.vessel].name}</span>`);
  return parts.join('');
}

export class RecipeDB {
  readonly el: HTMLElement;
  private recipes: Recipe[] = [];
  private shortages: IngId[] = [];
  private pinnedId: string | null = null;
  private filters: Record<FilterKey, Set<string>> = {
    cat: new Set(),
    temp: new Set(),
    form: new Set(),
    color: new Set(),
    taste: new Set(),
    vessel: new Set(),
  };
  private q = '';
  private tab: 'recipe' | 'ing' = 'recipe';
  private expanded: string | null = null;
  private hlIng: IngId | null = null;
  private listEl!: HTMLElement;
  private metaEl!: HTMLElement;
  private input!: HTMLInputElement;
  private filtersEl!: HTMLElement;
  private noteEl!: HTMLElement;
  /** タイトルからの閲覧（営業時間外）。指示書への固定はできない */
  private browse = false;
  isOpen = false;
  onPin: (id: string) => void = () => {};
  onToggle: (open: boolean) => void = () => {};
  newIds = new Set<string>();

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'drawer';
    this.el.innerHTML = `
      <div class="db-tabs">
        <button data-tab="recipe" class="on">レシピDB</button>
        <button data-tab="ing">素材図鑑</button>
        <button class="close" title="閉じる (Tab)">✕</button>
      </div>
      <div class="db-note hidden"></div>
      <div class="db-search"><input type="search" placeholder="料理名・ひらがな・素材名で検索" /></div>
      <div class="db-filters"></div>
      <div class="db-meta"><span class="count"></span><button class="reset">条件をクリア</button></div>
      <div class="db-list"></div>`;
    parent.appendChild(this.el);
    this.listEl = this.el.querySelector('.db-list')!;
    this.metaEl = this.el.querySelector('.db-meta .count')!;
    this.input = this.el.querySelector('input')!;
    this.filtersEl = this.el.querySelector('.db-filters')!;
    this.noteEl = this.el.querySelector('.db-note')!;
    this.el.querySelectorAll<HTMLButtonElement>('.db-tabs button[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as 'recipe' | 'ing';
        this.render();
      }),
    );
    this.el.querySelector('.close')!.addEventListener('click', () => this.close());
    this.el.querySelector('.reset')!.addEventListener('click', () => {
      this.clearFilters();
      this.render();
    });
    this.input.addEventListener('input', () => {
      this.q = this.input.value;
      this.renderList();
    });
    this.input.addEventListener('keydown', (e) => e.stopPropagation());
    this.renderFilters();
  }

  setContext(recipes: Recipe[], shortages: IngId[], pinnedId: string | null): void {
    this.recipes = recipes;
    this.shortages = shortages;
    this.pinnedId = pinnedId;
    if (this.isOpen) this.render();
  }

  /** タイトルから開く閲覧モード（営業時間外なので時間は進まず、指示書への固定もない） */
  setBrowse(on: boolean, note = ''): void {
    this.browse = on;
    this.el.classList.toggle('browse', on);
    this.noteEl.classList.toggle('hidden', !on);
    this.noteEl.innerHTML = on ? `<b>MEAL-7 学習モード</b>営業時間外のため、市民は待っていません。<br/>${esc(note)}` : '';
  }

  /** 絞り込み（条件・検索語・素材の強調）と、開いていたカードを初期状態に戻す */
  clearFilters(): void {
    for (const k of Object.keys(this.filters) as FilterKey[]) this.filters[k].clear();
    this.q = '';
    this.input.value = '';
    this.hlIng = null;
    this.expanded = null;
    if (this.isOpen) this.render();
  }

  open(tab?: 'recipe' | 'ing'): void {
    if (tab) this.tab = tab;
    this.isOpen = true;
    this.el.classList.add('open');
    this.render();
    this.onToggle(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('open');
    this.onToggle(false);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** 会話のキーワードから絞り込み */
  applyKeyword(key: string, value: string): void {
    switch (key) {
      case 'name':
        this.q = value;
        this.input.value = value;
        this.tab = 'recipe';
        break;
      case 'cat':
        this.filters.cat.add(value);
        this.tab = 'recipe';
        break;
      case 'temp':
        this.filters.temp.add(value);
        this.tab = 'recipe';
        break;
      case 'form':
        this.filters.form.add(value);
        this.tab = 'recipe';
        break;
      case 'color':
        this.filters.color.add(value);
        this.tab = 'recipe';
        break;
      case 'taste':
        this.filters.taste.add(value);
        this.tab = 'recipe';
        break;
      case 'vessel':
        this.filters.vessel.add(value);
        this.tab = 'recipe';
        break;
      case 'ing':
        this.hlIng = value as IngId;
        this.tab = 'ing';
        break;
    }
    this.open();
    if (key === 'ing') {
      requestAnimationFrame(() => this.listEl.querySelector('.icard.hl')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    }
  }

  private renderFilters(): void {
    const row = (key: FilterKey, label: string, items: { v: string; t: string }[]) =>
      `<div class="frow"><span>${label}</span><div class="chips">${items
        .map((i) => `<button class="fchip${this.filters[key].has(i.v) ? ' on' : ''}" data-k="${key}" data-v="${i.v}">${i.t}</button>`)
        .join('')}</div></div>`;
    this.filtersEl.innerHTML = [
      row('cat', '分類', CATEGORIES.map((c) => ({ v: c.id, t: c.name }))),
      row('temp', '温度', HEATS.map((h) => ({ v: h.id, t: h.name }))),
      row('form', '形', FORMS.map((f) => ({ v: f.id, t: f.name }))),
      row('color', '色', COLORS.map((c) => ({ v: c, t: c }))),
      row('taste', '味', TASTES.map((t) => ({ v: t, t }))),
      row('vessel', '器', VESSELS.map((v) => ({ v: v.id, t: v.name }))),
    ].join('');
    this.filtersEl.querySelectorAll<HTMLButtonElement>('.fchip').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.k as FilterKey;
        const v = b.dataset.v!;
        if (this.filters[k].has(v)) this.filters[k].delete(v);
        else this.filters[k].add(v);
        b.classList.toggle('on');
        this.renderList();
      }),
    );
  }

  render(): void {
    this.el.querySelectorAll<HTMLButtonElement>('.db-tabs button[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    const recipeMode = this.tab === 'recipe';
    (this.el.querySelector('.db-search') as HTMLElement).classList.toggle('hidden', !recipeMode);
    this.filtersEl.classList.toggle('hidden', !recipeMode);
    (this.el.querySelector('.db-meta') as HTMLElement).classList.toggle('hidden', !recipeMode);
    if (recipeMode) this.renderFilters();
    this.renderList();
  }

  private matches(r: Recipe): boolean {
    const f = this.filters;
    if (f.cat.size && !f.cat.has(r.cat)) return false;
    if (f.temp.size && !f.temp.has(r.heat)) return false;
    if (f.form.size && !f.form.has(r.form)) return false;
    if (f.vessel.size && !f.vessel.has(r.vessel)) return false;
    if (f.color.size && !r.colors.some((c) => f.color.has(c))) return false;
    if (f.taste.size && !r.tastes.some((t) => f.taste.has(t))) return false;
    const q = toHira(this.q.trim());
    if (q) {
      const ingNames = Object.keys(r.ing)
        .map((id) => ING[id as IngId].name + ING[id as IngId].official + ING[id as IngId].roles)
        .join(' ');
      const hay = toHira(`${r.name} ${r.base} ${r.kana} ${ingNames} ${r.topping ? ING[r.topping].name : ''}`);
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }

  private renderList(): void {
    if (this.tab === 'ing') {
      this.listEl.innerHTML = INGREDIENTS.map((i) => {
        const short = this.shortages.includes(i.id);
        const sub = SUBSTITUTES[i.id];
        return `<div class="icard${this.hlIng === i.id ? ' hl' : ''}" style="--c:${i.color}">
          <div class="sw"></div>
          <div>
            <div class="ttl">${i.name}<span>${i.code}</span></div>
            <div class="off">${i.official}</div>
            <div class="roles">役割：${i.roles}</div>
            <div class="desc">${i.desc}</div>
            ${short ? `<div class="short">本日欠品 ${sub ? '→ ' + sub.text : ''}</div>` : ''}
          </div>
        </div>`;
      }).join('');
      return;
    }
    const list = this.recipes.filter((r) => this.matches(r));
    const total = this.recipes.length;
    this.metaEl.textContent = `${list.length} / ${total} 件`;
    if (!list.length) {
      this.listEl.innerHTML = `<div class="db-empty">該当するレシピがありません。<br/>条件をゆるめるか、<br/>素材図鑑を見て配合を自分で組み立ててください。</div>`;
      return;
    }
    this.listEl.innerHTML = list
      .map((r) => {
        const f = applyShortages(r, this.shortages);
        const sub = usesShortage(r, this.shortages);
        const open = this.expanded === r.id;
        const pinned = !this.browse && this.pinnedId === r.id;
        return `<div class="rcard${pinned ? ' pinned' : ''}" data-id="${r.id}">
          <div class="top"><span class="rname">${esc(r.name)}</span><span class="badge cat">${CATEGORY[r.cat].name}</span>${sub ? '<span class="badge sub">代替配合</span>' : ''}${this.newIds.has(r.id) ? '<span class="badge new">NEW</span>' : ''}${pinned ? '<span class="badge new">📌 固定中</span>' : ''}</div>
          <div class="formula">${formulaHTML(f, true)}</div>
          ${
            open
              ? `<div class="detail">
                  <div>${esc(r.note)}</div>
                  ${sub ? `<div class="oc-sub">欠品のため代替配合を表示中。本来の配合：${formulaHTML(r, true).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')}</div>` : ''}
                  <div class="archive">旧時代アーカイブ：${esc(r.archive)}</div>
                  <div class="archive">色：${r.colors.join('・')}　味：${r.tastes.join('・')}　温度：${HEAT[r.heat].name}</div>
                  ${this.browse ? '' : `<button class="btn primary pin" data-id="${r.id}">📌 指示書に固定</button>`}
                </div>`
              : ''
          }
        </div>`;
      })
      .join('');
    this.listEl.querySelectorAll<HTMLElement>('.rcard').forEach((c) =>
      c.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        if (t.classList.contains('pin')) {
          e.stopPropagation();
          this.onPin(t.dataset.id!);
          return;
        }
        this.expanded = this.expanded === c.dataset.id ? null : c.dataset.id!;
        this.renderList();
      }),
    );
  }
}

export const LABEL = {
  cat: (v: CategoryId) => CATEGORY[v]?.name ?? v,
  temp: (v: HeatId) => HEAT[v]?.name ?? v,
  form: (v: FormId) => FORM[v]?.name ?? v,
  vessel: (v: VesselId) => VESSEL[v]?.name ?? v,
};
