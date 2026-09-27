import * as THREE from 'three';
import { INGREDIENTS } from '../data/ingredients.ts';
import type { IngId, Ingredient } from '../data/types.ts';
import { mats, emissive } from './materials.ts';
import { labelTexture, noiseTexture } from './textures.ts';
import { COUNTER_Y, TANK_H, TANK_R, TANK_RACKS } from './layout.ts';
import { damp } from '../util/anim.ts';
import { mergeByMaterial } from './merge.ts';

interface Tank {
  ing: Ingredient;
  group: THREE.Group;
  contentMat: THREE.MeshPhysicalMaterial;
  content: THREE.Object3D;
  bubbles: THREE.InstancedMesh | null;
  bubbleSeeds: number[];
  led: THREE.Mesh;
  labelMat: THREE.MeshBasicMaterial;
  rim: THREE.Mesh;
  pickable: THREE.Mesh;
  top: THREE.Vector3;
  pipeTop: THREE.Vector3;
  activity: number;
  hover: number;
  shortage: boolean;
  level: number;
}

interface Pulse {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
}

const BASE_H = 0.07;
const HL_MAT = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false });

export class Tanks {
  readonly group = new THREE.Group();
  readonly pickables: THREE.Mesh[] = [];
  private tanks = new Map<IngId, Tank>();
  private pulses: Pulse[] = [];
  private pulseGeo = new THREE.SphereGeometry(0.018, 12, 8);
  private dummy = new THREE.Object3D();

  constructor() {
    INGREDIENTS.forEach((ing, i) => {
      const rack = TANK_RACKS[i < 6 ? 0 : 1];
      const k = i % 6;
      const col = k % 3;
      const row = Math.floor(k / 3);
      const x = rack.x + (col - 1) * 0.175;
      const z = rack.z + (row === 0 ? -0.13 : 0.13);
      this.tanks.set(ing.id, this.buildTank(ing, x, z));
    });
    // 動かない部品（台座・ガラス・ふた・配管）はタンクをまたいでまとめる
    this.group.updateMatrixWorld(true);
    for (const t of this.tanks.values()) {
      for (const c of [...t.group.children]) if (c.userData.static) this.group.attach(c);
    }
    mergeByMaterial(this.group);
  }

