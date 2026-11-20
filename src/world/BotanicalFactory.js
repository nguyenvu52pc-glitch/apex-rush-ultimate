import * as THREE from 'three';
import { createPRNG } from '../config/constants.js';

/**
 * Procedural Botanical Factory enforcing Rule #8 ("Every Leaf & Tree"):
 * - Real branching trunks & limbs via tapered TubeGeometry along CatmullRomCurve3 (NO crude cones/spheres)
 * - 512x512 serrated veined individual leaf cards, pine needle sprays & palm leaflets (alphaTest: 0.45)
 * - Synchronized vertex wind shader via onBeforeCompile + customDepthMaterial (RGBADepthPacking)
 *   so sunlight casts dappled, swaying individual leaf shadows onto asphalt and car hoods.
 */

/**
 * Merge an array of BufferGeometries (matching attributes: position, normal, uv, plus optional color & windFactor).
 */
function mergeGeometries(geos) {
  let totalVerts = 0;
  let totalIndices = 0;
  let hasColor = true;
  let hasWind = true;

  for (const g of geos) {
    totalVerts += g.attributes.position.count;
    totalIndices += g.index ? g.index.count : g.attributes.position.count;
    if (!g.attributes.color) hasColor = false;
    if (!g.attributes.windFactor) hasWind = false;
  }

  const pos = new Float32Array(totalVerts * 3);
  const norm = new Float32Array(totalVerts * 3);
  const uv = new Float32Array(totalVerts * 2);
  const col = hasColor ? new Float32Array(totalVerts * 3) : null;
  const wind = hasWind ? new Float32Array(totalVerts) : null;
  const idx = new Uint32Array(totalIndices);

  let vOff = 0;
  let iOff = 0;

  for (const g of geos) {
    const count = g.attributes.position.count;
    pos.set(g.attributes.position.array, vOff * 3);
    norm.set(g.attributes.normal.array, vOff * 3);
    uv.set(g.attributes.uv.array, vOff * 2);
    if (col) col.set(g.attributes.color.array, vOff * 3);
    if (wind) wind.set(g.attributes.windFactor.array, vOff);

    if (g.index) {
      const srcIdx = g.index.array;
      for (let k = 0; k < srcIdx.length; k++) {
        idx[iOff + k] = srcIdx[k] + vOff;
      }
      iOff += srcIdx.length;
    } else {
      for (let k = 0; k < count; k++) {
        idx[iOff + k] = vOff + k;
      }
      iOff += count;
    }

    vOff += count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (wind) merged.setAttribute('windFactor', new THREE.BufferAttribute(wind, 1));
  merged.setIndex(new THREE.BufferAttribute(idx, 1));
  return merged;
}

function createBarkTextures() {
  const size = 256;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext('2d');

  ctx.fillStyle = '#4a3628';
  ctx.fillRect(0, 0, size, size);
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, size, size);

  const rng = createPRNG(5150);
  for (let i = 0; i < 420; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const w = 2 + rng() * 5;
    const h = 24 + rng() * 75;
    const dark = rng() > 0.45;
    ctx.fillStyle = dark ? '#2d2016' : '#634937';
    ctx.fillRect(x, y, w, h);
    bctx.fillStyle = dark ? '#383838' : '#c8c8c8';
    bctx.fillRect(x, y, w, h);
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 4);
  map.colorSpace = THREE.SRGBColorSpace;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(2, 4);
  bumpMap.colorSpace = THREE.NoColorSpace;

  return { map, bumpMap };
}

/**
 * Draw 512x512 alpha-cutout serrated, veined individual broadleaf clusters.
 */
