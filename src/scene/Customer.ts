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
  /** -1 = 右腕（本人の右、正面を向いたときの -X 側）、1 = 左腕 */
  side: 1 | -1;
  shoulder: THREE.Group;
  elbow: THREE.Group;
  hand: THREE.Mesh;
  /** いまの肩の回転と肘の曲がり */
  q: THREE.Quaternion;
  ex: number;
}

/** スプーンの付け根（手の中心）から皿（先端）までの長さ */
const SPOON_REACH = 0.135;
/** 右手で、スプーンの先を目標へ向けるときの手の置き方（手 → 先端の向き、体の向きの座標） */
const BITE_DIR = new THREE.Vector3(0.3, 0.5, -0.81).normalize(); // 口：下の前から、内側へ
const SCOOP_DIR = new THREE.Vector3(0.25, -0.55, 0.8).normalize(); // 器：上の手前から、奥へ
/** 肘を向ける方向（胴の座標、右腕。左腕は x を反転）：外側・下 */
const ELBOW_POLE = new THREE.Vector3(-0.6, -0.78, 0.05);
const NEG_Y = new THREE.Vector3(0, -1, 0);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();

/**
 * キャップのつば（厚みのある板）。帽子のふちの円（半径 ri、高さ 0）の前側 ±half に沿って付き、
 * 正面で depth だけ張り出して両端へ細くなる。外へ行くほど droop の傾きで下がる。
 */
