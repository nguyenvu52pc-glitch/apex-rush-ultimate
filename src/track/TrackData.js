import * as THREE from 'three';
import { CHECKPOINT_COUNT, RACER_COUNT } from '../config/constants.js';
import { getTrackSpec } from './TrackCatalog.js';

/**
 * Generates arc-length parameterized spline frames using World-Up (0, 1, 0) + curvature banking
 * (Rule #6: NEVER uses computeFrenetFrames), builds a 2D Spatial Hash Grid for O(1) track projection
 * (Rule #8 & #9), and computes sequential checkpoints & staggered 2x4 starting grid transforms.
 */
export class TrackData {
  /**
   * @param {string} trackId
   */
  constructor(trackId) {
    this.spec = getTrackSpec(trackId);
    this.id = this.spec.id;
    this.trackWidth = this.spec.trackWidth;
    this.trackHalfWidth = this.trackWidth * 0.5;
    this.shoulderWidth = this.spec.shoulderWidth;
    this.totalWidthHalf = this.trackHalfWidth + this.shoulderWidth;
    this.sampleCount = this.spec.sampleCount || 520;

    const vecPoints = this.spec.controlPoints.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    this.curve = new THREE.CatmullRomCurve3(vecPoints, true, 'centripetal', 0.5);
    this.curve.arcLengthDivisions = 1400;
    this.totalLength = this.curve.getLength();

    this.samples = [];
    this.minCurveRadius = Infinity;
    this.rawMinCurveRadius = Infinity;
    this.maxCurvature = 0;

    const rawJumps = this.spec.jumps || [];
    this.jumpZones = rawJumps.map((j) => ({
      name: j.name || 'SKY JUMP',
      rampStartIdx: Math.max(1, Math.round(j.rampStartU * this.sampleCount)),
      takeoffIdx: Math.round(j.takeoffU * this.sampleCount),
      gapEndIdx: Math.round(j.gapEndU * this.sampleCount),
      catchEndIdx: Math.min(this.sampleCount - 2, Math.round(j.catchEndU * this.sampleCount)),
      rampHeight: j.rampHeight ?? 5.0,
      catchDrop: j.catchDrop ?? 2.5,
      rampStartU: j.rampStartU,
      takeoffU: j.takeoffU,
      gapEndU: j.gapEndU,
      catchEndU: j.catchEndU,
    }));

    this._buildFrames();
    this._buildSpatialHash();
    this._buildCheckpoints();
    this._buildStartingGrid();
  }

  _buildFrames() {
    const N = this.sampleCount;
    const rawPositions = new Array(N);
    const rawTangents = new Array(N);
    const jumpRole = new Array(N).fill(null);
    const isGapSegment = new Uint8Array(N);
    const inJumpCorridor = new Uint8Array(N);
    const worldUp = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < N; i++) {
      const u = i / N;
      rawPositions[i] = this.curve.getPointAt(u);
      rawTangents[i] = this.curve.getTangentAt(u).normalize();
    }

    // Apply V2 smooth C1 Launch Ramps, Mid-Air Gaps & Sloped Catch Landing Decks
    for (const jz of this.jumpZones) {
      const baseTakeoffY = rawPositions[jz.takeoffIdx].y;
      const baseCatchY = rawPositions[jz.gapEndIdx].y;
      const rampLipY = baseTakeoffY + jz.rampHeight;
      const catchH = Math.max(0.8, jz.rampHeight - jz.catchDrop);
      const catchLipY = baseCatchY + catchH;

      for (let i = Math.max(0, jz.rampStartIdx - 3); i <= Math.min(N - 1, jz.catchEndIdx + 3); i++) {
        inJumpCorridor[i] = 1;
      }

      for (let i = jz.rampStartIdx; i <= jz.takeoffIdx; i++) {
        const tau = (i - jz.rampStartIdx) / Math.max(1, jz.takeoffIdx - jz.rampStartIdx);
        const f = tau <= 0.5 ? (4 / 3) * tau * tau : (4 / 3) * (tau - 0.25);
        rawPositions[i].y += jz.rampHeight * f;
        jumpRole[i] = 'ramp';
      }

      for (let i = jz.takeoffIdx; i < jz.gapEndIdx; i++) {
        isGapSegment[i] = 1;
        if (i > jz.takeoffIdx) {
          const gTau = (i - jz.takeoffIdx) / Math.max(1, jz.gapEndIdx - jz.takeoffIdx);
          rawPositions[i].y = THREE.MathUtils.lerp(rampLipY, catchLipY, gTau);
          jumpRole[i] = 'gap';
        }
      }

      for (let i = jz.gapEndIdx; i <= jz.catchEndIdx; i++) {
        const s = (i - jz.gapEndIdx) / Math.max(1, jz.catchEndIdx - jz.gapEndIdx);
        const g = (1 - s) * (1 - s) * (1 + 0.4 * s);
        rawPositions[i].y += catchH * g;
        jumpRole[i] = 'landing';
      }
    }

