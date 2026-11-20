import * as THREE from 'three';

export const CAMERA_MODE_NAMES = ['Chase Cam', 'Close Chase', 'Hood Cam', 'Bumper Cam'];

/**
 * Spring-damped 4-mode Camera Rig with dynamic FOV speed scaling,
 * terrain/track elevation clamping (+0.9m anti-clip), and impact/rumble trauma shake.
 * Enforces Rule #10: zero per-frame allocations inside update().
 */
export class CameraRig {
  /**
   * @param {THREE.PerspectiveCamera} camera
   */
  constructor(camera) {
    this.camera = camera;
    this.mode = 0; // 0: Chase, 1: Close Chase, 2: Hood, 3: Bumper
    this.trauma = 0;
    this.shakeTime = 0;

    this._smoothedPos = new THREE.Vector3().copy(camera.position);
    this._smoothedLook = new THREE.Vector3();
    this._initialized = false;

    // Pre-allocated scratch math objects (Rule #10)
    this._fwd = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._desiredPos = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();
    this._shakeOffset = new THREE.Vector3();
    this._projOut = null;
  }

  cycleMode() {
    this.mode = (this.mode + 1) % CAMERA_MODE_NAMES.length;
    return CAMERA_MODE_NAMES[this.mode];
  }

  setMode(modeIndex) {
    this.mode = ((modeIndex % CAMERA_MODE_NAMES.length) + CAMERA_MODE_NAMES.length) % CAMERA_MODE_NAMES.length;
  }

  snapToTarget(carRoot) {
    if (!carRoot) return;
    this._fwd.set(0, 0, 1).applyQuaternion(carRoot.quaternion).normalize();
    this._up.set(0, 3.0, 0);
    this._smoothedPos.copy(carRoot.position).addScaledVector(this._fwd, -7.8).add(this._up);
    this._smoothedLook.copy(carRoot.position).addScaledVector(this._fwd, 6.0);
    this.camera.position.copy(this._smoothedPos);
    this.camera.lookAt(this._smoothedLook);
    this._initialized = true;
  }

