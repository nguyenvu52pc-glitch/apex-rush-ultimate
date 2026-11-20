import * as CANNON from 'cannon-es';

/**
 * Manages the CANNON.World rigid-body simulation with SAPBroadphase,
 * tuned gravity (-14 m/s² balanced with suspension & aerodynamic downforce),
 * specialized ContactMaterials (Rule #4 smooth wall-scrape), and zero-allocation collision events.
 */
export class PhysicsWorld {
  constructor() {
    this.world = new CANNON.World();
    // Tuned gravity (-14 m/s²) keeps jumps snappy and weight transfer responsive alongside downforce
    this.world.gravity.set(0, -14, 0);
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = false;
    this.world.defaultContactMaterial.friction = 0.2;
    this.world.defaultContactMaterial.restitution = 0.1;

    this.materials = {
      ground: new CANNON.Material('ground'),
      wall: new CANNON.Material('wall'),
      chassis: new CANNON.Material('chassis'),
      prop: new CANNON.Material('prop'),
    };

    // Rule #4: zero-friction & zero-restitution smooth wall scraping prevents launching airborne
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.materials.chassis, this.materials.wall, {
        friction: 0.0,
        restitution: 0.0,
        contactEquationStiffness: 1e7,
        contactEquationRelaxation: 3,
      })
    );

    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.materials.chassis, this.materials.ground, {
        friction: 0.05,
        restitution: 0.05,
      })
    );

    // Rule #9: car-to-car rubbing separates cleanly without interlocking
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.materials.chassis, this.materials.chassis, {
        friction: 0.06,
        restitution: 0.30,
      })
    );

    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.materials.chassis, this.materials.prop, {
        friction: 0.20,
        restitution: 0.42,
      })
    );

    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.materials.prop, this.materials.ground, {
        friction: 0.55,
        restitution: 0.28,
      })
    );

    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.materials.prop, this.materials.wall, {
        friction: 0.30,
        restitution: 0.35,
      })
    );

    this.collisionListeners = new Set();
    this._trackedBodies = new Map();
    this._scratchPoint = new CANNON.Vec3();
    this._scratchNormal = new CANNON.Vec3();
    this._collisionPayload = {
      bodyA: null,
      bodyB: null,
      intensity: 0,
      point: this._scratchPoint,
      normal: this._scratchNormal,
    };
  }

  /**
   * Subscribe to structured collision events `{ bodyA, bodyB, intensity, point, normal }`.
   * Note: `point` and `normal` are scratch vectors valid for the synchronous callback invocation.
   * @param {(event: object) => void} cb
   * @returns {() => void}
   */
  onCollision(cb) {
    this.collisionListeners.add(cb);
    return () => this.collisionListeners.delete(cb);
  }

  /**
   * Register a dynamic vehicle chassis body so its impacts emit structured callbacks.
   * @param {CANNON.Body} body
   */
  trackCollisionBody(body) {
    if (this._trackedBodies.has(body)) return;
    const handler = (event) => {
      const other = event.body;
      const contact = event.contact;
      const isBi = contact.bi === body;
      const relVec = isBi ? contact.ri : contact.rj;

      // Record active wall contact normal (pointing away from wall toward car) for anti-deadlock deflection
      if (other.userData?.type === 'wall' && body.userData) {
        if (!body.userData.wallNormal) {
          body.userData.wallNormal = { x: 0, y: 0, z: 0 };
        }
        const awaySign = isBi ? -1 : 1;
        body.userData.wallNormal.x = contact.ni.x * awaySign;
        body.userData.wallNormal.y = contact.ni.y * awaySign;
        body.userData.wallNormal.z = contact.ni.z * awaySign;
        body.userData.wallScrapeTimer = 0.18;
      }

      if (this.collisionListeners.size === 0) return;
      const impact = Math.abs(contact.getImpactVelocityAlongNormal());
      if (impact < 1.2) return;

      // Avoid duplicate callbacks for body-vs-body when both are tracked
      if (this._trackedBodies.has(other) && body.id > other.id) return;

      this._scratchPoint.copy(body.position).vadd(relVec, this._scratchPoint);
      this._scratchNormal.copy(contact.ni);
      if (!isBi) {
        this._scratchNormal.scale(-1, this._scratchNormal);
      }

      this._collisionPayload.bodyA = body;
      this._collisionPayload.bodyB = other;
      this._collisionPayload.intensity = impact;

      for (const listener of this.collisionListeners) {
        listener(this._collisionPayload);
      }
    };
    body.addEventListener('collide', handler);
    this._trackedBodies.set(body, handler);
  }

  /**
   * @param {CANNON.Body} body
   */
  untrackCollisionBody(body) {
    const handler = this._trackedBodies.get(body);
    if (handler) {
      body.removeEventListener('collide', handler);
      this._trackedBodies.delete(body);
    }
  }

  /**
   * @param {CANNON.Body} body
   */
  addBody(body) {
    this.world.addBody(body);
  }

  /**
   * @param {CANNON.Body} body
   */
  removeBody(body) {
    this.untrackCollisionBody(body);
    this.world.removeBody(body);
  }

  /**
   * Step the physics world by one fixed timestep (`1/120`s) and refresh active wall contacts.
   * @param {number} fixedTimeStep
   */
  step(fixedTimeStep) {
    this.world.step(fixedTimeStep);

    // Refresh sustained wall-scrape normals on vehicles currently touching a wall
    const contacts = this.world.contacts;
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      const tA = c.bi.userData?.type;
      const tB = c.bj.userData?.type;
      if (tA === 'vehicle' && tB === 'wall') {
        const ud = c.bi.userData;
        if (!ud.wallNormal) ud.wallNormal = { x: 0, y: 0, z: 0 };
        ud.wallNormal.x = -c.ni.x;
        ud.wallNormal.y = -c.ni.y;
        ud.wallNormal.z = -c.ni.z;
        ud.wallScrapeTimer = 0.12;
      } else if (tB === 'vehicle' && tA === 'wall') {
        const ud = c.bj.userData;
        if (!ud.wallNormal) ud.wallNormal = { x: 0, y: 0, z: 0 };
        ud.wallNormal.x = c.ni.x;
        ud.wallNormal.y = c.ni.y;
        ud.wallNormal.z = c.ni.z;
        ud.wallScrapeTimer = 0.12;
      }
    }
  }

  dispose() {
    for (const [body, handler] of this._trackedBodies) {
      body.removeEventListener('collide', handler);
    }
    this._trackedBodies.clear();
    this.collisionListeners.clear();
    const bodies = this.world.bodies.slice();
    for (const b of bodies) {
      this.world.removeBody(b);
    }
  }
}
