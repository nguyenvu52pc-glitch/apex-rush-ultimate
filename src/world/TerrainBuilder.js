import * as THREE from 'three';
import { createPRNG } from '../config/constants.js';

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function createPermutationTable(seed) {
  const rng = createPRNG(seed);
  const p = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = base[i];
    base[i] = base[j];
    base[j] = tmp;
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
}

function valueNoise2D(x, z, perm) {
  const xi = Math.floor(x) & 255;
  const zi = Math.floor(z) & 255;
  const xf = x - Math.floor(x);
  const zf = z - Math.floor(z);
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);

  const aa = perm[perm[xi] + zi] / 255;
  const ab = perm[perm[xi] + zi + 1] / 255;
  const ba = perm[perm[xi + 1] + zi] / 255;
  const bb = perm[perm[xi + 1] + zi + 1] / 255;

  const x1 = aa + u * (ba - aa);
  const x2 = ab + u * (bb - ab);
  return (x1 + v * (x2 - x1)) * 2 - 1;
}

function fbm2D(x, z, perm, octaves = 4) {
  let sum = 0;
  let amp = 0.55;
  let freq = 1.0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2D(x * freq, z * freq, perm);
    freq *= 2.04;
    amp *= 0.48;
  }
  return sum;
}

function createTerrainDetailTexture(themeMode) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext('2d');

  const rng = createPRNG(themeMode === 'desert' ? 911 : 404);

  ctx.fillStyle = '#cfcfcf';
  ctx.fillRect(0, 0, size, size);
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, size, size);

  // Multi-scale soil/strata streaks and natural micro-grain instead of blocky uniform noise
  for (let i = 0; i < 3200; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const w = 6 + rng() * 24;
    const h = 2 + rng() * 6;
    const v = 165 + Math.floor(rng() * 72);
    ctx.fillStyle = `rgba(${v}, ${v}, ${v}, 0.22)`;
    ctx.fillRect(x, y, w, h);

    const bv = 80 + Math.floor(rng() * 110);
    bctx.fillStyle = `rgba(${bv}, ${bv}, ${bv}, 0.30)`;
    bctx.fillRect(x, y, w, h);
  }
  for (let i = 0; i < 16000; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 1 + rng() * 2.5;
    const v = 155 + Math.floor(rng() * 90);
    ctx.fillStyle = `rgba(${v}, ${v}, ${v}, 0.35)`;
    ctx.fillRect(x, y, r, r);

    const bv = 60 + Math.floor(rng() * 145);
    bctx.fillStyle = `rgba(${bv}, ${bv}, ${bv}, 0.45)`;
    bctx.fillRect(x, y, r, r);
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(56, 56);
  map.colorSpace = THREE.SRGBColorSpace;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(56, 56);
  bumpMap.colorSpace = THREE.NoColorSpace;

  return { map, bumpMap };
}

/**
 * Generates a high-resolution (~220x220) terrain mesh sculpted by seeded fBm noise,
 * smoothly flattened beneath the track corridor via O(1) TrackData.project() (Rule #8),
 * with slope-and-altitude vertex coloring and O(1) getHeightAt(x, z) query.
 */
export class TerrainBuilder {
  /**
   * @param {import('../track/TrackData.js').TrackData} trackData
   * @param {object} themeSpec Entry from ThemeCatalog
   */
  constructor(trackData, themeSpec) {
    this.trackData = trackData;
    this.theme = themeSpec;
    this.disposables = [];

    // Compute world bounds around the track + scenic mountain/desert margin
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of trackData.samples) {
      if (s.position.x < minX) minX = s.position.x;
      if (s.position.x > maxX) maxX = s.position.x;
      if (s.position.z < minZ) minZ = s.position.z;
      if (s.position.z > maxZ) maxZ = s.position.z;
    }

    this.centerX = (minX + maxX) * 0.5;
    this.centerZ = (minZ + maxZ) * 0.5;
    const trackSpan = Math.max(maxX - minX, maxZ - minZ);
    this.size = Math.ceil((trackSpan + 540) / 20) * 20;
    this.halfSize = this.size * 0.5;
    this.segments = 220;
    this.stride = this.segments + 1;
    this.heights = new Float32Array(this.stride * this.stride);

