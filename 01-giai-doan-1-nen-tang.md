# Giai đoạn 1: Nền tảng, Vòng lặp Vật lý 120Hz & Công cụ Debug

- **Mục tiêu:** Dựng bộ khung Vite chạy sạch, khóa bước vật lý cố định `1/120`s, chuẩn hóa Input + Gamepad và công cụ Debug (`F3`).
- **Files chính:** `package.json`, `index.html`, `src/styles/main.css`, `src/config/constants.js`, `src/core/RendererContext.js`, `src/core/InputManager.js`, `src/ui/DebugOverlay.js`, `src/main.js`.

## Tự vấn quy trình & Cân nhắc lựa chọn
- **Tại sao dùng bước vật lý `1/120`s thay vì `1/60`s?** Với xe chạy trên 220 km/h (~61 m/s), ở 60Hz mỗi bước vật lý xe dịch chuyển hơn 1 mét — rất dễ xuyên lan can hoặc bỏ lỡ tiếp xúc raycast. Chạy `1/120`s (mỗi bước ~0.5m) kết hợp tường dày `>= 1.2m` giúp triệt tiêu hiện tượng xuyên tường.
- **Tại sao cần `AxesHelper` ngay Giai đoạn 1?** Để nhìn thấy ngay bằng mắt trục `+Z` (mũi xe), `+Y` (hướng lên) và `+X` (bên trái xe), ngăn ngừa lỗi ngược chiều lái xuyên suốt dự án.

## Prompt Copy-Paste (English)

```text
START STAGE 1 — PROJECT FOUNDATION, 120HZ FIXED PHYSICS LOOP & DEBUG OVERLAY

[ANTI-BUG SELF-CHECK]
Briefly verify before writing code:
- Rule #5: Fixed Timestep `1/120`s (`maxSubSteps = 4`), clamping `frameDt <= 0.05s` to prevent tunneling after tab stalls.
- Rule #7: `renderer.toneMapping = THREE.ACESFilmicToneMapping`, `renderer.outputColorSpace = THREE.SRGBColorSpace`.
- Coordinate sanity check: `+Z` forward, `+Y` up, `+X` left (`W` accelerates toward `+Z`, `A` turns toward `+X`).

[STAGE 1 DELIVERABLES]
Set up a clean, immediately runnable Vite project (`npm install && npm run dev`):
1. `package.json`: declare `"three": "0.187.0"`, `"cannon-es": "0.20.0"`, and `"vite"` in `devDependencies`.
2. `index.html` & `src/styles/main.css`: full-viewport canvas without scrollbars, crisp UI typography, and overlay container layers ready for Debug and HUD.
3. `src/config/constants.js`:
   - Coordinate constants (`FORWARD_AXIS`, `UP_AXIS`, `LEFT_AXIS`), `PHYSICS_STEP = 1 / 120`, `MAX_SUBSTEPS = 4`.
   - Seeded PRNG `createPRNG(seed)` using `mulberry32`.
   - Base `GAME_CONFIG` object designed to hold vehicle, track, theme, and quality settings in later stages.
4. `src/core/RendererContext.js`:
   - Initialize `THREE.Scene`, `THREE.PerspectiveCamera`, and `THREE.WebGLRenderer` (`antialias: true`, `powerPreference: 'high-performance'`, `pixelRatio = Math.min(window.devicePixelRatio, 2)`, `PCFSoftShadowMap`, `ACESFilmicToneMapping`, `toneMappingExposure = 1.05`, `SRGBColorSpace`).
   - Handle window resize cleanly and implement `dispose()`.
5. `src/core/InputManager.js`:
   - Keyboard (`W/A/S/D`, Arrow keys, `Space` handbrake, `Shift` nitro, `C` cycle camera, `B` look back, `R` reset, `F2/F3/F4` debug toggles) + Gamepad polling.
   - Output normalized `state: { throttle, brake, steer, handbrake, nitro }` plus single-press event callbacks and `clearKeys()` for window blur safety.
6. `src/ui/DebugOverlay.js`:
   - Toggleable via `F3`: displays live FPS, frame time (ms), `renderer.info.render.calls`, triangle count, `memory.geometries`, `memory.textures`, and target `(x, y, z)` coordinates.
7. `src/main.js`:
   - Fixed-timestep accumulator loop with render interpolation.
   - Minimal test scene: 1m×1m grid floor, `AxesHelper(3)` at origin `(0, 0, 0)` confirming `+Z` forward / `+Y` up / `+X` left, basic directional/hemisphere light, and a temporary placeholder box driven by `InputManager` to validate controls and FPS.

[COMPLETION CRITERIA]
- `npm run dev` runs with zero console errors or warnings.
- Pressing `F3` toggles accurate FPS, draw call, triangle, and memory counters.
- Pressing `W` moves the placeholder box along `+Z`; pressing `A` rotates it toward `+X` (left).
```
