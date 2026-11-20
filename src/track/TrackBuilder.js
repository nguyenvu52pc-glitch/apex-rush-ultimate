import * as THREE from 'three';

/**
 * Generates procedural 1024x1024 asphalt textures, gravel shoulders, beveled apex curbs,
 * continuous barriers + instanced posts, start/finish grid, and 5-pod countdown gantry.
 * Enforces Rule #6 (arc-length UVs, World-Up frames) and Rule #7 (SRGBColorSpace & >=0.015m layer offsets).
 */

function createAsphaltTextures(maxAnisotropy = 8) {
  const size = 1024;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext('2d');

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rctx = roughCanvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext('2d');

  // Base dark mineral asphalt
  ctx.fillStyle = '#23272e';
  ctx.fillRect(0, 0, size, size);
  rctx.fillStyle = '#cfcfcf';
  rctx.fillRect(0, 0, size, size);
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, size, size);

  // Fine mineral aggregate speckle (deterministic)
  let s = 48271;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };

  for (let i = 0; i < 48000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const w = 1 + rand() * 2.1;
    const shade = 24 + Math.floor(rand() * 38);
    ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 5})`;
    ctx.fillRect(x, y, w, w);

    const rShade = 165 + Math.floor(rand() * 75);
    rctx.fillStyle = `rgb(${rShade}, ${rShade}, ${rShade})`;
    rctx.fillRect(x, y, w, w);

    const bShade = 68 + Math.floor(rand() * 124);
    bctx.fillStyle = `rgb(${bShade}, ${bShade}, ${bShade})`;
    bctx.fillRect(x, y, w, w);
  }

  // Subtle weathered longitudinal asphalt paving joints
  ctx.fillStyle = 'rgba(12, 15, 20, 0.25)';
  ctx.fillRect(size * 0.498, 0, 3, size);
  rctx.fillStyle = 'rgba(90, 90, 90, 0.28)';
  rctx.fillRect(size * 0.498, 0, 3, size);

  // Subtle darkened rubber tire racing lines near left/right track grooves
  const gradL = ctx.createLinearGradient(size * 0.22, 0, size * 0.42, 0);
  gradL.addColorStop(0, 'rgba(10,12,15,0)');
  gradL.addColorStop(0.5, 'rgba(10,12,15,0.38)');
  gradL.addColorStop(1, 'rgba(10,12,15,0)');
  ctx.fillStyle = gradL;
  ctx.fillRect(size * 0.22, 0, size * 0.2, size);

  const gradR = ctx.createLinearGradient(size * 0.58, 0, size * 0.78, 0);
  gradR.addColorStop(0, 'rgba(10,12,15,0)');
  gradR.addColorStop(0.5, 'rgba(10,12,15,0.38)');
  gradR.addColorStop(1, 'rgba(10,12,15,0)');
  ctx.fillStyle = gradR;
  ctx.fillRect(size * 0.58, 0, size * 0.2, size);

  // Slightly smoother rubbered grooves in roughness map
  rctx.fillStyle = 'rgba(110, 110, 110, 0.42)';
  rctx.fillRect(size * 0.27, 0, size * 0.1, size);
  rctx.fillRect(size * 0.63, 0, size * 0.1, size);

  // Crisp continuous white edge boundary lines
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(size * 0.025, 0, size * 0.018, size);
  ctx.fillRect(size * 0.957, 0, size * 0.018, size);

  // Subtle center dashed racing ticks
  ctx.fillStyle = 'rgba(226, 232, 240, 0.38)';
  for (let y = 24; y < size; y += 128) {
    ctx.fillRect(size * 0.494, y, size * 0.012, 56);
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.ClampToEdgeWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.anisotropy = maxAnisotropy;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.ClampToEdgeWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.anisotropy = maxAnisotropy;

  return { map, roughnessMap, bumpMap };
}

function createBarrierTextures(isConcrete, maxAnisotropy = 8) {
  const w = 256;
  const h = 128;
  const cCanvas = document.createElement('canvas');
  cCanvas.width = w;
  cCanvas.height = h;
  const ctx = cCanvas.getContext('2d');

  const bCanvas = document.createElement('canvas');
  bCanvas.width = w;
  bCanvas.height = h;
  const bctx = bCanvas.getContext('2d');

  if (isConcrete) {
    ctx.fillStyle = '#8b95a5';
    ctx.fillRect(0, 0, w, h);
    bctx.fillStyle = '#808080';
    bctx.fillRect(0, 0, w, h);
    // Vertical expansion seams & red-white corner paint trim band at top
    ctx.fillStyle = '#64748b';
    ctx.fillRect(0, 0, 5, h);
    ctx.fillRect(128, 0, 4, h);
    bctx.fillStyle = '#303030';
    bctx.fillRect(0, 0, 5, h);
    bctx.fillRect(128, 0, 4, h);
    // Subtle weathering streak at lower base
    const grad = ctx.createLinearGradient(0, h * 0.55, 0, h);
    grad.addColorStop(0, 'rgba(30,41,59,0)');
    grad.addColorStop(1, 'rgba(15,23,42,0.45)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);
  } else {
    // Metallic W-beam Armco corrugated steel guardrail
    const steelGrad = ctx.createLinearGradient(0, 0, 0, h);
    steelGrad.addColorStop(0.0, '#cbd5e1');
    steelGrad.addColorStop(0.25, '#64748b');
    steelGrad.addColorStop(0.50, '#e2e8f0');
    steelGrad.addColorStop(0.75, '#64748b');
    steelGrad.addColorStop(1.0, '#94a3b8');
    ctx.fillStyle = steelGrad;
    ctx.fillRect(0, 0, w, h);

    const bumpGrad = ctx.createLinearGradient(0, 0, 0, h);
    bumpGrad.addColorStop(0.0, '#d8d8d8');
    bumpGrad.addColorStop(0.25, '#404040');
    bumpGrad.addColorStop(0.50, '#eaeaea');
    bumpGrad.addColorStop(0.75, '#404040');
    bumpGrad.addColorStop(1.0, '#b0b0b0');
    bctx.fillStyle = bumpGrad;
    bctx.fillRect(0, 0, w, h);

    // Bolt splice joints
    ctx.fillStyle = '#475569';
    ctx.fillRect(126, 12, 4, h - 24);
  }

  const map = new THREE.CanvasTexture(cCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy;

  const bumpMap = new THREE.CanvasTexture(bCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.anisotropy = maxAnisotropy;

  return { map, bumpMap };
}

function createShoulderTexture(maxAnisotropy = 8) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#47433c';
  ctx.fillRect(0, 0, size, size);

  let s = 19283;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let i = 0; i < 6500; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 1 + rand() * 2.5;
    const g = 55 + Math.floor(rand() * 48);
    ctx.fillStyle = `rgb(${g + 6}, ${g + 2}, ${g - 6})`;
    ctx.fillRect(x, y, r, r);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createCurbTexture(maxAnisotropy = 8) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#dc2626';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 128, 128, 128);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createStartFinishTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  const cols = 16;
  const rows = 4;
  const cw = canvas.width / cols;
  const ch = canvas.height / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f8fafc' : '#0f172a';
      ctx.fillRect(c * cw, r * ch, cw, ch);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createGantryBannerTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(0.5, '#1e293b');
  grad.addColorStop(1, '#0f172a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 192);

  ctx.fillStyle = '#ff5722';
  ctx.fillRect(0, 0, 1024, 14);
  ctx.fillRect(0, 178, 1024, 14);

  ctx.fillStyle = '#f8fafc';
  ctx.font = '900 74px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('APEX RUSH: ULTIMATE', 512, 98);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Build a ribbon BufferGeometry along TrackData samples using custom cross-section offsets.
 * Profile entries: `{ latFactor, latConst, upOffset, uCoord }`
 * Wait: lateral pos = frame.position + frame.right * latOffset + frame.up * upOffset
 */
function buildStripGeometry(samples, totalLength, tileLength, profilePoints, closedLoop = true, skipGap = false) {
  const N = samples.length;
  const ringCount = closedLoop ? N + 1 : N;
  const cols = profilePoints.length;

  const positions = new Float32Array(ringCount * cols * 3);
  const uvs = new Float32Array(ringCount * cols * 2);
  const indices = [];

  for (let r = 0; r < ringCount; r++) {
    const sample = samples[r % N];
    const arc = r === N ? totalLength : sample.arcLength;
    const v = arc / tileLength;

    for (let c = 0; c < cols; c++) {
      const p = profilePoints[c];
      const lat = p.lat;
      const upOff = p.up;
      const idx3 = (r * cols + c) * 3;
      const idx2 = (r * cols + c) * 2;

      positions[idx3 + 0] = sample.position.x + sample.right.x * lat + sample.up.x * upOff;
      positions[idx3 + 1] = sample.position.y + sample.right.y * lat + sample.up.y * upOff;
      positions[idx3 + 2] = sample.position.z + sample.right.z * lat + sample.up.z * upOff;

      uvs[idx2 + 0] = p.u;
      uvs[idx2 + 1] = v;
    }
  }

  for (let r = 0; r < ringCount - 1; r++) {
    if (skipGap && samples[r % N].isGapSegment) continue;
    for (let c = 0; c < cols - 1; c++) {
      const i00 = r * cols + c;
      const i10 = (r + 1) * cols + c;
      const i01 = i00 + 1;
      const i11 = i10 + 1;
      // Top-facing CCW winding with frame.right (+right) and frame.tangent (+Z)
      // (i01 - i00) = +right, (i10 - i00) = +tangent; cross(+tangent, +right) = +up -> (i00, i10, i01)
      indices.push(i00, i10, i01);
      indices.push(i01, i10, i11);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Build beveled apex curbs wherever |curvature| exceeds threshold.
 */
function buildApexCurbsGeometry(trackData) {
  const samples = trackData.samples;
  const N = samples.length;
  const halfW = trackData.trackHalfWidth;
  const positions = [];
  const uvs = [];
  const indices = [];

  const curbThreshold = 0.0048;
  const tileLen = 3.0;
  let vertOffset = 0;

  for (const sideSign of [-1, 1]) {
    // sideSign = -1 is left (-right), +1 is right (+right)
    // Place curb on inside apex when turning toward this side, or outside exit
    let activeRun = [];

    const flushRun = (run) => {
      if (run.length < 3) return;
      const cols = 4;
      const wInner = sideSign * (halfW - 0.12);
      const wPeak1 = sideSign * (halfW + 0.14);
      const wPeak2 = sideSign * (halfW + 0.52);
      const wOuter = sideSign * (halfW + 0.78);
      const profile = [
        { lat: wInner, up: 0.002, u: 0 },
        { lat: wPeak1, up: 0.024, u: 0.35 },
        { lat: wPeak2, up: 0.024, u: 0.75 },
        { lat: wOuter, up: -0.004, u: 1 },
      ];
      if (sideSign < 0) profile.reverse();

      for (let r = 0; r < run.length; r++) {
        const s = run[r];
        const v = s.arcLength / tileLen;
        for (let c = 0; c < cols; c++) {
          const p = profile[c];
          positions.push(
            s.position.x + s.right.x * p.lat + s.up.x * p.up,
            s.position.y + s.right.y * p.lat + s.up.y * p.up,
            s.position.z + s.right.z * p.lat + s.up.z * p.up
          );
          uvs.push(p.u, v);
        }
      }

      for (let r = 0; r < run.length - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const i00 = vertOffset + r * cols + c;
          const i10 = vertOffset + (r + 1) * cols + c;
          const i01 = i00 + 1;
          const i11 = i10 + 1;
          indices.push(i00, i10, i01);
          indices.push(i01, i10, i11);
        }
      }
      vertOffset += run.length * cols;
    };

    for (let i = 0; i < N; i++) {
      const s = samples[i];
      // Left turn = curvature > 0 (inside is left = sideSign -1). Right turn = curvature < 0 (inside is right = sideSign +1).
      const isApex = (sideSign < 0 && s.curvature > curbThreshold) || (sideSign > 0 && s.curvature < -curbThreshold);
      if (isApex) {
        activeRun.push(s);
      } else {
        flushRun(activeRun);
        activeRun = [];
      }
    }
    flushRun(activeRun);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Build continuous roadside barrier meshes + InstancedMesh support posts.
 */
function buildBarriers(trackData, disposables, maxAniso = 8) {
  const group = new THREE.Group();
  const isConcrete = trackData.spec.barrierStyle === 'concrete';
  const offset = trackData.totalWidthHalf + 0.18;
  const tileLen = 10;

  const barrierTex = createBarrierTextures(isConcrete, maxAniso);
  const railMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: barrierTex.map,
    bumpMap: barrierTex.bumpMap,
    bumpScale: isConcrete ? 0.025 : 0.04,
    roughness: isConcrete ? 0.78 : 0.30,
    metalness: isConcrete ? 0.08 : 0.80,
    side: THREE.DoubleSide,
  });
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.55,
    metalness: 0.7,
  });
  disposables.push(barrierTex.map, barrierTex.bumpMap, railMat, postMat);

  for (const s of [-1, 1]) {
    const profile = isConcrete
      ? [
          { lat: s * (offset - 0.1), up: -0.25, u: 0 },
          { lat: s * offset, up: 1.05, u: 0.4 },
          { lat: s * (offset + 0.45), up: 1.05, u: 0.7 },
          { lat: s * (offset + 0.55), up: -0.25, u: 1 },
        ]
      : [
          { lat: s * offset, up: 0.42, u: 0 },
          { lat: s * offset, up: 0.88, u: 0.5 },
          { lat: s * (offset + 0.14), up: 0.88, u: 0.75 },
          { lat: s * (offset + 0.14), up: 0.42, u: 1 },
        ];
    if (s < 0) profile.reverse();

    const geo = buildStripGeometry(trackData.samples, trackData.totalLength, tileLen, profile, true, true);
    disposables.push(geo);
    const mesh = new THREE.Mesh(geo, railMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Instanced support posts every ~5.5m
  const postInterval = 5.5;
  const postCountPerSide = Math.floor(trackData.totalLength / postInterval);
  const totalPosts = postCountPerSide * 2;
  const postGeo = new THREE.BoxGeometry(0.14, 1.0, 0.14);
  disposables.push(postGeo);

  const postsInst = new THREE.InstancedMesh(postGeo, postMat, totalPosts);
  postsInst.castShadow = true;
  postsInst.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const frame = trackData.getFrameAt(0);
  const basisMat = new THREE.Matrix4();
  const leftVec = new THREE.Vector3();
  let idx = 0;

  for (let i = 0; i < postCountPerSide; i++) {
    const u = i / postCountPerSide;
    trackData.getFrameAt(u, frame);
    if (frame.isGapSegment) continue;
    leftVec.copy(frame.right).negate();
    basisMat.makeBasis(leftVec, frame.up, frame.tangent);

    for (const s of [-1, 1]) {
      dummy.position
        .copy(frame.position)
        .addScaledVector(frame.right, s * (offset + 0.12))
        .addScaledVector(frame.up, 0.45);
      dummy.quaternion.setFromRotationMatrix(basisMat);
      dummy.updateMatrix();
      postsInst.setMatrixAt(idx++, dummy.matrix);
    }
  }
  postsInst.count = idx;
  postsInst.instanceMatrix.needsUpdate = true;
  group.add(postsInst);

  // Subtle glowing roadside barrier reflector studs every ~11m for intense corner speed perception
  const refSpacing = 11.0;
  const refCountPerSide = Math.floor(trackData.totalLength / refSpacing);
  const refGeo = new THREE.BoxGeometry(0.06, 0.10, 0.18);
  const refMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: isConcrete ? 0x38bdf8 : 0xf97316,
    emissiveIntensity: 2.2,
    roughness: 0.25,
  });
  disposables.push(refGeo, refMat);
  const refInst = new THREE.InstancedMesh(refGeo, refMat, refCountPerSide * 2);
  let rIdx = 0;
  for (let i = 0; i < refCountPerSide; i++) {
    const u = i / refCountPerSide;
    trackData.getFrameAt(u, frame);
    if (frame.isGapSegment) continue;
    leftVec.copy(frame.right).negate();
    basisMat.makeBasis(leftVec, frame.up, frame.tangent);
    for (const s of [-1, 1]) {
      dummy.position
        .copy(frame.position)
        .addScaledVector(frame.right, s * (offset - 0.02))
        .addScaledVector(frame.up, isConcrete ? 1.08 : 0.76);
      dummy.quaternion.setFromRotationMatrix(basisMat);
      dummy.updateMatrix();
      refInst.setMatrixAt(rIdx++, dummy.matrix);
    }
  }
  refInst.count = rIdx;
  refInst.instanceMatrix.needsUpdate = true;
  group.add(refInst);

  return group;
}

/**
 * Build Start/Finish checkerboard, staggered 2x4 grid boxes, and 5-pod countdown gantry.
 */
function buildStartLineAndGantry(trackData, disposables) {
  const group = new THREE.Group();
  const frame = trackData.getFrameAt(0);
  const leftVec = frame.right.clone().negate();
  const basis = new THREE.Matrix4().makeBasis(leftVec, frame.up, frame.tangent);
  const startQuat = new THREE.Quaternion().setFromRotationMatrix(basis);

  // 1. Start/Finish Checkerboard (Rule #7: +0.022m vertical offset + polygonOffset)
  const sfTex = createStartFinishTexture();
  const sfGeo = new THREE.PlaneGeometry(trackData.trackWidth * 0.94, 3.2);
  sfGeo.rotateX(-Math.PI / 2);
  const sfMat = new THREE.MeshStandardMaterial({
    map: sfTex,
    roughness: 0.65,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  disposables.push(sfTex, sfGeo, sfMat);

  const sfMesh = new THREE.Mesh(sfGeo, sfMat);
  sfMesh.position.copy(frame.position).addScaledVector(frame.up, 0.022);
  sfMesh.quaternion.copy(startQuat);
  sfMesh.receiveShadow = true;
  group.add(sfMesh);

  // 2. Staggered 2x4 Grid Slot Box Markings (+0.018m above asphalt)
  const slotGeo = new THREE.RingGeometry(1.15, 1.32, 4);
  slotGeo.rotateZ(Math.PI / 4);
  slotGeo.rotateX(-Math.PI / 2);
  const slotMat = new THREE.MeshBasicMaterial({
    color: 0xf8fafc,
    transparent: true,
    opacity: 0.72,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  disposables.push(slotGeo, slotMat);

  const gFrame = trackData.getFrameAt(0);
  const gLeft = new THREE.Vector3();
  const gMat = new THREE.Matrix4();
  for (const slot of trackData.startingGrid) {
    trackData.getFrameAt(slot.u, gFrame);
    gLeft.copy(gFrame.right).negate();
    gMat.makeBasis(gLeft, gFrame.up, gFrame.tangent);
    const box = new THREE.Mesh(slotGeo, slotMat);
    box.position.set(slot.position.x, slot.position.y, slot.position.z);
    // Project down onto track surface + 0.018m
    box.position.addScaledVector(gFrame.up, -0.30);
    box.quaternion.setFromRotationMatrix(gMat);
    box.scale.set(1.2, 1, 2.2);
    group.add(box);
  }

  // 3. Start/Finish Gantry Arch + 5 Countdown Light Pods
  const gantryGroup = new THREE.Group();
  gantryGroup.position.copy(frame.position);
  gantryGroup.quaternion.copy(startQuat);

  const spanW = trackData.trackWidth + 2.8;
  const archH = 6.2;
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.75, roughness: 0.35 });
  const bannerTex = createGantryBannerTexture();
  const bannerMat = new THREE.MeshStandardMaterial({
    map: bannerTex,
    emissive: 0xffffff,
    emissiveMap: bannerTex,
    emissiveIntensity: 0.35,
    roughness: 0.4,
  });
  disposables.push(steelMat, bannerTex, bannerMat);

  const colGeo = new THREE.BoxGeometry(0.65, archH, 0.85);
  const beamGeo = new THREE.BoxGeometry(spanW + 0.7, 0.75, 0.9);
  const signGeo = new THREE.BoxGeometry(spanW * 0.78, 1.35, 0.25);
  disposables.push(colGeo, beamGeo, signGeo);

  for (const s of [-1, 1]) {
    const col = new THREE.Mesh(colGeo, steelMat);
    col.position.set(s * spanW * 0.5, archH * 0.5, 0);
    col.castShadow = true;
    gantryGroup.add(col);
  }

  const beam = new THREE.Mesh(beamGeo, steelMat);
  beam.position.set(0, archH, 0);
  beam.castShadow = true;
  gantryGroup.add(beam);

  const sign = new THREE.Mesh(signGeo, bannerMat);
  sign.position.set(0, archH + 0.25, 0);
  gantryGroup.add(sign);

  // 5 Countdown Light Pods facing the grid (-Z)
  const podHousingGeo = new THREE.BoxGeometry(4.6, 0.72, 0.35);
  const podMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.4 });
  const lampGeo = new THREE.CircleGeometry(0.22, 18);
  disposables.push(podHousingGeo, podMat, lampGeo);

  const housing = new THREE.Mesh(podHousingGeo, podMat);
  housing.position.set(0, archH - 0.65, -0.45);
  gantryGroup.add(housing);

  const gantryLights = [];
  for (let i = 0; i < 5; i++) {
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      emissive: 0x000000,
      emissiveIntensity: 0,
      roughness: 0.2,
    });
    disposables.push(lampMat);

    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(-1.6 + i * 0.8, archH - 0.65, -0.64);
    lamp.rotation.y = Math.PI; // Face backward toward starting grid (-Z)
    gantryGroup.add(lamp);
    gantryLights.push(lampMat);
  }

  group.add(gantryGroup);
  return { group, gantryLights };
}

function createJumpChevronTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);

  // Double neon sky-jump arrow chevron pointing +Z forward
  const drawChevron = (yOffset, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 22;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(42, yOffset + 64);
    ctx.lineTo(128, yOffset + 12);
    ctx.lineTo(214, yOffset + 64);
    ctx.stroke();
  };
  drawChevron(26, '#00e5ff');
  drawChevron(122, '#ffab00');

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Build V2 sky-jump bridge piers, retaining walls beneath launch & landing lips,
 * flanking illuminated strobe gates, and emissive pavement launch chevrons.
 */
function buildJumpStructures(trackData, disposables) {
  const group = new THREE.Group();
  if (!trackData.jumpZones || trackData.jumpZones.length === 0) return group;

  const pierW = trackData.totalWidthHalf * 2 + 1.4;
  const deckLipGeo = new THREE.BoxGeometry(pierW, 1.4, 2.2);
  const pierColGeo = new THREE.BoxGeometry(3.2, 24.0, 2.8);
  const crossBeamGeo = new THREE.BoxGeometry(pierW - 1.5, 1.0, 1.6);
  const beaconPoleGeo = new THREE.CylinderGeometry(0.14, 0.20, 4.6, 8);
  const beaconLampGeo = new THREE.BoxGeometry(0.45, 1.5, 0.45);
  const chevronGeo = new THREE.PlaneGeometry(7.6, 5.2);
  chevronGeo.rotateX(-Math.PI / 2);

  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.78,
    metalness: 0.20,
  });
  const hazardMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xd97706,
    emissiveIntensity: 0.8,
    roughness: 0.4,
  });
  const cyanLampMat = new THREE.MeshStandardMaterial({
    color: 0xe0f2fe,
    emissive: 0x00e5ff,
    emissiveIntensity: 3.4,
    roughness: 0.2,
  });
  const goldLampMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: 0xff8c00,
    emissiveIntensity: 3.4,
    roughness: 0.2,
  });
  const chevronTex = createJumpChevronTexture();
  const chevronMat = new THREE.MeshBasicMaterial({
    map: chevronTex,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  disposables.push(
    deckLipGeo,
    pierColGeo,
    crossBeamGeo,
    beaconPoleGeo,
    beaconLampGeo,
    chevronGeo,
    concreteMat,
    hazardMat,
    cyanLampMat,
    goldLampMat,
    chevronTex,
    chevronMat
  );

  const leftVec = new THREE.Vector3();
  const basisMat = new THREE.Matrix4();
  const lipQuat = new THREE.Quaternion();
  const wingLat = trackData.totalWidthHalf + 0.55;

  for (const jz of trackData.jumpZones) {
    // 1. Retaining piers & glowing beacon towers at both takeoff lip & landing catch deck
    const anchors = [
      { s: trackData.samples[jz.takeoffIdx], lampMat: goldLampMat, isTakeoff: true },
      { s: trackData.samples[jz.gapEndIdx], lampMat: cyanLampMat, isTakeoff: false },
    ];

    for (const { s, lampMat, isTakeoff } of anchors) {
      leftVec.copy(s.right).negate();
      basisMat.makeBasis(leftVec, s.up, s.tangent);
      lipQuat.setFromRotationMatrix(basisMat);

      const deckLip = new THREE.Mesh(deckLipGeo, hazardMat);
      deckLip.position
        .copy(s.position)
        .addScaledVector(s.up, -0.72)
        .addScaledVector(s.tangent, isTakeoff ? -0.95 : 0.95);
      deckLip.quaternion.copy(lipQuat);
      deckLip.castShadow = true;
      deckLip.receiveShadow = true;
      group.add(deckLip);

      const beam = new THREE.Mesh(crossBeamGeo, concreteMat);
      beam.position
        .copy(s.position)
        .addScaledVector(s.up, -4.5)
        .addScaledVector(s.tangent, isTakeoff ? -0.95 : 0.95);
      beam.quaternion.copy(lipQuat);
      group.add(beam);

      for (const side of [-1, 0, 1]) {
        const col = new THREE.Mesh(pierColGeo, concreteMat);
        col.position
          .copy(s.position)
          .addScaledVector(s.right, side * (trackData.trackHalfWidth * 0.72))
          .addScaledVector(s.tangent, isTakeoff ? -1.1 : 1.1);
        col.position.y -= 12.6;
        col.receiveShadow = true;
        group.add(col);
      }

      for (const side of [-1, 1]) {
        const pole = new THREE.Mesh(beaconPoleGeo, concreteMat);
        pole.position
          .copy(s.position)
          .addScaledVector(s.right, side * wingLat)
          .addScaledVector(s.up, 2.3);
        pole.castShadow = true;
        group.add(pole);

        const lamp = new THREE.Mesh(beaconLampGeo, lampMat);
        lamp.position
          .copy(s.position)
          .addScaledVector(s.right, side * wingLat)
          .addScaledVector(s.up, 4.4);
        lamp.quaternion.copy(lipQuat);
        group.add(lamp);
      }
    }

    // 2. Glowing animated-style Chevron Arrows on climb ramp surface
    const rampCount = 5;
    for (let k = 0; k < rampCount; k++) {
      const idx = Math.round(THREE.MathUtils.lerp(jz.rampStartIdx + 2, jz.takeoffIdx - 1, k / (rampCount - 1)));
      const s = trackData.samples[idx];
      if (!s) continue;
      leftVec.copy(s.right).negate();
      basisMat.makeBasis(leftVec, s.up, s.tangent);
      lipQuat.setFromRotationMatrix(basisMat);

      const chev = new THREE.Mesh(chevronGeo, chevronMat);
      chev.position.copy(s.position).addScaledVector(s.up, 0.032);
      chev.quaternion.copy(lipQuat);
      group.add(chev);
    }
  }

  return group;
}

/**
 * Construct full 3D track visuals from TrackData.
 * @param {import('./TrackData.js').TrackData} trackData
 * @param {THREE.WebGLRenderer} renderer
 */
export function buildTrackVisuals(trackData, renderer) {
  const disposables = [];
  const root = new THREE.Group();
  root.name = `track_${trackData.id}`;

  const maxAniso = renderer?.capabilities?.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 8;
  const halfW = trackData.trackHalfWidth;
  const shoulderW = trackData.shoulderWidth;
  const totalHalf = trackData.totalWidthHalf;

  // Seamless integer-repeat arc-length tiling
  const vRepeats = Math.max(1, Math.round(trackData.totalLength / 18));
  const asphaltTileLen = trackData.totalLength / vRepeats;

  // 1. Main Asphalt Surface with micro-aggregate bumpMap & rubber groove wear
  const { map: asphaltMap, roughnessMap: asphaltRough, bumpMap: asphaltBump } = createAsphaltTextures(maxAniso);
  const asphaltMat = new THREE.MeshStandardMaterial({
    map: asphaltMap,
    roughnessMap: asphaltRough,
    bumpMap: asphaltBump,
    bumpScale: 0.014,
    roughness: 0.85,
    metalness: 0.08,
  });
  disposables.push(asphaltMap, asphaltRough, asphaltBump, asphaltMat);

  const asphaltGeo = buildStripGeometry(
    trackData.samples,
    trackData.totalLength,
    asphaltTileLen,
    [
      { lat: -halfW, up: 0, u: 0 },
      { lat: 0, up: 0.012, u: 0.5 }, // subtle crown for natural drainage look
      { lat: halfW, up: 0, u: 1 },
    ],
    true,
    true
  );
  disposables.push(asphaltGeo);

  const asphaltMesh = new THREE.Mesh(asphaltGeo, asphaltMat);
  asphaltMesh.receiveShadow = true;
  root.add(asphaltMesh);

  // 2. Gravel / Run-off Shoulders + Bank Skirt (extending downward -6.8m so elevated ramps never float)
  const shoulderTex = createShoulderTexture(maxAniso);
  const shoulderMat = new THREE.MeshStandardMaterial({
    map: shoulderTex,
    roughness: 0.92,
    metalness: 0.04,
  });
  disposables.push(shoulderTex, shoulderMat);

  const shoulderTile = trackData.totalLength / Math.max(1, Math.round(trackData.totalLength / 8));
  for (const s of [-1, 1]) {
    const profile = [
      { lat: s * (halfW - 0.04), up: -0.008, u: 0 },
      { lat: s * totalHalf, up: -0.015, u: 1 },
      { lat: s * (totalHalf + 1.8), up: -6.8, u: 1.5 },
    ];
    if (s < 0) profile.reverse();
    const sGeo = buildStripGeometry(trackData.samples, trackData.totalLength, shoulderTile, profile, true, true);
    disposables.push(sGeo);
    const sMesh = new THREE.Mesh(sGeo, shoulderMat);
    sMesh.receiveShadow = true;
    root.add(sMesh);
  }

  // 3. Elevated-Edge Red/White Curbs on corners
  const curbTex = createCurbTexture(maxAniso);
  const curbMat = new THREE.MeshStandardMaterial({
    map: curbTex,
    roughness: 0.65,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const curbGeo = buildApexCurbsGeometry(trackData);
  disposables.push(curbTex, curbMat, curbGeo);
  const curbMesh = new THREE.Mesh(curbGeo, curbMat);
  curbMesh.receiveShadow = true;
  root.add(curbMesh);

  // 4. Guardrails / Concrete Barriers & Instanced Posts + Reflector Studs
  root.add(buildBarriers(trackData, disposables, maxAniso));

  // 5. V2 Jump Structures (piers, beacon pylons & illuminated ramp chevrons)
  if (trackData.jumpZones && trackData.jumpZones.length > 0) {
    root.add(buildJumpStructures(trackData, disposables));
  }

  // 6. Start/Finish Line, Grid Boxes & 5-Pod Gantry
  const { group: startGroup, gantryLights } = buildStartLineAndGantry(trackData, disposables);
  root.add(startGroup);

  return {
    root,
    asphaltMat,
    gantryLights,
    setAsphaltWetness(wetness) {
      const w = THREE.MathUtils.clamp(wetness, 0, 1);
      asphaltMat.roughness = THREE.MathUtils.lerp(0.85, 0.24, w);
      asphaltMat.metalness = THREE.MathUtils.lerp(0.08, 0.35, w);
      asphaltMat.envMapIntensity = THREE.MathUtils.lerp(1.0, 1.85, w);
    },
    setGantryLights(redCount = 0, greenGo = false) {
      for (let i = 0; i < gantryLights.length; i++) {
        const m = gantryLights[i];
        if (greenGo) {
          m.color.setHex(0x22c55e);
          m.emissive.setHex(0x22c55e);
          m.emissiveIntensity = 3.2;
        } else if (i < redCount) {
          m.color.setHex(0xef4444);
          m.emissive.setHex(0xff1a1a);
          m.emissiveIntensity = 3.2;
        } else {
          m.color.setHex(0x1e293b);
          m.emissive.setHex(0x000000);
          m.emissiveIntensity = 0;
        }
      }
    },
    dispose() {
      root.traverse((obj) => {
        if (obj.isInstancedMesh) obj.dispose();
      });
      for (const item of disposables) {
        item.dispose();
      }
    },
  };
}
