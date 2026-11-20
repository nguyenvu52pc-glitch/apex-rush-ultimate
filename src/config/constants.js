/**
 * Centralized constants, coordinate contract, deterministic PRNG, and game configuration.
 * Unified Coordinate Contract (Right-Handed):
 *   +Y = Up
 *   +Z = Forward (vehicle nose direction)
 *   +X = Left (+Y x +Z = +X)
 *   -X = Right
 * Scale: 1 unit = 1 meter
 */

export const COORDINATE_CONTRACT = Object.freeze({
  FORWARD_AXIS: Object.freeze({ x: 0, y: 0, z: 1 }),
  UP_AXIS: Object.freeze({ x: 0, y: 1, z: 0 }),
  LEFT_AXIS: Object.freeze({ x: 1, y: 0, z: 0 }),
  RIGHT_AXIS: Object.freeze({ x: -1, y: 0, z: 0 }),
  RAYCAST_VEHICLE: Object.freeze({
    indexRightAxis: 0,
    indexUpAxis: 1,
    indexForwardAxis: 2,
    directionLocal: Object.freeze({ x: 0, y: -1, z: 0 }),
    axleLocal: Object.freeze({ x: -1, y: 0, z: 0 }),
  }),
});

export const FORWARD_AXIS = COORDINATE_CONTRACT.FORWARD_AXIS;
export const UP_AXIS = COORDINATE_CONTRACT.UP_AXIS;
export const LEFT_AXIS = COORDINATE_CONTRACT.LEFT_AXIS;

export const PHYSICS_STEP = 1 / 120;
export const MAX_SUBSTEPS = 4;
export const MAX_FRAME_DT = 0.05;
export const MPS_TO_KMH = 3.6;

export const TOTAL_LAPS = 3;
export const CHECKPOINT_COUNT = 10;
export const RACER_COUNT = 8;

/**
 * Deterministic seeded PRNG using mulberry32.
 * Returns a callable `rng()` producing floats in [0, 1), with helper methods attached.
 * @param {number} seed
 * @returns {(() => number) & { range: (min: number, max: number) => number, int: (min: number, max: number) => number, pick: <T>(arr: T[]) => T }}
 */
export function createPRNG(seed = 1337) {
  let state = (seed >>> 0) || 1;
  const rng = function nextFloat() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  rng.range = (min, max) => min + (max - min) * rng();
  rng.int = (min, max) => Math.floor(rng.range(min, max + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  return rng;
}

export const GAME_CONFIG = {
  carId: 'street_sprint',
  paintIndex: 0,
  trackId: 'mountain_pass_v2',
  themeId: 'alpine_sunset',
  weather: 'clear', // 'clear' | 'rainy'
  difficulty: 'medium', // 'easy' | 'medium' | 'hard'
  quality: 'high', // 'medium' | 'high' | 'ultra'
  audioVolume: 0.75,
  muted: false,
  cameraMode: 0,
  mobileControlsOverride: false,
  totalLaps: TOTAL_LAPS,
};
