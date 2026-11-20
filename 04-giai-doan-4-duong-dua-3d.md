# Giai đoạn 4: Đường đua 3D (2 Bản đồ), Bề mặt & Collider Chống vấp

- **Mục tiêu:** Dựng 2 đường đua khép kín có độ cao dốc & cua nghiêng banking từ `CatmullRomCurve3`, kết cấu nhựa đường sắc nét và chuỗi `Box` collider chạy 260 km/h không bị vấp mép.
- **Files chính:** `src/track/TrackCatalog.js`, `src/track/TrackData.js`, `src/track/TrackBuilder.js`, `src/track/TrackPhysics.js`, cập nhật `src/main.js`.

## Tự vấn quy trình & Cân nhắc lựa chọn
- **Tại sao CẤM dùng `Trimesh` cho mặt đường đua vật lý?** Trong `cannon-es`, raycast của bánh xe trượt ngang qua ranh giới giữa hai tam giác trong `Trimesh` rất dễ bị khựng đột ngột ("internal edge snagging"), khiến xe đang chạy 250 km/h tự dưng nảy ngược lên. Chuỗi các `CANNON.Box` dày `1.5m` xếp gối đầu chồng mép `0.20m` chạy êm mượt tuyệt đối.
- **Spatial Hash Grid 2D:** Giúp `trackData.project(pos)` tra cứu điểm gần nhất trên đường đua chỉ mất `O(1)` — tối quan trọng để Giai đoạn 5 làm phẳng địa hình và 7 AI cập nhật mỗi khung hình mà không lag.

## Prompt Copy-Paste (English)

```text
START STAGE 4 — 3D SPLINE CIRCUITS (2 TRACKS), ASPHALT SURFACE & ANTI-SNAG COLLIDERS

[ANTI-BUG SELF-CHECK]
Verify Rules #3, #6, and #7 before writing code:
- Rule #6 (No Frenet Twist & Arc-Length UVs): Compute road cross-section frames using World-Up `(0, 1, 0)` plus curvature-derived banking — NEVER use `computeFrenetFrames`. Parameterize UVs by cumulative arc-length so textures never stretch on longer segments. Verify minimum curve radius > `trackHalfWidth + 4m` so inner curbs never fold over themselves.
- Rule #3 (Anti-Snag Road & Barrier Physics): NEVER use raw `Trimesh` for the road collider. Construct physics road segments from thick overlapping oriented `CANNON.Box` slabs (thickness >= `1.5m`, longitudinal overlap >= `0.20m`) whose top face aligns strictly with the visual road surface, plus continuous thick guardrail `CANNON.Box` walls (thickness >= `1.2m`, height >= `1.6m`) assigned `wallMaterial`.
- Rule #7 (No Z-Fighting): Offset start/finish checkerboards and painted road lines at least `+0.015m` vertically (or bake cleanly into UV/material layers with `polygonOffset`).

[STAGE 4 DELIVERABLES]
1. `src/track/TrackCatalog.js`:
   Define 2 distinct closed racing circuits (16–22 3D control points each, featuring smooth elevation changes and banked turns):
   - Track 1 (`mountain_pass`): High-speed alpine circuit with sweeping banked corners, elevation climbs/descents, and long straights.
   - Track 2 (`neon_bay_circuit`): Technical coastal/urban circuit with tight hairpins, S-chicanes, and heavy braking zones.

2. `src/track/TrackData.js`:
   - Build `THREE.CatmullRomCurve3(points, true, 'centripetal')` sampled uniformly by arc-length (~500 samples).
   - Build a 2D Spatial Hash Grid (`X, Z`) for `O(1)` `trackData.project(pos)` queries returning `{ u, distance, lateralOffset, onRoad, frame }`.
   - Expose `getFrameAt(u)` (`{ position, tangent, right, up, width, banking, curvature }`), 10 sequential invisible checkpoint planes/gates, and staggered 2×4 starting grid transforms for 8 vehicles.

3. `src/track/TrackBuilder.js`:
   - Generate smooth `BufferGeometry` strips along the spline:
     * Main Asphalt Surface: `1024×1024` procedural `CanvasTexture` with fine aggregate grain, darkened racing-line tire wear, crisp edge lines, matching `roughnessMap`, and maximum GPU `anisotropy`.
     * Elevated-Edge Red/White Curbs: Automatically placed on high-curvature apexes/exits (visual curb height modest and beveled smoothly).
     * Gravel/Grass Run-Off Shoulders flanking the asphalt.
     * Guardrails / Concrete Barriers: Continuous merged barrier rails + `InstancedMesh` support posts.
     * Start/Finish Gantry Arch spanning the start line with a 5-pod countdown light bar.

4. `src/track/TrackPhysics.js`:
   - Generate aligned overlapping `CANNON.Box` road slabs and left/right guardrail walls matching the exact track frames.
   - Include clean `dispose()` removing all bodies from `PhysicsWorld` and disposing Three.js geometries/materials when switching tracks.

5. Update `src/main.js`:
   - Replace the Stage 3 test arena with the live circuit (press `T` to switch between Track 1 and Track 2), spawn the car on the starting grid, and hook `F4` to visualize spline centerlines, checkpoints, and track colliders.
   - Apply realistic off-road surface feedback: when `!projected.onRoad` (driving onto gravel/grass shoulder), reduce tire `frictionSlip` (~70% grip) and increase rolling resistance.

[COMPLETION CRITERIA]
- Driving multiple laps at 250+ km/h across slopes and banked turns produces zero wheel snagging, zero barrier tunneling, and smooth wall-scraping.
- Asphalt grain, racing lines, curbs, and start grid stay crisp at shallow angles with zero Z-fighting.
- Pressing `T` cleanly switches between both tracks with zero leaked physics bodies or GPU memory.
```