    // Recompute exact 3D tangents along jump corridors without blending across vertical gap edges
    for (const jz of this.jumpZones) {
      for (let i = Math.max(1, jz.rampStartIdx - 1); i <= Math.min(N - 2, jz.catchEndIdx + 1); i++) {
        if (i === jz.takeoffIdx) {
          rawTangents[i].subVectors(rawPositions[i], rawPositions[i - 1]).normalize();
        } else if (i === jz.gapEndIdx) {
          rawTangents[i].subVectors(rawPositions[i + 1], rawPositions[i]).normalize();
        } else {
          rawTangents[i].subVectors(rawPositions[(i + 1) % N], rawPositions[(i - 1 + N) % N]).normalize();
        }
      }
    }

    // Compute signed horizontal curvature (positive = turning left toward +X local)
    const ds = this.totalLength / N;
    const rawCurvatures = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const prevT = rawTangents[(i - 1 + N) % N];
      const nextT = rawTangents[(i + 1) % N];
      const dtx = (nextT.x - prevT.x) / (2 * ds);
      const dtz = (nextT.z - prevT.z) / (2 * ds);
      const t = rawTangents[i];
      // Horizontal left vector = worldUp x tangent = (t.z, 0, -t.x)
      const leftX = t.z;
      const leftZ = -t.x;
      const leftLen = Math.hypot(leftX, leftZ) || 1;
      rawCurvatures[i] = (dtx * leftX + dtz * leftZ) / leftLen;
      const rawAbs = Math.abs(rawCurvatures[i]);
      if (rawAbs > 1e-4) {
        const rawR = 1 / rawAbs;
        if (rawR < this.rawMinCurveRadius) this.rawMinCurveRadius = rawR;
      }
    }

    // Multi-pass smoothing on curvature so banking enters/exits corners gracefully without box twist steps
    let smoothedCurv = Float64Array.from(rawCurvatures);
    const tmpCurv = new Float64Array(N);
    for (let pass = 0; pass < 10; pass++) {
      for (let i = 0; i < N; i++) {
        let sum = 0;
        for (let k = -4; k <= 4; k++) {
          sum += smoothedCurv[(i + k + N) % N];
        }
        tmpCurv[i] = sum / 9;
      }
      smoothedCurv.set(tmpCurv);
    }

    const maxBank = this.spec.maxBankingRad;
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const position = rawPositions[i];
      const tangent = rawTangents[i];
      const curvature = smoothedCurv[i];
      const absCurv = Math.abs(curvature);
      if (absCurv > this.maxCurvature) {
        this.maxCurvature = absCurv;
      }
      if (absCurv > 1e-4) {
        const r = 1 / absCurv;
        if (r < this.minCurveRadius) this.minCurveRadius = r;
      }

      // World-Up right vector (Rule #6: NO Frenet twist!)
      const baseRight = new THREE.Vector3().crossVectors(tangent, worldUp);
      if (baseRight.lengthSq() < 1e-6) {
        baseRight.set(-1, 0, 0);
      } else {
        baseRight.normalize();
      }
      const baseUp = new THREE.Vector3().crossVectors(baseRight, tangent).normalize();

      // Feather banking cleanly into/out of jump corridors over 10 samples (zero abrupt banking edge step!)
      let jumpBankScale = 1.0;
      for (const jz of this.jumpZones) {
        if (i >= jz.rampStartIdx - 10 && i <= jz.catchEndIdx + 10) {
          if (i >= jz.rampStartIdx && i <= jz.catchEndIdx) {
            jumpBankScale = 0.0;
            break;
          }
          const distOutside = i < jz.rampStartIdx ? jz.rampStartIdx - i : i - jz.catchEndIdx;
          jumpBankScale = Math.min(jumpBankScale, distOutside / 10);
        }
      }
      const banking = THREE.MathUtils.clamp(curvature * 10.5, -maxBank, maxBank) * jumpBankScale;
      const cosB = Math.cos(banking);
      const sinB = Math.sin(banking);

      const right = new THREE.Vector3()
        .copy(baseRight)
        .multiplyScalar(cosB)
        .addScaledVector(baseUp, sinB)
        .normalize();
      const up = new THREE.Vector3()
        .copy(baseUp)
        .multiplyScalar(cosB)
        .addScaledVector(baseRight, -sinB)
        .normalize();

      this.samples.push({
        index: i,
        u,
        arcLength: u * this.totalLength,
        position,
        tangent,
        right,
        up,
        width: this.trackWidth,
        halfWidth: this.trackHalfWidth,
        shoulderWidth: this.shoulderWidth,
        banking,
        curvature,
        isGapSegment: Boolean(isGapSegment[i]),
        jumpRole: jumpRole[i],
        inJumpCorridor: Boolean(inJumpCorridor[i]),
      });
    }
  }

  _buildSpatialHash() {
    this.cellSize = 24;
    this.grid = new Map();

    for (let i = 0; i < this.samples.length; i++) {
      const p = this.samples[i].position;
      const cx = Math.floor(p.x / this.cellSize);
      const cz = Math.floor(p.z / this.cellSize);
      // Register into 3x3 cell neighborhood for fast O(1) lookup without boundary misses
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const key = ((cx + ox) + 2048) * 4096 + ((cz + oz) + 2048);
          let bucket = this.grid.get(key);
          if (!bucket) {
            bucket = [];
            this.grid.set(key, bucket);
          }
          bucket.push(i);
        }
      }
    }
  }

  _buildCheckpoints() {
    this.checkpoints = [];
    for (let i = 0; i < CHECKPOINT_COUNT; i++) {
      const u = (i + 1) / (CHECKPOINT_COUNT + 0.35);
      const frame = this.getFrameAt(u);
      this.checkpoints.push({
        index: i,
        u,
        position: frame.position.clone(),
        tangent: frame.tangent.clone(),
        right: frame.right.clone(),
        up: frame.up.clone(),
        width: this.trackWidth + this.shoulderWidth * 2,
      });
    }
  }

  _buildStartingGrid() {
    this.startingGrid = [];
    const rowSpacingMeters = 9.0;
    const lateralSpacing = 3.6;
    const forward = new THREE.Vector3();
    const up = new THREE.Vector3();
    const right = new THREE.Vector3();
    const rotMat = new THREE.Matrix4();

    for (let i = 0; i < RACER_COUNT; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2; // 0 = left (+X), 1 = right (-X)
      const distBehindStart = 7.0 + row * rowSpacingMeters + (col === 1 ? 2.5 : 0);
      const u = (1.0 - distBehindStart / this.totalLength + 1.0) % 1.0;
      const frame = this.getFrameAt(u);

      // Lateral offset: col 0 = +2.85m (left, -right), col 1 = -2.85m (right, +right)
      const sideSign = col === 0 ? -1 : 1; // frame.right is -X local, so -right is left
      const pos = frame.position
        .clone()
        .addScaledVector(frame.right, sideSign * lateralSpacing)
        .addScaledVector(frame.up, 0.32);

      // Build rotation matrix aligning +Z to frame.tangent, +Y to frame.up, +X to -frame.right (left)
      forward.copy(frame.tangent);
      up.copy(frame.up);
      right.copy(frame.right).negate(); // +X = left
      rotMat.makeBasis(right, up, forward);
      const quaternion = new THREE.Quaternion().setFromRotationMatrix(rotMat);

      this.startingGrid.push({
        slot: i,
        u,
        position: pos,
        quaternion,
        frame,
      });
    }
  }

  /**
   * Sample interpolated track frame at normalized arc-length `u` in [0, 1).
   * Pass `outFrame` in hot loops for zero per-frame allocations.
   */
  getFrameAt(u, outFrame = null) {
    const N = this.sampleCount;
    const wrappedU = ((u % 1) + 1) % 1;
    const fIdx = wrappedU * N;
    const i0 = Math.floor(fIdx) % N;
    const i1 = (i0 + 1) % N;
    const t = fIdx - Math.floor(fIdx);

    const a = this.samples[i0];
    const b = this.samples[i1];

    const target = outFrame || {
      position: new THREE.Vector3(),
      tangent: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      width: this.trackWidth,
      halfWidth: this.trackHalfWidth,
      shoulderWidth: this.shoulderWidth,
      banking: 0,
      curvature: 0,
      arcLength: 0,
      u: wrappedU,
    };

    target.position.lerpVectors(a.position, b.position, t);
    target.tangent.lerpVectors(a.tangent, b.tangent, t).normalize();
    target.right.lerpVectors(a.right, b.right, t).normalize();
    target.up.lerpVectors(a.up, b.up, t).normalize();
    target.width = this.trackWidth;
    target.halfWidth = this.trackHalfWidth;
    target.shoulderWidth = this.shoulderWidth;
    target.banking = THREE.MathUtils.lerp(a.banking, b.banking, t);
    target.curvature = THREE.MathUtils.lerp(a.curvature, b.curvature, t);
    target.arcLength = wrappedU * this.totalLength;
    target.u = wrappedU;
    target.isGapSegment = Boolean(a.isGapSegment);
    target.inJumpCorridor = Boolean(a.inJumpCorridor || b.inJumpCorridor);
    target.jumpRole = a.jumpRole || b.jumpRole || null;
    return target;
  }

  /**
   * O(1) 2D Spatial Hash projection of any world position onto the nearest spline point.
   * Pass `outResult` in hot loops for zero per-frame allocations.
   * @param {{ x: number, y?: number, z: number }} pos
   * @param {object} [outResult]
   */
  project(pos, outResult = null) {
    const cx = Math.floor(pos.x / this.cellSize);
    const cz = Math.floor(pos.z / this.cellSize);
    const key = (cx + 2048) * 4096 + (cz + 2048);
    let candidates = this.grid.get(key);

    // Fallback search in wider ring if far outside track corridor
    let bestIdx = 0;
    let bestDistSq = Infinity;

    if (candidates && candidates.length > 0) {
      for (let k = 0; k < candidates.length; k++) {
        const idx = candidates[k];
        const sp = this.samples[idx].position;
        const dx = pos.x - sp.x;
        const dz = pos.z - sp.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = idx;
        }
      }
    } else {
      // Coarse stride fallback (never allocates)
      const N = this.samples.length;
      for (let i = 0; i < N; i += 4) {
        const sp = this.samples[i].position;
        const dx = pos.x - sp.x;
        const dz = pos.z - sp.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = i;
        }
      }
      // Refine locally around coarse hit
      const base = bestIdx;
      for (let offset = -4; offset <= 4; offset++) {
        const idx = (base + offset + N) % N;
        const sp = this.samples[idx].position;
        const dx = pos.x - sp.x;
        const dz = pos.z - sp.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = idx;
        }
      }
    }

    // Sub-segment linear projection between neighbors [bestIdx-1 .. bestIdx+1]
    const N = this.samples.length;
    const sPrev = this.samples[(bestIdx - 1 + N) % N];
    const sCurr = this.samples[bestIdx];
    const sNext = this.samples[(bestIdx + 1) % N];

    // Project onto local tangent at sCurr
    const dx = pos.x - sCurr.position.x;
    const dz = pos.z - sCurr.position.z;
    const segLen = this.totalLength / N;
    const along = dx * sCurr.tangent.x + dz * sCurr.tangent.z;
    const frac = THREE.MathUtils.clamp(along / segLen, -0.95, 0.95);
    const refinedU = (((bestIdx + frac) / N) % 1 + 1) % 1;

    const target = outResult || {
      u: 0,
      distance: 0,
      lateralOffset: 0,
      onRoad: false,
      onShoulder: false,
      frame: {
        position: new THREE.Vector3(),
        tangent: new THREE.Vector3(),
        right: new THREE.Vector3(),
        up: new THREE.Vector3(),
        width: this.trackWidth,
        halfWidth: this.trackHalfWidth,
        shoulderWidth: this.shoulderWidth,
        banking: 0,
        curvature: 0,
        arcLength: 0,
        u: 0,
      },
    };

    const frame = this.getFrameAt(refinedU, target.frame);
    const rx = pos.x - frame.position.x;
    const rz = pos.z - frame.position.z;
    const lateralOffset = rx * frame.right.x + rz * frame.right.z;
    const dist2D = Math.hypot(rx, rz);

    target.u = refinedU;
    target.distance = dist2D;
    target.lateralOffset = lateralOffset;
    target.onRoad = Math.abs(lateralOffset) <= this.trackHalfWidth;
    target.onShoulder = !target.onRoad && Math.abs(lateralOffset) <= this.totalWidthHalf;
    target.isGapSegment = frame.isGapSegment;
    target.inJumpCorridor = frame.inJumpCorridor;
    target.jumpRole = frame.jumpRole;

    // Suppress unused variable warnings cleanly
    void sPrev;
    void sNext;
    return target;
  }
}
