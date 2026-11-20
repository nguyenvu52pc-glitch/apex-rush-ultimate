import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/**
 * Lightweight wireframe physics visualizer (toggled via F4).
 * Renders CANNON body shapes (chassis, props, walls, slabs) and live wheel suspension raycasts
 * without per-frame object allocations.
 */
export class PhysicsDebugRenderer {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./PhysicsWorld.js').PhysicsWorld} physicsWorld
   */
  constructor(scene, physicsWorld) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.visible = false;

    this.group = new THREE.Group();
    this.group.name = 'physics_debug_group';
    this.group.visible = false;
    this.scene.add(this.group);

    this.bodyMeshes = new Map();
    this.vehicles = new Set();

    this.materials = {
      chassis: new THREE.LineBasicMaterial({ color: 0x00e5ff }),
      staticWall: new THREE.LineBasicMaterial({ color: 0xff5722 }),
      staticGround: new THREE.LineBasicMaterial({ color: 0x3b82f6 }),
      prop: new THREE.LineBasicMaterial({ color: 0xfacc15 }),
    };

    // Pre-allocated raycast suspension line buffer (up to 64 wheels = 16 vehicles * 4)
    this.maxSuspensionLines = 64;
    this.rayPositions = new Float32Array(this.maxSuspensionLines * 6);
    this.rayColors = new Float32Array(this.maxSuspensionLines * 6);
    this.rayGeo = new THREE.BufferGeometry();
    this.rayGeo.setAttribute('position', new THREE.BufferAttribute(this.rayPositions, 3));
    this.rayGeo.setAttribute('color', new THREE.BufferAttribute(this.rayColors, 3));
    this.rayGeo.setDrawRange(0, 0);

    this.rayMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
    this.rayLines = new THREE.LineSegments(this.rayGeo, this.rayMat);
    this.rayLines.frustumCulled = false;
    this.rayLines.renderOrder = 25;
    this.group.add(this.rayLines);

