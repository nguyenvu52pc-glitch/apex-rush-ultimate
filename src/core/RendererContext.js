import * as THREE from 'three';

/**
 * Manages the WebGLRenderer, primary Scene, and PerspectiveCamera with clean resize & disposal.
 */
export class RendererContext {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.disposed = false;
    this.resizeListeners = new Set();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b101b);

    const width = window.innerWidth || 1280;
    const height = window.innerHeight || 720;

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.25, 1600);
    this.camera.position.set(0, 4.2, -9.0);
    this.camera.lookAt(0, 0.8, 4.0);

    this.maxPixelRatio = 2.2;
    this.renderScale = 1.0;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });

    this.renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * this.renderScale, this.maxPixelRatio));
    this.renderer.setSize(width, height, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this._onResize = this._handleResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  /**
   * @param {number} renderScale
   * @param {number} [maxPixelRatio]
   */
  setRenderScale(renderScale, maxPixelRatio = 2.2) {
    this.renderScale = renderScale;
    this.maxPixelRatio = maxPixelRatio;
    this._handleResize();
  }

  setMaxPixelRatio(maxPixelRatio) {
    this.maxPixelRatio = maxPixelRatio;
    this._handleResize();
  }

  /**
   * @param {(width: number, height: number, pixelRatio: number) => void} fn
   * @returns {() => void}
   */
  onResize(fn) {
    this.resizeListeners.add(fn);
    return () => this.resizeListeners.delete(fn);
  }

  _handleResize() {
    if (this.disposed) return;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const pixelRatio = Math.min((window.devicePixelRatio || 1) * this.renderScale, this.maxPixelRatio);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);

    for (const listener of this.resizeListeners) {
      listener(width, height, pixelRatio);
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('resize', this._onResize);
    this.resizeListeners.clear();
    this.renderer.dispose();
  }
}
