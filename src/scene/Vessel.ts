import * as THREE from 'three';
import type { VesselId } from '../data/types.ts';
import { mats } from './materials.ts';

// 器。回転体（Lathe）の断面で作る。配給食堂らしく、くすんだメラミン風の色。

export const FOOD_SCALE = 1.6;

/** アームが器を持つときの持ち方（料理に触れないよう、縁か胴を挟む） */
export interface GripInfo {
  /** rim = 縁を内と外から挟む（皿・丼）、side = 胴を横から挟む（カップ・グラス） */
  kind: 'rim' | 'side';
  /** 挟む位置：器の中心からの水平距離（rim は縁の厚みの中心、side は胴の半径）と、底からの高さ */
  r: number;
  y: number;
  /** グリッパーの傾き（rim は縁の壁に沿わせる。-π/2 = 真下、0 = 水平） */
  pitch: number;
  /** 挟む位置から、グリッパーの向きへ先端を差し込む量 */
  depth: number;
  /** 近づくときと、挟んだときの指の開き（RobotArm.openGoal） */
  open: number;
  closed: number;
}

export interface VesselInfo {
  id: VesselId;
  group: THREE.Group;
  floorY: number;
  rimY: number;
  /** 内側の断面（下から上へ）。r(y) の補間に使う */
  inner: THREE.Vector2[];
  glass: boolean;
  /** 料理を置ける半径（床面付近） */
  floorR: number;
  grip: GripInfo;
}

type Profile = { outer: [number, number][]; inner: [number, number][]; glass?: boolean; handle?: boolean };

const PROFILES: Record<VesselId, Profile> = {
  plate: {
    outer: [
      [0.0, 0],
      [0.1, 0],
      [0.105, 0.004],
      [0.16, 0.018],
      [0.172, 0.024],
    ],
    inner: [
      [0.0, 0.01],
      [0.1, 0.011],
      [0.152, 0.022],
      [0.168, 0.027],
    ],
  },
  deep: {
    outer: [
      [0.0, 0],
      [0.085, 0],
      [0.09, 0.006],
      [0.13, 0.03],
      [0.15, 0.052],
      [0.155, 0.056],
    ],
    inner: [
      [0.0, 0.012],
      [0.082, 0.014],
      [0.122, 0.034],
      [0.148, 0.057],
    ],
  },
  chawan: {
    outer: [
      [0.0, 0],
      [0.036, 0],
      [0.036, 0.011],
      [0.046, 0.013],
      [0.07, 0.04],
      [0.08, 0.074],
      [0.079, 0.078],
    ],
    inner: [
      [0.0, 0.017],
      [0.036, 0.019],
      [0.062, 0.041],
      [0.073, 0.075],
    ],
  },
  bowl: {
    outer: [
      [0.0, 0],
      [0.046, 0],
      [0.046, 0.012],
      [0.06, 0.015],
      [0.095, 0.05],
      [0.11, 0.094],
      [0.109, 0.099],
    ],
    inner: [
      [0.0, 0.019],
      [0.05, 0.021],
      [0.086, 0.052],
      [0.103, 0.095],
    ],
  },
  cup: {
    outer: [
      [0.0, 0],
      [0.048, 0],
      [0.052, 0.005],
      [0.053, 0.092],
      [0.051, 0.097],
    ],
    inner: [
      [0.0, 0.012],
      [0.045, 0.013],
      [0.047, 0.094],
    ],
    handle: true,
  },
  glass: {
    outer: [
      [0.0, 0],
      [0.037, 0],
      [0.04, 0.005],
      [0.05, 0.158],
      [0.049, 0.162],
    ],
    inner: [
      [0.0, 0.013],
      [0.034, 0.015],
      [0.045, 0.159],
    ],
    glass: true,
  },
};

const VESSEL_COLORS: Record<VesselId, string> = {
  plate: '#d7ddd4',
  deep: '#cfd8d6',
  chawan: '#c9c2b0',
  bowl: '#b9c3c8',
  cup: '#d8d3c6',
  glass: '#ffffff',
};

