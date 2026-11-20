import * as THREE from 'three';
import { getCarSpec } from './CarCatalog.js';
import { createCarMaterialSet } from './CarMaterials.js';
import { createWheelMesh } from './WheelBuilder.js';
import { batchGroupByMaterial } from '../utils/meshBatcher.js';

/**
 * Procedural 3D Exotic Car & WRC Aero Model Builder:
 * - Lofts 24 longitudinal cross-sections with sculpted fender crowns, sunken S-duct hood channels,
 *   side-intake waist pinches, and recessed wheel-arch bays (Rule #1)
 * - Constructs inner dark wheel-well tubs + flush sculpted fender flares (Rule #1)
 * - Builds sharp cambered swept airfoils (Extrude / Lofted NACA profiles), dive-plane canards,
 *   splitter winglets, bargeboards, fender louvers, engine bay slats, shark-fin stabilizers,
 *   6-fin Venturi diffusers, and signature Y / L-blade / Quad-ring LED light clusters
 * - Attaches 4 clean-pivot wheels via WheelBuilder (Rule #2)
 * - Batches static chassis parts by material & exposes clean runtime & disposal API
 */

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

let sharedShadowTexture = null;
function getContactShadowTexture() {
  if (sharedShadowTexture) return sharedShadowTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 62);
  grad.addColorStop(0.0, 'rgba(4, 6, 10, 0.84)');
  grad.addColorStop(0.58, 'rgba(4, 6, 10, 0.48)');
  grad.addColorStop(0.84, 'rgba(4, 6, 10, 0.16)');
  grad.addColorStop(1.0, 'rgba(4, 6, 10, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedShadowTexture = tex;
  return tex;
}

/**
 * Compute invariant wheel-arch clearances per Rule #1.
 */
export function computeArchClearance(dim) {
  const archRadius = dim.wheelRadius + dim.maxSuspensionTravel + 0.068;
  const maxSteer = 0.56; // ~32 deg
  const steerInwardSweep =
    dim.wheelRadius * Math.sin(maxSteer) + (dim.wheelWidth * 0.5) * Math.cos(maxSteer);
  const xInnerTub = Math.max(0.32, dim.trackHalfWidth - steerInwardSweep - 0.045);
  return { archRadius, xInnerTub };
}

/**
 * Build 24 strictly monotonic longitudinal Z stations around rear/front arches, waist, and nose wedge.
 */
function buildStationZs(dim, archRadius) {
  const halfL = dim.length * 0.5;
  const rRear = dim.rearAxleZ;
  const rFront = dim.frontAxleZ;

  const rearBackOut = Math.max(-halfL + 0.14, rRear - archRadius * 1.05);
  const rearBackIn = rRear - archRadius * 0.90;
  const rearMidA = rRear - archRadius * 0.45;
  const rearMidB = rRear + archRadius * 0.45;
  const rearFrontIn = rRear + archRadius * 0.90;
  const rearFrontOut = rRear + archRadius * 1.05;

  const frontBackOut = rFront - archRadius * 1.05;
  const frontBackIn = rFront - archRadius * 0.90;
  const frontMidA = rFront - archRadius * 0.45;
  const frontMidB = rFront + archRadius * 0.45;
  const frontFrontIn = rFront + archRadius * 0.90;
  const frontFrontOut = Math.min(halfL - 0.16, rFront + archRadius * 1.05);

  const rearBevel = -halfL + (rearBackOut - (-halfL)) * 0.45;
  const midSpan = frontBackOut - rearFrontOut;
  const mid1 = rearFrontOut + midSpan * 0.22;
  const mid2 = rearFrontOut + midSpan * 0.45;
  const mid3 = rearFrontOut + midSpan * 0.68;
  const mid4 = rearFrontOut + midSpan * 0.88;

  const noseSpan = halfL - frontFrontOut;
  const nose1 = frontFrontOut + noseSpan * 0.34;
  const nose2 = frontFrontOut + noseSpan * 0.68;
  const nose3 = Math.max(nose2 + 0.015, halfL - 0.045);

  const stations = [
    -halfL,
    rearBevel,
    rearBackOut,
    rearBackIn,
    rearMidA,
    rRear,
    rearMidB,
    rearFrontIn,
    rearFrontOut,
    mid1,
    mid2,
    mid3,
    mid4,
    frontBackOut,
    frontBackIn,
    frontMidA,
    rFront,
    frontMidB,
    frontFrontIn,
    frontFrontOut,
    nose1,
    nose2,
    nose3,
    halfL,
  ];

  for (let i = 1; i < stations.length; i++) {
    if (stations[i] <= stations[i - 1] + 0.01) {
      stations[i] = stations[i - 1] + 0.01;
    }
  }
  return stations;
}

/**
 * Evaluate half-profile points (left side +X from bottom center to top center; mirrored for -X right)
 * at station Z with archetype-specific fender crowns, nose rake, and side-intake scallops.
 */
function sampleHalfSection(z, spec, archRadius, xInnerTub) {
  const dim = spec.dimensions;
  const style = spec.styling;
  const arch = style.archetype;
  const halfL = dim.length * 0.5;
  const halfW = dim.width * 0.5;
  const t = Math.max(0, Math.min(1, (z + halfL) / dim.length)); // 0 = rear, 1 = front

  const frontTaperStart = dim.frontAxleZ + archRadius * 0.86;
  const rearTaperStart = dim.rearAxleZ - archRadius * 0.86;
  let widthFactor = 1.0;

  if (z > frontTaperStart) {
    const u = Math.min(1, (z - frontTaperStart) / Math.max(0.15, halfL - frontTaperStart));
    const power = arch === 'lamborghini' ? 1.55 : arch === 'rally' ? 2.6 : 1.9;
    widthFactor = 1.0 - (1.0 - dim.noseTaper) * Math.pow(u, power);
  } else if (z < rearTaperStart) {
    const u = Math.min(1, (rearTaperStart - z) / Math.max(0.15, rearTaperStart + halfL));
    widthFactor = 1.0 - (1.0 - dim.tailTaper) * (u * u);
  }

  // Deep exotic waist pinch between wheel arches (Ferrari/Lamborghini/Maserati hourglass hip)
  if (style.sideIntakes && z > dim.rearAxleZ + archRadius && z < dim.frontAxleZ - archRadius) {
    const mid = (dim.rearAxleZ + dim.frontAxleZ) * 0.5;
    const span = (dim.frontAxleZ - dim.rearAxleZ) * 0.44;
    const u = Math.max(0, 1 - Math.abs(z - mid) / span);
    const pinchDepth = arch === 'lamborghini' ? 0.135 : arch === 'ferrari' ? 0.125 : 0.095;
    widthFactor *= 1.0 - pinchDepth * (u * u * (2 - u));
  }

  // Pronounced muscular rear haunches over rear wheels for mid-engine exotics
  const rearHaunch = Math.max(0, 1 - Math.abs(z - dim.rearAxleZ) / (archRadius * 1.35));
  if (rearHaunch > 0 && arch !== 'rally') {
    const haunchBoost = arch === 'lamborghini' ? 0.032 : arch === 'ferrari' ? 0.026 : 0.022;
    widthFactor += haunchBoost * smoothstep(0, 0.7, rearHaunch);
  }

  let xOuter = halfW * widthFactor;

  const inRearArch = Math.abs(z - dim.rearAxleZ) <= archRadius * 0.92;
  const inFrontArch = Math.abs(z - dim.frontAxleZ) <= archRadius * 0.92;
  const inArch = inRearArch || inFrontArch;

  const yAxle = dim.wheelRadius;
  const archTopY = yAxle + archRadius;

  // Floor pan with front aero splitter relief and steep rear Venturi diffuser upsweep
  let yFloor = dim.groundClearance;
  if (t > 0.88) yFloor += 0.028 * smoothstep(0.88, 1.0, t);
  if (t < 0.16) yFloor += 0.105 * smoothstep(0.16, 0.0, t);

  // Smooth wedge beltline height
  let yBelt = dim.beltHeight;
  if (z > dim.cabinFrontZ) {
    const u = Math.min(1, (z - dim.cabinFrontZ) / Math.max(0.2, halfL - dim.cabinFrontZ));
    const dropFactor = arch === 'lamborghini' ? 0.96 : arch === 'ferrari' ? 0.90 : 0.84;
    yBelt = THREE.MathUtils.lerp(dim.beltHeight, dim.hoodHeight * 0.82, Math.pow(u, 0.92) * dropFactor);
  } else if (z < dim.cabinRearZ) {
    const u = Math.min(1, (dim.cabinRearZ - z) / Math.max(0.2, dim.cabinRearZ + halfL));
    yBelt = THREE.MathUtils.lerp(dim.beltHeight, dim.trunkHeight - 0.035, u * 0.72);
  }

  // Sculpted fender crown humps rising cleanly above wheel-arch clearance
  const nearFrontArch = Math.max(0, 1 - Math.abs(z - dim.frontAxleZ) / (archRadius * 1.28));
  const nearRearArch = Math.max(0, 1 - Math.abs(z - dim.rearAxleZ) / (archRadius * 1.28));
  const archCrownWeight = Math.max(nearFrontArch, nearRearArch);
  if (archCrownWeight > 0) {
    const crownBoost = arch === 'ferrari' ? 0.055 : arch === 'lamborghini' ? 0.048 : 0.036;
    yBelt = Math.max(
      yBelt,
      THREE.MathUtils.lerp(yBelt, archTopY + crownBoost, smoothstep(0, 0.45, archCrownWeight))
    );
  }

  const xLower = inArch ? Math.min(xOuter, xInnerTub) : xOuter * (arch === 'lamborghini' ? 0.97 : 0.94);
  const xMid = inArch ? Math.min(xOuter, xInnerTub + 0.02) : xOuter * 1.015;
  const yArchShelf = inArch
    ? archTopY + 0.008
    : THREE.MathUtils.lerp(yFloor, yBelt, arch === 'lamborghini' ? 0.44 : 0.48);

  const inCockpit = z >= dim.cabinRearZ + 0.06 && z <= dim.cabinFrontZ - 0.06;
  const cabinHalfW = Math.min(xOuter - 0.14, dim.cabinWidth * 0.5);

  let yDeckEdge = yBelt + 0.025;
  let yCockpitRim = yDeckEdge + 0.02;
  let yDeckCenter = yDeckEdge + 0.04;

  if (z > dim.cabinFrontZ - 0.06) {
    const hoodU = smoothstep(dim.cabinFrontZ, halfL, z);
    const frontSlope = arch === 'lamborghini' ? 0.72 : arch === 'ferrari' ? 0.78 : 0.86;
    const targetHoodTop = THREE.MathUtils.lerp(dim.beltHeight + 0.035, dim.hoodHeight * frontSlope, hoodU);
    const fenderSwell = arch === 'rally' ? 0.015 : nearFrontArch * 0.042;
    yDeckEdge = Math.max(yBelt + 0.015, targetHoodTop + fenderSwell);

    // Sunken central aero S-duct hood valley between raised front fender crowns
    const ductDrop = arch !== 'rally' ? 0.036 * (1 - hoodU * 0.35) : -0.02;
    yCockpitRim = Math.max(yBelt + 0.012, yDeckEdge - ductDrop);
    const centerRidge = arch === 'lamborghini' ? 0.022 : 0.018;
    yDeckCenter = Math.max(yBelt + 0.014, yCockpitRim + centerRidge);
  } else if (z < dim.cabinRearZ + 0.06) {
    const tailU = smoothstep(dim.cabinRearZ, -halfL, z);
    // Subtle Kamm-tail kick on Ferrari/Lamborghini rear edge
    const kammKick = (arch === 'ferrari' || arch === 'lamborghini') ? 0.025 * Math.pow(tailU, 3) : 0;
    const targetTailTop = THREE.MathUtils.lerp(dim.beltHeight + 0.03, dim.trunkHeight + kammKick, tailU);
    yDeckEdge = Math.max(yBelt + 0.015, targetTailTop);
    yCockpitRim = yDeckEdge + 0.016;
    yDeckCenter = yDeckEdge + 0.028;
  } else if (inCockpit) {
    yDeckEdge = yBelt + 0.02;
    yCockpitRim = yDeckEdge;
    yDeckCenter = yFloor + 0.07;
  }

  // Smooth wedge bevel across the front nose tip and tail fascia (eliminates blunt box ends)
  if (z > halfL - 0.065) {
    const bevelU = smoothstep(halfL - 0.065, halfL, z);
    xOuter *= 1.0 - 0.11 * bevelU;
    yBelt = THREE.MathUtils.lerp(yBelt, yFloor + (yBelt - yFloor) * 0.64, bevelU);
    yDeckEdge = Math.max(yBelt + 0.012, THREE.MathUtils.lerp(yDeckEdge, yFloor + (yDeckEdge - yFloor) * 0.66, bevelU));
    yCockpitRim = Math.max(yBelt + 0.01, yDeckEdge - 0.01);
    yDeckCenter = Math.max(yBelt + 0.012, yDeckEdge + 0.012);
  } else if (z <= -halfL + 0.01) {
    xOuter *= 0.94;
    yBelt = Math.max(yFloor + 0.17, yBelt - 0.03);
    yDeckEdge = Math.max(yBelt + 0.012, yDeckEdge - 0.015);
    yCockpitRim = yDeckEdge + 0.01;
    yDeckCenter = yDeckEdge + 0.016;
  }

  const xCockpitRim = inCockpit ? cabinHalfW : xOuter * 0.74;
  const xInnerFloor = inCockpit ? cabinHalfW * 0.84 : xOuter * 0.34;
  const yRim = inCockpit ? yDeckEdge : yCockpitRim;

  return [
    { x: 0, y: yFloor },
    { x: xLower * 0.94, y: yFloor },
    { x: xMid, y: yArchShelf },
    { x: xOuter, y: yBelt },
    { x: xCockpitRim, y: yDeckEdge },
    { x: xInnerFloor, y: yRim },
    { x: 0, y: yDeckCenter },
  ];
}

