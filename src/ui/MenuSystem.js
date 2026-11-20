import { CAR_IDS, CAR_CATALOG, PAINT_SWATCHES } from '../car/CarCatalog.js';
import { TRACK_IDS, TRACK_CATALOG } from '../track/TrackCatalog.js';
import { THEME_IDS, THEME_CATALOG } from '../world/ThemeCatalog.js';

/**
 * Interactive 3D Garage Menu, Pause Menu (Esc), and Multi-Touch Mobile Controls.
 * Uses pointer-events: none on root layers so OrbitControls mouse dragging works smoothly
 * over the open 3D car showcase.
 */
export class MenuSystem {
  /**
   * @param {object} params
   * @param {HTMLElement} params.menuRoot
   * @param {HTMLElement} params.mobileRoot
   * @param {object} params.config
   * @param {import('../core/InputManager.js').InputManager} params.inputManager
   */
  constructor({ menuRoot, mobileRoot, config, inputManager }) {
    this.menuRoot = menuRoot;
    this.mobileRoot = mobileRoot;
    this.config = config;
    this.inputManager = inputManager;

    this.garageVisible = true;
    this.pauseVisible = false;
    this.isCoarsePointer =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

    // Callbacks bound by main.js
    this.onConfigChange = null; // (key, value) => void
    this.onStartRace = null;
    this.onResume = null;
    this.onRestartRace = null;
    this.onExitToGarage = null;

    this._buildGarageMenu();
    this._buildPauseMenu();
    this._buildMobileControls();
    this.syncMobileVisibility();
  }

  _buildGarageMenu() {
    this.garageEl = document.createElement('div');
    this.garageEl.className = 'garage-overlay';
    this.garageEl.innerHTML = `
      <div class="garage-header">
        <div>
          <h1>APEX RUSH: <span class="accent">ULTIMATE</span></h1>
          <p class="garage-sub">Drag anywhere on screen to orbit 360° • Procedural 3D Garage</p>
        </div>
        <button type="button" class="btn-start-race" data-act="start">START RACE</button>
      </div>

      <div class="garage-panels">
        <div class="garage-card garage-left">
          <div class="section-title">SELECT VEHICLE</div>
          <div class="car-list" data-f="carList"></div>

          <div class="section-title" style="margin-top: 12px;">PAINT FINISH</div>
          <div class="swatch-row" data-f="swatchRow"></div>

          <div class="stats-grid" data-f="statsGrid"></div>
        </div>

        <div class="garage-card garage-right">
          <div class="section-title">CIRCUIT</div>
          <div class="pill-group" data-f="trackGroup"></div>

          <div class="section-title">WORLD THEME</div>
          <div class="pill-group" data-f="themeGroup"></div>

          <div class="section-title">WEATHER &amp; AI DIFFICULTY</div>
          <div class="split-row">
            <div class="pill-group" data-f="weatherGroup"></div>
            <div class="pill-group" data-f="diffGroup"></div>
          </div>

          <div class="section-title">GRAPHICS QUALITY</div>
          <div class="pill-group" data-f="qualityGroup"></div>

          <div class="controls-legend">
            <span><kbd>W A S D</kbd> Drive</span>
            <span><kbd>Space</kbd> Drift</span>
            <span><kbd>Shift</kbd> Nitro</span>
            <span><kbd>C</kbd> Camera</span>
            <span><kbd>R</kbd> Reset</span>
            <span><kbd>M</kbd> Mute</span>
          </div>
        </div>
      </div>
    `;
    this.menuRoot.appendChild(this.garageEl);

    this.gf = {
      carList: this.garageEl.querySelector('[data-f="carList"]'),
      swatchRow: this.garageEl.querySelector('[data-f="swatchRow"]'),
      statsGrid: this.garageEl.querySelector('[data-f="statsGrid"]'),
      trackGroup: this.garageEl.querySelector('[data-f="trackGroup"]'),
      themeGroup: this.garageEl.querySelector('[data-f="themeGroup"]'),
      weatherGroup: this.garageEl.querySelector('[data-f="weatherGroup"]'),
      diffGroup: this.garageEl.querySelector('[data-f="diffGroup"]'),
      qualityGroup: this.garageEl.querySelector('[data-f="qualityGroup"]'),
    };

    this.garageEl.querySelector('[data-act="start"]').addEventListener('click', () => {
      if (this.onStartRace) this.onStartRace();
    });

    this.renderGarageState();
  }

