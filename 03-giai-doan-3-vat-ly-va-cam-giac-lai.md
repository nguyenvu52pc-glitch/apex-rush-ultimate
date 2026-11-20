# Giai đoạn 3: Vật lý 3D Thật (`cannon-es`), Va chạm & Cảm giác lái

- **Mục tiêu:** Biến xe tĩnh thành xe đua vật lý 3D thật với hệ thống treo 4 bánh độc lập, drift có kiểm soát, va chạm bật nảy/trượt tường thật và húc văng vật cản.
- **Files chính:** `src/physics/PhysicsWorld.js`, `src/physics/VehiclePhysics.js`, `src/physics/PhysicsDebugRenderer.js`, `src/ui/TuningPanel.js`, cập nhật `src/main.js`.

## Tự vấn quy trình & Cân nhắc lựa chọn
- **Hạ trọng tâm chống lật:** Đặt Box collider nâng lên `+0.26m` so với tâm `chassisBody` giúp lực ly tâm khi vào cua không lật nhào xe một cách vô lý, nhưng vẫn giữ độ nghiêng thân xe (body roll) tự nhiên trên 4 lò xo.
- **Phân tích va chạm:** Tách rõ `wallMaterial` (ma sát 0.02 để trượt mượt dọc lan can) và `propMaterial` (các vật cản RigidBody nhẹ hơn như cọc tiêu, thùng rào có thể bị húc bay thật!).

## Prompt Copy-Paste (English)

```text
START STAGE 3 — REAL 3D RIGID-BODY VEHICLE PHYSICS (CANNON-ES), COLLISIONS & HANDLING

[ANTI-BUG SELF-CHECK]
Verify Rules #3, #4, #5, and #10 before writing code:
- Rule #5 (Anti-Flip & Low CoM): Offset the chassis collision shape upward by `+0.26m` relative to `chassisBody` origin to lower the physical center of mass. Configure `angularDamping: 0.15`, `linearDamping: 0.02`, and speed-squared aerodynamic downforce.
- Suspension & RaycastVehicle Alignment: Double-check `indexRightAxis = 0`, `indexUpAxis = 1`, `indexForwardAxis = 2`, `directionLocal = (0, -1, 0)`, `axleLocal = (-1, 0, 0)`, ensuring positive throttle (`W`) accelerates along `+Z` and steering (`A`) turns left toward `+X`.
- Rule #10: Pre-allocate scratch vectors/quaternions outside `update(dt)` — zero per-frame allocations.

[STAGE 3 DELIVERABLES]
1. `src/physics/PhysicsWorld.js`:
   - Manage `CANNON.World` with `SAPBroadphase` and tuned gravity (`-14 m/s²` or `-9.82 m/s²` balanced with downforce — justify choice).
   - Define `CANNON.Material` and `ContactMaterial` pairs: `groundMaterial`, `wallMaterial`, `chassisMaterial`, `propMaterial` (`chassis <-> wall` uses `friction: 0.02`, `restitution: 0.22` per Rule #4 for smooth wall-scraping).
   - Listen to `collide` events, compute `impactVelocityAlongNormal`, and emit structured callbacks `onCollision({ bodyA, bodyB, intensity, point, normal })` for VFX/audio/camera shake.

2. `src/physics/VehiclePhysics.js`:
   - Construct `chassisBody` + `CANNON.RaycastVehicle` with 4 independent suspension rays using each car's `physicsSpecs` from `CarCatalog.js` (`mass`, `maxEngineForce`, `maxSpeed`, `suspensionStiffness`, `dampingRelaxation`, `dampingCompression`, `frictionSlip`, `rollInfluence`).
   - Realistic Arcade-Sim Handling:
     * Torque curve + simulated 6-speed gearbox (`gear`, `rpmNormalized`) with engine braking when off-throttle.
     * Speed-sensitive steering limit (wider steer angle at low speeds, tightly clamped at 200+ km/h) with smooth steering interpolation.
     * Handbrake Drift (`Space`): smoothly lower rear wheel `frictionSlip` (e.g., from `~2.6` to `~1.05`) while maintaining front bite so drivers can initiate and hold controlled drifts without spinning out randomly.
     * Nitro boost (`Shift`): 100-unit tank that drains when active, regenerates slowly, and boosts engine force and top speed.
     * Speed-squared aerodynamic downforce applied downward on `chassisBody`.
   - Sync `chassisBody` and `wheelInfos[i].worldTransform` smoothly to `CarModelBuilder`, tracking wheel spin accumulation and front steer angle for `steerWheels` / `spinWheels` and driving brake lights automatically.
   - Implement `reset(position, quaternion)` to zero velocities/angular velocities and stabilize suspension cleanly.

3. `src/physics/PhysicsDebugRenderer.js`:
   - Lightweight wireframe visualizer (toggled via `F4`) rendering chassis colliders, obstacle colliders, and wheel suspension raycast lines so visual meshes and physics shapes can be verified to match 1:1.

4. `src/ui/TuningPanel.js` & Update `src/main.js`:
   - Build a spacious Physics Proving Ground featuring smooth launch ramps, rumble curb bumps to test 4-wheel independent suspension, surrounding thick collision walls, and dynamic rigid-body props (traffic cones, tire stacks, barrels) that scatter realistically on impact!
   - Toggle `F2` live tuning panel (suspension stiffness, damping, grip, downforce, engine force) and allow `1–4` car switching directly in the arena to compare handling feel across all 4 cars.

[COMPLETION CRITERIA]
- Driving over ramps/curbs compresses and rebounds individual wheels with authentic chassis pitch and roll.
- Crashing into cones/barrels knocks them flying in 3D; scraping along walls at high speed triggers frictionless sliding and collision callbacks without sticking or tunneling.
- `F4` wireframe aligns precisely with the car chassis, wheels, and obstacles.
```
