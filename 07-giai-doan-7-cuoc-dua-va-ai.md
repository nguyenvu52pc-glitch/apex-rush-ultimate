# Giai đoạn 7: Cuộc đua, 7 Xe AI Vật lý Thật & Xếp hạng

- **Mục tiêu:** Đưa 7 xe đối thủ AI vào đường đua bằng chính hệ thống vật lý `RaycastVehicle` thật để các pha chèn ép, húc sườn, vượt xe và thứ hạng hoạt động công bằng và kịch tính.
- **Files chính:** `src/ai/AiDriver.js`, `src/gameplay/RaceManager.js`, cập nhật `src/main.js`.

## Tự vấn quy trình & Cân nhắc lựa chọn
- **Tại sao AI phải dùng `RaycastVehicle` thật thay vì di chuyển theo đường thẳng toán học?** Nếu AI chỉ chạy theo công thức vị trí cố định, khi bạn tông vào xe AI thì xe AI không bị văng đi mà xe bạn bật ra như đâm tường bê tông. Chạy `RaycastVehicle` thật giúp cả 8 xe có khối lượng, độ bám và va chạm công bằng.
- **Phanh theo độ cong & Auto-Unstuck:** Để AI chạy vật lý thật mà không lao thẳng vào tường ở góc cua gắt, AI phải đọc `curvature` phía trước `20m–60m` từ `TrackData` để tính `v_safe = sqrt(maxLateralAccel / curvature)` và giảm ga/nhấp phanh trước khi vào cua.

## Prompt Copy-Paste (English)

```text
START STAGE 7 — FULL RACE LOOP, 7 REAL-PHYSICS AI OPPONENTS & LIVE STANDINGS

[ANTI-BUG SELF-CHECK]
Verify Rules #9 and #10 before writing code:
- Rule #9 (Fair Real-Physics AI & Anti-Stuck): All 7 AI opponents MUST run on the same `VehiclePhysics` (`CANNON.RaycastVehicle`) rigid-body simulation as the player so car-to-car ramming transfers real 3D momentum, body tilt, and spin-out! Configure `chassis <-> chassis` `ContactMaterial` (`friction: 0.06`, `restitution: 0.30`) so side-by-side rubbing separates cleanly without interlocking colliders.
- Anti-Shortcut Laps & Wrap-Around Rankings: Enforce sequential passing of all 10 checkpoints per lap, and handle `u` wrap-around cleanly across `0.99 -> 0.01` at the start/finish line so live race positions never flicker.
- Rule #10: Reuse shared wheel/interior/trim geometries across AI vehicles (cloning only paint material per car) and never attach shadow-casting `SpotLight`s to AI cars (use lightweight additive light cones at night).

[STAGE 7 DELIVERABLES]
1. `src/ai/AiDriver.js`:
   - Give each AI a distinct car archetype from `CarCatalog`, unique paint color, personal target `laneOffset`, and difficulty scaling (`Easy / Medium / Hard` modifying speed multiplier, cornering aggression, and reaction noise).
   - Real-Time Driving Controller outputting `{ throttle, brake, steer, handbrake, nitro }`:
     * Lookahead Pure Pursuit: target a spline point ahead (`lookahead = clamp(8 + speed * 0.45, 8, 32)` meters) plus `laneOffset`, steering smoothly toward the local heading error.
     * Curvature Lookahead Braking: scan peak curvature `20m–60m` ahead via `TrackData` and compute `v_safe = Math.sqrt(maxLateralAccel / Math.max(curvature, 0.001))`. Modulate throttle and apply real brakes (lighting up AI brake lights!) whenever `speed > v_safe`.
     * Dynamic Overtaking: detect slower cars ahead within `< 12m` longitudinally and `< 2.8m` laterally, smoothly shifting `laneOffset` to an open lane inside track bounds.
     * Subtle Configurable Rubber-Banding so packs stay competitive without feeling rigged.
     * Auto-Unstuck Recovery: if an AI car stays stuck (`speed < 1.5 m/s` for `> 2.5s` while `RACING`), smoothly respawn it onto the nearest spline frame facing forward.

2. `src/gameplay/RaceManager.js`:
   - Finite State Machine: `GARAGE -> COUNTDOWN` (3-2-1-GO synced to the 5 gantry red lights, engines revvable while brakes locked) `-> RACING -> FINISHED`.
   - Arrange all 8 cars on the staggered 2×4 starting grid.
   - Track per-racer lap count (`totalLaps = 3`), sequential 10-checkpoint validation, current lap time, `bestLapTime`, `totalTime`, `WRONG WAY` detection (heading > 105° opposite track tangent), and automatic player recovery if flipped upside down > 3s (or manual `R` reset).
   - Compute real-time race standings (`1st..8th`) and persist `bestLap` per `(carId, trackId)` in `localStorage` safely wrapped in `try/catch`.

3. Update `src/main.js`:
   - Spawn all 8 real-physics racers onto either track, hooking collision sparks/smoke to all cars within visible range and verifying steady frame rate.

[COMPLETION CRITERIA]
- Racing 3 full laps against 7 AI opponents works end-to-end: AI cars brake before hairpins, overtake slower rivals, and recover automatically if knocked sideways.
- Ramming or trading paint with an AI car produces realistic 3D deflection, sparks, and suspension bounce on both vehicles.
- Live rankings (`1..8`) update accurately with zero flicker when crossing the start/finish line.
```
