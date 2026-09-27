import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 動かない小物を、マテリアルごとに 1 つのメッシュへまとめて描画コールを減らす。
 * parent の直下にあるメッシュだけが対象（グループの中身や、除外指定したものはそのまま）。
 */
export function mergeByMaterial(parent: THREE.Object3D, exclude: Set<THREE.Object3D> = new Set()): number {
  parent.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.Mesh[]>();
  for (const c of parent.children) {
    const m = c as THREE.Mesh;
    if (!m.isMesh || exclude.has(m) || m.children.length || Array.isArray(m.material) || (m as unknown as THREE.InstancedMesh).isInstancedMesh) continue;
    const list = buckets.get(m.material as THREE.Material) ?? [];
    list.push(m);
    buckets.set(m.material as THREE.Material, list);
  }
  let removed = 0;
  for (const [mat, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const geos: THREE.BufferGeometry[] = [];
    let cast = false;
    let receive = false;
    for (const m of meshes) {
      m.updateMatrix();
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrix);
      // 属性をそろえる（uv が無いものには 0 を入れる）
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      geos.push(g);
      cast ||= m.castShadow;
      receive ||= m.receiveShadow;
    }
    const indexed = geos.filter((g) => g.index);
    const nonIndexed = geos.filter((g) => !g.index);
    for (const group of [indexed, nonIndexed]) {
      if (group.length < 1) continue;
      const merged = mergeGeometries(group, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      parent.add(mesh);
    }
    for (const m of meshes) {
      parent.remove(m);
      removed++;
    }
    for (const g of geos) g.dispose();
  }
  return removed;
}
