import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FormId, IngId, IngKind, VesselId } from '../data/types.ts';
import { ING, ING_IDS } from '../data/ingredients.ts';
import { FOOD_SCALE, fillGeometry, innerRadiusAt, type VesselInfo } from './Vessel.ts';

// 手続き的に組み立てる料理。形・色・焼き色・トッピング・器への盛り付けまで。

export interface Composition {
  color: THREE.Color;
  units: number;
  frac: Record<IngKind, number>;
  liquidColor: THREE.Color | null;
  clearFrac: number;
}

/** 料理の色を混ぜるときの、素材ごとの「色」と「強さ」（タンクの見た目とは別） */
const MIX: Partial<Record<IngId, { color: string; weight: number }>> = {
  clear: { color: '#e3e7e9', weight: 0.3 },
  pink: { color: '#ffb3d6', weight: 0.35 },
  spice: { color: '#ff6a2a', weight: 0.7 },
};

export function analyze(ing: Record<IngId, number>): Composition {
  const frac: Record<IngKind, number> = { solid: 0, paste: 0, grain: 0, gel: 0, crystal: 0, powder: 0, liquid: 0 };
  const color = new THREE.Color(0, 0, 0);
  const liquidColor = new THREE.Color(0, 0, 0);
  let units = 0;
  let liquidUnits = 0;
  let wsum = 0;
  const lg = [0, 0, 0];
  for (const id of ING_IDS) {
    const n = ing[id] ?? 0;
    if (!n) continue;
    units += n;
    frac[ING[id].kind] += n;
    // 水（透明液）と砂糖（甘味結晶）は色をほとんど持たない
    const mix = MIX[id];
    const c = new THREE.Color(mix?.color ?? ING[id].color);
    const w = n * (mix?.weight ?? 1);
    wsum += w;
    color.add(c.clone().multiplyScalar(w));
    lg[0] += Math.log(Math.max(0.004, c.r)) * w;
    lg[1] += Math.log(Math.max(0.004, c.g)) * w;
    lg[2] += Math.log(Math.max(0.004, c.b)) * w;
    if (ING[id].kind === 'liquid') {
      liquidColor.add(c.clone().multiplyScalar(n));
      liquidUnits += n;
    }
  }
  if (units === 0) return { color: new THREE.Color('#888'), units: 0, frac, liquidColor: null, clearFrac: 0 };
  color.multiplyScalar(1 / wsum);
  for (const k of Object.keys(frac) as IngKind[]) frac[k] /= units;
  // 足し算の平均だけだと白っぽくくすむので、絵の具のような掛け算の平均（幾何平均）と混ぜる
  const geo = new THREE.Color(Math.exp(lg[0] / wsum), Math.exp(lg[1] / wsum), Math.exp(lg[2] / wsum));
  color.lerp(geo, 0.65);
  return {
    color,
    units,
    frac,
    liquidColor: liquidUnits ? liquidColor.multiplyScalar(1 / liquidUnits) : null,
    clearFrac: (ing.clear ?? 0) / units,
  };
}

const NOISE_GLSL = /* glsl */ `
  varying vec3 vFoodPos;
  varying vec3 vFoodNormal;
  float fHash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float fNoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(fHash(i + vec3(0,0,0)), fHash(i + vec3(1,0,0)), f.x), mix(fHash(i + vec3(0,1,0)), fHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(fHash(i + vec3(0,0,1)), fHash(i + vec3(1,0,1)), f.x), mix(fHash(i + vec3(0,1,1)), fHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
`;

export interface FoodUniforms {
  uHeat: { value: number };
  uTime: { value: number };
  uWobble: { value: number };
  uBrownAmt: { value: number };
  uGrill: { value: number };
}

