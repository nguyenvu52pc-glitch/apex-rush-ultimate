/**
 * Live Physics Tuning Panel (toggled via F2).
 * Allows real-time tuning of suspension stiffness, damping, grip, downforce, and engine force.
 */
export class TuningPanel {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    this.container = container;
    this.visible = false;
    this.targetVehicle = null;

    this.rootEl = document.createElement('div');
    this.rootEl.className = 'tuning-panel hidden';
    this.rootEl.innerHTML = `
      <div class="debug-header">
        <span>PHYSICS TUNING [F2]</span>
        <button type="button" class="tuning-reset-btn" data-action="reset">Reset</button>
      </div>
      <div class="tuning-controls"></div>
    `;
    this.container.appendChild(this.rootEl);

    this.controlsEl = this.rootEl.querySelector('.tuning-controls');
    this.sliders = [];

    const specs = [
      { key: 'suspensionStiffness', label: 'Susp. Stiffness', min: 18, max: 85, step: 1 },
      { key: 'dampingCompression', label: 'Damp. Compress', min: 1.5, max: 9.0, step: 0.1 },
      { key: 'dampingRelaxation', label: 'Damp. Rebound', min: 1.5, max: 9.5, step: 0.1 },
      { key: 'frictionSlip', label: 'Tire Grip', min: 1.2, max: 4.5, step: 0.05 },
      { key: 'downforceCoeff', label: 'Aero Downforce', min: 0.0, max: 6.5, step: 0.1 },
      { key: 'maxEngineForce', label: 'Engine Force', min: 3000, max: 11000, step: 100 },
    ];

    for (const s of specs) {
      const row = document.createElement('label');
      row.className = 'tuning-row';
      row.innerHTML = `
        <div class="tuning-row-head">
          <span>${s.label}</span>
          <span class="debug-value" data-val="${s.key}">0</span>
        </div>
        <input type="range" min="${s.min}" max="${s.max}" step="${s.step}" data-key="${s.key}" />
      `;
      const input = row.querySelector('input');
      const valSpan = row.querySelector(`[data-val="${s.key}"]`);
      input.addEventListener('input', () => {
        const val = parseFloat(input.value);
        valSpan.textContent = s.step < 1 ? val.toFixed(2) : `${Math.round(val)}`;
        if (this.targetVehicle) {
          this.targetVehicle.applyTuning({ [s.key]: val });
        }
      });
      this.controlsEl.appendChild(row);
      this.sliders.push({ key: s.key, step: s.step, input, valSpan });
    }

    this.rootEl.querySelector('[data-action="reset"]').addEventListener('click', () => {
      if (!this.targetVehicle) return;
      this.targetVehicle.applyTuning({ ...this.targetVehicle.spec.physics });
      this.syncFromVehicle();
    });
  }

  bindVehicle(vehiclePhysics) {
    this.targetVehicle = vehiclePhysics;
    this.syncFromVehicle();
  }

  syncFromVehicle() {
    if (!this.targetVehicle) return;
    const phys = this.targetVehicle.phys;
    for (const s of this.sliders) {
      const v = phys[s.key];
      s.input.value = String(v);
      s.valSpan.textContent = s.step < 1 ? Number(v).toFixed(2) : `${Math.round(v)}`;
    }
  }

  toggle(forceState) {
    this.visible = typeof forceState === 'boolean' ? forceState : !this.visible;
    this.rootEl.classList.toggle('hidden', !this.visible);
  }

  dispose() {
    this.rootEl.remove();
  }
}
