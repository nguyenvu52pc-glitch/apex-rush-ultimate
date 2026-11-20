import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { COORDINATE_CONTRACT } from '../config/constants.js';

const GEAR_RATIOS = [0, 3.25, 2.25, 1.72, 1.44, 1.26, 1.15];

/**
 * Real 3D rigid-body vehicle physics built on CANNON.RaycastVehicle.
 * - Rounded tapered chassis compound collider (prevents premature corner hitbox snagging)
 * - Active wall-scrape deflection & anti-deadlock assist
 * - Explosive Nitro boost (gear-independent forward jet thrust + 1.32x top speed)
 * - Controlled curved Drift system (slip-angle envelope cap prevents 180° spinouts)
 * - Rule #10: Zero per-frame allocations inside step() / syncVisuals()
 */
export class VehiclePhysics {
  /**
   * @param {import('./PhysicsWorld.js').PhysicsWorld} physicsWorld
   * @param {object} carSpec Entry from CarCatalog
   * @param {{ position?: { x: number, y: number, z: number }, quaternion?: { x: number, y: number, z: number, w: number }, userData?: object }} [spawn]
   */
  constructor(physicsWorld, carSpec, spawn = {}) {
    this.physicsWorld = physicsWorld;
    this.spec = carSpec;
    this.dim = carSpec.dimensions;
    this.phys = { ...carSpec.physics };

    const gravityMag = Math.abs(physicsWorld.world.gravity.y);
    const sag = (0.25 * gravityMag) / Math.max(10, this.phys.suspensionStiffness);
    this.yCoMOffset = Math.max(0.18, this.dim.groundClearance + 0.08);

    // 1. Rigid-body Chassis with upward collider offset (Rule #5: lowers effective CoM)
    this.chassisBody = new CANNON.Body({
      mass: this.phys.mass,
      material: physicsWorld.materials.chassis,
      angularDamping: 0.24,
      linearDamping: 0.02,
    });
    this.chassisBody.userData = {
      type: 'vehicle',
      carId: carSpec.id,
      wallScrapeTimer: 0,
      wallNormal: { x: 0, y: 0, z: 0 },
      ...(spawn.userData || {}),
    };

    // Tapered rounded compound chassis hull inset cleanly inside visual silhouette:
    // Bumper spheres sit at CoM vertical plane (y=0.02) and slightly wider than core box
    // so wall impacts produce zero roll/pitch tumble and glide along barriers smoothly!
    const halfExt = this.phys.chassisHalfExtents;
    this.chassisColliderOffsetY = this.phys.chassisColliderOffsetY + 0.10;
    const coreHalfX = Math.max(0.48, halfExt.x - 0.15);
    const coreHalfY = Math.max(0.18, halfExt.y - 0.10);
    const coreHalfZ = Math.max(0.95, halfExt.z - 0.44);
    const coreShape = new CANNON.Box(new CANNON.Vec3(coreHalfX, coreHalfY, coreHalfZ));
    this.chassisBody.addShape(coreShape, new CANNON.Vec3(0, this.chassisColliderOffsetY, 0));

    const bumperR = 0.20;
    const cornerX = Math.max(0.24, (halfExt.x - 0.08) - bumperR);
    const cornerZ = Math.max(0.75, halfExt.z - bumperR - 0.06);
    const bumperY = (this.chassisColliderOffsetY - coreHalfY) + bumperR + 0.06;
    const bumperSphere = new CANNON.Sphere(bumperR);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.chassisBody.addShape(
          bumperSphere,
          new CANNON.Vec3(sx * cornerX, bumperY, sz * cornerZ)
        );
      }
    }

    // 2. CANNON.RaycastVehicle using Unified Coordinate Contract
    const rc = COORDINATE_CONTRACT.RAYCAST_VEHICLE;
    this.vehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassisBody,
      indexRightAxis: rc.indexRightAxis,
      indexUpAxis: rc.indexUpAxis,
      indexForwardAxis: rc.indexForwardAxis,
    });

    const restLengthWithSag = this.phys.suspensionRestLength + sag;
    const connectionY = (this.dim.wheelRadius - this.yCoMOffset) + this.phys.suspensionRestLength;

    const wheelBaseOptions = {
      radius: this.dim.wheelRadius,
      directionLocal: new CANNON.Vec3(rc.directionLocal.x, rc.directionLocal.y, rc.directionLocal.z),
      suspensionStiffness: this.phys.suspensionStiffness,
      suspensionRestLength: restLengthWithSag,
      frictionSlip: this.phys.frictionSlip,
      dampingRelaxation: this.phys.dampingRelaxation,
      dampingCompression: this.phys.dampingCompression * 1.2,
      maxSuspensionForce: this.phys.mass * 28,
      rollInfluence: this.phys.rollInfluence,
      axleLocal: new CANNON.Vec3(rc.axleLocal.x, rc.axleLocal.y, rc.axleLocal.z),
      chassisConnectionPointLocal: new CANNON.Vec3(),
      maxSuspensionTravel: this.dim.maxSuspensionTravel + sag + 0.04,
      useCustomSlidingRotationalSpeed: true,
      customSlidingRotationalSpeed: -28,
    };

    const wheelCoords = [
      { x: this.dim.trackHalfWidth, z: this.dim.frontAxleZ },
      { x: -this.dim.trackHalfWidth, z: this.dim.frontAxleZ },
      { x: this.dim.trackHalfWidth, z: this.dim.rearAxleZ },
      { x: -this.dim.trackHalfWidth, z: this.dim.rearAxleZ },
    ];

    for (const wc of wheelCoords) {
      wheelBaseOptions.chassisConnectionPointLocal.set(wc.x, connectionY, wc.z);
      this.vehicle.addWheel(wheelBaseOptions);
    }

    this.vehicle.addToWorld(physicsWorld.world);
    physicsWorld.trackCollisionBody(this.chassisBody);

    // Runtime simulation state
    this.steerAngle = 0;
    this.nitro = 100;
    this.nitroActive = false;
    this.nitroIgnitePulse = 0;
    this.isChargingNitro = false;
    this.driftChargeEarned = 0;
    this.driftDuration = 0;
    this.exitBoostTimer = 0;
    this.isAirborne = false;
    this.airTime = 0;
    this.airBonusPulse = 0;
    this.justLanded = false;
    this.gear = 1;
    this.rpmNormalized = 0.2;
    this.speedMps = 0;
    this.forwardSpeedMps = 0;
    this.slipAngleRad = 0;
    this.isBraking = false;
    this.isDrifting = false;
    this.handbrakeHoldTime = 0;
    this.surfaceGripScale = 1.0;
    this.surfaceDrag = 0.0;
    this.controlsLocked = false;

    // Interpolation snapshots
    this.prevPos = new THREE.Vector3();
    this.currPos = new THREE.Vector3();
    this.prevQuat = new THREE.Quaternion();
    this.currQuat = new THREE.Quaternion();
    this.prevWheelLengths = new Float32Array(4).fill(this.phys.suspensionRestLength);
    this.currWheelLengths = new Float32Array(4).fill(this.phys.suspensionRestLength);
    this.prevWheelSpins = new Float32Array(4);
    this.currWheelSpins = new Float32Array(4);

    // Pre-allocated scratch math objects (Rule #10)
    this._scratchFwd = new CANNON.Vec3();
    this._scratchUp = new CANNON.Vec3();
    this._scratchForce = new CANNON.Vec3();
    this._scratchDragForce = new CANNON.Vec3();
    this._zeroVec = new CANNON.Vec3(0, 0, 0);
    this._scratchRight = new THREE.Vector3();
    this._scratchCarUp = new THREE.Vector3();
    this._scratchWorldUp = new THREE.Vector3(0, 1, 0);
    this._scratchQuat = new THREE.Quaternion();
    this._scratchVec = new THREE.Vector3();

    const spawnPos = spawn.position || { x: 0, y: this.yCoMOffset + 0.05, z: 0 };
    const spawnQuat = spawn.quaternion || { x: 0, y: 0, z: 0, w: 1 };
    this.reset(spawnPos, spawnQuat);
  }

  applyTuning(overrides) {
    Object.assign(this.phys, overrides);
    const gravityMag = Math.abs(this.physicsWorld.world.gravity.y);
    const sag = (0.25 * gravityMag) / Math.max(10, this.phys.suspensionStiffness);
    const restWithSag = this.phys.suspensionRestLength + sag;
    for (let i = 0; i < 4; i++) {
      const w = this.vehicle.wheelInfos[i];
      w.suspensionStiffness = this.phys.suspensionStiffness;
      w.dampingCompression = this.phys.dampingCompression;
      w.dampingRelaxation = this.phys.dampingRelaxation;
      w.rollInfluence = this.phys.rollInfluence;
      w.suspensionRestLength = restWithSag;
    }
  }

  setSurfaceModifier(gripScale = 1.0, rollingDrag = 0.0) {
    this.surfaceGripScale = gripScale;
    this.surfaceDrag = rollingDrag;
  }

  reset(position, quaternion = { x: 0, y: 0, z: 0, w: 1 }) {
    this.chassisBody.position.set(position.x, position.y, position.z);
    this.chassisBody.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    this.chassisBody.velocity.set(0, 0, 0);
    this.chassisBody.angularVelocity.set(0, 0, 0);
    this.chassisBody.force.set(0, 0, 0);
    this.chassisBody.torque.set(0, 0, 0);
    this.chassisBody.userData.wallScrapeTimer = 0;

    this.steerAngle = 0;
    this.speedMps = 0;
    this.forwardSpeedMps = 0;
    this.slipAngleRad = 0;
    this.gear = 1;
    this.rpmNormalized = 0.18;
    this.nitroActive = false;
    this.nitroIgnitePulse = 0;
    this.isChargingNitro = false;
    this.driftChargeEarned = 0;
    this.driftDuration = 0;
    this.exitBoostTimer = 0;
    this.isAirborne = false;
    this.airTime = 0;
    this.airBonusPulse = 0;
    this.justLanded = false;
    this.isDrifting = false;
    this.handbrakeHoldTime = 0;

    for (let i = 0; i < 4; i++) {
      this.vehicle.applyEngineForce(0, i);
      this.vehicle.setBrake(0, i);
      this.vehicle.setSteeringValue(0, i);
      const w = this.vehicle.wheelInfos[i];
      w.suspensionLength = this.phys.suspensionRestLength;
      w.rotation = 0;
      w.deltaRotation = 0;
      this.prevWheelLengths[i] = this.phys.suspensionRestLength;
      this.currWheelLengths[i] = this.phys.suspensionRestLength;
      this.prevWheelSpins[i] = 0;
      this.currWheelSpins[i] = 0;
    }

    this.prevPos.set(position.x, position.y, position.z);
    this.currPos.copy(this.prevPos);
    this.prevQuat.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    this.currQuat.copy(this.prevQuat);
  }

  step(dt, input) {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    for (let i = 0; i < 4; i++) {
      this.prevWheelLengths[i] = this.currWheelLengths[i];
      this.prevWheelSpins[i] = this.currWheelSpins[i];
    }

    const body = this.chassisBody;
    body.quaternion.vmult(COORDINATE_CONTRACT.FORWARD_AXIS, this._scratchFwd);
    body.quaternion.vmult(COORDINATE_CONTRACT.UP_AXIS, this._scratchUp);

    this.speedMps = body.velocity.length();
    this.forwardSpeedMps = body.velocity.dot(this._scratchFwd);
    const absSpeed = Math.abs(this.forwardSpeedMps);

    // Update wall-scrape timer
    if (body.userData.wallScrapeTimer > 0) {
      body.userData.wallScrapeTimer = Math.max(0, body.userData.wallScrapeTimer - dt);
    }
    const isWallScraping = body.userData.wallScrapeTimer > 0;

    // 1. Calibrated physical steering & yaw-rate stability (progressive deadband + smooth corner bite)
    const speedRatio = Math.min(1, absSpeed / 60);
    const wheelBase = Math.max(2.2, this.dim.frontAxleZ - this.dim.rearAxleZ);
    const targetLatAccel = 19.2 + (this.phys.frictionSlip - 2.4) * 3.5;
    const invSpeedSteer = (targetLatAccel * wheelBase) / Math.max(64, absSpeed * absSpeed) + 0.011;
    const lowSteerCap = Math.min(0.34, this.phys.maxSteerAngle * 0.64);
    const highFloor = Math.min(0.038, this.phys.highSpeedSteerLimit * 0.32);
    const normalMaxSteer = THREE.MathUtils.clamp(invSpeedSteer, highFloor, lowSteerCap);
    const maxSteerAtSpeed = input.handbrake
      ? Math.max(normalMaxSteer, THREE.MathUtils.lerp(0.28, 0.082, Math.pow(speedRatio, 0.6)))
      : normalMaxSteer;

    const curvedSteer = Math.sign(input.steer) * Math.pow(Math.abs(input.steer), 1.48);
    const targetSteer = curvedSteer * maxSteerAtSpeed;
    const isTurningIn = Math.abs(targetSteer) > Math.abs(this.steerAngle);
    const steerRate = isTurningIn ? THREE.MathUtils.lerp(6.8, 4.2, speedRatio) : 11.0;
    this.steerAngle = THREE.MathUtils.lerp(this.steerAngle, targetSteer, 1 - Math.exp(-steerRate * dt));
    this.vehicle.setSteeringValue(this.steerAngle, 0);
    this.vehicle.setSteeringValue(this.steerAngle, 1);

    // Progressive yaw damping when releasing steering so car tracks straight cleanly
    if (!input.handbrake && Math.abs(input.steer) < 0.06 && this.speedMps > 8) {
      body.angularVelocity.y *= Math.exp(-7.5 * dt);
    }

    // 2. Explosive Nitro tank management & ignition pulse
    const wasNitroActive = this.nitroActive;
    const wantsNitro = Boolean(input.nitro) && input.throttle > 0.1 && !this.controlsLocked;
    if (wantsNitro && this.nitro > 1.0) {
      this.nitroActive = true;
      if (!wasNitroActive) {
        this.nitroIgnitePulse = 1.0;
      }
      this.nitro = Math.max(0, this.nitro - 18.5 * dt);
    } else {
      this.nitroActive = false;
      this.nitro = Math.min(100, this.nitro + 3.2 * dt);
    }
    this.nitroIgnitePulse = Math.max(0, this.nitroIgnitePulse - dt * 2.2);
    this.airBonusPulse = Math.max(0, this.airBonusPulse - dt * 1.3);
    this.exitBoostTimer = Math.max(0, this.exitBoostTimer - dt);

    // 3. Simulated 6-speed gearbox & torque curve
    const topSpeed = this.phys.maxSpeed * (this.nitroActive ? 1.32 : 1.0);
    let nextGear = 1;
    if (this.forwardSpeedMps < -1.0 && input.brake > 0.2) {
      nextGear = -1;
    } else if (absSpeed < 1.2 && input.throttle < 0.05 && input.brake < 0.05) {
      nextGear = 0;
    } else {
      const normalizedTop = Math.min(1, absSpeed / Math.max(1, topSpeed));
      nextGear = Math.min(6, Math.max(1, Math.floor(normalizedTop * 5.8) + 1));
    }
    this.gear = nextGear;

    const gearBandMin = nextGear <= 1 ? 0 : ((nextGear - 1) / 6) * topSpeed * 0.85;
    const gearBandMax = nextGear <= 0 ? 18 : (Math.max(1, nextGear) / 6) * topSpeed;
    const gearProgress = THREE.MathUtils.clamp(
      (absSpeed - gearBandMin) / Math.max(4, gearBandMax - gearBandMin),
      0,
      1
    );
    const targetRpm = this.controlsLocked
      ? 0.2 + input.throttle * 0.72
      : 0.18 + gearProgress * 0.72 + input.throttle * 0.12;
    this.rpmNormalized = THREE.MathUtils.lerp(this.rpmNormalized, Math.min(1, targetRpm), 1 - Math.exp(-14 * dt));

    const torqueCurve = 0.85 + 0.32 * Math.sin(this.rpmNormalized * Math.PI * 0.85);
    const gearMult = nextGear >= 1 ? Math.max(0.76, Math.min(1.45, GEAR_RATIOS[nextGear] * 0.52)) : 1.0;
    const nitroMult = this.nitroActive ? 1.68 : 1.0;

    // 4. Engine, Braking, Reverse & Smooth Curved Handbrake Drift
    let driveForce = 0;
    let frontBrake = 0;
    let rearBrake = 0;
    this.isBraking = false;

    if (input.handbrake && !this.controlsLocked) {
      this.handbrakeHoldTime += dt;
    } else {
      this.handbrakeHoldTime = 0;
    }

    if (this.controlsLocked) {
      frontBrake = this.phys.maxBrakeForce * 1.4;
      rearBrake = this.phys.maxBrakeForce * 1.4;
    } else {
      if (input.throttle > 0 && this.forwardSpeedMps < topSpeed) {
        driveForce = input.throttle * this.phys.maxEngineForce * torqueCurve * gearMult * nitroMult;
      }

      if (input.brake > 0) {
        if (this.forwardSpeedMps > 2.0) {
          frontBrake = input.brake * this.phys.maxBrakeForce;
          rearBrake = input.brake * this.phys.maxBrakeForce * 0.82;
          this.isBraking = true;
        } else {
          if (this.forwardSpeedMps > -24) {
            driveForce = -input.brake * this.phys.maxEngineForce * 0.65;
          }
          this.isBraking = true;
        }
      }

      // Brief initiation pulse locks rear slightly for 0.14s, then releases brake drag so car power-slides fast in a smooth arc!
      if (input.handbrake) {
        if (this.handbrakeHoldTime < 0.14) {
          rearBrake = Math.max(rearBrake, this.phys.maxBrakeForce * 0.35);
          this.isBraking = true;
        }
      } else if (input.throttle < 0.05 && input.brake < 0.05) {
        frontBrake = 4.2;
        rearBrake = 4.2;
      }
    }

    // Apply engine & brake forces
    const cannonEngineForce = -driveForce;
    this.vehicle.applyEngineForce(cannonEngineForce * 0.40, 0);
    this.vehicle.applyEngineForce(cannonEngineForce * 0.40, 1);
    this.vehicle.applyEngineForce(cannonEngineForce * 0.60, 2);
    this.vehicle.applyEngineForce(cannonEngineForce * 0.60, 3);

    this.vehicle.setBrake(frontBrake, 0);
    this.vehicle.setBrake(frontBrake, 1);
    this.vehicle.setBrake(rearBrake, 2);
    this.vehicle.setBrake(rearBrake, 3);

    // 5. Horizontal Drift Slip Angle (beta) & Controlled Curve Stabilization
    const horizSpeed = Math.hypot(body.velocity.x, body.velocity.z);
    if (horizSpeed > 3.5) {
      const fwdLen = Math.hypot(this._scratchFwd.x, this._scratchFwd.z) || 1;
      const fx = this._scratchFwd.x / fwdLen;
      const fz = this._scratchFwd.z / fwdLen;
      const vx = body.velocity.x / horizSpeed;
      const vz = body.velocity.z / horizSpeed;
      // Positive slipAngleRad = nose pointed LEFT (+X) of velocity vector
      const crossY = fx * vz - fz * vx;
      const dotXZ = THREE.MathUtils.clamp(fx * vx + fz * vz, -1, 1);
      this.slipAngleRad = Math.atan2(-crossY, dotXZ);
    } else {
      this.slipAngleRad = 0;
    }

    const absSlip = Math.abs(this.slipAngleRad);

    // Directional stability balance: slight understeer margin during normal driving (rear >= front grip)
    // eliminates uncommanded snap-oversteer; controlled slip balance engages only during handbrake drift.
    const baseGrip = this.phys.frictionSlip * this.surfaceGripScale;
    const scrapeRelax = isWallScraping ? 0.55 : 1.0;
    const frontGrip = (input.handbrake ? baseGrip * 1.02 : baseGrip * 0.96) * scrapeRelax;

    // As slip angle reaches ~16+ deg, progressively restore rear bite so the tail holds a curved arc
    const angleRecoveryBoost = absSlip > 0.28 ? Math.min(0.65, (absSlip - 0.28) * 2.8) : 0;
    const targetRearGrip = input.handbrake
      ? Math.max(1.25, baseGrip * (0.56 + angleRecoveryBoost)) * scrapeRelax
      : baseGrip * 1.08 * scrapeRelax;

    this.vehicle.wheelInfos[0].frictionSlip = frontGrip;
    this.vehicle.wheelInfos[1].frictionSlip = frontGrip;
    this.vehicle.wheelInfos[2].frictionSlip = THREE.MathUtils.lerp(
      this.vehicle.wheelInfos[2].frictionSlip,
      targetRearGrip,
      1 - Math.exp(-14 * dt)
    );
    this.vehicle.wheelInfos[3].frictionSlip = this.vehicle.wheelInfos[2].frictionSlip;

    let slidingWheels = 0;
    for (let i = 0; i < 4; i++) {
      if (this.vehicle.wheelInfos[i].sliding) slidingWheels += 1;
    }
    this.isDrifting = absSpeed > 7.5 && (input.handbrake || absSlip > 0.20 || slidingWheels >= 2);

    const numGrounded = this.vehicle.numWheelsOnGround;

    // 5b. Airborne State Tracking + Clean Touchdown Air Bonus
    this.justLanded = false;
    this.isAirborne = numGrounded === 0 && horizSpeed > 12;
    if (this.isAirborne) {
      this.airTime += dt;
    } else if (numGrounded >= 2) {
      if (this.airTime > 0.30) {
        this.airBonusPulse = 1.0;
        this.justLanded = true;
        this.nitro = Math.min(100, this.nitro + 14.0);
      }
      this.airTime = 0;
    }

    // 5c. Drift-to-Charge Nitro & Chain Drift Exit Boost
    this.isChargingNitro = false;
    if (this.isDrifting && numGrounded >= 2 && horizSpeed > 8.0 && !this.controlsLocked) {
      this.driftDuration += dt;
      const slipFactor = THREE.MathUtils.clamp(absSlip / 0.28, 0.45, 1.50);
      const speedFactor = THREE.MathUtils.clamp(horizSpeed / 30, 0.55, 1.35);
      const driftGain = (this.nitroActive ? 16.0 : 38.0) * slipFactor * speedFactor * dt;
      this.nitro = Math.min(100, this.nitro + driftGain);
      this.driftChargeEarned += driftGain;
      this.isChargingNitro = !this.nitroActive;
      if (!input.handbrake && this.driftDuration >= 0.35 && input.throttle > 0.2) {
        this.exitBoostTimer = Math.max(this.exitBoostTimer, 0.65);
      }
    } else {
      if (this.driftDuration >= 0.35 && input.throttle > 0.2 && numGrounded >= 2 && !this.controlsLocked) {
        this.exitBoostTimer = 0.65;
      }
      this.driftDuration = 0;
      if (!this.isDrifting) {
        this.driftChargeEarned = Math.max(0, this.driftChargeEarned - 45 * dt);
      }
    }

    if (this.isAirborne && this.airTime > 0.16 && !this.nitroActive && !this.controlsLocked) {
      this.nitro = Math.min(100, this.nitro + 18.0 * dt);
      this.isChargingNitro = true;
    }

    // Speed-scaled yaw-rate guard during normal grip driving (prevents twitchy snap yaw at 150+ km/h)
    if (numGrounded >= 2 && horizSpeed > 14 && !input.handbrake) {
      const maxNormalYaw = THREE.MathUtils.clamp((targetLatAccel * 1.25) / horizSpeed, 0.38, 1.35);
      if (Math.abs(body.angularVelocity.y) > maxNormalYaw) {
        body.angularVelocity.y = THREE.MathUtils.lerp(
          body.angularVelocity.y,
          Math.sign(body.angularVelocity.y) * maxNormalYaw,
          1 - Math.exp(-14 * dt)
        );
      }
    }

    // Controlled Drift Curve Assist: prevents 180° spinout & sustains smooth 22°-30° curved arc around corners
    if (numGrounded >= 2 && horizSpeed > 6.5 && (input.handbrake || absSlip > 0.16)) {
      const curveRate = THREE.MathUtils.clamp(8.5 / Math.max(8, horizSpeed) + 0.32, 0.52, 0.92);
      // Smoothly taper yaw injection to zero around 24° (0.42 rad) so the drift holds an arc cleanly
      const slipFade = absSlip > 0.26 ? Math.max(0.0, 1 - (absSlip - 0.26) / 0.16) : 1.0;
      const targetYawRate = input.steer * curveRate * slipFade;

      if (input.handbrake) {
        body.angularVelocity.y = THREE.MathUtils.lerp(
          body.angularVelocity.y,
          targetYawRate,
          1 - Math.exp(-10.0 * dt)
        );
      }
      body.angularVelocity.y = THREE.MathUtils.clamp(body.angularVelocity.y, -1.05, 1.05);

      // Progressive slip-angle envelope clamp above ~21° (0.37 rad) keeps rear tracking velocity vector
      if (absSlip > 0.37) {
        const excess = absSlip - 0.37;
        const restoreYaw = Math.sign(this.slipAngleRad) * excess * this.phys.mass * 72;
        body.torque.y += restoreYaw;
        body.angularVelocity.y *= Math.exp(-11.0 * dt);
      }

      // Power-slide forward apex thrust while holding throttle in a drift (keeps exit speed strong!)
      if (input.throttle > 0.2 && absSlip < 0.65) {
        const carveThrust = this.phys.mass * 12.2 * input.throttle;
        this._scratchForce.set(
          this._scratchFwd.x * carveThrust,
          this._scratchFwd.y * carveThrust,
          this._scratchFwd.z * carveThrust
        );
        body.applyForce(this._scratchForce, this._zeroVec);
      }
    }

    // 6. Direct Explosive Nitro Jet Thrust + Chain-Drift Exit Boost
    if (this.nitroActive && this.forwardSpeedMps < topSpeed) {
      const airScale = numGrounded > 0 ? 1.0 : 0.25;
      const jetForce = this.phys.mass * 11.2 * airScale;
      this._scratchForce.set(
        this._scratchFwd.x * jetForce,
        this._scratchFwd.y * jetForce,
        this._scratchFwd.z * jetForce
      );
      body.applyForce(this._scratchForce, this._zeroVec);
    } else if (this.exitBoostTimer > 0 && numGrounded > 0 && input.throttle > 0.2 && this.forwardSpeedMps < topSpeed) {
      const exitForce = this.phys.mass * 6.8 * Math.min(1, this.exitBoostTimer * 2.0);
      this._scratchForce.set(
        this._scratchFwd.x * exitForce,
        this._scratchFwd.y * exitForce,
        this._scratchFwd.z * exitForce
      );
      body.applyForce(this._scratchForce, this._zeroVec);
    }

    // 7. Wall-Scrape Anti-Deadlock Deflection Assist
    if (isWallScraping && numGrounded >= 1) {
      const wn = body.userData.wallNormal;
      const fwdDotWall = this._scratchFwd.x * wn.x + this._scratchFwd.z * wn.z;
      // Rotate car nose AWAY from wall toward track tangent: cross(fwd, wn).y = fwd.z * wn.x - fwd.x * wn.z
      // Positive crossWallY means rotating +Y turns fwd toward wn (away from wall)!
      if (fwdDotWall < -0.02) {
        const crossWallY = this._scratchFwd.z * wn.x - this._scratchFwd.x * wn.z;
        const alignSign = crossWallY >= 0 ? 1 : -1;
        body.torque.y += alignSign * this.phys.mass * 34 * Math.min(1, Math.abs(fwdDotWall) * 2.8 + 0.25);
        body.angularVelocity.y = THREE.MathUtils.lerp(
          body.angularVelocity.y,
          alignSign * 1.4,
          1 - Math.exp(-9.0 * dt)
        );
      }
      // Gentle separation & forward scrape glide so vehicle never deadlocks against barrier
      if (input.throttle > 0.1 && this.speedMps < 18) {
        const slidePush = this.phys.mass * 8.5;
        this._scratchForce.set(wn.x * slidePush, 0, wn.z * slidePush);
        body.applyForce(this._scratchForce, this._zeroVec);
      }
    }

    // 8. Aerodynamic Downforce (capped & keyed to forward airspeed ONLY so vertical falls never blow up!)
    const airSpeed = THREE.MathUtils.clamp(this.forwardSpeedMps, 0, 125);
    const aeroDown = Math.min(this.phys.mass * 18, this.phys.downforceCoeff * airSpeed * airSpeed);
    if (numGrounded > 0) {
      this._scratchForce.set(
        this._scratchUp.x * -aeroDown,
        this._scratchUp.y * -aeroDown,
        this._scratchUp.z * -aeroDown
      );
      body.applyForce(this._scratchForce, this._zeroVec);
    } else {
      this._scratchForce.set(0, -Math.min(this.phys.mass * 5.0, aeroDown * 0.19 + this.phys.mass * 1.4), 0);
      body.applyForce(this._scratchForce, this._zeroVec);

      body.angularVelocity.x *= Math.exp(-7.5 * dt);
      body.angularVelocity.z *= Math.exp(-7.5 * dt);

      if (this._scratchUp.y > -0.2 && this._scratchUp.y < 0.99) {
        this._scratchCarUp.set(this._scratchUp.x, this._scratchUp.y, this._scratchUp.z);
        this._scratchRight.crossVectors(this._scratchCarUp, this._scratchWorldUp);
        const airLevelStrength = this.phys.mass * 24;
        body.torque.x += this._scratchRight.x * airLevelStrength;
        body.torque.z += this._scratchRight.z * airLevelStrength;
      }
    }

    // Off-road rolling drag
    if (this.surfaceDrag > 0 && numGrounded > 0 && this.speedMps > 0.5) {
      const dragMag = this.surfaceDrag * this.phys.mass * 0.8;
      this._scratchDragForce.copy(body.velocity);
      this._scratchDragForce.normalize();
      this._scratchDragForce.scale(-dragMag, this._scratchDragForce);
      body.applyForce(this._scratchDragForce, this._zeroVec);
    }

    // Anti-roll restoring torque while partially grounded
    if (numGrounded >= 1 && numGrounded < 4 && this._scratchUp.y > 0.15 && this._scratchUp.y < 0.95) {
      this._scratchCarUp.set(this._scratchUp.x, this._scratchUp.y, this._scratchUp.z);
      this._scratchRight.crossVectors(this._scratchCarUp, this._scratchWorldUp);
      const restoreStrength = this.phys.mass * 24;
      body.torque.x += this._scratchRight.x * restoreStrength;
      body.torque.z += this._scratchRight.z * restoreStrength;
    }
  }

  capturePostStep() {
    this.currPos.set(this.chassisBody.position.x, this.chassisBody.position.y, this.chassisBody.position.z);
    this.currQuat.set(
      this.chassisBody.quaternion.x,
      this.chassisBody.quaternion.y,
      this.chassisBody.quaternion.z,
      this.chassisBody.quaternion.w
    );
    for (let i = 0; i < 4; i++) {
      const w = this.vehicle.wheelInfos[i];
      this.currWheelLengths[i] = w.suspensionLength;
      this.currWheelSpins[i] = -w.rotation;
    }
  }

  syncVisuals(alpha, carModel) {
    this._scratchVec.lerpVectors(this.prevPos, this.currPos, alpha);
    this._scratchQuat.slerpQuaternions(this.prevQuat, this.currQuat, alpha);

    carModel.root.position.copy(this._scratchVec);
    carModel.root.quaternion.copy(this._scratchQuat);
    carModel.chassisGroup.position.y = -this.yCoMOffset;

    const connectionY = (this.dim.wheelRadius - this.yCoMOffset) + this.phys.suspensionRestLength;
    let avgWheelBottom = 0;
    for (let i = 0; i < 4; i++) {
      const len = THREE.MathUtils.lerp(this.prevWheelLengths[i], this.currWheelLengths[i], alpha);
      const spin = THREE.MathUtils.lerp(this.prevWheelSpins[i], this.currWheelSpins[i], alpha);
      const w = carModel.wheels[i];
      w.root.position.y = connectionY - len;
      w.spinGroup.rotation.x = spin;
      avgWheelBottom += (connectionY - len) - this.dim.wheelRadius;
    }
    if (carModel.contactShadow) {
      carModel.contactShadow.position.y = (avgWheelBottom * 0.25) + 0.022;
    }

    carModel.steerWheels(this.steerAngle);
    carModel.setBrakeLights(this.isBraking);
  }

  isFlipped() {
    this.chassisBody.quaternion.vmult(COORDINATE_CONTRACT.UP_AXIS, this._scratchUp);
    return this._scratchUp.y < 0.25 && this.speedMps < 3.0;
  }

  dispose() {
    this.vehicle.removeFromWorld(this.physicsWorld.world);
    this.physicsWorld.untrackCollisionBody(this.chassisBody);
  }
}