  private buildTank(ing: Ingredient, x: number, z: number): Tank {
    const M = mats();
    const group = new THREE.Group();
    group.position.set(x, COUNTER_Y + BASE_H, z);
    this.group.add(group);
    const color = new THREE.Color(ing.color);

    // 土台
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(TANK_R + 0.014, TANK_R + 0.018, 0.045, 32), M.steelDark);
    collar.position.y = 0.0225;
    collar.castShadow = true;
    group.add(collar);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(TANK_R + 0.015, 0.004, 8, 40), emissive(color, 1.2));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.046;
    group.add(rim);

    // 中身
    const fill = 0.78;
    const innerR = TANK_R - 0.007;
    const h = TANK_H * fill;
    const contentMat = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.25,
      metalness: 0,
      clearcoat: 0.6,
      emissive: color,
      emissiveIntensity: 0.12,
    });
    let content: THREE.Object3D;
    let bubbles: THREE.InstancedMesh | null = null;
    const bubbleSeeds: number[] = [];
    const y0 = 0.05;
    switch (ing.kind) {
      case 'liquid': {
        if (ing.id === 'clear') {
          contentMat.transparent = true;
          contentMat.opacity = 0.45;
          contentMat.emissiveIntensity = 0.35;
          contentMat.roughness = 0.05;
        }
        if (ing.id === 'milk') contentMat.emissiveIntensity = 0.05;
        if (ing.id === 'black') {
          contentMat.emissive.set('#3a1a08');
          contentMat.emissiveIntensity = 0.25;
          contentMat.roughness = 0.08;
        }
        const m = new THREE.Mesh(new THREE.CylinderGeometry(innerR, innerR, h, 32), contentMat);
        m.position.y = y0 + h / 2;
        content = m;
        bubbles = new THREE.InstancedMesh(
          new THREE.SphereGeometry(1, 8, 6),
          new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color('#ffffff'), 0.6), transparent: true, opacity: 0.55, depthWrite: false }),
          10,
        );
        for (let i = 0; i < 10; i++) bubbleSeeds.push(Math.random());
        bubbles.position.y = y0;
        group.add(bubbles);
        break;
      }
      case 'grain': {
        const noise = noiseTexture(128, 1.4);
        noise.repeat.set(3, 3);
        contentMat.roughness = 0.85;
        contentMat.clearcoat = 0;
        contentMat.bumpMap = noise;
        contentMat.bumpScale = 1.5;
        contentMat.emissiveIntensity = 0.04;
        const m = new THREE.Mesh(new THREE.CylinderGeometry(innerR, innerR, h, 32), contentMat);
        m.position.y = y0 + h / 2;
        const heap = new THREE.Mesh(new THREE.SphereGeometry(innerR, 24, 8, 0, Math.PI * 2, 0, Math.PI / 5), contentMat);
        heap.scale.y = 0.9;
        heap.position.y = y0 + h - innerR * 0.8;
        const grp = new THREE.Group();
        grp.add(m, heap);
        content = grp;
        break;
      }
      case 'solid': {
        // 灰色キューブを積んだもの
        contentMat.roughness = 0.55;
        contentMat.clearcoat = 0.2;
        contentMat.emissiveIntensity = 0.03;
        const n = 34;
        const cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.036, 0.036, 0.036), contentMat, n);
        for (let i = 0; i < n; i++) {
          const layer = Math.floor(i / 5);
          const a = (i % 5) * ((Math.PI * 2) / 5) + layer * 0.7;
          const r = i % 5 === 4 ? 0 : innerR * 0.55;
          this.dummy.position.set(Math.cos(a) * r, y0 + 0.02 + layer * 0.036, Math.sin(a) * r);
          this.dummy.rotation.set(Math.random(), Math.random(), Math.random());
          this.dummy.updateMatrix();
          cubes.setMatrixAt(i, this.dummy.matrix);
        }
        cubes.castShadow = true;
        content = cubes;
        break;
      }
      case 'crystal': {
        contentMat.roughness = 0.1;
        contentMat.clearcoat = 1;
        contentMat.emissiveIntensity = 0.35;
        contentMat.flatShading = true;
        const n = 60;
        const cr = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.016), contentMat, n);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * innerR * 0.85;
          this.dummy.position.set(Math.cos(a) * r, y0 + 0.01 + (i / n) * h, Math.sin(a) * r);
          this.dummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
          this.dummy.scale.setScalar(0.7 + Math.random() * 0.6);
          this.dummy.updateMatrix();
          cr.setMatrixAt(i, this.dummy.matrix);
        }
        content = cr;
        break;
      }
      default: {
        // paste / gel / powder：上面が波打つ円柱
        const geo = new THREE.CylinderGeometry(innerR, innerR, h, 32, 6);
        const pos = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const yy = pos.getY(i);
          if (yy > h / 2 - 0.001) {
            const ax = pos.getX(i);
            const az = pos.getZ(i);
            pos.setY(i, yy + Math.sin(ax * 90) * 0.006 + Math.cos(az * 70) * 0.006);
          }
        }
        geo.computeVertexNormals();
        if (ing.kind === 'gel') {
          contentMat.transparent = true;
          contentMat.opacity = 0.88;
          contentMat.roughness = 0.1;
          contentMat.emissiveIntensity = 0.3;
        } else if (ing.kind === 'powder') {
          contentMat.roughness = 0.9;
          contentMat.clearcoat = 0;
          contentMat.emissiveIntensity = 0.25;
          const noise = noiseTexture(128, 1.2);
          noise.repeat.set(3, 3);
          contentMat.bumpMap = noise;
          contentMat.bumpScale = 1;
        } else {
          contentMat.roughness = 0.3;
          contentMat.emissiveIntensity = 0.08;
        }
        const m = new THREE.Mesh(geo, contentMat);
        m.position.y = y0 + h / 2;
        content = m;
      }
    }
    group.add(content);

    // ガラス
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(TANK_R, TANK_R, TANK_H, 40, 1, true), M.glass);
    glass.position.y = 0.045 + TANK_H / 2;
    glass.renderOrder = 2;
    group.add(glass);
    // ガラスのハイライト（縦の細い反射）
    const hl = new THREE.Mesh(new THREE.PlaneGeometry(0.008, TANK_H * 0.85), HL_MAT);
    for (const s of [glass, hl]) s.userData.static = true;
    hl.position.set(-TANK_R * 0.55, 0.045 + TANK_H / 2, TANK_R * 0.82);
    hl.rotation.y = -0.5;
    group.add(hl);

    // ふた・配管
    const capY = 0.045 + TANK_H;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(TANK_R + 0.01, TANK_R + 0.012, 0.035, 32), M.steelDark);
    cap.position.y = capY + 0.0175;
    cap.castShadow = true;
    group.add(cap);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), emissive(color, 2.2));
    led.position.set(0, capY + 0.03, TANK_R * 0.6);
    group.add(led);
    const pipeLen = 2.9 - (COUNTER_Y + BASE_H + capY);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, pipeLen, 10), M.steel);
    pipe.position.y = capY + 0.035 + pipeLen / 2;
    group.add(pipe);
    const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 12), M.blackMetal);
    joint.position.y = capY + 0.05;
    group.add(joint);
    for (const s of [collar, cap, pipe, joint]) s.userData.static = true;

    // ラベル
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTexture(ing.code, ing.name, ing.color), toneMapped: false, color: '#9aa7b2' });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.095), labelMat);
    label.position.set(0, 0.02, TANK_R + 0.04);
    label.rotation.x = -0.9;
    group.add(label);

    // 当たり判定（見えない少し太い円柱）
    const pickable = new THREE.Mesh(new THREE.CylinderGeometry(TANK_R + 0.03, TANK_R + 0.03, TANK_H + 0.12, 12), new THREE.MeshBasicMaterial({ visible: false }));
    pickable.position.y = 0.045 + TANK_H / 2;
    pickable.userData.ing = ing.id;
    group.add(pickable);
    this.pickables.push(pickable);

    const top = new THREE.Vector3(0, capY + 0.05, 0).add(group.position);
    const pipeTop = new THREE.Vector3(0, 2.9, 0).add(new THREE.Vector3(group.position.x, 0, group.position.z));
    return {
      ing,
      group,
      contentMat,
      content,
      bubbles,
      bubbleSeeds,
      led,
      labelMat,
      rim,
      pickable,
      top,
      pipeTop,
      activity: 0,
      hover: 0,
      shortage: false,
      level: 1,
    };
  }

  /** 投入の演出：タンクが泡立ち、配管を光が昇る */
  pulse(id: IngId): void {
    const t = this.tanks.get(id);
    if (!t) return;
    t.activity = 1;
    t.level = Math.max(0.35, t.level - 0.03);
    const mesh = new THREE.Mesh(this.pulseGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(t.ing.color).multiplyScalar(3), toneMapped: false }));
    mesh.position.copy(t.top);
    this.group.add(mesh);
    this.pulses.push({ mesh, from: t.top.clone(), to: t.pipeTop.clone(), t: 0 });
  }

  setShortages(ids: IngId[]): void {
    for (const [id, t] of this.tanks) {
      t.shortage = ids.includes(id);
      t.level = t.shortage ? 0.06 : 1;
    }
  }

  setHover(id: IngId | null): void {
    for (const [tid, t] of this.tanks) t.hover = tid === id ? 1 : 0;
  }

  refill(): void {
    for (const t of this.tanks.values()) if (!t.shortage) t.level = 1;
  }

  screenAnchor(id: IngId): THREE.Vector3 {
    const t = this.tanks.get(id)!;
    return t.group.position.clone().add(new THREE.Vector3(0, TANK_H + 0.1, 0));
  }

  update(dt: number, time: number): void {
    for (const t of this.tanks.values()) {
      t.activity = Math.max(0, t.activity - dt * 1.6);
      const hv = t.hover;
      const ledMat = t.led.material as THREE.MeshStandardMaterial;
      if (t.shortage) {
        ledMat.emissive.set('#ff2030');
        ledMat.emissiveIntensity = Math.sin(time * 7) > 0 ? 4 : 0.2;
      } else {
        ledMat.emissive.set(t.ing.color);
        ledMat.emissiveIntensity = 1.6 + t.activity * 6 + hv * 2;
      }
      (t.rim.material as THREE.MeshStandardMaterial).emissiveIntensity = t.shortage ? 0.2 : 1 + hv * 3 + t.activity * 4;
      const baseEm = t.ing.kind === 'liquid' ? (t.ing.id === 'clear' ? 0.35 : t.ing.id === 'milk' ? 0.05 : 0.12) : t.ing.kind === 'crystal' ? 0.35 : 0.08;
      t.contentMat.emissiveIntensity = baseEm + t.activity * 0.8 + hv * 0.25;
      t.labelMat.color.setScalar(0.6 + hv * 0.4 + t.activity * 0.4);
      // 液面の高さ
      const fill = t.level;
      t.content.scale.y += (fill - t.content.scale.y) * damp(3, dt);
      if (t.bubbles) {
        const n = t.bubbles.count;
        const hMax = TANK_H * 0.78 * t.content.scale.y;
        for (let i = 0; i < n; i++) {
          const s = t.bubbleSeeds[i];
          const speed = 0.05 + s * 0.05 + t.activity * 0.35;
          const y = ((time * speed + s * 7.1) % 1) * hMax;
          const a = s * 40 + time * 0.5;
          const r = (TANK_R - 0.02) * (0.3 + 0.6 * ((s * 13.7) % 1));
          this.dummy.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
          this.dummy.rotation.set(0, 0, 0);
          this.dummy.scale.setScalar(0.003 + s * 0.004 + t.activity * 0.003);
          this.dummy.updateMatrix();
          t.bubbles.setMatrixAt(i, this.dummy.matrix);
        }
        t.bubbles.instanceMatrix.needsUpdate = true;
      }
    }
    // 配管を昇る光
    for (const p of this.pulses) {
      p.t += dt * 2.8;
      p.mesh.position.lerpVectors(p.from, p.to, Math.min(1, p.t));
      p.mesh.scale.setScalar(1 + Math.sin(p.t * 20) * 0.2);
    }
    const done = this.pulses.filter((p) => p.t >= 1);
    for (const p of done) {
      this.group.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    if (done.length) this.pulses = this.pulses.filter((p) => p.t < 1);
  }
}
