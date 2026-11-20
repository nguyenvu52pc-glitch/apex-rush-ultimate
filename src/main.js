import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  GAME_CONFIG,
  PHYSICS_STEP,
  MAX_SUBSTEPS,
  MAX_FRAME_DT,
  MPS_TO_KMH,
} from './config/constants.js';
import { RendererContext } from './core/RendererContext.js';
import { InputManager } from './core/InputManager.js';
import { QualityManager } from './core/QualityManager.js';
import { DebugOverlay } from './ui/DebugOverlay.js';
import { TuningPanel } from './ui/TuningPanel.js';
import { EnvironmentFactory } from './graphics/EnvironmentFactory.js';
import { PostProcessingRig } from './graphics/PostProcessingRig.js';
import { CAR_CATALOG, PAINT_SWATCHES } from './car/CarCatalog.js';
import { buildCarModel } from './car/CarModelBuilder.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { PhysicsDebugRenderer } from './physics/PhysicsDebugRenderer.js';
import { TrackData } from './track/TrackData.js';
import { buildTrackVisuals } from './track/TrackBuilder.js';
import { TrackPhysics } from './track/TrackPhysics.js';
import { getThemeSpec } from './world/ThemeCatalog.js';
import { TerrainBuilder } from './world/TerrainBuilder.js';
import { SceneryBuilder } from './world/SceneryBuilder.js';
import { LightingRig } from './world/LightingRig.js';
import { CameraRig } from './camera/CameraRig.js';
import { ParticleEffects } from './vfx/ParticleEffects.js';
import { RaceManager, RACE_STATES } from './gameplay/RaceManager.js';
import { SoundEngine } from './audio/SoundEngine.js';
import { HudController } from './ui/HudController.js';
import { MenuSystem } from './ui/MenuSystem.js';

/**
 * Apex Rush: Ultimate — Complete Production Loop (Stage 9):
 * - 3D Interactive Garage Showcase -> Countdown -> 8-Car Real-Physics Race -> Results
 * - QualityManager (Medium / High / Ultra) + FPS Watchdog (<35 FPS for >4s on Ultra)
 * - Browser lifecycle hardening: visibilitychange / window.blur clearKeys(), auto-pause, audio safety
 */

const canvas = document.getElementById('game-canvas');
const hudRoot = document.getElementById('hud-root');
const menuRoot = document.getElementById('menu-root');
const tuningRoot = document.getElementById('tuning-root');
const debugRoot = document.getElementById('debug-root');
const mobileRoot = document.getElementById('mobile-root');
const toastRoot = document.getElementById('toast-root');

const rendererCtx = new RendererContext(canvas);
const inputManager = new InputManager();
const debugOverlay = new DebugOverlay(debugRoot);
debugOverlay.toggle(false); // Toggle via F3
const tuningPanel = new TuningPanel(tuningRoot);
const envFactory = new EnvironmentFactory(rendererCtx.renderer);
const postProcessing = new PostProcessingRig(rendererCtx);
const soundEngine = new SoundEngine();

const { scene, camera, renderer } = rendererCtx;
const lightingRig = new LightingRig(scene);
const physicsWorld = new PhysicsWorld();
const physicsDebug = new PhysicsDebugRenderer(scene, physicsWorld);
const cameraRig = new CameraRig(camera);
const particleVfx = new ParticleEffects(scene, camera);
const raceManager = new RaceManager({ scene, physicsWorld, physicsDebug });
const hud = new HudController(hudRoot, toastRoot);
const qualityManager = new QualityManager({
  rendererCtx,
  postProcessing,
  lightingRig,
  particleVfx,
});
const menu = new MenuSystem({
  menuRoot,
  mobileRoot,
  config: GAME_CONFIG,
  inputManager,
});

const orbitControls = new OrbitControls(camera, canvas);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.08;
orbitControls.minDistance = 3.2;
orbitControls.maxDistance = 12.5;
orbitControls.maxPolarAngle = Math.PI * 0.47;

let appMode = 'GARAGE'; // 'GARAGE' | 'RACE'
let isPaused = false;
let isTabHidden = false;

let activeTrackData = null;
let activeTrackVisuals = null;
let activeTrackPhysics = null;
let activeTerrain = null;
let activeScenery = null;
let garageCarModel = null;

