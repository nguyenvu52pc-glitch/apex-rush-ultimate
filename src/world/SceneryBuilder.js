import * as THREE from 'three';
import { createPRNG } from '../config/constants.js';
import { BotanicalFactory } from './BotanicalFactory.js';

function createChevronTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#facc15';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 22;
  ctx.lineCap = 'square';
  ctx.beginPath();
  ctx.moveTo(42, 20);
  ctx.lineTo(88, 64);
  ctx.lineTo(42, 108);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSponsorTexture(title, bgHex, accentHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 0, 28, 128);
  ctx.fillRect(484, 0, 28, 128);
  ctx.fillStyle = '#f8fafc';
  ctx.font = '900 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 256, 66);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createBuildingWindowTexture(isNeonNight) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = isNeonNight ? '#0a0f1c' : '#1e293b';
  ctx.fillRect(0, 0, 256, 512);

  const rng = createPRNG(6022);
  const cols = 8;
  const rows = 20;
  const cw = 256 / cols;
  const rh = 512 / rows;

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const lit = rng() > (isNeonNight ? 0.36 : 0.65);
      if (!lit) {
        ctx.fillStyle = '#141b2b';
      } else {
        const pick = rng();
        ctx.fillStyle = pick > 0.72 ? '#38bdf8' : pick > 0.45 ? '#fde047' : '#f8fafc';
      }
      ctx.fillRect(c * cw + 5, r * rh + 4, cw - 10, rh - 8);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Builds the procedural FBM sky dome + atmospheric clouds, water ripple plane, instanced branching trees + leaf cards,
 * instanced wind-swaying grass, boulders, chevron turn signs, grandstands, billboards,
 * streetlights, urban buildings, and water plane — strictly enforcing Track Exclusion (Rule #8).
 */
export class SceneryBuilder {
  /**
   * @param {import('../track/TrackData.js').TrackData} trackData
   * @param {import('./TerrainBuilder.js').TerrainBuilder} terrain
   * @param {object} themeSpec
   * @param {{ grassDensityScale?: number }} [options]
   */
  constructor(trackData, terrain, themeSpec, options = {}) {
    this.trackData = trackData;
    this.terrain = terrain;
    this.theme = themeSpec;
    this.grassDensityScale = options.grassDensityScale ?? 1.0;
    this.foliageShadows = options.foliageShadows ?? true;

    this.uTime = { value: 0 };
    this.root = new THREE.Group();
    this.root.name = `scenery_${themeSpec.id}`;
    this.disposables = [];

    this.botanical = new BotanicalFactory(this.uTime);
    this.cloudGroup = new THREE.Group();
    this.skyMesh = null;

    this._buildSkyDome();
    this._buildClouds();
    this._buildWaterPlane();
    this._buildFoliageAndRocks();
    this._buildRoadsideLandmarks();
  }

  _buildSkyDome() {
    const s = this.theme.sky;
    const l = this.theme.lighting;
    const skyGeo = new THREE.SphereGeometry(840, 36, 24);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(s.zenithColor) },
        uHorizon: { value: new THREE.Color(s.horizonColor) },
        uSunColor: { value: new THREE.Color(s.sunColor) },
        uSunGlow: { value: new THREE.Color(s.sunGlowColor) },
        uCloudColor: { value: new THREE.Color(s.cloudColor) },
        uCloudOpacity: { value: s.cloudOpacity },
        uSunDir: { value: new THREE.Vector3(l.sunDirection[0], l.sunDirection[1], l.sunDirection[2]).normalize() },
        uStarIntensity: { value: s.starIntensity },
        uTime: this.uTime,
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uSunColor;
        uniform vec3 uSunGlow;
        uniform vec3 uCloudColor;
        uniform float uCloudOpacity;
        uniform vec3 uSunDir;
        uniform float uStarIntensity;
        uniform float uTime;
        varying vec3 vDir;

        float hash2(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise2(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash2(i);
          float b = hash2(i + vec2(1.0, 0.0));
          float c = hash2(i + vec2(0.0, 1.0));
          float d = hash2(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbmCloud(vec2 p) {
          float v = 0.0;
          float a = 0.52;
          mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
          for (int i = 0; i < 4; i++) {
            v += a * noise2(p);
            p = rot * p * 2.06 + vec2(13.1, 7.7);
            a *= 0.48;
          }
          return v;
        }

        float hash3(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        void main() {
          vec3 d = normalize(vDir + vec3(1e-5, 0.0, 0.0));
          float h = clamp(d.y, 0.0, 1.0);
          vec3 sunDir = normalize(uSunDir);

          // Rayleigh vertical atmospheric gradient (strictly guarded against pow(0,x) NaNs)
          vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0001), 0.50));

          // Mie forward atmospheric scatter & crisp solar disc
          float sunDot = max(dot(d, sunDir), 0.0001);
          col += uSunGlow * pow(sunDot, 6.0) * 0.46;
          col += uSunGlow * pow(sunDot, 36.0) * 0.55;
          col += uSunColor * smoothstep(0.9935, 0.9988, sunDot) * 2.0;

          // Atmospheric drifting volumetric-style clouds above horizon
          if (d.y > 0.025 && uCloudOpacity > 0.01) {
            vec2 skyUv = (d.xz / max(d.y + 0.14, 0.08)) * 1.45 + vec2(uTime * 0.0055, uTime * 0.0022);
            float n = fbmCloud(skyUv);
            float cloudDensity = smoothstep(0.47, 0.82, n) * smoothstep(0.025, 0.22, d.y) * smoothstep(0.95, 0.35, d.y);
            vec3 litCloud = mix(uCloudColor * 0.78, uSunColor * 1.15 + uCloudColor * 0.45, pow(sunDot, 3.0) * 0.75 + 0.2);
            col = mix(col, litCloud, cloudDensity * uCloudOpacity * 0.85);
          }

          if (uStarIntensity > 0.01 && d.y > 0.06) {
            vec3 grid = floor(d * 220.0);
            float n = hash3(grid);
            if (n > 0.992) {
              float twinkle = 0.6 + 0.4 * sin(uTime * 2.2 + n * 100.0);
              col += vec3(0.85, 0.92, 1.0) * twinkle * uStarIntensity * smoothstep(0.06, 0.38, d.y);
            }
          }

          gl_FragColor = vec4(clamp(col, vec3(0.0), vec3(8.0)), 1.0);
        }
      `,
    });

    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.skyMesh.position.set(this.terrain.centerX, 0, this.terrain.centerZ);
    this.disposables.push(skyGeo, skyMat);
    this.root.add(this.skyMesh);
  }

  _buildClouds() {
    // High-altitude atmospheric clouds are rendered seamlessly inside SkyDome FBM shader
    // to eliminate flat billboard seams; cloudGroup remains clean for subtle high vapor wisps if needed.
    this.root.add(this.cloudGroup);
  }

  _buildWaterPlane() {
    if (this.theme.terrain.waterLevel === null) return;
    const geo = new THREE.PlaneGeometry(this.terrain.size, this.terrain.size);
    geo.rotateX(-Math.PI / 2);

    // Subtle procedural water ripple normal/bump texture
    const wSize = 128;
    const wCanvas = document.createElement('canvas');
    wCanvas.width = wSize;
    wCanvas.height = wSize;
    const wCtx = wCanvas.getContext('2d');
    wCtx.fillStyle = '#808080';
    wCtx.fillRect(0, 0, wSize, wSize);
    const rng = createPRNG(3344);
    for (let i = 0; i < 650; i++) {
      const y = rng() * wSize;
      const x = rng() * wSize;
      const len = 8 + rng() * 24;
      const b = 95 + Math.floor(rng() * 75);
      wCtx.fillStyle = `rgb(${b},${b},${b})`;
      wCtx.fillRect(x, y, len, 2);
    }
    const rippleBump = new THREE.CanvasTexture(wCanvas);
    rippleBump.wrapS = THREE.RepeatWrapping;
    rippleBump.wrapT = THREE.RepeatWrapping;
    rippleBump.repeat.set(60, 60);
    rippleBump.colorSpace = THREE.NoColorSpace;

    const mat = new THREE.MeshStandardMaterial({
      color: this.theme.terrain.waterColor,
      bumpMap: rippleBump,
      bumpScale: 0.08,
      roughness: 0.08,
      metalness: 0.88,
      envMapIntensity: 1.75,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.terrain.centerX, this.theme.terrain.waterLevel, this.terrain.centerZ);
    mesh.receiveShadow = true;
    this.disposables.push(geo, rippleBump, mat);
    this.root.add(mesh);
  }

  _buildFoliageAndRocks() {
    const rng = createPRNG(this.trackData.id === 'mountain_pass' ? 7101 : 9202);
    const projOut = this.trackData.project({ x: 0, y: 0, z: 0 });
    const exclusionRadius = this.trackData.trackHalfWidth + this.trackData.shoulderWidth + 6.0;
    const windStr = this.theme.flora.windStrength;

    // 1. Place Instanced Trees & Cacti strictly outside exclusionRadius
    const mode = this.theme.flora.mode;
    const archetypes = [];
    if (mode === 'alpine') {
      archetypes.push({ type: 'tree', weight: 0.52, arch: this.botanical.createPineArchetype(windStr) });
      archetypes.push({ type: 'tree', weight: 0.28, arch: this.botanical.createBroadleafArchetype('green', windStr) });
      archetypes.push({ type: 'tree', weight: 0.20, arch: this.botanical.createBroadleafArchetype('autumn', windStr) });
    } else if (mode === 'desert') {
      archetypes.push({ type: 'tree', weight: 0.48, arch: this.botanical.createPalmArchetype(windStr) });
      archetypes.push({ type: 'cactus', weight: 0.52, arch: this.botanical.createCactusArchetype() });
    } else {
      archetypes.push({ type: 'tree', weight: 1.0, arch: this.botanical.createBroadleafArchetype('green', windStr) });
    }

    const buckets = archetypes.map(() => []);
    const targetTrees = this.theme.flora.treeCount;
    const span = this.terrain.halfSize * 0.78;
    const dummy = new THREE.Object3D();

    let attempts = 0;
    let placed = 0;
    while (placed < targetTrees && attempts < targetTrees * 8) {
      attempts += 1;
      // Bias ~60% near roadside belt (8..85m from track) and ~40% across hills
      let x;
      let z;
      if (rng() < 0.62) {
        const s = this.trackData.samples[Math.floor(rng() * this.trackData.samples.length)];
        const side = rng() < 0.5 ? -1 : 1;
        const offset = exclusionRadius + 2.0 + rng() * 75;
        x = s.position.x + s.right.x * side * offset + (rng() - 0.5) * 14;
        z = s.position.z + s.right.z * side * offset + (rng() - 0.5) * 14;
      } else {
        x = this.terrain.centerX + (rng() * 2 - 1) * span;
        z = this.terrain.centerZ + (rng() * 2 - 1) * span;
      }

      this.trackData.project({ x, z }, projOut);
      if (projOut.distance < exclusionRadius) continue;

      const y = this.terrain.getHeightAt(x, z);
      if (this.theme.terrain.waterLevel !== null && y < this.theme.terrain.waterLevel + 0.8) continue;

      // Pick archetype by cumulative weight
      const roll = rng();
      let acc = 0;
      let chosen = 0;
      for (let a = 0; a < archetypes.length; a++) {
        acc += archetypes[a].weight;
        if (roll <= acc) {
          chosen = a;
          break;
        }
      }

      const scale = 0.78 + rng() * 0.55;
      buckets[chosen].push({ x, y: y - 0.08, z, rotY: rng() * Math.PI * 2, scale });
      placed += 1;
    }

    for (let a = 0; a < archetypes.length; a++) {
      const list = buckets[a];
      if (list.length === 0) continue;
      const item = archetypes[a];

      if (item.type === 'tree') {
        const trunkInst = new THREE.InstancedMesh(item.arch.trunkGeo, item.arch.trunkMat, list.length);
        trunkInst.castShadow = this.foliageShadows;
        trunkInst.receiveShadow = true;

        const foliageInst = new THREE.InstancedMesh(item.arch.foliageGeo, item.arch.foliageMat, list.length);
        foliageInst.castShadow = this.foliageShadows;
        foliageInst.receiveShadow = true;
        // Rule #8: synchronized customDepthMaterial for crisp swaying individual leaf shadows!
        foliageInst.customDepthMaterial = item.arch.foliageDepthMat;

        for (let i = 0; i < list.length; i++) {
          const t = list[i];
          dummy.position.set(t.x, t.y, t.z);
          dummy.rotation.set(0, t.rotY, 0);
          dummy.scale.setScalar(t.scale);
          dummy.updateMatrix();
          trunkInst.setMatrixAt(i, dummy.matrix);
          foliageInst.setMatrixAt(i, dummy.matrix);
        }
        trunkInst.instanceMatrix.needsUpdate = true;
        foliageInst.instanceMatrix.needsUpdate = true;
        this.root.add(trunkInst, foliageInst);
      } else {
        const cactusInst = new THREE.InstancedMesh(item.arch.geo, item.arch.mat, list.length);
        cactusInst.castShadow = true;
        cactusInst.receiveShadow = true;
        for (let i = 0; i < list.length; i++) {
          const t = list[i];
          dummy.position.set(t.x, t.y, t.z);
          dummy.rotation.set(0, t.rotY, 0);
          dummy.scale.setScalar(t.scale);
          dummy.updateMatrix();
          cactusInst.setMatrixAt(i, dummy.matrix);
        }
        cactusInst.instanceMatrix.needsUpdate = true;
        this.root.add(cactusInst);
      }
    }

    // 2. Instanced Roadside Grass & Wildflower Clusters (strictly outside shoulder barrier)
    const grassArch = this.botanical.createGrassClusterArchetype(mode, windStr);
    const grassTarget = Math.floor(this.theme.flora.grassCount * this.grassDensityScale);
    const grassPlacements = [];
    const grassMinDist = this.trackData.totalWidthHalf + 1.8;

    for (let i = 0; i < grassTarget * 2 && grassPlacements.length < grassTarget; i++) {
      const s = this.trackData.samples[Math.floor(rng() * this.trackData.samples.length)];
      const side = rng() < 0.5 ? -1 : 1;
      const latDist = grassMinDist + rng() * 14.0;
      const x = s.position.x + s.right.x * side * latDist + (rng() - 0.5) * 3.0;
      const z = s.position.z + s.right.z * side * latDist + (rng() - 0.5) * 3.0;
      this.trackData.project({ x, z }, projOut);
      if (projOut.distance < grassMinDist) continue;
      const y = this.terrain.getHeightAt(x, z);
      if (this.theme.terrain.waterLevel !== null && y < this.theme.terrain.waterLevel + 0.2) continue;
      grassPlacements.push({ x, y, z, rotY: rng() * Math.PI * 2, scale: 0.75 + rng() * 0.7 });
    }

    if (grassPlacements.length > 0) {
      const grassInst = new THREE.InstancedMesh(grassArch.geo, grassArch.mat, grassPlacements.length);
      grassInst.receiveShadow = true;
      for (let i = 0; i < grassPlacements.length; i++) {
        const g = grassPlacements[i];
        dummy.position.set(g.x, g.y, g.z);
        dummy.rotation.set(0, g.rotY, 0);
        dummy.scale.setScalar(g.scale);
        dummy.updateMatrix();
        grassInst.setMatrixAt(i, dummy.matrix);
      }
      grassInst.instanceMatrix.needsUpdate = true;
      this.root.add(grassInst);
    }

    // 3. Instanced Angular Boulders
    const rockGeo = new THREE.DodecahedronGeometry(1.1, 1);
    const rPos = rockGeo.attributes.position;
    for (let i = 0; i < rPos.count; i++) {
      const vx = rPos.getX(i);
      const vy = rPos.getY(i);
      const vz = rPos.getZ(i);
      const jitter = 0.8 + 0.35 * Math.sin(vx * 3.1 + vy * 2.7 + vz * 4.3);
      rPos.setXYZ(i, vx * jitter, vy * jitter * 0.75, vz * jitter);
    }
    rockGeo.computeVertexNormals();
    const rockMat = new THREE.MeshStandardMaterial({
      color: this.theme.terrain.rockColor,
      roughness: 0.88,
      metalness: 0.05,
    });
    this.disposables.push(rockGeo, rockMat);

    const rockPlacements = [];
    for (let i = 0; i < this.theme.flora.rockCount * 3 && rockPlacements.length < this.theme.flora.rockCount; i++) {
      const x = this.terrain.centerX + (rng() * 2 - 1) * span;
      const z = this.terrain.centerZ + (rng() * 2 - 1) * span;
      this.trackData.project({ x, z }, projOut);
      if (projOut.distance < exclusionRadius) continue;
      const y = this.terrain.getHeightAt(x, z);
      rockPlacements.push({
        x,
        y: y - 0.2,
        z,
        rx: rng() * 0.5,
        ry: rng() * Math.PI * 2,
        rz: rng() * 0.5,
        sx: 0.9 + rng() * 2.6,
        sy: 0.7 + rng() * 1.8,
        sz: 0.9 + rng() * 2.4,
      });
    }

    if (rockPlacements.length > 0) {
      const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, rockPlacements.length);
      rockInst.castShadow = true;
      rockInst.receiveShadow = true;
      for (let i = 0; i < rockPlacements.length; i++) {
        const rk = rockPlacements[i];
        dummy.position.set(rk.x, rk.y, rk.z);
        dummy.rotation.set(rk.rx, rk.ry, rk.rz);
        dummy.scale.set(rk.sx, rk.sy, rk.sz);
        dummy.updateMatrix();
        rockInst.setMatrixAt(i, dummy.matrix);
      }
      rockInst.instanceMatrix.needsUpdate = true;
      this.root.add(rockInst);
    }
  }

  _buildRoadsideLandmarks() {
    const N = this.trackData.samples.length;
    const dummy = new THREE.Object3D();
    const leftVec = new THREE.Vector3();
    const basisMat = new THREE.Matrix4();

    // 1. Automatic Chevron Turn Warning Signs on sharp corners (Rule: |curvature| > threshold)
    const chevronTex = createChevronTexture();
    const chevronMat = new THREE.MeshStandardMaterial({
      map: chevronTex,
      emissive: 0xfacc15,
      emissiveMap: chevronTex,
      emissiveIntensity: this.theme.isNight ? 0.95 : 0.2,
      roughness: 0.45,
    });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.6 });
    const signGeo = new THREE.BoxGeometry(1.4, 1.4, 0.08);
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.5, 8);
    this.disposables.push(chevronTex, chevronMat, postMat, signGeo, poleGeo);

    const chevronPlacements = [];
    for (let i = 0; i < N; i += 4) {
      const s = this.trackData.samples[i];
      if (Math.abs(s.curvature) > 0.0085) {
        // Place on OUTSIDE of turn! Left turn (curvature > 0) outside is +right; right turn outside is -right
        const sideSign = s.curvature > 0 ? 1 : -1;
        chevronPlacements.push({ sample: s, sideSign });
      }
    }

    if (chevronPlacements.length > 0) {
      const signsInst = new THREE.InstancedMesh(signGeo, chevronMat, chevronPlacements.length);
      const polesInst = new THREE.InstancedMesh(poleGeo, postMat, chevronPlacements.length);
      signsInst.castShadow = true;

      for (let i = 0; i < chevronPlacements.length; i++) {
        const { sample, sideSign } = chevronPlacements[i];
        const lat = sideSign * (this.trackData.totalWidthHalf + 1.25);
        leftVec.copy(sample.right).negate();
        basisMat.makeBasis(leftVec, sample.up, sample.tangent);

        dummy.position
          .copy(sample.position)
          .addScaledVector(sample.right, lat)
          .addScaledVector(sample.up, 2.0);
        dummy.quaternion.setFromRotationMatrix(basisMat);
        // Face approaching traffic (-tangent) and flip chevron horizontally for left/right turn direction
        dummy.rotateY(Math.PI);
        if (sample.curvature < 0) dummy.rotateZ(Math.PI);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        signsInst.setMatrixAt(i, dummy.matrix);

        dummy.position
          .copy(sample.position)
          .addScaledVector(sample.right, lat)
          .addScaledVector(sample.up, 1.15);
        dummy.quaternion.setFromRotationMatrix(basisMat);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        polesInst.setMatrixAt(i, dummy.matrix);
      }
      signsInst.instanceMatrix.needsUpdate = true;
      polesInst.instanceMatrix.needsUpdate = true;
      this.root.add(signsInst, polesInst);
    }

    // 2. Multi-tier Grandstands with colorful spectators near start/finish straight
    if (this.theme.architecture.grandstands) {
      const standGroup = new THREE.Group();
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.75 });
      const seatColors = [0xff5722, 0x00e5ff, 0xfacc15, 0xec4899, 0x22c55e, 0xf8fafc];
      const tierGeo = new THREE.BoxGeometry(24, 0.7, 1.2);
      const specGeo = new THREE.BoxGeometry(0.45, 0.55, 0.45);
      const specMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 });
      this.disposables.push(baseMat, tierGeo, specGeo, specMat);

      const standPositions = [
        { u: 0.004, side: 1 },
        { u: 0.96, side: -1 },
        { u: 0.985, side: 1 },
      ];
      const rng = createPRNG(4242);

      for (const sp of standPositions) {
        const f = this.trackData.getFrameAt(sp.u);
        if (f.inJumpCorridor) continue;
        const gs = new THREE.Group();
        gs.position
          .copy(f.position)
          .addScaledVector(f.right, sp.side * (this.trackData.totalWidthHalf + 8.5));
        leftVec.copy(f.right).negate();
        basisMat.makeBasis(leftVec, f.up, f.tangent);
        gs.quaternion.setFromRotationMatrix(basisMat);
        gs.rotateY(sp.side > 0 ? -Math.PI / 2 : Math.PI / 2);

        const tiers = 5;
        const specCount = tiers * 26;
        const specInst = new THREE.InstancedMesh(specGeo, specMat, specCount);
        let si = 0;
        const cTmp = new THREE.Color();

        for (let t = 0; t < tiers; t++) {
          const stepMesh = new THREE.Mesh(tierGeo, baseMat);
          stepMesh.position.set(0, 0.5 + t * 0.75, -t * 1.15);
          stepMesh.castShadow = true;
          stepMesh.receiveShadow = true;
          gs.add(stepMesh);

          for (let k = 0; k < 26; k++) {
            dummy.position.set(-11 + k * 0.88 + (rng() - 0.5) * 0.2, 1.15 + t * 0.75, -t * 1.15);
            dummy.rotation.set(0, (rng() - 0.5) * 0.4, 0);
            dummy.scale.set(1, 0.85 + rng() * 0.3, 1);
            dummy.updateMatrix();
            specInst.setMatrixAt(si, dummy.matrix);
            cTmp.setHex(seatColors[Math.floor(rng() * seatColors.length)]);
            specInst.setColorAt(si, cTmp);
            si += 1;
          }
        }
        specInst.instanceMatrix.needsUpdate = true;
        if (specInst.instanceColor) specInst.instanceColor.needsUpdate = true;
        gs.add(specInst);
        standGroup.add(gs);
      }
      this.root.add(standGroup);
    }

    // 3. Sponsor Billboards along track
    if (this.theme.architecture.billboards) {
      const ads = [
        createSponsorTexture('APEX TURBO', '#0f172a', '#ff5722'),
        createSponsorTexture('NITRO FUEL X', '#172554', '#00e5ff'),
        createSponsorTexture('GRIP PRO R', '#14532d', '#facc15'),
      ];
      const boardGeo = new THREE.BoxGeometry(9.0, 2.4, 0.25);
      const legGeo = new THREE.CylinderGeometry(0.12, 0.12, 3.2, 8);
      this.disposables.push(...ads, boardGeo, legGeo);

      const mats = ads.map(
        (tex) =>
          new THREE.MeshStandardMaterial({
            map: tex,
            emissive: 0xffffff,
            emissiveMap: tex,
            emissiveIntensity: this.theme.isNight ? 0.75 : 0.12,
            roughness: 0.4,
          })
      );
      this.disposables.push(...mats);

      for (let i = 0; i < 10; i++) {
        const u = (0.04 + i * 0.095) % 1;
        const f = this.trackData.getFrameAt(u);
        if (f.inJumpCorridor) continue;
        const side = i % 2 === 0 ? 1 : -1;
        const bGroup = new THREE.Group();
        bGroup.position
          .copy(f.position)
          .addScaledVector(f.right, side * (this.trackData.totalWidthHalf + 3.2));
        leftVec.copy(f.right).negate();
        basisMat.makeBasis(leftVec, f.up, f.tangent);
        bGroup.quaternion.setFromRotationMatrix(basisMat);
        bGroup.rotateY(side > 0 ? Math.PI * 0.65 : -Math.PI * 0.65);

        const board = new THREE.Mesh(boardGeo, mats[i % mats.length]);
        board.position.y = 3.1;
        board.castShadow = true;
        bGroup.add(board);

        for (const lx of [-3.2, 3.2]) {
          const leg = new THREE.Mesh(legGeo, postMat);
          leg.position.set(lx, 1.5, 0);
          bGroup.add(leg);
        }
        this.root.add(bGroup);
      }
    }

    // 4. Streetlights (for Neon Metropolis)
    if (this.theme.architecture.streetlights) {
      const lampSpacing = 26;
      const count = Math.floor(this.trackData.totalLength / lampSpacing);
      const poleGeo2 = new THREE.CylinderGeometry(0.09, 0.13, 6.2, 8);
      const headGeo = new THREE.BoxGeometry(1.6, 0.18, 0.42);
      const headMat = new THREE.MeshStandardMaterial({
        color: 0xe0f2fe,
        emissive: 0x38bdf8,
        emissiveIntensity: 2.6,
        roughness: 0.2,
      });
      this.disposables.push(poleGeo2, headGeo, headMat);

      const poleInst = new THREE.InstancedMesh(poleGeo2, postMat, count);
      const headInst = new THREE.InstancedMesh(headGeo, headMat, count);
      const f = this.trackData.getFrameAt(0);
      let lIdx = 0;

      for (let i = 0; i < count; i++) {
        const u = i / count;
        this.trackData.getFrameAt(u, f);
        if (f.isGapSegment) continue;
        const side = i % 2 === 0 ? 1 : -1;
        const lat = side * (this.trackData.totalWidthHalf + 1.1);
        leftVec.copy(f.right).negate();
        basisMat.makeBasis(leftVec, f.up, f.tangent);

        dummy.position.copy(f.position).addScaledVector(f.right, lat).addScaledVector(f.up, 3.1);
        dummy.quaternion.setFromRotationMatrix(basisMat);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        poleInst.setMatrixAt(lIdx, dummy.matrix);

        dummy.position
          .copy(f.position)
          .addScaledVector(f.right, lat - side * 0.75)
          .addScaledVector(f.up, 6.15);
        dummy.rotateY(side > 0 ? 0 : Math.PI);
        dummy.updateMatrix();
        headInst.setMatrixAt(lIdx, dummy.matrix);
        lIdx += 1;
      }
      poleInst.count = lIdx;
      headInst.count = lIdx;
      poleInst.instanceMatrix.needsUpdate = true;
      headInst.instanceMatrix.needsUpdate = true;
      this.root.add(poleInst, headInst);
    }

    // 5. Urban Lit-Window Buildings (for Neon Metropolis)
    if (this.theme.architecture.urbanBuildings) {
      const rng = createPRNG(5151);
      const winTex = createBuildingWindowTexture(true);
      const bldGeo = new THREE.BoxGeometry(1, 1, 1);
      const bldMat = new THREE.MeshStandardMaterial({
        map: winTex,
        emissive: 0xffffff,
        emissiveMap: winTex,
        emissiveIntensity: 0.9,
        roughness: 0.6,
        metalness: 0.2,
      });
      this.disposables.push(winTex, bldGeo, bldMat);

      const projOut = this.trackData.project({ x: 0, y: 0, z: 0 });
      const minTrackDist = this.trackData.totalWidthHalf + 15.0;
      const bldPlacements = [];
      const span = this.terrain.halfSize * 0.65;

      for (let i = 0; i < 420 && bldPlacements.length < 110; i++) {
        const s = this.trackData.samples[Math.floor(rng() * N)];
        const side = rng() < 0.5 ? -1 : 1;
        const offset = minTrackDist + rng() * 90;
        const x = s.position.x + s.right.x * side * offset + (rng() - 0.5) * 20;
        const z = s.position.z + s.right.z * side * offset + (rng() - 0.5) * 20;
        if (Math.abs(x - this.terrain.centerX) > span || Math.abs(z - this.terrain.centerZ) > span) continue;
        this.trackData.project({ x, z }, projOut);
        if (projOut.distance < minTrackDist) continue;
        const y = this.terrain.getHeightAt(x, z);
        if (this.theme.terrain.waterLevel !== null && y < this.theme.terrain.waterLevel + 0.5) continue;

        const w = 12 + rng() * 16;
        const d = 12 + rng() * 16;
        const h = 22 + rng() * 58;
        bldPlacements.push({ x, y: y + h * 0.5 - 2, z, w, h, d, ry: rng() * Math.PI });
      }

      if (bldPlacements.length > 0) {
        const bldInst = new THREE.InstancedMesh(bldGeo, bldMat, bldPlacements.length);
        bldInst.castShadow = true;
        bldInst.receiveShadow = true;
        for (let i = 0; i < bldPlacements.length; i++) {
          const b = bldPlacements[i];
          dummy.position.set(b.x, b.y, b.z);
          dummy.rotation.set(0, b.ry, 0);
          dummy.scale.set(b.w, b.h, b.d);
          dummy.updateMatrix();
          bldInst.setMatrixAt(i, dummy.matrix);
        }
        bldInst.instanceMatrix.needsUpdate = true;
        this.root.add(bldInst);
      }
    }
  }

  /**
   * Advance wind shader uniform & gentle cloud drift (zero allocations).
   */
  update(dt, elapsedTime) {
    this.uTime.value = elapsedTime;
    this.cloudGroup.rotation.y += dt * 0.004;
  }

  dispose() {
    this.root.traverse((obj) => {
      if (obj.isInstancedMesh) obj.dispose();
    });
    this.botanical.dispose();
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables.length = 0;
  }
}