  renderGarageState() {
    // 1. Cars
    this.gf.carList.innerHTML = '';
    for (const id of CAR_IDS) {
      const c = CAR_CATALOG[id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `car-btn ${this.config.carId === id ? 'active' : ''}`;
      btn.innerHTML = `<strong>${c.name}</strong><span>${c.category}</span>`;
      btn.addEventListener('click', () => {
        this.config.carId = id;
        const matchIdx = PAINT_SWATCHES.findIndex((s) => s.hex === c.defaultPaint);
        if (matchIdx >= 0) this.config.paintIndex = matchIdx;
        this.renderGarageState();
        this.onConfigChange?.('carId', id);
      });
      this.gf.carList.appendChild(btn);
    }

    // 2. Swatches
    this.gf.swatchRow.innerHTML = '';
    PAINT_SWATCHES.forEach((sw, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = sw.name;
      btn.className = `swatch-btn ${this.config.paintIndex === idx ? 'active' : ''}`;
      btn.style.backgroundColor = `#${sw.hex.toString(16).padStart(6, '0')}`;
      btn.addEventListener('click', () => {
        this.config.paintIndex = idx;
        this.renderGarageState();
        this.onConfigChange?.('paintIndex', idx);
      });
      this.gf.swatchRow.appendChild(btn);
    });

    // 3. Vehicle Stats Bars
    const spec = CAR_CATALOG[this.config.carId] || CAR_CATALOG.street_sprint;
    const statItems = [
      ['Top Speed', spec.ratings.speed],
      ['Acceleration', spec.ratings.accel],
      ['Handling', spec.ratings.handling],
      ['Weight', spec.ratings.weight],
    ];
    this.gf.statsGrid.innerHTML = statItems
      .map(
        ([label, val]) => `
        <div class="stat-item">
          <div class="stat-head"><span>${label}</span><span>${val}</span></div>
          <div class="stat-bar"><div class="stat-fill" style="width:${val}%"></div></div>
        </div>`
      )
      .join('');

    // 4. Tracks, Themes, Weather, Difficulty, Quality pills
    this._renderPillGroup(
      this.gf.trackGroup,
      TRACK_IDS.map((id) => ({ id, label: TRACK_CATALOG[id].name })),
      this.config.trackId,
      (val) => {
        this.config.trackId = val;
        this.renderGarageState();
        this.onConfigChange?.('trackId', val);
      }
    );

    this._renderPillGroup(
      this.gf.themeGroup,
      THEME_IDS.map((id) => ({ id, label: THEME_CATALOG[id].name })),
      this.config.themeId,
      (val) => {
        this.config.themeId = val;
        this.renderGarageState();
        this.onConfigChange?.('themeId', val);
      }
    );

    this._renderPillGroup(
      this.gf.weatherGroup,
      [
        { id: 'clear', label: 'Clear' },
        { id: 'rainy', label: 'Rainy' },
      ],
      this.config.weather,
      (val) => {
        this.config.weather = val;
        this.renderGarageState();
        this.onConfigChange?.('weather', val);
      }
    );

    this._renderPillGroup(
      this.gf.diffGroup,
      [
        { id: 'easy', label: 'Easy' },
        { id: 'medium', label: 'Med' },
        { id: 'hard', label: 'Hard' },
      ],
      this.config.difficulty,
      (val) => {
        this.config.difficulty = val;
        this.renderGarageState();
        this.onConfigChange?.('difficulty', val);
      }
    );

    this._renderPillGroup(
      this.gf.qualityGroup,
      [
        { id: 'medium', label: 'Medium' },
        { id: 'high', label: 'High' },
        { id: 'ultra', label: 'Ultra' },
      ],
      this.config.quality,
      (val) => {
        this.config.quality = val;
        this.renderGarageState();
        this.onConfigChange?.('quality', val);
      }
    );
  }

  _renderPillGroup(container, items, activeId, onClick) {
    container.innerHTML = '';
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `menu-pill ${item.id === activeId ? 'active' : ''}`;
      btn.textContent = item.label;
      btn.addEventListener('click', () => onClick(item.id));
      container.appendChild(btn);
    }
  }

  _buildPauseMenu() {
    this.pauseEl = document.createElement('div');
    this.pauseEl.className = 'pause-modal hidden';
    this.pauseEl.innerHTML = `
      <div class="pause-panel">
        <h2>RACE PAUSED</h2>
        <label class="pause-row">
          <span>Master Volume</span>
          <input type="range" min="0" max="1" step="0.05" value="${this.config.audioVolume}" data-pf="volume" />
        </label>
        <div class="pause-row">
          <span>Quality Preset</span>
          <div class="pill-group" data-pf="qualityGroup"></div>
        </div>
        <div class="pause-row">
          <span>Touch Controls (Mobile/Test)</span>
          <button type="button" class="menu-pill" data-pf="touchToggle">Off</button>
        </div>
        <div class="pause-actions">
          <button type="button" class="btn-primary" data-pact="resume">Resume</button>
          <button type="button" class="btn-secondary" data-pact="restart">Restart Race</button>
          <button type="button" class="btn-secondary" data-pact="garage">Exit to Garage</button>
        </div>
      </div>
    `;
    this.menuRoot.appendChild(this.pauseEl);

    this.pf = {
      volume: this.pauseEl.querySelector('[data-pf="volume"]'),
      qualityGroup: this.pauseEl.querySelector('[data-pf="qualityGroup"]'),
      touchToggle: this.pauseEl.querySelector('[data-pf="touchToggle"]'),
    };

    this.pf.volume.addEventListener('input', () => {
      const val = parseFloat(this.pf.volume.value);
      this.config.audioVolume = val;
      this.onConfigChange?.('audioVolume', val);
    });

    this.pf.touchToggle.addEventListener('click', () => {
      this.config.mobileControlsOverride = !this.config.mobileControlsOverride;
      this.syncPauseState();
      this.syncMobileVisibility();
    });

    this.pauseEl.querySelector('[data-pact="resume"]').addEventListener('click', () => {
      this.onResume?.();
    });
    this.pauseEl.querySelector('[data-pact="restart"]').addEventListener('click', () => {
      this.onRestartRace?.();
    });
    this.pauseEl.querySelector('[data-pact="garage"]').addEventListener('click', () => {
      this.onExitToGarage?.();
    });
  }

