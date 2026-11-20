import * as THREE from 'three';
import {
  CHECKPOINT_COUNT,
  RACER_COUNT,
  TOTAL_LAPS,
  COORDINATE_CONTRACT,
} from '../config/constants.js';
import { CAR_IDS, CAR_CATALOG, PAINT_SWATCHES } from '../car/CarCatalog.js';
import { buildCarModel } from '../car/CarModelBuilder.js';
import { VehiclePhysics } from '../physics/VehiclePhysics.js';
import { AiDriver } from '../ai/AiDriver.js';

export const RACE_STATES = Object.freeze({
  GARAGE: 'GARAGE',
  COUNTDOWN: 'COUNTDOWN',
  RACING: 'RACING',
  FINISHED: 'FINISHED',
});

const AI_ROSTER = [
  { name: 'K. Takahashi', carId: 'hyper_gt', paintIdx: 1, lane: -2.4 },
  { name: 'V. Moretti', carId: 'street_sprint', paintIdx: 2, lane: 2.5 },
  { name: 'M. Lindqvist', carId: 'rally_hatch', paintIdx: 3, lane: -1.8 },
  { name: 'D. Mercer', carId: 'muscle_v8', paintIdx: 4, lane: 2.1 },
  { name: 'S. Sato', carId: 'street_sprint', paintIdx: 5, lane: -2.9 },
  { name: 'E. Vance', carId: 'hyper_gt', paintIdx: 7, lane: 1.5 },
  { name: 'R. Alvarez', carId: 'rally_hatch', paintIdx: 6, lane: -1.2 },
];

const STORAGE_KEY_PREFIX = 'apex_rush_best_lap_v1';

