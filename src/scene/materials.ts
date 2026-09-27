import * as THREE from 'three';
import { brushedRoughness, wallPanel, floorTiles, hazardStripes } from './textures.ts';

// 共有マテリアル（遅延生成）
let cache: ReturnType<typeof create> | null = null;

function create() {
  const brushed = brushedRoughness();
  const steel = new THREE.MeshStandardMaterial({
    color: '#b9c2ca',
    metalness: 1,
    roughness: 0.38,
    roughnessMap: brushed,
    envMapIntensity: 1.1,
  });
  const steelDark = new THREE.MeshStandardMaterial({ color: '#59616b', metalness: 0.9, roughness: 0.42, roughnessMap: brushed });
  const gunmetal = new THREE.MeshStandardMaterial({ color: '#2b3139', metalness: 0.75, roughness: 0.5 });
  const blackMetal = new THREE.MeshStandardMaterial({ color: '#15181c', metalness: 0.6, roughness: 0.55 });
  const wallTex = wallPanel();
  const wall = new THREE.MeshStandardMaterial({ map: wallTex, color: '#9aa4ae', metalness: 0.35, roughness: 0.72 });
  const floorTex = floorTiles();
  const floor = new THREE.MeshStandardMaterial({ map: floorTex, color: '#7a8490', metalness: 0.2, roughness: 0.55 });
  const hazard = new THREE.MeshStandardMaterial({ map: hazardStripes(), metalness: 0.2, roughness: 0.6 });
  const plastic = new THREE.MeshPhysicalMaterial({ color: '#e9ebe8', roughness: 0.32, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.25 });
  const plasticDark = new THREE.MeshPhysicalMaterial({ color: '#2a2e33', roughness: 0.45, metalness: 0.1, clearcoat: 0.4 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#141619', roughness: 0.85, metalness: 0 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#dff2ff',
    metalness: 0,
    roughness: 0.04,
    transparent: true,
    opacity: 0.16,
    ior: 1.5,
    envMapIntensity: 2.2,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    depthWrite: false,
  });
  const ceramic = new THREE.MeshPhysicalMaterial({ color: '#a7b1ab', roughness: 0.5, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.35, envMapIntensity: 0.6 });
  return { brushed, steel, steelDark, gunmetal, blackMetal, wall, floor, hazard, plastic, plasticDark, rubber, glass, ceramic };
}

export function mats() {
  if (!cache) cache = create();
  return cache;
}

export function emissive(color: THREE.ColorRepresentation, intensity = 2): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#000', emissive: color, emissiveIntensity: intensity, roughness: 0.6, metalness: 0 });
}

export function basicGlow(color: THREE.ColorRepresentation, opacity = 1, additive = true): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

/** UV を実寸に合わせて繰り返す箱（壁パネル用） */
export function boxUV(w: number, h: number, d: number, scale = 1): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (nx > 0.5) uv.setXY(i, z * scale, y * scale);
    else if (ny > 0.5) uv.setXY(i, x * scale, z * scale);
    else uv.setXY(i, x * scale, y * scale);
  }
  return g;
}
