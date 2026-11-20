import * as THREE from 'three';
import { batchGroupByMaterial } from '../utils/meshBatcher.js';

/**
 * Procedural 3D Wheel Builder enforcing Rule #2:
 *   root -> steerGroup (Y-yaw only) -> spinGroup (X-roll only)
 * - Brake caliper attaches to `steerGroup` so it stays stationary while rotor spins.
 * - `spinGroup` local origin is strictly (0, 0, 0) with baked rotateZ(PI/2) geometries.
 */

function createTireGeometry(radius, width) {
  const halfW = width * 0.5;
  const rInner = radius * 0.62;
  const rMidLow = rInner + (radius - rInner) * 0.34;
  const rMidHigh = rInner + (radius - rInner) * 0.78;
  const rShoulder = radius * 0.985;

  const profile = [
    new THREE.Vector2(rInner * 0.94, -halfW * 0.78),
    new THREE.Vector2(rInner, -halfW * 0.84),
    new THREE.Vector2(rMidLow, -halfW * 0.97),
    new THREE.Vector2(rMidHigh, -halfW * 0.99),
    new THREE.Vector2(rShoulder, -halfW * 0.86),
    new THREE.Vector2(radius, -halfW * 0.64),
    new THREE.Vector2(radius, 0),
    new THREE.Vector2(radius, halfW * 0.64),
    new THREE.Vector2(rShoulder, halfW * 0.86),
    new THREE.Vector2(rMidHigh, halfW * 0.99),
    new THREE.Vector2(rMidLow, halfW * 0.97),
    new THREE.Vector2(rInner, halfW * 0.84),
    new THREE.Vector2(rInner * 0.94, halfW * 0.78),
  ];

  const geo = new THREE.LatheGeometry(profile, 32);
  // Map Lathe Y-axis onto X-axis so spinGroup.rotation.x rolls tire forward in Y-Z plane
  geo.rotateZ(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function buildRimGroup(radius, width, style, materials, disposables) {
  const rimGroup = new THREE.Group();
  const rRim = radius * 0.635;
  const halfW = width * 0.5;

  // Rim barrel (open cylinder with stepped lip)
  const barrelGeo = new THREE.CylinderGeometry(rRim, rRim * 0.96, width * 0.82, 24, 1, true);
  barrelGeo.rotateZ(Math.PI / 2);
  disposables.push(barrelGeo);
  const barrelMat = materials.rim.clone();
  barrelMat.side = THREE.DoubleSide;
  disposables.push(barrelMat);
  const barrelMesh = new THREE.Mesh(barrelGeo, barrelMat);
  rimGroup.add(barrelMesh);

  // Outer stepped lip ring (+X is outward in rim local space)
  const lipGeo = new THREE.TorusGeometry(rRim * 0.985, width * 0.055, 8, 28);
  lipGeo.rotateY(Math.PI / 2);
  disposables.push(lipGeo);
  const lipMesh = new THREE.Mesh(lipGeo, materials.chrome);
  lipMesh.position.x = halfW * 0.76;
  rimGroup.add(lipMesh);

  // Center hub cap
  const hubRadius = rRim * 0.28;
  const hubGeo = new THREE.CylinderGeometry(hubRadius, hubRadius * 1.12, width * 0.24, 16);
  hubGeo.rotateZ(Math.PI / 2);
  disposables.push(hubGeo);
  const hubMesh = new THREE.Mesh(hubGeo, materials.rim);
  hubMesh.position.x = halfW * 0.54;
  rimGroup.add(hubMesh);

  if (style === 'centerlock') {
    const lockGeo = new THREE.CylinderGeometry(hubRadius * 0.55, hubRadius * 0.62, width * 0.28, 6);
    lockGeo.rotateZ(Math.PI / 2);
    disposables.push(lockGeo);
    const lockMesh = new THREE.Mesh(lockGeo, materials.caliper);
    lockMesh.position.x = halfW * 0.6;
    rimGroup.add(lockMesh);
  } else {
    // 5 Lug nuts
    const lugGeo = new THREE.CylinderGeometry(0.011, 0.011, width * 0.14, 8);
    lugGeo.rotateZ(Math.PI / 2);
    disposables.push(lugGeo);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const lug = new THREE.Mesh(lugGeo, materials.chrome);
      lug.position.set(halfW * 0.64, Math.cos(a) * hubRadius * 0.65, Math.sin(a) * hubRadius * 0.65);
      rimGroup.add(lug);
    }
  }

  // Spokes radiating from hub to barrel lip
  const spokeLen = rRim * 0.95 - hubRadius * 0.6;
  const spokeMidR = hubRadius * 0.6 + spokeLen * 0.5;
  const spokeX = style === 'deep5' ? halfW * 0.46 : halfW * 0.62;

  if (style === 'twin5') {
    const spokeGeo = new THREE.BoxGeometry(width * 0.12, spokeLen, 0.022);
    disposables.push(spokeGeo);
    for (let i = 0; i < 5; i++) {
      const baseAngle = (i / 5) * Math.PI * 2;
      for (const offset of [-0.14, 0.14]) {
        const a = baseAngle + offset;
        const spoke = new THREE.Mesh(spokeGeo, materials.rim);
        spoke.position.set(spokeX, Math.cos(a) * spokeMidR, Math.sin(a) * spokeMidR);
        spoke.rotation.x = a;
        rimGroup.add(spoke);
      }
    }
  } else if (style === 'deep5') {
    const spokeGeo = new THREE.BoxGeometry(width * 0.17, spokeLen, 0.048);
    disposables.push(spokeGeo);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spoke = new THREE.Mesh(spokeGeo, materials.rim);
      spoke.position.set(spokeX, Math.cos(a) * spokeMidR, Math.sin(a) * spokeMidR);
      spoke.rotation.x = a;
      spoke.rotation.z = -0.15; // subtle dish angle
      rimGroup.add(spoke);
    }
  } else if (style === 'y_mesh') {
    // Intricate 10-arm forged spider Y-mesh (matching studio Roadster reference wheels)
    const innerGeo = new THREE.BoxGeometry(width * 0.10, spokeLen * 0.44, 0.016);
    const outerGeo = new THREE.BoxGeometry(width * 0.09, spokeLen * 0.62, 0.014);
    disposables.push(innerGeo, outerGeo);
    const innerR = hubRadius * 0.65 + spokeLen * 0.22;
    const outerR = hubRadius * 0.65 + spokeLen * 0.70;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const stem = new THREE.Mesh(innerGeo, materials.rim);
      stem.position.set(spokeX - 0.008, Math.cos(a) * innerR, Math.sin(a) * innerR);
      stem.rotation.x = a;
      rimGroup.add(stem);

      for (const split of [-0.14, 0.14]) {
        const bAng = a + split * 0.55;
        const arm = new THREE.Mesh(outerGeo, materials.rim);
        arm.position.set(spokeX + 0.004, Math.cos(bAng) * outerR, Math.sin(bAng) * outerR);
        arm.rotation.x = a + split;
        rimGroup.add(arm);
      }
    }
  } else if (style === 'multi10') {
    const spokeGeo = new THREE.BoxGeometry(width * 0.11, spokeLen, 0.022);
    disposables.push(spokeGeo);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const spoke = new THREE.Mesh(spokeGeo, materials.rim);
      spoke.position.set(spokeX, Math.cos(a) * spokeMidR, Math.sin(a) * spokeMidR);
      spoke.rotation.x = a;
      rimGroup.add(spoke);
    }
  } else {
    // Deep concave centerlock forged Y-spoke
    const innerGeo = new THREE.BoxGeometry(width * 0.12, spokeLen * 0.42, 0.019);
    const spokeGeo = new THREE.BoxGeometry(width * 0.10, spokeLen * 0.65, 0.017);
    disposables.push(innerGeo, spokeGeo);
    const innerR = hubRadius * 0.6 + spokeLen * 0.20;
    const outerR = hubRadius * 0.6 + spokeLen * 0.68;
    for (let i = 0; i < 7; i++) {
      const baseA = (i / 7) * Math.PI * 2;
      const stem = new THREE.Mesh(innerGeo, materials.rim);
      stem.position.set(spokeX - 0.01, Math.cos(baseA) * innerR, Math.sin(baseA) * innerR);
      stem.rotation.x = baseA;
      rimGroup.add(stem);

      for (const split of [-0.15, 0.15]) {
        const a = baseA + split * 0.65;
        const spoke = new THREE.Mesh(spokeGeo, materials.rim);
        spoke.position.set(spokeX + 0.005, Math.cos(a) * outerR, Math.sin(a) * outerR);
        spoke.rotation.x = baseA + split;
        rimGroup.add(spoke);
      }
    }
  }

  return rimGroup;
}

