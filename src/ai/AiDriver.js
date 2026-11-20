import * as THREE from 'three';
import { COORDINATE_CONTRACT } from '../config/constants.js';

export const DIFFICULTY_PRESETS = Object.freeze({
  easy: { speedScale: 0.80, cornerAggression: 0.85, maxLatAccel: 12.2, noiseAmp: 0.045 },
  medium: { speedScale: 0.93, cornerAggression: 0.96, maxLatAccel: 14.0, noiseAmp: 0.022 },
  hard: { speedScale: 1.02, cornerAggression: 1.02, maxLatAccel: 15.2, noiseAmp: 0.01 },
});

/**
 * Autonomous Real-Physics AI Racing Controller (Rule #9 & #10):
 * - Lookahead Pure Pursuit toward spline frame + laneOffset
 * - Curvature Lookahead Braking (v_safe = sqrt(maxLateralAccel / curvature))
 * - Dynamic lane-shifting overtaking around slower traffic
 * - Subtle rubber-banding + 2.5s auto-unstuck recovery
 * - Zero per-frame allocations inside update()
 */
export class AiDriver {
  /**
   * @param {object} options
   * @param {import('../track/TrackData.js').TrackData} options.trackData
   * @param {import('../physics/VehiclePhysics.js').VehiclePhysics} options.vehiclePhysics
   * @param {number} [options.baseLaneOffset]
   * @param {string} [options.difficulty]
   * @param {number} [options.seedOffset]
   */
  constructor({ trackData, vehiclePhysics, baseLaneOffset = 0, difficulty = 'medium', seedOffset = 0 }) {
    this.trackData = trackData;
    this.vp = vehiclePhysics;
    this.baseLaneOffset = baseLaneOffset;
    this.currentLaneOffset = baseLaneOffset;
    this.difficultyKey = difficulty;
    this.preset = DIFFICULTY_PRESETS[difficulty] || DIFFICULTY_PRESETS.medium;
    this.seedOffset = seedOffset;

    this.stuckTimer = 0;
    this.timeAcc = seedOffset * 1.37;

    this.input = {
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
      nitro: false,
      lookBack: false,
    };

    // Pre-allocated scratch math objects (Rule #10)
    this._projOut = trackData.project({ x: 0, y: 0, z: 0 });
    this._targetFrame = trackData.getFrameAt(0);
    this._probeFrame = trackData.getFrameAt(0);
    this._targetPos = new THREE.Vector3();
    this._toTarget = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._left = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._basisMat = new THREE.Matrix4();
  }

  setDifficulty(difficulty) {
    this.difficultyKey = difficulty;
    this.preset = DIFFICULTY_PRESETS[difficulty] || DIFFICULTY_PRESETS.medium;
  }

  /**
   * Reset AI stuck timer and lane offset.
   */
  reset() {
    this.stuckTimer = 0;
    this.currentLaneOffset = this.baseLaneOffset;
  }

  /**
   * Respawn AI smoothly onto the nearest forward track frame if stuck > 2.5s.
   */
  _respawnOnTrack(u) {
    const f = this.trackData.getFrameAt(u, this._probeFrame);
    const maxSafeLane = this.trackData.trackHalfWidth - 2.2;
    const lane = THREE.MathUtils.clamp(this.baseLaneOffset, -maxSafeLane, maxSafeLane);

    this._targetPos
      .copy(f.position)
      .addScaledVector(f.right, lane)
      .addScaledVector(f.up, 0.45);

    this._left.copy(f.right).negate();
    this._basisMat.makeBasis(this._left, f.up, f.tangent);
    this._quat.setFromRotationMatrix(this._basisMat);

    this.vp.reset(this._targetPos, this._quat);
    this.stuckTimer = 0;
    this.currentLaneOffset = lane;
  }

  /**
   * Compute AI throttle, brake, steer, and nitro inputs without allocations.
   * @param {number} dt
   * @param {{ racers: Array<object>, myRacer: object, playerProgress: number, isRacing: boolean }} context
   */
  update(dt, { racers, myRacer, playerProgress, isRacing }) {
    this.timeAcc += dt;
    const body = this.vp.chassisBody;
    const speed = this.vp.speedMps;

    this.trackData.project(body.position, this._projOut);
    const u = this._projOut.u;

    // Auto-unstuck recovery while RACING (Rule #9: speed < 1.5 m/s or flipped for > 2.5s)
    if (isRacing) {
      if (speed < 1.5 || this.vp.isFlipped()) {
        this.stuckTimer += dt;
        if (this.stuckTimer >= 2.5) {
          this._respawnOnTrack(u);
          return this.input;
        }
      } else {
        this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2.0);
      }
    } else {
      this.stuckTimer = 0;
    }

    // 1. Dynamic Overtaking Lane Selection
    const maxLane = this.trackData.trackHalfWidth - 2.6;
    let targetLane = THREE.MathUtils.clamp(this.baseLaneOffset, -maxLane, maxLane);
    let leftClear = true;
    let rightClear = true;
    let blockedAhead = false;