/**
 * Construct smooth 24-station lofted BufferGeometry with crisp hard creases and pinch-free quad end caps.
 */
function buildLoftedHullGeometry(spec, archRadius, xInnerTub) {
  const zs = buildStationZs(spec.dimensions, archRadius);
  const halfProfiles = zs.map((z) => sampleHalfSection(z, spec, archRadius, xInnerTub));

  const fullSections = halfProfiles.map((half) => {
    const pts = [];
    for (let i = 0; i < half.length; i++) {
      pts.push({ x: half[i].x, y: half[i].y });
    }
    for (let i = half.length - 2; i >= 1; i--) {
      pts.push({ x: -half[i].x, y: half[i].y });
    }
    return pts;
  });

  const ringCount = fullSections[0].length;
  const positions = [];
  const uvs = [];
  const indices = [];

  const hardCreases = new Set([1, 3, 4, 8, 9, 11]);
  const stripGroups = [];
  let currentGroup = [];
  for (let p = 0; p < ringCount; p++) {
    currentGroup.push(p);
    const next = (p + 1) % ringCount;
    if (hardCreases.has(next)) {
      stripGroups.push(currentGroup);
      currentGroup = [];
    }
  }
  if (currentGroup.length > 0) {
    if (stripGroups.length > 0 && !hardCreases.has(0)) {
      stripGroups[0] = currentGroup.concat(stripGroups[0]);
    } else {
      stripGroups.push(currentGroup);
    }
  }

  let vertOffset = 0;
  for (const group of stripGroups) {
    const cols = group.length + 1;
    for (let s = 0; s < zs.length; s++) {
      const z = zs[s];
      const ring = fullSections[s];
      const vCoord = s / (zs.length - 1);
      for (let c = 0; c < cols; c++) {
        const ptIdx = (group[0] + c) % ringCount;
        const pt = ring[ptIdx];
        positions.push(pt.x, pt.y, z);
        uvs.push(c / Math.max(1, cols - 1), vCoord);
      }
    }

    for (let s = 0; s < zs.length - 1; s++) {
      for (let c = 0; c < cols - 1; c++) {
        const i00 = vertOffset + s * cols + c;
        const i10 = vertOffset + (s + 1) * cols + c;
        const i01 = i00 + 1;
        const i11 = i10 + 1;
        indices.push(i00, i01, i10);
        indices.push(i01, i11, i10);
      }
    }
    vertOffset += zs.length * cols;
  }

  const addQuadEndCap = (ring, z, isRear) => {
    const base = vertOffset;
    for (let p = 0; p < ringCount; p++) {
      positions.push(ring[p].x, ring[p].y, z);
      uvs.push(0.5 + ring[p].x * 0.35, ring[p].y * 0.5);
      vertOffset += 1;
    }
    const pushTri = (a, b, c) => {
      if (isRear) {
        indices.push(base + a, base + c, base + b);
      } else {
        indices.push(base + a, base + b, base + c);
      }
    };
    pushTri(0, 1, 11);
    for (let k = 1; k <= 4; k++) {
      const l0 = k;
      const l1 = k + 1;
      const r1 = ringCount - (k + 1);
      const r0 = ringCount - k;
      pushTri(l0, l1, r1);
      pushTri(l0, r1, r0);
    }
    pushTri(5, 6, 7);
  };

  addQuadEndCap(fullSections[0], zs[0], true);
  addQuadEndCap(fullSections[zs.length - 1], zs[zs.length - 1], false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Create inner dark wheel-well tub + flush outer sculpted fender flare around each wheel arch (Rule #1).
 */
function buildWheelArchAssembly(xSign, zAxle, spec, archRadius, xInnerTub, materials, disposables) {
  const group = new THREE.Group();
  const dim = spec.dimensions;
  const yAxle = dim.wheelRadius;
  const halfW = dim.width * 0.5;
  const outerX = halfW + dim.fenderFlare;
  const innerX = xInnerTub;
  const tubDepth = Math.max(0.26, outerX - innerX);

  const wellGeo = new THREE.CylinderGeometry(
    archRadius,
    archRadius,
    tubDepth,
    26,
    1,
    true,
    -Math.PI * 0.52,
    Math.PI * 1.04
  );
  wellGeo.rotateZ(Math.PI / 2);
  wellGeo.rotateX(-Math.PI / 2);
  disposables.push(wellGeo);

  const wellMesh = new THREE.Mesh(wellGeo, materials.wheelWell);
  wellMesh.position.set(xSign * (innerX + tubDepth * 0.5), yAxle, zAxle);
  group.add(wellMesh);

  const discGeo = new THREE.CircleGeometry(archRadius, 24, 0, Math.PI);
  discGeo.rotateY(xSign > 0 ? Math.PI / 2 : -Math.PI / 2);
  disposables.push(discGeo);
  const discMesh = new THREE.Mesh(discGeo, materials.wheelWell);
  discMesh.position.set(xSign * (innerX + 0.005), yAxle, zAxle);
  group.add(discMesh);

  // Outer faceted/sculpted fender arch lip (Lamborghini gets subtle polygonal chamfer)
  const flareShape = new THREE.Shape();
  const outerR = archRadius + 0.056;
  const segs = spec.styling.archetype === 'lamborghini' ? 10 : 24;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI;
    const px = Math.cos(a) * outerR;
    const py = Math.sin(a) * outerR;
    if (i === 0) flareShape.moveTo(px, py);
    else flareShape.lineTo(px, py);
  }
  for (let i = segs; i >= 0; i--) {
    const a = (i / segs) * Math.PI;
    flareShape.lineTo(Math.cos(a) * archRadius, Math.sin(a) * archRadius);
  }
  flareShape.closePath();

  const flareDepth = dim.fenderFlare + 0.088;
  const flareGeo = new THREE.ExtrudeGeometry(flareShape, {
    depth: flareDepth,
    bevelEnabled: true,
    bevelThickness: 0.011,
    bevelSize: 0.010,
    bevelSegments: 2,
  });
  flareGeo.rotateY(xSign > 0 ? Math.PI / 2 : -Math.PI / 2);
  disposables.push(flareGeo);

  const flareMat = spec.styling.archetype === 'rally' ? materials.carbon : materials.paint;
  const flareMesh = new THREE.Mesh(flareGeo, flareMat);
  flareMesh.position.set(xSign * (halfW - 0.085), yAxle, zAxle);
  flareMesh.castShadow = true;
  flareMesh.receiveShadow = true;
  group.add(flareMesh);

  return group;
}

/**
 * Helper to create sharp beveled ExtrudeGeometry from planar XY coordinates.
 */
function buildExtrudedPolygon(points2D, depth, bevel = false) {
  const shape = new THREE.Shape();
  shape.moveTo(points2D[0][0], points2D[0][1]);
  for (let i = 1; i < points2D.length; i++) {
    shape.lineTo(points2D[i][0], points2D[i][1]);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel,
    bevelThickness: bevel ? 0.004 : 0,
    bevelSize: bevel ? 0.004 : 0,
    bevelSegments: bevel ? 1 : 0,
  });
  geo.translate(0, 0, -depth * 0.5);
  return geo;
}

/**
 * Construct a genuinely cambered, swept, inverted-airfoil rear wing with sharp trailing Gurney flap.
 * Uses explicit outward triangle winding verified by right-hand rule along +X span.
 */
function buildSweptAirfoilGeo({
  span = 1.9,
  centerChord = 0.34,
  tipChord = 0.25,
  camber = 0.048,
  thickness = 0.028,
  sweep = 0.14,
  dihedral = -0.025,
  gurneyHeight = 0.018,
  spanSteps = 10,
}) {
  // Normalized chord coordinates u in [0..1] (0 = +Z leading edge, 1 = -Z trailing edge)
  const topProfile = [
    [0.0, 0.0],
    [0.08, 0.32],
    [0.25, 0.45],
    [0.50, 0.36],
    [0.78, 0.18],
    [0.97, 0.04],
    [1.0, gurneyHeight / Math.max(0.01, thickness)], // upturned trailing Gurney lip
  ];
  const botProfile = [
    [1.0, -0.08],
    [0.75, -0.42],
    [0.45, -0.68],
    [0.22, -0.58],
    [0.06, -0.28],
  ];

  // Loop order along +X cross-section gives exact outward normals under (dP/di) x (dP/dj)
  const loop = [...topProfile, ...botProfile];
  const ringLen = loop.length;

  const positions = [];
  const uvs = [];
  const indices = [];

  const getStationRing = (uSpanNorm) => {
    const s = uSpanNorm * 2 - 1; // [-1 .. +1]
    const absS = Math.abs(s);
    const x = s * span * 0.5;
    const chord = THREE.MathUtils.lerp(centerChord, tipChord, absS * absS);
    const zOffset = -sweep * absS * absS;
    const yOffset = dihedral * absS * absS;
    return loop.map(([cu, cy]) => {
      const z = (0.45 - cu) * chord + zOffset;
      const camberCurve = -camber * Math.sin(Math.PI * cu);
      const y = cy * thickness + camberCurve + yOffset;
      return { x, y, z };
    });
  };

  for (let i = 0; i <= spanSteps; i++) {
    const uSpan = i / spanSteps;
    const ring = getStationRing(uSpan);
    for (let j = 0; j < ringLen; j++) {
      const p = ring[j];
      positions.push(p.x, p.y, p.z);
      uvs.push(uSpan, j / ringLen);
    }
  }

  for (let i = 0; i < spanSteps; i++) {
    const rowA = i * ringLen;
    const rowB = (i + 1) * ringLen;
    for (let j = 0; j < ringLen; j++) {
      const jNext = (j + 1) % ringLen;
      const a = rowA + j;
      const b = rowB + j;
      const c = rowB + jNext;
      const d = rowA + jNext;
      indices.push(a, b, c);
      indices.push(a, c, d);
    }
  }

  // Separate crisp flat tip end-caps so sharp airfoil edges don't bleed normals
  const addTipCap = (uSpan, isRightTip) => {
    const ring = getStationRing(uSpan);
    const base = positions.length / 3;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const p of ring) {
      cx += p.x;
      cy += p.y;
      cz += p.z;
    }
    cx /= ringLen;
    cy /= ringLen;
    cz /= ringLen;

    positions.push(cx, cy, cz);
    uvs.push(0.5, 0.5);
    for (let j = 0; j < ringLen; j++) {
      const p = ring[j];
      positions.push(p.x, p.y, p.z);
      uvs.push(0.5 + (p.z * 0.5), 0.5 + (p.y * 0.5));
    }

    for (let j = 0; j < ringLen; j++) {
      const jNext = (j + 1) % ringLen;
      if (isRightTip) {
        // -X outward normal
        indices.push(base, base + 1 + j, base + 1 + jNext);
      } else {
        // +X outward normal
        indices.push(base, base + 1 + jNext, base + 1 + j);
      }
    }
  };

  addTipCap(0, true);
  addTipCap(1, false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Build the semi-transparent glass greenhouse + roof + flying aero buttresses + A/B/C pillars.
 */
function buildGreenhouse(spec, materials, disposables) {
  const group = new THREE.Group();
  const dim = spec.dimensions;
  const style = spec.styling;
  const arch = style.archetype;

  const baseW = dim.cabinWidth * 0.5 + 0.01;
  const roofW = baseW * (arch === 'lamborghini' ? 0.72 : arch === 'ferrari' ? 0.76 : 0.80);
  const yBase = dim.beltHeight + 0.005;
  const yRoof = dim.cabinHeight;

  const zFBase = dim.cabinFrontZ;
  const zFRoof = dim.roofFrontZ;
  const zRBase = dim.cabinRearZ;
  const zRRoof = dim.roofRearZ;

  // Front windshield glass pane (always present; open-top Roadsters skip side/roof glass!)
  const fGlassVerts = new Float32Array([
    baseW, yBase, zFBase,
    -baseW, yBase, zFBase,
    -roofW, yRoof, zFRoof,
    roofW, yRoof, zFRoof,
  ]);
  const fGlassGeo = new THREE.BufferGeometry();
  fGlassGeo.setAttribute('position', new THREE.BufferAttribute(fGlassVerts, 3));
  fGlassGeo.setIndex([0, 1, 2, 0, 2, 3]);
  fGlassGeo.setAttribute(
    'uv',
    new THREE.BufferAttribute(new Float32Array([1, 0, 0, 0, 0.1, 1, 0.9, 1]), 2)
  );
  fGlassGeo.computeVertexNormals();
  disposables.push(fGlassGeo);
  group.add(new THREE.Mesh(fGlassGeo, materials.glass));

  // Windshield top GT2 banner (Photo 3 style)
  if (style.gt2Banner) {
    const t0 = 0.76;
    const xB = THREE.MathUtils.lerp(baseW, roofW, t0) * 0.98;
    const yB = THREE.MathUtils.lerp(yBase, yRoof, t0);
    const zB = THREE.MathUtils.lerp(zFBase, zFRoof, t0) + 0.008;
    const bVerts = new Float32Array([
      xB, yB, zB,
      -xB, yB, zB,
      -roofW * 0.98, yRoof + 0.006, zFRoof + 0.006,
      roofW * 0.98, yRoof + 0.006, zFRoof + 0.006,
    ]);
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bVerts, 3));
    bGeo.setIndex([0, 1, 2, 0, 2, 3]);
    bGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    bGeo.computeVertexNormals();
    disposables.push(bGeo);
    group.add(new THREE.Mesh(bGeo, materials.banner));
  }

  // Side/rear glass + solid roof shell ONLY on closed coupes
  if (!style.openTop) {
    const verts = new Float32Array([
      baseW, yBase, zFBase,
      -baseW, yBase, zFBase,
      -baseW, yBase, zRBase,
      baseW, yBase, zRBase,
      roofW, yRoof, zFRoof,
      -roofW, yRoof, zFRoof,
      -roofW, yRoof, zRRoof,
      roofW, yRoof, zRRoof,
    ]);
    const idx = [
      3, 0, 4, 3, 4, 7,
      1, 2, 6, 1, 6, 5,
      2, 3, 7, 2, 7, 6,
    ];
    const glassGeo = new THREE.BufferGeometry();
    glassGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    glassGeo.setIndex(idx);
    glassGeo.computeVertexNormals();
    disposables.push(glassGeo);
    group.add(new THREE.Mesh(glassGeo, materials.glass));

    const roofVerts = new Float32Array([
      roofW * 1.04, yRoof - 0.005, zFRoof + 0.015,
      -roofW * 1.04, yRoof - 0.005, zFRoof + 0.015,
      -roofW * 1.04, yRoof - 0.005, zRRoof - 0.015,
      roofW * 1.04, yRoof - 0.005, zRRoof - 0.015,
      roofW * 0.94, yRoof + 0.036, zFRoof - 0.03,
      -roofW * 0.94, yRoof + 0.036, zFRoof - 0.03,
      -roofW * 0.94, yRoof + 0.036, zRRoof + 0.03,
      roofW * 0.94, yRoof + 0.036, zRRoof + 0.03,
    ]);
    const roofIdx = [
      4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4,
      1, 2, 6, 1, 6, 5,
      2, 3, 7, 2, 7, 6,
      3, 0, 4, 3, 4, 7,
    ];
    const roofGeo = new THREE.BufferGeometry();
    roofGeo.setAttribute('position', new THREE.BufferAttribute(roofVerts, 3));
    roofGeo.setIndex(roofIdx);
    roofGeo.computeVertexNormals();
    disposables.push(roofGeo);

    const roofMat = arch === 'lamborghini' || arch === 'maserati' ? materials.carbon : materials.paint;
    const roofMesh = new THREE.Mesh(roofGeo, roofMat);
    roofMesh.castShadow = true;
    group.add(roofMesh);
  } else {
    // Open-top Roadster / Spyder top windshield header rail + center glass windblocker
    const headerGeo = new THREE.CylinderGeometry(0.024, 0.024, roofW * 2.02, 10);
    headerGeo.rotateZ(Math.PI / 2);
    const windStopGeo = new THREE.PlaneGeometry(roofW * 1.15, 0.16);
    disposables.push(headerGeo, windStopGeo);

    const header = new THREE.Mesh(headerGeo, materials.carbon);
    header.position.set(0, yRoof, zFRoof);
    header.castShadow = true;
    group.add(header);

    const windStop = new THREE.Mesh(windStopGeo, materials.glass);
    windStop.position.set(0, dim.beltHeight + 0.16, zRRoof + 0.06);
    group.add(windStop);
  }

  // Structural A-pillars (always) + B/C pillars (coupes)
  const addPillar = (p1, p2, radius = 0.026) => {
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();
    const pGeo = new THREE.CylinderGeometry(radius, radius * 1.15, len, 8);
    disposables.push(pGeo);
    const pMesh = new THREE.Mesh(pGeo, materials.carbon);
    pMesh.position.addVectors(p1, p2).multiplyScalar(0.5);
    pMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    group.add(pMesh);
  };

  for (const s of [1, -1]) {
    addPillar(new THREE.Vector3(s * baseW, yBase, zFBase), new THREE.Vector3(s * roofW, yRoof, zFRoof), 0.028);
    if (!style.openTop) {
      addPillar(new THREE.Vector3(s * baseW, yBase, zRBase), new THREE.Vector3(s * roofW, yRoof, zRRoof), 0.032);
      const midBZ = (zFBase + zRBase) * 0.45;
      const midRZ = (zFRoof + zRRoof) * 0.48;
      addPillar(new THREE.Vector3(s * baseW, yBase, midBZ), new THREE.Vector3(s * roofW, yRoof, midRZ), 0.020);
    }
  }

  // Twin Aero Flying Buttresses / Speedster Cowls on Open-Top Roadsters & Exotics (Photos 1, 2, 3, 4)
  if (style.openTop || arch === 'ferrari' || arch === 'maserati') {
    const peakY = style.openTop ? yRoof - 0.05 : yRoof - 0.01;
    const peakZ = style.openTop ? zRRoof + 0.14 : zRRoof + 0.02;
    const buttW = style.openTop ? 0.15 : 0.085;
    const buttGeo = buildExtrudedPolygon(
      [
        [peakZ, peakY],
        [zRRoof - 0.56, dim.trunkHeight + 0.025],
        [zRRoof - 0.62, dim.trunkHeight - 0.01],
        [zRBase + 0.06, yBase + 0.005],
        [peakZ - 0.04, peakY - 0.11],
      ],
      buttW,
      true
    );
    buttGeo.rotateY(-Math.PI / 2);
    disposables.push(buttGeo);

    for (const s of [-1, 1]) {
      const bMesh = new THREE.Mesh(buttGeo, materials.paint);
      bMesh.position.set(s * (style.openTop ? baseW * 0.62 : baseW * 0.88), 0, 0);
      bMesh.castShadow = true;
      group.add(bMesh);
    }

    if (style.openTop) {
      // Dark carbon cockpit halo trim collar behind headrests
      const hoopGeo = new THREE.BoxGeometry(0.16, 0.05, 0.14);
      disposables.push(hoopGeo);
      for (const s of [-1, 1]) {
        const hoop = new THREE.Mesh(hoopGeo, materials.carbon);
        hoop.position.set(s * (baseW * 0.48), peakY - 0.04, peakZ - 0.05);
        group.add(hoop);
      }
    }
  }

  return group;
}

