# Apex Rush: Ultimate

> **Live Playable Demo:** https://apex-rush-ultimate-3d.netlify.app

A 100% procedural 3D browser racing game built with **Three.js (`0.187.0`)**, **cannon-es (`0.20.0`)**, and **Vite ES Modules** — designed as an accessible, zero-download **"Horizon-lite" racing experience** for mainstream and mid-range laptops. Every vehicle, interior, branching tree, serrated leaf card, circuit ribbon, sky dome, and Web Audio synthesizer sound is generated strictly in code with zero external media downloads.

---

## Roadmap (Next Engineering Milestones)

1. **Realtime Multiplayer Room & State Sync (WebSocket + Snapshot Interpolation):** Room code lobby (up to 8 players matching `RACER_COUNT`), synced `GARAGE -> COUNTDOWN -> RACING -> FINISHED` state machine in `src/gameplay/RaceManager.js`, 20Hz state snapshots from `src/physics/VehiclePhysics.js`, and 100ms interpolation buffer for remote vehicles.
2. **Automated 3-Preset Performance Benchmark:** Headless Playwright benchmark covering `medium`, `high`, and `ultra` presets in `src/core/QualityManager.js` (P95 frame time, draw calls, GPU memory, and 35 FPS Watchdog verification) to keep gameplay smooth on integrated GPUs and mid-range laptops.

---

## Setup & Scripts

```bash
npm install
npm run dev      # Start Vite development server
npm run build    # Production bundle in dist/
npm run preview  # Preview production build
```

---

## Controls

### Keyboard
| Key | Action |
| :--- | :--- |
| `W` / `ArrowUp` | Throttle (+Z forward) |
| `S` / `ArrowDown` | Brake / Reverse |
| `A` / `ArrowLeft` | Steer Left (+X) |
| `D` / `ArrowRight` | Steer Right (-X) |
| `Space` | Handbrake Drift |
| `Shift` | Nitro Boost |
| `C` | Cycle Camera (`Chase`, `Close Chase`, `Hood`, `Bumper`) |
| `B` | Look Back |
| `R` | Reset Car onto Track |
| `M` | Mute / Unmute Audio |
| `Esc` | Pause / Resume Race |

### Gamepad & Touch
- **Gamepad:** Left Stick steering, Right Trigger (`RT`) throttle, Left Trigger (`LT`) brake, `A`/`X` handbrake, `B`/`RB` nitro, `Y` look back, `LB` cycle camera, `Start` pause.
- **Mobile / Touch:** Automatically enabled on coarse-pointer screens (also toggleable via Pause Menu -> *Touch Controls*) with multi-touch steering + Gas / Brake / Drift / Nitro controls.

### Debug & Tuning Hotkeys
| Hotkey | Tool |
| :--- | :--- |
| `F2` | Live Physics Tuning Panel (suspension stiffness, compression/rebound damping, tire grip, downforce, engine force) |
| `F3` | Performance & GPU Memory Stats (FPS, frame time ms, draw calls, triangles, geometries, textures, XYZ position, km/h) |
| `F4` | Physics Colliders, Suspension Raycasts, Spline Centerline & Checkpoints Wireframe |

---

## Architecture Overview

