# Giai đoạn 5: Thế giới 3D & Thiên nhiên Chi tiết Từng chiếc lá, Cái cây

- **Mục tiêu:** Dựng địa hình Spatial-Hash, 3 Theme bối cảnh, hệ thống cây xanh phân nhánh thật + tán lá từng chiếc lá alpha-cutout đung đưa theo gió và đổ bóng loang lổ xuống đường (`customDepthMaterial`), cùng thảm cỏ 3D và công trình ven đường.
- **Files chính:** `src/world/ThemeCatalog.js`, `src/world/BotanicalFactory.js`, `src/world/TerrainBuilder.js`, `src/world/SceneryBuilder.js`, `src/world/LightingRig.js`, cập nhật `src/main.js`.

## Tự vấn quy trình & Cân nhắc lựa chọn
- **Làm sao thấy "từng chiếc lá, cái cây" đẹp mà không nặng?** Thay vì ghép 1 khối cầu/nón đơn điệu hoặc tốn hàng triệu tam giác 3D cho từng chiếc lá riêng, giải pháp chuẩn của game AAA là: thân & cành cây dựng bằng `TubeGeometry` phân nhánh có vỏ sần, tán lá gồm nhiều mặt phẳng cong giao nhau mang `CanvasTexture` 512×512 vẽ từng chiếc lá có gân lá, răng cưa và nền trong suốt (`alphaTest: 0.45`).
- **Bí quyết đổ bóng lá thật (`customDepthMaterial`):** Nếu không gán `customDepthMaterial` mang `alphaTest: 0.45` và cùng wind shader, bóng cây dưới đất sẽ biến thành mảng hình vuông cứng nhắc! Gắn đồng bộ giúp bóng nắng từng chiếc lá rọi xuống nắp capo xe rung rinh theo gió.

## Prompt Copy-Paste (English)

```text
START STAGE 5 — LUSH PROCEDURAL WORLD ("EVERY LEAF & TREE") & 3 VISUAL THEMES

[ANTI-BUG SELF-CHECK]
Verify Rules #7, #8, and #10 before writing code:
- Rule #8 (Detailed Botanical Trees, Individual Leaves & True Leaf Shadows):
  1. NEVER represent trees as crude solid cones or spheres. Construct branching trunks and primary limbs using tapered `TubeGeometry` along `CatmullRomCurve3` curves with procedural furrowed bark `CanvasTexture` + `bumpMap`.
  2. Render foliage canopies using clusters of multi-angle curved leaf cards textured with a high-resolution `512×512` `CanvasTexture` drawing dozens of individual serrated, veined leaves (with stem and subtle color variation) on a transparent background (`alphaTest: 0.45`, `DoubleSide`, `vertexColors` for inner ambient occlusion vs sunlit outer tips).
  3. Inject a vertex wind-sway shader via `onBeforeCompile` (using a vertex `windFactor` attribute and `uTime` uniform plus `customProgramCacheKey`) so leaves and roadside grass blades sway organically in the wind.
  4. MANDATORY: Assign a matching `customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTexture, alphaTest: 0.45 })` injecting the EXACT SAME vertex wind shader to the foliage `InstancedMesh` so sunlight casts crisp, swaying, individual leaf shadows onto the asphalt and car hood instead of solid squares!
  5. Use `TrackData.project()` (2D Spatial Hash) to enforce a strict Track Exclusion Zone (`distance >= trackHalfWidth + shoulderWidth + 6m`) so zero trunks, branches, rocks, or grass tufts ever protrude onto the road.
- Rule #8 (Shadow Texel Snapping): Snap the `DirectionalLight` shadow frustum to texel increments as it follows the car so leaf shadows on the road never shimmer.

[STAGE 5 DELIVERABLES]
1. `src/world/ThemeCatalog.js`:
   Define 3 complete, atmospheric themes controlling sky colors, sun/moon angle & intensity, fog density/color, terrain palette, flora mix, and streetlights:
   - `alpine_sunset`: Warm golden-purple sunset sky, low-angle directional sunlight, layered pine trees + broad-leaf maples (green/amber/gold foliage), mossy boulders, wildflower grass tufts, distant snow-capped mountain ring.
   - `canyon_daylight`: Crisp cobalt sky, layered red-rock desert terrain, branched Saguaro cacti, desert scrub, swaying oasis palm trees with feather-cut individual frond leaflets, optional shimmering oasis lake.
   - `neon_metropolis`: Starry midnight sky, slightly damp reflective asphalt, urban boulevard trees lit by warm/cyan streetlights, multi-story low-poly buildings with procedural lit window grids & emissive neon billboards, overhead gantries.

2. `src/world/BotanicalFactory.js`:
   Generate reusable high-detail geometries & instancing materials:
   - Broadleaf Tree (Oak/Maple): flared root trunk + 4–5 curved limbs (`TubeGeometry`) + 20–28 intersecting curved leaf-card planes (`alphaTest: 0.45`) forming an airy canopy where sunlight filters between individual leaves.
   - Pine Tree: textured bark trunk + tiered radiating boughs carrying alpha-cutout pine needle clusters.
   - Palm / Desert Flora: curved segmented trunk + arched fronds with individual leaflet cutouts swaying in wind.
   - Roadside Grass & Wildflowers: curved tapered grass blade clusters along road shoulders swaying smoothly in the wind.
   - Export `applyWindShader(material, depthMaterial, uTimeRef, swayStrength)` helper so visible geometry and shadow depth pass stay 100% synchronized.

3. `src/world/TerrainBuilder.js`:
   - High-resolution terrain grid (`~220×220` segments) sculpted with seeded fBm noise (`mulberry32`), smoothly flattened and tucked slightly beneath the road corridor using `TrackData.project()` + `smoothstep` so terrain never pokes through sloped/banked asphalt.
   - Slope-and-altitude vertex coloring + procedural detail texture (grass -> dirt -> cliff rock/sand) plus distant silhouette mountain ranges blending into horizon fog.

4. `src/world/SceneryBuilder.js`:
   - Sky Dome (`ShaderMaterial` zenith-to-horizon gradient + sun/moon glow halo + night stars + drifting billboard clouds) paired with matching `FogExp2`.
   - Purposeful trackside landmarks: multi-tier grandstands with colorful spectators, automatic Chevron turn warning signs placed dynamically wherever `curvature` exceeds threshold, canvas sponsor billboards, streetlights, angular rocks, and optional water plane.
   - Render trees (separate `InstancedMesh` for trunks/limbs vs alpha-tested foliage), grass, rocks, and poles via `InstancedMesh`, and re-bake `EnvironmentFactory` IBL cubemap whenever the theme changes so car paint reflections match the sky!

5. `src/world/LightingRig.js` & Update `src/main.js`:
   - `DirectionalLight` (`2048×2048` shadow map, `70m×70m` follow-frustum with texel snapping) + `HemisphereLight`.
   - Press `G` in `src/main.js` to cycle cleanly through all 3 themes, verifying `dispose()` cleanup and `F3` draw call budget.

[COMPLETION CRITERIA]
- Park under a roadside tree: clearly see branched bark limbs, distinct serrated/veined leaf cards swaying in the breeze, and dappled individual-leaf shadows cast across the car hood and asphalt.
- Clear 3-layer spatial depth (roadside grass/trees -> rolling hills -> distant foggy mountains) with zero objects intersecting the road.
- Cycling themes via `G` updates sky, fog, lighting, foliage, and car reflections cleanly with zero memory leaks.
```
