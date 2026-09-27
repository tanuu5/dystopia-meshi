import * as THREE from 'three';
import { Stage, type Shot } from './Stage.ts';
import { Kitchen } from './Kitchen.ts';
import { Tanks } from './Tanks.ts';
import { Dispenser } from './Dispenser.ts';
import { Goo } from './Goo.ts';
import { Food, moldGeometry } from './Food.ts';
import { makeVessel, type VesselInfo } from './Vessel.ts';
import { RobotArm, wrapAngle } from './RobotArm.ts';
import { Hall } from './Hall.ts';
import { CustomerModel, type Mood } from './Customer.ts';
import { Particles } from './Particles.ts';
import { ING } from '../data/ingredients.ts';
import type { FormId, IngId, VesselId } from '../data/types.ts';
import type { Look } from '../data/characters.ts';
import { Animator, ease, lerp, smoothstep } from '../util/anim.ts';
import { ARM_BASE, ELEVATOR, FOOD_FLOAT, PAD, PAD_TOP, SEAT, TRAY_CUSTOMER, TRAY_KITCHEN, TRAY_TOP, COUNTER_Y } from './layout.ts';

export const SHOTS: Record<string, Shot> = {
  title: { pos: new THREE.Vector3(0.16, 1.5, 1.32), target: new THREE.Vector3(0.02, 1.28, -0.6), fov: 38 },
  cook: { pos: new THREE.Vector3(0, 1.78, 1.55), target: new THREE.Vector3(0, 1.08, -0.35), fov: 40 },
  order: { pos: new THREE.Vector3(0, 1.66, 0.95), target: new THREE.Vector3(0, 1.4, -1.2), fov: 40 },
  plate: { pos: new THREE.Vector3(0, 1.62, 1.32), target: new THREE.Vector3(0, 0.86, 0.22), fov: 40 },
  eat: { pos: new THREE.Vector3(0.08, 1.6, 0.25), target: new THREE.Vector3(0, 1.3, -1.3), fov: 42 },
  end: { pos: new THREE.Vector3(0, 2.2, 2.3), target: new THREE.Vector3(0, 1.2, -0.6), fov: 46 },
};

/** 客の前に置くときの縮尺（厨房では見やすさ優先で大きく作っている） */
const SERVE_SCALE = 0.6;

/** アームの台座から見た p の方角。この向きで近づくと、器の台座側の縁（胴）を挟むことになる */
const headingTo = (p: THREE.Vector3) => Math.atan2(p.x - ARM_BASE.x, p.z - ARM_BASE.z);

/**
 * カップの取っ手（器の +X 側）が、配膳後に客の右手側（-X）を向くための最初の回転。
 * 器はエレベーター → ステージ → トレイと運ばれるあいだ、アームの向きの分だけ回る
 */
const CUP_TURN = wrapAngle(-Math.PI - (headingTo(TRAY_KITCHEN) - headingTo(ELEVATOR)));

/** トレイの位置（k = 0 厨房側 → 1 客の前）。横へ寄せながら奥へ滑らせる */
function trayAt(k: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(lerp(TRAY_KITCHEN.x, TRAY_CUSTOMER.x, smoothstep(0, 0.5, k)), TRAY_KITCHEN.y, lerp(TRAY_KITCHEN.z, TRAY_CUSTOMER.z, k));
}

export class World {
  readonly stage: Stage;
  readonly anim = new Animator();
  readonly kitchen = new Kitchen();
  readonly tanks = new Tanks();
  readonly dispenser = new Dispenser();
  readonly goo = new Goo();
  readonly arm = new RobotArm();
  readonly hall = new Hall();
  readonly steam = new Particles(700, false);
  readonly sparks = new Particles(500, true);
  food: Food | null = null;
  vessel: VesselInfo | null = null;
  customer: CustomerModel | null = null;
  private raycaster = new THREE.Raycaster();
  private busyCount = 0;
  private steamAcc = 0;
  private foodHeat = 0;
  private servedHeatDecay = 0;
  private armIdle: 'rest' | 'attend' = 'rest';
  private armIdleT = 0;
  private dispenseQueue: Promise<void> = Promise.resolve();
  time = 0;

