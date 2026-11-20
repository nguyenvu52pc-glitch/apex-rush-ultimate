/**
 * Performance & coordinate debug overlay toggled by F3.
 * Displays FPS, frame time, draw calls, triangle counts, GPU memory counts, and target XYZ.
 */
export class DebugOverlay {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    this.container = container;
    this.visible = true;
    this.elapsed = 0;
    this.frameCount = 0;
    this.fps = 60;
    this.frameMs = 16.67;

    this.rootEl = document.createElement('div');
    this.rootEl.className = 'debug-panel';
    this.rootEl.innerHTML = `
      <div class="debug-header">
        <span>DEBUG [F3]</span>
        <span data-field="fps">-- FPS</span>
      </div>
      <div class="debug-row"><span class="debug-label">Frame Time</span><span class="debug-value" data-field="frameMs">-- ms</span></div>
      <div class="debug-row"><span class="debug-label">Draw Calls</span><span class="debug-value" data-field="calls">0</span></div>
      <div class="debug-row"><span class="debug-label">Triangles</span><span class="debug-value" data-field="triangles">0</span></div>
      <div class="debug-row"><span class="debug-label">Geometries</span><span class="debug-value" data-field="geometries">0</span></div>
      <div class="debug-row"><span class="debug-label">Textures</span><span class="debug-value" data-field="textures">0</span></div>
      <div class="debug-row"><span class="debug-label">Position XYZ</span><span class="debug-value" data-field="pos">0.0, 0.0, 0.0</span></div>
      <div class="debug-row"><span class="debug-label">Speed</span><span class="debug-value" data-field="speed">0 km/h</span></div>
    `;
    this.container.appendChild(this.rootEl);

    this.fields = {
      fps: this.rootEl.querySelector('[data-field="fps"]'),
      frameMs: this.rootEl.querySelector('[data-field="frameMs"]'),
      calls: this.rootEl.querySelector('[data-field="calls"]'),
      triangles: this.rootEl.querySelector('[data-field="triangles"]'),
      geometries: this.rootEl.querySelector('[data-field="geometries"]'),
      textures: this.rootEl.querySelector('[data-field="textures"]'),
      pos: this.rootEl.querySelector('[data-field="pos"]'),
      speed: this.rootEl.querySelector('[data-field="speed"]'),
    };
  }

  /**
   * @param {boolean} [forceState]
   */
  toggle(forceState) {
    this.visible = typeof forceState === 'boolean' ? forceState : !this.visible;
    this.rootEl.classList.toggle('hidden', !this.visible);
  }

  /**
   * @param {number} dt
   * @param {import('three').WebGLRenderer} renderer
   * @param {{ x: number, y: number, z: number }} targetPos
   * @param {number} [speedKmh]
   */
  update(dt, renderer, targetPos, speedKmh = 0) {
    this.elapsed += dt;
    this.frameCount += 1;

    if (this.elapsed < 0.25) return;

    this.fps = this.frameCount / this.elapsed;
    this.frameMs = (this.elapsed / this.frameCount) * 1000;
    this.elapsed = 0;
    this.frameCount = 0;

    if (!this.visible) return;

    const info = renderer.info;
    this.fields.fps.textContent = `${this.fps.toFixed(0)} FPS`;
    this.fields.frameMs.textContent = `${this.frameMs.toFixed(2)} ms`;
    this.fields.calls.textContent = `${info.render.calls}`;
    this.fields.triangles.textContent = `${info.render.triangles.toLocaleString('en-US')}`;
    this.fields.geometries.textContent = `${info.memory.geometries}`;
    this.fields.textures.textContent = `${info.memory.textures}`;
    this.fields.pos.textContent = `${targetPos.x.toFixed(1)}, ${targetPos.y.toFixed(1)}, ${targetPos.z.toFixed(1)}`;
    this.fields.speed.textContent = `${Math.round(speedKmh)} km/h`;
  }

  dispose() {
    this.rootEl.remove();
  }
}
