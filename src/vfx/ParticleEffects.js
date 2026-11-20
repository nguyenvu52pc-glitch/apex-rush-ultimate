import * as THREE from 'three';

function createSoftSmokeTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.45, 'rgba(240,244,248,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Zero-allocation Object-Pooled VFX System (Rule #10):
 * - Tire Smoke & Gravel Dust Pool (300 instanced billboards)
 * - Persistent Skidmark Ribbons (Ring-buffer quad strips +0.018m above road per Rule #7)
 * - HDR Collision Sparks Pool (180 instanced streaks triggering UnrealBloomPass)
 * - Nitro Exhaust Flames & Peripheral Speed Streaks
 * - Player Nose SpotLight + Volumetric Additive Headlight Cones
 * - Camera-Anchored 3D Rain Streak Pool
 */
export class ParticleEffects {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.disposables = [];

    this.rainEnabled = false;
    this.headlightsActive = false;

    this._initSmokePool();
    this._initSparksPool();
    this._initEmberPool();
    this._initSkidmarks();
    this._initSpeedLines();
    this._initWindRibbons();
    this._initSonicEffects();
    this._initRainPool();
    this._initHeadlightRig();
    this._initNitroFlames();

    // Pre-allocated scratch math objects (Rule #10)
    this._dummy = new THREE.Object3D();
    this._colorTmp = new THREE.Color();
    this._nitroCore = new THREE.Color(4.5, 4.8, 6.0);
    this._nitroMid = new THREE.Color(0.4, 2.5, 6.2);
    this._nitroOuter = new THREE.Color(0.1, 0.8, 3.6);
    this._nitroUi = new THREE.Color(0x00e5ff);
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._skidPrevValid = [false, false];
    this._skidPrevLeft = [new THREE.Vector3(), new THREE.Vector3()];
    this._skidPrevRight = [new THREE.Vector3(), new THREE.Vector3()];
    this._smokeTimer = 0;
    this._emberTimer = 0;
    this._prevIgnitePulse = 0;
    this._ribbonTimer = 0;
  }

  _initSmokePool() {
    this.maxSmoke = 300;
    this.smokeCursor = 0;
    this.smokeData = Array.from({ length: this.maxSmoke }, () => ({
      active: false,
      age: 0,
      life: 1,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      startScale: 0.4,
      endScale: 2.2,
      r: 0.85,
      g: 0.88,
      b: 0.92,
    }));

    const tex = createSoftSmokeTexture();
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.disposables.push(tex, geo, mat);

    this.smokeMesh = new THREE.InstancedMesh(geo, mat, this.maxSmoke);
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < this.maxSmoke; i++) {
      this.smokeMesh.setMatrixAt(i, hide);
      this.smokeMesh.setColorAt(i, white);
    }
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    if (this.smokeMesh.instanceColor) this.smokeMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.smokeMesh);
  }

  _initSparksPool() {
    this.maxSparks = 180;
    this.sparkCursor = 0;
    this.sparkData = Array.from({ length: this.maxSparks }, () => ({
      active: false,
      age: 0,
      life: 0.5,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      floorY: 0,
    }));

    const geo = new THREE.BoxGeometry(0.035, 0.035, 0.38);
    // HDR color scale triggers UnrealBloomPass threshold cleanly
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
    });
    this.disposables.push(geo, mat);

    this.sparksMesh = new THREE.InstancedMesh(geo, mat, this.maxSparks);
    this.sparksMesh.frustumCulled = false;
    this.sparksMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    const hdrGold = new THREE.Color(4.5, 2.2, 0.4);
    for (let i = 0; i < this.maxSparks; i++) {
      this.sparksMesh.setMatrixAt(i, hide);
      this.sparksMesh.setColorAt(i, hdrGold);
    }
    this.sparksMesh.instanceMatrix.needsUpdate = true;
    if (this.sparksMesh.instanceColor) this.sparksMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.sparksMesh);
  }

  _initEmberPool() {
    this.maxEmbers = 240;
    this.emberCursor = 0;
    this.emberData = Array.from({ length: this.maxEmbers }, () => ({
      active: false,
      age: 0,
      life: 0.5,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      seed: Math.random() * 6.28,
      scale: 1,
      cr: 5.0,
      cg: 2.5,
      cb: 0.4,
    }));

    const geo = new THREE.BoxGeometry(0.028, 0.028, 0.24);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
      transparent: true,
      opacity: 0.94,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(geo, mat);

    this.embersMesh = new THREE.InstancedMesh(geo, mat, this.maxEmbers);
    this.embersMesh.frustumCulled = false;
    this.embersMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    const col = new THREE.Color(4.5, 2.2, 0.6);
    for (let i = 0; i < this.maxEmbers; i++) {
      this.embersMesh.setMatrixAt(i, hide);
      this.embersMesh.setColorAt(i, col);
    }
    this.embersMesh.instanceMatrix.needsUpdate = true;
    if (this.embersMesh.instanceColor) this.embersMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.embersMesh);
  }

  _initSkidmarks() {
    // Ring-buffer of 640 quad segments (4 verts + 6 indices per quad)
    this.maxSkidQuads = 640;
    this.skidCursor = 0;
    this.skidPositions = new Float32Array(this.maxSkidQuads * 4 * 3);
    const indices = new Uint16Array(this.maxSkidQuads * 6);
    for (let q = 0; q < this.maxSkidQuads; q++) {
      const vb = q * 4;
      const ib = q * 6;
      indices[ib + 0] = vb + 0;
      indices[ib + 1] = vb + 2;
      indices[ib + 2] = vb + 1;
      indices[ib + 3] = vb + 1;
      indices[ib + 4] = vb + 2;
      indices[ib + 5] = vb + 3;
    }

    this.skidGeo = new THREE.BufferGeometry();
    this.skidGeo.setAttribute('position', new THREE.BufferAttribute(this.skidPositions, 3));
    this.skidGeo.setIndex(new THREE.BufferAttribute(indices, 1));
    this.skidMat = new THREE.MeshBasicMaterial({
      color: 0x090b10,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.disposables.push(this.skidGeo, this.skidMat);

    this.skidMesh = new THREE.Mesh(this.skidGeo, this.skidMat);
    this.skidMesh.frustumCulled = false;
    this.scene.add(this.skidMesh);
  }

  _initSpeedLines() {
    this.speedLineCount = 44;
    this.speedLinePos = new Float32Array(this.speedLineCount * 6);
    this.speedLineData = Array.from({ length: this.speedLineCount }, (_, i) => {
      const ang = (i / this.speedLineCount) * Math.PI * 2;
      return {
        ang,
        radius: 2.3 + (i % 5) * 0.45,
        zOff: (i * 0.65) % 14,
      };
    });

    this.speedLineGeo = new THREE.BufferGeometry();
    this.speedLineGeo.setAttribute('position', new THREE.BufferAttribute(this.speedLinePos, 3));
    this.speedLineMat = new THREE.LineBasicMaterial({
      color: 0xcbeafe,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.disposables.push(this.speedLineGeo, this.speedLineMat);

    this.speedLines = new THREE.LineSegments(this.speedLineGeo, this.speedLineMat);
    this.speedLines.frustumCulled = false;
    this.scene.add(this.speedLines);
  }

  _initRainPool() {
    this.rainCount = 520;
    this.rainPositions = new Float32Array(this.rainCount * 6);
    this.rainSeeds = new Float32Array(this.rainCount * 3);
    for (let i = 0; i < this.rainCount; i++) {
      this.rainSeeds[i * 3 + 0] = (Math.random() - 0.5) * 34;
      this.rainSeeds[i * 3 + 1] = Math.random() * 20;
      this.rainSeeds[i * 3 + 2] = (Math.random() - 0.5) * 34;
    }

    this.rainGeo = new THREE.BufferGeometry();
    this.rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
    this.rainMat = new THREE.LineBasicMaterial({
      color: 0xbfe2ff,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    this.disposables.push(this.rainGeo, this.rainMat);

    this.rainLines = new THREE.LineSegments(this.rainGeo, this.rainMat);
    this.rainLines.visible = false;
    this.rainLines.frustumCulled = false;
    this.scene.add(this.rainLines);
  }

  _initHeadlightRig() {
    this.headlightGroup = new THREE.Group();
    this.headlightSpot = new THREE.SpotLight(0xe0f2fe, 95, 78, Math.PI * 0.24, 0.45, 1.35);
    this.headlightSpot.position.set(0, 0.65, 2.0);
    this.headlightSpot.target.position.set(0, 0.2, 24);
    this.headlightGroup.add(this.headlightSpot);
    this.headlightGroup.add(this.headlightSpot.target);

    const coneGeo = new THREE.ConeGeometry(1.9, 12, 16, 1, true);
    coneGeo.rotateX(-Math.PI / 2);
    coneGeo.translate(0, 0, 6);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xdbeafe,
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.disposables.push(coneGeo, coneMat);

    for (const sx of [-0.62, 0.62]) {
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(sx, 0.58, 2.1);
      this.headlightGroup.add(cone);
    }
    this.headlightGroup.visible = false;
    this.scene.add(this.headlightGroup);
  }

  _initWindRibbons() {
    // 6 real-space 3D aerodynamic slipstream vapor ribbons trailing off wingtips, A-pillars & splitter
    this.ribbonCount = 6;
    this.ribbonNodes = 18;
    const totalVerts = this.ribbonCount * this.ribbonNodes * 2;
    const totalIndices = this.ribbonCount * (this.ribbonNodes - 1) * 6;
    this.ribbonPos = new Float32Array(totalVerts * 3);
    this.ribbonColors = new Float32Array(totalVerts * 4);
    const indices = new Uint16Array(totalIndices);

    let iPtr = 0;
    for (let r = 0; r < this.ribbonCount; r++) {
      const vBase = r * this.ribbonNodes * 2;
      for (let s = 0; s < this.ribbonNodes - 1; s++) {
        const a = vBase + s * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices[iPtr++] = a;
        indices[iPtr++] = c;
        indices[iPtr++] = b;
        indices[iPtr++] = b;
        indices[iPtr++] = c;
        indices[iPtr++] = d;
      }
    }

    this.ribbonGeo = new THREE.BufferGeometry();
    this.ribbonGeo.setAttribute('position', new THREE.BufferAttribute(this.ribbonPos, 3));
    this.ribbonGeo.setAttribute('color', new THREE.BufferAttribute(this.ribbonColors, 4));
    this.ribbonGeo.setIndex(new THREE.BufferAttribute(indices, 1));

    this.ribbonMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.disposables.push(this.ribbonGeo, this.ribbonMat);

    this.windRibbonMesh = new THREE.Mesh(this.ribbonGeo, this.ribbonMat);
    this.windRibbonMesh.frustumCulled = false;
    this.scene.add(this.windRibbonMesh);

    this._ribbonHistory = Array.from({ length: this.ribbonCount }, () =>
      Array.from({ length: this.ribbonNodes }, () => new THREE.Vector3())
    );
    this._ribbonCoords = new Float32Array(this.ribbonCount * 3);
    this._ribbonReady = false;
  }

  _initSonicEffects() {
    // 1. Prandtl-Glauert Mach Vapor Cone around car waist/cockpit when punching Nitro / high Mach speeds
    const coneGeo = new THREE.CylinderGeometry(0.18, 2.55, 3.8, 32, 10, true);
    coneGeo.rotateX(Math.PI / 2);
    coneGeo.translate(0, 0.55, -0.75);

    this.machConeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uColor: { value: new THREE.Color(0xdbeafe) },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uIntensity;
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        void main() {
          vUv = uv;
          vec3 p = position;
          float ripple = sin(uv.x * 18.8495 + uTime * 28.0) * 0.06 + cos(uv.y * 16.0 - uTime * 34.0) * 0.05;
          p.xy += normalize(p.xy + vec2(0.0001)) * ripple * (1.0 - uv.y) * uIntensity;
          vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
          vNormalView = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uIntensity;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewDir;

        void main() {
          float edgeY = smoothstep(0.0, 0.32, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
          float fresnel = abs(dot(normalize(vNormalView), normalize(vViewDir)));
          float rim = 1.0 - fresnel * 0.55;
          float streakA = sin(vUv.x * 25.1327 + uTime * 9.0) * 0.5 + 0.5;
          float streakB = sin(vUv.y * 22.0 - uTime * 36.0 + vUv.x * 12.566) * 0.5 + 0.5;
          float mist = (0.38 + 0.62 * streakA * streakB) * edgeY * rim;
          float alpha = clamp(mist * uIntensity * 0.58, 0.0, 0.65);
          gl_FragColor = vec4(uColor * (1.15 + 0.45 * streakB), alpha);
        }
      `,
    });
    this.disposables.push(coneGeo, this.machConeMat);

    this.machConeMesh = new THREE.Mesh(coneGeo, this.machConeMat);
    this.machConeMesh.visible = false;
    this.scene.add(this.machConeMesh);

    // 2. Sonic Boom Shockwave Ring (expands outward radially when Nitro fires)
    const ringGeo = new THREE.TorusGeometry(1.0, 0.085, 10, 42);
    this.sonicRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.2, 3.2, 4.5),
      toneMapped: false,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(ringGeo, this.sonicRingMat);

    this.sonicRing = new THREE.Mesh(ringGeo, this.sonicRingMat);
    this.sonicRing.visible = false;
    this.scene.add(this.sonicRing);
    this._sonicAge = 99;
  }

  _initNitroFlames() {
    this.nitroGroup = new THREE.Group();

    // Open-ended tapered flame plume with high longitudinal subdivisions for animated turbulence wave
    const flameGeo = new THREE.CylinderGeometry(0.145, 0.015, 2.05, 18, 14, true);
    flameGeo.rotateX(Math.PI / 2);
    flameGeo.translate(0, 0, -1.025);

    this.nitroFlameMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uBend: { value: 0 },
        uColorCore: { value: new THREE.Vector3(5.0, 5.2, 6.2) },
        uColorMid: { value: new THREE.Vector3(0.4, 2.5, 6.2) },
        uColorOuter: { value: new THREE.Vector3(0.1, 0.8, 3.6) },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uBend;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          float tailFactor = 1.0 - uv.y; // 0 at exhaust mouth, 1 at trailing tip
          float flutter = sin(uv.y * 15.0 + uTime * 52.0 + uv.x * 6.283) * 0.048
                        + cos(uv.y * 23.0 + uTime * 71.0) * 0.025;
          p.x += flutter * tailFactor + uBend * (tailFactor * tailFactor);
          p.y += cos(uv.y * 18.0 + uTime * 61.0 + uv.x * 6.283) * 0.042 * tailFactor;
          float pulse = 1.0 + 0.16 * sin(uv.y * 19.0 + uTime * 48.0);
          p.xy *= mix(1.0, pulse, tailFactor);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColorCore;
        uniform vec3 uColorMid;
        uniform vec3 uColorOuter;
        varying vec2 vUv;

        void main() {
          float lenT = vUv.y; // 1.0 at nozzle mouth, 0.0 at trailing tip
          float angleNoise = sin(vUv.x * 18.8495 + uTime * 22.0) * 0.5 + 0.5;
          float lick = sin(vUv.y * 20.0 + uTime * 44.0 + angleNoise * 3.14) * 0.5 + 0.5;
          // Mach shock diamond pressure nodes standing along flame jet!
          float diamonds = max(0.0, sin(vUv.y * 30.0 + uTime * 36.0));
          diamonds = diamonds * diamonds * smoothstep(0.15, 0.88, lenT);

          // Dissolve flame tail raggedly into tongues so it never looks like a solid cone
          float edgeMask = smoothstep(0.02 + (1.0 - lick) * 0.24, 0.65, lenT);
          float mouthCore = smoothstep(0.55, 0.99, lenT);

          vec3 col = mix(uColorOuter, uColorMid, clamp(lenT * 1.15 + lick * 0.25, 0.0, 1.0));
          col = mix(col, uColorCore, clamp(mouthCore * 0.85 + diamonds * 0.72, 0.0, 1.0));

          float alpha = edgeMask * (0.45 + 0.55 * lick) * smoothstep(1.0, 0.96, lenT);
          alpha = clamp(alpha + mouthCore * 0.55, 0.0, 0.96);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.disposables.push(flameGeo, this.nitroFlameMat);

    this.flameCones = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(flameGeo, this.nitroFlameMat);
      this.nitroGroup.add(m);
      this.flameCones.push(m);
    }

    // Dynamic flickering exhaust illumination light on rear diffuser & asphalt
    this.nitroLight = new THREE.PointLight(0x00e5ff, 0, 14, 1.8);
    this.nitroLight.position.set(0, 0.4, -2.6);
    this.nitroGroup.add(this.nitroLight);
    this._exhaustXs = new Float32Array(4);

    this.nitroGroup.visible = false;
    this.scene.add(this.nitroGroup);
  }

  setRainEnabled(enabled) {
    this.rainEnabled = Boolean(enabled);
    this.rainLines.visible = this.rainEnabled;
  }

  setHeadlightsActive(active) {
    this.headlightsActive = Boolean(active);
    this.headlightGroup.visible = this.headlightsActive;
  }

  /**
   * Adjust particle count budget for QualityManager (Medium/High/Ultra).
   */
  setQualityScale(scale) {
    this.rainLines.geometry.setDrawRange(0, Math.floor(this.rainCount * scale) * 2);
  }

  clearSkidmarks() {
    this.skidPositions.fill(0);
    this.skidGeo.attributes.position.needsUpdate = true;
    this._skidPrevValid[0] = false;
    this._skidPrevValid[1] = false;
    this._ribbonReady = false;
    if (this.windRibbonMesh) {
      this.ribbonPos.fill(0);
      this.ribbonGeo.attributes.position.needsUpdate = true;
    }
  }

  emitSmoke(x, y, z, vx, vy, vz, isGravel = false) {
    const p = this.smokeData[this.smokeCursor];
    this.smokeCursor = (this.smokeCursor + 1) % this.maxSmoke;
    p.active = true;
    p.age = 0;
    p.life = isGravel ? 0.65 : 0.95;
    p.x = x;
    p.y = y + 0.14;
    p.z = z;
    p.vx = vx + (Math.random() - 0.5) * 1.6;
    p.vy = vy + 0.8 + Math.random() * 0.9;
    p.vz = vz + (Math.random() - 0.5) * 1.6;
    p.startScale = isGravel ? 0.35 : 0.45;
    p.endScale = isGravel ? 1.85 : 2.55;
    if (isGravel) {
      p.r = 0.62;
      p.g = 0.52;
      p.b = 0.38;
    } else {
      p.r = 0.88;
      p.g = 0.91;
      p.b = 0.95;
    }
  }

  emitSparks(point, normal, intensity = 8) {
    const count = Math.min(28, Math.max(6, Math.floor(intensity * 1.8)));
    const speedScale = Math.min(20, 5 + intensity * 0.9);
    for (let i = 0; i < count; i++) {
      const s = this.sparkData[this.sparkCursor];
      this.sparkCursor = (this.sparkCursor + 1) % this.maxSparks;
      s.active = true;
      s.age = 0;
      s.life = 0.25 + Math.random() * 0.35;
      s.x = point.x;
      s.y = point.y + 0.15;
      s.z = point.z;
      s.floorY = point.y - 0.2;
      s.vx = (normal.x * 0.6 + (Math.random() - 0.5) * 1.4) * speedScale;
      s.vy = (0.35 + Math.random() * 0.85) * speedScale * 0.7;
      s.vz = (normal.z * 0.6 + (Math.random() - 0.5) * 1.4) * speedScale;
    }
  }

  emitEmber(x, y, z, vx, vy, vz, cr, cg, cb, life = 0.55) {
    const e = this.emberData[this.emberCursor];
    this.emberCursor = (this.emberCursor + 1) % this.maxEmbers;
    e.active = true;
    e.age = 0;
    e.life = life;
    e.x = x;
    e.y = y;
    e.z = z;
    e.vx = vx;
    e.vy = vy;
    e.vz = vz;
    e.seed = Math.random() * 6.283;
    e.scale = 0.7 + Math.random() * 0.85;
    e.cr = cr;
    e.cg = cg;
    e.cb = cb;
  }

  _updateWindRibbons(dt, playerVehicle, playerModel) {
    const speed = playerVehicle ? playerVehicle.speedMps : 0;
    const isVisible = Boolean(playerVehicle && playerModel && speed > 24);
    this.windRibbonMesh.visible = isVisible;
    if (!isVisible) {
      this._ribbonReady = false;
      return;
    }

    const dim = playerModel.spec.dimensions;
    const wingStyle = playerModel.spec.styling.wingStyle;
    const wingH =
      wingStyle === 'svj_swan' || wingStyle === 'maserati_blade'
        ? dim.trunkHeight + 0.30
        : wingStyle === 'ferrari_gt'
        ? dim.trunkHeight + 0.24
        : dim.trunkHeight + 0.08;
    const halfW = dim.width * 0.5;
    const halfL = dim.length * 0.5;

    // Predefined 6 aero emitter coordinates (no array allocation inside loop: write directly)
    const q = playerModel.root.quaternion;
    const p = playerModel.root.position;
    this._up.set(0, 1, 0).applyQuaternion(q).normalize();

    const intensity = THREE.MathUtils.clamp((speed - 24) / 48, 0, 1);
    const nitroBoost = playerVehicle.nitroActive ? 1.0 : 0.0;
    const airBoost = playerVehicle.isAirborne ? 0.5 : 0.0;
    const visAlpha = Math.min(0.68, intensity * 0.28 + nitroBoost * 0.26 + airBoost * 0.14);

    // Sample interval ~16ms so trails stretch fluidly over corners & jumps
    this._ribbonTimer -= dt;
    const stepShift = this._ribbonTimer <= 0;
    if (stepShift) this._ribbonTimer = 0.016;

    const coords = this._ribbonCoords;
    coords[0] = halfW * 0.94; coords[1] = dim.beltHeight * 0.68; coords[2] = dim.frontAxleZ - 0.1;
    coords[3] = -halfW * 0.94; coords[4] = dim.beltHeight * 0.68; coords[5] = dim.frontAxleZ - 0.1;
    coords[6] = halfW + 0.08; coords[7] = dim.beltHeight + 0.09; coords[8] = dim.cabinFrontZ - 0.17;
    coords[9] = -(halfW + 0.08); coords[10] = dim.beltHeight + 0.09; coords[11] = dim.cabinFrontZ - 0.17;
    coords[12] = halfW * 0.94; coords[13] = wingH; coords[14] = -halfL + 0.08;
    coords[15] = -halfW * 0.94; coords[16] = wingH; coords[17] = -halfL + 0.08;

    const colR = THREE.MathUtils.lerp(0.85, this._nitroUi.r * 1.15, nitroBoost * 0.65);
    const colG = THREE.MathUtils.lerp(0.93, this._nitroUi.g * 1.15, nitroBoost * 0.65);
    const colB = THREE.MathUtils.lerp(1.00, this._nitroUi.b * 1.15, nitroBoost * 0.65);

    const nodes = this.ribbonNodes;
    for (let r = 0; r < this.ribbonCount; r++) {
      const hist = this._ribbonHistory[r];
      this._v1.set(coords[r * 3 + 0], coords[r * 3 + 1], coords[r * 3 + 2]).applyQuaternion(q).add(p);

      if (!this._ribbonReady) {
        for (let s = 0; s < nodes; s++) hist[s].copy(this._v1);
      } else if (stepShift) {
        for (let s = nodes - 1; s > 0; s--) {
          hist[s].copy(hist[s - 1]);
        }
        hist[0].copy(this._v1);
      } else {
        hist[0].copy(this._v1);
      }

      const halfWidth = 0.024 + nitroBoost * 0.022;
      const vBase = r * nodes * 2;
      for (let s = 0; s < nodes; s++) {
        const taper = 1 - s / (nodes - 1);
        const w = halfWidth * (0.25 + 0.75 * taper);
        const pt = hist[s];
        const idx3 = (vBase + s * 2) * 3;
        const idx4 = (vBase + s * 2) * 4;

        this.ribbonPos[idx3 + 0] = pt.x + this._up.x * w;
        this.ribbonPos[idx3 + 1] = pt.y + this._up.y * w;
        this.ribbonPos[idx3 + 2] = pt.z + this._up.z * w;
        this.ribbonPos[idx3 + 3] = pt.x - this._up.x * w;
        this.ribbonPos[idx3 + 4] = pt.y - this._up.y * w;
        this.ribbonPos[idx3 + 5] = pt.z - this._up.z * w;

        const a = taper * taper * visAlpha;
        this.ribbonColors[idx4 + 0] = colR * a;
        this.ribbonColors[idx4 + 1] = colG * a;
        this.ribbonColors[idx4 + 2] = colB * a;
        this.ribbonColors[idx4 + 3] = a;
        this.ribbonColors[idx4 + 4] = colR * a;
        this.ribbonColors[idx4 + 5] = colG * a;
        this.ribbonColors[idx4 + 6] = colB * a;
        this.ribbonColors[idx4 + 7] = a;
      }
    }
    this._ribbonReady = true;
    this.ribbonGeo.attributes.position.needsUpdate = true;
    this.ribbonGeo.attributes.color.needsUpdate = true;
  }

  _appendSkidSegment(rearIdx, centerX, centerY, centerZ, rightX, rightY, rightZ) {
    const halfWidth = 0.13;
    this._v1.set(centerX - rightX * halfWidth, centerY + 0.018, centerZ - rightZ * halfWidth);
    this._v2.set(centerX + rightX * halfWidth, centerY + 0.018, centerZ + rightZ * halfWidth);

    if (!this._skidPrevValid[rearIdx]) {
      this._skidPrevLeft[rearIdx].copy(this._v1);
      this._skidPrevRight[rearIdx].copy(this._v2);
      this._skidPrevValid[rearIdx] = true;
      return;
    }

    const distSq = this._skidPrevLeft[rearIdx].distanceToSquared(this._v1);
    if (distSq < 0.14) return;
    if (distSq > 12.0) {
      this._skidPrevLeft[rearIdx].copy(this._v1);
      this._skidPrevRight[rearIdx].copy(this._v2);
      return;
    }

    const q = this.skidCursor;
    this.skidCursor = (this.skidCursor + 1) % this.maxSkidQuads;
    const base = q * 12;

    const pL = this._skidPrevLeft[rearIdx];
    const pR = this._skidPrevRight[rearIdx];

    this.skidPositions[base + 0] = pL.x;
    this.skidPositions[base + 1] = pL.y;
    this.skidPositions[base + 2] = pL.z;
    this.skidPositions[base + 3] = pR.x;
    this.skidPositions[base + 4] = pR.y;
    this.skidPositions[base + 5] = pR.z;
    this.skidPositions[base + 6] = this._v1.x;
    this.skidPositions[base + 7] = this._v1.y;
    this.skidPositions[base + 8] = this._v1.z;
    this.skidPositions[base + 9] = this._v2.x;
    this.skidPositions[base + 10] = this._v2.y;
    this.skidPositions[base + 11] = this._v2.z;

    this.skidGeo.attributes.position.needsUpdate = true;
    pL.copy(this._v1);
    pR.copy(this._v2);
  }

  /**
   * Emit continuous driving effects for a vehicle (player or nearby AI) without allocations.
   */
  emitVehicleEffects(vehiclePhysics, carModel, onRoad = true, emitSkids = true) {
    if (!vehiclePhysics || !carModel) return;
    const isDrifting = vehiclePhysics.isDrifting;
    const speed = vehiclePhysics.speedMps;
    const isGravel = !onRoad && speed > 5.0;

    if (isDrifting || isGravel) {
      this._right.set(-1, 0, 0).applyQuaternion(carModel.root.quaternion).normalize();
      for (let r = 0; r < 2; r++) {
        const wInfo = vehiclePhysics.vehicle.wheelInfos[2 + r];
        if (!wInfo.isInContact) {
          if (emitSkids) this._skidPrevValid[r] = false;
          continue;
        }
        const hp = wInfo.raycastResult.hitPointWorld;
        if (emitSkids) {
          if (isDrifting) {
            this._appendSkidSegment(r, hp.x, hp.y, hp.z, this._right.x, this._right.y, this._right.z);
          } else {
            this._skidPrevValid[r] = false;
          }
        }
        if (this._smokeTimer <= 0) {
          this.emitSmoke(
            hp.x,
            hp.y,
            hp.z,
            -vehiclePhysics.chassisBody.velocity.x * 0.12,
            0.3,
            -vehiclePhysics.chassisBody.velocity.z * 0.12,
            isGravel
          );
        }
      }
    } else if (emitSkids) {
      this._skidPrevValid[0] = false;
      this._skidPrevValid[1] = false;
    }
  }

  update(dt, { playerVehicle = null, playerModel = null, onRoad = true, racers = null, elapsedTime = 0 } = {}) {
    this._smokeTimer -= dt;
    this._emberTimer -= dt;

    if (playerVehicle && playerModel) {
      this.emitVehicleEffects(playerVehicle, playerModel, onRoad, true);

      // Read per-car signature Nitro palette (fallback safe)
      const nc = playerModel.spec.nitroColor;
      if (nc) {
        this._nitroCore.setRGB(nc.core[0], nc.core[1], nc.core[2]);
        this._nitroMid.setRGB(nc.mid[0], nc.mid[1], nc.mid[2]);
        this._nitroOuter.setRGB(nc.outer[0], nc.outer[1], nc.outer[2]);
        this._nitroUi.setHex(nc.lightHex);
      }

      // Sync player nose headlights
      if (this.headlightsActive) {
        this.headlightGroup.position.copy(playerModel.root.position);
        this.headlightGroup.quaternion.copy(playerModel.root.quaternion);
      }

      // Sync Signature-Color Volumetric Nitro Flames & Radial Embers (Tàn lửa)
      const dim = playerModel.spec.dimensions;
      const layout = playerModel.spec.styling.exhaustLayout;
      const halfL = dim.length * 0.5;
      const exZ = -halfL - 0.08;
      let pipeCount = 2;
      let exY = dim.groundClearance + 0.135;
      if (layout === 'quad') {
        pipeCount = 4;
        this._exhaustXs[0] = -0.50;
        this._exhaustXs[1] = -0.38;
        this._exhaustXs[2] = 0.38;
        this._exhaustXs[3] = 0.50;
      } else if (layout === 'hex_high') {
        pipeCount = 2;
        exY = dim.trunkHeight - 0.195;
        this._exhaustXs[0] = -0.11;
        this._exhaustXs[1] = 0.11;
      } else {
        pipeCount = 2;
        this._exhaustXs[0] = -0.085;
        this._exhaustXs[1] = 0.085;
      }
      // Adjust local relative to car root (+yCoMOffset offset aligns carRoot vs wheel ground frame!)
      const localExY = exY - playerVehicle.yCoMOffset;

      this.nitroGroup.visible = playerVehicle.nitroActive;
      if (playerVehicle.nitroActive) {
        this.nitroGroup.position.copy(playerModel.root.position);
        this.nitroGroup.quaternion.copy(playerModel.root.quaternion);

        const fu = this.nitroFlameMat.uniforms;
        fu.uTime.value = elapsedTime;
        fu.uBend.value = THREE.MathUtils.clamp(-playerVehicle.chassisBody.angularVelocity.y * 0.22, -0.32, 0.32);
        fu.uColorCore.value.set(this._nitroCore.r, this._nitroCore.g, this._nitroCore.b);
        fu.uColorMid.value.set(this._nitroMid.r, this._nitroMid.g, this._nitroMid.b);
        fu.uColorOuter.value.set(this._nitroOuter.r, this._nitroOuter.g, this._nitroOuter.b);

        const flicker = 0.90 + Math.sin(elapsedTime * 58) * 0.18 + Math.cos(elapsedTime * 91) * 0.12;
        this.nitroLight.color.copy(this._nitroUi);
        this.nitroLight.intensity = 9.5 * flicker;
        this.nitroLight.position.set(0, localExY + 0.12, exZ - 0.35);

        for (let i = 0; i < 4; i++) {
          const cone = this.flameCones[i];
          if (i < pipeCount) {
            cone.visible = true;
            cone.position.set(this._exhaustXs[i], localExY, exZ);
            const perPipePulse = 0.88 + 0.22 * Math.sin(elapsedTime * 68 + i * 2.1);
            cone.scale.set(perPipePulse, perPipePulse, flicker * (1.05 + (pipeCount === 2 ? 0.18 : 0.0)));
          } else {
            cone.visible = false;
          }
        }

        // Emit swirling glowing exhaust embers / tàn lửa around the rear jets & wake!
        const q = playerModel.root.quaternion;
        const pos = playerModel.root.position;
        this._fwd.set(0, 0, 1).applyQuaternion(q).normalize();
        this._right.set(-1, 0, 0).applyQuaternion(q).normalize();
        this._up.set(0, 1, 0).applyQuaternion(q).normalize();

        const isBurst = playerVehicle.nitroIgnitePulse > 0.85 && this._prevIgnitePulse <= 0.85;
        if (this._emberTimer <= 0 || isBurst) {
          const emitsPerPipe = isBurst ? 8 : 2;
          for (let p = 0; p < pipeCount; p++) {
            this._v1
              .set(this._exhaustXs[p], localExY, exZ - 0.22)
              .applyQuaternion(q)
              .add(pos);
            for (let k = 0; k < emitsPerPipe; k++) {
              const jetBack = -(16 + Math.random() * 14);
              const radialX = (Math.random() - 0.5) * 8.5;
              const radialY = (Math.random() - 0.35) * 5.8;
              const evx = this._fwd.x * jetBack + this._right.x * radialX + this._up.x * radialY + playerVehicle.chassisBody.velocity.x * 0.25;
              const evy = this._fwd.y * jetBack + this._right.y * radialX + this._up.y * radialY + playerVehicle.chassisBody.velocity.y * 0.25;
              const evz = this._fwd.z * jetBack + this._right.z * radialX + this._up.z * radialY + playerVehicle.chassisBody.velocity.z * 0.25;
              this.emitEmber(
                this._v1.x,
                this._v1.y,
                this._v1.z,
                evx,
                evy,
                evz,
                this._nitroMid.r,
                this._nitroMid.g,
                this._nitroMid.b,
                0.38 + Math.random() * 0.42
              );
            }
          }
          if (this._emberTimer <= 0) this._emberTimer = 0.022;
        }
      } else {
        this.nitroLight.intensity = 0;
      }

      // Sync Prandtl-Glauert Mach Vapor Cone + Sonic Boom Shockwave Ring
      const speedMps = playerVehicle.speedMps;
      const machFactor = THREE.MathUtils.clamp((speedMps - 46) / 36, 0, 1);
      const coneStrength = Math.max(machFactor * 0.55, playerVehicle.nitroActive ? 0.85 + machFactor * 0.35 : 0);
      this.machConeMesh.visible = coneStrength > 0.06;
      if (this.machConeMesh.visible) {
        this.machConeMesh.position.copy(playerModel.root.position);
        this.machConeMesh.quaternion.copy(playerModel.root.quaternion);
        this.machConeMat.uniforms.uTime.value = elapsedTime;
        this.machConeMat.uniforms.uIntensity.value = coneStrength;
        this.machConeMat.uniforms.uColor.value.lerpColors(
          this._colorTmp.setHex(0xdbeafe),
          this._nitroUi,
          playerVehicle.nitroActive ? 0.38 : 0.12
        );
      }

      if (playerVehicle.nitroIgnitePulse > 0.85 && this._prevIgnitePulse <= 0.85) {
        this._sonicAge = 0;
        this.sonicRing.position.copy(playerModel.root.position);
        this.sonicRing.quaternion.copy(playerModel.root.quaternion);
      }
      this._prevIgnitePulse = playerVehicle.nitroIgnitePulse;

      if (this._sonicAge < 0.42) {
        this._sonicAge += dt;
        const st = THREE.MathUtils.clamp(this._sonicAge / 0.42, 0, 1);
        this.sonicRing.visible = true;
        this.sonicRing.position.copy(playerModel.root.position);
        this.sonicRing.quaternion.copy(playerModel.root.quaternion);
        const sScale = THREE.MathUtils.lerp(0.95, 6.4, 1 - (1 - st) * (1 - st));
        this.sonicRing.scale.set(sScale, sScale, 1.0 + st * 0.6);
        const fade = (1 - st) * (1 - st);
        this.sonicRingMat.opacity = fade * 0.82;
        this.sonicRingMat.color.copy(this._nitroMid).multiplyScalar(0.85).addScalar(0.75);
      } else {
        this.sonicRing.visible = false;
      }

      // Sync 6 Real 3D Aerodynamic Wind Vortex Ribbons
      this._updateWindRibbons(dt, playerVehicle, playerModel);

      // Clean landing burst when returning from mid-air ramp flight!
      if (playerVehicle.justLanded) {
        const bp = playerModel.root.position;
        for (let sx = -1; sx <= 1; sx += 2) {
          this.emitSmoke(bp.x + sx * 0.8, bp.y - 0.1, bp.z, 0, 0.5, 0, !onRoad);
        }
        this._v2.set(bp.x, bp.y - 0.15, bp.z);
        this._v3.set(0, 1, 0);
        this.emitSparks(this._v2, this._v3, 9);
      }
    } else {
      this.nitroGroup.visible = false;
      this.machConeMesh.visible = false;
      this.sonicRing.visible = false;
      this.windRibbonMesh.visible = false;
    }

    // Emit smoke/dust for nearby AI cars within 75m of camera
    if (racers && this._smokeTimer <= 0) {
      const cx = this.camera.position.x;
      const cz = this.camera.position.z;
      for (let i = 0; i < racers.length; i++) {
        const r = racers[i];
        if (r.isPlayer) continue;
        const p = r.carModel.root.position;
        const dx = p.x - cx;
        const dz = p.z - cz;
        if (dx * dx + dz * dz < 5625) {
          this.emitVehicleEffects(r.vp, r.carModel, r.onRoad, false);
        }
      }
    }

    if (this._smokeTimer <= 0) {
      this._smokeTimer = 0.032; // ~30 puffs/sec
    }
    if (this._emberTimer <= 0) {
      this._emberTimer = 0.022;
    }

    // 1. Update Smoke/Dust Pool
    let smokeDirty = false;
    for (let i = 0; i < this.maxSmoke; i++) {
      const p = this.smokeData[i];
      if (!p.active) continue;
      smokeDirty = true;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        this._dummy.scale.set(0, 0, 0);
        this._dummy.updateMatrix();
        this.smokeMesh.setMatrixAt(i, this._dummy.matrix);
        continue;
      }
      const t = p.age / p.life;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= Math.exp(-2.2 * dt);
      p.vz *= Math.exp(-2.2 * dt);

      const scale = THREE.MathUtils.lerp(p.startScale, p.endScale, Math.pow(t, 0.7));
      const fade = 1 - t;
      this._dummy.position.set(p.x, p.y, p.z);
      this._dummy.quaternion.copy(this.camera.quaternion);
      this._dummy.scale.set(scale, scale, scale);
      this._dummy.updateMatrix();
      this.smokeMesh.setMatrixAt(i, this._dummy.matrix);
      this._colorTmp.setRGB(p.r * fade, p.g * fade, p.b * fade);
      this.smokeMesh.setColorAt(i, this._colorTmp);
    }
    if (smokeDirty) {
      this.smokeMesh.instanceMatrix.needsUpdate = true;
      if (this.smokeMesh.instanceColor) this.smokeMesh.instanceColor.needsUpdate = true;
    }

    // 2. Update HDR Collision Sparks Pool
    let sparksDirty = false;
    for (let i = 0; i < this.maxSparks; i++) {
      const s = this.sparkData[i];
      if (!s.active) continue;
      sparksDirty = true;
      s.age += dt;
      if (s.age >= s.life) {
        s.active = false;
        this._dummy.scale.set(0, 0, 0);
        this._dummy.updateMatrix();
        this.sparksMesh.setMatrixAt(i, this._dummy.matrix);
        continue;
      }
      s.vy -= 18 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      if (s.y < s.floorY && s.vy < 0) {
        s.y = s.floorY;
        s.vy *= -0.45;
        s.vx *= 0.7;
        s.vz *= 0.7;
      }

      const fade = 1 - s.age / s.life;
      this._dummy.position.set(s.x, s.y, s.z);
      this._v1.set(s.x + s.vx, s.y + s.vy, s.z + s.vz);
      this._dummy.lookAt(this._v1);
      this._dummy.scale.set(fade, fade, Math.max(0.3, fade * 1.4));
      this._dummy.updateMatrix();
      this.sparksMesh.setMatrixAt(i, this._dummy.matrix);
      this._colorTmp.setRGB(5.0 * fade, 2.4 * fade, 0.45 * fade);
      this.sparksMesh.setColorAt(i, this._colorTmp);
    }
    if (sparksDirty) {
      this.sparksMesh.instanceMatrix.needsUpdate = true;
      if (this.sparksMesh.instanceColor) this.sparksMesh.instanceColor.needsUpdate = true;
    }

    // 2b. Update Nitro Embers & Tàn Lửa Spark Pool (Signature hue cooling to glowing fiery orange embers)
    let embersDirty = false;
    for (let i = 0; i < this.maxEmbers; i++) {
      const e = this.emberData[i];
      if (!e.active) continue;
      embersDirty = true;
      e.age += dt;
      if (e.age >= e.life) {
        e.active = false;
        this._dummy.scale.set(0, 0, 0);
        this._dummy.updateMatrix();
        this.embersMesh.setMatrixAt(i, this._dummy.matrix);
        continue;
      }

      const t = e.age / e.life;
      // Air turbulence vortex swirl + gravity settle
      const swirl = Math.sin(e.age * 24 + e.seed) * 6.5;
      const drag = Math.exp(-3.4 * dt);
      e.vx = (e.vx + swirl * dt) * drag;
      e.vy = (e.vy - 5.2 * dt + Math.cos(e.age * 20 + e.seed) * 3.5 * dt) * drag;
      e.vz = (e.vz + Math.cos(e.age * 24 + e.seed) * 6.5 * dt) * drag;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.z += e.vz * dt;

      const fade = (1 - t) * (1 - t);
      this._dummy.position.set(e.x, e.y, e.z);
      this._v1.set(e.x + e.vx, e.y + e.vy, e.z + e.vz);
      this._dummy.lookAt(this._v1);
      const streak = Math.max(0.25, (1 - t) * e.scale * 1.45);
      this._dummy.scale.set((1 - t * 0.65) * e.scale, (1 - t * 0.65) * e.scale, streak);
      this._dummy.updateMatrix();
      this.embersMesh.setMatrixAt(i, this._dummy.matrix);

      // Cool transition: initial car signature plasma hue -> glowing orange-red tàn lửa -> fade
      const cool = Math.min(1, t * 1.35);
      const cr = THREE.MathUtils.lerp(e.cr, 4.6, cool) * fade;
      const cg = THREE.MathUtils.lerp(e.cg, 1.35, cool) * fade;
      const cb = THREE.MathUtils.lerp(e.cb, 0.16, cool) * fade;
      this._colorTmp.setRGB(cr, cg, cb);
      this.embersMesh.setColorAt(i, this._colorTmp);
    }
    if (embersDirty) {
      this.embersMesh.instanceMatrix.needsUpdate = true;
      if (this.embersMesh.instanceColor) this.embersMesh.instanceColor.needsUpdate = true;
    }

    // 3. Peripheral Wind Air-Wisps (enhanced realistic high-speed / airborne / Nitro streaks)
    const speedMps = playerVehicle ? playerVehicle.speedMps : 0;
    const speedIntensity =
      THREE.MathUtils.clamp((speedMps - 30) / 38, 0, 1) +
      (playerVehicle?.nitroActive ? 0.65 : 0) +
      (playerVehicle?.isAirborne ? 0.45 : 0);
    const clampedSpeedOp = Math.min(0.68, speedIntensity * 0.44);
    this.speedLines.visible = clampedSpeedOp > 0.02;
    if (this.speedLines.visible) {
      this.speedLineMat.opacity = clampedSpeedOp;
      this.speedLineMat.color.lerpColors(
        this._colorTmp.setHex(0xdbeafe),
        this._nitroUi,
        playerVehicle?.nitroActive ? 0.42 : 0.08
      );
      this._fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
      this._right.set(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
      this._up.set(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();

      for (let i = 0; i < this.speedLineCount; i++) {
        const d = this.speedLineData[i];
        d.zOff = (d.zOff + dt * (32 + speedMps * 0.65)) % 14;
        const rx = Math.cos(d.ang) * d.radius;
        const ry = Math.sin(d.ang) * d.radius * 0.62;
        const base = i * 6;
        const zA = 2.0 + d.zOff;
        const zB = zA + 1.55 + (playerVehicle?.nitroActive ? 0.8 : 0);

        this.speedLinePos[base + 0] = this.camera.position.x + this._fwd.x * zA + this._right.x * rx + this._up.x * ry;
        this.speedLinePos[base + 1] = this.camera.position.y + this._fwd.y * zA + this._right.y * rx + this._up.y * ry;
        this.speedLinePos[base + 2] = this.camera.position.z + this._fwd.z * zA + this._right.z * rx + this._up.z * ry;

        this.speedLinePos[base + 3] = this.camera.position.x + this._fwd.x * zB + this._right.x * rx * 1.12 + this._up.x * ry * 1.12;
        this.speedLinePos[base + 4] = this.camera.position.y + this._fwd.y * zB + this._right.y * rx * 1.12 + this._up.y * ry * 1.12;
        this.speedLinePos[base + 5] = this.camera.position.z + this._fwd.z * zB + this._right.z * rx * 1.12 + this._up.z * ry * 1.12;
      }
      this.speedLineGeo.attributes.position.needsUpdate = true;
    }

    // 4. Camera-Anchored 3D Rain Streaks
    if (this.rainEnabled) {
      const cx = this.camera.position.x;
      const cy = this.camera.position.y;
      const cz = this.camera.position.z;

      for (let i = 0; i < this.rainCount; i++) {
        const sIdx = i * 3;
        let ry = this.rainSeeds[sIdx + 1] - dt * 26;
        if (ry < -5) ry += 20;
        this.rainSeeds[sIdx + 1] = ry;

        const wx = cx + this.rainSeeds[sIdx + 0];
        const wy = cy + ry;
        const wz = cz + this.rainSeeds[sIdx + 2];
        const base = i * 6;

        this.rainPositions[base + 0] = wx;
        this.rainPositions[base + 1] = wy;
        this.rainPositions[base + 2] = wz;
        this.rainPositions[base + 3] = wx - 0.08;
        this.rainPositions[base + 4] = wy - 0.72;
        this.rainPositions[base + 5] = wz - 0.14;
      }
      this.rainGeo.attributes.position.needsUpdate = true;
    }
  }

  dispose() {
    this.smokeMesh.dispose();
    this.sparksMesh.dispose();
    this.embersMesh.dispose();
    this.scene.remove(
      this.smokeMesh,
      this.sparksMesh,
      this.embersMesh,
      this.skidMesh,
      this.windRibbonMesh,
      this.machConeMesh,
      this.sonicRing,
      this.speedLines,
      this.rainLines,
      this.headlightGroup,
      this.nitroGroup
    );
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables.length = 0;
  }
}