  constructor(container: HTMLElement) {
    this.stage = new Stage(container);
    const s = this.stage.scene;
    s.add(this.kitchen.group, this.tanks.group, this.dispenser.group, this.goo.mesh, this.arm.group, this.hall.group, this.steam.points, this.sparks.points);
    this.dispenser.onLand = (id, pos) => {
      this.goo.add(ING[id]);
      this.sparks.emit({ pos, vel: new THREE.Vector3(0, 0.4, 0), spread: 0.08, color: ING[id].color, size: 0.012, life: 0.5, gravity: 1.5, count: 10 });
    };
    this.stage.snapShot(SHOTS.title);
    this.setArmRest();
    window.addEventListener('resize', () => this.onResize());
    this.onResize();
  }

  private onResize(): void {
    const h = this.stage.renderer.domElement.clientHeight * this.stage.renderer.getPixelRatio();
    this.steam.setPixelScale(h);
    this.sparks.setPixelScale(h);
  }

  get busy(): boolean {
    return this.busyCount > 0;
  }

  private async busyRun<T>(fn: () => Promise<T>): Promise<T> {
    this.busyCount++;
    try {
      return await fn();
    } finally {
      this.busyCount--;
    }
  }

  wait(s: number): Promise<void> {
    return this.anim.wait(s);
  }

  /** 進行中の演出（素材の落下など）が終わるまで待つ */
  async idle(): Promise<void> {
    await this.dispenseQueue;
    while (this.busyCount > 0) await this.anim.wait(0.05);
  }

  shot(name: keyof typeof SHOTS | string, speed = 2.2): void {
    const s = SHOTS[name];
    if (s) this.stage.setShot(s, speed);
  }

  // ───────────── アーム ─────────────

  setArmRest(): void {
    this.armIdle = 'rest';
    this.arm.speed = 4;
    this.arm.target.copy(ARM_BASE).add(new THREE.Vector3(-0.16, 0.8, 0.12));
    this.arm.pitchGoal = -0.35;
    this.arm.openGoal = 0.35;
  }

  setArmAttend(): void {
    this.armIdle = 'attend';
    this.arm.speed = 4;
    this.arm.target.copy(ARM_BASE).add(new THREE.Vector3(-0.32, 0.72, -0.12));
    this.arm.pitchGoal = 0.12;
    this.arm.openGoal = 0.25;
  }

  private async armTo(p: THREE.Vector3, pitch: number, dur: number, speed = 9): Promise<void> {
    this.arm.speed = speed;
    this.arm.target.copy(p);
    this.arm.pitchGoal = pitch;
    await this.wait(dur);
  }

  /** アームが目標に追いつくまで待つ（つかむ・放す瞬間に器がずれないように） */
  private async armSettle(max = 0.5): Promise<void> {
    for (let t = 0; t < max && !this.arm.settled(); t += 0.03) await this.wait(0.03);
  }

  /**
   * 器（底の中心が center）を、heading の向きから指で挟むときの先端位置と、差し込む前の位置。
   * 料理に触れないよう、中心ではなく手前の縁（背の高い器は胴）を挟む
   */
  private gripPose(v: VesselInfo, center: THREE.Vector3, heading: number): { tip: THREE.Vector3; pre: THREE.Vector3 } {
    const g = v.grip;
    const dir = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const axis = new THREE.Vector3(dir.x * Math.cos(g.pitch), Math.sin(g.pitch), dir.z * Math.cos(g.pitch));
    const tip = center.clone().addScaledVector(dir, -g.r).setY(center.y + g.y).addScaledVector(axis, g.depth);
    const pre = tip.clone().addScaledVector(axis, -0.1);
    return { tip, pre };
  }

  /** 持っている器の中心を center へ運ぶ（器の水平の向きは heading で決まる） */
  private carry(v: VesselInfo, center: THREE.Vector3, heading: number, dur: number, speed = 9): Promise<void> {
    this.arm.headingGoal = heading;
    return this.armTo(this.gripPose(v, center, heading).tip, v.grip.pitch, dur, speed);
  }