    if (racers && myRacer) {
      for (let i = 0; i < racers.length; i++) {
        const other = racers[i];
        if (other === myRacer) continue;
        // Forward circular delta in [0..1)
        let du = other.u - u;
        if (du < -0.5) du += 1;
        if (du > 0.5) du -= 1;
        const distLong = du * this.trackData.totalLength;
        if (distLong > 1.0 && distLong < 15.0) {
          const dLat = other.lateralOffset - this._projOut.lateralOffset;
          if (Math.abs(dLat) < 2.8) {
            blockedAhead = true;
          }
          if (other.lateralOffset < 0) leftClear = false;
          else rightClear = false;
        }
      }
    }

    if (blockedAhead) {
      if (leftClear && !rightClear) {
        targetLane = -maxLane * 0.72; // Left side (-right)
      } else if (rightClear && !leftClear) {
        targetLane = maxLane * 0.72; // Right side (+right)
      } else {
        targetLane = this._projOut.lateralOffset > 0 ? -maxLane * 0.72 : maxLane * 0.72;
      }
    }
    // Pull back safely toward center on shoulders or approaching V2 sky-jump ramps
    if (Math.abs(this._projOut.lateralOffset) > this.trackData.trackHalfWidth - 1.0) {
      targetLane = 0;
    } else if (this._projOut.inJumpCorridor) {
      targetLane = THREE.MathUtils.clamp(targetLane, -5.0, 5.0);
    }
    this.currentLaneOffset = THREE.MathUtils.lerp(
      this.currentLaneOffset,
      targetLane,
      1 - Math.exp(-4.2 * dt)
    );

    // 2. Lookahead Pure Pursuit Steering (tighter lookahead & calibrated gain matching steer^1.48 curve)
    const lookaheadMeters = THREE.MathUtils.clamp(7.0 + speed * 0.28, 7.0, 22.0);
    const lookaheadU = (u + lookaheadMeters / this.trackData.totalLength) % 1;
    const targetFrame = this.trackData.getFrameAt(lookaheadU, this._targetFrame);

    this._targetPos
      .copy(targetFrame.position)
      .addScaledVector(targetFrame.right, this.currentLaneOffset);

    this._toTarget.subVectors(this._targetPos, body.position);
    this._fwd.set(0, 0, 1).set(
      COORDINATE_CONTRACT.FORWARD_AXIS.x,
      COORDINATE_CONTRACT.FORWARD_AXIS.y,
      COORDINATE_CONTRACT.FORWARD_AXIS.z
    );
    this._quat.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    this._fwd.applyQuaternion(this._quat).normalize();
    this._left.set(1, 0, 0).applyQuaternion(this._quat).normalize();

    const localFwd = this._toTarget.dot(this._fwd);
    const localLeft = this._toTarget.dot(this._left);
    const headingError = Math.atan2(localLeft, Math.max(0.2, localFwd));

    const noise = Math.sin(this.timeAcc * 2.3 + this.seedOffset) * this.preset.noiseAmp;
    this.input.steer = THREE.MathUtils.clamp(headingError * 2.75 + noise, -1, 1);

    // 3. Speed-Aware Curvature Lookahead Braking (18m - 135m ahead) + Jump Ramp Boost
    let peakCurvature = Math.abs(this._projOut.frame.curvature);
    let jumpAhead = this._projOut.jumpRole === 'ramp';
    const probeDists = [18, 36, 62, 95, 135];
    for (let i = 0; i < probeDists.length; i++) {
      const pu = (u + probeDists[i] / this.trackData.totalLength) % 1;
      const pf = this.trackData.getFrameAt(pu, this._probeFrame);
      if (i <= 1 && pf.jumpRole === 'ramp') jumpAhead = true;
      const c = Math.abs(pf.curvature);
      if (c > peakCurvature) peakCurvature = c;
    }

    // Subtle rubber-banding relative to player
    let rubberScale = 1.0;
    if (isRacing && myRacer && typeof playerProgress === 'number') {
      const gapMeters = (myRacer.progress - playerProgress) * this.trackData.totalLength;
      if (gapMeters < -45) {
        rubberScale = 1.08;
      } else if (gapMeters > 75) {
        rubberScale = 0.93;
      }
    }

    const vSafeCorner =
      Math.sqrt(this.preset.maxLatAccel / Math.max(peakCurvature, 0.0012)) *
      this.preset.cornerAggression *
      rubberScale;
    const maxDesiredSpeed = this.vp.phys.maxSpeed * this.preset.speedScale * rubberScale;
    const targetSpeed = Math.min(maxDesiredSpeed, vSafeCorner);

    if (speed > targetSpeed + 2.5) {
      const overRatio = THREE.MathUtils.clamp((speed - targetSpeed) / 16, 0, 1);
      this.input.throttle = 0;
      this.input.brake = Math.max(0.22, overRatio);
      this.input.nitro = false;
    } else if (speed > targetSpeed - 1.0) {
      this.input.throttle = 0.45;
      this.input.brake = 0;
      this.input.nitro = false;
    } else {
      this.input.throttle = THREE.MathUtils.clamp(0.75 + (targetSpeed - speed) * 0.05, 0.72, 1.0);
      this.input.brake = 0;
      this.input.nitro =
        isRacing &&
        peakCurvature < 0.004 &&
        this.vp.nitro > 28 &&
        Math.abs(this.input.steer) < 0.16 &&
        (rubberScale > 1.02 || jumpAhead);
    }

    if (this.vp.isAirborne) {
      this.input.steer *= 0.45;
      this.input.brake = 0;
    }

    this.input.handbrake = false;
    return this.input;
  }
}