// Pre-allocated scratch arrays/vectors for hot loop & spatial AI audio (Rule #10)
const aiSpatialList = [
  { pan: 0, gain: 0, rpmNormalized: 0 },
  { pan: 0, gain: 0, rpmNormalized: 0 },
];
const _camRight = new THREE.Vector3();
const _toAi = new THREE.Vector3();
const _garageTarget = new THREE.Vector3();
const _garageLeft = new THREE.Vector3();
const _garageBasis = new THREE.Matrix4();

function getSelectedPaintHex() {
  const sw = PAINT_SWATCHES[GAME_CONFIG.paintIndex % PAINT_SWATCHES.length];
  return sw ? sw.hex : CAR_CATALOG[GAME_CONFIG.carId].defaultPaint;
}

function rebuildGarageShowcaseCar() {
  if (garageCarModel) {
    scene.remove(garageCarModel.root);
    garageCarModel.dispose();
    garageCarModel = null;
  }
  if (appMode !== 'GARAGE' || !activeTrackData) return;

  const themeSpec = getThemeSpec(GAME_CONFIG.themeId);
  const lightsOn = themeSpec.isNight || GAME_CONFIG.weather === 'rainy';

  garageCarModel = buildCarModel(GAME_CONFIG.carId, { paintHex: getSelectedPaintHex() });
  garageCarModel.setHeadlights(lightsOn);

  const frame = activeTrackData.getFrameAt(0.0);
  _garageLeft.copy(frame.right).negate();
  _garageBasis.makeBasis(_garageLeft, frame.up, frame.tangent);
  garageCarModel.root.position.copy(frame.position).addScaledVector(frame.up, 0.03);
  garageCarModel.root.quaternion.setFromRotationMatrix(_garageBasis);
  scene.add(garageCarModel.root);

  _garageTarget.copy(garageCarModel.root.position).addScaledVector(frame.up, 0.7);
  orbitControls.target.copy(_garageTarget);
  camera.position
    .copy(_garageTarget)
    .addScaledVector(frame.tangent, 4.6)
    .addScaledVector(frame.right, -3.2)
    .addScaledVector(frame.up, 1.5);
  camera.fov = 52;
  camera.updateProjectionMatrix();
  orbitControls.update();
}

function rebuildEnvironment({ rebuildTrack = true, rebuildTerrain = true, rebuildScenery = true } = {}) {
  const themeSpec = getThemeSpec(GAME_CONFIG.themeId);
  const rainOn = GAME_CONFIG.weather === 'rainy';
  const lightsOn = themeSpec.isNight || rainOn;

  if (rebuildScenery || rebuildTerrain) {
    if (activeScenery) {
      scene.remove(activeScenery.root);
      activeScenery.dispose();
      activeScenery = null;
    }
  }
  if (rebuildTerrain) {
    if (activeTerrain) {
      scene.remove(activeTerrain.mesh);
      activeTerrain.dispose();
      activeTerrain = null;
    }
  }

  if (rebuildTrack) {
    particleVfx.clearSkidmarks();
    if (activeTrackPhysics) {
      activeTrackPhysics.dispose();
      activeTrackPhysics = null;
    }
    if (activeTrackVisuals) {
      scene.remove(activeTrackVisuals.root);
      activeTrackVisuals.dispose();
      activeTrackVisuals = null;
    }

    activeTrackData = new TrackData(GAME_CONFIG.trackId);
    activeTrackVisuals = buildTrackVisuals(activeTrackData, renderer);
    activeTrackVisuals.setGantryLights(0, false);
    scene.add(activeTrackVisuals.root);

    activeTrackPhysics = new TrackPhysics(physicsWorld, activeTrackData);
    physicsDebug.setTrackDebug(activeTrackData);
    hud.bindTrack(activeTrackData);
  }

  scene.background = new THREE.Color(themeSpec.fog.color);
  scene.fog = new THREE.FogExp2(themeSpec.fog.color, themeSpec.fog.density);
  lightingRig.applyTheme(themeSpec);
  envFactory.bakeToScene(scene, {
    ...themeSpec.envOptions,
    sunDirection: new THREE.Vector3(...themeSpec.lighting.sunDirection).normalize(),
  });

  if (rebuildTerrain && !activeTerrain) {
    activeTerrain = new TerrainBuilder(activeTrackData, themeSpec);
    scene.add(activeTerrain.mesh);
  }

  if ((rebuildScenery || rebuildTerrain) && activeTerrain && !activeScenery) {
    activeScenery = new SceneryBuilder(activeTrackData, activeTerrain, themeSpec, {
      grassDensityScale: qualityManager.preset.grassDensityScale,
      foliageShadows: qualityManager.preset.foliageShadows,
    });
    scene.add(activeScenery.root);
  }

  particleVfx.setRainEnabled(rainOn);
  particleVfx.setHeadlightsActive(appMode === 'RACE' && lightsOn);
  if (activeTrackVisuals) {
    activeTrackVisuals.setAsphaltWetness(rainOn ? 0.92 : themeSpec.id === 'neon_metropolis' ? 0.35 : 0.0);
  }
}