  /**
   * Add collision trauma in [0..1] range (decays smoothly over time).
   */
  addTrauma(amount) {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  /**
   * Update camera transform, FOV, terrain clearance, and trauma shake (zero allocations).
   */
  update(dt, { carModel, vehiclePhysics, lookBack = false, terrain = null, trackData = null, onRoad = true }) {
    if (!carModel) return;

    const carPos = carModel.root.position;
    const carQuat = carModel.root.quaternion;
    const speedMps = vehiclePhysics ? vehiclePhysics.speedMps : 0;
    const nitroActive = vehiclePhysics ? vehiclePhysics.nitroActive : false;
    const isAirborne = vehiclePhysics ? vehiclePhysics.isAirborne : false;
    if (vehiclePhysics?.justLanded) {
      this.addTrauma(0.32);
    }
    const dim = carModel.spec.dimensions;

    this._fwd.set(0, 0, 1).applyQuaternion(carQuat).normalize();
    this._up.set(0, 1, 0).applyQuaternion(carQuat).normalize();
    this._right.set(-1, 0, 0).applyQuaternion(carQuat).normalize();

    const speedFactor = THREE.MathUtils.clamp(speedMps / 75, 0, 1);

    if (lookBack) {
      // Rear-view look-back override (B key)
      this._desiredPos
        .copy(carPos)
        .addScaledVector(this._fwd, 6.8)
        .addScaledVector(this._up, 2.5);
      this._desiredLook
        .copy(carPos)
        .addScaledVector(this._fwd, -8.0)
        .addScaledVector(this._up, 0.85);
    } else if (this.mode === 0) {
      // Chase Cam: spring-damped follow pulling back subtly at high speed & lifting on air jumps
      const dist = 6.8 + speedFactor * 1.45 + (nitroActive ? 1.15 : 0) + (isAirborne ? 0.85 : 0);
      const height = 2.6 + speedFactor * 0.25 + (isAirborne ? 0.45 : 0);
      this._desiredPos
        .copy(carPos)
        .addScaledVector(this._fwd, -dist)
        .addScaledVector(this._up, height);
      this._desiredLook
        .copy(carPos)
        .addScaledVector(this._fwd, 6.2)
        .addScaledVector(this._up, 0.95);
    } else if (this.mode === 1) {
      // Close Chase: tighter, lower intense speed camera
      const dist = 4.9 + speedFactor * 0.85 + (nitroActive ? 0.85 : 0) + (isAirborne ? 0.55 : 0);
      const height = 1.72 + (isAirborne ? 0.28 : 0);
      this._desiredPos
        .copy(carPos)
        .addScaledVector(this._fwd, -dist)
        .addScaledVector(this._up, height);
      this._desiredLook
        .copy(carPos)
        .addScaledVector(this._fwd, 7.5)
        .addScaledVector(this._up, 0.85);
    } else if (this.mode === 2) {
      // Hood Cam: mounted cleanly over hood showing fenders & windshield edges
      this._desiredPos
        .copy(carPos)
        .addScaledVector(this._fwd, 0.28)
        .addScaledVector(this._up, dim.hoodHeight + 0.34);
      this._desiredLook
        .copy(carPos)
        .addScaledVector(this._fwd, 16.0)
        .addScaledVector(this._up, dim.hoodHeight + 0.15);
    } else {
      // Bumper Cam: low track-level sensation
      this._desiredPos
        .copy(carPos)
        .addScaledVector(this._fwd, dim.length * 0.47)
        .addScaledVector(this._up, 0.48);
      this._desiredLook
        .copy(carPos)
        .addScaledVector(this._fwd, 18.0)
        .addScaledVector(this._up, 0.42);
    }

    // Terrain & Track Elevation Clamp (+0.9m clearance above ground/road so camera never clips underground)
    if (this.mode <= 1 || lookBack) {
      let minFloorY = carPos.y - 0.5;
      if (terrain) {
        minFloorY = Math.max(minFloorY, terrain.getHeightAt(this._desiredPos.x, this._desiredPos.z));
      }
      if (trackData) {
        if (!this._projOut) this._projOut = trackData.project({ x: 0, y: 0, z: 0 });
        trackData.project(this._desiredPos, this._projOut);
        if (this._projOut.distance < trackData.totalWidthHalf + 3.0) {
          minFloorY = Math.max(minFloorY, this._projOut.frame.position.y);
        }
      }
      if (this._desiredPos.y < minFloorY + 0.9) {
        this._desiredPos.y = minFloorY + 0.9;
      }
    }

    // Frame-rate-independent exponential smoothing (strictly rigid for Hood/Bumper cams)
    if (!this._initialized || this.mode >= 2 || lookBack) {
      this._smoothedPos.copy(this._desiredPos);
      this._smoothedLook.copy(this._desiredLook);
      this._initialized = true;
    } else {
      const posK = this.mode === 0 ? 11.5 : 15.0;
      const lookK = 18.0;
      this._smoothedPos.lerp(this._desiredPos, 1 - Math.exp(-posK * dt));
      this._smoothedLook.lerp(this._desiredLook, 1 - Math.exp(-lookK * dt));
    }

    // Dynamic FOV speed, explosive nitro & mid-air horizon widening
    const baseFov = this.mode === 3 ? 68 : this.mode === 2 ? 64 : 58;
    const targetFov = baseFov + speedFactor * 15 + (nitroActive ? 12.5 : 0) + (isAirborne ? 4.5 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-8.5 * dt));
      this.camera.updateProjectionMatrix();
    }

    // Trauma Shake + subtle high-speed / nitro / off-road gravel rumble
    this.shakeTime += dt * 42;
    this.trauma = Math.max(0, this.trauma - dt * 2.1);
    const impactShake = this.trauma * this.trauma * 0.42;
    const gravelRumble = !onRoad && speedMps > 6 ? Math.min(0.055, (speedMps / 50) * 0.05) : 0;
    const highSpeedRumble = speedMps > 55 ? ((speedMps - 55) / 35) * 0.028 : 0;
    const nitroRumble = nitroActive ? 0.025 : 0;
    const totalShake = impactShake + gravelRumble + highSpeedRumble + nitroRumble;

    this._shakeOffset.set(
      Math.sin(this.shakeTime * 1.13) * totalShake,
      Math.cos(this.shakeTime * 1.47) * totalShake * 0.7,
      Math.sin(this.shakeTime * 0.89) * totalShake * 0.4
    );

    this.camera.position.copy(this._smoothedPos).add(this._shakeOffset);
    this.camera.lookAt(this._smoothedLook);
  }
}
