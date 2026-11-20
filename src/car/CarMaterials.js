import * as THREE from 'three';

/**
 * Procedural texture generator & physical material builder for vehicles.
 * Enforces Rule #7: SRGBColorSpace on color/albedo/emissive CanvasTextures,
 * NoColorSpace on bump/roughness data maps.
 */

let sharedTextures = null;

function createMicroFlakeRoughnessMap() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;

  // Deterministic simple hash for crisp metallic micro-flakes
  let s = 918273;
  for (let i = 0; i < data.length; i += 4) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const v = 46 + ((s >>> 24) & 31); // subtle roughness variation ~0.18..0.30
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function createCarbonMaps() {
  const size = 128;
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const actx = albedoCanvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext('2d');

  const cell = 8;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const diag = ((x / cell + y / cell) & 1) === 0;
      actx.fillStyle = diag ? '#171b22' : '#252b35';
      actx.fillRect(x, y, cell, cell);
      actx.fillStyle = diag ? '#1e242e' : '#12151b';
      actx.fillRect(x + 1, y + 1, cell - 2, cell - 2);

      bctx.fillStyle = diag ? '#b8b8b8' : '#585858';
      bctx.fillRect(x, y, cell, cell);
    }
  }

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(8, 8);
  map.colorSpace = THREE.SRGBColorSpace;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(8, 8);
  bumpMap.colorSpace = THREE.NoColorSpace;

  return { map, bumpMap };
}