function enterGarage() {
  appMode = 'GARAGE';
  isPaused = false;
  soundEngine.setPaused(false);
  raceManager.clearRacers();
  particleVfx.clearSkidmarks();
  particleVfx.setHeadlightsActive(false);

  hud.setVisible(false);
  menu.setGarageVisible(true);
  orbitControls.enabled = true;
  if (activeTrackVisuals) activeTrackVisuals.setGantryLights(0, false);

  rebuildGarageShowcaseCar();
}

function startRace() {
  soundEngine.unlock();
  if (garageCarModel) {
    scene.remove(garageCarModel.root);
    garageCarModel.dispose();
    garageCarModel = null;
  }

  appMode = 'RACE';
  isPaused = false;
  soundEngine.setPaused(isTabHidden);
  orbitControls.enabled = false;
  menu.setGarageVisible(false);
  menu.setPauseVisible(false);
  hud.hideResults();
  hud.setVisible(true);
  particleVfx.clearSkidmarks();

  const themeSpec = getThemeSpec(GAME_CONFIG.themeId);
  const rainOn = GAME_CONFIG.weather === 'rainy';
  const lightsOn = themeSpec.isNight || rainOn;

  particleVfx.setRainEnabled(rainOn);
  particleVfx.setHeadlightsActive(lightsOn);

  raceManager.setupRace({
    trackData: activeTrackData,
    trackVisuals: activeTrackVisuals,
    playerCarId: GAME_CONFIG.carId,
    playerPaintHex: getSelectedPaintHex(),
    difficulty: GAME_CONFIG.difficulty,
    headlightsOn: lightsOn,
    rainEnabled: rainOn,
    totalLaps: GAME_CONFIG.totalLaps,
    startCountdown: true,
  });

  if (raceManager.playerRacer) {
    tuningPanel.bindVehicle(raceManager.playerRacer.vp);
    cameraRig.setMode(GAME_CONFIG.cameraMode);
    cameraRig.snapToTarget(raceManager.playerRacer.carModel.root);
  }
}

function setPaused(paused) {
  if (appMode !== 'RACE' || raceManager.state === RACE_STATES.FINISHED) return;
  isPaused = Boolean(paused);
  soundEngine.setPaused(isPaused || isTabHidden);
  menu.setPauseVisible(isPaused);
}

function applyQualityPreset(presetId) {
  GAME_CONFIG.quality = presetId;
  const { rebuildSceneryNeeded } = qualityManager.applyPreset(presetId);
  if (rebuildSceneryNeeded && activeTrackData && activeTerrain) {
    rebuildEnvironment({ rebuildTrack: false, rebuildTerrain: false, rebuildScenery: true });
  }
}

// FPS Watchdog Low-FPS Downgrade Toast
qualityManager.onWatchdogTrigger = (avgFps) => {
  hud.showToast(
    `Performance (${avgFps.toFixed(0)} FPS) is below 35 FPS on Ultra.`,
    7000,
    'Switch to High',
    () => {
      applyQualityPreset('high');
      menu.renderGarageState();
      menu.syncPauseState();
    }
  );
};

// Race & Audio Hooks
raceManager.onCountdownTick = (label, isGo) => {
  hud.showBanner(label, isGo ? 1100 : 800, isGo ? 'cyan' : 'gold');
  soundEngine.playCountdownBeep(isGo);
};

raceManager.onRaceFinish = (standings) => {
  hud.showResults(standings);
};

physicsWorld.onCollision((e) => {
  if (appMode !== 'RACE' || e.intensity <= 2.2) return;
  const p = e.point;
  const dx = p.x - camera.position.x;
  const dz = p.z - camera.position.z;
  if (dx * dx + dz * dz < 8500) {
    particleVfx.emitSparks(p, e.normal, e.intensity);
  }
  const playerBody = raceManager.playerRacer?.vp.chassisBody;
  if (playerBody && (e.bodyA === playerBody || e.bodyB === playerBody)) {
    cameraRig.addTrauma(Math.min(0.85, e.intensity / 26));
    soundEngine.playImpact(e.intensity);
  }
});