  /** 器の台座側の縁（胴）を指で挟んで持つ。戻り値はつかんだ向き */
  private async grab(v: VesselInfo, center: THREE.Vector3): Promise<number> {
    const heading = headingTo(center);
    const { tip, pre } = this.gripPose(v, center, heading);
    const pitch = v.grip.pitch;
    this.arm.headingGoal = heading;
    // 縁なら指を縁の内側と外側へ、胴なら左右へ開く
    this.arm.rollGoal = v.grip.kind === 'rim' ? Math.PI / 2 : 0;
    this.arm.openGoal = v.grip.open;
    await this.armTo(pre.clone().add(new THREE.Vector3(0, 0.12, 0)), pitch, 0.45);
    await this.armTo(pre, pitch, 0.25);
    await this.armTo(tip, pitch, 0.3, 8);
    await this.armSettle();
    this.arm.openGoal = v.grip.closed;
    await this.wait(0.14);
    this.arm.attach(v.group);
    return heading;
  }

  /** 持っている器を center に下ろして放し、指を縁から抜く */
  private async putDown(v: VesselInfo, center: THREE.Vector3, heading: number, parent: THREE.Object3D): Promise<void> {
    const { tip, pre } = this.gripPose(v, center, heading);
    const pitch = v.grip.pitch;
    await this.carry(v, center.clone().add(new THREE.Vector3(0, 0.08, 0)), heading, 0.35);
    await this.armTo(tip, pitch, 0.35, 7);
    await this.armSettle();
    this.arm.openGoal = v.grip.open;
    await this.wait(0.1);
    this.arm.release(parent);
    // 置いた位置と傾きを整える（水平の向きはそのまま）
    const vg = v.group;
    vg.position.copy(parent.worldToLocal(center.clone()));
    vg.rotation.set(0, new THREE.Euler().setFromQuaternion(vg.quaternion, 'YXZ').y, 0);
    await this.armTo(pre, pitch, 0.25);
    this.arm.headingGoal = null;
    this.arm.rollGoal = 0;
  }

  async bow(): Promise<void> {
    const base = this.arm.target.clone();
    const p0 = this.arm.pitchGoal;
    this.arm.speed = 6;
    this.arm.target.y -= 0.14;
    this.arm.pitchGoal = -1.1;
    await this.wait(0.45);
    this.arm.target.copy(base);
    this.arm.pitchGoal = p0;
    await this.wait(0.35);
  }

  async armNod(): Promise<void> {
    const p0 = this.arm.pitchGoal;
    this.arm.pitchGoal = p0 - 0.4;
    await this.wait(0.18);
    this.arm.pitchGoal = p0;
    await this.wait(0.2);
  }

  armMood(color: string): void {
    this.arm.setMood(color);
  }

  // ───────────── 調理 ─────────────

  /** 素材を一つ投入（連打されたら順番に処理） */
  dispense(id: IngId): Promise<void> {
    this.dispenseQueue = this.dispenseQueue.then(() =>
      this.busyRun(async () => {
        if (!this.dispenser.active) {
          this.dispenser.descend();
          this.kitchen.setFieldActive(true);
          await this.wait(0.35);
        }
        this.tanks.pulse(id);
        await this.wait(0.22);
        await this.dispenser.drop(id);
      }),
    );
    return this.dispenseQueue;
  }

  undoLast(): void {
    this.goo.removeLast();
    this.sparks.emit({ pos: FOOD_FLOAT.clone(), spread: 0.05, color: '#ff4a4a', size: 0.01, life: 0.4, count: 8 });
  }

