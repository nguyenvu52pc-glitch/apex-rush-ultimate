import * as THREE from 'three';

/**
 * Manages the primary DirectionalLight (with light-space shadow texel snapping per Rule #8),
 * a shadowless opposite-azimuth sky bounce rim light for automotive sculptural depth,
 * and HemisphereLight matching the active theme & graphics quality preset.
 */
export class LightingRig {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.frustumHalf = 34; // Tight 68m x 68m high-density shadow box
    this.shadowMapSize = 2048;
    this.sunDistance = 120;

    this.hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x334155, 0.78);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff5e4, 2.6);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize);
    this.sunLight.shadow.camera.near = 5;
    this.sunLight.shadow.camera.far = 260;
    this.sunLight.shadow.camera.left = -this.frustumHalf;
    this.sunLight.shadow.camera.right = this.frustumHalf;
    this.sunLight.shadow.camera.top = this.frustumHalf;
    this.sunLight.shadow.camera.bottom = -this.frustumHalf;
    this.sunLight.shadow.bias = -0.00025;
    this.sunLight.shadow.normalBias = 0.016;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Subtle cool sky bounce rim light opposite the sun so shadowed fenders reveal crisp curves
    this.rimLight = new THREE.DirectionalLight(0x93c5fd, 0.45);
    this.rimLight.castShadow = false;
    this.scene.add(this.rimLight);
    this.scene.add(this.rimLight.target);

    this._sunDir = new THREE.Vector3(0.5, 0.5, 0.5).normalize();
    this._rimDir = new THREE.Vector3(-0.5, 0.35, -0.5).normalize();
    this._lightRight = new THREE.Vector3();
    this._lightUp = new THREE.Vector3();
    this._worldUp = new THREE.Vector3(0, 1, 0);
    this._snappedTarget = new THREE.Vector3();
  }

  applyTheme(themeSpec) {
    const l = themeSpec.lighting;
    this.sunLight.color.setHex(l.sunColor);
    this.sunLight.intensity = l.sunIntensity;
    this.hemiLight.color.setHex(l.hemiSkyColor);
    this.hemiLight.groundColor.setHex(l.hemiGroundColor);
    this.hemiLight.intensity = l.hemiIntensity;

    this.rimLight.color.setHex(l.hemiSkyColor);
    this.rimLight.intensity = themeSpec.isNight ? 0.52 : 0.44;

    this._sunDir.set(l.sunDirection[0], l.sunDirection[1], l.sunDirection[2]).normalize();
    this._rimDir.set(-this._sunDir.x, Math.max(0.28, this._sunDir.y * 0.75), -this._sunDir.z).normalize();

    this._lightRight.crossVectors(this._worldUp, this._sunDir);
    if (this._lightRight.lengthSq() < 1e-5) {
      this._lightRight.set(1, 0, 0);
    } else {
      this._lightRight.normalize();
    }
    this._lightUp.crossVectors(this._sunDir, this._lightRight).normalize();
  }

  /**
   * Update shadow map resolution (called by QualityManager).
   */
  setShadowMapSize(size) {
    if (this.shadowMapSize === size) return;
    this.shadowMapSize = size;
    this.sunLight.shadow.mapSize.set(size, size);
    if (this.sunLight.shadow.map) {
      this.sunLight.shadow.map.dispose();
      this.sunLight.shadow.map = null;
    }
  }

  /**
   * Update shadow camera to follow target with strict light-space texel snapping (Rule #8).
   * @param {THREE.Vector3} focusPos
   */
  update(focusPos) {
    const texelWorldSize = (this.frustumHalf * 2) / this.shadowMapSize;
    const r = Math.round(focusPos.dot(this._lightRight) / texelWorldSize) * texelWorldSize;
    const u = Math.round(focusPos.dot(this._lightUp) / texelWorldSize) * texelWorldSize;
    const f = focusPos.dot(this._sunDir);

    this._snappedTarget
      .set(0, 0, 0)
      .addScaledVector(this._lightRight, r)
      .addScaledVector(this._lightUp, u)
      .addScaledVector(this._sunDir, f);

    this.sunLight.target.position.copy(this._snappedTarget);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.position.copy(this._snappedTarget).addScaledVector(this._sunDir, this.sunDistance);

    this.rimLight.target.position.copy(focusPos);
    this.rimLight.target.updateMatrixWorld();
    this.rimLight.position.copy(focusPos).addScaledVector(this._rimDir, 80);
  }

  dispose() {
    if (this.sunLight.shadow.map) {
      this.sunLight.shadow.map.dispose();
    }
    this.scene.remove(this.sunLight);
    this.scene.remove(this.sunLight.target);
    this.scene.remove(this.rimLight);
    this.scene.remove(this.rimLight.target);
    this.scene.remove(this.hemiLight);
  }
}