/**
 * Create a complete wheel assembly with clean steer & spin hierarchy.
 * @param {{ radius: number, width: number, isFront: boolean, isLeft: boolean, style: string, materials: object }} params
 */
export function createWheelMesh({ radius, width, isFront, isLeft, style, materials }) {
  const disposables = [];
  const root = new THREE.Group();
  root.name = `wheel_${isFront ? 'F' : 'R'}_${isLeft ? 'L' : 'R'}`;

  const steerGroup = new THREE.Group();
  steerGroup.name = 'steerGroup';
  root.add(steerGroup);

  const spinGroup = new THREE.Group();
  spinGroup.name = 'spinGroup';
  spinGroup.position.set(0, 0, 0); // Strictly centered at axle origin
  steerGroup.add(spinGroup);

  // 1. Curved LatheGeometry Tire
  const tireGeo = createTireGeometry(radius, width);
  disposables.push(tireGeo);
  const tireMesh = new THREE.Mesh(tireGeo, materials.tire);
  tireMesh.castShadow = true;
  tireMesh.receiveShadow = true;
  spinGroup.add(tireMesh);

  // 2. Alloy Rim (oriented so outer face points +X on left, -X on right without negative scaling)
  const rimGroup = buildRimGroup(radius, width, style, materials, disposables);
  batchGroupByMaterial(rimGroup, disposables);
  rimGroup.rotation.y = isLeft ? 0 : Math.PI;
  spinGroup.add(rimGroup);

  // 3. Drilled Brake Rotor (spins inside spinGroup)
  const rotorRadius = radius * 0.54;
  const rotorGeo = new THREE.CylinderGeometry(rotorRadius, rotorRadius, 0.026, 24);
  rotorGeo.rotateZ(Math.PI / 2);
  disposables.push(rotorGeo);
  const rotorMesh = new THREE.Mesh(rotorGeo, materials.rotor);
  rotorMesh.position.x = isLeft ? width * 0.04 : -width * 0.04;
  spinGroup.add(rotorMesh);

  // 4. Stationary Brake Caliper (attached to steerGroup — never spins!)
  const caliperGeo = new THREE.BoxGeometry(0.068, rotorRadius * 0.55, rotorRadius * 0.38);
  disposables.push(caliperGeo);
  const caliperMesh = new THREE.Mesh(caliperGeo, materials.caliper);
  const calAngle = isFront ? -Math.PI * 0.22 : Math.PI * 0.22; // Mounted toward center of wheelbase
  const calDist = rotorRadius * 0.84;
  caliperMesh.position.set(
    isLeft ? width * 0.06 : -width * 0.06,
    Math.cos(calAngle) * calDist,
    Math.sin(calAngle) * calDist
  );
  caliperMesh.rotation.x = -calAngle;
  steerGroup.add(caliperMesh);

  return {
    root,
    steerGroup,
    spinGroup,
    radius,
    width,
    isFront,
    isLeft,
    dispose() {
      for (const item of disposables) {
        item.dispose();
      }
    },
  };
}