/**
 * Build partial interior clearly visible through reflective glass:
 * 2 racing bucket seats, steering wheel, glowing dashboard gauges, and roll cage.
 */
function buildPartialInterior(spec, materials, disposables) {
  const group = new THREE.Group();
  const dim = spec.dimensions;
  const arch = spec.styling.archetype;
  const yFloor = dim.groundClearance + 0.08;
  const seatZ = (dim.cabinFrontZ + dim.cabinRearZ) * 0.5 - 0.14;
  const seatOffsetX = Math.min(0.32, dim.cabinWidth * 0.24);
  const scaleH = arch === 'rally' ? 1.0 : 0.84;

  const cushionGeo = new THREE.BoxGeometry(0.40, 0.09, 0.44);
  const backGeo = new THREE.BoxGeometry(0.38, 0.50 * scaleH, 0.09);
  const bolsterGeo = new THREE.BoxGeometry(0.065, 0.44 * scaleH, 0.15);
  const headrestGeo = new THREE.BoxGeometry(0.22, 0.15 * scaleH, 0.08);
  disposables.push(cushionGeo, backGeo, bolsterGeo, headrestGeo);

  for (const side of [1, -1]) {
    const seat = new THREE.Group();
    seat.position.set(side * seatOffsetX, yFloor + 0.07, seatZ);

    const cushion = new THREE.Mesh(cushionGeo, materials.interior);
    seat.add(cushion);

    const backrest = new THREE.Mesh(backGeo, materials.interior);
    backrest.position.set(0, 0.25 * scaleH, -0.19);
    backrest.rotation.x = -0.25;
    seat.add(backrest);

    for (const bs of [-1, 1]) {
      const bolster = new THREE.Mesh(bolsterGeo, materials.seatAccent);
      bolster.position.set(bs * 0.18, 0.23 * scaleH, -0.14);
      bolster.rotation.x = -0.25;
      seat.add(bolster);
    }

    const head = new THREE.Mesh(headrestGeo, materials.seatAccent);
    head.position.set(0, 0.54 * scaleH, -0.26);
    head.rotation.x = -0.16;
    seat.add(head);

    group.add(seat);
  }

  const dashZ = dim.cabinFrontZ - 0.18;
  const dashY = dim.beltHeight - 0.04;
  const dashGeo = new THREE.BoxGeometry(dim.cabinWidth * 0.86, 0.17, 0.28);
  const gaugeGeo = new THREE.PlaneGeometry(0.42, 0.13);
  disposables.push(dashGeo, gaugeGeo);

  const dashMesh = new THREE.Mesh(dashGeo, materials.interior);
  dashMesh.position.set(0, dashY, dashZ);
  group.add(dashMesh);

  const gaugeMesh = new THREE.Mesh(gaugeGeo, materials.dashboard);
  gaugeMesh.position.set(seatOffsetX * 0.45, dashY + 0.03, dashZ - 0.145);
  gaugeMesh.rotation.y = Math.PI;
  group.add(gaugeMesh);

  const wheelGroup = new THREE.Group();
  wheelGroup.position.set(seatOffsetX, dashY + 0.03, dashZ - 0.26);
  wheelGroup.rotation.x = 0.26;

  const colGeo = new THREE.CylinderGeometry(0.024, 0.028, 0.22, 10);
  colGeo.rotateX(Math.PI / 2);
  const rimGeo = new THREE.TorusGeometry(0.135, 0.017, 8, 22);
  const spokeGeo = new THREE.BoxGeometry(0.24, 0.026, 0.014);
  disposables.push(colGeo, rimGeo, spokeGeo);

  const colMesh = new THREE.Mesh(colGeo, materials.trimDark);
  colMesh.position.z = 0.11;
  wheelGroup.add(colMesh);

  wheelGroup.add(new THREE.Mesh(rimGeo, materials.trimDark));
  wheelGroup.add(new THREE.Mesh(spokeGeo, materials.chrome));
  group.add(wheelGroup);

  const consoleGeo = new THREE.BoxGeometry(0.17, 0.16, 0.84);
  disposables.push(consoleGeo);
  const consoleMesh = new THREE.Mesh(consoleGeo, materials.trimDark);
  consoleMesh.position.set(0, yFloor + 0.10, seatZ + 0.12);
  group.add(consoleMesh);

  if (spec.styling.rollCage || arch === 'rally' || arch === 'lamborghini') {
    const halfW = dim.cabinWidth * 0.34;
    const cageZ = dim.roofRearZ + 0.06;
    const topCageY = dim.cabinHeight - 0.08;
    const hoopPts = [
      new THREE.Vector3(-halfW, yFloor + 0.05, cageZ - 0.06),
      new THREE.Vector3(-halfW * 0.86, topCageY, cageZ),
      new THREE.Vector3(halfW * 0.86, topCageY, cageZ),
      new THREE.Vector3(halfW, yFloor + 0.05, cageZ - 0.06),
    ];
    const hoopCurve = new THREE.CatmullRomCurve3(hoopPts);
    const hoopGeo = new THREE.TubeGeometry(hoopCurve, 16, 0.02, 8, false);
    const crossGeo = new THREE.CylinderGeometry(0.016, 0.016, halfW * 1.9, 8);
    disposables.push(hoopGeo, crossGeo);

    group.add(new THREE.Mesh(hoopGeo, materials.seatAccent));
    const diagMesh = new THREE.Mesh(crossGeo, materials.seatAccent);
    diagMesh.position.set(0, (yFloor + topCageY) * 0.5, cageZ - 0.03);
    diagMesh.rotation.z = Math.PI * 0.34;
    group.add(diagMesh);
  }

  return group;
}

