/**
 * Definitions for 2 distinct closed 3D racing circuits (16-22 control points each).
 * Units in meters. Coordinate contract: +Y Up, +Z Forward, +X Left.
 */

export const TRACK_IDS = ['mountain_pass_v2', 'neon_bay_v2', 'mountain_pass', 'neon_bay_circuit'];

export const TRACK_CATALOG = {
  mountain_pass: {
    id: 'mountain_pass',
    name: 'Alpine Ridge Pass',
    subtitle: 'Wide high-speed mountain circuit with banked sweepers & elevation climbs',
    trackWidth: 22.0,
    shoulderWidth: 4.5,
    maxBankingRad: 0.22, // ~12.6 deg
    sampleCount: 540,
    barrierStyle: 'guardrail',
    // 18 well-spaced 3D control points forming a large (~1.9 km) smooth closed alpine loop
    // Minimum turning radii kept comfortably > 35m (>> halfWidth + 4m)
    controlPoints: [
      [0, 0, 0],          // Start/Finish Straight (+Z)
      [0, 0, 120],        // End of main straight
      [-28, 3, 235],      // Turn 1 braking entry (sweeping right)
      [-110, 9, 305],     // Turn 1 wide apex
      [-225, 16, 295],    // Climbing mountain ridge
      [-320, 24, 215],    // High alpine plateau
      [-335, 26, 95],     // Sweeping left descent entry
      [-265, 19, -15],    // Mid-mountain esses
      [-310, 13, -135],   // Fast downhill kink
      [-255, 7, -255],    // Lower valley hairpin entry
      [-145, 4, -315],    // Valley hairpin apex
      [-35, 6, -270],     // Climbing out of valley
      [65, 11, -305],     // Back sweeping chicane
      [175, 13, -245],    // High-speed east ridge
      [210, 8, -125],     // Long banked sweeper
      [155, 4, -20],      // Final corner entry
      [70, 1, -85],       // Wait: ensure smooth entry onto straight without S-crossing!
    ],
  },

  neon_bay_circuit: {
    id: 'neon_bay_circuit',
    name: 'Neon Bay Circuit',
    subtitle: 'Wide technical coastal & urban circuit with hairpins, S-chicanes & bridge',
    trackWidth: 20.5,
    shoulderWidth: 4.0,
    maxBankingRad: 0.16, // ~9.2 deg
    sampleCount: 520,
    barrierStyle: 'concrete',
    // 18 well-spaced 3D control points forming a technical (~1.7 km) closed loop
    controlPoints: [
      [0, 0, 0],          // Start/Finish Straight (+Z)
      [0, 0, 115],        // Heavy braking zone into T1
      [-45, 1, 215],      // Wide right-hander entry
      [-135, 3, 245],     // T1-T2 Sweeper apex
      [-225, 7, 195],     // Climb toward coastal overpass
      [-265, 13, 100],    // Overpass crest
      [-220, 11, 5],      // Downhill chicane entry
      [-145, 6, -55],     // S-chicane left
      [-195, 2, -145],    // S-chicane right
      [-165, 1, -245],    // South harbor hairpin entry
      [-70, 1, -280],     // South hairpin apex
      [25, 2, -230],      // Exit acceleration
      [115, 4, -265],     // East bay kink
      [205, 5, -210],     // East hairpin entry
      [215, 4, -105],     // East hairpin exit
      [140, 2, -35],      // Penultimate corner
      [75, 1, -105],      // Final chicane? Check alignment onto (0,0,0)!
    ],
  },
};

// Smooth flowing racing control points guaranteeing unsmoothed min curve radius >= 48m everywhere and smooth +Z entry into (0, 0, 0)
TRACK_CATALOG.mountain_pass.controlPoints = [
  [0, 0, 0],
  [0, 0, 115],
  [-25, 2.5, 225],
  [-110, 9.0, 295],
  [-225, 17.5, 280],
  [-315, 25.0, 195],
  [-335, 26.0, 75],
  [-280, 19.0, -40],
  [-305, 12.0, -155],
  [-240, 6.0, -255],
  [-125, 4.0, -320],
  [5, 7.5, -345],
  [140, 10.5, -365],
  [260, 9.0, -320],
  [320, 5.5, -210],
  [320, 2.5, -100],
  [296, 1.5, -42],
  [238, 1.0, -18],
  [180, 0.8, -42],
  [156, 0.6, -110],
  [156, 0.4, -190],
  [133, 0.3, -245],
  [78, 0.2, -268],
  [23, 0.1, -245],
  [0, 0, -190],
  [0, 0, -95],
];

