# Giai đoạn 6: Camera Đàn hồi, Hệ thống Hạt VFX & Hậu kỳ (`Bloom`)

- **Mục tiêu:** Tăng tối đa cảm giác tốc độ, va chạm nảy tia lửa rực rỡ, khói/vệt lốp khi drift và hậu kỳ `UnrealBloomPass` + `OutputPass` không bị cháy sáng mặt đường ban ngày.
- **Files chính:** `src/camera/CameraRig.js`, `src/vfx/ParticleEffects.js`, `src/graphics/PostProcessingRig.js`, cập nhật `src/main.js`.

## Tự vấn quy trình & Cân nhắc lựa chọn
- **Chống cháy màu khi bật Bloom:** Trong `three@0.187.0`, đặt `OutputPass` cuối cùng trong `EffectComposer` và kéo `UnrealBloomPass.threshold` lên mức `~0.90` giúp mặt đường nắng ban ngày không bị nhòe sáng, chỉ đèn phanh, đèn pha, đèn neon và tia lửa (`emissiveIntensity >= 2.0`) phát sáng đẹp mắt.
- **Zero-Allocation VFX:** Toàn bộ hạt khói, tia lửa, vệt lốp và mưa dùng Object Pool hoặc Ring Buffer cố định để tránh giật hình do trình dọn rác GC.

## Prompt Copy-Paste (English)

```text
START STAGE 6 — SPRING-DAMPED CAMERA RIG, OBJECT-POOLED VFX & BLOOM POST-PROCESSING

[ANTI-BUG SELF-CHECK]
Verify Rules #7 and #10 before writing code:
- Rule #7 (Three.js `0.187.0` Post-Processing): Build `EffectComposer -> RenderPass -> UnrealBloomPass -> OutputPass` (from `three/addons/postprocessing/...`). Set a high `UnrealBloomPass.threshold` (`0.88–0.94`) so sunlit asphalt and clouds stay crisp while high-emissive headlights, brake lights, neon signs, and impact sparks (`emissiveIntensity >= 2.0`) bloom vividly. Place `OutputPass` last so tone mapping and sRGB conversion execute exactly once.
- Rule #10 (Zero-Allocation VFX): Implement fixed Object Pools / Ring Buffers for all particles (tire smoke, dirt dust, collision sparks, exhaust nitro flames, road skidmarks, and rain streaks) — never instantiate meshes or vectors per frame inside `update(dt)`.

[STAGE 6 DELIVERABLES]
1. `src/camera/CameraRig.js`:
   - 4 switchable camera modes (`C` cycles, holding `B` looks backward):
     * `Chase Cam`: Spring-damped follow using frame-rate-independent smoothing (`1 - Math.exp(-k * dt)`), dynamically pulling back and widening `FOV` smoothly during high speed and Nitro boost.
     * `Close Chase`: Lower, tighter rear view for intense speed sensation.
     * `Hood Cam`: Mounted over the hood showing fenders and windshield reflections.
     * `Bumper Cam`: Low track-level perspective.
   - Terrain Collision Clamp: query terrain/track elevation beneath the camera eye and clamp at least `+0.9m` above ground so the camera never clips underground.
   - Camera Trauma Shake triggered proportionally by `PhysicsWorld.onCollision` impact intensity plus subtle high-frequency rumble on gravel shoulders or above 220 km/h.

2. `src/vfx/ParticleEffects.js`:
   - Tire Smoke & Gravel Dust (Object Pool ~300 particles): emitted at rear tire contact patches during drift or off-road driving, expanding and fading cleanly.
   - Persistent Skidmark Ribbons (Ring-buffer Quad Strip): dark rubber marks deposited onto road/slope orientation while drifting/braking hard, offset `+0.018m` vertically above asphalt to guarantee zero Z-fighting.
   - Collision Sparks Pool: triggered by `onCollision` wall-scrapes and car-to-car impacts, launching bright HDR orange/gold sparks with gravity bounce that trigger `UnrealBloomPass`.
   - Nitro Exhaust Flames & Speed Lines: flickering blue-orange exhaust cones when holding `Shift` plus subtle radial peripheral speed streaks.
   - Headlight Beams & Rain Mode: real `SpotLight` mounted on player nose (for dark/rain themes) + soft additive light cones, plus a camera-anchored 3D Rain Streak pool that smoothly lowers asphalt `roughness` for wet specular reflections.

3. `src/graphics/PostProcessingRig.js`:
   - Wrap `EffectComposer`, `RenderPass`, `UnrealBloomPass`, and `OutputPass` with proper `setSize` pixel-ratio handling, clean `dispose()`, and a `setEnabled(bool)` bypass so `Medium` quality can render directly without post-processing overhead.

4. Update `src/main.js`: wire `CameraRig`, `ParticleEffects`, and `PostProcessingRig` into the main loop, binding collision events directly to sparks and camera shake.

[COMPLETION CRITERIA]
- Handbrake drifting produces dense rear tire smoke and clean curved skidmarks across sloped corners with zero Z-fighting.
- Scraping a guardrail or slamming an obstacle emits glowing Bloom sparks and crisp camera shake.
- Daylight asphalt remains sharp and unwashed while brake lights and sparks glow richly.
```