  syncPauseState() {
    this.pf.volume.value = String(this.config.audioVolume);
    this.pf.touchToggle.textContent = this.config.mobileControlsOverride ? 'On' : 'Off';
    this.pf.touchToggle.classList.toggle('active', this.config.mobileControlsOverride);

    this._renderPillGroup(
      this.pf.qualityGroup,
      [
        { id: 'medium', label: 'Med' },
        { id: 'high', label: 'High' },
        { id: 'ultra', label: 'Ultra' },
      ],
      this.config.quality,
      (val) => {
        this.config.quality = val;
        this.syncPauseState();
        this.renderGarageState();
        this.onConfigChange?.('quality', val);
      }
    );
  }

  _buildMobileControls() {
    this.mobileEl = document.createElement('div');
    this.mobileEl.className = 'mobile-controls hidden';
    this.mobileEl.innerHTML = `
      <div class="touch-left">
        <button type="button" class="touch-btn" data-touch="left">&#9664;</button>
        <button type="button" class="touch-btn" data-touch="right">&#9654;</button>
      </div>
      <div class="touch-right">
        <button type="button" class="touch-btn touch-nitro" data-touch="nitro">NOS</button>
        <button type="button" class="touch-btn touch-drift" data-touch="handbrake">DRIFT</button>
        <button type="button" class="touch-btn touch-brake" data-touch="brake">BRK</button>
        <button type="button" class="touch-btn touch-gas" data-touch="throttle">GAS</button>
      </div>
    `;
    this.mobileRoot.appendChild(this.mobileEl);

    const activeTouches = {
      left: new Set(),
      right: new Set(),
      throttle: new Set(),
      brake: new Set(),
      handbrake: new Set(),
      nitro: new Set(),
    };

    const pushState = () => {
      const steer = (activeTouches.left.size > 0 ? 1 : 0) - (activeTouches.right.size > 0 ? 1 : 0);
      const any =
        activeTouches.left.size > 0 ||
        activeTouches.right.size > 0 ||
        activeTouches.throttle.size > 0 ||
        activeTouches.brake.size > 0 ||
        activeTouches.handbrake.size > 0 ||
        activeTouches.nitro.size > 0;
      this.inputManager.setTouchInput({
        active: any,
        steer,
        throttle: activeTouches.throttle.size > 0 ? 1 : 0,
        brake: activeTouches.brake.size > 0 ? 1 : 0,
        handbrake: activeTouches.handbrake.size > 0,
        nitro: activeTouches.nitro.size > 0,
      });
    };

    this.mobileEl.querySelectorAll('[data-touch]').forEach((btn) => {
      const role = btn.dataset.touch;
      const down = (e) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        activeTouches[role].add(e.pointerId);
        btn.classList.add('pressed');
        pushState();
      };
      const up = (e) => {
        activeTouches[role].delete(e.pointerId);
        if (activeTouches[role].size === 0) btn.classList.remove('pressed');
        pushState();
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
    });
  }

  syncMobileVisibility() {
    const show = !this.garageVisible && !this.pauseVisible && (this.isCoarsePointer || this.config.mobileControlsOverride);
    this.mobileEl.classList.toggle('hidden', !show);
  }

  setGarageVisible(visible) {
    this.garageVisible = Boolean(visible);
    this.garageEl.classList.toggle('hidden', !this.garageVisible);
    if (this.garageVisible) {
      this.renderGarageState();
      this.setPauseVisible(false);
    }
    this.syncMobileVisibility();
  }

  setPauseVisible(visible) {
    this.pauseVisible = Boolean(visible);
    this.pauseEl.classList.toggle('hidden', !this.pauseVisible);
    if (this.pauseVisible) {
      this.syncPauseState();
    }
    this.syncMobileVisibility();
  }

  dispose() {
    this.garageEl.remove();
    this.pauseEl.remove();
    this.mobileEl.remove();
  }
}
