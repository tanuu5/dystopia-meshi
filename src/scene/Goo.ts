import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import type { Ingredient } from '../data/types.ts';
import { FOOD_FLOAT } from './layout.ts';

// 投入された素材が混ざり合う「謎の物体」。メタボールをマーチングキューブで描く。
// 標準の addBall は色を足し算するので、ここでは重みで正規化した色を自前で書き込む。

interface Ball {
  color: THREE.Color;
  strength: number;
  home: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  phase: number;
  pop: number;
  liquid: boolean;
}

const RES = 30;

export class Goo {
  readonly mesh: MarchingCubes;
  private balls: Ball[] = [];
  private weights: Float32Array;
  private mat: THREE.MeshPhysicalMaterial;
  collapse = 0;
  private visibleGoal = 1;
  private shrink = 1;
  dirty = true;

  constructor() {
    this.mat = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.22,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      sheen: 0.4,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color('#ffffff'),
      envMapIntensity: 1.3,
    });
    this.mesh = new MarchingCubes(RES, this.mat, false, true, 60000);
    this.mesh.isolation = 80;
    this.mesh.position.copy(FOOD_FLOAT);
    this.mesh.scale.setScalar(0.22);
    this.mesh.castShadow = true;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.weights = new Float32Array(RES * RES * RES);
  }

  get count(): number {
    return this.balls.length;
  }

  /** 上から落ちてきた素材を加える（位置はフィールドの上端から） */
  add(ing: Ingredient): void {
    const n = this.balls.length;
    const a = n * 2.39996;
    const r = n === 0 ? 0 : 0.07 + 0.04 * Math.min(1, n / 4);
    const home = new THREE.Vector3(0.5 + Math.cos(a) * r, 0.48 + (n % 2) * 0.03, 0.5 + Math.sin(a) * r);
    const liquid = ing.kind === 'liquid';
    this.balls.push({
      color: new THREE.Color(ing.color),
      strength: liquid ? 0.5 : 0.44,
      home,
      pos: new THREE.Vector3(home.x, 0.86, home.z),
      vel: new THREE.Vector3(0, -0.6, 0),
      phase: Math.random() * 10,
      pop: 1,
      liquid,
    });
    this.mesh.visible = true;
    this.visibleGoal = 1;
    this.shrink = 1;
    this.collapse = 0;
  }

  removeLast(): void {
    this.balls.pop();
    if (!this.balls.length) this.mesh.visible = false;
  }

  clear(): void {
    this.balls = [];
    this.mesh.visible = false;
    this.collapse = 0;
    this.shrink = 1;
  }

  hide(): void {
    this.visibleGoal = 0;
  }

  /** 平均色（成形後の料理の色に使う） */
  averageColor(): THREE.Color {
    const c = new THREE.Color(0, 0, 0);
    if (!this.balls.length) return c.set('#888');
    for (const b of this.balls) c.add(b.color);
    return c.multiplyScalar(1 / this.balls.length);
  }

  update(dt: number, time: number): void {
    if (!this.mesh.visible) return;
    if (this.visibleGoal === 0) {
      this.shrink = Math.max(0, this.shrink - dt * 4);
      if (this.shrink <= 0) {
        this.mesh.visible = false;
        return;
      }
    }
    const mc = this.mesh;
    const field = mc.field as Float32Array;
    const palette = mc.palette as Float32Array;
    const size = mc.size as number;
    const size2 = size * size;
    field.fill(0);
    palette.fill(0);
    this.weights.fill(0);
    (mc.normal_cache as Float32Array).fill(0);

    const n = this.balls.length;
    const subtract = 12;
    const strengthScale = (1.2 / ((Math.sqrt(Math.max(1, n)) - 1) / 4 + 1)) * this.shrink;
    for (const b of this.balls) {
      // バネで定位置へ。ゆらゆら揺れる
      const target = b.home.clone();
      target.x += Math.sin(time * 1.3 + b.phase) * 0.03 * (1 - this.collapse);
      target.y += Math.sin(time * 1.7 + b.phase * 2) * 0.025 * (1 - this.collapse);
      target.z += Math.cos(time * 1.1 + b.phase) * 0.03 * (1 - this.collapse);
      target.lerp(new THREE.Vector3(0.5, 0.5, 0.5), this.collapse);
      const acc = target.sub(b.pos).multiplyScalar(40);
      b.vel.addScaledVector(acc, dt);
      b.vel.multiplyScalar(Math.exp(-5 * dt));
      b.pos.addScaledVector(b.vel, dt);
      b.pop = Math.max(0, b.pop - dt * 2.5);
      const strength = b.strength * strengthScale * (1 + b.pop * 0.35 * Math.sin(b.pop * 18));
      this.addBall(field, palette, size, size2, b.pos, strength, subtract, b.color);
    }
    // 色を正規化
    for (let i = 0; i < this.weights.length; i++) {
      const w = this.weights[i];
      if (w > 0) {
        palette[i * 3] /= w;
        palette[i * 3 + 1] /= w;
        palette[i * 3 + 2] /= w;
      }
    }
    mc.update();
  }

  private addBall(field: Float32Array, palette: Float32Array, size: number, size2: number, p: THREE.Vector3, strength: number, subtract: number, color: THREE.Color): void {
    const radius = size * Math.sqrt(strength / subtract);
    const zs = p.z * size;
    const ys = p.y * size;
    const xs = p.x * size;
    const minZ = Math.max(1, Math.floor(zs - radius));
    const maxZ = Math.min(size - 1, Math.floor(zs + radius));
    const minY = Math.max(1, Math.floor(ys - radius));
    const maxY = Math.min(size - 1, Math.floor(ys + radius));
    const minX = Math.max(1, Math.floor(xs - radius));
    const maxX = Math.min(size - 1, Math.floor(xs + radius));
    for (let z = minZ; z < maxZ; z++) {
      const zo = size2 * z;
      const fz = z / size - p.z;
      const fz2 = fz * fz;
      for (let y = minY; y < maxY; y++) {
        const yo = zo + size * y;
        const fy = y / size - p.y;
        const fy2 = fy * fy;
        for (let x = minX; x < maxX; x++) {
          const fx = x / size - p.x;
          const val = strength / (0.000001 + fx * fx + fy2 + fz2) - subtract;
          if (val > 0) {
            const idx = yo + x;
            field[idx] += val;
            const w = val;
            this.weights[idx] += w;
            palette[idx * 3] += color.r * w;
            palette[idx * 3 + 1] += color.g * w;
            palette[idx * 3 + 2] += color.b * w;
          }
        }
      }
    }
  }
}
