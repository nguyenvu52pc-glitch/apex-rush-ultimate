/**
 * Manages graphics quality presets (Medium / High / Ultra) with distinct visual fidelity
 * across resolution scale, shadow resolution & foliage shadows, Bloom/FXAA, clearcoat IBL,
 * grass density, and draw distance, plus an FPS Watchdog (<35 FPS for >4s on Ultra).
 */

export const QUALITY_PRESETS = Object.freeze({
  medium: {
    id: 'medium',
    label: 'Medium',
    renderScale: 0.72,
    maxPixelRatio: 1.15,
    useComposer: false, // Direct fast pass, no Bloom/FXAA/DrivingFX
    bloomEnabled: false,
    fxaaEnabled: false,
    bloomConfig: { strength: 0.0, radius: 0.0, threshold: 1.0 },
    shadowMapSize: 512,
    foliageShadows: false,
    grassDensityScale: 0.30,
    particleScale: 0.50,
    envIntensity: 0.85,
    exposure: 0.98,
    farClip: 1250,
  },
  high: {
    id: 'high',
    label: 'High',
    renderScale: 1.0,
    maxPixelRatio: 1.5,
    useComposer: true,
    bloomEnabled: true,
    fxaaEnabled: true,
    bloomConfig: { strength: 0.34, radius: 0.32, threshold: 0.92 },
    shadowMapSize: 2048,
    foliageShadows: true,
    grassDensityScale: 0.90,
    particleScale: 0.85,
    envIntensity: 1.15,
    exposure: 1.06,
    farClip: 1650,
  },
  ultra: {
    id: 'ultra',
    label: 'Ultra',
    renderScale: 1.35, // Crisp supersampling even on 1.0 DPR screens
    maxPixelRatio: 2.2,
    useComposer: true,
    bloomEnabled: true,
    fxaaEnabled: true,
    bloomConfig: { strength: 0.52, radius: 0.44, threshold: 0.86 },
    shadowMapSize: 4096,
    foliageShadows: true,
    grassDensityScale: 1.45,
    particleScale: 1.0,
    envIntensity: 1.42,
    exposure: 1.12,
    farClip: 2100,
  },
});

export class QualityManager {
  /**
   * @param {object} deps
   * @param {import('./RendererContext.js').RendererContext} deps.rendererCtx
   * @param {import('../graphics/PostProcessingRig.js').PostProcessingRig} deps.postProcessing
   * @param {import('../world/LightingRig.js').LightingRig} deps.lightingRig
   * @param {import('../vfx/ParticleEffects.js').ParticleEffects} deps.particleVfx
   */
  constructor({ rendererCtx, postProcessing, lightingRig, particleVfx }) {
    this.rendererCtx = rendererCtx;
    this.postProcessing = postProcessing;
    this.lightingRig = lightingRig;
    this.particleVfx = particleVfx;

    this.currentId = 'high';
    this.preset = QUALITY_PRESETS.high;

    this.lowFpsDuration = 0;
    this.sampleElapsed = 0;
    this.sampleFrames = 0;
    this.watchdogPrompted = false;
    this.onWatchdogTrigger = null;
  }

  /**
   * Apply a quality preset. Returns { rebuildSceneryNeeded: boolean }.
   * @param {'medium' | 'high' | 'ultra'} presetId
   */
  applyPreset(presetId) {
    const next = QUALITY_PRESETS[presetId] || QUALITY_PRESETS.high;
    const prevGrass = this.preset.grassDensityScale;
    const prevShadows = this.preset.foliageShadows;
    this.currentId = next.id;
    this.preset = next;

    const { renderer, scene, camera } = this.rendererCtx;
    const maxTex = renderer.capabilities?.maxTextureSize || 2048;
    const shadowSize = Math.min(next.shadowMapSize, maxTex >= 4096 ? 4096 : 2048);

    this.rendererCtx.setRenderScale(next.renderScale, next.maxPixelRatio);
    renderer.toneMappingExposure = next.exposure;
    scene.environmentIntensity = next.envIntensity;

    camera.far = next.farClip;
    camera.updateProjectionMatrix();

    this.postProcessing.setEnabled(next.useComposer);
    this.postProcessing.setEffectsEnabled(next.bloomEnabled, next.fxaaEnabled, next.bloomConfig);
    this.lightingRig.setShadowMapSize(shadowSize);
    this.particleVfx.setQualityScale(next.particleScale);

    this.lowFpsDuration = 0;
    this.sampleElapsed = 0;
    this.sampleFrames = 0;
    if (next.id === 'ultra') {
      this.watchdogPrompted = false;
    }

    return {
      rebuildSceneryNeeded:
        Math.abs(prevGrass - next.grassDensityScale) > 0.01 || prevShadows !== next.foliageShadows,
    };
  }

  updateWatchdog(dt, isActiveRace) {
    if (!isActiveRace || this.currentId !== 'ultra' || this.watchdogPrompted) {
      this.lowFpsDuration = 0;
      this.sampleElapsed = 0;
      this.sampleFrames = 0;
      return;
    }

    this.sampleElapsed += dt;
    this.sampleFrames += 1;

    if (this.sampleElapsed >= 0.5) {
      const avgFps = this.sampleFrames / this.sampleElapsed;
      if (avgFps < 35) {
        this.lowFpsDuration += this.sampleElapsed;
        if (this.lowFpsDuration >= 4.0) {
          this.watchdogPrompted = true;
          if (this.onWatchdogTrigger) {
            this.onWatchdogTrigger(avgFps);
          }
        }
      } else {
        this.lowFpsDuration = Math.max(0, this.lowFpsDuration - this.sampleElapsed * 0.5);
      }
      this.sampleElapsed = 0;
      this.sampleFrames = 0;
    }
  }
}