  /** 成形：投入された素材を形にする */
  form(form: FormId, ing: Record<IngId, number>): Promise<void> {
    return this.busyRun(async () => {
      this.dispenser.descend();
      await this.wait(0.2);
      const color = this.goo.averageColor();
      if (form === 'liquid' || form === 'fizz') {
        // 液体はまとまって球になる
        await this.anim.tween(0.6, (k) => (this.goo.collapse = k), ease.inOutCubic);
      } else {
        this.goo.collapse = 0.5;
        await this.dispenser.press(moldGeometry(form), (s) => this.wait(s));
      }
      this.goo.hide();
      this.food?.dispose();
      this.servedHeatDecay = 0;
      this.food = new Food(ing, form);
      this.food.group.position.copy(FOOD_FLOAT).add(new THREE.Vector3(0, -this.food.height / 2, 0));
      this.stage.scene.add(this.food.group);
      this.stage.addShake(0.35);
      this.sparks.emit({ pos: FOOD_FLOAT.clone(), vel: new THREE.Vector3(0, 0.3, 0), spread: 0.25, color, size: 0.016, life: 0.6, gravity: 0.6, drag: 3, count: 36 });
      this.steam.emit({ pos: FOOD_FLOAT.clone(), vel: new THREE.Vector3(0, 0.25, 0), spread: 0.2, color: '#d8e6f0', size: 0.04, grow: 2, life: 1.1, alpha: 0.14, drag: 2, count: 12 });
      // 成形直後のぷるんとした揺れ
      const g = this.food.group;
      await this.anim.tween(0.45, (k) => {
        const s = 1 + Math.sin(k * Math.PI * 3) * (1 - k) * 0.12;
        g.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
      }, ease.linear);
      g.scale.set(1, 1, 1);
      this.dispenser.ascend();
    });
  }

  /** 温度（-1..1.25）。activity は加熱・冷却の強さ */
  setTemp(t: number, activity: number): void {
    this.foodHeat = t;
    this.kitchen.setTemp(t, activity);
    this.food?.setHeat(t);
    if (activity > 0 && this.food) {
      // 加熱中は火の粉、冷却中は冷気
      if (t > 0.15 && Math.random() < 0.5) {
        const p = this.food.topWorld();
        this.sparks.emit({ pos: new THREE.Vector3(PAD.x + (Math.random() - 0.5) * 0.4, PAD_TOP + 0.01, PAD.z + (Math.random() - 0.5) * 0.4), vel: new THREE.Vector3(0, 0.35 + t * 0.4, 0), spread: 0.02, color: t > 1 ? '#ff4a10' : '#ffae4a', size: 0.008, life: 0.7, drag: 1, count: 1 });
        if (t > 1.02) this.steam.emit({ pos: p, vel: new THREE.Vector3(0, 0.3, 0), spread: 0.06, color: '#1a1512', size: 0.05, grow: 3, life: 1.6, alpha: 0.35, drag: 1, count: 1 });
      }
      if (t < -0.1 && Math.random() < 0.5) {
        this.steam.emit({ pos: new THREE.Vector3(PAD.x + (Math.random() - 0.5) * 0.45, PAD_TOP + 0.3, PAD.z + (Math.random() - 0.5) * 0.45), vel: new THREE.Vector3(0, -0.15, 0), spread: 0.03, color: '#cfe8ff', size: 0.035, grow: 1.5, life: 1.1, alpha: 0.12, drag: 1.5, count: 1 });
      }
    }
  }

  /** 仕上げ（トッピング） */
  topping(id: IngId | null): Promise<void> {
    return this.busyRun(async () => {
      if (!this.food) return;
      if (id) {
        this.dispenser.descend();
        await this.wait(0.35);
        this.dispenser.drizzle(id);
        await this.wait(0.25);
        this.food.setTopping(id);
        await this.wait(0.55);
        this.dispenser.ascend();
      } else {
        this.food.setTopping(null);
      }
    });
  }

