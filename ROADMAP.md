# Projector Output Roadmap

Goal: drive 3 projectors mounted around the hexayurt perimeter so the simulated caustics land
correctly on the real roof panels.

Scope of this document: everything up to **calibrated projector output**. Show hardening
(autostart, watchdog, unattended running) is deliberately out of scope for now.

---

## 0. Physical parameters — DONE

Ideal measurements, to be re-measured once the structure is built. Authored in
`public/config/projection.json` (metres, real-world apex-up frame, eave plane at `z = 0`) and
resolved into sim units by `projection.js`.

| Parameter | Sim units | Real world |
|---|---|---|
| `ROOF_RADIUS` | `1` | `2.4 m` |
| `ROOF_APEX_HEIGHT` | `0.5` | `1.2 m` |
| Wall height (eave above floor) | — | `1.2 m` |
| Projector mount height | — | `1.1 m` (0.1 m below eave) |
| Projector mount radius | `0.933` | `2.24 m` |
| Throw ratio | — | `0.8 : 1` |

Scale factor is derived, not hardcoded: `metersPerUnit = venue.roofRadius / ROOF_RADIUS = 2.4`.
Updating the JSON is enough to re-scale everything.

### Hexagon reference frame

Corners at angle `60° × i`, radius `R`, eave plane at `z = 0`:

```
corner0 = ( R,      0     )      corner3 = (-R,      0     )
corner1 = ( R/2,  R√3/2   )      corner4 = (-R/2, -R√3/2   )
corner2 = (-R/2,  R√3/2   )      corner5 = ( R/2, -R√3/2   )
```

Panel `i` = triangle (corner `i`, corner `i+1`, apex), spanning angles `60i` to `60(i+1)`.

---

## 1. Projector placement — DONE

**Chosen: 3 projectors, corner mounting, alternating corners (0, 2, 4).**

Reasons, in order of importance:

1. **Seams land on creases.** A projector at corner `i` sits on the long diagonal through the
   hexagon centre, so its natural coverage region is symmetric about that diagonal and spans
   exactly two panels on the far side. Three projectors at corners 0 / 2 / 4 partition the roof
   as `{2,3}`, `{4,5}`, `{0,1}` — every seam falls on a crease, where the geometry already breaks
   up the image and hides residual misalignment and blend banding.

   Wall-centre mounting does the opposite: the coverage region centres on the *middle* of the
   opposite panel, putting seams in the middle of flat panels where they are most visible.

2. **Sturdier mounting** — the corner posts are already planned.

3. **Longer throw** (`2R` = 4.8 m corner-to-corner vs `R√3` = 4.16 m wall-to-wall), so a larger
   image from a fixed-lens projector.

4. **Beam stays above head height.** Mounted just below the eave and projecting up/across, the
   beam never drops below eave height, so people standing inside will not cast shadows. True for
   either mounting option.

Both mount styles are implemented as presets (`corner-0..5`, `wall-0..5`) so they can still be
compared in situ by editing the config.

### Coverage — confirmed OK at 0.8:1

From a corner, the two opposite panels subtend roughly **60° horizontally** (half-angle
`atan((R√3/2) / (3R/2))` = 30°) and **~28° vertically** (eave ~1°, apex ~28° elevation).

At a throw ratio of 0.8:1 with a 16:9 image, each projector delivers:

- horizontal `2·atan(0.5 / 0.8)` = **64°**
- vertical `2·atan(1 / (2 · 0.8 · 16/9))` = **38.7°**

Both exceed what's needed, so 3 projectors at alternating corners cover the full roof with a
little margin. (Verified in the console output of the resolved config.)

If real-world measurement later shows the margin is too thin, the fallback is 6 projectors — one
per corner, each covering the *single* opposite panel at only ~30° horizontally, still with every
seam on a crease. The config array makes that a data edit, not a code change.

### Projector-specific notes (HY310)

- **Disable auto-keystone and autofocus.** They will fight the calibration, and digital keystone
  resamples/crops the image. We want native 1:1 output with all warping done in our render.
- Confirm the HDMI input accepts the native resolution and presents as a normal display.
- RTX 5070 output count (typically 3×DP + 1×HDMI) is fine for 3; check before going to 6.

---

## Implementation so far

- `public/config/projection.json` — venue dimensions, defaults, and the projector array. Each
  projector carries an `adjust` block (`offset` / `rotation` / `lensShift` / `fovScale`) that
  layers on top of the derived mount preset, so correcting a measurement never discards tuning.
- `projection.js` — `loadProjectionConfig()`, `resolveProjectors()` (mount preset → `THREE`
  camera in sim units, including off-axis lens shift via the projection-matrix skew terms), and
  `projectorFovDegrees()` for sanity-checking coverage.