function createTireTextures(isRally = false) {
  const size = 512;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext('2d');

  // Base matte rubber
  ctx.fillStyle = '#181b20';
  ctx.fillRect(0, 0, size, size);
  bctx.fillStyle = '#909090';
  bctx.fillRect(0, 0, size, size);

  // Sidewall bands: v in [0..0.33] and [0.67..1.0]
  const drawSidewall = (yStart, yEnd) => {
    const midY = (yStart + yEnd) * 0.5;
    ctx.fillStyle = '#15181d';
    ctx.fillRect(0, yStart, size, yEnd - yStart);

    // Circumferential sidewall rib rings
    ctx.strokeStyle = '#262b34';
    ctx.lineWidth = 3;
    for (const frac of [0.28, 0.5, 0.72]) {
      const yy = yStart + (yEnd - yStart) * frac;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(size, yy);
      ctx.stroke();

      bctx.strokeStyle = '#c8c8c8';
      bctx.lineWidth = 4;
      bctx.beginPath();
      bctx.moveTo(0, yy);
      bctx.lineTo(size, yy);
      bctx.stroke();
    }

    // Crisp sidewall lettering along circumference
    ctx.save();
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 16px sans-serif';
    ctx.textBaseline = 'middle';
    const label = isRally ? 'APEX GRAVEL-X  //  235/65 R16' : 'APEX SPORT R  //  305/30 ZR20';
    ctx.fillText(label, 24, midY);
    ctx.fillText(label, 280, midY);
    ctx.restore();
  };

  drawSidewall(0, Math.floor(size * 0.31));
  drawSidewall(Math.floor(size * 0.69), size);

  // Tread zone: y in [0.31*size .. 0.69*size]
  const tTop = Math.floor(size * 0.31);
  const tBot = Math.floor(size * 0.69);
  const tH = tBot - tTop;

  ctx.fillStyle = '#1f2329';
  ctx.fillRect(0, tTop, size, tH);
  bctx.fillStyle = '#d4d4d4';
  bctx.fillRect(0, tTop, size, tH);

  // Main circumferential rain grooves
  const grooveOffsets = isRally ? [0.22, 0.5, 0.78] : [0.24, 0.42, 0.58, 0.76];
  for (const g of grooveOffsets) {
    const gy = tTop + tH * g;
    ctx.fillStyle = '#0c0e12';
    ctx.fillRect(0, gy - 4, size, 8);
    bctx.fillStyle = '#242424';
    bctx.fillRect(0, gy - 4, size, 8);
  }

  // Directional angled tread sipes / rally lugs
  const stepX = isRally ? 26 : 18;
  for (let x = 0; x < size; x += stepX) {
    ctx.strokeStyle = '#0d0f13';
    ctx.lineWidth = isRally ? 7 : 4;
    bctx.strokeStyle = '#202020';
    bctx.lineWidth = isRally ? 8 : 5;

    // Upper half chevron
    ctx.beginPath();
    ctx.moveTo(x, tTop + 4);
    ctx.lineTo(x + stepX * 0.75, tTop + tH * 0.46);
    ctx.stroke();
    bctx.beginPath();
    bctx.moveTo(x, tTop + 4);
    bctx.lineTo(x + stepX * 0.75, tTop + tH * 0.46);
    bctx.stroke();

    // Lower half chevron
    ctx.beginPath();
    ctx.moveTo(x, tBot - 4);
    ctx.lineTo(x + stepX * 0.75, tTop + tH * 0.54);
    ctx.stroke();
    bctx.beginPath();
    bctx.moveTo(x, tBot - 4);
    bctx.lineTo(x + stepX * 0.75, tTop + tH * 0.54);
    bctx.stroke();
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.repeat.set(3, 1);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.ClampToEdgeWrapping;
  bumpMap.repeat.set(3, 1);
  bumpMap.colorSpace = THREE.NoColorSpace;

  return { map, bumpMap };
}

function createBrakeRotorTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;

  ctx.fillStyle = '#9aa3af';
  ctx.fillRect(0, 0, size, size);

  // Radial brushed steel sheen
  for (let r = 36; r < 124; r += 3) {
    ctx.strokeStyle = r % 6 === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(30,36,44,0.16)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Inner hat
  ctx.fillStyle = '#2b323d';
  ctx.beginPath();
  ctx.arc(cx, cy, 44, 0, Math.PI * 2);
  ctx.fill();

  // Cross-drilled holes & machined slots
  for (let i = 0; i < 16; i++) {
    const baseAngle = (i / 16) * Math.PI * 2;
    for (let j = 0; j < 3; j++) {
      const a = baseAngle + j * 0.08;
      const r = 64 + j * 18;
      ctx.fillStyle = '#181c22';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (i % 2 === 0) {
      ctx.strokeStyle = '#363f4c';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(baseAngle - 0.1) * 56, cy + Math.sin(baseAngle - 0.1) * 56);
      ctx.lineTo(cx + Math.cos(baseAngle + 0.15) * 116, cy + Math.sin(baseAngle + 0.15) * 116);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createHoneycombGrilleTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#07090d';
  ctx.fillRect(0, 0, size, size);

  const hexR = 10;
  const dx = hexR * 1.732;
  const dy = hexR * 1.5;
  ctx.strokeStyle = '#2c3442';
  ctx.lineWidth = 2.2;

  for (let row = -1; row < size / dy + 2; row++) {
    for (let col = -1; col < size / dx + 2; col++) {
      const cx = col * dx + (row % 2 ? dx * 0.5 : 0);
      const cy = row * dy;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const ang = (Math.PI / 3) * k + Math.PI / 6;
        const px = cx + Math.cos(ang) * (hexR - 1.2);
        const py = cy + Math.sin(ang) * (hexR - 1.2);
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createLicensePlateTexture(text = 'APEX-01') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 256, 64);

  // Left blue EU/racing badge strip
  ctx.fillStyle = '#1d4ed8';
  ctx.fillRect(4, 4, 28, 56);
  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('AR', 18, 38);

  // Border
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 252, 60);

  // Plate characters
  ctx.fillStyle = '#0f172a';
  ctx.font = '900 34px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 144, 34);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createDashboardGaugeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#080c14';
  ctx.fillRect(0, 0, 512, 160);

  const drawDial = (cx, cy, r, accent, label) => {
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25);
    ctx.stroke();

    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 6, Math.PI * 0.8, Math.PI * 1.85);
    ctx.stroke();

    // Tick marks
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
      ctx.strokeStyle = i >= 8 ? '#ef4444' : '#e2e8f0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14));
      ctx.lineTo(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3));
      ctx.stroke();
    }

    // Needle
    ctx.strokeStyle = '#ff5722';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(Math.PI * 1.45) * (r - 12), cy + Math.sin(Math.PI * 1.45) * (r - 12));
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, cy + r * 0.58);
  };

  drawDial(110, 82, 56, '#00e5ff', 'RPM x1000');
  drawDial(402, 82, 56, '#38bdf8', 'KM/H');

  // Center telemetry screen
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(195, 28, 122, 104);
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(195, 28, 122, 104);
  ctx.fillStyle = '#00e5ff';
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('APEX-OS', 256, 60);
  ctx.fillStyle = '#22c55e';
  ctx.font = 'bold 14px monospace';
  ctx.fillText('TRACK READY', 256, 92);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createWindshieldBannerTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0c1018';
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, 88, 512, 8);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'italic 900 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CORSA GT2', 256, 46);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createTricoloreTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#16a34a';
  ctx.fillRect(0, 0, 86, 32);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(86, 0, 84, 32);
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(170, 0, 86, 32);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function getSharedCarTextures() {
  if (!sharedTextures) {
    const carbon = createCarbonMaps();
    const streetTire = createTireTextures(false);
    const rallyTire = createTireTextures(true);
    sharedTextures = {
      microFlakeRoughness: createMicroFlakeRoughnessMap(),
      carbonMap: carbon.map,
      carbonBump: carbon.bumpMap,
      streetTireMap: streetTire.map,
      streetTireBump: streetTire.bumpMap,
      rallyTireMap: rallyTire.map,
      rallyTireBump: rallyTire.bumpMap,
      brakeRotorMap: createBrakeRotorTexture(),
      grilleMap: createHoneycombGrilleTexture(),
      licensePlateMap: createLicensePlateTexture('APEX-01'),
      dashboardMap: createDashboardGaugeTexture(),
      windshieldBannerMap: createWindshieldBannerTexture(),
      tricoloreMap: createTricoloreTexture(),
    };
  }
  return sharedTextures;
}