export function makeVessel(id: VesselId): VesselInfo {
  const p = PROFILES[id];
  const S = FOOD_SCALE;
  // 外側 → 縁 → 内側（逆順）をつないで閉じた断面にする
  const pts: THREE.Vector2[] = [];
  for (const [r, y] of p.outer) pts.push(new THREE.Vector2(r * S, y * S));
  for (let i = p.inner.length - 1; i >= 0; i--) pts.push(new THREE.Vector2(p.inner[i][0] * S, p.inner[i][1] * S));
  const geo = new THREE.LatheGeometry(pts, 64);
  geo.computeVertexNormals();
  const group = new THREE.Group();
  let mat: THREE.Material;
  if (p.glass) {
    mat = new THREE.MeshPhysicalMaterial({
      color: '#eef8ff',
      roughness: 0.03,
      metalness: 0,
      transparent: true,
      opacity: 0.12,
      clearcoat: 1,
      envMapIntensity: 1.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  } else {
    const base = mats().ceramic.clone();
    base.color.set(VESSEL_COLORS[id]);
    mat = base;
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = !p.glass;
  mesh.receiveShadow = true;
  if (p.glass) mesh.renderOrder = 4;
  group.add(mesh);

  // 縁の細い色線（配給食堂の識別色）
  if (!p.glass) {
    const rim = p.outer[p.outer.length - 1];
    const line = new THREE.Mesh(
      new THREE.TorusGeometry(rim[0] * S - 0.002, 0.0022, 6, 64),
      new THREE.MeshStandardMaterial({ color: '#3b7d8a', roughness: 0.4 }),
    );
    line.rotation.x = Math.PI / 2;
    line.position.y = rim[1] * S - 0.002;
    group.add(line);
  }
  if (p.handle) {
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.026 * S, 0.0065 * S, 10, 24, Math.PI * 1.2), mat);
    h.rotation.z = -Math.PI * 0.6 + Math.PI;
    h.position.set(0.058 * S, 0.05 * S, 0);
    h.rotation.set(0, 0, -Math.PI / 2 - Math.PI * 0.1);
    h.castShadow = true;
    group.add(h);
  }
  const inner = p.inner.map(([r, y]) => new THREE.Vector2(r * S, y * S));
  return {
    id,
    group,
    floorY: p.inner[0][1] * S,
    rimY: p.inner[p.inner.length - 1][1] * S,
    inner,
    glass: !!p.glass,
    floorR: p.inner[1][0] * S,
    grip: gripFor(id, p),
  };
}

/** y0..y1 の範囲での外側の最大半径（寸法は FOOD_SCALE 倍後） */
function outerRadiusMax(p: Profile, y0: number, y1: number): number {
  const S = FOOD_SCALE;
  const o = p.outer.map(([r, y]) => [r * S, y * S]);
  const at = (y: number) => {
    for (let i = 1; i < o.length; i++) {
      if (y <= o[i][1]) {
        const t = (y - o[i - 1][1]) / Math.max(1e-5, o[i][1] - o[i - 1][1]);
        return o[i - 1][0] + (o[i][0] - o[i - 1][0]) * t;
      }
    }
    return o[o.length - 1][0];
  };
  let m = 0;
  for (let i = 0; i <= 8; i++) m = Math.max(m, at(y0 + ((y1 - y0) * i) / 8));
  return m;
}

// グリッパーの寸法（RobotArm と合わせる）：指のパッド面 = 0.001 + open × 0.05、手のひらの面は先端の 0.0785 手前、半径 0.05
const openFor = (padX: number) => (padX - 0.001) / 0.05;
const PALM_BACK = 0.0785;
const PALM_R = 0.05;
/** 胴を横から挟む高さ（底から。茶碗は手のひらが台に当たらない最低の高さ） */
const SIDE_GRIP_Y: Partial<Record<VesselId, number>> = { cup: 0.072, glass: 0.099, chawan: 0.056 };

/** 断面から持ち方を決める */
function gripFor(id: VesselId, p: Profile): GripInfo {
  const S = FOOD_SCALE;
  const sideY = SIDE_GRIP_Y[id];
  if (sideY !== undefined) {
    // 背の高い器や、ご飯を縁まで盛る茶碗は、中身に指が入らないよう胴を横から挟む。
    // 手のひらが器に当たらない距離まで下がり、そこから届く指で胴の手前側を左右から挟む
    const palmFace = outerRadiusMax(p, sideY - PALM_R + 0.008, sideY + PALM_R - 0.008) + 0.005;
    const tipBack = palmFace - PALM_BACK;
    const bodyR = outerRadiusMax(p, sideY - 0.015, sideY + 0.015);
    const half = tipBack > 0 ? Math.sqrt(Math.max(0, bodyR * bodyR - tipBack * tipBack)) : bodyR;
    return { kind: 'side', r: tipBack, y: sideY, pitch: 0, depth: 0, open: openFor(half + 0.014), closed: openFor(half) };
  }
  // 縁を内と外から挟む。内壁の傾きに指を沿わせ、縁の厚みで閉じる
  const o = p.outer[p.outer.length - 1];
  const i1 = p.inner[p.inner.length - 1];
  const i0 = p.inner[p.inner.length - 2];
  const wall = Math.atan2(i1[1] - i0[1], i1[0] - i0[0]);
  const thick = Math.hypot(o[0] - i1[0], o[1] - i1[1]) * S;
  // 浅い皿でも、指が台に当たらない程度には傾ける
  const pitch = -Math.max(0.4, wall);
  const depth = 0.02;
  const y = ((o[1] + i1[1]) / 2) * S;
  const closed = Math.max(0.02, openFor(thick / 2));
  // 近づくときの開き。外側（下側）の指の先が、器を置いた面より下へ出ない範囲にとどめる
  const tipY = y + depth * Math.sin(pitch);
  const fingerMax = (tipY - 0.004 - 0.0025 * Math.abs(Math.sin(pitch))) / Math.cos(pitch) - 0.007;
  const open = Math.max(closed + 0.1, Math.min(0.9, (fingerMax - 0.012) / 0.05));
  return { kind: 'rim', r: ((o[0] + i1[0]) / 2) * S, y, pitch, depth, open, closed };
}

/** 内側の半径 r(y) */
export function innerRadiusAt(v: VesselInfo, y: number): number {
  // pts[0] は中心点なので、pts[1]（床の縁）から上をたどる
  const pts = v.inner;
  if (y <= pts[1].y) return pts[1].x;
  for (let i = 2; i < pts.length; i++) {
    if (y <= pts[i].y) {
      const a = pts[i - 1];
      const b = pts[i];
      const t = (y - a.y) / Math.max(1e-5, b.y - a.y);
      return a.x + (b.x - a.x) * t;
    }
  }
  return pts[pts.length - 1].x;
}

/** 液体を満たすメッシュ（器の内側の形に沿う） */
export function fillGeometry(v: VesselInfo, level: number): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, v.floorY + 0.0005)];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const y = v.floorY + ((level - v.floorY) * i) / steps + 0.0005;
    pts.push(new THREE.Vector2(innerRadiusAt(v, y) - 0.0015, y));
  }
  pts.push(new THREE.Vector2(0, level));
  return new THREE.LatheGeometry(pts, 48);
}