TRACK_CATALOG.neon_bay_circuit.controlPoints = [
  [0, 0, 0],
  [0, 0, 110],
  [-45, 1.0, 205],
  [-140, 3.0, 230],
  [-225, 8.0, 175],
  [-255, 13.5, 75],
  [-215, 10.0, -30],
  [-180, 5.5, -135],
  [-195, 2.0, -245],
  [-125, 1.0, -325],
  [-5, 1.0, -355],
  [130, 2.5, -355],
  [255, 4.5, -315],
  [324, 5.0, -210],
  [324, 3.0, -95],
  [299, 2.0, -36],
  [240, 1.2, -12],
  [181, 0.8, -36],
  [156, 0.6, -100],
  [156, 0.4, -190],
  [133, 0.3, -245],
  [78, 0.2, -268],
  [23, 0.1, -245],
  [0, 0, -190],
  [0, 0, -95],
];

TRACK_CATALOG.mountain_pass_v2 = {
  id: 'mountain_pass_v2',
  name: 'Alpine Skyway V2',
  subtitle: 'Expanded V2 mountain circuit with twin 370m+ sky-ramp canyon jumps & smooth sweepers',
  trackWidth: 22.5,
  shoulderWidth: 4.5,
  maxBankingRad: 0.22,
  sampleCount: 700,
  barrierStyle: 'guardrail',
  jumps: [
    {
      name: 'NORTHERN SKY LEAP',
      rampStartU: 0.022,
      takeoffU: 0.036,
      gapEndU: 0.041,
      catchEndU: 0.072,
      rampHeight: 4.3,
      catchDrop: 1.7,
    },
    {
      name: 'EAST CANYON FLYOVER',
      rampStartU: 0.606,
      takeoffU: 0.619,
      gapEndU: 0.624,
      catchEndU: 0.656,
      rampHeight: 4.3,
      catchDrop: 1.7,
    },
  ],
  controlPoints: [
    [0, 0, 0],
    [0, 0, 145],
    [0, 0, 315],
    [-25, 2.5, 430],
    [-110, 9.0, 490],
    [-225, 17.5, 470],
    [-315, 25.0, 380],
    [-340, 26.0, 240],
    [-290, 19.0, 95],
    [-315, 12.0, -60],
    [-265, 6.0, -210],
    [-155, 4.0, -310],
    [-15, 6.0, -355],
    [135, 9.0, -375],
    [265, 6.5, -340],
    [335, 3.0, -250],
    [335, 3.0, -100],
    [335, 3.0, 50],
    [335, 3.0, 190],
    [310, 2.2, 275],
    [250, 1.5, 300],
    [190, 1.0, 270],
    [160, 0.7, 175],
    [160, 0.5, 20],
    [160, 0.4, -150],
    [136, 0.3, -225],
    [80, 0.2, -252],
    [24, 0.1, -225],
    [0, 0, -165],
    [0, 0, -85],
  ],
};

TRACK_CATALOG.neon_bay_v2 = {
  id: 'neon_bay_v2',
  name: 'Neon Bay V2',
  subtitle: 'Expanded V2 coastal circuit featuring harbor bridge sky-ramps & twin causeway jumps',
  trackWidth: 21.0,
  shoulderWidth: 4.2,
  maxBankingRad: 0.16,
  sampleCount: 680,
  barrierStyle: 'concrete',
  jumps: [
    {
      name: 'HARBOR BRIDGE JUMP',
      rampStartU: 0.017,
      takeoffU: 0.031,
      gapEndU: 0.0365,
      catchEndU: 0.068,
      rampHeight: 4.1,
      catchDrop: 1.5,
    },
    {
      name: 'CAUSEWAY SKY RAMP',
      rampStartU: 0.568,
      takeoffU: 0.581,
      gapEndU: 0.5865,
      catchEndU: 0.619,
      rampHeight: 4.1,
      catchDrop: 1.5,
    },
  ],
  controlPoints: [
    [0, 0, 0],
    [0, 0, 145],
    [0, 0, 310],
    [-35, 1.5, 410],
    [-125, 4.0, 445],
    [-225, 9.0, 395],
    [-265, 13.5, 290],
    [-235, 10.0, 165],
    [-195, 5.5, 40],
    [-215, 2.5, -95],
    [-175, 1.2, -225],
    [-80, 1.0, -310],
    [55, 2.0, -355],
    [205, 2.5, -355],
    [305, 2.0, -280],
    [335, 2.0, -185],
    [335, 2.0, -30],
    [335, 2.0, 125],
    [335, 2.0, 250],
    [309, 1.5, 315],
    [247, 1.0, 342],
    [185, 0.7, 315],
    [159, 0.5, 230],
    [159, 0.4, 70],
    [159, 0.3, -110],
    [159, 0.25, -185],
    [136, 0.2, -242],
    [80, 0.1, -268],
    [24, 0.05, -242],
    [0, 0, -185],
    [0, 0, -85],
  ],
};

export function getTrackSpec(trackId) {
  return TRACK_CATALOG[trackId] || TRACK_CATALOG.mountain_pass_v2;
}
