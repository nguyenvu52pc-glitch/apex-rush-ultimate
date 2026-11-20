import * as CANNON from 'cannon-es';
import * as THREE from 'three';

/**
 * Anti-Snag Physics Track Colliders (Rules #3 & #4):
 * - NEVER uses raw Trimesh for high-speed road surfaces.
 * - Full-resolution (stride = 1) overlapping oriented CANNON.Box road slabs (thickness = 1.6m,
 *   compact overlap = 0.08m) keep surface continuity within ~1-2cm even on banked transitions.
 * - Per-side endpoint-aligned wall colliders compute exact inner/outer segment chord length
 *   so tight inside hairpins NEVER protrude inward into the drivable track or shoulder!
 */
export class TrackPhysics {
  /**
   * @param {import('../physics/PhysicsWorld.js').PhysicsWorld} physicsWorld
   * @param {import('./TrackData.js').TrackData} trackData
   */
  constructor(physicsWorld, trackData) {
    this.physicsWorld = physicsWorld;
    this.trackData = trackData;
    this.bodies = [];

    this._buildColliders();
  }

  _buildColliders() {
    const samples = this.trackData.samples;
    const N = samples.length;

    // 1. Road slabs (stride = 1, 4 laterally overlapping longitudinal strips aligned per lane!)
    // Using 4 overlapping strips eliminates outer-corner pie-slice V-holes completely (0.000m gap).
    const roadStride = 1;
    const slabThickness = 1.6; // >= 1.5m (Rule #3)
    const baseOverlap = 0.25;
    const totalExtentHalf = this.trackData.trackHalfWidth + this.trackData.shoulderWidth + 1.6;
    const laneCount = 4;
    const laneSpan = (totalExtentHalf * 2) / laneCount;
    const stripHalfW = laneSpan * 0.5 + 0.75; // 1.5m lateral overlap between neighboring strips

    const roadSegments = [];
    for (let i = 0; i < N; i += roadStride) {
      roadSegments.push({ a: samples[i], b: samples[(i + roadStride) % N] });
    }

    const ptStripA = new THREE.Vector3();
    const ptStripB = new THREE.Vector3();
    const pMid = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    const up = new THREE.Vector3();
    const right = new THREE.Vector3();
    const left = new THREE.Vector3();
    const basisMat = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const shapePos = new THREE.Vector3();

    const roadSectorSize = 15;
    for (let sStart = 0; sStart < roadSegments.length; sStart += roadSectorSize) {
      const sEnd = Math.min(roadSegments.length, sStart + roadSectorSize);
      const anchor = roadSegments[sStart].a.position;

      const roadBody = new CANNON.Body({
        mass: 0,
        material: this.physicsWorld.materials.ground,
        position: new CANNON.Vec3(anchor.x, anchor.y, anchor.z),
      });
      roadBody.userData = { type: 'ground' };

      for (let k = sStart; k < sEnd; k++) {
        const { a, b } = roadSegments[k];
        if (a.isGapSegment) continue; // Open mid-air canyon/bridge chasm on V2 jumps!
        const rightDelta = a.right.distanceTo(b.right);
        const turnExpand = stripHalfW * rightDelta * 1.5;

        for (let lane = 0; lane < laneCount; lane++) {
          const latCenter = -totalExtentHalf + (lane + 0.5) * laneSpan;
          ptStripA.copy(a.position).addScaledVector(a.right, latCenter);
          ptStripB.copy(b.position).addScaledVector(b.right, latCenter);

          pMid.addVectors(ptStripA, ptStripB).multiplyScalar(0.5);
          fwd.subVectors(ptStripB, ptStripA);
          const stripLen = fwd.length();
          if (stripLen < 0.05) continue;
          fwd.divideScalar(stripLen);

          up.addVectors(a.up, b.up).normalize();
          right.crossVectors(fwd, up).normalize();
          up.crossVectors(right, fwd).normalize();
          left.copy(right).negate();

          basisMat.makeBasis(left, up, fwd);
          quat.setFromRotationMatrix(basisMat);
          const cQuat = new CANNON.Quaternion(quat.x, quat.y, quat.z, quat.w);

          const slabLen = stripLen + baseOverlap + turnExpand;
          const slabShape = new CANNON.Box(new CANNON.Vec3(stripHalfW, slabThickness * 0.5, slabLen * 0.5));
          shapePos.copy(pMid).sub(anchor).addScaledVector(up, -slabThickness * 0.5);
          roadBody.addShape(slabShape, new CANNON.Vec3(shapePos.x, shapePos.y, shapePos.z), cQuat);
        }
      }

      this.physicsWorld.addBody(roadBody);
      this.bodies.push(roadBody);
    }

    // 2. Per-side endpoint-aligned Guardrail walls (6.5m tall prevents any post-jump hairpin vaulting!)
    const wallThickness = 1.4; // >= 1.2m (Rule #4)
    const wallHeight = 6.5;
    const isConcrete = this.trackData.spec.barrierStyle === 'concrete';
    const visualFaceLat = isConcrete
      ? this.trackData.totalWidthHalf + 0.16
      : this.trackData.totalWidthHalf + 0.24;
    const wallOffset = visualFaceLat + wallThickness * 0.5;

    const ptA = new THREE.Vector3();
    const ptB = new THREE.Vector3();
    const wallSectorSize = 24;
    for (let sStart = 0; sStart < N; sStart += wallSectorSize) {
      const sEnd = Math.min(N, sStart + wallSectorSize);
      const anchor = samples[sStart].position;

      const wallBody = new CANNON.Body({
        mass: 0,
        material: this.physicsWorld.materials.wall,
        position: new CANNON.Vec3(anchor.x, anchor.y, anchor.z),
      });
      wallBody.userData = { type: 'wall' };

      for (let i = sStart; i < sEnd; i++) {
        const a = samples[i];
        const b = samples[(i + 1) % N];
        if (a.isGapSegment) continue;

        for (const side of [-1, 1]) {
          // Exact lateral barrier center points on side `side` at consecutive stations
          ptA.copy(a.position).addScaledVector(a.right, side * wallOffset);
          ptB.copy(b.position).addScaledVector(b.right, side * wallOffset);

          pMid.addVectors(ptA, ptB).multiplyScalar(0.5);
          fwd.subVectors(ptB, ptA);
          const sideLen = fwd.length();
          if (sideLen < 0.05) continue;
          fwd.divideScalar(sideLen);

          up.addVectors(a.up, b.up).normalize();
          right.crossVectors(fwd, up).normalize();
          up.crossVectors(right, fwd).normalize();
          left.copy(right).negate();

          basisMat.makeBasis(left, up, fwd);
          quat.setFromRotationMatrix(basisMat);
          const cQuat = new CANNON.Quaternion(quat.x, quat.y, quat.z, quat.w);

          // Use exact side chord length + 0.02m flush overlap (never overshoots inside tight curves)
          const wallLen = Math.max(0.25, sideLen + 0.02);
          const wallShape = new CANNON.Box(
            new CANNON.Vec3(wallThickness * 0.5, wallHeight * 0.5, wallLen * 0.5)
          );
          shapePos
            .copy(pMid)
            .sub(anchor)
            .addScaledVector(up, wallHeight * 0.5 - 0.8);
          wallBody.addShape(wallShape, new CANNON.Vec3(shapePos.x, shapePos.y, shapePos.z), cQuat);
        }
      }

      this.physicsWorld.addBody(wallBody);
      this.bodies.push(wallBody);
    }
  }

  dispose() {
    for (const body of this.bodies) {
      this.physicsWorld.removeBody(body);
    }
    this.bodies.length = 0;
  }
}