export function loadBestLap(carId, trackId) {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}:${trackId}:${carId}`);
    if (!raw) return null;
    const val = parseFloat(raw);
    return Number.isFinite(val) && val > 0 ? val : null;
  } catch {
    return null;
  }
}

export function saveBestLap(carId, trackId, lapTimeSec) {
  try {
    const key = `${STORAGE_KEY_PREFIX}:${trackId}:${carId}`;
    const prev = loadBestLap(carId, trackId);
    if (prev === null || lapTimeSec < prev) {
      window.localStorage.setItem(key, String(lapTimeSec.toFixed(3)));
      return true;
    }
  } catch {
    // Ignore storage quota or sandbox restriction errors gracefully
  }
  return false;
}

/**
 * Orchestrates the 8-car race Finite State Machine (GARAGE -> COUNTDOWN -> RACING -> FINISHED),
 * gantry countdown lights, 10-checkpoint anti-shortcut validation, wrap-around progress rankings,
 * wrong-way detection, and auto/manual recovery.
 */
export class RaceManager {
  /**
   * @param {object} deps
   * @param {THREE.Scene} deps.scene
   * @param {import('../physics/PhysicsWorld.js').PhysicsWorld} deps.physicsWorld
   * @param {import('../physics/PhysicsDebugRenderer.js').PhysicsDebugRenderer} [deps.physicsDebug]
   */
  constructor({ scene, physicsWorld, physicsDebug = null }) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.physicsDebug = physicsDebug;

    this.state = RACE_STATES.GARAGE;
    this.totalLaps = TOTAL_LAPS;
    this.trackData = null;
    this.trackVisuals = null;

    this.racers = [];
    this.standings = [];
    this.playerRacer = null;

    this.countdownTimer = 0;
    this.lastBeepStep = -1;
    this.raceElapsedTime = 0;
    this.newBestLapFlag = false;
    this.finalLapBannerTimer = 0;
    this.newBestBannerTimer = 0;

    this.onCountdownTick = null; // (stepLabel, redLights) => void
    this.onRaceFinish = null; // (standings) => void
    this.onLapComplete = null; // ({ lap, lapTime, isBest, isFinalLap }) => void

    this._projOut = null;
    this._fwd = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._up = new THREE.Vector3();
    this._left = new THREE.Vector3();
    this._basisMat = new THREE.Matrix4();
    this._respawnPos = new THREE.Vector3();
  }

  /**
   * Spawn player + 7 AI real-physics vehicles onto the 2x4 starting grid.
   */
  setupRace({
    trackData,
    trackVisuals,
    playerCarId,
    playerPaintHex,
    difficulty = 'medium',
    headlightsOn = false,
    rainEnabled = false,
    totalLaps = TOTAL_LAPS,
    startCountdown = true,
  }) {
    this.clearRacers();
    this.trackData = trackData;
    this.trackVisuals = trackVisuals;
    this.totalLaps = totalLaps;
    this.rainEnabled = rainEnabled;
    this._projOut = trackData.project({ x: 0, y: 0, z: 0 });

    this.raceElapsedTime = 0;
    this.newBestLapFlag = false;
    this.finalLapBannerTimer = 0;
    this.newBestBannerTimer = 0;

    // Player starts at P8 (or P1 in quick test; P8 makes overtaking 7 AI rivals thrilling!)
    // Actually spawn Player at slot 7 (back row) or slot 0? Let's place Player in slot 6/7 (row 4) or slot 0:
    // Let's put Player in slot 7 (P8 grid) so overtaking through the pack works from turn 1!
    const playerSlotIdx = RACER_COUNT - 1;
    let aiIdx = 0;

    for (let slotIdx = 0; slotIdx < RACER_COUNT; slotIdx++) {
      const isPlayer = slotIdx === playerSlotIdx;
      const gridSlot = trackData.startingGrid[slotIdx];

      let carId = playerCarId;
      let paintHex = playerPaintHex;
      let racerName = 'YOU';

      if (!isPlayer) {
        const aiMeta = AI_ROSTER[aiIdx % AI_ROSTER.length];
        carId = aiMeta.carId;
        paintHex = PAINT_SWATCHES[aiMeta.paintIdx % PAINT_SWATCHES.length].hex;
        racerName = aiMeta.name;
        aiIdx += 1;
      }

      const spec = CAR_CATALOG[carId] || CAR_CATALOG[CAR_IDS[0]];
      const carModel = buildCarModel(carId, { paintHex });
      carModel.setHeadlights(headlightsOn);
      this.scene.add(carModel.root);

      const vp = new VehiclePhysics(this.physicsWorld, spec, {
        position: gridSlot.position,
        quaternion: gridSlot.quaternion,
        userData: { isPlayer, racerIndex: slotIdx },
      });
      vp.controlsLocked = startCountdown;
      vp.syncVisuals(1, carModel);

      if (this.physicsDebug) {
        this.physicsDebug.addVehicle(vp);
      }

      const aiDriver = isPlayer
        ? null
        : new AiDriver({
            trackData,
            vehiclePhysics: vp,
            baseLaneOffset: AI_ROSTER[(slotIdx) % AI_ROSTER.length].lane,
            difficulty,
            seedOffset: slotIdx + 1,
          });

      const racer = {
        index: slotIdx,
        name: racerName,
        isPlayer,
        carId,
        carName: spec.name,
        paintHex,
        vp,
        carModel,
        aiDriver,
        u: gridSlot.u,
        prevU: gridSlot.u,
        lateralOffset: 0,
        onRoad: true,
        completedCycles: -1, // Grid sits behind u=0 line so initial progress is in [-0.05..0)
        progress: gridSlot.u - 1.0,
        lap: 1,
        nextCheckpoint: 0,
        lapStartTime: 0,
        currentLapTime: 0,
        bestLapTime: isPlayer ? loadBestLap(carId, trackData.id) : null,
        sessionBestLap: null,
        totalTime: 0,
        finished: false,
        finishTime: Infinity,
        rank: slotIdx + 1,
        wrongWay: false,
        flipTimer: 0,
      };

      this.racers.push(racer);
      if (isPlayer) this.playerRacer = racer;
    }

    this.standings = this.racers.slice();

    if (startCountdown) {
      this.state = RACE_STATES.COUNTDOWN;
      this.countdownTimer = 3.6;
      this.lastBeepStep = -1;
      if (this.trackVisuals) this.trackVisuals.setGantryLights(0, false);
    } else {
      this.state = RACE_STATES.RACING;
      for (const r of this.racers) r.vp.controlsLocked = false;
      if (this.trackVisuals) this.trackVisuals.setGantryLights(0, true);
    }
  }

  /**
   * Update AI inputs & surface modifiers BEFORE each 120Hz physics step.
   */
  stepPhysics(dt, playerInput) {
    if (!this.trackData || this.racers.length === 0) return;

    const isRacing = this.state === RACE_STATES.RACING;
    const playerProgress = this.playerRacer ? this.playerRacer.progress : 0;

    for (let i = 0; i < this.racers.length; i++) {
      const r = this.racers[i];
      this.trackData.project(r.vp.chassisBody.position, this._projOut);
      r.u = this._projOut.u;
      r.lateralOffset = this._projOut.lateralOffset;
      r.onRoad = this._projOut.onRoad;

      const baseGrip = r.onRoad ? (this.rainEnabled ? 0.88 : 1.0) : 0.70;
      const drag = r.onRoad ? 0.0 : 2.8;
      r.vp.setSurfaceModifier(baseGrip, drag);

      if (r.isPlayer) {
        if (this.state === RACE_STATES.FINISHED && r.aiDriver) {
          // Coast/auto-drive player gracefully on finish
          const aiIn = r.aiDriver.update(dt, { racers: this.racers, myRacer: r, playerProgress, isRacing: false });
          r.vp.step(dt, aiIn);
        } else {
          r.vp.step(dt, playerInput);
        }
      } else {
        const aiIn = r.aiDriver.update(dt, {
          racers: this.racers,
          myRacer: r,
          playerProgress,
          isRacing,
        });
        r.vp.step(dt, aiIn);
      }
    }
  }

  capturePostPhysics() {
    for (let i = 0; i < this.racers.length; i++) {
      this.racers[i].vp.capturePostStep();
    }
  }

  /**
   * Sync visual car transforms, countdown state machine, checkpoints, laps, and standings.
   */
  update(dt, alpha) {
    if (!this.trackData || this.racers.length === 0) return;

    for (let i = 0; i < this.racers.length; i++) {
      const r = this.racers[i];
      r.vp.syncVisuals(alpha, r.carModel);
    }

    if (this.finalLapBannerTimer > 0) this.finalLapBannerTimer = Math.max(0, this.finalLapBannerTimer - dt);
    if (this.newBestBannerTimer > 0) this.newBestBannerTimer = Math.max(0, this.newBestBannerTimer - dt);

    // 1. Countdown State Machine synced to 5 Gantry Lights
    if (this.state === RACE_STATES.COUNTDOWN) {
      this.countdownTimer -= dt;
      // 3.6 -> 0.0: 3 (3.6..2.7), 2 (2.7..1.8), 1 (1.8..0.9), GO! (<0.4)
      let stepIdx = 0;
      let label = '3';
      let redLights = 2;
      if (this.countdownTimer > 2.7) {
        stepIdx = 3;
        label = '3';
        redLights = 2;
      } else if (this.countdownTimer > 1.8) {
        stepIdx = 2;
        label = '2';
        redLights = 4;
      } else if (this.countdownTimer > 0.7) {
        stepIdx = 1;
        label = '1';
        redLights = 5;
      } else {
        stepIdx = 0;
        label = 'GO!';
        redLights = 0;
      }

      if (stepIdx !== this.lastBeepStep) {
        this.lastBeepStep = stepIdx;
        if (this.trackVisuals) {
          this.trackVisuals.setGantryLights(redLights, stepIdx === 0);
        }
        if (this.onCountdownTick) {
          this.onCountdownTick(label, stepIdx === 0);
        }
        if (stepIdx === 0) {
          // Green flag: unlock throttles & start race clock!
          this.state = RACE_STATES.RACING;
          this.raceElapsedTime = 0;
          for (const r of this.racers) {
            r.vp.controlsLocked = false;
            r.lapStartTime = 0;
          }
        }
      }
      return;
    }

    if (this.state !== RACE_STATES.RACING && this.state !== RACE_STATES.FINISHED) return;

    this.raceElapsedTime += dt;

    // 2. Checkpoints, Lap Validation, Wrap-Around Progress & Wrong-Way Check
    for (let i = 0; i < this.racers.length; i++) {
      const r = this.racers[i];
      this.trackData.project(r.vp.chassisBody.position, this._projOut);
      const currU = this._projOut.u;

      // Wrap-around cycle tracking across start/finish u = 0
      const deltaU = currU - r.prevU;
      if (deltaU < -0.5) {
        r.completedCycles += 1;
      } else if (deltaU > 0.5) {
        r.completedCycles -= 1;
      }
      r.prevU = currU;
      r.u = currU;
      r.progress = r.completedCycles + currU;

      if (r.finished) continue;

      r.currentLapTime = this.raceElapsedTime - r.lapStartTime;

      // Sequential 10-checkpoint validation (Anti-Shortcut Rule #9)
      if (r.nextCheckpoint < CHECKPOINT_COUNT) {
        const cp = this.trackData.checkpoints[r.nextCheckpoint];
        if (currU >= cp.u && currU < cp.u + 0.08 && r.completedCycles >= r.lap - 1) {
          r.nextCheckpoint += 1;
        }
      }

      // Lap completes strictly after all 10 checkpoints passed and car crosses start line forward
      if (r.nextCheckpoint >= CHECKPOINT_COUNT && r.completedCycles >= r.lap) {
        const lapTime = r.currentLapTime;
        if (r.sessionBestLap === null || lapTime < r.sessionBestLap) {
          r.sessionBestLap = lapTime;
        }

        let isNewBest = false;
        if (r.isPlayer) {
          isNewBest = saveBestLap(r.carId, this.trackData.id, lapTime);
          if (r.bestLapTime === null || lapTime < r.bestLapTime) {
            r.bestLapTime = lapTime;
          }
          if (isNewBest) {
            this.newBestLapFlag = true;
            this.newBestBannerTimer = 2.6;
          }
        }

        if (r.lap >= this.totalLaps) {
          r.finished = true;
          r.finishTime = this.raceElapsedTime;
          r.totalTime = this.raceElapsedTime;

          if (r.isPlayer) {
            this.state = RACE_STATES.FINISHED;
            // Attach temporary AI cruise driver on player car post-finish
            r.aiDriver = new AiDriver({
              trackData: this.trackData,
              vehiclePhysics: r.vp,
              baseLaneOffset: 0,
              difficulty: 'medium',
            });
            if (this.onRaceFinish) {
              this.onRaceFinish(this.standings);
            }
          }
        } else {
          r.lap += 1;
          r.nextCheckpoint = 0;
          r.lapStartTime = this.raceElapsedTime;
          r.currentLapTime = 0;
          if (r.isPlayer) {
            if (r.lap === this.totalLaps) {
              this.finalLapBannerTimer = 2.6;
            }
            if (this.onLapComplete) {
              this.onLapComplete({
                lap: r.lap,
                lapTime,
                isBest: isNewBest,
                isFinalLap: r.lap === this.totalLaps,
              });
            }
          }
        }
      }

      // Wrong-way detection (>105 deg opposite track tangent) & auto flip recovery for player
      if (r.isPlayer) {
        this._quat.set(
          r.vp.chassisBody.quaternion.x,
          r.vp.chassisBody.quaternion.y,
          r.vp.chassisBody.quaternion.z,
          r.vp.chassisBody.quaternion.w
        );
        this._fwd
          .set(
            COORDINATE_CONTRACT.FORWARD_AXIS.x,
            COORDINATE_CONTRACT.FORWARD_AXIS.y,
            COORDINATE_CONTRACT.FORWARD_AXIS.z
          )
          .applyQuaternion(this._quat)
          .normalize();
        const align = this._fwd.dot(this._projOut.frame.tangent);
        r.wrongWay = align < -0.259 && r.vp.speedMps > 2.5;

        const bp = r.vp.chassisBody.position;
        const offBounds =
          !Number.isFinite(bp.x) ||
          !Number.isFinite(bp.y) ||
          Math.abs(this._projOut.lateralOffset) > this.trackData.totalWidthHalf + 5.5 ||
          bp.y < this._projOut.frame.position.y - 3.5;

        if (offBounds || r.vp.isFlipped()) {
          r.flipTimer += offBounds ? dt * 3.0 : dt;
          if (r.flipTimer > 2.2) {
            this.resetPlayerToTrack();
            r.flipTimer = 0;
          }
        } else {
          r.flipTimer = 0;
        }
      }
    }

    // 3. Sort live standings (finished racers ordered by finishTime, racing cars by continuous progress)
    this.standings.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    for (let i = 0; i < this.standings.length; i++) {
      this.standings[i].rank = i + 1;
    }
  }

  /**
   * Respawn player smoothly onto nearest track frame facing forward (R key or 3s flip recovery).
   */
  resetPlayerToTrack() {
    if (!this.playerRacer || !this.trackData) return;
    const r = this.playerRacer;
    this.trackData.project(r.vp.chassisBody.position, this._projOut);
    let safeU = this._projOut.u;
    if (this._projOut.isGapSegment && this.trackData.jumpZones?.length) {
      const idx = Math.floor(safeU * this.trackData.sampleCount);
      for (const jz of this.trackData.jumpZones) {
        if (idx >= jz.takeoffIdx - 1 && idx <= jz.gapEndIdx + 1) {
          safeU = Math.max(0, (jz.rampStartIdx - 3) / this.trackData.sampleCount);
          break;
        }
      }
    }
    const f = this.trackData.getFrameAt(safeU, this._projOut.frame);
    this._respawnPos.copy(f.position).addScaledVector(f.up, 0.45);
    this._left.copy(f.right).negate();
    this._basisMat.makeBasis(this._left, f.up, f.tangent);
    this._quat.setFromRotationMatrix(this._basisMat);
    r.vp.reset(this._respawnPos, this._quat);
    r.wrongWay = false;
    r.flipTimer = 0;
  }

  setDifficulty(difficulty) {
    for (const r of this.racers) {
      if (r.aiDriver) r.aiDriver.setDifficulty(difficulty);
    }
  }

  setHeadlights(active) {
    for (const r of this.racers) {
      r.carModel.setHeadlights(active);
    }
  }

  clearRacers() {
    for (const r of this.racers) {
      if (this.physicsDebug) {
        this.physicsDebug.removeVehicle(r.vp);
      }
      r.vp.dispose();
      this.scene.remove(r.carModel.root);
      r.carModel.dispose();
    }
    this.racers.length = 0;
    this.standings.length = 0;
    this.playerRacer = null;
  }

  dispose() {
    this.clearRacers();
  }
}
