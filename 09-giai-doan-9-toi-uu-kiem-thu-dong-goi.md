# Giai đoạn 9: Kiểm thử Stress-Test, Tối ưu Sâu & Đóng gói Cuối

- **Mục tiêu:** Đảm bảo không rò rỉ bộ nhớ GPU qua nhiều ván chơi, ổn định FPS nhờ `QualityManager` + FPS Watchdog, xử lý chuyển tab an toàn và đóng gói `npm run build`.
- **Files chính:** `src/core/QualityManager.js`, `README.md`, rà soát toàn bộ `src/`.

## Tự vấn quy trình & Cân nhắc lựa chọn
- **Rò rỉ bộ nhớ khi chơi lại hoặc đổi đường đua:** Trong Three.js, xóa mesh khỏi `scene` không giải phóng VRAM! Phải chắc chắn mọi geometry, material, texture và `RenderTarget` của đường đua/theme/xe cũ đều được `.dispose()` dứt điểm mỗi lần quay lại Garage hoặc đổi bản đồ.
- **Chống kẹt phím khi chuyển tab:** Nếu người chơi giữ phím `W` rồi chuyển sang cửa sổ khác (`window.blur`), sự kiện `keyup` không kích hoạt, khiến xe tự ga mãi khi quay lại. Cần xóa sạch trạng thái phím (`clearKeys()`) và tự Pause khi mất focus hoặc ẩn tab.

## Prompt Copy-Paste (English)

```text
START STAGE 9 — STRESS-TESTING, DEEP OPTIMIZATION & PRODUCTION PACKAGING

[ANTI-BUG SELF-CHECK]
Audit the entire codebase against all 10 Anti-Bug Rules before finalizing:
1. GPU Memory Leak Audit: Inspect `renderer.info.memory.geometries` and `renderer.info.memory.textures` via `F3` across 5 consecutive switches between Garage <-> Mountain Pass <-> Neon Bay <-> all 3 Themes. Counts MUST stabilize cleanly instead of climbing unboundedly.
2. Draw Call & Foliage Audit: Verify via `F3` that trees, branched limbs, alpha-tested leaf cards, grass tufts, boulders, and track posts are instanced cleanly so full scenes stay well-optimized despite rich botanical detail.
3. Zero Per-Frame Allocation Audit: Scan every `update(dt)` / physics step / render function across `src/` and eliminate any accidental `new THREE.*` or `new CANNON.*` allocations inside hot loops.

[STAGE 9 DELIVERABLES]
1. `src/core/QualityManager.js`:
   - Implement 3 meaningful Quality Presets (`Medium`, `High`, `Ultra`):
     * `Medium`: `pixelRatio <= 1.25`, bypass `PostProcessingRig` (render directly), `1024×1024` shadow map, reduce roadside grass density by 40%.
     * `High`: `pixelRatio <= 1.5`, full `UnrealBloomPass + OutputPass`, `2048×2048` shadow map, full foliage & individual leaf shadows.
     * `Ultra`: `pixelRatio <= 2.0`, `2048×2048` / `4096×4096` crisp shadows, maximum grass density, particle counts, and rain streaks.
   - Integrate an FPS Watchdog: if average FPS drops below `35 FPS` for more than `4` consecutive seconds on `Ultra`, display a non-intrusive toast offering one-click downgrade (or auto-step down if enabled) to preserve smooth 60 FPS driving.

2. Browser Lifecycle & Edge-Case Hardening:
   - Auto-pause race, mute audio temporarily, and clamp physics accumulator on `document.visibilitychange` (tab hidden) and `window.blur`.
   - Call `inputManager.clearKeys()` on `window.blur` so held throttle/steer keys never stick when alt-tabbing.
   - Consolidate any stray magic numbers back into `src/config/constants.js`, `CarCatalog.js`, and `TrackCatalog.js`.

3. Project `README.md`:
   - Document setup (`npm install`, `npm run dev`, `npm run build`), full keyboard/gamepad controls, Debug hotkeys (`F2` Physics Tuning, `F3` Performance/Memory Stats, `F4` Colliders & Spline), and a final 8-point QA Acceptance Checklist covering all `4 Cars × 2 Tracks × 3 Themes`.

[COMPLETION CRITERIA]
- `npm run build` succeeds cleanly with zero bundler errors or broken imports.
- Playing multiple consecutive races across every car, track, and theme produces zero console errors, flat GPU memory usage, smooth real-physics collisions, and crisp visuals from metallic car paint down to individual swaying leaves.
```