- `src/config/constants.js` — Unified Coordinate Contract (`+Y` up, `+Z` forward, `+X` left), `1/120`s fixed timestep, seeded `mulberry32` PRNG, and `GAME_CONFIG`.
- `src/core/` — `RendererContext`, `InputManager`, `QualityManager` (`Medium / High / Ultra` + 35 FPS Watchdog).
- `src/car/` — `CarCatalog` (4 distinct cars), `CarMaterials`, `WheelBuilder` (`root -> steerGroup -> spinGroup`), `CarModelBuilder` (16-station lofting, recessed wheel wells, interior through reflective glass).
- `src/physics/` — `PhysicsWorld` (`SAPBroadphase`, `-14 m/s²` gravity, wall-scrape `ContactMaterial`), `VehiclePhysics` (`RaycastVehicle`, 6-speed gearbox, drift slip, downforce), `PhysicsDebugRenderer`.
- `src/track/` — `TrackCatalog`, `TrackData` (World-Up + curvature banking, 2D Spatial Hash `O(1)` `project()`, 10 checkpoints, 2×4 grid), `TrackBuilder` (1024px asphalt, curbs, barriers, gantry), `TrackPhysics` (overlapping thick `CANNON.Box` slabs).
- `src/world/` — `ThemeCatalog` (3 themes), `BotanicalFactory` (branching `TubeGeometry` trunks/limbs, 512px leaf cards, synchronized wind shader + `customDepthMaterial`), `TerrainBuilder`, `SceneryBuilder`, `LightingRig` (light-space texel-snapped shadows).
- `src/camera/`, `src/vfx/`, `src/graphics/` — `CameraRig`, `ParticleEffects` (object-pooled smoke, sparks, +0.018m skidmarks, nitro flames, speed lines, rain), `EnvironmentFactory` (`PMREMGenerator`), `PostProcessingRig` (`EffectComposer -> RenderPass -> UnrealBloomPass -> OutputPass`).
- `src/ai/`, `src/gameplay/` — `AiDriver` (Pure Pursuit, curvature braking, dynamic overtaking, 2.5s auto-unstuck), `RaceManager` (`GARAGE -> COUNTDOWN -> RACING -> FINISHED`, `localStorage` best laps).
- `src/audio/`, `src/ui/` — `SoundEngine` (Web Audio 6-speed synth + stereo spatial AI audio), `HudController` (HUD, 2D minimap, results modal), `MenuSystem`, `DebugOverlay`, `TuningPanel`.

---

## 8-Point QA Acceptance Checklist (`4 Cars × 2 Tracks × 3 Themes`)

1. **Garage Showcase & Silhouettes (`4 Cars`):** Verify `Apex RS Coupe`, `Vanguard V8`, `Terra WRC Hatch`, and `Valkyrie GT-X` show distinct silhouettes, visible interior seats/wheel through glass, stationary calipers, glossy clearcoat reflections, and zero wheel-to-fender clipping at ±32° steering.
2. **Circuits & Anti-Snag Physics (`2 Tracks`):** Drive multiple laps at high speed on both `Alpine Ridge Pass` and `Neon Bay Circuit`; verify zero wheel snagging on slopes/banked turns, smooth wall-scraping along barriers, and reduced grip on gravel shoulders.
3. **Themes & Leaf Shadows (`3 Themes`):** Test `Alpine Sunset`, `Canyon Daylight`, and `Neon Metropolis` + `Clear / Rainy` weather; verify branching trees, swaying individual leaves, dappled swaying leaf shadows (`customDepthMaterial`), texel-snapped shadows, and matching clearcoat sky reflections.
4. **Camera, VFX & Bloom:** Cycle all 4 camera modes (`C`) + look-back (`B`); confirm drifting creates tire smoke and curved +0.018m skidmarks without Z-fighting, impacts emit glowing Bloom sparks + camera shake, and daylight asphalt remains crisp.
5. **AI & Race Flow:** Complete a full 3-lap race against all 7 real-physics AI opponents; confirm countdown lights/beeps, AI corner braking, overtaking, car-to-car impacts, 10-checkpoint anti-shortcut validation, and results modal.
6. **Web Audio Synthesis:** Confirm engine pitch/gear shifts, turbo blow-off flutter, drift screech, wind rush, impact crunch, spatial AI left/right panning, and instant Mute (`M`).
7. **Quality & Lifecycle Hardening:** Test `Medium / High / Ultra` presets, alt-tab/window blur (`clearKeys()` + auto-pause), and verify zero GPU geometry/texture leaks in `F3` across 5 consecutive `Garage <-> Track <-> Theme` switches.
8. **Production Build:** Confirm `npm run build` completes with zero bundler errors or broken imports.

---

## Prompt Guide Reference (`00`–`10`)

The original Vietnamese/English stage-by-stage prompt specifications used to construct this repository are preserved in files [`00-prompt-nen.md`](./00-prompt-nen.md) through [`10-prompt-sua-loi-va-tinh-chinh.md`](./10-prompt-sua-loi-va-tinh-chinh.md).