// UI Menu & HUD Callbacks
menu.onConfigChange = (key, val) => {
  if (key === 'carId') {
    rebuildGarageShowcaseCar();
  } else if (key === 'paintIndex') {
    if (garageCarModel) garageCarModel.setPaint(getSelectedPaintHex());
  } else if (key === 'trackId') {
    rebuildEnvironment({ rebuildTrack: true, rebuildTerrain: true, rebuildScenery: true });
    rebuildGarageShowcaseCar();
  } else if (key === 'themeId') {
    rebuildEnvironment({ rebuildTrack: false, rebuildTerrain: true, rebuildScenery: true });
    rebuildGarageShowcaseCar();
  } else if (key === 'weather') {
    rebuildEnvironment({ rebuildTrack: false, rebuildTerrain: false, rebuildScenery: false });
    if (garageCarModel) {
      const lightsOn = getThemeSpec(GAME_CONFIG.themeId).isNight || val === 'rainy';
      garageCarModel.setHeadlights(lightsOn);
    }
  } else if (key === 'audioVolume') {
    soundEngine.setVolume(val);
  } else if (key === 'quality') {
    applyQualityPreset(val);
  }
};

menu.onStartRace = startRace;
menu.onResume = () => setPaused(false);
menu.onRestartRace = () => startRace();
menu.onExitToGarage = () => enterGarage();
hud.onRaceAgain = () => startRace();
hud.onBackToGarage = () => enterGarage();

// Input & Audio Autoplay Unlock
const unlockAudioOnce = () => {
  soundEngine.unlock();
};
window.addEventListener('pointerdown', unlockAudioOnce, { once: true });
window.addEventListener('keydown', unlockAudioOnce, { once: true });

inputManager.onAction('toggleDebug', () => debugOverlay.toggle());
inputManager.onAction('toggleTuning', () => tuningPanel.toggle());
inputManager.onAction('togglePhysicsDebug', () => physicsDebug.toggle());
inputManager.onAction('cycleCamera', () => {
  if (appMode === 'RACE') {
    const modeName = cameraRig.cycleMode();
    GAME_CONFIG.cameraMode = cameraRig.mode;
    hud.showToast(`Camera: ${modeName}`, 1400);
  }
});
inputManager.onAction('resetCar', () => {
  if (appMode === 'RACE' && !isPaused) raceManager.resetPlayerToTrack();
});
inputManager.onAction('toggleMute', () => {
  soundEngine.unlock();
  const muted = soundEngine.toggleMute();
  GAME_CONFIG.muted = muted;
  hud.showToast(muted ? 'Audio Muted' : 'Audio Unmuted', 1400);
});
inputManager.onAction('togglePause', () => {
  if (appMode === 'RACE') setPaused(!isPaused);
});

// Browser Lifecycle & Tab-Switch Hardening (Stage 9)
let accumulator = 0;
let lastTime = performance.now();
let elapsedTime = 0;

function handleFocusLoss() {
  inputManager.clearKeys();
  accumulator = 0;
  isTabHidden = true;
  soundEngine.setPaused(true);
  if (appMode === 'RACE' && raceManager.state === RACE_STATES.RACING) {
    setPaused(true);
  }
}

function handleVisibilityChange() {
  if (document.hidden) {
    handleFocusLoss();
  } else {
    isTabHidden = false;
    lastTime = performance.now();
    accumulator = 0;
    soundEngine.setPaused(isPaused);
  }
}

window.addEventListener('blur', handleFocusLoss);
window.addEventListener('focus', () => {
  if (!document.hidden) {
    isTabHidden = false;
    lastTime = performance.now();
    accumulator = 0;
    soundEngine.setPaused(isPaused);
  }
});
document.addEventListener('visibilitychange', handleVisibilityChange);

// Initialize Quality, World & 3D Garage
qualityManager.applyPreset(GAME_CONFIG.quality);
rebuildEnvironment({ rebuildTrack: true, rebuildTerrain: true, rebuildScenery: true });
enterGarage();