- `index.js` — loads the config alongside the other startup promises and logs the resolved poses.
  The cameras are built but not yet rendered from; that's the next phase.

---

## 2. Reconciling the mirrored sim frame — DONE, no sim changes needed

In the sim the roof is mirrored (`roofGeometry.scale(1, 1, -1)`) so it hangs *below* the water as a
downward pyramid. The real roof points *up*.

The naive fix — reflecting the camera across `z` — does not work, because a reflection is
**orientation-reversing**. Three.js builds a camera basis from `(position, target, up)` using a
fixed right-handed convention (`right = forward × up`), so feeding it mirrored inputs yields
`right = −(mirrored right)` and a horizontally flipped image.

**The actual solution is simpler: rotate, don't mirror.** A 180° rotation about the x-axis,
`(x, y, z) → (x, −y, −z)`, maps the real apex-up roof exactly onto the sim's apex-down roof —
the hexagon's corner set (vertices at `60°·i`) is symmetric about y, so the two surfaces coincide.

Because a rotation is orientation-*preserving*, rotating the camera and the scene together
produces an identical image. So:

- Projector poses stay authored in real-world apex-up metres (readable, matches a tape measure).
- `projection.js` applies a single `SIM_FRAME` rotation matrix to position, target and up.
- **No shader changes, no `causticsSpaceMatrix` uniform, no second roof mesh, no output flip.**
  The existing roof geometry and environment material are reused untouched.

The only difference versus the mirror interpretation is that the caustics pattern is y-flipped.
Since there is no real water above the yurt there is no ground truth to violate — but note that
object paths (shark, boats) are y-flipped too, so if one should pass a specific physical landmark
(e.g. the door) adjust the path or the mount angles, not this architecture.

---

## 3. Separate the show render path from the dev view

The current loop renders the full scene — skybox, water surface, orbit camera. None of that
belongs in projector output. **The projection surface *is* the roof**, so the show path renders
only the roof, lit by the caustics, on pure black.

- Keep all offscreen passes unchanged (water sim → environment map → caustics). They are
  view-independent and already correct.
- New `ProjectionScene` containing only the upright roof mesh with the environment material.
- Black background → light naturally falls off outside the roof silhouette, which *is* the spill
  mask. No separate masking geometry needed.
- Shark/boats are not needed in this scene; their occlusion is already baked into the caustics
  texture.
- Keep the existing orbit/debug view behind a mode flag for development.

---

## 4. Projector camera model + config

### Config shape

```js
{
  id: 'proj-1',
  mount: 'corner-0',        // preset: 'corner-0..5' | 'wall-0..5'
  heightBelowEave: 0.10,    // metres
  aim: { ... },             // default: apex / opposite-panel centroid
  throwRatio: 1.25,         // measured
  resolution: [1920, 1080],
  // fine adjustment, layered on top of the preset:
  offset:   { x: 0, y: 0, z: 0 },
  rotation: { yaw: 0, pitch: 0, roll: 0 },
  lensShift:{ x: 0, y: 0 },
  fovScale: 1.0,
}
```

Mount presets resolve to a real-world position from the hexagon geometry, so "ideal measurements"
are *derived*, not typed in by hand. Fine adjustments are stored as deltas on top, so a corrected
measurement doesn't invalidate hours of tweaking.

### Camera construction

Use an **off-axis (asymmetric) frustum** via `makePerspective(left, right, top, bottom, near, far)`
rather than a plain FOV — real projectors throw off-axis (the image sits above the lens
centreline), and this is also how lens shift is expressed. A symmetric `PerspectiveCamera` cannot
represent it, and trying to fake it with rotation introduces keystone that then has to be undone.

### Output layout

Start with a single window, three viewports side by side (`setViewport` / `setScissor`) for
desk development. The same code path then drives a window spanning the three projector outputs as
one extended desktop — one render loop, one GL context, perfectly frame-synced, which matters
because animated caustics make inter-projector tearing very visible in overlap regions.

---

## 5. Calibration interface

Hardcoded ideal geometry gets close; the real yurt will not match it. Needs a live adjustment UI.

### Stage 1 — manual nudge — DONE

Implemented in `calibration.js`, wired up in `index.js`:

- `lil-gui` panel (`three/examples/jsm/libs/lil-gui.module.min.js`, already bundled with three.js
  so no new dependency) with one folder per projector, each bound directly to that projector's
  `offset` / `rotation` / `lensShift` / `fovScale` deltas plus its `mount` preset.