  /** 器：アームがエレベーターから器を取り、ステージに置く。料理が降りて盛り付けられる */
  plate(vid: VesselId): Promise<void> {
    return this.busyRun(async () => {
      if (!this.food) return;
      const v = makeVessel(vid);
      this.vessel = v;
      const vg = v.group;
      // エレベーターで器がせり上がる
      this.kitchen.elevator.add(vg);
      vg.position.set(0, 0, 0);
      if (vid === 'cup') vg.rotation.y = CUP_TURN;
      await this.anim.tween(0.45, (k) => (this.kitchen.elevator.position.y = lerp(COUNTER_Y - 0.25, COUNTER_Y + 0.004, k)), ease.outCubic);
      // アームで縁をつまんで取る
      const lift = new THREE.Vector3(ELEVATOR.x, COUNTER_Y + 0.004, ELEVATOR.z);
      const h0 = await this.grab(v, lift);
      this.kitchen.elevator.position.y = COUNTER_Y - 0.25;
      // 背の高い器なら、料理を少し持ち上げてから差し込む
      const needBottom = PAD_TOP + v.rimY + 0.03;
      const f0 = this.food.group.position.y;
      if (f0 < needBottom) {
        const fg = this.food.group;
        await this.anim.tween(0.3, (k) => (fg.position.y = lerp(f0, needBottom, k)), ease.outCubic);
      }
      // 横からステージへ差し込む（浮いている料理の下へ）
      const padC = new THREE.Vector3(PAD.x, PAD_TOP, PAD.z);
      const hp = headingTo(padC);
      await this.carry(v, lift.clone().add(new THREE.Vector3(0, 0.12, 0)), h0, 0.25);
      await this.carry(v, new THREE.Vector3(PAD.x + 0.34, PAD_TOP + 0.06, PAD.z + 0.05), hp, 0.55);
      await this.putDown(v, padC, hp, this.stage.scene);
      await this.armTo(this.arm.target.clone().add(new THREE.Vector3(0, 0.25, 0)), -1.0, 0.3);
      this.setArmRest();
      // 料理を器へ降ろす
      const food = this.food;
      const from = food.group.position.clone();
      const to = new THREE.Vector3(PAD.x, PAD_TOP, PAD.z);
      if (food.isLiquid) {
        // 液体：球がしぼみながら器に注がれる
        await this.anim.tween(0.5, (k) => {
          food.group.position.lerpVectors(from, to.clone().add(new THREE.Vector3(0, 0.05, 0)), k);
          food.bodyRoot.scale.setScalar(1 - k * 0.9);
        }, ease.inQuad);
        food.bodyRoot.scale.setScalar(1);
        food.group.position.copy(to);
        food.placeInVessel(v);
        this.splash(to.clone().add(new THREE.Vector3(0, v.rimY * 0.8, 0)), food.comp.color);
      } else {
        food.placeInVessel(v);
        food.group.position.copy(from);
        await this.anim.tween(0.5, (k) => food.group.position.lerpVectors(from, to, k), ease.outBounce);
      }
      // 以後は器と一緒に動く（器は運ばれるあいだに回っているので、料理の向きは保ったまま載せる）
      vg.attach(food.group);
      food.group.position.set(0, 0, 0);
      this.kitchen.setFieldActive(false);
    });
  }

  private splash(p: THREE.Vector3, color: THREE.Color): void {
    this.sparks.emit({ pos: p, vel: new THREE.Vector3(0, 0.6, 0), spread: 0.12, color, size: 0.01, life: 0.5, gravity: 3, count: 16 });
  }

  /** 配膳：アームが器の縁を持ってトレイに載せ、トレイが客の前へ滑っていく */
  serve(): Promise<void> {
    return this.busyRun(async () => {
      const v = this.vessel;
      if (!v) return;
      const vg = v.group;
      const tray = this.kitchen.tray;
      const padC = new THREE.Vector3(PAD.x, PAD_TOP, PAD.z);
      const trayC = TRAY_KITCHEN.clone().add(new THREE.Vector3(0, TRAY_TOP, 0));
      const h0 = await this.grab(v, padC);
      const ht = headingTo(trayC);
      // 持ち上げてトレイの上へ。運びながら手首をひねり、トレイ側でも台座側の縁を持つ向きにする
      await this.carry(v, padC.clone().add(new THREE.Vector3(0, 0.24, 0)), h0, 0.35);
      await this.carry(v, padC.clone().lerp(trayC, 0.5).setY(trayC.y + 0.26), h0 + wrapAngle(ht - h0) * 0.5, 0.45);
      await this.putDown(v, trayC, ht, tray);
      await this.armTo(this.arm.target.clone().add(new THREE.Vector3(0, 0.25, 0)), -0.8, 0.3);
      this.setArmAttend();
      // トレイが滑る（客の前では料理を人に合う大きさへ）
      await this.anim.tween(
        1.0,
        (k) => {
          trayAt(k, tray.position);
          vg.scale.setScalar(lerp(1, SERVE_SCALE, k));
        },
        ease.inOutCubic,
      );
      this.vessel = null;
      this.servedHeatDecay = 1;
    });
  }

