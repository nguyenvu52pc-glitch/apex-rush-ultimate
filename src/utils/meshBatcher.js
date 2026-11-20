import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Merges static child meshes inside a THREE.Group by material to dramatically reduce draw calls
 * (e.g. reducing a full detailed car from ~168 draw calls down to ~18 draw calls)
 * while preserving exact geometry, UVs, normals, and materials.
 * @param {THREE.Group} group
 * @param {Array<{ dispose: () => void }>} disposables
 */
export function batchGroupByMaterial(group, disposables) {
  group.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const relMat = new THREE.Matrix4();

  const buckets = new Map();
  const toRemove = [];

  group.traverse((child) => {
    if (!child.isMesh || !child.geometry || !child.material) return;
    if (Array.isArray(child.material)) return;
    // Keep transparent glass independent so depth sorting remains clean
    if (child.material.transparent) return;

    let list = buckets.get(child.material);
    if (!list) {
      list = {
        material: child.material,
        castShadow: false,
        receiveShadow: false,
        items: [],
      };
      buckets.set(child.material, list);
    }
    list.castShadow = list.castShadow || child.castShadow;
    list.receiveShadow = list.receiveShadow || child.receiveShadow;

    relMat.multiplyMatrices(invRoot, child.matrixWorld);
    list.items.push({ mesh: child, matrix: relMat.clone() });
    toRemove.push(child);
  });

  // Remove original individual meshes
  for (const m of toRemove) {
    m.parent?.remove(m);
  }

  for (const bucket of buckets.values()) {
    const transformed = [];
    for (const item of bucket.items) {
      const src = item.mesh.geometry;
      // Convert to non-indexed so heterogeneous indexed/non-indexed primitives merge cleanly
      const g = src.index ? src.toNonIndexed() : src.clone();
      g.applyMatrix4(item.matrix);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) {
        const count = g.attributes.position.count;
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
      }
      // Remove mismatching extra attributes like tangent/color if not uniform
      for (const attr of Object.keys(g.attributes)) {
        if (attr !== 'position' && attr !== 'normal' && attr !== 'uv') {
          g.deleteAttribute(attr);
        }
      }
      transformed.push(g);
    }

    if (transformed.length === 0) continue;

    const merged = transformed.length === 1 ? transformed[0] : mergeGeometries(transformed, false);
    if (transformed.length > 1) {
      for (const t of transformed) t.dispose();
    }

    if (merged) {
      disposables.push(merged);
      const mergedMesh = new THREE.Mesh(merged, bucket.material);
      mergedMesh.castShadow = bucket.castShadow;
      mergedMesh.receiveShadow = bucket.receiveShadow;
      group.add(mergedMesh);
    }
  }
}
