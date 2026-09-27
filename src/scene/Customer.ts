import * as THREE from 'three';
import type { Look } from '../data/characters.ts';
import { FaceCanvas, EXPRESSIONS, emoteTexture, type Expression } from './Face.ts';
import { damp } from '../util/anim.ts';

// 市民の 3D モデル。配膳口の向こうに座り、表情と身ぶりで反応する。

export type Mood = 'neutral' | 'happy' | 'delight' | 'confused' | 'sad' | 'angry' | 'shock' | 'think' | 'sleepy' | 'chew';
type ArmPose = { sx: number; sz: number; ex: number };
export type Pose = 'rest' | 'eat' | 'cheer' | 'shrug' | 'fists' | 'chin' | 'hang';

const POSES: Record<Pose, { r: ArmPose; l: ArmPose }> = {
  rest: { r: { sx: -0.75, sz: 0.12, ex: -0.75 }, l: { sx: -0.75, sz: -0.12, ex: -0.75 } },
  hang: { r: { sx: 0.05, sz: 0.1, ex: -0.12 }, l: { sx: 0.05, sz: -0.1, ex: -0.12 } },
  eat: { r: { sx: -1.25, sz: 0.28, ex: -2.25 }, l: { sx: -0.75, sz: -0.12, ex: -0.75 } },
  cheer: { r: { sx: -2.9, sz: 0.35, ex: -0.3 }, l: { sx: -2.9, sz: -0.35, ex: -0.3 } },
  shrug: { r: { sx: -0.4, sz: 0.7, ex: -1.4 }, l: { sx: -0.4, sz: -0.7, ex: -1.4 } },
  fists: { r: { sx: -1.1, sz: 0.2, ex: -1.6 }, l: { sx: -1.1, sz: -0.2, ex: -1.6 } },
  chin: { r: { sx: -1.0, sz: 0.25, ex: -2.35 }, l: { sx: -0.75, sz: -0.12, ex: -0.75 } },
};

interface Arm {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  hand: THREE.Mesh;
  cur: ArmPose;
}

export class CustomerModel {
  readonly root = new THREE.Group();
  readonly look: Look;
  private body = new THREE.Group();
  private torso = new THREE.Group();
  private headPivot = new THREE.Group();
  private head = new THREE.Group();
  private face: FaceCanvas;
  private arms: { r: Arm; l: Arm };
  private spoon: THREE.Group;
  private emoteSprite: THREE.Sprite;
  private emoteLife = 0;
  private pose: Pose = 'rest';
  private expr: Expression = { eyes: 'open', mouth: 'neutral', brows: 'neutral', blush: 0, sweat: false, tear: false, lookX: 0, lookY: 0 };
  private moodName: Mood = 'neutral';
  private talking = false;
  private talkPhase = 0;
  private blinkT = 2;
  private blinking = 0;
  private chewing = 0;
  private bob = 0;
  private walk = 0;
  readonly lookAt = new THREE.Vector3(0, 1.9, 1.8);
  private headGoal = new THREE.Euler();
  private nod = 0;
  private shake = 0;
  private lean = 0;
  private leanGoal = 0;
  private jump = 0;
  readonly headR: number;
  readonly hipY: number;
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private breathe = Math.random() * 10;