/**
 * Add sharp exotic aerodynamic elements: swept V-nose splitter & endplates, dual dive-plane canards,
 * side bargeboards & intake strakes, fender louvers, hood vents, dorsal shark-fin, slatted engine
 * louvers, Venturi 6-fin diffuser, signature Y/L-blade/Quad LED lights, and cambered rear wings.
 */
function buildExteriorTrim(spec, archRadius, materials, disposables) {
  const group = new THREE.Group();
  const dim = spec.dimensions;
  const style = spec.styling;
  const arch = style.archetype;
  const halfL = dim.length * 0.5;
  const halfW = dim.width * 0.5;

  // Front & rear clearance envelopes respecting Rule #1 steering/travel clearance
  const frontWheelClearZ = dim.frontAxleZ + archRadius + 0.025;
  const rearWheelClearZ = dim.rearAxleZ - archRadius - 0.025;
  const waistStartZ = dim.rearAxleZ + archRadius + 0.025;
  const waistEndZ = dim.frontAxleZ - archRadius - 0.025;

  // ── 1. Multi-Tier Swept Carbon Front Splitter with Central V-Tongue & Endplates ──
  const splitHalfW = dim.width * dim.noseTaper * 0.50;
  const splitFrontZ = halfL + (arch === 'lamborghini' ? 0.14 : arch === 'ferrari' ? 0.11 : 0.08);
  const splitBackZ = Math.max(frontWheelClearZ, halfL - 0.28);
  const splitProtrusion = splitFrontZ - splitBackZ;
  const splitterShapePts = [
    [0, splitFrontZ + 0.055],
    [-splitHalfW * 0.55, splitFrontZ + 0.01],
    [-splitHalfW, splitFrontZ - 0.07],
    [-splitHalfW * 1.03, splitBackZ],
    [splitHalfW * 1.03, splitBackZ],
    [splitHalfW, splitFrontZ - 0.07],
    [splitHalfW * 0.55, splitFrontZ + 0.01],
  ];
  const splitterGeo = buildExtrudedPolygon(splitterShapePts, 0.026, true);
  splitterGeo.rotateX(Math.PI / 2);
  disposables.push(splitterGeo);

  const splitterMesh = new THREE.Mesh(splitterGeo, materials.carbon);
  splitterMesh.position.set(0, dim.groundClearance + 0.012, 0);
  splitterMesh.castShadow = true;
  group.add(splitterMesh);

  // Upturned carbon splitter winglets (front endplates)
  const spWingGeo = buildExtrudedPolygon(
    [
      [splitFrontZ - 0.05, dim.groundClearance + 0.01],
      [splitFrontZ - 0.09, dim.groundClearance + 0.155],
      [splitBackZ + 0.02, dim.groundClearance + 0.135],
      [splitBackZ, dim.groundClearance + 0.01],
    ],
    0.016,
    false
  );
  spWingGeo.rotateY(-Math.PI / 2);
  disposables.push(spWingGeo);
  for (const s of [-1, 1]) {
    const sw = new THREE.Mesh(spWingGeo, materials.carbon);
    sw.position.set(s * splitHalfW * 1.01, 0, 0);
    sw.rotation.y = s * -0.06;
    group.add(sw);
  }

  // Front vertical aero intake strakes separating lower grille channels
  if (splitProtrusion > 0.08) {
    const strakeGeo = buildExtrudedPolygon(
      [
        [halfL + 0.04, dim.groundClearance + 0.02],
        [halfL + 0.01, dim.groundClearance + 0.18],
        [halfL - 0.08, dim.groundClearance + 0.18],
        [halfL - 0.08, dim.groundClearance + 0.02],
      ],
      0.016,
      false
    );
    strakeGeo.rotateY(-Math.PI / 2);
    disposables.push(strakeGeo);
    for (const sx of [-splitHalfW * 0.42, splitHalfW * 0.42]) {
      const strake = new THREE.Mesh(strakeGeo, materials.carbon);
      strake.position.set(sx, 0, 0);
      group.add(strake);
    }
  }

  // ── 2. Dual Stacked Front Dive-Plane Canards (bumper aero fins) ──
  if (style.canards) {
    const canardLeftPts = [
      [0, 0],
      [0.145, -0.055],
      [0.035, -0.22],
      [-0.01, -0.14],
    ];
    const canardLeftGeo = buildExtrudedPolygon(canardLeftPts, 0.012, true);
    canardLeftGeo.rotateX(Math.PI / 2);
    const canardRightGeo = buildExtrudedPolygon(
      canardLeftPts.map(([x, y]) => [-x, y]),
      0.012,
      true
    );
    canardRightGeo.rotateX(Math.PI / 2);
    disposables.push(canardLeftGeo, canardRightGeo);

    for (const s of [-1, 1]) {
      const cGeo = s > 0 ? canardLeftGeo : canardRightGeo;
      for (let tier = 0; tier < 2; tier++) {
        const canard = new THREE.Mesh(cGeo, materials.carbon);
        const yOff = dim.groundClearance + 0.16 + tier * 0.10;
        const zOff = Math.max(frontWheelClearZ + 0.04, halfL - 0.08 - tier * 0.04);
        canard.position.set(s * (splitHalfW * 0.96), yOff, zOff);
        canard.rotation.x = 0.24; // downward angle of attack
        canard.rotation.z = s * 0.18; // upturned tip
        canard.castShadow = true;
        group.add(canard);
      }
    }
  }

  // ── 3. Recessed Honeycomb Front Grille & Hexagonal Y-Strake Air Pockets (+Z) ──
  const grilleW = splitHalfW * 1.44;
  const grilleH = Math.max(0.14, (dim.hoodHeight - dim.groundClearance) * 0.34);
  const grilleGeo = new THREE.PlaneGeometry(grilleW, grilleH);
  disposables.push(grilleGeo);
  const grilleMesh = new THREE.Mesh(grilleGeo, materials.grille);
  grilleMesh.position.set(0, dim.groundClearance + grilleH * 0.65, halfL - 0.008);
  grilleMesh.rotation.x = -0.12;
  group.add(grilleMesh);

  if (style.hexPockets) {
    // Lamborghini Revuelto sculpted angular front bumper air intake pockets + glowing DRL hex trim (Photos 1 & 2)
    const hexPocketGeo = buildExtrudedPolygon(
      [
        [0.0, 0.0],
        [0.24, 0.02],
        [0.28, 0.14],
        [0.14, 0.20],
        [-0.02, 0.12],
      ],
      0.06,
      false
    );
    const hexRingGeo = new THREE.RingGeometry(0.036, 0.052, 6);
    const yStrakeGeo = new THREE.BoxGeometry(0.16, 0.016, 0.05);
    disposables.push(hexPocketGeo, hexRingGeo, yStrakeGeo);

    for (const s of [-1, 1]) {
      const pocket = new THREE.Mesh(hexPocketGeo, materials.trimDark);
      pocket.position.set(s * (splitHalfW * 0.44), dim.groundClearance + 0.04, halfL - 0.015);
      pocket.scale.set(s, 1, 1);
      pocket.rotation.y = s * -0.14;
      group.add(pocket);

      const hexDrL = new THREE.Mesh(hexRingGeo, materials.headlight);
      hexDrL.position.set(s * (splitHalfW * 0.68), dim.groundClearance + 0.155, halfL + 0.045);
      hexDrL.rotation.y = s * -0.16;
      group.add(hexDrL);

      const blade = new THREE.Mesh(yStrakeGeo, materials.carbon);
      blade.position.set(s * (splitHalfW * 0.56), dim.groundClearance + 0.15, halfL + 0.035);
      blade.rotation.z = s * 0.35;
      group.add(blade);
    }
  }

  // ── 4. Sharp Signature Headlights Matching the 4 Reference Exotics ──
  const headY = dim.hoodHeight * 0.69;
  const headZ = halfL - 0.055;
  const headXBase = splitHalfW * 0.72;

  if (style.headlightStyle === 'y_blade' || style.headlightStyle === 'under_brow') {
    // Lamborghini Revuelto / SVJ sunken brow recess + razor-thin Y/slit DRL blades (Photos 1 & 2)
    const pocketGeo = new THREE.BoxGeometry(0.32, 0.068, 0.09);
    const barMainGeo = new THREE.BoxGeometry(0.25, 0.016, 0.025);
    const prongGeo = new THREE.BoxGeometry(0.11, 0.015, 0.025);
    disposables.push(pocketGeo, barMainGeo, prongGeo);

    for (const s of [-1, 1]) {
      const pocket = new THREE.Mesh(pocketGeo, materials.trimDark);
      pocket.position.set(s * headXBase, headY, headZ - 0.015);
      pocket.rotation.y = s * -0.22;
      pocket.rotation.x = 0.14;
      group.add(pocket);

      const stem = new THREE.Mesh(barMainGeo, materials.headlight);
      stem.position.set(s * headXBase, headY, headZ + 0.025);
      stem.rotation.y = s * -0.22;
      stem.rotation.z = s * 0.14;
      group.add(stem);

      if (style.headlightStyle === 'y_blade') {
        for (const a of [-0.55, 0.45]) {
          const prong = new THREE.Mesh(prongGeo, materials.headlight);
          prong.position.set(s * (headXBase + 0.08), headY + a * 0.045, headZ - 0.01);
          prong.rotation.y = s * -0.30;
          prong.rotation.z = s * a;
          group.add(prong);
        }
      }
    }
  } else if (style.headlightStyle === 'eye_socket') {
    // McLaren 765LT sculpted dark teardrop eye-socket aero ducts + floating slim LED bar (Photo 4)
    const socketGeo = buildExtrudedPolygon(
      [
        [0.0, 0.0],
        [0.14, 0.045],
        [0.24, 0.015],
        [0.18, -0.055],
        [0.04, -0.045],
      ],
      0.08,
      true
    );
    const bladeGeo = new THREE.BoxGeometry(0.21, 0.018, 0.024);
    disposables.push(socketGeo, bladeGeo);

    for (const s of [-1, 1]) {
      const socket = new THREE.Mesh(socketGeo, materials.carbon);
      socket.position.set(s * (headXBase - 0.04), headY - 0.01, headZ - 0.02);
      socket.scale.set(s, 1, 1);
      socket.rotation.y = s * -0.28;
      socket.rotation.x = -0.22;
      group.add(socket);

      const led = new THREE.Mesh(bladeGeo, materials.headlight);
      led.position.set(s * (headXBase + 0.04), headY - 0.005, headZ + 0.015);
      led.rotation.y = s * -0.24;
      led.rotation.z = s * 0.12;
      group.add(led);
    }
  } else if (style.headlightStyle === 'crescent_pod') {
    // Maserati MC20 GT2 high fender vertical-crescent projector housing + bright L-trim (Photo 3)
    const podGeo = new THREE.BoxGeometry(0.14, 0.075, 0.24);
    const projGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.03, 12);
    projGeo.rotateX(Math.PI / 2);
    const cBarGeo = new THREE.BoxGeometry(0.12, 0.014, 0.20);
    disposables.push(podGeo, projGeo, cBarGeo);

    for (const s of [-1, 1]) {
      const hx = s * (headXBase + 0.05);
      const hy = headY + 0.04;
      const hz = headZ - 0.12;
      const housing = new THREE.Mesh(podGeo, materials.trimDark);
      housing.position.set(hx, hy, hz);
      housing.rotation.x = -0.20;
      housing.rotation.y = s * -0.08;
      group.add(housing);

      const lens = new THREE.Mesh(projGeo, materials.headlight);
      lens.position.set(hx, hy + 0.006, hz + 0.095);
      group.add(lens);

      const trimBar = new THREE.Mesh(cBarGeo, materials.headlight);
      trimBar.position.set(hx + s * 0.015, hy - 0.024, hz + 0.01);
      trimBar.rotation.x = -0.20;
      group.add(trimBar);
    }
  } else if (style.headlightStyle === 'l_blade') {
    // Swept Ferrari longitudinal L-boomerang LED blade
    const hlMainGeo = new THREE.BoxGeometry(0.26, 0.052, 0.065);
    const hlSweptGeo = new THREE.BoxGeometry(0.032, 0.048, 0.24);
    disposables.push(hlMainGeo, hlSweptGeo);

    for (const s of [-1, 1]) {
      const hl = new THREE.Mesh(hlMainGeo, materials.headlight);
      hl.position.set(s * headXBase, headY, headZ);
      hl.rotation.y = s * -0.20;
      hl.rotation.z = s * 0.08;
      group.add(hl);

      const swept = new THREE.Mesh(hlSweptGeo, materials.headlight);
      swept.position.set(s * (headXBase + 0.10), headY + 0.035, headZ - 0.11);
      swept.rotation.x = -0.22;
      swept.rotation.y = s * -0.08;
      group.add(swept);
    }
  } else {
    const hlGeo = new THREE.BoxGeometry(splitHalfW * 0.46, 0.068, 0.055);
    disposables.push(hlGeo);
    for (const s of [-1, 1]) {
      const hl = new THREE.Mesh(hlGeo, materials.headlight);
      hl.position.set(s * headXBase, headY, headZ + 0.025);
      hl.rotation.y = s * -0.14;
      group.add(hl);
    }
  }

  // Optional Exposed Carbon Hood Center Stripe / Channel (Photo 4 McLaren 765LT)
  if (style.carbonHood) {
    const zHFront = halfL - 0.08;
    const zHBack = dim.cabinFrontZ + 0.06;
    const yHFront = dim.hoodHeight * 0.72;
    const yHBack = dim.beltHeight + 0.032;
    const cHoodVerts = new Float32Array([
      0.24, yHFront, zHFront,
      -0.24, yHFront, zHFront,
      -0.36, yHBack, zHBack,
      0.36, yHBack, zHBack,
    ]);
    const cHoodGeo = new THREE.BufferGeometry();
    cHoodGeo.setAttribute('position', new THREE.BufferAttribute(cHoodVerts, 3));
    cHoodGeo.setIndex([0, 2, 1, 0, 3, 2]);
    cHoodGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    cHoodGeo.computeVertexNormals();
    disposables.push(cHoodGeo);
    group.add(new THREE.Mesh(cHoodGeo, materials.carbon));
  }

  // Optional Twin Recessed Hood NACA Extractor Nostrils (Photo 3 Maserati MC20 GT2)
  if (style.twinNostrils) {
    const nosZ = (dim.frontAxleZ + dim.cabinFrontZ) * 0.56;
    const nosY = dim.hoodHeight * 0.96;
    const nosPadGeo = new THREE.BoxGeometry(0.28, 0.032, 0.44);
    const nosMeshGeo = new THREE.PlaneGeometry(0.24, 0.36);
    nosMeshGeo.rotateX(-Math.PI / 2);
    disposables.push(nosPadGeo, nosMeshGeo);
    for (const sx of [-0.22, 0.22]) {
      const box = new THREE.Mesh(nosPadGeo, materials.carbon);
      box.position.set(sx, nosY, nosZ);
      box.rotation.x = -0.14;
      group.add(box);

      const core = new THREE.Mesh(nosMeshGeo, materials.grille);
      core.position.set(sx, nosY + 0.018, nosZ);
      core.rotation.x = -0.14;
      group.add(core);
    }
  }

  // ── 5. Sculpted Side Aero Skirts, Rear Bargeboard Winglets & Deep Y/Hex Side Intakes ──
  const skirtLen = Math.max(0.55, waistEndZ - waistStartZ);
  const skirtCenterZ = (waistStartZ + waistEndZ) * 0.5;
  const skirtBladeGeo = new THREE.BoxGeometry(0.115, 0.028, skirtLen);
  const bargeFinGeo = buildExtrudedPolygon(
    [
      [waistStartZ + 0.24, dim.groundClearance + 0.02],
      [waistStartZ + 0.02, dim.groundClearance + 0.22],
      [waistStartZ - 0.01, dim.groundClearance + 0.20],
      [waistStartZ - 0.01, dim.groundClearance + 0.02],
    ],
    0.016,
    false
  );
  bargeFinGeo.rotateY(-Math.PI / 2);
  disposables.push(skirtBladeGeo, bargeFinGeo);

  for (const s of [-1, 1]) {
    const skirt = new THREE.Mesh(skirtBladeGeo, materials.carbon);
    skirt.position.set(s * (halfW - 0.005), dim.groundClearance + 0.018, skirtCenterZ);
    skirt.castShadow = true;
    group.add(skirt);

    const barge = new THREE.Mesh(bargeFinGeo, materials.carbon);
    barge.position.set(s * (halfW + 0.025), 0, 0);
    barge.rotation.y = s * 0.08;
    group.add(barge);
  }

  // Deep sculpted Y/hexagonal side air intakes ahead of rear arches (Photos 1, 2, 4)
  if (style.sideIntakes) {
    const scoopZ = dim.rearAxleZ + archRadius + 0.22;
    const shroudGeo = buildExtrudedPolygon(
      [
        [0.36, -0.02],
        [-0.22, 0.01],
        [-0.26, 0.31],
        [0.24, 0.26],
      ],
      0.065,
      true
    );
    shroudGeo.rotateY(-Math.PI / 2);
    const intakeGrilleGeo = new THREE.PlaneGeometry(0.34, 0.25);
    const strakeGeo = new THREE.BoxGeometry(0.095, 0.018, 0.36);
    disposables.push(shroudGeo, intakeGrilleGeo, strakeGeo);

    for (const s of [-1, 1]) {
      const shroud = new THREE.Mesh(shroudGeo, materials.carbon);
      shroud.position.set(s * (halfW - 0.045), dim.beltHeight * 0.54, scoopZ);
      shroud.rotation.y = s * -0.11;
      group.add(shroud);

      const darkCore = new THREE.Mesh(intakeGrilleGeo, materials.grille);
      darkCore.position.set(s * (halfW - 0.04), dim.beltHeight * 0.70, scoopZ);
      darkCore.rotation.y = s * (Math.PI * 0.45);
      group.add(darkCore);

      for (let st = -1; st <= 1; st++) {
        const strake = new THREE.Mesh(strakeGeo, materials.paint);
        strake.position.set(s * (halfW - 0.03), dim.beltHeight * 0.70 + st * 0.065, scoopZ - 0.02);
        group.add(strake);
      }
    }
  }

  // Italian Tricolore lower flank slash ribbon (Photo 3 MC20 GT2 detail)
  if (style.tricoloreFlank) {
    const triGeo = new THREE.BoxGeometry(0.016, 0.046, 0.86);
    disposables.push(triGeo);
    for (const s of [-1, 1]) {
      const strip = new THREE.Mesh(triGeo, materials.tricolore);
      strip.position.set(s * (halfW + 0.012), dim.beltHeight * 0.56, dim.rearAxleZ + 0.20);
      strip.rotation.x = 0.08;
      group.add(strip);
    }
  }

  // ── 6. Front Fender Wheel-Arch Louver Vents & Hood Extraction Nostrils ──
  if (style.fenderVents) {
    const fVentPadGeo = new THREE.BoxGeometry(0.20, 0.016, 0.32);
    const fLouverGeo = new THREE.BoxGeometry(0.18, 0.012, 0.032);
    disposables.push(fVentPadGeo, fLouverGeo);

    for (const s of [-1, 1]) {
      const xPos = s * (halfW * 0.76);
      const yPos = dim.wheelRadius + archRadius + 0.028;
      const zPos = dim.frontAxleZ - 0.02;

      const pad = new THREE.Mesh(fVentPadGeo, materials.trimDark);
      pad.position.set(xPos, yPos - 0.008, zPos);
      group.add(pad);

      for (let l = 0; l < 4; l++) {
        const slat = new THREE.Mesh(fLouverGeo, materials.carbon);
        slat.position.set(xPos, yPos + 0.006, zPos + 0.10 - l * 0.068);
        slat.rotation.x = 0.28;
        group.add(slat);
      }
    }
  }

  if (style.hoodVents) {
    const hBaseGeo = new THREE.BoxGeometry(0.32, 0.018, 0.34);
    const hSlatGeo = new THREE.BoxGeometry(0.28, 0.012, 0.035);
    disposables.push(hBaseGeo, hSlatGeo);

    const hoodSlope = arch === 'lamborghini' ? -0.14 : -0.10;
    const hVentZ = (dim.frontAxleZ + dim.cabinFrontZ) * 0.52;
    const hVentY = dim.hoodHeight * 0.90;

    for (const s of [-1, 1]) {
      const xCenter = s * 0.30;
      const base = new THREE.Mesh(hBaseGeo, materials.trimDark);
      base.position.set(xCenter, hVentY, hVentZ);
      base.rotation.x = hoodSlope;
      group.add(base);

      for (let l = 0; l < 3; l++) {
        const slat = new THREE.Mesh(hSlatGeo, materials.carbon);
        slat.position.set(xCenter, hVentY + 0.012 - l * 0.006, hVentZ + 0.09 - l * 0.085);
        slat.rotation.x = hoodSlope + 0.30;
        group.add(slat);
      }
    }
  }

  // ── 7. Roof Snorkel Scoop, Dorsal Shark-Fin Stabilizer & Engine Cover Louvers ──
  if (style.roofScoop) {
    const scoopCenterZ = (dim.roofFrontZ + dim.roofRearZ) * 0.45;
    const rScoopGeo = buildExtrudedPolygon(
      [
        [scoopCenterZ + 0.24, dim.cabinHeight + 0.02],
        [scoopCenterZ + 0.20, dim.cabinHeight + 0.115],
        [scoopCenterZ - 0.18, dim.cabinHeight + 0.095],
        [scoopCenterZ - 0.36, dim.cabinHeight + 0.025],
      ],
      0.26,
      true
    );
    rScoopGeo.rotateY(-Math.PI / 2);
    const mouthGeo = new THREE.PlaneGeometry(0.20, 0.068);
    disposables.push(rScoopGeo, mouthGeo);

    const rScoop = new THREE.Mesh(rScoopGeo, materials.carbon);
    rScoop.castShadow = true;
    group.add(rScoop);

    const mouth = new THREE.Mesh(mouthGeo, materials.grille);
    mouth.position.set(0, dim.cabinHeight + 0.068, scoopCenterZ + 0.232);
    group.add(mouth);
  }

  if (style.sharkFin) {
    const finStartZ = dim.roofRearZ + 0.04;
    const finEndZ = -halfL + 0.34;
    const finGeo = buildExtrudedPolygon(
      [
        [finStartZ, dim.cabinHeight + 0.02],
        [finStartZ - 0.08, dim.cabinHeight + 0.085],
        [finEndZ + 0.08, dim.trunkHeight + 0.14],
        [finEndZ, dim.trunkHeight + 0.015],
      ],
      0.018,
      false
    );
    finGeo.rotateY(-Math.PI / 2);
    disposables.push(finGeo);

    const sharkFin = new THREE.Mesh(finGeo, materials.carbon);
    sharkFin.castShadow = true;
    group.add(sharkFin);
  }

  if (style.engineLouvers) {
    const louvStartZ = dim.cabinRearZ - 0.08;
    const louvEndZ = -halfL + 0.40;
    const bayLen = Math.max(0.45, louvStartZ - louvEndZ);
    const bayMidZ = (louvStartZ + louvEndZ) * 0.5;
    const bayGeo = new THREE.BoxGeometry(0.68, 0.025, bayLen);
    const slatGeo = new THREE.BoxGeometry(0.66, 0.014, 0.065);
    disposables.push(bayGeo, slatGeo);

    const bayBaseY = THREE.MathUtils.lerp(dim.beltHeight, dim.trunkHeight, 0.52) + 0.018;
    const bayMesh = new THREE.Mesh(bayGeo, materials.grille);
    bayMesh.position.set(0, bayBaseY, bayMidZ);
    group.add(bayMesh);

    const count = 6;
    for (let i = 0; i < count; i++) {
      const zSlat = THREE.MathUtils.lerp(louvStartZ - 0.06, louvEndZ + 0.06, i / (count - 1));
      const slat = new THREE.Mesh(slatGeo, materials.carbon);
      slat.position.set(0, bayBaseY + 0.020, zSlat);
      slat.rotation.x = -0.34; // angled rear-facing heat extractors
      group.add(slat);
    }
  }

  if (style.rallyPods) {
    const podBarGeo = new THREE.BoxGeometry(0.86, 0.09, 0.10);
    const podLensGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.07, 14);
    podLensGeo.rotateX(Math.PI / 2);
    disposables.push(podBarGeo, podLensGeo);

    const podBar = new THREE.Mesh(podBarGeo, materials.carbon);
    podBar.position.set(0, dim.groundClearance + grilleH * 1.15, halfL - 0.01);
    group.add(podBar);

    for (const px of [-0.30, -0.10, 0.10, 0.30]) {
      const pod = new THREE.Mesh(podLensGeo, materials.headlight);
      pod.position.set(px, dim.groundClearance + grilleH * 1.16, halfL + 0.03);
      group.add(pod);
    }
  }

  // ── 8. Swept Aero Side Mirrors on Thin Carbon Stalks & Windshield Wipers ──
  const stalkPts = [
    [0, 0],
    [0.10, 0.045],
    [0.09, 0.065],
    [-0.02, 0.02],
  ];
  const stalkLeftGeo = buildExtrudedPolygon(stalkPts, 0.018, false);
  const stalkRightGeo = buildExtrudedPolygon(stalkPts.map(([x, y]) => [-x, y]), 0.018, false);
  const mirrorPodGeo = buildExtrudedPolygon(
    [
      [0.08, -0.025],
      [-0.06, -0.03],
      [-0.08, 0.03],
      [0.04, 0.035],
    ],
    0.13,
    true
  );
  mirrorPodGeo.rotateY(-Math.PI / 2);
  disposables.push(stalkLeftGeo, stalkRightGeo, mirrorPodGeo);

  for (const s of [-1, 1]) {
    const stalk = new THREE.Mesh(s > 0 ? stalkLeftGeo : stalkRightGeo, materials.carbon);
    stalk.position.set(s * (halfW * 0.92), dim.beltHeight + 0.03, dim.cabinFrontZ - 0.16);
    group.add(stalk);

    const pod = new THREE.Mesh(mirrorPodGeo, materials.paint);
    pod.position.set(s * (halfW * 0.92 + 0.095), dim.beltHeight + 0.088, dim.cabinFrontZ - 0.17);
    pod.rotation.y = s * -0.16;
    pod.castShadow = true;
    group.add(pod);
  }

  const wiperGeo = new THREE.BoxGeometry(0.44, 0.016, 0.02);
  disposables.push(wiperGeo);
  for (const wx of [-0.22, 0.22]) {
    const wiper = new THREE.Mesh(wiperGeo, materials.trimDark);
    wiper.position.set(wx, dim.beltHeight + 0.025, dim.cabinFrontZ - 0.02);
    wiper.rotation.z = 0.08;
    group.add(wiper);
  }

  // ── 9. Signature Taillights + 6-Fin Venturi Diffuser + Exhausts (-Z) ──
  const tailW = dim.width * dim.tailTaper * 0.84;
  const tailY = dim.trunkHeight - 0.13;
  const tailZ = -halfL + 0.015;

  // Dark perforated rear carbon fascia mesh backing the taillights
  const fasciaGeo = new THREE.PlaneGeometry(tailW * 0.96, 0.22);
  fasciaGeo.rotateY(Math.PI);
  disposables.push(fasciaGeo);
  const fasciaMesh = new THREE.Mesh(fasciaGeo, materials.grille);
  fasciaMesh.position.set(0, tailY, tailZ - 0.022);
  group.add(fasciaMesh);

  if (style.taillightStyle === 'y_arrow') {
    const spineGeo = new THREE.BoxGeometry(0.24, 0.018, 0.03);
    const armGeo = new THREE.BoxGeometry(0.10, 0.018, 0.03);
    disposables.push(spineGeo, armGeo);

    for (const s of [-1, 1]) {
      const cx = s * tailW * 0.34;
      const spine = new THREE.Mesh(spineGeo, materials.taillight);
      spine.position.set(cx, tailY, tailZ - 0.036);
      group.add(spine);

      for (const pitch of [-0.62, 0.62]) {
        const arm = new THREE.Mesh(armGeo, materials.taillight);
        arm.position.set(cx + s * 0.11, tailY + pitch * 0.055, tailZ - 0.036);
        arm.rotation.z = s * pitch;
        group.add(arm);
      }
    }
  } else if (style.taillightStyle === 'quad_ring') {
    // Classic Ferrari twin outboard circular glowing rings
    const ringGeo = new THREE.TorusGeometry(0.055, 0.015, 8, 20);
    disposables.push(ringGeo);
    for (const s of [-1, 1]) {
      for (const offset of [0.32, 0.42]) {
        const ring = new THREE.Mesh(ringGeo, materials.taillight);
        ring.position.set(s * tailW * offset, tailY, tailZ - 0.035);
        group.add(ring);
      }
    }
  } else if (style.taillightStyle === 'boomerang') {
    const bladeGeo = new THREE.BoxGeometry(0.32, 0.022, 0.03);
    const tickGeo = new THREE.BoxGeometry(0.11, 0.020, 0.03);
    disposables.push(bladeGeo, tickGeo);
    for (const s of [-1, 1]) {
      const cx = s * tailW * 0.33;
      const blade = new THREE.Mesh(bladeGeo, materials.taillight);
      blade.position.set(cx, tailY + 0.01, tailZ - 0.035);
      blade.rotation.z = s * 0.08;
      group.add(blade);

      const tick = new THREE.Mesh(tickGeo, materials.taillight);
      tick.position.set(cx + s * 0.13, tailY - 0.032, tailZ - 0.035);
      tick.rotation.z = s * -0.58;
      group.add(tick);
    }
  } else {
    const tailBarGeo = new THREE.BoxGeometry(tailW * 0.88, 0.048, 0.045);
    disposables.push(tailBarGeo);
    const tailBar = new THREE.Mesh(tailBarGeo, materials.taillight);
    tailBar.position.set(0, tailY, tailZ - 0.032);
    group.add(tailBar);
  }

  // Sculpted 6-Fin Venturi Rear Diffuser
  const diffW = tailW * 0.90;
  const diffTrayGeo = new THREE.BoxGeometry(diffW, 0.045, 0.32);
  const diffFinGeo = buildExtrudedPolygon(
    [
      [-halfL + 0.26, dim.groundClearance + 0.03],
      [-halfL - 0.10, dim.groundClearance + 0.01],
      [-halfL - 0.13, dim.groundClearance + 0.22],
      [-halfL + 0.16, dim.groundClearance + 0.23],
    ],
    0.018,
    false
  );
  diffFinGeo.rotateY(-Math.PI / 2);
  disposables.push(diffTrayGeo, diffFinGeo);

  const diffTray = new THREE.Mesh(diffTrayGeo, materials.carbon);
  diffTray.position.set(0, dim.groundClearance + 0.06, -halfL + 0.04);
  diffTray.rotation.x = 0.24;
  group.add(diffTray);

  for (const fx of [-0.42, -0.25, -0.09, 0.09, 0.25, 0.42]) {
    const fin = new THREE.Mesh(diffFinGeo, materials.carbon);
    fin.position.set(fx * diffW, 0, 0);
    fin.castShadow = true;
    group.add(fin);
  }

  // Signature Exhaust Pipes (hex_high for Lamborghini, quad for Maserati, dual_center for Ferrari/Rally)
  if (style.exhaustLayout === 'hex_high') {
    const hexPipeGeo = new THREE.CylinderGeometry(0.068, 0.068, 0.15, 6);
    hexPipeGeo.rotateX(Math.PI / 2);
    const hexHoleGeo = new THREE.CylinderGeometry(0.052, 0.052, 0.03, 6);
    hexHoleGeo.rotateX(Math.PI / 2);
    disposables.push(hexPipeGeo, hexHoleGeo);

    for (const ex of [-0.11, 0.11]) {
      const pipe = new THREE.Mesh(hexPipeGeo, materials.chrome);
      pipe.position.set(ex, tailY - 0.065, -halfL - 0.025);
      group.add(pipe);

      const hole = new THREE.Mesh(hexHoleGeo, materials.exhaustInner);
      hole.position.set(ex, tailY - 0.065, -halfL - 0.092);
      group.add(hole);
    }
  } else {
    const exPipeGeo = new THREE.CylinderGeometry(0.048, 0.048, 0.16, 14);
    exPipeGeo.rotateX(Math.PI / 2);
    const exHoleGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.03, 12);
    exHoleGeo.rotateX(Math.PI / 2);
    disposables.push(exPipeGeo, exHoleGeo);

    const exPositions =
      style.exhaustLayout === 'quad'
        ? [-0.50, -0.38, 0.38, 0.50]
        : [-0.085, 0.085];

    for (const ex of exPositions) {
      const pipe = new THREE.Mesh(exPipeGeo, materials.chrome);
      pipe.position.set(ex, dim.groundClearance + 0.135, -halfL - 0.03);
      group.add(pipe);

      const hole = new THREE.Mesh(exHoleGeo, materials.exhaustInner);
      hole.position.set(ex, dim.groundClearance + 0.135, -halfL - 0.102);
      group.add(hole);
    }
  }

  // License Plate ("APEX-01")
  const plateGeo = new THREE.PlaneGeometry(0.42, 0.105);
  disposables.push(plateGeo);
  const plateMesh = new THREE.Mesh(plateGeo, materials.plate);
  plateMesh.position.set(0, dim.groundClearance + 0.29, -halfL - 0.015);
  plateMesh.rotation.y = Math.PI;
  group.add(plateMesh);

  // ── 10. Razor-Sharp Cambered Swept Airfoil Rear Wings by Archetype ──
  const wingZ = -halfL + 0.14;
  const wingBaseY = dim.trunkHeight;

  if (style.wingStyle === 'svj_swan') {
    // Lamborghini SVJ Corsa wide cambered swan-neck GT wing + sharp ALA pylons & serrated endplates
    const wingSpan = dim.width * 0.99;
    const wingY = wingBaseY + 0.32;
    const wingPosZ = wingZ - 0.06;

    const foilGeo = buildSweptAirfoilGeo({
      span: wingSpan,
      centerChord: 0.34,
      tipChord: 0.25,
      camber: 0.055,
      thickness: 0.026,
      sweep: 0.15,
      dihedral: -0.028,
      gurneyHeight: 0.022,
    });
    const swanArmGeo = buildExtrudedPolygon(
      [
        [wingPosZ + 0.32, wingBaseY - 0.02],
        [wingPosZ + 0.16, wingY + 0.08],
        [wingPosZ - 0.02, wingY + 0.065],
        [wingPosZ + 0.02, wingY + 0.01],
        [wingPosZ + 0.16, wingY + 0.02],
        [wingPosZ + 0.24, wingBaseY - 0.02],
      ],
      0.020,
      false
    );
    swanArmGeo.rotateY(-Math.PI / 2);

    const endPlateGeo = buildExtrudedPolygon(
      [
        [wingPosZ + 0.06, wingY - 0.08],
        [wingPosZ + 0.18, wingY + 0.11],
        [wingPosZ - 0.26, wingY + 0.13],
        [wingPosZ - 0.32, wingY - 0.03],
        [wingPosZ - 0.18, wingY - 0.13],
      ],
      0.016,
      true
    );
    endPlateGeo.rotateY(-Math.PI / 2);
    disposables.push(foilGeo, swanArmGeo, endPlateGeo);

    const foil = new THREE.Mesh(foilGeo, materials.carbon);
    foil.position.set(0, wingY, wingPosZ);
    foil.rotation.x = -0.14;
    foil.castShadow = true;
    group.add(foil);

    for (const s of [-1, 1]) {
      const pylon = new THREE.Mesh(swanArmGeo, materials.carbon);
      pylon.position.set(s * 0.34, 0, 0);
      pylon.castShadow = true;
      group.add(pylon);

      const endPlate = new THREE.Mesh(endPlateGeo, materials.paint);
      endPlate.position.set(s * (wingSpan * 0.505), 0, 0);
      endPlate.castShadow = true;
      group.add(endPlate);
    }
  } else if (style.wingStyle === 'ferrari_gt') {
    // Ferrari Pista / 488 Challenge GT3 swept cambered airfoil + dual swept pylons & blade endplates
    const wingSpan = dim.width * 0.94;
    const wingY = wingBaseY + 0.24;
    const wingPosZ = wingZ - 0.03;

    const foilGeo = buildSweptAirfoilGeo({
      span: wingSpan,
      centerChord: 0.30,
      tipChord: 0.23,
      camber: 0.048,
      thickness: 0.024,
      sweep: 0.11,
      dihedral: 0.022,
      gurneyHeight: 0.018,
    });
    const pylonGeo = buildExtrudedPolygon(
      [
        [wingPosZ + 0.14, wingBaseY - 0.01],
        [wingPosZ + 0.02, wingY],
        [wingPosZ - 0.11, wingY],
        [wingPosZ + 0.02, wingBaseY - 0.01],
      ],
      0.018,
      false
    );
    pylonGeo.rotateY(-Math.PI / 2);

    const endPlateGeo = buildExtrudedPolygon(
      [
        [wingPosZ + 0.04, wingY - 0.06],
        [wingPosZ + 0.14, wingY + 0.09],
        [wingPosZ - 0.22, wingY + 0.10],
        [wingPosZ - 0.26, wingY - 0.04],
      ],
      0.015,
      true
    );
    endPlateGeo.rotateY(-Math.PI / 2);
    disposables.push(foilGeo, pylonGeo, endPlateGeo);

    const foil = new THREE.Mesh(foilGeo, materials.carbon);
    foil.position.set(0, wingY, wingPosZ);
    foil.rotation.x = -0.11;
    foil.castShadow = true;
    group.add(foil);

    for (const s of [-1, 1]) {
      const pylon = new THREE.Mesh(pylonGeo, materials.trimDark);
      pylon.position.set(s * 0.36, 0, 0);
      group.add(pylon);

      const endPlate = new THREE.Mesh(endPlateGeo, materials.paint);
      endPlate.position.set(s * (wingSpan * 0.505), 0, 0);
      endPlate.castShadow = true;
      group.add(endPlate);
    }
  } else if (style.wingStyle === 'maserati_blade') {
    // Maserati MC20 GT2 tall wide swan-neck carbon race wing (Photo 3)
    const wingSpan = dim.width * 0.99;
    const wingY = wingBaseY + 0.31;
    const wingPosZ = wingZ - 0.05;

    const foilGeo = buildSweptAirfoilGeo({
      span: wingSpan,
      centerChord: 0.31,
      tipChord: 0.24,
      camber: 0.048,
      thickness: 0.024,
      sweep: 0.13,
      dihedral: -0.02,
      gurneyHeight: 0.020,
    });
    const pylonGeo = buildExtrudedPolygon(
      [
        [wingPosZ + 0.18, wingBaseY - 0.02],
        [wingPosZ + 0.08, wingY + 0.06],
        [wingPosZ - 0.06, wingY + 0.05],
        [wingPosZ + 0.06, wingBaseY - 0.02],
      ],
      0.018,
      false
    );
    pylonGeo.rotateY(-Math.PI / 2);

    const endPlateGeo = buildExtrudedPolygon(
      [
        [wingPosZ + 0.05, wingY - 0.07],
        [wingPosZ + 0.15, wingY + 0.09],
        [wingPosZ - 0.24, wingY + 0.10],
        [wingPosZ - 0.26, wingY - 0.06],
      ],
      0.015,
      true
    );
    endPlateGeo.rotateY(-Math.PI / 2);
    disposables.push(foilGeo, pylonGeo, endPlateGeo);

    const foil = new THREE.Mesh(foilGeo, materials.carbon);
    foil.position.set(0, wingY, wingPosZ);
    foil.rotation.x = -0.11;
    foil.castShadow = true;
    group.add(foil);

    for (const s of [-1, 1]) {
      const pylon = new THREE.Mesh(pylonGeo, materials.carbon);
      pylon.position.set(s * 0.44, 0, 0);
      group.add(pylon);

      const endPlate = new THREE.Mesh(endPlateGeo, materials.paint);
      endPlate.position.set(s * (wingSpan * 0.505), 0, 0);
      endPlate.castShadow = true;
      group.add(endPlate);
    }
  } else if (style.wingStyle === 'active_ducktail') {
    // Sleek sculpted wide active Kamm-tail aero blade on twin actuators (Photos 1 & 2 Roadster style)
    const wingSpan = dim.width * 0.78;
    const wingY = wingBaseY + 0.085;
    const wingPosZ = wingZ - 0.02;

    const foilGeo = buildSweptAirfoilGeo({
      span: wingSpan,
      centerChord: 0.21,
      tipChord: 0.15,
      camber: 0.036,
      thickness: 0.020,
      sweep: 0.08,
      dihedral: 0.022,
      gurneyHeight: 0.014,
    });
    const strutGeo = new THREE.BoxGeometry(0.022, 0.09, 0.09);
    disposables.push(foilGeo, strutGeo);

    const foil = new THREE.Mesh(foilGeo, materials.paint);
    foil.position.set(0, wingY, wingPosZ);
    foil.rotation.x = -0.14;
    foil.castShadow = true;
    group.add(foil);

    for (const sx of [-0.34, 0.34]) {
      const strut = new THREE.Mesh(strutGeo, materials.carbon);
      strut.position.set(sx, wingBaseY + 0.038, wingPosZ + 0.02);
      group.add(strut);
    }
  } else if (style.wingStyle === 'rally_dual') {
    // WRC Rally1 Bi-Plane Hatch Wing with Dual Cambered Airfoils & Strut Fins
    const wingSpan = dim.width * 0.86;
    const topY = dim.cabinHeight + 0.04;
    const lowY = topY - 0.13;
    const wingPosZ = -halfL + 0.12;

    const upperFoilGeo = buildSweptAirfoilGeo({
      span: wingSpan,
      centerChord: 0.28,
      tipChord: 0.26,
      camber: 0.042,
      thickness: 0.024,
      sweep: 0.06,
      dihedral: 0.0,
      gurneyHeight: 0.020,
    });
    const lowerFoilGeo = buildSweptAirfoilGeo({
      span: wingSpan * 0.94,
      centerChord: 0.20,
      tipChord: 0.18,
      camber: 0.030,
      thickness: 0.018,
      sweep: 0.04,
      dihedral: 0.0,
      gurneyHeight: 0.012,
    });
    const endPlateGeo = buildExtrudedPolygon(
      [
        [wingPosZ + 0.22, lowY - 0.12],
        [wingPosZ + 0.16, topY + 0.08],
        [wingPosZ - 0.18, topY + 0.09],
        [wingPosZ - 0.16, lowY - 0.12],
      ],
      0.018,
      true
    );
    endPlateGeo.rotateY(-Math.PI / 2);
    const finGeo = new THREE.BoxGeometry(0.014, 0.13, 0.20);
    disposables.push(upperFoilGeo, lowerFoilGeo, endPlateGeo, finGeo);

    const upperFoil = new THREE.Mesh(upperFoilGeo, materials.paint);
    upperFoil.position.set(0, topY, wingPosZ);
    upperFoil.rotation.x = -0.10;
    upperFoil.castShadow = true;
    group.add(upperFoil);

    const lowerFoil = new THREE.Mesh(lowerFoilGeo, materials.carbon);
    lowerFoil.position.set(0, lowY, wingPosZ + 0.03);
    lowerFoil.rotation.x = -0.06;
    group.add(lowerFoil);

    for (const fx of [-0.22, 0.22]) {
      const innerFin = new THREE.Mesh(finGeo, materials.carbon);
      innerFin.position.set(fx, (topY + lowY) * 0.5, wingPosZ + 0.01);
      group.add(innerFin);
    }

    for (const s of [-1, 1]) {
      const endPlate = new THREE.Mesh(endPlateGeo, materials.paint);
      endPlate.position.set(s * (wingSpan * 0.505), 0, 0);
      endPlate.castShadow = true;
      group.add(endPlate);
    }
  }

  return group;
}