function updateSpatialAiAudio(player) {
  let d1 = Infinity;
  let d2 = Infinity;
  let r1 = null;
  let r2 = null;

  const pPos = player.carModel.root.position;
  for (let i = 0; i < raceManager.racers.length; i++) {
    const r = raceManager.racers[i];
    if (r.isPlayer) continue;
    const ap = r.carModel.root.position;
    const distSq = (ap.x - pPos.x) ** 2 + (ap.y - pPos.y) ** 2 + (ap.z - pPos.z) ** 2;
    if (distSq < d1) {
      d2 = d1;
      r2 = r1;
      d1 = distSq;
      r1 = r;
    } else if (distSq < d2) {
      d2 = distSq;
      r2 = r;
    }
  }

  _camRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
  const pair = [r1, r2];
  const distSqs = [d1, d2];

  for (let i = 0; i < 2; i++) {
    const slot = aiSpatialList[i];
    const ai = pair[i];
    const dist = Math.sqrt(distSqs[i]);
    if (ai && dist < 55) {
      _toAi.subVectors(ai.carModel.root.position, camera.position).normalize();
      slot.pan = _toAi.dot(_camRight);
      slot.gain = Math.pow(1 - dist / 55, 1.6);
      slot.rpmNormalized = ai.vp.rpmNormalized;
    } else {
      slot.gain = 0;
    }
  }
}

function animate(now) {
  requestAnimationFrame(animate);

  const rawDt = (now - lastTime) / 1000;
  lastTime = now;
  const frameDt = Math.min(Math.max(rawDt, 0), MAX_FRAME_DT);
  elapsedTime += frameDt;

  const input = inputManager.update();

  if (appMode === 'GARAGE') {
    orbitControls.update();
    if (garageCarModel) {
      lightingRig.update(garageCarModel.root.position);
      particleVfx.update(frameDt, { elapsedTime });
    }
    postProcessing.setDrivingState(0, false, frameDt, 0, elapsedTime);
    soundEngine.update({ active: false });
  } else {
    if (!isPaused && !isTabHidden) {
      accumulator += frameDt;
      let substeps = 0;
      while (accumulator >= PHYSICS_STEP && substeps < MAX_SUBSTEPS) {
        raceManager.stepPhysics(PHYSICS_STEP, input);
        physicsWorld.step(PHYSICS_STEP);
        raceManager.capturePostPhysics();
        accumulator -= PHYSICS_STEP;
        substeps += 1;
      }
      if (substeps === MAX_SUBSTEPS) {
        accumulator = 0;
      }

      const alpha = accumulator / PHYSICS_STEP;
      raceManager.update(frameDt, alpha);
    }

    const player = raceManager.playerRacer;
    if (player) {
      cameraRig.update(frameDt, {
        carModel: player.carModel,
        vehiclePhysics: player.vp,
        lookBack: input.lookBack,
        terrain: activeTerrain,
        trackData: activeTrackData,
        onRoad: player.onRoad,
      });

      lightingRig.update(player.carModel.root.position);

      if (!isPaused && !isTabHidden) {
        particleVfx.update(frameDt, {
          playerVehicle: player.vp,
          playerModel: player.carModel,
          onRoad: player.onRoad,
          racers: raceManager.racers,
          elapsedTime,
        });
        postProcessing.setDrivingState(
          player.vp.speedMps,
          player.vp.nitroActive,
          frameDt,
          player.vp.nitroIgnitePulse,
          elapsedTime,
          player.carModel.spec.nitroColor?.lightHex ?? 0x00e5ff
        );
        hud.update(raceManager);
        updateSpatialAiAudio(player);
        soundEngine.update({
          active: true,
          rpmNormalized: player.vp.rpmNormalized,
          throttle: input.throttle,
          gear: player.vp.gear,
          speedMps: player.vp.speedMps,
          isDrifting: player.vp.isDrifting,
          nitroActive: player.vp.nitroActive,
          aiSpatial: aiSpatialList,
        });
        qualityManager.updateWatchdog(frameDt, raceManager.state === RACE_STATES.RACING);
      }
    }
  }

  if (activeScenery && !isPaused && !isTabHidden) {
    activeScenery.update(frameDt, elapsedTime);
  }

  physicsDebug.update();
  postProcessing.render();

  const focusPos =
    appMode === 'GARAGE'
      ? garageCarModel?.root.position || camera.position
      : raceManager.playerRacer?.carModel.root.position || camera.position;
  const speedKmh =
    appMode === 'RACE' && raceManager.playerRacer
      ? raceManager.playerRacer.vp.speedMps * MPS_TO_KMH
      : 0;
  debugOverlay.update(frameDt, renderer, focusPos, speedKmh);
}

requestAnimationFrame(animate);
