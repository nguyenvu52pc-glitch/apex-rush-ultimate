import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * Custom Crisp Driving & Sonic-Barrier Atmosphere Shader (post-OutputPass sRGB):
 * - Radial Mach matter-stretching & expanding sonic boom wave when firing Nitro (center car stays 100% razor-sharp)
 * - Strictly peripheral chromatic dispersion (>0.36 radius) for zero ghosting/smear
 * - Explicit NaN/Inf pixel sanitization guard so corrupted half-float pixels can never flicker black
 */
const DrivingFXShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSpeedFactor: { value: 0.0 },
    uNitroFactor: { value: 0.0 },
    uMachPulse: { value: 0.0 },
    uTime: { value: 0.0 },
    uNitroColor: { value: new THREE.Color(0x00e5ff) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uSpeedFactor;
    uniform float uNitroFactor;
    uniform float uMachPulse;
    uniform float uTime;
    uniform vec3 uNitroColor;
    varying vec2 vUv;

    float safeChan(float c) {
      return (c >= 0.0 && c <= 64.0) ? c : 0.0;
    }

    vec3 sanitizeRgb(vec3 c) {
      return vec3(safeChan(c.r), safeChan(c.g), safeChan(c.b));
    }

    void main() {
      vec2 centered = vUv - vec2(0.5);
      float dist = length(centered);
      vec2 dir = dist > 0.0001 ? centered / dist : vec2(0.0);
      float edgeMask = smoothstep(0.24, 0.78, dist);
      float outerChroma = smoothstep(0.36, 0.78, dist);

      // 1. Acoustic Matter-Stretching radial warp (center hero car remains 100% undistorted)
      float nitroStretch = uNitroFactor * edgeMask * (0.045 + 0.015 * sin(dist * 26.0 - uTime * 22.0));
      float waveRadius = (1.0 - clamp(uMachPulse, 0.0, 1.0)) * 0.72;
      float dWave = (dist - waveRadius) * 14.0;
      float waveBand = exp(-(dWave * dWave)) * uMachPulse;
      float waveWarp = waveBand * 0.026 * sin((dist - waveRadius) * 42.0);

      vec2 baseUv = clamp(vec2(0.5) + centered * (1.0 - nitroStretch) - dir * waveWarp, vec2(0.001), vec2(0.999));

      // 2. Clean single-direction perimeter dispersion ONLY during Nitro / Sonic wave (0px center ghosting!)
      float dispAmt = outerChroma * (uNitroFactor * 0.0085 + waveBand * 0.006);
      vec2 uvR = clamp(baseUv + dir * dispAmt, vec2(0.001), vec2(0.999));
      vec2 uvB = clamp(baseUv - dir * dispAmt, vec2(0.001), vec2(0.999));

      float g = sanitizeRgb(texture2D(tDiffuse, baseUv).rgb).g;
      float r = dispAmt > 0.0002 ? sanitizeRgb(texture2D(tDiffuse, uvR).rgb).r : g;
      float b = dispAmt > 0.0002 ? sanitizeRgb(texture2D(tDiffuse, uvB).rgb).b : g;
      vec3 col = dispAmt > 0.0002 ? vec3(r, g, b) : sanitizeRgb(texture2D(tDiffuse, baseUv).rgb);

      // 3. Sonic wave rim highlight + dynamic Nitro signature edge glow + crisp contrast vignette
      float vig = 1.0 - edgeMask * (0.09 + 0.07 * uSpeedFactor + 0.06 * uNitroFactor);
      col *= vig;
      col += uNitroColor * (uNitroFactor * outerChroma * 0.14 + waveBand * 0.16);

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

/**
 * Clean Single-Pass Linear-HDR -> Bloom -> SMAA -> Output(AgX+sRGB) -> Vignette pipeline:
 * Uses samples=0 HalfFloat ping-pong RenderTargets inside EffectComposer so UnrealBloomPass
 * additive blending NEVER hits WebGL2 MSAA resolve buffer black-tile/ghosting corruption!
 */
export class PostProcessingRig {
  /**
   * @param {import('../core/RendererContext.js').RendererContext} rendererCtx
   */
  constructor(rendererCtx) {
    this.rendererCtx = rendererCtx;
    this.enabled = true;
    this.bloomEnabled = true;

    const { renderer, scene, camera } = rendererCtx;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const pixelRatio = renderer.getPixelRatio();

    // samples = 0 eliminates WebGL2 ANGLE MSAA HalfFloat resolve corruption in UnrealBloomPass;
    // anti-aliasing is handled cleanly by linear-HDR SMAAPass before OutputPass!
    this.composerTarget = new THREE.WebGLRenderTarget(
      Math.max(1, Math.floor(width * pixelRatio)),
      Math.max(1, Math.floor(height * pixelRatio)),
      {
        type: THREE.HalfFloatType,
        samples: 0,
      }
    );

    this.composer = new EffectComposer(renderer, this.composerTarget);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);

    this.renderPass = new RenderPass(scene, camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width * pixelRatio, height * pixelRatio), 0.36, 0.34, 0.92);
    this.smaaPass = new SMAAPass();
    this.outputPass = new OutputPass();
    this.drivingFxPass = new ShaderPass(DrivingFXShader);

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.smaaPass);
    this.composer.addPass(this.outputPass);
    this.composer.addPass(this.drivingFxPass);

    this._speedSmoothed = 0;
    this._nitroSmoothed = 0;
    this._unsubscribeResize = rendererCtx.onResize((w, h, pr) => this.setSize(w, h, pr));
  }

  /**
   * Toggle post-processing pipeline or individual Bloom/SMAA passes.
   */
  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  setEffectsEnabled(bloomAndSpeedFx, aaEnabled = true, bloomConfig = null) {
    this.bloomEnabled = Boolean(bloomAndSpeedFx);
    this.bloomPass.enabled = this.bloomEnabled;
    this.drivingFxPass.enabled = true;
    this.smaaPass.enabled = Boolean(aaEnabled);
    if (bloomConfig) {
      this.bloomPass.strength = bloomConfig.strength;
      this.bloomPass.radius = bloomConfig.radius;
      this.bloomPass.threshold = bloomConfig.threshold;
    }
  }

  setDrivingState(speedMps = 0, nitroActive = false, dt = 0.016, machPulse = 0, elapsedTime = 0, nitroColorHex = null) {
    const targetSpeed = THREE.MathUtils.clamp((speedMps - 28) / 56, 0, 1);
    const targetNitro = nitroActive ? 1.0 : 0.0;
    const rate = 1 - Math.exp(-8 * dt);
    this._speedSmoothed = THREE.MathUtils.lerp(this._speedSmoothed, targetSpeed, rate);
    this._nitroSmoothed = THREE.MathUtils.lerp(this._nitroSmoothed, targetNitro, rate);

    const u = this.drivingFxPass.uniforms;
    u.uSpeedFactor.value = this._speedSmoothed;
    u.uNitroFactor.value = this._nitroSmoothed;
    u.uMachPulse.value = THREE.MathUtils.clamp(machPulse, 0, 1);
    u.uTime.value = elapsedTime;
    if (nitroColorHex !== null) {
      u.uNitroColor.value.setHex(nitroColorHex);
    }
  }

  setSize(width, height, pixelRatio = this.rendererCtx.renderer.getPixelRatio()) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render() {
    if (this.enabled) {
      this.composer.render();
    } else {
      this.rendererCtx.render();
    }
  }

  dispose() {
    this._unsubscribeResize();
    this.bloomPass.dispose();
    this.smaaPass.dispose();
    this.outputPass.dispose();
    this.drivingFxPass.dispose();
    this.composerTarget.dispose();
    this.composer.dispose();
  }
}
