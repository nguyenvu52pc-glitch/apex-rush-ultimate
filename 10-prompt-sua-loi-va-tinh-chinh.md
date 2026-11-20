# Phụ lục 10: Bộ Prompt Tự Vấn Sửa Lỗi & Tinh Chỉnh (Rescue Kit)

> **Cách dùng:** Khi chạy thử ở bất kỳ giai đoạn nào mà phát sinh lỗi hình học, vật lý hay hiệu năng, hãy sao chép đúng mẫu prompt tiếng Anh tương ứng dưới đây, điền mô tả lỗi vào chỗ `[DESCRIBE THE ISSUE: ...]` rồi gửi cho AI để chẩn đoán tận gốc.

---

## 1. Sửa lỗi Hình học Xe, Vòm bánh & Lệch trục quay

```text
I am testing the 3D vehicle models in Stage 2 (or Stage 8) and encountered a geometry issue: [DESCRIBE THE ISSUE: e.g., tires poke outside the fenders / wheels clip into wheel arches at full steering lock / wheels wobble elliptically while spinning / car chassis sinks into the road].

[REQUIRED ROOT-CAUSE SELF-CHECK BEFORE EDITING]
1. Inspect `src/car/CarModelBuilder.js`, `src/car/WheelBuilder.js`, and `src/car/CarCatalog.js`.
2. Audit these 4 critical geometry invariants:
   - Is `spinGroup`'s local origin centered strictly at `(0, 0, 0)` before attaching to `steerGroup`?
   - When rotating `LatheGeometry` / `CylinderGeometry` by ±Math.PI/2 to orient the tire horizontally, did the child rotation axis accidentally swap between `X` and `Z`?
   - Are the lofted lower cross-sections around front and rear axles recessed inward deeply enough, and is the arch cutout radius >= `wheelRadius + maxSuspensionTravel + 0.06m` with lateral clearance for ±32° steering?
   - Are brake calipers parented to `steerGroup` (not `spinGroup`) so they remain stationary while the brake rotors spin?
3. State the exact root cause first, then output complete updated files fixing the issue.
```

---

## 2. Sửa lỗi Vật lý, Lật xe, Khựng bánh hoặc Kẹt lan can

```text
While test-driving in Stage 3 or Stage 4, I encountered a physics/handling issue: [DESCRIBE THE ISSUE: e.g., car flips too easily in sharp turns / A and D steer in the wrong direction / car gets glued to guardrails or tunnels through barriers / wheels bounce unexpectedly on flat road seams / AI gets stuck].

[REQUIRED ROOT-CAUSE SELF-CHECK BEFORE EDITING]
1. Inspect `src/physics/VehiclePhysics.js`, `src/physics/PhysicsWorld.js`, and `src/track/TrackPhysics.js`.
2. Audit in priority order:
   - Coordinate Contract: `+Z` forward, `+Y` up, `+X` car left. Check `RaycastVehicle` `axleLocal`, `directionLocal`, `engineForce`, and `steeringValue` signs so `W` accelerates toward `+Z` and `A` turns left toward `+X`.
   - Center of Mass & Anti-Roll: Is the chassis Box collider offset upward (`+0.25m` to `+0.32m`) relative to `chassisBody`, and is `rollInfluence` tuned around `0.08–0.15` with active speed-squared aerodynamic downforce?
   - Anti-Snag Road Colliders: Are road `CANNON.Box` slabs >= `1.2m` thick with >= `0.15m` longitudinal overlap, and are physical curbs <= `0.035m`?
   - Wall-Scrape & Anti-Tunneling: Does `chassis <-> wall` `ContactMaterial` have `friction <= 0.03`, are guardrail `Box` walls >= `1.0m` thick, and is `fixedTimeStep <= 1/120`?
3. Present a before/after parameter comparison table, then output complete updated files.
```

---

## 3. Sửa lỗi Ánh sáng, Bóng lá vuông, Cháy Bloom hoặc Tụt FPS

```text
The game has a rendering or performance issue in Stage 5, 6, or 9: [DESCRIBE THE ISSUE: e.g., car paint looks pitch black / tree shadows look like solid squares instead of leaves / shadows shimmer while driving / daylight road washes out white under Bloom / FPS drops below 40 or GPU memory grows over time].

[REQUIRED ROOT-CAUSE SELF-CHECK BEFORE EDITING]
1. Inspect `src/graphics/EnvironmentFactory.js`, `src/world/BotanicalFactory.js`, `src/world/LightingRig.js`, and `src/graphics/PostProcessingRig.js`.
2. Audit these 5 root causes:
   - Black metallic paint: `scene.environment` missing a `PMREMGenerator` bake or `envMapIntensity` too low / missing `SRGBColorSpace`.
   - Square block tree shadows: Foliage `InstancedMesh` uses `alphaTest: 0.45` without a matching `customDepthMaterial` (`RGBADepthPacking`, `map: leafTex`, `alphaTest: 0.45`, and identical wind vertex shader).
   - Shimmering shadows: `DirectionalLight` follows the player car without texel snapping aligned to `shadow.mapSize`.
   - Washed-out daylight Bloom or crushed colors: `UnrealBloomPass.threshold` set below `0.85` or tone mapping applied twice outside `OutputPass`.
   - FPS drops / Memory leaks: Per-frame `new THREE.*` allocations inside `update(dt)`, un-instanced foliage/rocks, or missing `.dispose()` calls when switching cars/tracks/themes.
3. Explain the diagnosed root cause concisely, then output complete optimized files.
```
