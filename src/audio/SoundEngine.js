/**
 * 100% Procedural Web Audio API Sound Engine (zero external audio files).
 * Enforces Browser Autoplay Policy: lazily unlocks AudioContext inside first user gesture,
 * uses smooth gain ramps (setTargetAtTime) to eliminate speaker pops, and disposes cleanly.
 */
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.unlocked = false;
    this.muted = false;
    this.paused = false;
    this.volume = 0.75;
    this.disposed = false;

    this.nodes = null;
    this.prevGear = 1;
    this.prevThrottle = 0;
    this.lastImpactAt = 0;
    this.lastBlowoffAt = 0;
    this._noiseBuffer = null;
  }

  /**
   * Lazily initialize & resume AudioContext inside a user gesture (pointerdown/keydown).
   */
  unlock() {
    if (this.disposed) return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this._buildGraph();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    this.unlocked = true;
    this._syncMasterGain();
  }

  _createNoiseBuffer(ctx) {
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  _makeDistortionCurve(amount = 18) {
    const samples = 256;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  _buildGraph() {
    const ctx = this.ctx;
    this._noiseBuffer = this._createNoiseBuffer(ctx);

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(ctx.destination);

    // 1. Multi-Oscillator Player Engine Synth (Sawtooth + Triangle + Sub-Bass)
    const sawOsc = ctx.createOscillator();
    sawOsc.type = 'sawtooth';
    sawOsc.frequency.value = 60;

    const triOsc = ctx.createOscillator();
    triOsc.type = 'triangle';
    triOsc.frequency.value = 120;

    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.value = 30;

    const sawGain = ctx.createGain();
    sawGain.gain.value = 0.34;
    const triGain = ctx.createGain();
    triGain.gain.value = 0.25;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.38;

    const engineShaper = ctx.createWaveShaper();
    engineShaper.curve = this._makeDistortionCurve(14);
    engineShaper.oversample = '2x';

    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 280;
    engineFilter.Q.value = 2.4;

    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;

    sawOsc.connect(sawGain).connect(engineShaper);
    triOsc.connect(triGain).connect(engineShaper);
    subOsc.connect(subGain).connect(engineShaper);
    engineShaper.connect(engineFilter).connect(engineGain).connect(masterGain);

    sawOsc.start();
    triOsc.start();
    subOsc.start();

    // 2. Tire Screech Synth (Bandpass white noise)
    const screechSrc = ctx.createBufferSource();
    screechSrc.buffer = this._noiseBuffer;
    screechSrc.loop = true;

    const screechFilter = ctx.createBiquadFilter();
    screechFilter.type = 'bandpass';
    screechFilter.frequency.value = 1120;
    screechFilter.Q.value = 4.6;

    const screechGain = ctx.createGain();
    screechGain.gain.value = 0;

    screechSrc.connect(screechFilter).connect(screechGain).connect(masterGain);
    screechSrc.start();

    // 3. High-Speed Wind Rush (Lowpass white noise)
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this._noiseBuffer;
    windSrc.loop = true;

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 420;

    const windGain = ctx.createGain();
    windGain.gain.value = 0;

    windSrc.connect(windFilter).connect(windGain).connect(masterGain);
    windSrc.start();

    // 4. Nitro Pressurized Roar + Turbine Boost Whine
    const nitroSrc = ctx.createBufferSource();
    nitroSrc.buffer = this._noiseBuffer;
    nitroSrc.loop = true;

    const nitroFilter = ctx.createBiquadFilter();
    nitroFilter.type = 'bandpass';
    nitroFilter.frequency.value = 460;
    nitroFilter.Q.value = 1.4;

    const nitroGain = ctx.createGain();
    nitroGain.gain.value = 0;

    const nitroWhineOsc = ctx.createOscillator();
    nitroWhineOsc.type = 'sine';
    nitroWhineOsc.frequency.value = 680;
    const nitroWhineGain = ctx.createGain();
    nitroWhineGain.gain.value = 0;

    nitroSrc.connect(nitroFilter).connect(nitroGain).connect(masterGain);
    nitroWhineOsc.connect(nitroWhineGain).connect(masterGain);
    nitroSrc.start();
    nitroWhineOsc.start();

    // 5. Spatialized AI Engine Channels (nearest 2 AI rivals via StereoPannerNode)
    const aiChannels = [];
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 85;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 380;

      const panner = ctx.createStereoPanner();
      panner.pan.value = 0;

      const gain = ctx.createGain();
      gain.gain.value = 0;

      osc.connect(filter).connect(panner).connect(gain).connect(masterGain);
      osc.start();
      aiChannels.push({ osc, filter, panner, gain });
    }

    this.nodes = {
      masterGain,
      sawOsc,
      triOsc,
      subOsc,
      engineFilter,
      engineGain,
      screechSrc,
      screechFilter,
      screechGain,
      windSrc,
      windFilter,
      windGain,
      nitroSrc,
      nitroFilter,
      nitroGain,
      nitroWhineOsc,
      nitroWhineGain,
      aiChannels,
    };
  }

  _syncMasterGain() {
    if (!this.ctx || !this.nodes) return;
    const active = !this.muted && !this.paused && this.unlocked;
    const target = active ? this.volume * 0.55 : 0;
    this.nodes.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.04);
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    this._syncMasterGain();
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this._syncMasterGain();
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    this._syncMasterGain();
  }

  /**
   * Update continuous engine, drift screech, wind, nitro & spatial AI audio (zero allocations).
   */
  update({
    active = false,
    rpmNormalized = 0.2,
    throttle = 0,
    gear = 1,
    speedMps = 0,
    isDrifting = false,
    nitroActive = false,
    aiSpatial = null, // array of up to 2 { pan, gain, rpmNormalized }
  } = {}) {
    if (!this.ctx || !this.nodes || !this.unlocked) return;

    const now = this.ctx.currentTime;
    const n = this.nodes;

    if (!active) {
      n.engineGain.gain.setTargetAtTime(0, now, 0.06);
      n.screechGain.gain.setTargetAtTime(0, now, 0.05);
      n.windGain.gain.setTargetAtTime(0, now, 0.06);
      n.nitroGain.gain.setTargetAtTime(0, now, 0.05);
      n.nitroWhineGain.gain.setTargetAtTime(0, now, 0.05);
      for (let i = 0; i < n.aiChannels.length; i++) {
        n.aiChannels[i].gain.gain.setTargetAtTime(0, now, 0.06);
      }
      return;
    }

    // Detect upshift dip & high-RPM lift-off turbo blow-off flutter
    if (gear > this.prevGear && gear > 1) {
      n.engineGain.gain.setTargetAtTime(0.08, now, 0.015);
      this._playBlowOff(0.55);
    }
    if (this.prevThrottle > 0.55 && throttle < 0.1 && rpmNormalized > 0.62 && now - this.lastBlowoffAt > 0.45) {
      this._playBlowOff(0.8);
      this.lastBlowoffAt = now;
    }
    this.prevGear = gear;
    this.prevThrottle = throttle;

    const baseFreq = 52 + rpmNormalized * 145 + (nitroActive ? 18 : 0);
    n.sawOsc.frequency.setTargetAtTime(baseFreq, now, 0.03);
    n.triOsc.frequency.setTargetAtTime(baseFreq * 1.99, now, 0.03);
    n.subOsc.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.03);

    const cutoff = 220 + rpmNormalized * 1250 + throttle * 480 + (nitroActive ? 350 : 0);
    n.engineFilter.frequency.setTargetAtTime(cutoff, now, 0.03);
    n.engineGain.gain.setTargetAtTime(0.24 + throttle * 0.14, now, 0.04);

    // Tire drift screech
    const screechTarget = isDrifting && speedMps > 6 ? Math.min(0.22, (speedMps / 45) * 0.22) : 0;
    n.screechFilter.frequency.setTargetAtTime(980 + Math.min(420, speedMps * 8), now, 0.05);
    n.screechGain.gain.setTargetAtTime(screechTarget, now, 0.04);

    // High-speed wind rush above 100 km/h (27.8 m/s)
    const windTarget = speedMps > 27.8 ? Math.min(0.24, ((speedMps - 27.8) / 55) * 0.24) : 0;
    n.windFilter.frequency.setTargetAtTime(360 + speedMps * 12, now, 0.06);
    n.windGain.gain.setTargetAtTime(windTarget, now, 0.06);

    // Nitro roar + turbine spool pitch
    n.nitroGain.gain.setTargetAtTime(nitroActive ? 0.36 : 0, now, 0.04);
    n.nitroFilter.frequency.setTargetAtTime(nitroActive ? 540 + speedMps * 8 : 340, now, 0.05);
    n.nitroWhineOsc.frequency.setTargetAtTime(nitroActive ? 740 + rpmNormalized * 520 : 620, now, 0.05);
    n.nitroWhineGain.gain.setTargetAtTime(nitroActive ? 0.09 : 0, now, 0.05);

    // Spatialized AI cars (nearest 2)
    for (let i = 0; i < n.aiChannels.length; i++) {
      const ch = n.aiChannels[i];
      const item = aiSpatial && i < aiSpatial.length ? aiSpatial[i] : null;
      if (item && item.gain > 0.005) {
        const aiFreq = 62 + item.rpmNormalized * 135;
        ch.osc.frequency.setTargetAtTime(aiFreq, now, 0.04);
        ch.filter.frequency.setTargetAtTime(280 + item.rpmNormalized * 900, now, 0.04);
        ch.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, item.pan)), now, 0.04);
        ch.gain.gain.setTargetAtTime(item.gain * 0.18, now, 0.05);
      } else {
        ch.gain.gain.setTargetAtTime(0, now, 0.06);
      }
    }
  }

  _playBlowOff(intensity = 0.7) {
    if (!this.ctx || !this.nodes || !this.unlocked || this.muted || this.paused) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2400, now);
    filter.frequency.exponentialRampToValueAtTime(950, now + 0.16);
    filter.Q.value = 5.5;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.11 * intensity, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.18);

    src.connect(filter).connect(g).connect(this.nodes.masterGain);
    src.start(now);
    src.stop(now + 0.19);
  }

  /**
   * Synthesized metallic crunch/thud scaled by impact intensity.
   */
  playImpact(intensity = 5) {
    if (!this.ctx || !this.nodes || !this.unlocked || this.muted || this.paused) return;
    const now = this.ctx.currentTime;
    if (now - this.lastImpactAt < 0.09) return;
    this.lastImpactAt = now;

    const norm = Math.min(1, Math.max(0.15, intensity / 22));

    // Low chassis thud
    const thudOsc = this.ctx.createOscillator();
    thudOsc.type = 'triangle';
    thudOsc.frequency.setValueAtTime(135 + norm * 45, now);
    thudOsc.frequency.exponentialRampToValueAtTime(34, now + 0.16);

    const thudGain = this.ctx.createGain();
    thudGain.gain.setValueAtTime(0.45 * norm, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    thudOsc.connect(thudGain).connect(this.nodes.masterGain);
    thudOsc.start(now);
    thudOsc.stop(now + 0.19);

    // Metallic crunch burst
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1100 + norm * 900, now);
    bp.Q.value = 1.8;

    const crunchGain = this.ctx.createGain();
    crunchGain.gain.setValueAtTime(0.32 * norm, now);
    crunchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    src.connect(bp).connect(crunchGain).connect(this.nodes.masterGain);
    src.start(now);
    src.stop(now + 0.15);
  }

  /**
   * Crisp 3-2-1-GO countdown tone synced to gantry lights.
   */
  playCountdownBeep(isGo = false) {
    if (!this.ctx || !this.nodes || !this.unlocked || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = isGo ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(isGo ? 880 : 440, now);

    const g = this.ctx.createGain();
    const dur = isGo ? 0.42 : 0.16;
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(isGo ? 0.34 : 0.24, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(g).connect(this.nodes.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.nodes) {
      const n = this.nodes;
      for (const osc of [n.sawOsc, n.triOsc, n.subOsc, n.screechSrc, n.windSrc, n.nitroSrc, n.nitroWhineOsc]) {
        try {
          osc.stop();
          osc.disconnect();
        } catch {}
      }
      for (const ch of n.aiChannels) {
        try {
          ch.osc.stop();
          ch.osc.disconnect();
        } catch {}
      }
      this.nodes = null;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