- Mount preset dropdown offers every `corner-N`/`wall-N` combination, so placements can be compared
  in situ without touching the JSON by hand.
- **Wireframe overlay**: `createRoofWireframe()` builds a `THREE.EdgesGeometry` of the roof (the
  6 eave edges + 6 creases fall out automatically from face-normal discontinuities) rendered as
  bright lines in `projectionScene`, toggled from the GUI.
- Per-projector **enabled** checkbox mutes a projector in the multi-viewport output (debug view 6)
  without discarding its calibration, so one can be aligned at a time.
- New debug view **7 ("projector calibration")**, selected via the GUI's "calibration view"
  dropdown + key `7`: renders `projectionScene` full-window from exactly one projector's camera —
  i.e. what that output actually sends once attached for real, which is what you want on screen
  while nudging sliders against the physical roof.
- Calibration persists to `localStorage` (`hexayurt-projection-calibration`) on every change and is
  re-applied on load via `applySavedCalibration()`, plus explicit **export/import JSON** buttons for
  backing up or sharing a calibration independent of the browser's storage.

Debug views now: `0` scene, `1` water heightfield, `2` environment map, `3` caustics,
`4` causticsDebug, `5` projection preview (orbit cam), `6` projector output (3 viewports),
`7` projector calibration (single active camera, full window).

### Stage 2 — anchored pose refinement (optional, later)

If manual nudging proves slow (likely with off-axis lenses, where position and lens shift are
visually confusable):

A cold-start DLT solve (the original idea here) **does not work** for this rig: each corner
projector only ever sees ~4 of the 7 roof vertices (the apex + the 3 far corners; the near corners
at and beside its own mount point fall outside the frustum). Worse, those visible points are
nearly coplanar (3 of the 4 sit on the eave plane), which is degenerate for a blind linear solve
regardless of point count — a camera fit to points on one or two planes is ambiguous up to a
homography.

The fix is to refine, not solve from scratch, since we already have something DLT doesn't assume:
a good initial pose from the Phase 0 measurements plus the stage 1 nudge.

- Drag the visible vertex markers (apex + the far eave corners, whichever are in frame) onto the
  real creases/corners.
- Run a small **nonlinear least-squares refinement** (Gauss-Newton / Levenberg-Marquardt, i.e. the
  `solvePnP`-with-initial-guess idea) over `offset` / `rotation` / `lensShift` starting from the
  current pose, rather than an unconstrained DLT. A handful of points reliably constrains ~6-9
  extrinsic parameters *when anchored to a decent prior* — the prior is what breaks the planar
  ambiguity that sinks a cold-start solve.
- Optionally sample extra points along each visible crease (not just the vertex endpoints) for more
  constraint equations and to average out drag-handle imprecision.
- Cross-check: the apex is visible to all three projectors, so after refining each independently,
  compare their solved world-space apex positions as a consistency check on the whole rig.

This still absorbs pose, lens shift and keystone error in one step and compensates for an
irregular real yurt — it just needs the measured pose as a starting point rather than assuming
none.

---

## 6. Physical output: getting pixels onto the N projectors — DONE

Decision made: **Electron**, one window per physical output, no LAN/second-device control (the
monitor option is a local extra window, not a remote one).

### Window-per-display architecture

`electron/main.js`:

- On launch, shows a small settings window (`electron/settings-window/`) with **projector count**
  (default 3) and **control monitor attached** (checkbox), persisted to a JSON file in Electron's
  userData dir so it's remembered between runs but still editable every launch.
- `screen.getAllDisplays()` + `screen.getPrimaryDisplay()` decide the layout: if a monitor is
  attached, the **primary display is the monitor**, every other display is a projector; if not,
  **all** displays are projectors. Projector displays are sorted left-to-right by x position and
  assigned `proj-1`, `proj-2`, ... in that order, matching `projection.json`'s renumbered ids (§
  below).
- Each projector gets its own frameless `kiosk: true` `BrowserWindow`, sized/positioned to exactly
  match that display's `bounds` — this is what spanning displays actually means in practice: N
  separate windows, each pinned to one display, not one giant window stretched across all of them.
- If a monitor is attached, one additional normal (decorated, resizable) window opens on the
  primary display, running the full dev experience unchanged.
- Toggling "control monitor attached" only changes whether that extra window exists — it never
  touches how the projector windows are created, satisfying "plug in all the projectors, set them
  up via the OS, then tell the app how many projectors and whether there's a monitor" without the
  monitor's presence disturbing projector output.