/**
 * Build a complete procedural 3D vehicle with clean wheel pivots, interior, and materials.
 * @param {string} carId
 * @param {{ paintHex?: number }} [options]
 */
export function buildCarModel(carId, options = {}) {
  const spec = getCarSpec(carId);
  const paintHex = options.paintHex ?? spec.defaultPaint;
  const materials = createCarMaterialSet(spec, paintHex);
  const disposables = [];

  const root = new THREE.Group();
  root.name = `car_${spec.id}`;

  const chassisMeshGroup = new THREE.Group();
  chassisMeshGroup.name = 'chassis';
  root.add(chassisMeshGroup);

  const dim = spec.dimensions;
  const { archRadius, xInnerTub } = computeArchClearance(dim);

  // 1. Lofted 24-station exotic body shell
  const hullGeo = buildLoftedHullGeometry(spec, archRadius, xInnerTub);
  disposables.push(hullGeo);
  const hullMesh = new THREE.Mesh(hullGeo, materials.paint);
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  chassisMeshGroup.add(hullMesh);

  // 2. 4 Wheel-Arch Assemblies (dark innerWheelWell + flush outer fender flare)
  const archPlacements = [
    { xSign: 1, z: dim.frontAxleZ },
    { xSign: -1, z: dim.frontAxleZ },
    { xSign: 1, z: dim.rearAxleZ },
    { xSign: -1, z: dim.rearAxleZ },
  ];
  for (const ap of archPlacements) {
    chassisMeshGroup.add(
      buildWheelArchAssembly(ap.xSign, ap.z, spec, archRadius, xInnerTub, materials, disposables)
    );
  }

  // 3. Partial Interior + Semi-Transparent Greenhouse with Flying Buttresses
  chassisMeshGroup.add(buildPartialInterior(spec, materials, disposables));
  chassisMeshGroup.add(buildGreenhouse(spec, materials, disposables));

  // 4. Exterior Aero Trim (splitters, canards, swept airfoils, diffusers, louvers, LED signatures)
  chassisMeshGroup.add(buildExteriorTrim(spec, archRadius, materials, disposables));

  // Batch static chassis sub-meshes by material so 8 real-physics cars stay low on draw calls
  batchGroupByMaterial(chassisMeshGroup, disposables);

  // Optional lightweight additive night headlight cones
  const coneGeo = new THREE.ConeGeometry(1.1, 8.5, 12, 1, true);
  coneGeo.rotateX(-Math.PI / 2);
  coneGeo.translate(0, 0, 4.25);
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xdbeafe,
    transparent: true,
    opacity: 0.09,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  disposables.push(coneGeo, coneMat);
  const headlightConesGroup = new THREE.Group();
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(coneGeo, coneMat);
    c.position.set(s * dim.width * dim.noseTaper * 0.32, dim.hoodHeight * 0.68, dim.length * 0.5);
    headlightConesGroup.add(c);
  }
  headlightConesGroup.visible = false;
  chassisMeshGroup.add(headlightConesGroup);

  // Soft grounded ambient-occlusion contact shadow beneath chassis
  const shadowGeo = new THREE.PlaneGeometry(dim.width * 1.24, dim.length * 1.12);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: getContactShadowTexture(),
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  disposables.push(shadowGeo, shadowMat);
  const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
  contactShadow.position.set(0, 0.022, 0);
  contactShadow.renderOrder = 1;
  root.add(contactShadow);

  // 5. 4 Independent Wheels [FL, FR, RL, RR] with Rule #2 clean hierarchy
  const wheelPlacements = [
    { isFront: true, isLeft: true, x: dim.trackHalfWidth, z: dim.frontAxleZ },
    { isFront: true, isLeft: false, x: -dim.trackHalfWidth, z: dim.frontAxleZ },
    { isFront: false, isLeft: true, x: dim.trackHalfWidth, z: dim.rearAxleZ },
    { isFront: false, isLeft: false, x: -dim.trackHalfWidth, z: dim.rearAxleZ },
  ];

  const wheels = wheelPlacements.map((wp) => {
    const w = createWheelMesh({
      radius: dim.wheelRadius,
      width: dim.wheelWidth,
      isFront: wp.isFront,
      isLeft: wp.isLeft,
      style: spec.styling.rimStyle,
      materials,
    });
    w.root.position.set(wp.x, dim.wheelRadius, wp.z);
    root.add(w.root);
    return w;
  });

  let spinAngle = 0;

  return {
    root,
    chassisGroup: chassisMeshGroup,
    contactShadow,
    wheels,
    spec,
    materials,
    clearance: { archRadius, xInnerTub },
    setPaint(hex) {
      materials.paint.color.setHex(hex);
    },
    setBrakeLights(active) {
      materials.taillight.emissiveIntensity = active ? 3.4 : 1.1;
      materials.taillight.emissive.setHex(active ? 0xff1a1a : 0x990b0b);
    },
    setHeadlights(active) {
      materials.headlight.emissiveIntensity = active ? 3.2 : 1.4;
      headlightConesGroup.visible = Boolean(active);
    },
    steerWheels(rad) {
      for (const w of wheels) {
        if (w.isFront) {
          w.steerGroup.rotation.y = rad;
        }
      }
    },
    spinWheels(rad) {
      spinAngle = rad;
      for (const w of wheels) {
        w.spinGroup.rotation.x = spinAngle;
      }
    },
    setWheelSpin(index, rad) {
      if (wheels[index]) {
        wheels[index].spinGroup.rotation.x = rad;
      }
    },
    dispose() {
      for (const item of disposables) {
        item.dispose();
      }
      for (const w of wheels) {
        w.dispose();
      }
      materials.dispose();
    },
  };
}