function createBroadleafCardTexture(palette = 'green') {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const rng = createPRNG(palette === 'autumn' ? 7721 : 3391);
  const colors =
    palette === 'autumn'
      ? ['#d97706', '#ea580c', '#eab308', '#b45309', '#84cc16']
      : ['#3f6212', '#4d7c0f', '#65a30d', '#365314', '#84cc16'];

  // Central woody twig & petioles
  ctx.strokeStyle = '#452e1e';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.96);
  ctx.quadraticCurveTo(size * 0.48, size * 0.52, size * 0.52, size * 0.14);
  ctx.stroke();

  const drawSingleLeaf = (cx, cy, angle, len, wid, fillHex) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // Stem petiole
    ctx.strokeStyle = '#573c28';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 14);
    ctx.lineTo(0, 0);
    ctx.stroke();

    // Serrated leaf silhouette
    ctx.fillStyle = fillHex;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const y = -t * len;
      const envelope = Math.sin(t * Math.PI) * wid * (1 - t * 0.25);
      const serration = i < steps ? (i % 2 === 0 ? 1.12 : 0.88) : 1.0;
      ctx.lineTo(envelope * serration, y);
    }
    ctx.lineTo(0, -len * 1.04);
    for (let i = steps; i >= 1; i--) {
      const t = i / steps;
      const y = -t * len;
      const envelope = Math.sin(t * Math.PI) * wid * (1 - t * 0.25);
      const serration = i < steps ? (i % 2 === 0 ? 1.12 : 0.88) : 1.0;
      ctx.lineTo(-envelope * serration, y);
    }
    ctx.closePath();
    ctx.fill();

    // Leaf edge shadow border for crisp separation
    ctx.strokeStyle = 'rgba(20, 32, 10, 0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Midrib & branching lateral veins
    ctx.strokeStyle = 'rgba(220, 245, 170, 0.42)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.lineTo(0, -len * 0.92);
    ctx.stroke();

    ctx.lineWidth = 1.4;
    for (let v = 0.2; v <= 0.82; v += 0.16) {
      const vy = -v * len;
      const vw = Math.sin(v * Math.PI) * wid * 0.72;
      ctx.beginPath();
      ctx.moveTo(0, vy);
      ctx.lineTo(vw, vy - len * 0.10);
      ctx.moveTo(0, vy);
      ctx.lineTo(-vw, vy - len * 0.10);
      ctx.stroke();
    }

    ctx.restore();
  };

  // Draw 24 distinct individual leaves arranged organically around twig
  for (let i = 0; i < 24; i++) {
    const ring = i / 24;
    const cx = size * (0.20 + rng() * 0.60);
    const cy = size * (0.24 + rng() * 0.64);
    const ang = (rng() - 0.5) * 2.5;
    const len = 78 + rng() * 48;
    const wid = 28 + rng() * 18;
    drawSingleLeaf(cx, cy, ang, len, wid, colors[Math.floor(ring * colors.length) % colors.length]);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Draw 512x512 alpha-cutout pine needle cluster sprays.
 */
function createPineNeedleTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const rng = createPRNG(8842);
  ctx.strokeStyle = '#3f2a1d';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.95);
  ctx.lineTo(size * 0.5, size * 0.16);
  ctx.stroke();

  const greens = ['#1b4332', '#2d6a4f', '#1e4d2b', '#40916c', '#264f33'];
  for (let b = 0; b < 90; b++) {
    const by = size * (0.15 + rng() * 0.75);
    const bx = size * (0.20 + rng() * 0.60);
    ctx.strokeStyle = greens[b % greens.length];
    ctx.lineWidth = 3.2;
    for (let n = 0; n < 7; n++) {
      const a = -Math.PI * 0.85 + (n / 6) * Math.PI * 0.7 - Math.PI * 0.5 + (rng() - 0.5) * 0.3;
      const len = 36 + rng() * 34;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(a) * len, by + Math.sin(a) * len);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Draw 512x512 feather-cut individual palm frond leaflets along a central rachis.
 */
function createPalmFrondTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  // Central rachis stem running bottom -> top
  ctx.strokeStyle = '#657c29';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.98);
  ctx.lineTo(size * 0.5, size * 0.04);
  ctx.stroke();

  const count = 26;
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const y = size * (0.94 - t * 0.88);
    const reach = Math.sin(t * Math.PI * 0.92) * (size * 0.45);
    const shade = i % 2 === 0 ? '#4d7c0f' : '#65a30d';

    for (const s of [-1, 1]) {
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.moveTo(size * 0.5, y);
      ctx.quadraticCurveTo(size * 0.5 + s * reach * 0.55, y - 22, size * 0.5 + s * reach, y + 18);
      ctx.quadraticCurveTo(size * 0.5 + s * reach * 0.55, y - 6, size * 0.5, y + 11);
      ctx.closePath();
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Build a curved, gently arched leaf-card patch with per-vertex windFactor and AO vertex color.
 */
function createCurvedLeafPatch(width, height, windBase, windTip, colorInner, colorOuter) {
  const geo = new THREE.PlaneGeometry(width, height, 2, 2);
  const pos = geo.attributes.position;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const wind = new Float32Array(count);
  const cTmp = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const u = (x / width) + 0.5;
    const v = (y / height) + 0.5;
    // Gentle organic arch
    const zArch = -Math.pow((u - 0.5) * 2, 2) * 0.18 - Math.pow((v - 0.5) * 2, 2) * 0.14;
    pos.setZ(i, zArch);

    const wf = THREE.MathUtils.lerp(windBase, windTip, v);
    wind[i] = wf;

    cTmp.lerpColors(colorInner, colorOuter, v);
    colors[i * 3 + 0] = cTmp.r;
    colors[i * 3 + 1] = cTmp.g;
    colors[i * 3 + 2] = cTmp.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('windFactor', new THREE.BufferAttribute(wind, 1));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Build tapered tube along a 3D CatmullRomCurve3 for organic trunks and branches.
 */
function createTaperedBranch(points, rStart, rEnd, tubularSegs = 10, radialSegs = 7) {
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, tubularSegs, rStart, radialSegs, false);
  const pos = geo.attributes.position;
  const count = pos.count;
  const wind = new Float32Array(count);

  const ringSize = radialSegs + 1;
  const centerTmp = new THREE.Vector3();
  const vTmp = new THREE.Vector3();

  for (let tIdx = 0; tIdx <= tubularSegs; tIdx++) {
    const u = tIdx / tubularSegs;
    curve.getPointAt(u, centerTmp);
    const targetR = THREE.MathUtils.lerp(rStart, rEnd, u);
    const scale = targetR / Math.max(0.001, rStart);

    for (let rIdx = 0; rIdx < ringSize; rIdx++) {
      const idx = tIdx * ringSize + rIdx;
      if (idx >= count) break;
      vTmp.fromBufferAttribute(pos, idx).sub(centerTmp).multiplyScalar(scale).add(centerTmp);
      pos.setXYZ(idx, vTmp.x, vTmp.y, vTmp.z);
      wind[idx] = u * 0.15;
    }
  }

  geo.setAttribute('windFactor', new THREE.BufferAttribute(wind, 1));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Inject synchronized vertex wind shader into BOTH primary foliage material and customDepthMaterial (Rule #8).
 * Guarantees swaying leaves cast exact matching swaying individual-leaf shadows!
 */
export function applyWindShader(material, depthMaterial, uTimeRef, swayStrength = 0.22) {
  const patchMaterial = (mat, cacheKey) => {
    if (!mat) return;
    mat.customProgramCacheKey = () => cacheKey;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTimeRef;
      shader.uniforms.uWindStrength = { value: swayStrength };
      mat.userData.windUniforms = shader.uniforms;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime;
           uniform float uWindStrength;
           attribute float windFactor;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vec3 wSeed = vec3(0.0);
           #ifdef USE_INSTANCING
             wSeed = instanceMatrix[3].xyz;
           #endif
           float wPhase = uTime * 2.0 + wSeed.x * 0.35 + wSeed.z * 0.27 + position.x * 1.2 + position.y * 0.8;
           float wGust = sin(wPhase) * 0.68 + cos(wPhase * 1.7 + 1.1) * 0.32;
           float wFlutter = sin(uTime * 5.4 + position.x * 4.2 + position.z * 3.8 + wSeed.z) * 0.22;
           float wDisp = (wGust + wFlutter) * windFactor * uWindStrength;
           transformed.x += wDisp;
           transformed.z += wDisp * 0.72;
           transformed.y -= abs(wDisp) * 0.16;`
        );
    };
  };

  patchMaterial(material, 'wind_sway_surface_v1');
  if (depthMaterial) {
    patchMaterial(depthMaterial, 'wind_sway_depth_v1');
  }
}

export class BotanicalFactory {
  /**
   * @param {{ value: number }} uTimeRef
   */
  constructor(uTimeRef) {
    this.uTimeRef = uTimeRef;
    this.disposables = [];

    const bark = createBarkTextures();
    this.barkMat = new THREE.MeshStandardMaterial({
      map: bark.map,
      bumpMap: bark.bumpMap,
      bumpScale: 0.04,
      roughness: 0.92,
      metalness: 0.02,
    });
    this.disposables.push(bark.map, bark.bumpMap, this.barkMat);

    this.broadleafGreenTex = createBroadleafCardTexture('green');
    this.broadleafAutumnTex = createBroadleafCardTexture('autumn');
    this.pineTex = createPineNeedleTexture();
    this.palmTex = createPalmFrondTexture();
    this.disposables.push(
      this.broadleafGreenTex,
      this.broadleafAutumnTex,
      this.pineTex,
      this.palmTex
    );
  }

  _makeFoliageMaterialPair(leafTex, windStrength, useVertexColors = true) {
    const mat = new THREE.MeshStandardMaterial({
      map: leafTex,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.72,
      metalness: 0.02,
      vertexColors: useVertexColors,
    });

    const depthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: leafTex,
      alphaTest: 0.45,
    });

    applyWindShader(mat, depthMat, this.uTimeRef, windStrength);
    this.disposables.push(mat, depthMat);
    return { mat, depthMat };
  }

  /**
   * Build Broadleaf Oak/Maple Tree: flared root trunk + 5 branching limbs + 26 intersecting leaf cards.
   */
  createBroadleafArchetype(palette = 'green', windStrength = 0.22) {
    const rng = createPRNG(palette === 'autumn' ? 1042 : 2042);
    const branchGeos = [];

    // Main curved trunk
    branchGeos.push(
      createTaperedBranch(
        [
          new THREE.Vector3(0, -0.35, 0),
          new THREE.Vector3(0.06, 1.4, 0.04),
          new THREE.Vector3(-0.04, 3.1, -0.05),
          new THREE.Vector3(0.03, 4.4, 0.02),
        ],
        0.34,
        0.13,
        10,
        8
      )
    );

    // 5 Spreading primary limbs
    const limbTips = [];
    for (let b = 0; b < 5; b++) {
      const ang = (b / 5) * Math.PI * 2 + rng() * 0.4;
      const startY = 2.4 + rng() * 1.1;
      const reach = 1.6 + rng() * 1.1;
      const tipY = startY + 1.5 + rng() * 1.3;
      const tip = new THREE.Vector3(Math.cos(ang) * reach, tipY, Math.sin(ang) * reach);
      limbTips.push(tip);

      branchGeos.push(
        createTaperedBranch(
          [
            new THREE.Vector3(0, startY, 0),
            new THREE.Vector3(tip.x * 0.45, startY + 0.65, tip.z * 0.45),
            tip,
          ],
          0.13,
          0.038,
          7,
          6
        )
      );
    }

    const trunkGeo = mergeGeometries(branchGeos);
    this.disposables.push(trunkGeo);

    // 26 Intersecting curved alpha-cutout leaf cards around limb tips & crown
    const leafGeos = [];
    const cInner = new THREE.Color(palette === 'autumn' ? 0x6b3a18 : 0x264415);
    const cOuter = new THREE.Color(palette === 'autumn' ? 0xffb347 : 0xd9f99d);

    for (let i = 0; i < 26; i++) {
      const anchor = limbTips[i % limbTips.length];
      const patch = createCurvedLeafPatch(
        1.8 + rng() * 0.9,
        1.8 + rng() * 0.9,
        0.35,
        1.0,
        cInner,
        cOuter
      );
      patch.rotateX((rng() - 0.5) * 1.3);
      patch.rotateY(rng() * Math.PI * 2);
      patch.rotateZ((rng() - 0.5) * 0.8);
      patch.translate(
        anchor.x * (0.6 + rng() * 0.55) + (rng() - 0.5) * 1.0,
        anchor.y + (rng() - 0.35) * 1.3,
        anchor.z * (0.6 + rng() * 0.55) + (rng() - 0.5) * 1.0
      );
      leafGeos.push(patch);
    }

    const canopyGeo = mergeGeometries(leafGeos);
    this.disposables.push(canopyGeo);

    const tex = palette === 'autumn' ? this.broadleafAutumnTex : this.broadleafGreenTex;
    const { mat: foliageMat, depthMat: foliageDepthMat } = this._makeFoliageMaterialPair(
      tex,
      windStrength,
      true
    );

    return {
      trunkGeo,
      trunkMat: this.barkMat,
      foliageGeo: canopyGeo,
      foliageMat,
      foliageDepthMat,
    };
  }

  /**
   * Build Pine Tree: tall bark trunk + tiered radiating boughs + alpha-cutout needle clusters.
   */
  createPineArchetype(windStrength = 0.20) {
    const rng = createPRNG(6044);
    const branchGeos = [];
    const leafGeos = [];
    const cInner = new THREE.Color(0x1e3828);
    const cOuter = new THREE.Color(0x98c9a3);

    // Tall central trunk
    branchGeos.push(
      createTaperedBranch(
        [
          new THREE.Vector3(0, -0.35, 0),
          new THREE.Vector3(0.03, 3.2, -0.02),
          new THREE.Vector3(-0.02, 6.8, 0.02),
          new THREE.Vector3(0, 9.2, 0),
        ],
        0.26,
        0.04,
        10,
        7
      )
    );

    // 5 Tiers of radiating branches with needle cards
    const tiers = 5;
    for (let t = 0; t < tiers; t++) {
      const frac = t / (tiers - 1);
      const y = 2.4 + frac * 5.6;
      const boughLen = THREE.MathUtils.lerp(2.4, 0.75, frac);
      const boughsInTier = t < 3 ? 5 : 4;

      for (let b = 0; b < boughsInTier; b++) {
        const ang = (b / boughsInTier) * Math.PI * 2 + t * 0.7 + rng() * 0.25;
        const tip = new THREE.Vector3(Math.cos(ang) * boughLen, y - 0.35, Math.sin(ang) * boughLen);

        branchGeos.push(
          createTaperedBranch(
            [
              new THREE.Vector3(0, y, 0),
              new THREE.Vector3(tip.x * 0.55, y - 0.1, tip.z * 0.55),
              tip,
            ],
            0.075 * (1 - frac * 0.5),
            0.02,
            5,
            5
          )
        );

        // 2 crossing needle sprays per bough
        for (let k = 0; k < 2; k++) {
          const patch = createCurvedLeafPatch(
            boughLen * 1.05 + 0.5,
            boughLen * 0.9 + 0.5,
            0.3,
            1.0,
            cInner,
            cOuter
          );
          patch.rotateX(-Math.PI * 0.34 + (k === 1 ? 0.35 : -0.25));
          patch.rotateY(ang + (k - 0.5) * 0.6);
          patch.translate(tip.x * 0.65, y - 0.05, tip.z * 0.65);
          leafGeos.push(patch);
        }
      }
    }

    // Crown top needle tuft
    const topPatch = createCurvedLeafPatch(1.3, 1.6, 0.5, 1.0, cInner, cOuter);
    topPatch.translate(0, 9.0, 0);
    leafGeos.push(topPatch);

    const trunkGeo = mergeGeometries(branchGeos);
    const foliageGeo = mergeGeometries(leafGeos);
    this.disposables.push(trunkGeo, foliageGeo);

    const { mat: foliageMat, depthMat: foliageDepthMat } = this._makeFoliageMaterialPair(
      this.pineTex,
      windStrength,
      true
    );

    return {
      trunkGeo,
      trunkMat: this.barkMat,
      foliageGeo,
      foliageMat,
      foliageDepthMat,
    };
  }

  /**
   * Build Desert Palm Tree: curved trunk + 9 arched feather-cut palm fronds.
   */
  createPalmArchetype(windStrength = 0.28) {
    const rng = createPRNG(9912);
    const trunkGeo = createTaperedBranch(
      [
        new THREE.Vector3(0, -0.4, 0),
        new THREE.Vector3(0.45, 2.5, 0.2),
        new THREE.Vector3(0.85, 5.4, 0.1),
        new THREE.Vector3(0.75, 7.6, -0.1),
      ],
      0.24,
      0.11,
      12,
      7
    );
    this.disposables.push(trunkGeo);

    const leafGeos = [];
    const cInner = new THREE.Color(0x3f6212);
    const cOuter = new THREE.Color(0xbef264);

    for (let f = 0; f < 9; f++) {
      const ang = (f / 9) * Math.PI * 2 + rng() * 0.2;
      const frondLen = 3.2 + rng() * 0.6;
      const frondW = 1.45;
      const geo = new THREE.PlaneGeometry(frondW, frondLen, 2, 6);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const wind = new Float32Array(pos.count);
      const cTmp = new THREE.Color();

      for (let i = 0; i < pos.count; i++) {
        const yRaw = pos.getY(i) + frondLen * 0.5; // [0 .. frondLen] from crown outward
        const t = yRaw / frondLen;
        const droop = Math.sin(t * Math.PI * 0.85) * 0.8 - t * t * 1.55;
        pos.setY(i, droop);
        pos.setZ(i, yRaw); // Extend outward along local +Z
        wind[i] = t * t;
        cTmp.lerpColors(cInner, cOuter, t);
        colors[i * 3 + 0] = cTmp.r;
        colors[i * 3 + 1] = cTmp.g;
        colors[i * 3 + 2] = cTmp.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('windFactor', new THREE.BufferAttribute(wind, 1));
      geo.computeVertexNormals();
      geo.rotateY(ang);
      geo.rotateX((rng() - 0.5) * 0.22);
      geo.translate(0.75, 7.55, -0.1);
      leafGeos.push(geo);
    }

    const foliageGeo = mergeGeometries(leafGeos);
    this.disposables.push(foliageGeo);

    const { mat: foliageMat, depthMat: foliageDepthMat } = this._makeFoliageMaterialPair(
      this.palmTex,
      windStrength,
      true
    );

    return {
      trunkGeo,
      trunkMat: this.barkMat,
      foliageGeo,
      foliageMat,
      foliageDepthMat,
    };
  }

  /**
   * Build Branched Saguaro Cactus for Canyon Daylight theme.
   */
  createCactusArchetype() {
    const geos = [];
    geos.push(
      createTaperedBranch(
        [
          new THREE.Vector3(0, -0.35, 0),
          new THREE.Vector3(0, 2.2, 0),
          new THREE.Vector3(0, 4.4, 0),
        ],
        0.28,
        0.22,
        8,
        8
      )
    );
    geos.push(
      createTaperedBranch(
        [
          new THREE.Vector3(0.20, 1.8, 0),
          new THREE.Vector3(0.85, 1.9, 0.05),
          new THREE.Vector3(0.95, 3.1, 0.05),
        ],
        0.18,
        0.15,
        7,
        7
      )
    );
    geos.push(
      createTaperedBranch(
        [
          new THREE.Vector3(-0.20, 2.3, 0),
          new THREE.Vector3(-0.78, 2.4, -0.05),
          new THREE.Vector3(-0.85, 3.5, -0.05),
        ],
        0.16,
        0.14,
        7,
        7
      )
    );
    const geo = mergeGeometries(geos);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3b6e35,
      roughness: 0.78,
      metalness: 0.02,
    });
    this.disposables.push(geo, mat);
    return { geo, mat };
  }

  /**
   * Build Roadside Tapered 3D Grass Blade + Wildflower Cluster (Instanced + Wind Sway).
   */
  createGrassClusterArchetype(themeMode = 'alpine', windStrength = 0.25) {
    const rng = createPRNG(4401);
    const bladeGeos = [];
    const baseCol =
      themeMode === 'desert' ? new THREE.Color(0x6b5c34) : new THREE.Color(0x284b1a);
    const tipCol =
      themeMode === 'desert' ? new THREE.Color(0xb89a56) : new THREE.Color(0x7cc43f);
    const flowerCols = [
      new THREE.Color(0xfbbf24),
      new THREE.Color(0xf87171),
      new THREE.Color(0xf8fafc),
    ];

    const bladeCount = 9;
    for (let b = 0; b < bladeCount; b++) {
      const ang = (b / bladeCount) * Math.PI * 2 + rng() * 0.4;
      const dist = 0.05 + rng() * 0.25;
      const h = 0.42 + rng() * 0.36;
      const w = 0.075;
      const bend = 0.14 + rng() * 0.18;

      const geo = new THREE.BufferGeometry();
      const positions = new Float32Array([
        -w, 0, 0,
        w, 0, 0,
        -w * 0.55, h * 0.55, bend * 0.35,
        w * 0.55, h * 0.55, bend * 0.35,
        0, h, bend,
      ]);
      const normals = new Float32Array([
        0, 0.2, 1, 0, 0.2, 1, 0, 0.3, 1, 0, 0.3, 1, 0, 0.5, 1,
      ]);
      const uvs = new Float32Array([0, 0, 1, 0, 0, 0.5, 1, 0.5, 0.5, 1]);
      const wind = new Float32Array([0, 0, 0.45, 0.45, 1.0]);

      const isFlower = themeMode === 'alpine' && b % 4 === 0;
      const cTip = isFlower ? flowerCols[b % flowerCols.length] : tipCol;
      const colors = new Float32Array([
        baseCol.r, baseCol.g, baseCol.b,
        baseCol.r, baseCol.g, baseCol.b,
        tipCol.r, tipCol.g, tipCol.b,
        tipCol.r, tipCol.g, tipCol.b,
        cTip.r, cTip.g, cTip.b,
      ]);

      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('windFactor', new THREE.BufferAttribute(wind, 1));
      geo.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);

      geo.rotateY(ang);
      geo.translate(Math.cos(ang) * dist, -0.04, Math.sin(ang) * dist);
      bladeGeos.push(geo);
    }

    const geo = mergeGeometries(bladeGeos);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    applyWindShader(mat, null, this.uTimeRef, windStrength * 0.9);
    this.disposables.push(geo, mat);

    return { geo, mat };
  }

  dispose() {
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables.length = 0;
  }
}