/** 焼き色・焦げ・霜をシェーダーで足した料理用マテリアル */
export function foodMaterial(color: THREE.Color, comp: Composition | null, uniforms: FoodUniforms, opts: Partial<THREE.MeshPhysicalMaterialParameters> = {}): THREE.MeshPhysicalMaterial {
  const f = comp?.frac;
  const rough = f ? f.liquid * 0.2 + f.gel * 0.24 + f.paste * 0.42 + f.grain * 0.72 + f.solid * 0.58 + f.crystal * 0.3 + f.powder * 0.8 : 0.4;
  const clear = f ? f.liquid * 0.45 + f.gel * 0.5 + f.paste * 0.22 : 0.2;
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    roughness: rough,
    metalness: 0,
    clearcoat: clear,
    clearcoatRoughness: 0.28,
    sheen: f ? f.grain * 0.35 + f.solid * 0.2 : 0,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color('#fff4e0'),
    envMapIntensity: 0.5,
    ...opts,
  });
  // 水気の多いもの（ゼリーなど）は半透明に。透過（transmission）は画面全体の再描画が要るので使わない
  if (comp && comp.clearFrac >= 0.33 && !opts.transparent) {
    mat.transparent = true;
    mat.opacity = 0.78;
    mat.roughness = 0.1;
    mat.clearcoat = 0.8;
  }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vFoodPos;
        varying vec3 vFoodNormal;
        uniform float uWobble;
        uniform float uTime;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 fp = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          fp = instanceMatrix * fp;
        #endif
        vFoodPos = fp.xyz;
        vFoodNormal = normal;
        if (uWobble > 0.0) {
          float w = sin(position.y * 55.0 + uTime * 4.0) * cos(position.x * 47.0 + uTime * 3.1) + sin(position.z * 61.0 - uTime * 2.3);
          transformed += normal * w * uWobble;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uHeat;
        uniform float uBrownAmt;
        uniform float uGrill;
        ${NOISE_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float fn = fNoise(vFoodPos * 110.0) * 0.6 + fNoise(vFoodPos * 330.0) * 0.4;
        float brown = smoothstep(0.25, 0.95, uHeat) * uBrownAmt;
        vec3 browned = diffuseColor.rgb * vec3(0.52, 0.31, 0.16);
        diffuseColor.rgb = mix(diffuseColor.rgb, browned, brown * (0.5 + 0.5 * fn));
        float charAmt = smoothstep(0.82, 1.0, uHeat) * smoothstep(0.55, 0.85, fn) * 0.65 * uBrownAmt;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.045, 0.03), charAmt);
        // 焼き網の跡（上を向いた面だけ）
        float topFace = smoothstep(0.55, 0.9, normalize(vFoodNormal + vec3(0.0, 1e-4, 0.0)).y);
        float grill = smoothstep(0.62, 0.9, uHeat) * uGrill * topFace * smoothstep(0.78, 0.86, fract((vFoodPos.x * 0.7 + vFoodPos.z) * 30.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.045, 0.025), grill * 0.75);
        float burnt = smoothstep(1.0, 1.18, uHeat);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.03, 0.028) + fn * 0.035, burnt * 0.93);
        float frost = smoothstep(-0.55, -0.95, uHeat);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.93, 1.0), frost * (0.3 + 0.55 * smoothstep(0.4, 0.75, fn)));
        float chill = smoothstep(-0.12, -0.5, uHeat);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.93, 0.98, 1.05), chill);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.85, frost * 0.8);
        roughnessFactor = mix(roughnessFactor, 0.92, burnt);`,
      );
  };
  mat.customProgramCacheKey = () => 'food-v1';
  return mat;
}

// ───────────── 形 ─────────────

function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

function displaceNoise(geo: THREE.BufferGeometry, amp: number, freq = 60, seed = 1): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nrm, i);
    const d = Math.sin(v.x * freq + seed) * Math.cos(v.z * freq * 0.9 + seed * 2) * Math.sin(v.y * freq * 1.1 + seed * 3);
    v.addScaledVector(n, d * amp);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
}

/** 粒・麺の山の高さ */
function moundY(r: number, R: number, H: number): number {
  const k = Math.min(1, r / R);
  return H * (1 - k * k);
}

interface Body {
  objects: THREE.Object3D[];
  height: number;
  radius: number;
  /** ソースを沿わせる元のメッシュ */
  sauceTargets: THREE.Mesh[];
  mound?: { R: number; H: number };
}

function buildBody(form: FormId, s: number, mat: THREE.MeshPhysicalMaterial, comp: Composition, seed: number): Body {
  switch (form) {
    case 'disc': {
      const R = 0.085 * s;
      const H = 0.032 * s;
      const pts = [
        [0, 0],
        [R * 0.9, 0],
        [R * 0.99, H * 0.22],
        [R * 1.01, H * 0.55],
        [R * 0.96, H * 0.88],
        [R * 0.84, H],
        [R * 0.4, H * 1.05],
        [0, H * 1.06],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      const geo = new THREE.LatheGeometry(smoothProfile(pts, 26), 64);
      displaceNoise(geo, 0.0018 * s, 70 / s, seed);
      const m = new THREE.Mesh(geo, mat);
      return { objects: [m], height: H * 1.06, radius: R, sauceTargets: [m] };
    }
    case 'ball': {
      const rb = 0.036 * s;
      const objs: THREE.Mesh[] = [];
      const places: [number, number][] = [
        [-0.039, 0.02],
        [0.039, 0.02],
        [0, -0.036],
      ];
      for (let i = 0; i < 3; i++) {
        const geo = new THREE.SphereGeometry(rb, 32, 24);
        displaceNoise(geo, 0.0016 * s, 80 / s, seed + i * 3);
        const m = new THREE.Mesh(geo, mat);
        m.position.set(places[i][0] * s, rb * 0.96, places[i][1] * s);
        m.rotation.set(hash(seed + i) * 3, hash(seed + i + 9) * 3, 0);
        objs.push(m);
      }
      return { objects: objs, height: rb * 1.95, radius: 0.08 * s, sauceTargets: objs };
    }
    case 'cube': {
      const w = 0.11 * s;
      const h = 0.066 * s;
      const d = 0.086 * s;
      const geo = new RoundedBoxGeometry(w, h, d, 4, 0.012 * s);
      const m = new THREE.Mesh(geo, mat);
      m.position.y = h / 2;
      m.rotation.y = (hash(seed) - 0.5) * 0.3;
      return { objects: [m], height: h, radius: 0.075 * s, sauceTargets: [m] };
    }
    case 'stick': {
      const r = 0.021 * s;
      const len = 0.11 * s;
      const objs: THREE.Mesh[] = [];
      for (let i = 0; i < 2; i++) {
        const geo = new THREE.CapsuleGeometry(r, len, 8, 20);
        displaceNoise(geo, 0.001 * s, 90 / s, seed + i);
        const m = new THREE.Mesh(geo, mat);
        m.rotation.z = Math.PI / 2;
        m.rotation.y = (i === 0 ? 1 : -1) * 0.08;
        m.position.set(0, r, (i === 0 ? -1 : 1) * 0.026 * s);
        objs.push(m);
      }
      return { objects: objs, height: r * 2, radius: 0.08 * s, sauceTargets: objs };
    }
    case 'wedge': {
      const a = 0.064 * s;
      const hgt = 0.1 * s;
      const cr = 0.014 * s;
      const shape = new THREE.Shape();
      shape.moveTo(-a + cr, 0);
      shape.lineTo(a - cr, 0);
      shape.quadraticCurveTo(a, 0, a - cr * 0.4, cr * 0.9);
      shape.lineTo(cr * 0.5, hgt - cr);
      shape.quadraticCurveTo(0, hgt, -cr * 0.5, hgt - cr);
      shape.lineTo(-a + cr * 0.4, cr * 0.9);
      shape.quadraticCurveTo(-a, 0, -a + cr, 0);
      const depth = 0.05 * s;
      const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.008 * s, bevelSize: 0.007 * s, bevelSegments: 4, curveSegments: 10 });
      geo.translate(0, 0, -depth / 2);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.position.y = 0.007 * s;
      return { objects: [m], height: hgt + 0.007 * s, radius: 0.07 * s, sauceTargets: [m] };
    }
    case 'dome': {
      const pts = [
        [0, 0],
        [0.075, 0],
        [0.074, 0.008],
        [0.069, 0.038],
        [0.059, 0.06],
        [0.043, 0.075],
        [0.022, 0.082],
        [0, 0.084],
      ].map(([x, y]) => new THREE.Vector2(x * s, y * s));
      const geo = new THREE.LatheGeometry(smoothProfile(pts, 30), 64);
      displaceNoise(geo, 0.0012 * s, 60 / s, seed);
      const m = new THREE.Mesh(geo, mat);
      return { objects: [m], height: 0.084 * s, radius: 0.075 * s, sauceTargets: [m] };
    }
    case 'grain': {
      const R = 0.078 * s;
      const H = 0.056 * s;
      const n = Math.round(520 * s * s);
      const grainGeo = new THREE.CapsuleGeometry(0.0029 * s, 0.0058 * s, 2, 6);
      const inst = new THREE.InstancedMesh(grainGeo, mat, n);
      const dummy = new THREE.Object3D();
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const r = R * Math.sqrt(hash(seed + i * 1.7));
        const t = hash(seed + i * 3.1) * Math.PI * 2;
        const top = moundY(r, R, H);
        dummy.position.set(Math.cos(t) * r, Math.max(0.003, top * (0.55 + 0.45 * hash(i * 5.3 + seed))), Math.sin(t) * r);
        dummy.rotation.set(hash(i * 2.2) * 3, hash(i * 7.7) * 3, hash(i * 1.3) * 3);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        const v = 0.86 + hash(i * 9.1 + seed) * 0.26;
        inst.setColorAt(i, c.setRGB(v, v, v));
      }
      inst.castShadow = true;
      // 隙間を埋める下地
      const base = new THREE.Mesh(moundGeometry(R * 0.96, H * 0.9), mat);
      return { objects: [base, inst], height: H, radius: R, sauceTargets: [], mound: { R, H } };
    }
    case 'noodle': {
      const R = 0.075 * s;
      const H = 0.045 * s;
      const thick = (comp.frac.grain ?? 0) >= 0.75 ? 0.0068 : 0.0045;
      const geos: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 18; i++) {
        const pts: THREE.Vector3[] = [];
        let a = hash(seed + i * 2.3) * Math.PI * 2;
        let r = R * (0.3 + hash(seed + i) * 0.6);
        for (let k = 0; k < 7; k++) {
          a += 0.6 + hash(seed + i * 7 + k) * 1.2;
          r = Math.min(R * 0.95, Math.max(R * 0.1, r + (hash(i * 13 + k) - 0.5) * R * 0.5));
          const y = moundY(r, R, H) * (0.4 + 0.6 * hash(i * 3 + k * 5)) + 0.004;
          pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        geos.push(new THREE.TubeGeometry(curve, 60, thick * s, 6, false));
      }
      const merged = mergeGeometries(geos)!;
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = true;
      const base = new THREE.Mesh(moundGeometry(R * 0.9, H * 0.75), mat);
      return { objects: [base, m], height: H, radius: R, sauceTargets: [], mound: { R, H } };
    }
    case 'liquid':
    case 'fizz':
    default: {
      const r = 0.07 * s;
      const geo = new THREE.IcosahedronGeometry(r, 5);
      geo.translate(0, r, 0);
      const m = new THREE.Mesh(geo, mat);
      return { objects: [m], height: r * 2, radius: r, sauceTargets: [] };
    }
  }
}

function moundGeometry(R: number, H: number): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const r = R * (1 - i / 12);
    pts.push(new THREE.Vector2(r, moundY(r, R, H)));
  }
  pts[0].y = 0;
  return new THREE.LatheGeometry(pts, 40);
}

// ───────────── トッピング ─────────────

type ToppingStyle = 'sauce' | 'pool' | 'dollop' | 'sprinkle' | 'cap' | 'broth' | 'foam' | 'float' | 'swirl' | 'melt';

function isBrothIng(id: IngId): boolean {
  return id === 'clear' || id === 'amber';
}

function toppingStyle(id: IngId, form: FormId, vessel: VesselId | null): ToppingStyle {
  const kind = ING[id].kind;
  const liquidBody = form === 'liquid' || form === 'fizz';
  const mound = form === 'grain' || form === 'noodle';
  if (liquidBody) {
    if (!vessel) return kind === 'liquid' || kind === 'paste' ? 'cap' : 'sprinkle';
    if (id === 'milk') return 'foam';
    if (kind === 'liquid') return 'swirl';
    // ペースト（チーズ役など）は表面を覆って焼き色がつく
    if (kind === 'paste' && vessel !== 'cup' && vessel !== 'glass') return 'melt';
    return 'float';
  }
  if (mound && isBrothIng(id) && vessel && vessel !== 'plate') return 'broth';
  if (kind === 'crystal' || kind === 'powder' || kind === 'grain' || kind === 'solid') return 'sprinkle';
  if (mound) return 'pool';
  if ((kind === 'paste' || kind === 'gel') && form === 'disc') return 'dollop';
  // 三角（おにぎり・ケーキ）の上は、てっぺんにちょこんと乗せる
  if (form === 'wedge') return 'dollop';
  return 'sauce';
}

/** 回転体の断面をなめらかにする（ソースの縁がギザギザにならないよう点を増やす） */
function smoothProfile(pts: THREE.Vector2[], n: number): THREE.Vector2[] {
  const curve = new THREE.SplineCurve(pts);
  const out = curve.getSpacedPoints(n);
  out[0].set(0, pts[0].y);
  out[out.length - 1].set(0, pts[pts.length - 1].y);
  return out;
}

function sauceMaterial(id: IngId): THREE.MeshPhysicalMaterial {
  const ing = ING[id];
  const c = new THREE.Color(ing.color);
  const liquid = ing.kind === 'liquid';
  const m = new THREE.MeshPhysicalMaterial({
    color: c,
    roughness: id === 'milk' ? 0.45 : liquid ? 0.22 : 0.36,
    clearcoat: 0.7,
    clearcoatRoughness: 0.22,
    metalness: 0,
    envMapIntensity: 0.55,
  });
  if (id === 'clear') {
    m.transparent = true;
    m.opacity = 0.45;
  }
  if (id === 'black') {
    m.color.set('#3f1f0e');
    m.clearcoat = 0.45;
    m.roughness = 0.3;
  }
  if (id === 'amber') {
    m.transparent = true;
    m.opacity = 0.85;
  }
  return m;
}

/**
 * 本体の上側にかかったソース。本体と同じ形を法線方向に少し膨らませ、
 * 縁（垂れ具合）はフラグメント単位で切り抜くので、なめらかに波打つ。
 */
function clipSauce(target: THREE.Mesh, base: THREE.MeshPhysicalMaterial, coverage: number, seed: number): THREE.Mesh {
  target.updateMatrix();
  const g = target.geometry;
  g.computeBoundingBox();
  const bb = g.boundingBox!.clone().applyMatrix4(target.matrix);
  const mat = base.clone();
  const u = {
    uLocal: { value: target.matrix.clone() },
    uTop: { value: bb.max.y },
    uH: { value: bb.max.y - bb.min.y },
    uCx: { value: (bb.min.x + bb.max.x) / 2 },
    uCz: { value: (bb.min.z + bb.max.z) / 2 },
    uCov: { value: coverage },
    uSeed: { value: seed % 97 },
    uOff: { value: 0.0024 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform mat4 uLocal;\nuniform float uOff;\nvarying vec3 vSP;\nvarying float vSNy;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed += normal * uOff;
        vSP = (uLocal * vec4(transformed, 1.0)).xyz;
        vSNy = normalize(mat3(uLocal) * normal + vec3(0.0, 1e-5, 0.0)).y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTop; uniform float uH; uniform float uCx; uniform float uCz; uniform float uCov; uniform float uSeed;
        varying vec3 vSP; varying float vSNy;`,
      )
      .replace(
        'void main() {',
        `void main() {
        float sAng = atan(vSP.z - uCz, vSP.x - uCx + 1e-5);
        float sCov = uCov * (0.8 + 0.2 * sin(sAng * 3.0 + uSeed) + 0.1 * sin(sAng * 7.0 + uSeed * 2.0));
        for (int i = 0; i < 5; i++) {
          float d = fract(sin(uSeed * 7.13 + float(i) * 4.1) * 43758.5453) * 6.2831853;
          float da = atan(sin(sAng - d), cos(sAng - d));
          sCov += exp(-(da * da) / 0.012) * uCov * 0.7;
        }
        float sEdge = uTop - uH * min(0.98, sCov);
        if (vSP.y < sEdge || vSNy < -0.4) discard;`,
      );
  };
  mat.customProgramCacheKey = () => 'sauce-clip-v1';
  const m = new THREE.Mesh(g, mat);
  m.position.copy(target.position);
  m.quaternion.copy(target.quaternion);
  m.scale.copy(target.scale);
  m.userData.sharedGeo = true;
  return m;
}