  /** 廃棄：料理（または混ぜかけの素材）を台の穴へ落とす */
  discard(): Promise<void> {
    return this.busyRun(async () => {
      this.dispenser.ascend();
      this.kitchen.irisOpen = 0;
      await this.anim.tween(0.25, (k) => (this.kitchen.irisOpen = k), ease.outCubic);
      const food = this.food;
      const vessel = this.vessel;
      if (food || vessel) {
        const obj = vessel ? vessel.group : food!.group;
        const from = obj.position.clone();
        await this.anim.tween(0.45, (k) => {
          obj.position.set(from.x, lerp(from.y, PAD_TOP - 0.2, k * k), from.z);
          obj.scale.setScalar(1 - k * 0.85);
        }, ease.linear);
        food?.dispose();
        vessel?.group.parent?.remove(vessel.group);
      }
      if (this.goo.count) {
        await this.anim.tween(0.35, (k) => (this.goo.collapse = k), ease.inQuad);
        this.goo.clear();
      }
      this.sparks.emit({ pos: new THREE.Vector3(PAD.x, PAD_TOP + 0.02, PAD.z), vel: new THREE.Vector3(0, 0.6, 0), spread: 0.15, color: '#ff5040', size: 0.01, life: 0.6, gravity: 2, count: 24 });
      this.food = null;
      this.vessel = null;
      this.setTemp(0, 0);
      await this.anim.tween(0.25, (k) => (this.kitchen.irisOpen = 1 - k), ease.inCubic);
      this.kitchen.setFieldActive(false);
    });
  }

  /** 次の客のために台をきれいにする（すでに配膳済みなら何もしない） */
  resetStation(): void {
    this.goo.clear();
    this.dispenser.ascend();
    this.kitchen.setFieldActive(false);
    this.setTemp(0, 0);
  }

