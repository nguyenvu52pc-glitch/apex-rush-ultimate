import * as THREE from 'three';

/**
 * Generates procedural IBL environment maps via PMREMGenerator so metallic clearcoat
 * paint, glass, and chrome rims reflect rich cinema-grade sky & studio highlights offline.
 * Strictly guards all pow() bases with max(..., 0.0001) so zero NaN texels ever bake into HalfFloat PMREM!
 */
export class EnvironmentFactory {
  /**
   * @param {THREE.WebGLRenderer} renderer
   */
  constructor(renderer) {
    this.renderer = renderer;
    this.pmremGenerator = new THREE.PMREMGenerator(renderer);
    this.pmremGenerator.compileEquirectangularShader();
    this.currentTarget = null;
  }

  /**
   * Bake an atmospheric studio/sky cubemap into scene.environment.
   * Disposes the previous WebGLRenderTarget cleanly to prevent VRAM leaks.
   * @param {THREE.Scene} scene
   * @param {object} [options]
   */
  bakeToScene(scene, options = {}) {
    const {
      zenithColor = 0x162447,
      horizonColor = 0x7aa2d8,
      groundColor = 0x10141f,
      sunColor = 0xfff0cc,
      sunDirection = new THREE.Vector3(0.45, 0.55, 0.7),
      studioStrips = true,
      intensity = 1.0,
    } = options;

    const envScene = new THREE.Scene();
    const disposables = [];

    const skyGeo = new THREE.SphereGeometry(50, 32, 20);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color(zenithColor) },
        uHorizon: { value: new THREE.Color(horizonColor) },
        uGround: { value: new THREE.Color(groundColor) },
        uSunColor: { value: new THREE.Color(sunColor) },
        uSunDir: { value: sunDirection.clone().normalize() },
        uIntensity: { value: intensity },
      },
      vertexShader: `
        varying vec3 vWorldDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldDir = position;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uGround;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        uniform float uIntensity;
        varying vec3 vWorldDir;
        void main() {
          vec3 d = normalize(vWorldDir + vec3(1e-5, 0.0, 0.0));
          float h = d.y;
          vec3 col = h >= 0.0
            ? mix(uHorizon, uZenith, pow(max(h, 0.0001), 0.55))
            : mix(uHorizon * 0.48, uGround, pow(max(-h, 0.0001), 0.45));

          // Bright horizon scattering band for crisp fender horizon reflections
          float band = exp(-abs(h) * 9.0) * 0.75;
          col += uHorizon * band;

          // Sun highlight disc & controlled bloom halo (guarded against pow(0,x) NaNs)
          float sunDot = max(dot(d, normalize(uSunDir)), 0.0001);
          col += uSunColor * pow(sunDot, 22.0) * 1.45;
          col += uSunColor * smoothstep(0.985, 0.999, sunDot) * 3.8;

          vec3 finalCol = clamp(col * uIntensity, vec3(0.0), vec3(10.0));
          gl_FragColor = vec4(finalCol, 1.0);
        }
      `,
    });
    const skyDome = new THREE.Mesh(skyGeo, skyMat);
    envScene.add(skyDome);
    disposables.push(skyGeo, skyMat);

    // Overhead + side automotive softbox studio light strips for razor-sharp clearcoat highlights
    if (studioStrips) {
      const stripGeo = new THREE.PlaneGeometry(26, 3.0);
      const stripMatMain = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xffffff).multiplyScalar(3.4 * intensity),
        side: THREE.DoubleSide,
      });
      const stripMatWarm = new THREE.MeshBasicMaterial({
        color: new THREE.Color(sunColor).multiplyScalar(2.6 * intensity),
        side: THREE.DoubleSide,
      });
      const stripMatCool = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x93c5fd).multiplyScalar(2.4 * intensity),
        side: THREE.DoubleSide,
      });

      const placements = [
        { pos: [0, 18, 0], rot: [Math.PI / 2, 0, 0], mat: stripMatMain },
        { pos: [15, 9, 5], rot: [Math.PI / 3, 0, -Math.PI / 4], mat: stripMatWarm },
        { pos: [-15, 9, -5], rot: [Math.PI / 3, 0, Math.PI / 4], mat: stripMatCool },
      ];

      for (const p of placements) {
        const mesh = new THREE.Mesh(stripGeo, p.mat);
        mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
        mesh.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
        envScene.add(mesh);
      }
      disposables.push(stripGeo, stripMatMain, stripMatWarm, stripMatCool);
    }

    const nextTarget = this.pmremGenerator.fromScene(envScene, 0.025);
    if (this.currentTarget) {
      this.currentTarget.dispose();
    }
    this.currentTarget = nextTarget;
    scene.environment = nextTarget.texture;

    for (const item of disposables) {
      item.dispose();
    }
    return nextTarget.texture;
  }

  dispose() {
    if (this.currentTarget) {
      this.currentTarget.dispose();
      this.currentTarget = null;
    }
    this.pmremGenerator.dispose();
  }
}
