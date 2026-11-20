# Giai đoạn 8: Âm thanh WebAudio, HUD, Minimap & Menu Garage

- **Mục tiêu:** Hoàn thiện trải nghiệm nghe-nhìn-tương tác: bộ tổng hợp âm thanh động cơ 6 cấp số, tiếng xe AI vượt 2 bên tai, HUD tốc độ + Minimap 2D, Menu Garage 3D tương tác và điều khiển cảm ứng Mobile.
- **Files chính:** `src/audio/SoundEngine.js`, `src/ui/HudController.js`, `src/ui/MenuSystem.js`, cập nhật `src/main.js` & `index.html`.

## Tự vấn quy trình & Cân nhắc lựa chọn
- **An toàn `AudioContext` trên trình duyệt:** Chỉ khởi tạo/kích hoạt âm thanh sau lần click/nhấn phím đầu tiên của người chơi để không bị trình duyệt chặn im lặng hoặc báo lỗi console.
- **Menu Garage sống động trên nền 3D thật:** Thay vì làm menu bảng tĩnh nhàm chán, dùng ngay sân 3D có ánh sáng và bầu trời của theme đã chọn để người chơi xoay chuột ngắm trực tiếp chiếc xe và đổi màu sơn trước khi vào cuộc đua.

## Prompt Copy-Paste (English)

```text
START STAGE 8 — PROCEDURAL WEBAUDIO SYNTHESIS, HUD/MINIMAP & INTERACTIVE 3D GARAGE MENU

[ANTI-BUG SELF-CHECK]
Verify Rule #10 and Browser Audio/Input Safety before writing code:
- Browser Autoplay Policy: Lazily create/resume `AudioContext` strictly inside the first user `pointerdown`/`keydown` gesture, support instant Mute (`M`), ramp gains smoothly (never snap abruptly to avoid speaker pops), and clean up oscillator nodes in `dispose()`.
- Non-Blocking HUD Layer: Root HUD overlays must use `pointer-events: none` (applying `pointer-events: auto` strictly to clickable buttons/sliders) so mouse dragging for Garage 3D inspection is never blocked.

[STAGE 8 DELIVERABLES]
1. `src/audio/SoundEngine.js` (100% Web Audio API, zero external files):
   - Multi-Oscillator Engine Synth: combine Sawtooth + Triangle + Sub-bass oscillators through a dynamic `BiquadFilter` (lowpass) and subtle `WaveShaper` saturation; modulate pitch and cutoff from simulated 6-speed `rpmNormalized` and `throttle`, adding crisp gear-shift dips and subtle turbo blow-off flutter on high-RPM lift-off!
   - Tire Screech Synth: filtered white noise (`Bandpass` ~900–1400 Hz) modulated smoothly by active drift slip intensity.
   - High-Speed Wind Rush: lowpass noise swelling smoothly above 100 km/h.
   - Impact, Nitro & Countdown SFX: synthesized metallic crunch/thud scaled by `impactIntensity`, pressurized nitro roar, and crisp 3-2-1-GO countdown beeps synced to gantry lights.
   - Spatialized AI Engine Audio: compute relative distance & lateral angle of the nearest 2 AI rivals using `StereoPannerNode` and distance attenuation so passing cars whoosh smoothly from left to right ear!

2. `src/ui/HudController.js`:
   - Sleek, uncluttered Racing HUD:
     * Bottom-Right Cluster: large digital speedometer (`km/h`), segmented `RPM` tachometer bar (redline pulse), gear indicator (`N / 1–6 / R`), and `NITRO` gauge.
     * Top-Left Cluster: live Position (`POS 1 / 8`), Lap (`LAP 1 / 3`), current/best lap timers, and compact gap/top-3 leaderboard.
     * Bottom-Left Minimap (`<canvas>`): auto-scaled track outline drawn from `TrackData`, color-coded dots for the 7 AI rivals, and a rotating directional chevron for the player.
     * Center Banners & End Screen: animated `3 - 2 - 1 - GO!`, `FINAL LAP!`, `NEW BEST LAP!`, flashing `WRONG WAY!`, plus full 8-car Results Modal (positions, lap/total times, `Race Again` and `Back to Garage` buttons).

3. `src/ui/MenuSystem.js`:
   - Live 3D Interactive Garage Menu: showcase the currently selected car directly in the live 3D scene with orbit drag rotation and instant visual updates:
     * Select 1 of 4 Cars (displaying Speed / Acceleration / Handling & Weight rating bars) + 8-swatch Paint Color Picker.
     * Select Track (`Mountain Pass` / `Neon Bay`), Visual Theme (`Alpine Sunset` / `Canyon Daylight` / `Neon Metropolis`), Weather (`Clear` / `Rainy`), AI Difficulty (`Easy` / `Medium` / `Hard`), and Graphics Quality (`Medium` / `High` / `Ultra`).
   - Pause Menu (`Esc`): freezes both `PhysicsWorld` and `SoundEngine`, offering Volume slider, Quality toggle, Restart, and Exit to Garage.
   - Mobile Multi-Touch Controls: auto-enabled on coarse-pointer touch screens (with manual HUD toggle for testing), supporting simultaneous multi-touch steering + throttle/brake/drift buttons.

4. Update `src/main.js`, `index.html`, and `src/styles/main.css` to tie the complete game loop together seamlessly.

[COMPLETION CRITERIA]
- Complete player flow works seamlessly: 3D Garage -> Start Race -> Gantry Countdown + Beeps -> 3-Lap Race with spatial AI audio -> Results Screen -> Garage / Restart repeated multiple times without errors.
- Sound synthesis matches RPM gear shifts, drifting, impacts, and mute toggling with zero audio clicks or console warnings.
```