- Each window learns its role via `additionalArguments` → `electron/preload.js` →
  `contextBridge.exposeInMainWorld('showContext', ...)`, read by `index.js` as `window.showContext`
  (`{ mode: 'show', projectorId }` or `{ mode: 'dev' }`). A plain browser tab (no Electron) sees
  `showContext === undefined` and gets the full dev experience exactly as before.

### Renderer-side split (`index.js`)

- `isShowMode = showContext?.mode === 'show'`.
- The water/caustics/moving-geometry update was factored out into `updateSimulation()`, shared by
  both loops so the actual simulation never diverges between dev and show.
- Dev/monitor windows keep running `animate()` unchanged: full scene, orbit camera, debug views
  `0`-`7`, the full multi-projector `createCalibrationUI` panel.
- Show windows run a new lean `animateShow()`: just `updateSimulation()` + a single
  `renderer.render(projectionScene, myProjector.camera)` fullscreen — no skybox/water-dev-scene
  pass, no debug overlays, no multi-viewport logic (each window only ever needs its own camera).
- Show windows get `createShowCalibrationPanel()` instead of the full panel: centered on screen,
  hidden by default, scoped to only the one projector that window represents (no projector list,
  no solo/mute - irrelevant when a window only ever shows its own camera). Any digit key toggles
  it, reusing the same `localStorage` persistence key as the dev panel, so a calibration tweak made
  directly on a projector's own output is saved exactly the same way.
- Debug views `0`-`7` and their keybindings are **unchanged** in dev mode - nothing was removed.

### Calibration panel reset — DONE

Both the full dev panel and the show-mode overlay share `addProjectorControls()`, which now ends
with a **"reset to defaults"** button per projector: zeroes `offset`/`rotation`/`lensShift` and
sets `fovScale` back to `1` in place (mutating the existing objects lil-gui's controllers already
reference, never replacing them), then refreshes the displayed values and re-resolves the cameras.

### Projector naming — DONE

Ids renumbered from `proj-0`/`proj-2`/`proj-4` to consecutive `proj-1`/`proj-2`/`proj-3` in
`public/config/projection.json`. `mount` (`corner-0`/`corner-2`/`corner-4`) is unchanged, since it
genuinely describes which hex corner each one sits at - only the display-facing id changed.

### Not built (deliberately out of scope here)

- No electron-builder packaging/installer - `npm run electron` runs the app via plain `electron .`
  pointed at the Vite dev server (`ELECTRON_START_URL` overrides the default
  `http://localhost:3000`). Good enough for a dedicated show machine; packaging is a separate,
  later concern if an installer is ever needed.
- Pre-existing `npm audit` findings (`body-parser`/`proxy-addr`/`qs`) come from the old `express`
  dependency used by `app.js`/`npm start`, unrelated to this change.

---

## 7. Edge blending (once ≥2 projectors are aligned) — DONE

- Feathered alpha ramp across each projector's overlap band so summed intensity stays constant.
- **Blend in linear light, not sRGB**, or the seam shows as a bright/dark band.
- Projectors can't produce true black, so overlap regions have a raised black floor — keep overlap
  bands narrow and, where possible, aligned to creases.

### Implementation

The overlap on this roof is **not** a left/right band, which is the trap here. The 6 panels all
converge on the apex, so coverage is **3-deep near the apex**, 2-deep along a crease lower down,
and 1-deep in the middle of a panel. A per-projector screen-space edge ramp (feather the left and
right of each image) cannot represent that: it assumes exactly two projectors meet at any seam,
and it has no way to know that a point near the apex is lit by all three.

So blending is computed from the **geometry**, in shared world space, not per-projector screen
space:

- `vertex.glsl` passes `vWorldPosition` / `vWorldNormal` through.
- `fragment.glsl` is given the whole projector set — `blendViewProjection[]` (world→clip) and
  `blendPosition[]` (eye position) — and for each fragment tests *every* projector: is this point
  inside that projector's frustum, and is the panel facing it? Each covering projector gets a
  weight that falls off smoothly towards its frustum edges (`blendFeather`, in NDC units).
- The weight actually used is `self / sum(all covering projectors)` — a **partition of unity**. By
  construction the weights at any point sum to exactly 1, so the surface brightness matches
  everywhere regardless of whether 1, 2 or 3 projectors land there. The 3-way apex region resolves
  to ⅓ each automatically; nothing special-cases it.
- A point only one projector covers gets weight 1 — full brightness, no dimming, even right at
  that projector's frustum edge. Only genuinely overlapped regions are attenuated.
- The facing test matters: a panel on the far side of the pyramid can sit inside another
  projector's frustum while facing away from it. Counting it would wrongly dim the projectors that
  really do cover the point. Back faces are culled, and `computeVertexNormals()` makes normals
  winding-consistent, so `vWorldNormal` already points back at whichever projector is rendering —
  which is what makes `dot(n, projector - fragment) > 0` a valid test for the *other* projectors.
