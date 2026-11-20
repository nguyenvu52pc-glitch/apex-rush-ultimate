# Giai đoạn 2: Tạo hình 4 Mẫu Xe Cao cấp & Showroom

- **Mục tiêu:** Dựng 4 mẫu xe có hình dáng thể thao rõ nét, vòm bánh lõm thực sự chống xuyên lốp, có nội thất qua kính, đĩa/kẹp phanh chi tiết và sơn bóng phản chiếu `PMREMGenerator`.
- **Files chính:** `src/car/CarCatalog.js`, `src/graphics/EnvironmentFactory.js`, `src/car/CarMaterials.js`, `src/car/WheelBuilder.js`, `src/car/CarModelBuilder.js`, cập nhật `src/main.js`.

## Tự vấn quy trình & Cân nhắc lựa chọn
- **Lofting 16 mặt cắt ngang kết hợp lõm hốc bánh:** Lofting tạo đường cong nắp capo, vai xe và đuôi xe đẹp hơn nhiều so với khối hộp, nhưng nếu không bóp hẹp phần thân dưới tại vị trí 4 bánh xe và đặt hốc bánh tối màu bên trong, bánh trước khi đánh lái ±32° sẽ cắt xuyên ra ngoài vỏ xe.
- **Nội thất xuyên kính:** Kính đen đặc trông giả tạo; kính bán trong suốt (`opacity ~0.36`, `clearcoat: 1.0`) cho phép thấy mờ 2 ghế đua, vô lăng và khung chống lật bên trong dưới lớp phản chiếu bầu trời.

## Prompt Copy-Paste (English)

```text
START STAGE 2 — HIGH-DETAIL PROCEDURAL CAR MODELING (4 SILHOUETTES) & SHOWROOM

[ANTI-BUG SELF-CHECK]
Verify Rules #1, #2, #7, and #10 before writing code:
- Rule #1 (Wheel Arch Clearance): When lofting 16 longitudinal cross-sections along Z (from rear `-L/2` to nose `+L/2`), stations overlapping front and rear axles MUST recess the lower side profile inward and mount dark `innerWheelWell` tubs plus sculpted outer fender flares. Explicitly verify clearance math so `archRadius >= wheelRadius + maxSuspensionTravel + 0.06m` and steering ±32° never clips bodywork.
- Rule #2 (Wheel Pivot Hierarchy): Construct each wheel as `root -> steerGroup (Y-rotation only) -> spinGroup (X-rotation only)`. Attach the brake caliper to `steerGroup` so it stays stationary while the perforated brake rotor and `LatheGeometry` tire spin inside `spinGroup` centered strictly at `(0, 0, 0)`.
- Rule #7 (Color Space): Set `colorSpace = THREE.SRGBColorSpace` on all color `CanvasTexture`s (tire tread/sidewall logos, honeycomb grille, license plate, dashboard gauges).

[STAGE 2 DELIVERABLES]
1. `src/car/CarCatalog.js`:
   Define full geometry and physics specs (ready for Stage 3) for 4 cars with unmistakable silhouettes:
   - `street_sprint`: Balanced sport coupe, fastback roofline, subtle lip/pedestal spoiler.
   - `muscle_v8`: Long, heavy muscle car, wide flat hood with raised intake scoop, squared rear deck, chrome bumper accents.
   - `rally_hatch`: Raised-clearance rally hatchback, aggressive wide fender flares, chunky deep-tread tires, roof/bumper rally pod lights, dual-plane rally wing.
   - `hyper_gt`: Ultra-low exotic hypercar, sharp front carbon splitter, deep side air intakes, teardrop cockpit canopy, large swan-neck GT rear wing.

2. `src/graphics/EnvironmentFactory.js`:
   - Use `THREE.PMREMGenerator` to bake a procedural studio/outdoor sky environment scene (gradient sky dome, bright horizon band, overhead studio light strips, warm sun highlight) into `scene.environment` so metallic `clearcoat` paint and chrome wheels reflect realistic crisp highlights offline.

3. `src/car/CarMaterials.js`:
   - 2-Layer Metallic Car Paint: `MeshPhysicalMaterial` (`clearcoat: 1.0`, `clearcoatRoughness: 0.05`, `metalness: 0.65`, `roughness: 0.24`, plus a procedural `256×256` micro-flake `roughnessMap`).
   - Semi-Transparent Reflective Glass: `MeshPhysicalMaterial` (`transparent: true`, `opacity: 0.36`, `roughness: 0.04`, `clearcoat: 1.0`, `envMapIntensity: 1.8`) allowing the interior cockpit to remain visible beneath sky reflections.
   - Matte carbon fiber (splitter, diffuser, wheel wells), brushed/chrome alloy rims, rubber tires with procedural tread + sidewall `CanvasTexture` and `bumpMap`, machined slotted/drilled brake rotors, colored brake calipers, and `emissive` LED headlights & full-width taillights.

4. `src/car/WheelBuilder.js`:
   - Build `createWheelMesh({ radius, width, isFront, isLeft, style })` returning `{ root, steerGroup, spinGroup }` with `LatheGeometry` curved tire profile, multi-spoke alloy rim matching car archetype, spinning drilled brake rotor, and stationary caliper.

5. `src/car/CarModelBuilder.js`:
   - Loft 16 longitudinal cross-sections into smooth `BufferGeometry` (`computeVertexNormals()`) with crisp shoulder lines, recessed wheel arches, separate lower chassis/splitter/diffuser, and sculpted cabin greenhouse with angled A/C pillars.
   - Build a visible Partial Interior inside the cabin: dual racing bucket seats, steering wheel, roll-cage bars (for Rally/Hyper), and subtly glowing dashboard instrument cluster.
   - Add exterior trim: honeycomb grille (`CanvasTexture`), sculpted LED headlights, LED taillight bar, side mirrors, windshield wipers, dual/quad exhaust pipes with dark inner tips, rear wing, and license plate ("APEX-01").
   - Expose clean API: `{ root, wheels, setPaint(hex), setBrakeLights(active), setHeadlights(active), steerWheels(rad), spinWheels(rad), dispose() }`.

6. `src/main.js` (Stage 2 Interactive Showroom):
   - Dark showroom floor with subtle reflection and 3-point lighting (`Key`, `Fill`, `Rim`).
   - `OrbitControls` (from `three/addons/controls/OrbitControls.js`) for full 360° close-up inspection.
   - Keys `1–4` switch between the 4 cars (verifying `dispose()` cleans GPU memory via `F3`), `P` cycles paint colors, holding `S` tests brake lights, and `A/D` steers front wheels ±32° to inspect wheel arch clearance.

[COMPLETION CRITERIA]
- Every car looks distinct in silhouette, with visible interior seats/wheel through the glass, realistic treaded tires, stationary calipers, and glossy environment reflections on curved panels.
- Zero wheel-to-fender clipping at full ±32° steering lock and zero Z-fighting anywhere on body panels.
- Switching between `1–4` does not leak `geometries` or `textures` in the `F3` overlay.
```