    this._unitBoxWire = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this._unitCylWire = new THREE.EdgesGeometry(new THREE.CylinderGeometry(1, 1, 1, 12));
    this._scratchVec = new THREE.Vector3();
    this._scratchQuat = new THREE.Quaternion();
    this._scratchP0 = new CANNON.Vec3();
    this._scratchDir = new CANNON.Vec3();
    this.trackDebugGroup = null;
  }

  /**
   * Visualize spline centerline and 10 sequential checkpoint gates under F4.
   * @param {import('../track/TrackData.js').TrackData | null} trackData
   */
  setTrackDebug(trackData) {
    if (this.trackDebugGroup) {
      this.group.remove(this.trackDebugGroup);
      this.trackDebugGroup.traverse((obj) => {
        obj.geometry?.dispose();
        obj.material?.dispose();
      });
      this.trackDebugGroup = null;
    }
    if (!trackData) return;

    const tg = new THREE.Group();
    tg.name = 'track_debug_spline';

    // Spline centerline (+0.35m above asphalt)
    const pts = trackData.samples.map(
      (s) => new THREE.Vector3(s.position.x + s.up.x * 0.35, s.position.y + s.up.y * 0.35, s.position.z + s.up.z * 0.35)
    );
    pts.push(pts[0].clone());
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00e5ff });
    tg.add(new THREE.Line(lineGeo, lineMat));

    // 10 Checkpoint gate frames
    const gateMat = new THREE.LineBasicMaterial({ color: 0xfacc15 });
    const leftVec = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    for (const cp of trackData.checkpoints) {
      const halfW = cp.width * 0.5;
      const gateGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-halfW, 0, 0),
        new THREE.Vector3(-halfW, 4.5, 0),
        new THREE.Vector3(halfW, 4.5, 0),
        new THREE.Vector3(halfW, 0, 0),
      ]);
      const gate = new THREE.Line(gateGeo, gateMat.clone());
      gate.position.copy(cp.position);
      leftVec.copy(cp.right).negate();
      basis.makeBasis(leftVec, cp.up, cp.tangent);
      gate.quaternion.setFromRotationMatrix(basis);
      tg.add(gate);
    }

    this.trackDebugGroup = tg;
    this.group.add(tg);
  }

  /**
   * Register a VehiclePhysics instance for live suspension ray visualization.
   */
  addVehicle(vehiclePhysics) {
    this.vehicles.add(vehiclePhysics);
  }

  removeVehicle(vehiclePhysics) {
    this.vehicles.delete(vehiclePhysics);
  }

  toggle(forceState) {
    this.visible = typeof forceState === 'boolean' ? forceState : !this.visible;
    this.group.visible = this.visible;
    return this.visible;
  }

  _buildBodyWireframe(body) {
    const holder = new THREE.Group();
    const type = body.userData?.type;
    const mat =
      type === 'vehicle'
        ? this.materials.chassis
        : type === 'wall'
          ? this.materials.staticWall
          : body.mass > 0
            ? this.materials.prop
            : this.materials.staticGround;

    for (let i = 0; i < body.shapes.length; i++) {
      const shape = body.shapes[i];
      const offset = body.shapeOffsets[i];
      const orient = body.shapeOrientations[i];
      let lineSeg = null;

      if (shape instanceof CANNON.Box) {
        lineSeg = new THREE.LineSegments(this._unitBoxWire, mat);
        lineSeg.scale.set(shape.halfExtents.x * 2, shape.halfExtents.y * 2, shape.halfExtents.z * 2);
      } else if (shape instanceof CANNON.Cylinder) {
        lineSeg = new THREE.LineSegments(this._unitCylWire, mat);
        lineSeg.scale.set(shape.radiusTop, shape.height, shape.radiusBottom);
      } else if (shape instanceof CANNON.Sphere) {
        lineSeg = new THREE.LineSegments(this._unitBoxWire, mat);
        lineSeg.scale.setScalar(shape.radius * 2);
      }

      if (lineSeg) {
        lineSeg.position.set(offset.x, offset.y, offset.z);
        lineSeg.quaternion.set(orient.x, orient.y, orient.z, orient.w);
        holder.add(lineSeg);
      }
    }
    this.group.add(holder);
    return holder;
  }

  update() {
    if (!this.visible) return;

    const bodies = this.physicsWorld.world.bodies;
    const activeSet = new Set(bodies);

    // Remove stale wireframes for removed bodies
    for (const [body, holder] of this.bodyMeshes) {
      if (!activeSet.has(body)) {
        this.group.remove(holder);
        this.bodyMeshes.delete(body);
      }
    }

    // Sync active bodies
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      if (body.userData?.skipDebugWireframe) continue;
      let holder = this.bodyMeshes.get(body);
      if (!holder) {
        holder = this._buildBodyWireframe(body);
        this.bodyMeshes.set(body, holder);
      }
      holder.position.set(body.position.x, body.position.y, body.position.z);
      holder.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    }

    // Update suspension raycast lines (preserve w.isInContact without calling updateWheelTransformWorld)
    let lineIdx = 0;
    for (const vp of this.vehicles) {
      const body = vp.chassisBody;
      for (let wIdx = 0; wIdx < vp.vehicle.wheelInfos.length; wIdx++) {
        if (lineIdx >= this.maxSuspensionLines) break;
        const w = vp.vehicle.wheelInfos[wIdx];

        body.pointToWorldFrame(w.chassisConnectionPointLocal, this._scratchP0);
        body.vectorToWorldFrame(w.directionLocal, this._scratchDir);
        const rayLen = w.suspensionLength + w.radius;

        const base = lineIdx * 6;
        this.rayPositions[base + 0] = this._scratchP0.x;
        this.rayPositions[base + 1] = this._scratchP0.y;
        this.rayPositions[base + 2] = this._scratchP0.z;
        this.rayPositions[base + 3] = this._scratchP0.x + this._scratchDir.x * rayLen;
        this.rayPositions[base + 4] = this._scratchP0.y + this._scratchDir.y * rayLen;
        this.rayPositions[base + 5] = this._scratchP0.z + this._scratchDir.z * rayLen;

        // Bright green when grounded, red when airborne
        const r = w.isInContact ? 0.15 : 1.0;
        const g = w.isInContact ? 1.0 : 0.25;
        const b = w.isInContact ? 0.35 : 0.25;
        this.rayColors[base + 0] = r;
        this.rayColors[base + 1] = g;
        this.rayColors[base + 2] = b;
        this.rayColors[base + 3] = r;
        this.rayColors[base + 4] = g;
        this.rayColors[base + 5] = b;

        lineIdx += 1;
      }
    }

    this.rayGeo.setDrawRange(0, lineIdx * 2);
    this.rayGeo.attributes.position.needsUpdate = true;
    this.rayGeo.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.setTrackDebug(null);
    for (const holder of this.bodyMeshes.values()) {
      this.group.remove(holder);
    }
    this.bodyMeshes.clear();
    this.vehicles.clear();
    this._unitBoxWire.dispose();
    this._unitCylWire.dispose();
    this.rayGeo.dispose();
    this.rayMat.dispose();
    for (const mat of Object.values(this.materials)) {
      mat.dispose();
    }
    this.scene.remove(this.group);
  }
}