- Applied to the linear-space colour before Three.js's output sRGB transfer, satisfying "blend in
  linear light" without a separate post-process pass.
- One global **blend feather** slider in lil-gui (not per-projector, not per-edge): since the
  shader normalises across whatever actually overlaps, this only controls how soft the crossfade
  is. `0` disables blending. Persisted with the rest of the calibration (storage format is
  versioned, so existing saved per-projector calibration still loads).
- `MAX_BLEND_PROJECTORS` is 6 in both the shader and `index.js`, covering the 6-projector fallback
  from §1 without a code change.

### Weighting within an overlap: incidence preference

Splitting an overlap evenly between the projectors that cover it is not automatically right. A
projector hitting the surface at a grazing angle smears its pixels over far more area, so it
contributes a blurrier image and is more sensitive to registration error than one looking at the
same point nearly face-on.

So each projector's weight is additionally multiplied by `cos(incidence)^blendQuality`:

- `blendQuality = 0` → every covering projector weighted equally (the plain partition of unity).
- Higher values → progressively hand the overlap to whichever projector faces the surface most
  directly, approaching winner-take-all.
- Default `2`, tunable live from the same lil-gui "blending" folder.

A useful side effect: incidence flips across a crease (the normal is discontinuous there), so
preferring the more face-on projector naturally drags the crossfade **onto the creases** — the
placement §1 wants, arrived at from the geometry rather than by hoping frustum edges line up.

Tradeoff to watch on the real roof: a strong preference makes the transition sharper, which hides
misregistration *less* well. If alignment residual turns out to be visible at the creases, lower
`blendQuality` (softer, wider crossfade) rather than fighting it with the feather width.

Deliberately not modelled: full radiometric normalisation (weighting by `cos θ / d²` so the summed
*surface luminance* is constant rather than the summed image values). It would need the panels'
actual reflectance, and foil-faced hexayurt panels are likely far from Lambertian — worth
measuring in situ before assuming any model. The roof also has inherent brightness variation from
geometry that nothing here corrects.

Still to verify on hardware: the feather width and incidence exponent that actually hide the
seams, and whether the raised black floor in the 3-deep apex region is noticeable in the room.

---

## Suggested order of work

1. ~~**Phase 0** — real dimensions and throw ratio.~~ **Done** (ideal values; re-measure once built).
2. ~~**Phase 1** — projector placement + data-driven config.~~ **Done**.
3. ~~**Phase 2** — mirrored-frame reconciliation.~~ **Done** via `SIM_FRAME` rotation; no sim changes.
4. ~~**Phase 3** — projection-only render path (roof on black).~~ **Done** (debug view 5).
5. ~~**Phase 4** — 3 viewports driven by the resolved projector cameras.~~ **Done** (debug view 6,
   laid out by each projector's real resolution/aspect rather than equal thirds).
6. ~~**Phase 5 stage 1** — lil-gui adjustment + wireframe overlay.~~ **Done** (`calibration.js`,
   debug view 7). Get **one** projector perfect on the real roof before adding the second; nearly
   every hard problem shows up at n=1.
7. ~~**Phase 6** — physical output.~~ **Done**: Electron app, settings window (per-display role
   assignment: `Unused`/`Monitor`/`proj-N`), one spanning window across all assigned projector
   displays (single sim, viewport-per-region) plus one dev window per monitor-assigned display,
   `index.js` split into dev (`animate`) vs. show (`animateShow`) paths, per-projector reset
   button, ids renumbered to `proj-1..N`.
8. ~~**Phase 7** — blending.~~ **Done**: world-space partition-of-unity blending in the environment
   shader (handles the 3-way overlap at the apex, not just pairwise seams), weighted by incidence
   angle so the more face-on projector wins an overlap, with feather + incidence sliders.
   Previewed in debug views 6/7 and show mode alike.
   ← *next: run on the real yurt - Stage 1 calibration for all three projectors, then tune the
   feather width and incidence preference against the actual overlap*
9. Show hardening — later, out of scope here.

---

## Open questions

1. Re-measure the built yurt and update `projection.json`. Taped-panel hexayurts are never
   perfectly regular; if eave lengths differ by more than a few cm, calibration should target
   measured vertex positions rather than idealised `createRoofGeometry()` output.
2. Confirm HY310 native resolution (config currently assumes 1920×1080).
3. Roof only, or do the walls get content later? (Affects whether the config abstraction should
   generalise beyond the roof surface.)