/** 粒や麺の山に沿って垂れるソースの溜まり */
function poolGeometry(R: number, H: number, pr: number, ox: number, oz: number, seed: number): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(1, 64, 0, Math.PI * 2);
  // 放射方向の分割を増やす
  const rings = 10;
  const segs = 64;
  const positions: number[] = [];
  const indices: number[] = [];
  positions.push(ox, moundY(Math.hypot(ox, oz), R, H) + 0.004, oz);
  for (let ri = 1; ri <= rings; ri++) {
    for (let si = 0; si < segs; si++) {
      const ang = (si / segs) * Math.PI * 2;
      const wob = 1 + 0.18 * Math.sin(ang * 3 + seed) + 0.1 * Math.sin(ang * 7 + seed * 1.7);
      const rr = (pr * wob * ri) / rings;
      const x = ox + Math.cos(ang) * rr;
      const z = oz + Math.sin(ang) * rr;
      const r = Math.hypot(x, z);
      const y = Math.max(0.002, moundY(r, R, H)) + 0.004 * (1 - (ri / rings) * 0.6);
      positions.push(x, y, z);
    }
  }
  for (let si = 0; si < segs; si++) indices.push(0, 1 + ((si + 1) % segs), 1 + si);
  for (let ri = 1; ri < rings; ri++) {
    for (let si = 0; si < segs; si++) {
      const a = 1 + (ri - 1) * segs + si;
      const b = 1 + (ri - 1) * segs + ((si + 1) % segs);
      const c = 1 + ri * segs + si;
      const d = 1 + ri * segs + ((si + 1) % segs);
      indices.push(a, b, c, b, d, c);
    }
  }
  geo.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// ───────────── 料理 ─────────────

