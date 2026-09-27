import * as THREE from 'three';
import { INGREDIENTS, ING } from '../data/ingredients.ts';
import type { IngId } from '../data/types.ts';
import { mats, emissive } from './materials.ts';
import { DISPENSER_ACTIVE_Y, DISPENSER_IDLE_Y, FOOD_FLOAT } from './layout.ts';
import { damp } from '../util/anim.ts';
import { mergeByMaterial } from './merge.ts';

interface Drop {
  id: IngId;
  mesh: THREE.Mesh;
  vel: number;
  targetY: number;
  resolve: () => void;
  stream: boolean;
}

// 天井から降りてくる投入ヘッド。12 本のノズルと、中央の成形ピストンを持つ。
export class Dispenser {
  readonly group = new THREE.Group();
  readonly head = new THREE.Group();
  private nozzles = new Map<IngId, { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; pos: THREE.Vector3; glow: number }>();
  private piston: THREE.Group;
  private pistonExt = 0;
  private pistonGoal = 0;
  private moldMesh: THREE.Mesh | null = null;
  private y = DISPENSER_IDLE_Y;
  private yGoal = DISPENSER_IDLE_Y;
  private drops: Drop[] = [];
  private ringMat: THREE.MeshStandardMaterial;
  private streams: { mesh: THREE.Mesh; life: number; max: number }[] = [];
  onLand: ((id: IngId, pos: THREE.Vector3) => void) | null = null;

