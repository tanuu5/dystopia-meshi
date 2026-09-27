import './style.css';
import * as THREE from 'three';
import { Game } from './Game.ts';
import { RECIPE } from './data/recipes.ts';
import { ING_IDS } from './data/ingredients.ts';
import { HEAT } from './data/processes.ts';
import type { Formula, IngId } from './data/types.ts';
import { applyShortages, idealFor } from './sim/scoring.ts';
import { Food } from './scene/Food.ts';
import { makeVessel } from './scene/Vessel.ts';
import { PAD, PAD_TOP } from './scene/layout.ts';

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = 'MEAL-7 起動中 …';
  app.appendChild(loading);

  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2')) {
    loading.remove();
    const f = document.createElement('div');
    f.className = 'fatal';
    f.innerHTML = 'このブラウザでは WebGL2 が使えないため、ゲームを起動できません。<br/>最新の Chrome / Edge / Safari / Firefox でお試しください。';
    app.appendChild(f);
    return;
  }

  // キャンバスに文字を描く前にフォントを読み込む（失敗しても続行）
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('700 24px "Zen Kaku Gothic New"'),
        document.fonts.load('900 24px "Zen Kaku Gothic New"'),
        document.fonts.load('400 24px "Dela Gothic One"'),
        document.fonts.load('400 24px "Share Tech Mono"'),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* noop */
  }

  const game = new Game(document.getElementById('stage')!, document.getElementById('ui')!);
  let last = performance.now();
  const dev = window as unknown as { __speed?: number };
  const loop = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05) * (import.meta.env.DEV ? (dev.__speed ?? 1) : 1);
    last = now;
    game.update(dt);
    if (!game.paused) game.world.update(dt);
    game.ui.update(dt);
    game.world.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  game.start();
  loading.style.opacity = '0';
  setTimeout(() => loading.remove(), 700);

  if (import.meta.env.DEV) {
    const w = window as unknown as Record<string, unknown>;
    w.__game = game;
    w.__world = game.world;
    // 開発用：現在の画面を .shots/ に保存する
    w.__shot = async (name: string) => {
      game.world.render();
      const url = game.world.stage.renderer.domElement.toDataURL('image/png');
      await fetch('/__shot?name=' + name, { method: 'POST', body: url });
    };
    // 開発用：ペインが隠れていて rAF が止まっていても時間を進める
    const yieldTask = () =>
      new Promise<void>((r) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => r();
        ch.port2.postMessage(0);
      });
    // 開発用：レシピどおりの料理をステージに出して見た目を確認する
    w.__showDish = (id: string) => {
      const r = RECIPE[id];
      const world = game.world;
      world.food?.dispose();
      world.stage.scene.children.filter((c) => c.userData.galleryVessel).forEach((c) => world.stage.scene.remove(c));
      const ing = Object.fromEntries(ING_IDS.map((k) => [k, r.ing[k] ?? 0])) as Record<IngId, number>;
      const food = new Food(ing, r.form);
      const h = HEAT[r.heat];
      const t = (h.min + h.max) / 2;
      food.setHeat(t);
      food.setTopping(r.topping);
      const v = makeVessel(r.vessel);
      v.group.userData.galleryVessel = true;
      v.group.position.set(PAD.x, PAD_TOP, PAD.z);
      world.stage.scene.add(v.group);
      food.placeInVessel(v);
      v.group.add(food.group);
      world.food = food;
      world.setTemp(t, 0);
      world.stage.snapShot({ pos: new THREE.Vector3(0, 1.42, 1.02), target: new THREE.Vector3(0, 1.04, 0.4), fov: 36 });
      return r.name;
    };
    // 開発用：いまの注文を（ほぼ）正しく自動で作って出す。miss=true なら温度をわざと外す
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const g = game as unknown as {
      pin(id: string): void;
      addIngredient(id: IngId): void;
      next(): void;
      chooseForm(f: string): Promise<void>;
      chooseTopping(id: IngId | null): Promise<void>;
      chooseVessel(v: string): Promise<void>;
      serve(): void;
    };
    const autoCook = async (miss = false, wrong = false) => {
      const o = game.order;
      if (!o || game.phase !== 'cook') return 'not-ready';
      let target: Formula;
      if (wrong) target = applyShortages(o.spec.target.id === 'ration' ? RECIPE.coffee : RECIPE.ration, game.dayDef.shortages);
      else if (o.special === 'nikujaga') target = RECIPE.nikujaga;
      else if (o.special === 'free') target = applyShortages(RECIPE.hamburg, []);
      else target = idealFor(o.spec).ideal;
      if (!o.special && game.availableRecipesPublic().some((r) => r.id === o.spec.target.id)) g.pin(o.spec.target.id);
      for (const [id, n] of Object.entries(target.ing) as [IngId, number][]) for (let k = 0; k < n; k++) g.addIngredient(id);
      while (game.world.busy) await sleep(50);
      await sleep(200);
      g.next();
      await g.chooseForm(target.form);
      const h = HEAT[target.heat];
      game.build.temp = miss ? (h.max + 0.35 > 1.2 ? h.min - 0.4 : h.max + 0.35) : (h.min + h.max) / 2;
      game.build.heated = true;
      game.world.setTemp(game.build.temp, 0);
      await sleep(100);
      g.next();
      await g.chooseTopping(target.topping);
      await g.chooseVessel(target.vessel);
      await sleep(200);
      g.serve();
      return `${o.citizen.name}: ${o.special ?? o.spec.target.name} ${o.spec.modifiers.join(',')}`;
    };
    w.__autoCook = autoCook;
    // 開発用：何日分かを自動で遊ぶ（通達・評価・日報のボタンも押す）
    w.__autoRun = async (maxCustomers = 999, missEvery = 0, wrong = false) => {
      const log: string[] = [];
      let served = 0;
      const click = (sel: string) => (document.querySelector(sel) as HTMLButtonElement | null)?.click();
      while (served < maxCustomers) {
        if (document.querySelector('.notice .go')) click('.notice .go');
        else if (document.querySelector('.report .next')) click('.report .next');
        else if (document.querySelector('.rating .next')) {
          const score = document.querySelector('.rating .score b')?.textContent ?? '?';
          const made = document.querySelector('.rating .made')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
          log.push(`  → ${score}点 満足度 ${Math.round(game.satisfaction)} | ${made}`);
          click('.rating .next');
        } else if (document.querySelector('.ending')) {
          log.push('ENDING: ' + (document.querySelector('.end-title')?.textContent ?? ''));
          break;
        } else if (document.querySelector('.gameover')) {
          log.push('GAME OVER');
          break;
        } else if (game.phase === 'cook' && !game.world.busy && !game.ui.isTyping) {
          served++;
          const miss = missEvery > 0 && served % missEvery === 0;
          log.push(`D${game.day} ` + String(await autoCook(miss, wrong)));
        }
        await sleep(120);
      }
      return log.join('\n');
    };
    w.__advance = async (sec: number) => {
      const n = Math.round(sec * 60);
      for (let i = 0; i < n; i++) {
        game.update(1 / 60);
        if (!game.paused) game.world.update(1 / 60);
        game.ui.update(1 / 60);
        await yieldTask();
      }
    };
  }
}

void boot();