export class Food {
  readonly group = new THREE.Group();
  readonly bodyRoot = new THREE.Group();
  private toppingGroup = new THREE.Group();
  private fillGroup = new THREE.Group();
  readonly uniforms: FoodUniforms = { uHeat: { value: 0 }, uTime: { value: 0 }, uWobble: { value: 0 }, uBrownAmt: { value: 1 }, uGrill: { value: 0 } };
  readonly comp: Composition;
  readonly form: FormId;
  readonly material: THREE.MeshPhysicalMaterial;
  private body: Body;
  private seed = Math.random() * 100;
  private scaleK: number;
  topping: IngId | null = null;
  vessel: VesselInfo | null = null;
  private fizzBubbles: THREE.InstancedMesh | null = null;
  private fillLevel = 0;
  private toppingGrow = 1;
  private eaten = 0;
  private fitScale = 1;
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor(ing: Record<IngId, number>, form: FormId) {
    this.comp = analyze(ing);
    this.form = form;
    const sizeK = Math.max(0.72, Math.min(1.28, 0.82 + 0.09 * (this.comp.units - 2)));
    this.scaleK = sizeK * FOOD_SCALE;
    const liquidBody = form === 'liquid' || form === 'fizz';
    this.uniforms.uBrownAmt.value = liquidBody ? 0.25 : 1;
    // 焼き網の跡は「肉・魚っぽい」もの（褐色ペースト・灰色キューブが主）だけ
    const meaty = ((ing.brown ?? 0) + (ing.grey ?? 0)) / Math.max(1, this.comp.units) >= 0.5;
    this.uniforms.uGrill.value = meaty && (form === 'disc' || form === 'stick' || form === 'cube') ? 1 : 0;
    this.uniforms.uWobble.value = liquidBody ? 0.0032 : 0;
    this.material = foodMaterial(this.comp.color, this.comp, this.uniforms);
    this.disposables.push(this.material);
    this.body = buildBody(form, this.scaleK, this.material, this.comp, this.seed);
    for (const o of this.body.objects) {
      o.castShadow = true;
      o.receiveShadow = true;
      this.bodyRoot.add(o);
      if ((o as THREE.Mesh).geometry) this.disposables.push((o as THREE.Mesh).geometry);
    }
    this.bodyRoot.add(this.toppingGroup);
    this.group.add(this.bodyRoot, this.fillGroup);
  }