  constructor() {
    const M = mats();
    const head = this.head;
    // 本体
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.105, 0.14, 48), M.plastic);
    body.position.y = 0.08;
    body.castShadow = true;
    head.add(body);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.122, 0.122, 0.028, 48), M.gunmetal);
    band.position.y = 0.12;
    head.add(band);
    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.098, 0.02, 48), M.blackMetal);
    bottom.position.y = -0.01;
    head.add(bottom);
    this.ringMat = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#35e0ff', emissiveIntensity: 1.5 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.005, 8, 64), this.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.0;
    head.add(ring);
    // 上に伸びるホースの束
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.6, 8), M.rubber);
      hose.position.set(Math.cos(a) * 0.06, 0.14 + 0.8, Math.sin(a) * 0.06);
      head.add(hose);
    }
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 16), M.steelDark);
    spine.position.y = 0.96;
    head.add(spine);

    // ノズル（素材ごと）
    INGREDIENTS.forEach((ing, i) => {
      const a = (i / INGREDIENTS.length) * Math.PI * 2 + Math.PI / 12;
      const r = 0.08;
      const mat = emissive(ing.color, 0.6);
      const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.006, 0.035, 10), M.steelDark);
      nz.position.set(Math.cos(a) * r, -0.035, Math.sin(a) * r);
      head.add(nz);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), mat);
      tip.position.set(Math.cos(a) * r, -0.054, Math.sin(a) * r);
      head.add(tip);
      this.nozzles.set(ing.id, { mesh: tip, mat, pos: tip.position.clone(), glow: 0 });
    });

    // 中央の成形ピストン
    this.piston = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.6, 16), M.steel);
    rod.position.y = 0.3;
    this.piston.add(rod);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 32), M.gunmetal);
    foot.position.y = 0.0;
    this.piston.add(foot);
    this.piston.position.y = -0.02;
    head.add(this.piston);

    // ノズルの筒やホースはまとめる（光るノズル先端は個別に残す）
    mergeByMaterial(head, new Set<THREE.Object3D>([...this.nozzles.values()].map((n) => n.mesh)));
    this.group.add(head);
    this.group.position.set(FOOD_FLOAT.x, this.y, FOOD_FLOAT.z);
  }

  get active(): boolean {
    return this.yGoal < DISPENSER_IDLE_Y - 0.01;
  }

  descend(): void {
    this.yGoal = DISPENSER_ACTIVE_Y;
  }

  ascend(): void {
    this.yGoal = DISPENSER_IDLE_Y;
  }

  /** 素材を一滴落とす。着地したら resolve */
  drop(id: IngId): Promise<void> {
    const nz = this.nozzles.get(id)!;
    nz.glow = 1;
    const ing = ING[id];
    const liquid = ing.kind === 'liquid';
    const r = liquid ? 0.024 : ing.kind === 'solid' ? 0.026 : 0.022;
    const geo = ing.kind === 'solid' ? new THREE.BoxGeometry(r * 1.5, r * 1.5, r * 1.5) : ing.kind === 'crystal' ? new THREE.OctahedronGeometry(r * 1.2) : new THREE.SphereGeometry(r, 16, 12);
    const mat = new THREE.MeshPhysicalMaterial({
      color: ing.color,
      roughness: liquid ? 0.1 : 0.4,
      clearcoat: 0.8,
      emissive: ing.color,
      emissiveIntensity: 0.15,
      transparent: ing.id === 'clear',
      opacity: ing.id === 'clear' ? 0.7 : 1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const world = this.head.localToWorld(nz.pos.clone());
    mesh.position.copy(world);
    mesh.castShadow = true;
    this.group.parent?.add(mesh);
    if (liquid) this.spawnStream(world, ing.color);
    return new Promise((resolve) => {
      this.drops.push({ id, mesh, vel: -0.4, targetY: FOOD_FLOAT.y + 0.03, resolve, stream: liquid });
    });
  }

  private spawnStream(from: THREE.Vector3, color: string): void {
    const len = from.y - FOOD_FLOAT.y;
    const geo = new THREE.CylinderGeometry(0.006, 0.009, len, 8, 1, true);
    geo.translate(0, -len / 2, 0);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.3), transparent: true, opacity: 0.85, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from);
    mesh.scale.y = 0.01;
    this.group.parent?.add(mesh);
    this.streams.push({ mesh, life: 0.45, max: 0.45 });
  }

  /** 成形：ピストンに型をつけて押し下げる */
  async press(mold: THREE.BufferGeometry | null, wait: (s: number) => Promise<void>): Promise<void> {
    if (this.moldMesh) {
      this.piston.remove(this.moldMesh);
      this.moldMesh = null;
    }
    if (mold) {
      this.moldMesh = new THREE.Mesh(mold, mats().steel);
      this.moldMesh.position.y = -0.03;
      this.piston.add(this.moldMesh);
    }
    this.pistonGoal = 1;
    await wait(0.42);
    this.pistonGoal = 0;
  }

  /** 営業を打ち切るとき：落ちている素材と糸を消し、ピストンを戻して上へ（落下を待つ流れは進まなくなる） */
  reset(): void {
    for (const d of this.drops) {
      d.mesh.parent?.remove(d.mesh);
      d.mesh.geometry.dispose();
      (d.mesh.material as THREE.Material).dispose();
    }
    this.drops = [];
    for (const s of this.streams) {
      s.mesh.parent?.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
    this.streams = [];
    this.pistonGoal = 0;
    this.ascend();
  }

  /** トッピングの糸を垂らす */
  drizzle(id: IngId): void {
    const nz = this.nozzles.get(id)!;
    nz.glow = 1;
    const world = this.head.localToWorld(nz.pos.clone());
    this.spawnStream(world, ING[id].color);
    const s = this.streams[this.streams.length - 1];
    s.life = s.max = 0.9;
  }

  update(dt: number, time: number): void {
    this.y += (this.yGoal - this.y) * damp(5, dt);
    this.group.position.y = this.y;
    this.head.rotation.y = Math.sin(time * 0.4) * 0.05;
    this.pistonExt += (this.pistonGoal - this.pistonExt) * damp(this.pistonGoal > this.pistonExt ? 16 : 6, dt);
    const reach = this.y - (FOOD_FLOAT.y + 0.1);
    this.piston.position.y = -0.02 - this.pistonExt * Math.max(0, reach);
    this.ringMat.emissiveIntensity = 1.2 + Math.sin(time * 4) * 0.4 + (this.active ? 1 : 0);
    for (const nz of this.nozzles.values()) {
      nz.glow = Math.max(0, nz.glow - dt * 2);
      nz.mat.emissiveIntensity = 0.5 + nz.glow * 8;
    }
    // 落下する素材
    const landed: Drop[] = [];
    for (const d of this.drops) {
      d.vel -= 5.5 * dt;
      d.mesh.position.y += d.vel * dt;
      d.mesh.rotation.x += dt * 4;
      d.mesh.scale.y = 1 + Math.min(0.6, -d.vel * 0.25);
      if (d.mesh.position.y <= d.targetY) landed.push(d);
    }
    for (const d of landed) {
      this.onLand?.(d.id, d.mesh.position.clone());
      d.mesh.parent?.remove(d.mesh);
      d.mesh.geometry.dispose();
      (d.mesh.material as THREE.Material).dispose();
      d.resolve();
    }
    if (landed.length) this.drops = this.drops.filter((d) => !landed.includes(d));
    // 液体の糸
    for (const s of this.streams) {
      s.life -= dt;
      const k = s.life / s.max;
      s.mesh.scale.y = Math.min(1, (1 - k) * 4);
      s.mesh.scale.x = s.mesh.scale.z = Math.max(0.05, Math.min(1, k * 3));
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.85, k * 2);
    }
    const dead = this.streams.filter((s) => s.life <= 0);
    for (const s of dead) {
      s.mesh.parent?.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
    if (dead.length) this.streams = this.streams.filter((s) => s.life > 0);
  }
}
