/**
 * Atmospheric visual themes controlling sky gradients, sun/moon lighting, fog,
 * terrain palette, flora distribution, roadside architecture, and IBL reflections.
 */

export const THEME_IDS = ['alpine_sunset', 'canyon_daylight', 'neon_metropolis'];

export const THEME_CATALOG = {
  alpine_sunset: {
    id: 'alpine_sunset',
    name: 'Alpine Sunset',
    isNight: false,
    sky: {
      zenithColor: 0x1e2b58,
      horizonColor: 0xf4845f,
      sunColor: 0xffd180,
      sunGlowColor: 0xff7043,
      cloudColor: 0xffb38a,
      cloudOpacity: 0.55,
      starIntensity: 0.15,
    },
    fog: {
      color: 0xc97b63,
      density: 0.0014,
    },
    lighting: {
      sunDirection: [0.55, 0.28, -0.78], // Low golden sunset angle for dramatic long leaf shadows
      sunColor: 0xffb870,
      sunIntensity: 2.75,
      hemiSkyColor: 0x93a8dc,
      hemiGroundColor: 0x3b2f28,
      hemiIntensity: 0.72,
    },
    envOptions: {
      zenithColor: 0x1e2b58,
      horizonColor: 0xf4845f,
      groundColor: 0x2a2320,
      sunColor: 0xffd180,
      studioStrips: true,
      intensity: 1.05,
    },
    terrain: {
      lowColor: 0x3a5a2c,
      midColor: 0x5c6e34,
      rockColor: 0x5b5856,
      hillScale: 24,
      mountainHeight: 115,
      waterLevel: null,
    },
    flora: {
      mode: 'alpine', // pine + broadleaf maples (green/amber) + wildflowers
      treeCount: 380,
      grassCount: 1800,
      rockCount: 160,
      windStrength: 0.22,
    },
    architecture: {
      streetlights: false,
      urbanBuildings: false,
      grandstands: true,
      billboards: true,
    },
  },

  canyon_daylight: {
    id: 'canyon_daylight',
    name: 'Canyon Daylight',
    isNight: false,
    sky: {
      zenithColor: 0x0e4da4,
      horizonColor: 0x9bd7ff,
      sunColor: 0xfff8e1,
      sunGlowColor: 0xffe082,
      cloudColor: 0xffffff,
      cloudOpacity: 0.68,
      starIntensity: 0.0,
    },
    fog: {
      color: 0xc4d9ec,
      density: 0.0010,
    },
    lighting: {
      sunDirection: [0.45, 0.78, 0.42],
      sunColor: 0xfff5df,
      sunIntensity: 2.9,
      hemiSkyColor: 0xaad8ff,
      hemiGroundColor: 0x8b4a2b,
      hemiIntensity: 0.85,
    },
    envOptions: {
      zenithColor: 0x0e4da4,
      horizonColor: 0x9bd7ff,
      groundColor: 0x7c3e24,
      sunColor: 0xfff8e1,
      studioStrips: true,
      intensity: 1.1,
    },
    terrain: {
      lowColor: 0xc26c42,
      midColor: 0xa64928,
      rockColor: 0x783520,
      hillScale: 30,
      mountainHeight: 105,
      waterLevel: -6.5, // Oasis basin
      waterColor: 0x0ea5e9,
    },
    flora: {
      mode: 'desert', // palms + saguaro cacti + desert scrub
      treeCount: 280,
      grassCount: 1100,
      rockCount: 220,
      windStrength: 0.26,
    },
    architecture: {
      streetlights: false,
      urbanBuildings: false,
      grandstands: true,
      billboards: true,
    },
  },

  neon_metropolis: {
    id: 'neon_metropolis',
    name: 'Neon Metropolis',
    isNight: true,
    sky: {
      zenithColor: 0x040714,
      horizonColor: 0x162244,
      sunColor: 0xcbd5e1, // Moonlight
      sunGlowColor: 0x38bdf8,
      cloudColor: 0x1e293b,
      cloudOpacity: 0.3,
      starIntensity: 1.0,
    },
    fog: {
      color: 0x0a1126,
      density: 0.0018,
    },
    lighting: {
      sunDirection: [-0.38, 0.65, 0.65], // Crisp moonlight for night leaf shadows
      sunColor: 0x93c5fd,
      sunIntensity: 1.35,
      hemiSkyColor: 0x334155,
      hemiGroundColor: 0x0f172a,
      hemiIntensity: 0.62,
    },
    envOptions: {
      zenithColor: 0x05091a,
      horizonColor: 0x253b6e,
      groundColor: 0x090c14,
      sunColor: 0x38bdf8,
      studioStrips: true,
      intensity: 0.9,
    },
    terrain: {
      lowColor: 0x16212c,
      midColor: 0x1e293b,
      rockColor: 0x0f172a,
      hillScale: 10,
      mountainHeight: 45,
      waterLevel: -4.2, // Midnight harbor reflection water
      waterColor: 0x09152b,
    },
    flora: {
      mode: 'urban', // boulevard broadleaf trees + manicured grass
      treeCount: 240,
      grassCount: 1000,
      rockCount: 70,
      windStrength: 0.16,
    },
    architecture: {
      streetlights: true,
      urbanBuildings: true,
      grandstands: true,
      billboards: true,
    },
  },
};

export function getThemeSpec(themeId) {
  return THEME_CATALOG[themeId] || THEME_CATALOG.alpine_sunset;
}