    this.mesh = this._buildMesh();
  }

  _buildMesh() {
    const segs = this.segments;
    const stride = this.stride;
    const perm = createPermutationTable(this.trackData.id.startsWith('mountain_pass') ? 2025 : 8080);

    const geo = new THREE.PlaneGeometry(this.size, this.size, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const projOut = this.trackData.project({ x: 0, y: 0, z: 0 });
    const innerSafe = this.trackData.trackHalfWidth + this.trackData.shoulderWidth + 1.0;
    const blendSpan = 30.0;

    const { hillScale, mountainHeight, lowColor, midColor, rockColor } = this.theme.terrain;
    const cLow = new THREE.Color(lowColor);
    const cMid = new THREE.Color(midColor);
    const cRock = new THREE.Color(rockColor);
    const cTmp = new THREE.Color();

    const maxTrackHalfSpan = this.halfSize * 0.62;

    for (let iz = 0; iz <= segs; iz++) {
      for (let ix = 0; ix <= segs; ix++) {
        const idx = iz * stride + ix;
        const wx = pos.getX(idx) + this.centerX;
        const wz = pos.getZ(idx) + this.centerZ;
        pos.setX(idx, wx);
        pos.setZ(idx, wz);

        this.trackData.project({ x: wx, y: 0, z: wz }, projOut);

        // Banked road surface Y at the clamped lateral offset (carve dramatic deep canyon/water chasm under V2 jump gaps!)
        const clampedLat = THREE.MathUtils.clamp(
          projOut.lateralOffset,
          -(this.trackData.totalWidthHalf + 1.5),
          this.trackData.totalWidthHalf + 1.5
        );
        let roadY = projOut.frame.position.y + projOut.frame.right.y * clampedLat - 0.44;
        if (projOut.isGapSegment) {
          const canyonMask = 1 - smoothstep(0, this.trackData.totalWidthHalf + 26, Math.abs(projOut.lateralOffset));
          roadY -= 16.5 * canyonMask;
        }

        // Seeded fBm natural elevation
        const n1 = fbm2D(wx * 0.0045, wz * 0.0045, perm, 4);
        const n2 = fbm2D(wx * 0.015 + 17.3, wz * 0.015 - 9.1, perm, 2);

        let hNatural = n1 * hillScale + n2 * (hillScale * 0.28);
        if (this.theme.id === 'canyon_daylight') {
          // Terraced red-rock mesa steps
          const stepH = 6.0;
          hNatural = Math.floor(hNatural / stepH) * stepH + smoothstep(0.15, 0.85, (hNatural % stepH + stepH) % stepH / stepH) * stepH * 0.6;
        }

        // Distant perimeter mountain ring for atmospheric spatial depth
        const radial = Math.hypot(wx - this.centerX, wz - this.centerZ);
        const rimT = smoothstep(maxTrackHalfSpan, this.halfSize * 0.96, radial);
        const ridgeNoise = Math.abs(fbm2D(wx * 0.006 + 4.1, wz * 0.006 + 8.7, perm, 3));
        hNatural += rimT * (mountainHeight * (0.45 + 0.85 * ridgeNoise));

        // Ensure natural height near track edge transitions smoothly from roadY
        const distFromEdge = Math.max(0, Math.abs(projOut.lateralOffset) - innerSafe);
        const blend = smoothstep(0, blendSpan, distFromEdge);
        const minNatural = projOut.isGapSegment ? -24 : -10;
        const yFinal = THREE.MathUtils.lerp(roadY, Math.max(minNatural, roadY * 0.35 + hNatural), blend);

        pos.setY(idx, yFinal);
        this.heights[idx] = yFinal;
      }
    }

    geo.computeVertexNormals();
    const normals = geo.attributes.normal;

    // Slope & altitude vertex coloring
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const ny = normals.getY(i);
      const slope = 1 - Math.max(0, Math.min(1, ny));

      const altT = smoothstep(-2, 32, y);
      cTmp.lerpColors(cLow, cMid, altT);

      const rockBlend = Math.min(1, smoothstep(0.14, 0.38, slope) + smoothstep(38, 85, y) * 0.8);
      cTmp.lerp(cRock, rockBlend);

      // Snow caps on very high alpine peaks
      if (this.theme.id === 'alpine_sunset' && y > 68) {
        cTmp.lerp(new THREE.Color(0xe2e8f0), smoothstep(68, 95, y));
      }

      colors[i * 3 + 0] = cTmp.r;
      colors[i * 3 + 1] = cTmp.g;
      colors[i * 3 + 2] = cTmp.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const { map: detailMap, bumpMap: detailBump } = createTerrainDetailTexture(this.theme.flora.mode);
    const mat = new THREE.MeshStandardMaterial({
      map: detailMap,
      bumpMap: detailBump,
      bumpScale: 0.24,
      vertexColors: true,
      roughness: 0.90,
      metalness: 0.02,
    });
    this.disposables.push(geo, detailMap, detailBump, mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain_mesh';
    return mesh;
  }

  /**
   * Fast O(1) bilinear terrain height lookup at any world (x, z).
   */
  getHeightAt(x, z) {
    const u = (x - (this.centerX - this.halfSize)) / this.size;
    const v = (z - (this.centerZ - this.halfSize)) / this.size;
    if (u <= 0 || u >= 1 || v <= 0 || v >= 1) return -4;

    const fx = u * this.segments;
    const fz = v * this.segments;
    const ix = Math.min(this.segments - 1, Math.floor(fx));
    const iz = Math.min(this.segments - 1, Math.floor(fz));
    const tx = fx - ix;
    const tz = fz - iz;

    const s = this.stride;
    const h00 = this.heights[iz * s + ix];
    const h10 = this.heights[iz * s + (ix + 1)];
    const h01 = this.heights[(iz + 1) * s + ix];
    const h11 = this.heights[(iz + 1) * s + (ix + 1)];

    const hx0 = h00 + (h10 - h00) * tx;
    const hx1 = h01 + (h11 - h01) * tx;
    return hx0 + (hx1 - hx0) * tz;
  }

  dispose() {
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables.length = 0;
  }
}