  /** 客が食べ終わったあと、トレイと食器を片付ける */
  clearTray(): Promise<void> {
    return this.busyRun(async () => {
      const tray = this.kitchen.tray;
      const items = [...tray.children].filter((c) => c.type === 'Group');
      await this.anim.tween(0.3, (k) => items.forEach((i) => i.scale.setScalar(1 - k)), ease.inQuad);
      for (const i of items) {
        i.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
        });
        tray.remove(i);
      }
      this.food?.dispose();
      this.food = null;
      await this.anim.tween(0.8, (k) => trayAt(1 - k, tray.position), ease.inOutCubic);
    });
  }

  // ───────────── 客 ─────────────

  async customerArrive(look: Look): Promise<CustomerModel> {
    this.customer?.dispose();
    const c = new CustomerModel(look);
    this.customer = c;
    // 行列（右奥）から歩いてきて、配膳口の前で正面を向く
    const from = new THREE.Vector3(1.35, 0, SEAT.z - 0.35);
    const walkYaw = Math.atan2(SEAT.x - from.x, SEAT.z - from.z);
    c.root.position.copy(from);
    c.root.rotation.y = walkYaw;
    c.lookAt.copy(this.stage.camera.position);
    this.stage.scene.add(c.root);
    this.hall.advanceQueue();
    this.kitchen.setShutter(true);
    c.setWalk(1);
    c.setPose('hang');
    await this.anim.tween(1.7, (k) => c.root.position.lerpVectors(from, SEAT, k), ease.inOutQuad);
    c.setWalk(0);
    await this.anim.tween(0.4, (k) => (c.root.rotation.y = lerp(walkYaw, 0, k)), ease.outQuad);
    c.setPose('rest');
    return c;
  }

  async customerEat(onBite: (k: number) => void): Promise<void> {
    const c = this.customer;
    if (!c) return;
    c.setSpoon(true);
    c.lookAt.set(0, 1.0, TRAY_CUSTOMER.z);
    for (let i = 0; i < 3; i++) {
      c.setPose('eat');
      await this.wait(0.45);
      c.setMood('chew');
      onBite((i + 1) / 3);
      this.food?.setEaten((i + 1) / 3.4);
      await this.wait(0.7);
      c.setPose('rest');
      c.setMood('neutral');
      await this.wait(0.3);
    }
    c.setSpoon(false);
    c.lookAt.copy(this.stage.camera.position);
  }

  react(mood: Mood): void {
    const c = this.customer;
    if (!c) return;
    c.setMood(mood);
    switch (mood) {
      case 'delight':
        c.doJump();
        c.setPose('cheer');
        c.showEmote('♪', '#ffd166');
        this.sparks.emit({ pos: c.headWorld().add(new THREE.Vector3(0, 0.15, 0)), vel: new THREE.Vector3(0, 0.5, 0), spread: 0.3, color: '#ffd166', size: 0.015, life: 1, gravity: 0.5, count: 26 });
        break;
      case 'happy':
        c.doNod();
        c.showEmote('♪', '#9ff0c0');
        break;
      case 'neutral':
        c.doNod(0.5);
        c.showEmote('…', '#cfd8e0');
        break;
      case 'confused':
        c.setPose('shrug');
        c.showEmote('？', '#9fd8ff');
        break;
      case 'sad':
        c.setLean(0.12);
        c.showEmote('…', '#9fb8ff');
        break;
      case 'angry':
        c.doShake();
        c.setPose('fists');
        c.showEmote('！', '#ff5a5a');
        this.stage.addShake(0.2);
        break;
      case 'shock':
        c.setLean(-0.15);
        c.showEmote('！？', '#ffcf5a');
        break;
      default:
        break;
    }
  }

  async customerLeave(): Promise<void> {
    const c = this.customer;
    if (!c) return;
    c.setLean(0);
    // 左奥（客から見て右手）の出口へ。腕を下ろし、足踏みしながら進む方向へ向き直ってから、行き先を見て歩く
    const from = c.root.position.clone();
    const to = new THREE.Vector3(-1.6, 0, from.z - 0.5);
    const walkYaw = Math.atan2(to.x - from.x, to.z - from.z);
    const yaw0 = c.root.rotation.y;
    c.lookAt.set(to.x * 2 - from.x, 1.45, to.z * 2 - from.z);
    c.setPose('hang');
    c.setWalk(1);
    await this.anim.tween(0.4, (k) => (c.root.rotation.y = lerp(yaw0, walkYaw, k)), ease.inOutQuad);
    await this.anim.tween(1.4, (k) => c.root.position.lerpVectors(from, to, k), ease.inQuad);
    c.dispose();
    this.customer = null;
  }

  closeShutter(): void {
    this.kitchen.setShutter(false);
  }

  // ───────────── タイトル画面の飾り ─────────────

  private showcaseFood: Food | null = null;
  private showcaseGuest: CustomerModel | null = null;

  /** タイトル画面：反重力場に看板料理を浮かべ、配膳口の向こうに客を座らせる */
  showcase(on: boolean, look?: Look): void {
    this.showcaseFood?.dispose();
    this.showcaseFood = null;
    this.showcaseGuest?.dispose();
    this.showcaseGuest = null;
    if (!on) {
      this.kitchen.setFieldActive(false);
      this.setTemp(0, 0);
      return;
    }
    const ing = { grey: 0, brown: 0, white: 2, green: 0, yellow: 1, pink: 0, spice: 0, clear: 0, milk: 0, black: 0, red: 1, amber: 0 } as Record<IngId, number>;
    const f = new Food(ing, 'dome');
    f.setHeat(0.78);
    f.setTopping('red');
    f.group.position.copy(FOOD_FLOAT).add(new THREE.Vector3(0, -f.height / 2, 0));
    this.stage.scene.add(f.group);
    this.showcaseFood = f;
    this.kitchen.setFieldActive(true);
    this.kitchen.setTemp(0.78, 0);
    this.foodHeat = 0.5;
    if (look) {
      const c = new CustomerModel(look);
      c.root.position.copy(SEAT);
      c.lookAt.copy(FOOD_FLOAT);
      c.setMood('think');
      this.stage.scene.add(c.root);
      this.showcaseGuest = c;
    }
  }

  // ───────────── 入力 ─────────────

  pickTank(clientX: number, clientY: number): IngId | null {
    const el = this.stage.renderer.domElement;
    const r = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    const hit = this.raycaster.intersectObjects(this.tanks.pickables, false)[0];
    return hit ? (hit.object.userData.ing as IngId) : null;
  }

  /** ワールド座標 → 画面座標（CSS ピクセル） */
  project(v: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const el = this.stage.renderer.domElement;
    const p = v.clone().project(this.stage.camera);
    return { x: ((p.x + 1) / 2) * el.clientWidth, y: ((1 - p.y) / 2) * el.clientHeight, visible: p.z < 1 };
  }

  foodAnchor(): THREE.Vector3 {
    if (this.food) return this.food.topWorld().add(new THREE.Vector3(0, 0.08, 0));
    return FOOD_FLOAT.clone().add(new THREE.Vector3(0, 0.12, 0));
  }

  // ───────────── 毎フレーム ─────────────

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    this.anim.update(dt);
    this.kitchen.update(dt, t);
    this.tanks.update(dt, t);
    this.dispenser.update(dt, t);
    this.goo.update(dt, t);
    this.food?.update(dt, t);
    if (this.showcaseFood) {
      this.showcaseFood.update(dt, t);
      this.showcaseFood.group.rotation.y = t * 0.45;
      this.showcaseFood.group.position.y = FOOD_FLOAT.y - this.showcaseFood.height / 2 + Math.sin(t * 1.3) * 0.012;
      if (Math.random() < dt * 5) {
        const p = this.showcaseFood.topWorld();
        p.x += (Math.random() - 0.5) * 0.08;
        this.steam.emit({ pos: p, vel: new THREE.Vector3(0, 0.16, 0), spread: 0.02, color: '#e8f0f6', size: 0.022, grow: 2.2, life: 1.9, alpha: 0.07, drag: 0.4, count: 1 });
      }
    }
    this.showcaseGuest?.update(dt, t);
    this.arm.update(dt, t);
    this.hall.update(dt, t);
    this.customer?.update(dt, t);

    // アームの待機中のしぐさ
    if (!this.busy) {
      this.armIdleT += dt;
      if (this.armIdle === 'rest') {
        this.arm.target.y += Math.sin(t * 1.3) * 0.0006;
      }
    }

    // 湯気：熱い料理から立ちのぼる
    if (this.food) {
      // 配膳後は少しずつ冷めて、湯気も細くなる
      if (this.servedHeatDecay > 0) this.foodHeat *= Math.exp(-dt * 0.04);
      const heat = this.foodHeat;
      if (heat > 0.3) {
        this.steamAcc += dt * (heat - 0.25) * 10;
        while (this.steamAcc > 1) {
          this.steamAcc -= 1;
          const p = this.food.topWorld();
          p.x += (Math.random() - 0.5) * 0.08;
          p.z += (Math.random() - 0.5) * 0.08;
          p.y += 0.02;
          this.steam.emit({ pos: p, vel: new THREE.Vector3((Math.random() - 0.5) * 0.03, 0.14 + heat * 0.08, 0), spread: 0.02, color: '#e8f0f6', size: 0.022, grow: 2.2, life: 1.9, alpha: 0.07, drag: 0.4, count: 1 });
        }
      } else if (heat < -0.6) {
        this.steamAcc += dt * 4;
        while (this.steamAcc > 1) {
          this.steamAcc -= 1;
          const p = this.food.topWorld();
          p.x += (Math.random() - 0.5) * 0.1;
          this.steam.emit({ pos: p, vel: new THREE.Vector3(0, -0.06, 0), spread: 0.03, color: '#dff0ff', size: 0.02, grow: 1.5, life: 1.4, alpha: 0.09, drag: 0.8, count: 1 });
        }
      }
    }
    this.steam.update(dt);
    this.sparks.update(dt);
    this.stage.update(dt, t);
  }

  render(): void {
    this.stage.render();
  }
}