  constructor(look: Look, opts: { standing?: boolean } = {}) {
    this.look = look;
    const child = look.body === 'child';
    const elder = look.body === 'elder';
    const s = child ? 0.78 : elder ? 0.96 : 1;
    const headR = child ? 0.108 : 0.112;
    this.headR = headR;
    this.hipY = opts.standing ? (child ? 0.62 : 0.84) : child ? 0.8 : 0.72;
    this.face = new FaceCanvas(look);

    const skin = this.mat(new THREE.MeshPhysicalMaterial({ color: look.skin, roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color('#ffd8c8'), clearcoat: 0.05 }));
    const cloth = this.mat(new THREE.MeshStandardMaterial({ color: look.outfit, roughness: 0.85 }));
    const accent = this.mat(new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.6 }));
    const hairMat = this.mat(new THREE.MeshPhysicalMaterial({ color: look.hair, roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color(look.hair).lerp(new THREE.Color('#ffffff'), 0.4) }));

    this.root.add(this.body);
    this.body.position.y = this.hipY;
    this.body.add(this.torso);

    // 胴体
    const tp = [
      [0, 0],
      [0.15, 0],
      [0.165, 0.1],
      [0.182, 0.3],
      [0.186, 0.38],
      [0.172, 0.44],
      [0.12, 0.49],
      [0.055, 0.51],
      [0, 0.51],
    ].map(([x, y]) => new THREE.Vector2(x * s, y * s));
    const torsoGeo = this.geo(new THREE.LatheGeometry(tp, 32));
    const torsoMesh = new THREE.Mesh(torsoGeo, cloth);
    torsoMesh.scale.z = 0.66;
    torsoMesh.castShadow = true;
    torsoMesh.receiveShadow = true;
    this.torso.add(torsoMesh);
    // 襟と胸の番号札
    const collar = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.06 * s, 0.018 * s, 10, 24)), accent);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.49 * s;
    collar.scale.z = 0.8;
    this.torso.add(collar);
    const badge = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(0.07 * s, 0.035 * s)),
      this.mat(new THREE.MeshStandardMaterial({ color: '#0b0f14', emissive: look.accent, emissiveIntensity: 0.35 })),
    );
    badge.position.set(0.075 * s, 0.34 * s, 0.123 * s);
    badge.rotation.y = 0.35;
    this.torso.add(badge);
    // ボタン
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.008 * s, 8, 6)), accent);
      b.position.set(0, (0.18 + i * 0.09) * s, 0.12 * s);
      this.torso.add(b);
    }

    // 腕
    const mkArm = (side: 1 | -1): Arm => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.2 * s, 0.43 * s, 0);
      this.torso.add(shoulder);
      const upper = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.043 * s, 0.17 * s, 6, 14)), cloth);
      upper.position.y = -0.11 * s;
      upper.castShadow = true;
      shoulder.add(upper);
      const band = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.047 * s, 0.047 * s, 0.03 * s, 16)), accent);
      band.position.y = -0.08 * s;
      shoulder.add(band);
      const elbow = new THREE.Group();
      elbow.position.y = -0.22 * s;
      shoulder.add(elbow);
      const fore = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.038 * s, 0.15 * s, 6, 14)), cloth);
      fore.position.y = -0.1 * s;
      fore.castShadow = true;
      elbow.add(fore);
      const hand = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.04 * s, 16, 12)), skin);
      hand.position.y = -0.21 * s;
      hand.scale.set(1, 1.1, 0.8);
      elbow.add(hand);
      return { shoulder, elbow, hand, cur: { ...POSES.rest.r, sz: side * 0.12 } };
    };
    this.arms = { r: mkArm(-1), l: mkArm(1) };
    // 右手のスプーン
    this.spoon = new THREE.Group();
    const spoonMat = this.mat(new THREE.MeshStandardMaterial({ color: '#c9d0d6', metalness: 1, roughness: 0.25 }));
    const handle = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.004, 0.005, 0.12, 8)), spoonMat);
    handle.position.y = -0.06;
    const bowl = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.016, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), spoonMat);
    bowl.scale.set(1, 0.4, 1.4);
    bowl.rotation.x = Math.PI;
    bowl.position.y = -0.125;
    this.spoon.add(handle, bowl);
    this.spoon.rotation.x = -1.2;
    this.spoon.position.set(0, -0.02, 0.02);
    this.spoon.visible = false;
    this.arms.r.hand.add(this.spoon);

    // 首と頭
    const neck = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.043 * s, 0.05 * s, 0.1 * s, 16)), skin);
    neck.position.y = 0.53 * s;
    this.torso.add(neck);
    this.headPivot.position.y = 0.56 * s;
    this.torso.add(this.headPivot);
    this.head.position.y = headR * 0.95;
    this.headPivot.add(this.head);
    const skull = new THREE.Mesh(this.geo(new THREE.SphereGeometry(headR, 40, 32)), skin);
    skull.scale.set(1, 1.04, 0.97);
    skull.castShadow = true;
    this.head.add(skull);
    // 顔（前面の球面パッチにキャンバスを貼る）
    const faceGeo = this.geo(new THREE.SphereGeometry(headR * 1.004, 40, 24, Math.PI / 2 - 1.1, 2.2, 0.9, 1.6));
    const faceMat = this.mat(new THREE.MeshPhysicalMaterial({ map: this.face.texture, transparent: true, roughness: 0.55, sheen: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    const faceMesh = new THREE.Mesh(faceGeo, faceMat);
    faceMesh.scale.copy(skull.scale);
    faceMesh.renderOrder = 1;
    this.head.add(faceMesh);
    // 鼻と耳
    const nose = new THREE.Mesh(this.geo(new THREE.SphereGeometry(headR * 0.13, 12, 10)), skin);
    nose.position.set(0, -headR * 0.18, headR * 0.96);
    nose.scale.set(1, 0.9, 0.8);
    this.head.add(nose);
    for (const sd of [-1, 1]) {
      const ear = new THREE.Mesh(this.geo(new THREE.SphereGeometry(headR * 0.22, 12, 10)), skin);
      ear.position.set(sd * headR * 0.98, -headR * 0.05, -headR * 0.05);
      ear.scale.set(0.45, 1, 0.75);
      this.head.add(ear);
    }
    this.buildHair(hairMat, headR);
    this.buildHat(headR);
    this.buildGlasses(headR);
    if (look.mask) {
      const mask = new THREE.Mesh(
        this.geo(new THREE.SphereGeometry(headR * 1.03, 32, 16, Math.PI / 2 - 1.05, 2.1, 1.62, 0.75)),
        this.mat(new THREE.MeshStandardMaterial({ color: '#2d3530', roughness: 0.9, side: THREE.DoubleSide })),
      );
      mask.scale.copy(skull.scale);
      this.head.add(mask);
      for (const sd of [-1, 1]) {
        const strap = new THREE.Mesh(this.geo(new THREE.TorusGeometry(headR * 1.01, 0.004, 6, 32, Math.PI * 0.5)), this.mat(new THREE.MeshStandardMaterial({ color: '#1d231f' })));
        strap.rotation.set(0, sd > 0 ? 0.1 : Math.PI - 0.1, 0);
        strap.position.y = -headR * 0.15;
        this.head.add(strap);
      }
    }

    // 感情マーク
    this.emoteSprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
    this.emoteSprite.scale.setScalar(0.12);
    this.emoteSprite.position.set(headR * 1.1, headR * 1.9, 0.05);
    this.emoteSprite.visible = false;
    this.emoteSprite.renderOrder = 10;
    this.head.add(this.emoteSprite);

    if (elder) this.torso.rotation.x = 0.1;
    if (opts.standing) {
      // 立ち姿（行列に並ぶ人）には脚をつける
      const legMat = this.mat(new THREE.MeshStandardMaterial({ color: new THREE.Color(look.outfit).multiplyScalar(0.7), roughness: 0.85 }));
      const shoeMat = this.mat(new THREE.MeshStandardMaterial({ color: '#1b1d20', roughness: 0.6 }));
      const legLen = this.hipY - 0.1;
      for (const sd of [-1, 1]) {
        const leg = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.055 * s, legLen - 0.1, 6, 12)), legMat);
        leg.position.set(sd * 0.08 * s, -legLen / 2 + 0.02, 0);
        leg.castShadow = true;
        this.body.add(leg);
        const shoe = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.1 * s, 0.06, 0.18 * s)), shoeMat);
        shoe.position.set(sd * 0.08 * s, -this.hipY + 0.03, 0.03);
        this.body.add(shoe);
      }
      this.pose = 'hang';
      for (const a of [this.arms.r, this.arms.l]) a.cur = { sx: 0.05, sz: a === this.arms.r ? 0.1 : -0.1, ex: -0.12 };
    }
    this.setMood('neutral');
    this.applyArms(1);
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }
  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private buildHair(m: THREE.Material, r: number): void {
    const L = this.look;
    const add = (geo: THREE.BufferGeometry, pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]) => {
      const mesh = new THREE.Mesh(this.geo(geo), m);
      mesh.position.set(...pos);
      mesh.rotation.set(...rot);
      mesh.scale.set(...scale);
      mesh.castShadow = true;
      this.head.add(mesh);
      return mesh;
    };
    const cap = (rad: number, thetaLen: number, tilt: number) => add(new THREE.SphereGeometry(r * rad, 36, 18, 0, Math.PI * 2, 0, thetaLen), [0, 0, 0], [-tilt, 0, 0], [1, 1.04, 0.98]);
    const backShell = (rad: number, t0: number, t1: number, open = 1.9) =>
      add(new THREE.SphereGeometry(r * rad, 36, 18, Math.PI / 2 + open / 2, Math.PI * 2 - open, t0, t1 - t0), [0, 0, 0], [0, 0, 0], [1, 1.04, 0.98]);
    const bangs = (w = 1.7) => add(new THREE.SphereGeometry(r * 1.075, 24, 8, Math.PI / 2 - w / 2, w, 0.3, 0.62), [0, 0, 0], [0, 0, 0], [1, 1.04, 0.98]);
    if (L.hat === 'peaked' || L.hat === 'hood') {
      // 帽子で隠れるので最低限
      backShell(1.05, 0.9, 1.75, 2.2);
      return;
    }
    switch (L.hairStyle) {
      case 'short':
        cap(1.06, 1.35, 0.55);
        backShell(1.055, 0.6, 1.72, 2.3);
        bangs(1.5);
        break;
      case 'bob':
        cap(1.07, 1.3, 0.35);
        backShell(1.08, 0.5, 2.2, 1.95);
        bangs(1.8);
        break;
      case 'long':
        cap(1.07, 1.3, 0.35);
        backShell(1.08, 0.5, 2.35, 1.95);
        bangs(1.7);
        add(new THREE.CapsuleGeometry(r * 0.75, r * 1.4, 6, 16), [0, -r * 1.4, -r * 0.55], [0.15, 0, 0], [1.05, 1, 0.45]);
        break;
      case 'pigtails':
        cap(1.07, 1.35, 0.4);
        backShell(1.065, 0.6, 1.9, 2.1);
        bangs(1.7);
        for (const sd of [-1, 1]) {
          add(new THREE.CapsuleGeometry(r * 0.3, r * 0.75, 6, 12), [sd * r * 1.15, -r * 0.35, -r * 0.2], [0.2, 0, sd * 0.45]);
          const tie = new THREE.Mesh(this.geo(new THREE.TorusGeometry(r * 0.2, r * 0.07, 8, 16)), this.mat(new THREE.MeshStandardMaterial({ color: this.look.accent, roughness: 0.5 })));
          tie.position.set(sd * r * 1.02, r * 0.1, -r * 0.18);
          tie.rotation.set(Math.PI / 2, 0, sd * 0.45);
          this.head.add(tie);
        }
        break;
      case 'bun':
        cap(1.06, 1.4, 0.45);
        backShell(1.055, 0.6, 1.75, 2.2);
        add(new THREE.SphereGeometry(r * 0.42, 20, 14), [0, r * 0.72, -r * 0.62]);
        bangs(1.2);
        break;
      case 'bald':
        backShell(1.045, 1.25, 1.85, 2.6);
        break;
      case 'buzz':
        cap(1.02, 1.45, 0.4);
        backShell(1.02, 0.6, 1.72, 2.4);
        break;
      case 'messy':
        cap(1.07, 1.4, 0.5);
        backShell(1.065, 0.6, 1.75, 2.2);
        bangs(1.6);
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          const cone = add(new THREE.ConeGeometry(r * 0.16, r * 0.45, 8), [Math.cos(a) * r * 0.55, r * 0.92, Math.sin(a) * r * 0.55 - r * 0.1]);
          cone.lookAt(new THREE.Vector3(Math.cos(a) * r * 3, r * 3.2, Math.sin(a) * r * 3));
          cone.rotateX(Math.PI / 2);
        }
        break;
      case 'ponytail':
        cap(1.065, 1.35, 0.45);
        backShell(1.06, 0.6, 1.75, 2.2);
        bangs(1.4);
        add(new THREE.CapsuleGeometry(r * 0.26, r * 1.1, 6, 12), [0, -r * 0.2, -r * 1.2], [0.45, 0, 0]);
        break;
      case 'side':
        cap(1.065, 1.35, 0.45);
        backShell(1.06, 0.6, 1.8, 2.2);
        add(new THREE.SphereGeometry(r * 1.08, 24, 8, Math.PI / 2 - 0.2, 1.1, 0.25, 0.7), [0, 0, 0], [0, 0, 0.12], [1, 1.04, 0.98]);
        break;
    }
  }

  private buildHat(r: number): void {
    const L = this.look;
    if (L.hat === 'none') return;
    const hm = this.mat(new THREE.MeshStandardMaterial({ color: L.hatColor, roughness: 0.75 }));
    const g = new THREE.Group();
    this.head.add(g);
    const mesh = (geo: THREE.BufferGeometry, m: THREE.Material = hm) => {
      const x = new THREE.Mesh(this.geo(geo), m);
      x.castShadow = true;
      g.add(x);
      return x;
    };
    switch (L.hat) {
      case 'cap': {
        const crown = mesh(new THREE.SphereGeometry(r * 1.1, 32, 14, 0, Math.PI * 2, 0, 1.3));
        crown.rotation.x = -0.25;
        const brim = mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.008, 24, 1, false, -Math.PI / 2, Math.PI));
        brim.position.set(0, r * 0.32, r * 0.55);
        brim.rotation.x = 0.28;
        brim.scale.z = 1.1;
        break;
      }
      case 'peaked': {
        const crown = mesh(new THREE.CylinderGeometry(r * 1.2, r * 1.02, r * 0.55, 32));
        crown.position.y = r * 0.78;
        crown.rotation.x = -0.12;
        const band = mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.04, r * 0.16, 32), this.mat(new THREE.MeshStandardMaterial({ color: '#0d0f12', roughness: 0.4 })));
        band.position.y = r * 0.55;
        band.rotation.x = -0.12;
        const visor = mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.008, 24, 1, false, -Math.PI / 2, Math.PI), this.mat(new THREE.MeshPhysicalMaterial({ color: '#07080a', roughness: 0.15, clearcoat: 1 })));
        visor.position.set(0, r * 0.45, r * 0.62);
        visor.rotation.x = 0.35;
        const pin = mesh(new THREE.CylinderGeometry(r * 0.13, r * 0.13, 0.01, 6), this.mat(new THREE.MeshStandardMaterial({ color: '#d9b04a', metalness: 1, roughness: 0.3 })));
        pin.rotation.x = Math.PI / 2 - 0.12;
        pin.position.set(0, r * 0.8, r * 1.14);
        break;
      }
      case 'hood': {
        const hood = mesh(new THREE.SphereGeometry(r * 1.3, 32, 16, Math.PI / 2 + 0.72, Math.PI * 2 - 1.44, 0, 2.3));
        hood.scale.set(1, 1.05, 1.05);
        (hood.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
        const rim = mesh(new THREE.TorusGeometry(r * 1.02, r * 0.1, 8, 24, Math.PI * 1.3));
        rim.position.set(0, -r * 0.05, r * 0.6);
        rim.rotation.set(0, 0, -Math.PI * 0.15 + Math.PI / 2 - Math.PI * 0.5);
        rim.rotation.z = Math.PI * 1.5 - (Math.PI * 1.3) / 2;
        break;
      }
      case 'beanie': {
        const crown = mesh(new THREE.SphereGeometry(r * 1.11, 32, 14, 0, Math.PI * 2, 0, 1.35));
        crown.rotation.x = -0.25;
        const fold = mesh(new THREE.TorusGeometry(r * 1.04, r * 0.1, 8, 32));
        fold.rotation.x = Math.PI / 2 - 0.25;
        fold.position.set(0, r * 0.25, -r * 0.05);
        const pom = mesh(new THREE.SphereGeometry(r * 0.2, 12, 10));
        pom.position.set(0, r * 1.1, -r * 0.25);
        break;
      }
      case 'kerchief': {
        const crown = mesh(new THREE.SphereGeometry(r * 1.09, 32, 14, 0, Math.PI * 2, 0, 1.25));
        crown.rotation.x = -0.35;
        const knot = mesh(new THREE.SphereGeometry(r * 0.16, 10, 8));
        knot.position.set(0, -r * 0.1, -r * 1.05);
        break;
      }
    }
  }

  private buildGlasses(r: number): void {
    const L = this.look;
    if (L.glasses === 'none') return;
    const gm = this.mat(new THREE.MeshStandardMaterial({ color: L.glassesColor, metalness: 0.4, roughness: 0.35 }));
    const lensM = this.mat(new THREE.MeshPhysicalMaterial({ color: '#dff2ff', transparent: true, opacity: 0.18, roughness: 0.05, clearcoat: 1, depthWrite: false }));
    const ex = r * 0.34;
    const ey = r * 0.02;
    const ez = r * 0.99;
    for (const sd of [-1, 1]) {
      const rim = new THREE.Group();
      if (L.glasses === 'round') {
        rim.add(new THREE.Mesh(this.geo(new THREE.TorusGeometry(r * 0.24, r * 0.035, 8, 28)), gm));
      } else {
        const w = r * 0.5;
        const h = r * 0.34;
        const t = r * 0.045;
        const bars: [number, number, number, number][] = [
          [0, h / 2, w, t],
          [0, -h / 2, w, t],
          [w / 2, 0, t, h],
          [-w / 2, 0, t, h],
        ];
        for (const [x, y, bw, bh] of bars) {
          const b = new THREE.Mesh(this.geo(new THREE.BoxGeometry(bw, bh, t)), gm);
          b.position.set(x, y, 0);
          rim.add(b);
        }
      }
      rim.position.set(sd * ex, ey, ez);
      rim.rotation.y = sd * 0.18;
      this.head.add(rim);
      const lens = new THREE.Mesh(this.geo(new THREE.CircleGeometry(r * 0.23, 20)), lensM);
      lens.position.set(sd * ex, ey, ez + 0.002);
      lens.rotation.y = sd * 0.18;
      if (L.glasses === 'square') lens.scale.set(1, 0.7, 1);
      this.head.add(lens);
      const temple = new THREE.Mesh(this.geo(new THREE.BoxGeometry(r * 0.03, r * 0.03, r * 0.9)), gm);
      temple.position.set(sd * r * 0.92, ey + r * 0.03, r * 0.45);
      this.head.add(temple);
    }
    const bridge = new THREE.Mesh(this.geo(new THREE.BoxGeometry(r * 0.2, r * 0.03, r * 0.03)), gm);
    bridge.position.set(0, ey + r * 0.05, ez + 0.004);
    this.head.add(bridge);
  }

  // ───────── 状態 ─────────

  setMood(m: Mood): void {
    this.moodName = m;
    const e = EXPRESSIONS[m] ?? EXPRESSIONS.neutral;
    this.expr = { eyes: 'open', mouth: 'neutral', brows: 'neutral', blush: 0, sweat: false, tear: false, lookX: this.expr.lookX, lookY: this.expr.lookY, ...e } as Expression;
    if (this.look.eyes === 'sleepy' && m === 'neutral') this.expr.eyes = 'half';
  }

  get mood(): Mood {
    return this.moodName;
  }

  setTalking(on: boolean): void {
    this.talking = on;
  }

  setPose(p: Pose): void {
    this.pose = p;
  }

  setSpoon(on: boolean): void {
    this.spoon.visible = on;
  }

  showEmote(sym: string, color = '#ffffff', dur = 1.6): void {
    (this.emoteSprite.material as THREE.SpriteMaterial).map = emoteTexture(sym, color);
    (this.emoteSprite.material as THREE.SpriteMaterial).needsUpdate = true;
    this.emoteSprite.visible = true;
    this.emoteLife = dur;
  }

  /** うなずき（1 回） */
  doNod(amount = 1): void {
    this.nod = amount;
  }
  doShake(amount = 1): void {
    this.shake = amount;
  }
  doJump(): void {
    this.jump = 1;
  }
  setLean(v: number): void {
    this.leanGoal = v;
  }
  setWalk(v: number): void {
    this.walk = v;
  }

  headWorld(): THREE.Vector3 {
    return this.head.getWorldPosition(new THREE.Vector3());
  }

  private applyArms(k: number): void {
    const p = POSES[this.pose];
    for (const side of ['r', 'l'] as const) {
      const a = this.arms[side];
      const goal = p[side];
      a.cur.sx += (goal.sx - a.cur.sx) * k;
      a.cur.sz += (goal.sz - a.cur.sz) * k;
      a.cur.ex += (goal.ex - a.cur.ex) * k;
      a.shoulder.rotation.set(a.cur.sx, 0, a.cur.sz);
      a.elbow.rotation.set(a.cur.ex, 0, 0);
    }
  }

  update(dt: number, time: number): void {
    // まばたき
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blinking = 0.13;
      this.blinkT = 2 + Math.random() * 3.5;
    }
    if (this.blinking > 0) this.blinking -= dt;
    // 口
    let talkOpen = 0;
    if (this.talking) {
      this.talkPhase += dt * 13;
      talkOpen = Math.max(0, Math.sin(this.talkPhase)) * (0.6 + 0.4 * Math.sin(this.talkPhase * 0.37));
    }
    if (this.moodName === 'chew') {
      this.chewing += dt * 9;
      talkOpen = (Math.sin(this.chewing) + 1) / 2;
    }
    // 視線：見ている方向に黒目を少し寄せる
    const hw = this.headWorld();
    const dir = this.lookAt.clone().sub(hw);
    const yawGoal = THREE.MathUtils.clamp(Math.atan2(dir.x, dir.z) - this.root.rotation.y, -0.7, 0.7);
    const pitchGoal = THREE.MathUtils.clamp(-Math.atan2(dir.y, Math.hypot(dir.x, dir.z)), -0.35, 0.35);
    this.expr.lookX = THREE.MathUtils.clamp(yawGoal * 0.6, -1, 1);
    this.expr.lookY = THREE.MathUtils.clamp(pitchGoal * 0.8, -1, 1);
    this.face.draw(this.expr, talkOpen, this.blinking > 0);

    // 頭の動き
    this.nod = Math.max(0, this.nod - dt * 2.2);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const nodAng = Math.sin((1 - this.nod) * Math.PI * 2) * this.nod * 0.25;
    const shakeAng = Math.sin((1 - this.shake) * Math.PI * 5) * this.shake * 0.3;
    const tilt = this.moodName === 'confused' || this.moodName === 'think' ? 0.22 : 0;
    const droop = this.moodName === 'sad' ? 0.25 : this.moodName === 'sleepy' ? 0.15 : 0;
    this.headGoal.set(pitchGoal * 0.5 + nodAng + droop + (this.talking ? Math.sin(time * 7) * 0.02 : 0), yawGoal * 0.55 + shakeAng, tilt);
    const k = damp(8, dt);
    this.headPivot.rotation.x += (this.headGoal.x - this.headPivot.rotation.x) * k;
    this.headPivot.rotation.y += (this.headGoal.y - this.headPivot.rotation.y) * k;
    this.headPivot.rotation.z += (this.headGoal.z - this.headPivot.rotation.z) * k;

    // 体：呼吸・前のめり・ジャンプ・歩き
    this.lean += (this.leanGoal - this.lean) * damp(5, dt);
    this.jump = Math.max(0, this.jump - dt * 1.8);
    const jumpY = Math.sin((1 - this.jump) * Math.PI * 2) > 0 ? Math.sin((1 - this.jump) * Math.PI * 2) * this.jump * 0.06 : 0;
    this.bob += dt * 9 * this.walk;
    const walkY = Math.abs(Math.sin(this.bob)) * 0.025 * this.walk;
    const br = Math.sin(time * 1.8 + this.breathe);
    this.torso.scale.set(1 + br * 0.006, 1 + br * 0.01, 1);
    this.body.position.y = this.hipY + jumpY + walkY;
    this.body.rotation.x = this.lean + (this.look.body === 'elder' ? 0.04 : 0);
    this.body.rotation.z = Math.sin(this.bob) * 0.04 * this.walk;
    this.applyArms(damp(7, dt));

    // 感情マーク
    if (this.emoteLife > 0) {
      this.emoteLife -= dt;
      const t = this.emoteLife;
      this.emoteSprite.visible = t > 0;
      const pop = Math.min(1, (1.6 - t) * 6);
      this.emoteSprite.scale.setScalar(0.12 * (0.6 + 0.4 * pop) * (1 + Math.sin(time * 8) * 0.04));
      (this.emoteSprite.material as THREE.SpriteMaterial).opacity = Math.min(1, t * 3);
    }
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
    this.face.texture.dispose();
  }
}