export function disposeSharedCarTextures() {
  if (!sharedTextures) return;
  for (const tex of Object.values(sharedTextures)) {
    tex?.dispose();
  }
  sharedTextures = null;
}

/**
 * Create the complete PBR material set for a car instance.
 * @param {object} spec Car specification from CarCatalog
 * @param {number} [paintHex]
 */
export function createCarMaterialSet(spec, paintHex = spec.defaultPaint) {
  const tex = getSharedCarTextures();
  const isRally = spec.styling.archetype === 'rally';

  const paint = new THREE.MeshPhysicalMaterial({
    color: paintHex,
    metalness: 0.72,
    roughness: 0.21,
    roughnessMap: tex.microFlakeRoughness,
    clearcoat: 1.0,
    clearcoatRoughness: 0.032,
    reflectivity: 1.0,
    envMapIntensity: 1.68,
  });

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0a1520,
    metalness: 0.10,
    roughness: 0.03,
    clearcoat: 1.0,
    clearcoatRoughness: 0.025,
    reflectivity: 1.0,
    transparent: true,
    opacity: 0.34,
    envMapIntensity: 2.1,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const carbon = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: tex.carbonMap,
    bumpMap: tex.carbonBump,
    bumpScale: 0.008,
    roughness: 0.28,
    metalness: 0.30,
    clearcoat: 0.88,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.45,
  });

  const wheelWell = new THREE.MeshStandardMaterial({
    color: 0x090b0f,
    roughness: 0.94,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });

  const trimDark = new THREE.MeshStandardMaterial({
    color: 0x161a22,
    roughness: 0.55,
    metalness: 0.25,
  });

  const chrome = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    metalness: 0.94,
    roughness: 0.12,
    envMapIntensity: 1.5,
  });

  const rim = new THREE.MeshStandardMaterial({
    color: spec.styling.rimColor,
    metalness: 0.88,
    roughness: 0.2,
    envMapIntensity: 1.4,
  });

  const tire = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: isRally ? tex.rallyTireMap : tex.streetTireMap,
    bumpMap: isRally ? tex.rallyTireBump : tex.streetTireBump,
    bumpScale: isRally ? 0.018 : 0.01,
    roughness: 0.82,
    metalness: 0.05,
  });

  const rotor = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: tex.brakeRotorMap,
    metalness: 0.82,
    roughness: 0.3,
    envMapIntensity: 1.2,
  });

  const caliper = new THREE.MeshStandardMaterial({
    color: spec.caliperColor,
    metalness: 0.4,
    roughness: 0.32,
  });

  const grille = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: tex.grilleMap,
    roughness: 0.65,
    metalness: 0.3,
  });

  const headlight = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    emissive: 0xe0f2fe,
    emissiveIntensity: 2.2,
    roughness: 0.15,
    metalness: 0.1,
  });

  const taillight = new THREE.MeshStandardMaterial({
    color: 0x991b1b,
    emissive: 0xff1e1e,
    emissiveIntensity: 1.2,
    roughness: 0.2,
    metalness: 0.1,
  });

  const interior = new THREE.MeshStandardMaterial({
    color: 0x1e242e,
    roughness: 0.84,
    metalness: 0.08,
  });

  const seatAccent = new THREE.MeshStandardMaterial({
    color: spec.caliperColor,
    roughness: 0.72,
    metalness: 0.08,
  });

  const dashboard = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: tex.dashboardMap,
    emissive: 0xffffff,
    emissiveMap: tex.dashboardMap,
    emissiveIntensity: 0.9,
    roughness: 0.35,
  });

  const plate = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: tex.licensePlateMap,
    roughness: 0.45,
    metalness: 0.1,
  });

  const exhaustInner = new THREE.MeshStandardMaterial({
    color: 0x050608,
    roughness: 0.95,
    metalness: 0.1,
  });

  const banner = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: tex.windshieldBannerMap,
    roughness: 0.25,
    metalness: 0.2,
    envMapIntensity: 1.2,
  });

  const tricolore = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: tex.tricoloreMap,
    roughness: 0.28,
    metalness: 0.25,
    clearcoat: 1.0,
    envMapIntensity: 1.4,
  });

  const materials = {
    paint,
    glass,
    carbon,
    wheelWell,
    trimDark,
    chrome,
    rim,
    tire,
    rotor,
    caliper,
    grille,
    headlight,
    taillight,
    interior,
    seatAccent,
    dashboard,
    plate,
    exhaustInner,
    banner,
    tricolore,
    dispose() {
      for (const [k, m] of Object.entries(this)) {
        if (k !== 'dispose' && m && typeof m.dispose === 'function') {
          m.dispose();
        }
      }
    },
  };

  return materials;
}