  get height(): number {
    return this.body.height;
  }

  get isLiquid(): boolean {
    return this.form === 'liquid' || this.form === 'fizz';
  }

  /** 上端の高さ（ワールドでの湯気の出どころ） */
  topWorld(): THREE.Vector3 {
    const v = new THREE.Vector3(0, this.vessel && this.isLiquid ? this.fillLevel : this.body.height * this.fitScale + (this.vessel?.floorY ?? 0), 0);
    return this.group.localToWorld(v);
  }

  setHeat(t: number): void {
    this.uniforms.uHeat.value = t;
  }

  setTopping(id: IngId | null): void {
    this.topping = id;
    this.toppingGrow = 0;
    this.rebuildExtras();
  }

  placeInVessel(v: VesselInfo | null): void {
    this.vessel = v;
    this.rebuildExtras();
  }

  /** 食べた割合（0..1） */
  setEaten(k: number): void {
    this.eaten = k;
    // 汁や下に敷いた分は、縦に縮めると器の外へはみ出すので、器の内側に沿って水位を下げて作り直す
    if (this.vessel) this.rebuildExtras(true);
    this.bodyRoot.scale.setScalar(this.fitScale * Math.max(0.001, 1 - k * 0.92));
  }

  private clearGroup(g: THREE.Group): void {
    for (const c of [...g.children]) {
      g.remove(c);
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry && !m.userData.sharedGeo) m.geometry.dispose();
        const mat = m.material as THREE.Material | undefined;
        if (mat && mat !== this.material) mat.dispose();
      });
    }
  }

  /** 器まわりの見た目（汁・下に敷いた分・トッピング）を作り直す。fillOnly なら本体に載せたトッピングはそのまま */
  private rebuildExtras(fillOnly = false): void {
    if (!fillOnly) this.clearGroup(this.toppingGroup);
    this.clearGroup(this.fillGroup);
    this.fizzBubbles = null;
    const v = this.vessel;
    const liquidBody = this.isLiquid;
    // 食べた分だけ、器に満たしたものの水位を下げる（器の底へ向かって）
    const keep = Math.max(0.03, 1 - this.eaten * 0.95);
    const lower = (y: number) => (v ? v.floorY + (y - v.floorY) * keep : y);
    let rawBase = v?.floorY ?? 0;

    // 本体の配置
    if (v) {
      if (liquidBody) {
        for (const o of this.body.objects) o.visible = false;
        const lv = v.id === 'plate' ? 0.4 : v.id === 'glass' ? 0.8 : v.id === 'cup' ? 0.78 : 0.7;
        this.fillLevel = lower(v.floorY + (v.rimY - v.floorY) * lv);
        const fillMat = foodMaterial(this.comp.color, this.comp, this.uniforms, this.comp.clearFrac >= 0.5 ? { transparent: true, opacity: 0.55 } : {});
        const fill = new THREE.Mesh(fillGeometry(v, this.fillLevel), fillMat);
        fill.receiveShadow = true;
        this.fillGroup.add(fill);
        if (this.form === 'fizz') this.addFizz(v);
        this.fitScale = 1;
        this.bodyRoot.scale.setScalar(1);
      } else {
        for (const o of this.body.objects) o.visible = true;
        // 粒や麺を深い器に盛るときは、器の中ほどまで同じ料理で満たし、その上に山を作る
        let base = v.floorY;
        const mound = this.form === 'grain' || this.form === 'noodle';
        if (mound && v.id !== 'plate') {
          const k = v.id === 'deep' ? 0.3 : v.id === 'chawan' ? 0.55 : 0.5;
          base = v.floorY + (v.rimY - v.floorY) * k;
          const filler = new THREE.Mesh(fillGeometry(v, lower(base)), this.material);
          filler.receiveShadow = true;
          this.fillGroup.add(filler);
        }
        rawBase = base;
        const avail = innerRadiusAt(v, base + this.body.height * 0.4) * 0.94;
        this.fitScale = Math.min(1, avail / this.body.radius);
        this.bodyRoot.scale.setScalar(this.fitScale);
        this.bodyRoot.position.y = lower(base);
        // 粒に水気が多ければおかゆのように浸す
        if (this.form === 'grain' && this.comp.liquidColor && this.comp.frac.liquid >= 0.4 && v.id !== 'plate') {
          const lvl = lower(base + this.body.height * this.fitScale * 0.5);
          const m = new THREE.Mesh(
            fillGeometry(v, lvl),
            new THREE.MeshPhysicalMaterial({ color: this.comp.liquidColor.clone().lerp(this.comp.color, 0.5), roughness: 0.1, transparent: true, opacity: 0.7, clearcoat: 1 }),
          );
          this.fillGroup.add(m);
        }
      }
    } else {
      for (const o of this.body.objects) o.visible = true;
      this.fitScale = 1;
      this.bodyRoot.scale.setScalar(1);
      this.bodyRoot.position.y = 0;
    }

    // トッピング
    const id = this.topping;
    if (!id) return;
    const style = toppingStyle(id, this.form, v?.id ?? null);
    const onBody = style === 'sauce' || style === 'pool' || style === 'dollop' || style === 'sprinkle' || style === 'cap';
    if (fillOnly && onBody) return;
    const smat = sauceMaterial(id);
    const s = this.scaleK;
    switch (style) {
      case 'sauce': {
        const cov = this.form === 'dome' ? 0.42 : this.form === 'wedge' ? 0.22 : this.form === 'cube' ? 0.35 : this.form === 'stick' ? 0.45 : this.form === 'ball' ? 0.5 : 0.4;
        for (const t of this.body.sauceTargets) this.toppingGroup.add(clipSauce(t, smat, cov, this.seed + t.id));
        break;
      }
      case 'pool': {
        const md = this.body.mound!;
        const g = poolGeometry(md.R, md.H, md.R * 0.62, md.R * 0.18, md.R * 0.05, this.seed);
        const m = new THREE.Mesh(g, smat);
        m.castShadow = true;
        this.toppingGroup.add(m);
        break;
      }
      case 'dollop': {
        const r = 0.03 * s;
        const geo = new THREE.SphereGeometry(r, 32, 16);
        displaceNoise(geo, 0.0012 * s, 80, this.seed);
        const m = new THREE.Mesh(geo, smat);
        m.scale.set(1, 0.62, 1);
        m.position.set(0, this.body.height + r * 0.2, 0);
        m.castShadow = true;
        this.toppingGroup.add(m);
        break;
      }
      case 'sprinkle': {
        this.addSprinkles(id, smat);
        break;
      }
      case 'cap': {
        const r = this.body.radius;
        const geo = new THREE.SphereGeometry(r * 1.03, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.32);
        const m = new THREE.Mesh(geo, smat);
        m.position.y = r;
        this.toppingGroup.add(m);
        break;
      }
      case 'broth': {
        if (!v) break;
        // 麺や粒の山が汁から少し顔を出す高さ
        const lvl = lower(rawBase + this.body.height * this.fitScale * 0.5);
        const bm = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(ING[id].color),
          roughness: 0.05,
          transparent: true,
          opacity: id === 'clear' ? 0.35 : 0.68,
          clearcoat: 0.8,
          envMapIntensity: 0.6,
          depthWrite: false,
        });
        const m = new THREE.Mesh(fillGeometry(v, lvl), bm);
        m.renderOrder = 3;
        this.fillGroup.add(m);
        // 表面の油の粒
        if (id === 'amber') {
          const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 16), new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.55, depthWrite: false }), 26);
          const d = new THREE.Object3D();
          const rr = innerRadiusAt(v, lvl) * 0.85;
          for (let i = 0; i < 26; i++) {
            const a = hash(i * 3.3 + this.seed) * Math.PI * 2;
            const r = Math.sqrt(hash(i * 1.9)) * rr;
            d.position.set(Math.cos(a) * r, lvl + 0.0008, Math.sin(a) * r);
            d.rotation.set(-Math.PI / 2, 0, 0);
            d.scale.setScalar(0.002 + hash(i * 7.7) * 0.004);
            d.updateMatrix();
            dots.setMatrixAt(i, d.matrix);
          }
          this.fillGroup.add(dots);
        }
        break;
      }
      case 'melt': {
        if (!v) break;
        const rr = innerRadiusAt(v, this.fillLevel) * 0.9;
        const geo = new THREE.CylinderGeometry(rr, rr * 0.98, 0.008 * FOOD_SCALE, 48, 2);
        const pos = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          if (pos.getY(i) > 0) {
            const x = pos.getX(i);
            const z = pos.getZ(i);
            pos.setY(i, pos.getY(i) + (Math.sin(x * 160 + this.seed) * Math.cos(z * 140) + 1) * 0.0022);
          }
        }
        geo.computeVertexNormals();
        // 本体と同じ温度で、しっかり焼き色がつくように
        const mu: FoodUniforms = { uHeat: this.uniforms.uHeat, uTime: this.uniforms.uTime, uWobble: { value: 0 }, uBrownAmt: { value: 1 }, uGrill: { value: 0 } };
        const mm = foodMaterial(new THREE.Color(ING[id].color), null, mu, { roughness: 0.45, clearcoat: 0.3 });
        const m = new THREE.Mesh(geo, mm);
        m.position.y = this.fillLevel + 0.002;
        this.fillGroup.add(m);
        break;
      }
      case 'foam': {
        if (!v) break;
        const rr = innerRadiusAt(v, this.fillLevel) - 0.002;
        const geo = new THREE.CylinderGeometry(rr, rr, 0.016 * FOOD_SCALE, 40, 3);
        const pos = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          if (pos.getY(i) > 0) {
            const x = pos.getX(i);
            const z = pos.getZ(i);
            pos.setY(i, pos.getY(i) + Math.sin(x * 300) * Math.cos(z * 280) * 0.0018 + (1 - Math.hypot(x, z) / rr) * 0.006);
          }
        }
        geo.computeVertexNormals();
        const fm = new THREE.MeshPhysicalMaterial({ color: '#f7f3ea', roughness: 0.7, sheen: 1, sheenColor: new THREE.Color('#ffffff'), clearcoat: 0.2 });
        const m = new THREE.Mesh(geo, fm);
        m.position.y = this.fillLevel + 0.006 * FOOD_SCALE;
        this.fillGroup.add(m);
        break;
      }
      case 'swirl': {
        if (!v) break;
        const rr = innerRadiusAt(v, this.fillLevel) * 0.7;
        const g = new THREE.CircleGeometry(rr, 48);
        const m = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: ING[id].color, roughness: 0.15, transparent: true, opacity: 0.8, clearcoat: 1, depthWrite: false }));
        m.rotation.x = -Math.PI / 2;
        m.position.y = this.fillLevel + 0.001;
        this.fillGroup.add(m);
        break;
      }
      case 'float': {
        if (!v) break;
        const n = 14;
        const rr = innerRadiusAt(v, this.fillLevel) * 0.8;
        const geo = ING[id].kind === 'gel' ? new THREE.BoxGeometry(0.014, 0.003, 0.009) : new THREE.SphereGeometry(0.008, 12, 8);
        const inst = new THREE.InstancedMesh(geo, smat, n);
        const d = new THREE.Object3D();
        for (let i = 0; i < n; i++) {
          const a = hash(i * 2.1 + this.seed) * Math.PI * 2;
          const r = Math.sqrt(hash(i * 4.7 + 1)) * rr;
          d.position.set(Math.cos(a) * r, this.fillLevel + 0.001, Math.sin(a) * r);
          d.rotation.set(0, hash(i) * 6, 0);
          d.scale.set(1 + hash(i * 3) * 0.8, 1, 1 + hash(i * 5) * 0.6).multiplyScalar(FOOD_SCALE);
          d.updateMatrix();
          inst.setMatrixAt(i, d.matrix);
        }
        this.fillGroup.add(inst);
        break;
      }
    }
  }

  private addSprinkles(id: IngId, mat: THREE.Material): void {
    const kind = ING[id].kind;
    const geo =
      kind === 'crystal'
        ? new THREE.OctahedronGeometry(0.0045 * this.scaleK)
        : kind === 'solid'
          ? new THREE.BoxGeometry(0.012 * this.scaleK, 0.012 * this.scaleK, 0.012 * this.scaleK)
          : kind === 'grain'
            ? new THREE.CapsuleGeometry(0.003 * this.scaleK, 0.005 * this.scaleK, 2, 5)
            : new THREE.SphereGeometry(0.0028 * this.scaleK, 6, 4);
    const n = kind === 'solid' ? 6 : 46;
    const inst = new THREE.InstancedMesh(geo, mat, n);
    const ray = new THREE.Raycaster();
    const targets = this.body.objects;
    this.bodyRoot.updateMatrixWorld(true);
    const d = new THREE.Object3D();
    let placed = 0;
    const R = this.body.radius * 0.8;
    for (let i = 0; i < n * 3 && placed < n; i++) {
      const a = hash(i * 1.37 + this.seed) * Math.PI * 2;
      const r = Math.sqrt(hash(i * 2.91 + 3)) * R;
      const local = new THREE.Vector3(Math.cos(a) * r, this.body.height + 0.1, Math.sin(a) * r);
      const origin = this.bodyRoot.localToWorld(local.clone());
      ray.set(origin, new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObjects(targets, false)[0];
      if (!hit) continue;
      const p = this.bodyRoot.worldToLocal(hit.point.clone());
      d.position.copy(p).add(new THREE.Vector3(0, 0.002, 0));
      d.rotation.set(hash(i) * 3, hash(i * 2) * 3, hash(i * 3) * 3);
      d.scale.setScalar(0.8 + hash(i * 9) * 0.5);
      d.updateMatrix();
      inst.setMatrixAt(placed++, d.matrix);
    }
    inst.count = placed;
    this.toppingGroup.add(inst);
  }

  private addFizz(v: VesselInfo): void {
    const n = 22;
    const inst = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false }),
      n,
    );
    inst.userData.seeds = Array.from({ length: n }, (_, i) => hash(i * 3.7 + this.seed));
    inst.userData.v = v;
    inst.renderOrder = 5;
    this.fizzBubbles = inst;
    this.fillGroup.add(inst);
  }

  update(dt: number, time: number): void {
    this.uniforms.uTime.value = time;
    if (this.toppingGrow < 1) {
      this.toppingGrow = Math.min(1, this.toppingGrow + dt * 2.2);
      const k = 1 - Math.pow(1 - this.toppingGrow, 3);
      this.toppingGroup.scale.set(1, k, 1);
    }
    if (this.fizzBubbles) {
      const inst = this.fizzBubbles;
      const seeds = inst.userData.seeds as number[];
      const v = inst.userData.v as VesselInfo;
      const d = new THREE.Object3D();
      const top = this.fillLevel - v.floorY;
      for (let i = 0; i < seeds.length; i++) {
        const s = seeds[i];
        const y = v.floorY + ((time * (0.03 + s * 0.04) + s) % 1) * top;
        const rr = innerRadiusAt(v, y) * 0.8 * ((s * 7.3) % 1);
        const a = s * 50;
        d.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
        d.scale.setScalar(0.0012 + s * 0.0016);
        d.updateMatrix();
        inst.setMatrixAt(i, d.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.clearGroup(this.toppingGroup);
    this.clearGroup(this.fillGroup);
    for (const d of this.disposables) d.dispose();
    this.group.parent?.remove(this.group);
  }
}

/** 成形プレスの型（ピストンの先につける見た目だけのもの） */
export function moldGeometry(form: FormId): THREE.BufferGeometry | null {
  const s = FOOD_SCALE;
  switch (form) {
    case 'disc':
      return new THREE.CylinderGeometry(0.09 * s, 0.09 * s, 0.03, 40);
    case 'ball':
      return new THREE.SphereGeometry(0.05 * s, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    case 'cube':
      return new THREE.BoxGeometry(0.12 * s, 0.04, 0.095 * s);
    case 'stick':
      return new THREE.BoxGeometry(0.15 * s, 0.03, 0.07 * s);
    case 'wedge':
      return new THREE.CylinderGeometry(0.08 * s, 0.08 * s, 0.035, 3);
    case 'dome':
      return new THREE.SphereGeometry(0.08 * s, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    case 'grain':
      return new THREE.CylinderGeometry(0.085 * s, 0.085 * s, 0.03, 12);
    case 'noodle':
      return new THREE.CylinderGeometry(0.06 * s, 0.07 * s, 0.05, 24);
    default:
      return null;
  }
}