function capBill(ri: number, depth: number, half: number, droop: number, th: number): THREE.BufferGeometry {
  const N = 24;
  const M = 6;
  const pos: number[] = [];
  const idx: number[] = [];
  const pt = (i: number, t: number, dy: number) => {
    const a = -half + (2 * half * i) / N;
    const e = depth * Math.sqrt(Math.max(Math.cos((a / half) * (Math.PI / 2)), 0)) * t;
    pos.push(Math.sin(a) * (ri + e), dy - e * Math.tan(droop), Math.cos(a) * (ri + e));
  };
  // 上面と下面（法線が混ざらないよう、面ごとに頂点を分ける）
  for (const [dy, flip] of [[0, false], [-th, true]] as const) {
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= M; j++) pt(i, j / M, dy);
    for (let i = 0; i < N; i++)
      for (let j = 0; j < M; j++) {
        const a = base + i * (M + 1) + j;
        const b = a + M + 1;
        if (flip) idx.push(a, b, a + 1, b, b + 1, a + 1);
        else idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
  }
  // 外周のふち
  const base = pos.length / 3;
  for (let i = 0; i <= N; i++) {
    pt(i, 1, 0);
    pt(i, 1, -th);
  }
  for (let i = 0; i < N; i++) {
    const a = base + i * 2;
    idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
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
  private upperLen: number;
  private foreLen: number;
  /** 唇の少し前（頭の座標） */
  private mouthLocal: THREE.Vector3;
  private maskParts: THREE.Object3D[] = [];
  /** スプーンで食べる動作（scoop = 器からすくう、bite = 口へ運ぶ） */
  private eatMode: 'scoop' | 'bite' | null = null;
  private eatFood = new THREE.Vector3();
  /** 右手で器を持つ位置（ワールド座標。呼び出し側が毎フレーム動かす） */
  private hold: THREE.Vector3 | null = null;

  constructor(look: Look, opts: { standing?: boolean } = {}) {
    this.look = look;
    const child = look.body === 'child';
    const elder = look.body === 'elder';
    const s = child ? 0.78 : elder ? 0.96 : 1;
    const headR = child ? 0.108 : 0.112;
    this.headR = headR;
    this.hipY = opts.standing ? (child ? 0.62 : 0.84) : child ? 0.8 : 0.72;
    this.upperLen = 0.22 * s;
    this.foreLen = 0.21 * s;
    // 顔のキャンバスで口を描く高さ（y = 172 / 256）を、顔の球面上の位置にしたもの
    this.mouthLocal = new THREE.Vector3(0, -headR * 0.41, headR * 0.95);
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
      return { side, shoulder, elbow, hand, q: new THREE.Quaternion(), ex: -0.75 };
    };
    this.arms = { r: mkArm(-1), l: mkArm(1) };
    // 右手のスプーン（付け根が手の中心。-Y 方向へ柄が伸び、先に皿）。向きは食べるあいだ毎フレーム決める
    this.spoon = new THREE.Group();
    const spoonMat = this.mat(new THREE.MeshStandardMaterial({ color: '#c9d0d6', metalness: 1, roughness: 0.25 }));
    const handle = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.0035, 0.005, 0.11, 8)), spoonMat);
    handle.position.y = -0.06;
    const bowl = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.016, 14, 10)), spoonMat);
    bowl.scale.set(0.9, 1.35, 0.4);
    bowl.position.y = -SPOON_REACH;
    this.spoon.add(handle, bowl);
    this.spoon.position.copy(this.arms.r.hand.position);
    this.spoon.visible = false;
    this.arms.r.elbow.add(this.spoon);

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
      this.maskParts.push(mask);
      for (const sd of [-1, 1]) {
        const strap = new THREE.Mesh(this.geo(new THREE.TorusGeometry(headR * 1.01, 0.004, 6, 32, Math.PI * 0.5)), this.mat(new THREE.MeshStandardMaterial({ color: '#1d231f' })));
        strap.rotation.set(0, sd > 0 ? 0.1 : Math.PI - 0.1, 0);
        strap.position.y = -headR * 0.15;
        this.head.add(strap);
        this.maskParts.push(strap);
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
    }
    this.setMood('neutral');
    this.applyArms(1, null, false);
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
    // キャップ・ニット帽・三角巾は頭頂を覆う。その下の髪（頭頂・前髪・お団子・はね毛）は帽子とほぼ同じ大きさで突き抜けるので作らない
    const covered = L.hat === 'cap' || L.hat === 'beanie' || L.hat === 'kerchief';
    const cap = (rad: number, thetaLen: number, tilt: number) => covered ? null : add(new THREE.SphereGeometry(r * rad, 36, 18, 0, Math.PI * 2, 0, thetaLen), [0, 0, 0], [-tilt, 0, 0], [1, 1.04, 0.98]);
    const backShell = (rad: number, t0: number, t1: number, open = 1.9) => {
      // 帽子の下では、帽子のふちに隠れるあたりから下だけ（頭頂まであると帽子を突き抜ける）
      if (covered) t0 = Math.max(t0, 1.15);
      return add(new THREE.SphereGeometry(r * rad, 36, 18, Math.PI / 2 + open / 2, Math.PI * 2 - open, t0, t1 - t0), [0, 0, 0], [0, 0, 0], [1, 1.04, 0.98]);
    };
    const bangs = (w = 1.7) => covered ? null : add(new THREE.SphereGeometry(r * 1.075, 24, 8, Math.PI / 2 - w / 2, w, 0.3, 0.62), [0, 0, 0], [0, 0, 0], [1, 1.04, 0.98]);
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
        if (!covered) add(new THREE.SphereGeometry(r * 0.42, 20, 14), [0, r * 0.72, -r * 0.62]);
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
        for (let i = 0; i < (covered ? 0 : 9); i++) {
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
        if (!covered) add(new THREE.SphereGeometry(r * 1.08, 24, 8, Math.PI / 2 - 0.2, 1.1, 0.25, 0.7), [0, 0, 0], [0, 0, 0.12], [1, 1.04, 0.98]);
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
        const R = r * 1.1;
        const open = 1.3;
        const crown = mesh(new THREE.SphereGeometry(R, 32, 14, 0, Math.PI * 2, 0, open));
        crown.rotation.x = -0.25;
        // つばは本体のふちの円に付け根を合わせる（離すと、あいだにおでこが帯になって見える）
        const bill = mesh(capBill(R * Math.sin(open) * 0.99, r * 0.66, 0.98, 0.3, r * 0.06).translate(0, R * Math.cos(open) + r * 0.01, 0));
        bill.rotation.x = crown.rotation.x;
        break;
      }
      case 'peaked': {
        const crown = mesh(new THREE.CylinderGeometry(r * 1.2, r * 1.02, r * 0.55, 32));
        crown.position.y = r * 0.78;
        crown.rotation.x = -0.12;
        const band = mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.04, r * 0.16, 32), this.mat(new THREE.MeshStandardMaterial({ color: '#0d0f12', roughness: 0.4 })));
        band.position.y = r * 0.55;
        band.rotation.x = -0.12;
        // つばの光沢は控えめに（強いと、うつむいたときに照明の反射がカメラへ向いて白くにじむ）
        const visor = mesh(
          new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.008, 24, 1, false, -Math.PI / 2, Math.PI),
          this.mat(new THREE.MeshPhysicalMaterial({ color: '#07080a', roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4 })),
        );
        visor.position.set(0, r * 0.45, r * 0.62);
        visor.rotation.x = 0.35;
        // 記章もつや消し気味に（なめらかな金属だと、顔を上げたときに照明を映して光の点になる）
        const pin = mesh(new THREE.CylinderGeometry(r * 0.13, r * 0.13, 0.01, 6), this.mat(new THREE.MeshStandardMaterial({ color: '#c9a043', metalness: 0.85, roughness: 0.55 })));
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

  /** スプーンで食べる：scoop = 器の料理（food、ワールド座標）をすくう、bite = 口へ運ぶ、null = やめる */
  setEating(mode: 'scoop' | 'bite' | null, food?: THREE.Vector3): void {
    this.eatMode = mode;
    if (food) this.eatFood.copy(food);
  }

  /** 右手で器を持つ：手を p（ワールド座標）に置く。p は呼び出し側が毎フレーム動かしてよい。null で放す */
  holdAt(p: THREE.Vector3 | null): void {
    this.hold = p;
  }

  /** 食べたり飲んだりするあいだは、マスクを外す */
  setMouthFree(on: boolean): void {
    for (const m of this.maskParts) m.visible = !on;
  }

  /** 唇の少し前のワールド座標 */
  mouthWorld(out = new THREE.Vector3()): THREE.Vector3 {
    this.head.updateWorldMatrix(true, false);
    return this.head.localToWorld(out.copy(this.mouthLocal));
  }

  /** 右手の中心のワールド座標 */
  handWorld(out = new THREE.Vector3()): THREE.Vector3 {
    this.arms.r.hand.updateWorldMatrix(true, false);
    return this.arms.r.hand.getWorldPosition(out);
  }

  /** 体の向き（ワールド）で表した d をワールドの向きにする */
  private toWorldDir(d: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(d).applyQuaternion(this.root.getWorldQuaternion(_q));
  }

  /** スプーンの先が目標（すくう料理、または唇）に届くときの、右手の位置（ワールド） */
  private spoonHandTarget(out: THREE.Vector3): THREE.Vector3 {
    const aim = this.eatMode === 'scoop' ? _v1.copy(this.eatFood) : this.mouthWorld(_v1);
    this.toWorldDir(this.eatMode === 'scoop' ? SCOOP_DIR : BITE_DIR, _v2);
    return out.copy(aim).addScaledVector(_v2, -SPOON_REACH);
  }

  /** スプーンの先を、すくう料理か唇へ向ける（腕を動かしたあとに呼ぶ） */
  private aimSpoon(): void {
    const aim = this.eatMode === 'scoop' ? _v1.copy(this.eatFood) : this.mouthWorld(_v1);
    const elbow = this.arms.r.elbow;
    elbow.updateWorldMatrix(true, false);
    const pivot = this.spoon.getWorldPosition(_v2);
    const dir = aim.sub(pivot);
    if (dir.lengthSq() < 1e-8) return;
    dir.normalize().applyQuaternion(elbow.getWorldQuaternion(_q).invert());
    this.spoon.quaternion.setFromUnitVectors(NEG_Y, dir);
  }

  /**
   * 2 本の骨の IK：手を target（ワールド座標）へ。肘は外側・下へ向ける。
   * 届かないときは、腕を伸ばしきって target の方へ向ける
   */
  private solveArm(a: Arm, target: THREE.Vector3, outQ: THREE.Quaternion): number {
    const L1 = this.upperLen;
    const L2 = this.foreLen;
    const S = a.shoulder.position;
    const toT = this.torso.worldToLocal(_v1.copy(target)).sub(S);
    const len = toT.length();
    const u = len > 1e-6 ? toT.divideScalar(len) : toT.set(0, -1, 0);
    const d = THREE.MathUtils.clamp(len, Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
    // 肘の位置：target の方向 u と、肘を向けたい方向（u に直交する成分）v のあいだ
    const cosA = THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pole = _v2.copy(ELBOW_POLE);
    pole.x *= -a.side;
    const v = pole.addScaledVector(u, -pole.dot(u));
    if (v.lengthSq() < 1e-8) v.set(0, -1, 0).addScaledVector(u, -u.y);
    v.normalize();
    const upper = _v3.copy(u).multiplyScalar(cosA).addScaledVector(v, sinA); // 肩 → 肘の向き
    // 肩の座標軸：-Y が上腕の向き、+Z が肘の曲がる向き（前腕の、上腕に直交する成分）
    const fore = u.multiplyScalar(d).addScaledVector(upper, -L1).normalize(); // 肘 → 手の向き
    const bend = fore.addScaledVector(upper, -fore.dot(upper));
    if (bend.lengthSq() < 1e-8) bend.copy(v);
    bend.normalize();
    const yAxis = upper.negate();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, bend);
    outQ.setFromRotationMatrix(_m.makeBasis(xAxis, yAxis, bend));
    // 肘の内角 γ から、前腕が上腕の延長から曲がる角度（負で +Z 側へ曲がる）
    const cosG = THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1);
    return -(Math.PI - Math.acos(cosG));
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

  /** 腕をポーズへ近づける。rTarget があれば右手はそこへ（IK）。stick なら目標にほぼ貼りつける */
  private applyArms(k: number, rTarget: THREE.Vector3 | null, stick: boolean): void {
    const p = POSES[this.pose];
    const goalQ = new THREE.Quaternion();
    for (const side of ['r', 'l'] as const) {
      const a = this.arms[side];
      let goalEx: number;
      let kk = k;
      if (side === 'r' && rTarget) {
        goalEx = this.solveArm(a, rTarget, goalQ);
        if (stick) kk = Math.max(k, 0.55);
      } else {
        const g: ArmPose = p[side];
        goalQ.setFromEuler(_e.set(g.sx, 0, g.sz));
        goalEx = g.ex;
      }
      a.q.slerp(goalQ, kk);
      a.ex += (goalEx - a.ex) * kk;
      a.shoulder.quaternion.copy(a.q);
      a.elbow.rotation.set(a.ex, 0, 0);
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
    // 腕：器を持つ・スプーンで食べるときは右手を目標へ（体と頭を動かしたあとの位置で解く）
    let rTarget: THREE.Vector3 | null = null;
    if (this.hold || this.eatMode) {
      this.head.updateWorldMatrix(true, false);
      rTarget = this.hold ?? this.spoonHandTarget(new THREE.Vector3());
    }
    this.applyArms(damp(this.eatMode ? 9 : 7, dt), rTarget, !!this.hold);
    if (this.spoon.visible && this.eatMode) this.aimSpoon();

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
