# Paka — application report

| Field | Value |
| --- | --- |
| Application | Paka — a desktop raster drawing app |
| Version | `0.1.0` (`src-tauri/tauri.conf.json`) |
| Report date | 2026-10-23 |
| Branch | `feat/krita-brushes`, cut from `feat/bigger-canvas-sizes` at `bbf1521` |
| Worktree | `D:/Dev/Paka-overnight-worktrees/integration` |
| Stack | Tauri 2 + React 19 + strict TypeScript + Vite; Rust for native work; HTML Canvas 2D behind a renderer interface |
| Project format | `.paka`, version **13** |
| Settings format | version **1** |
| Status | Green: typecheck, 2,382 unit tests, 82 browser tests and the production build all pass |

This report describes the application as it exists on the branch above. It is
written to be pasted into a Notion page without editing.

---

## 1. Executive summary

Paka is a focused raster painting application for the desktop. It is built
around a small, explicit model: a document owns ordered layers, a layer owns
ordered elements (strokes, fill patches and gradients), and every visible
pixel is a deterministic function of that model. Undo/redo, save/reopen,
layer rebuilds and PNG export all read the same model, so they cannot drift
apart.

The product is deliberately narrower than a general-purpose image editor. It
does one thing — painting — and spends its complexity on brush feel, correct
compositing, undo safety, document-format rigor and a keyboard-first shell.
There is no text tool, no filters, no scripting, no cloud service and no
account.

The current build adds **69 translated Krita 4 default brushes**. They are
imported as the user's own editable presets with one button, with no Krita
binary asset copied or shipped.

---

## 2. What the application does

### 2.1 Documents and canvas

- **New document**: 8–8,192 px per side, at most **16,777,216 px in total**
  (4,096 × 4,096), validated before any surface is allocated. Six one-click
  presets: Full HD, QHD, 4K UHD, A4 at 300 dpi, Panorama (8192 × 2048) and the
  largest allowed square (4096 × 4096).
- **One document per window**, with a dirty indicator and a discard guard on
  close.
- **HiDPI**: layer surfaces are rasterized at up to 2×; the display follows the
  device pixel ratio.
- **Raster budget**: the total-pixel cap is derived from a 1 GiB budget for the
  peak surface set (three 2× RGBA surfaces plus a transient scan buffer,
  58 bytes per document pixel). A document that would exceed it is refused
  before allocation.
- **Bounded rebuilds**: when a layer changes, only the rectangle each element
  actually inks is cleared and re-blended, so cost follows stroke geometry
  rather than document size.

### 2.2 Tools

| Tool | Key | Behaviour |
| --- | --- | --- |
| Brush | `B` | Pressure-sensitive width/opacity, hardness, grain, stamp mode |
| Eraser | `E` | Same footprint, subtracts coverage (`destination-out`) |
| Select | `M` | Marquee or click selection of whole strokes; move, nudge, duplicate, flip, scale, rotate |
| Line | `L` | Straight line; `Shift` constrains to 45° |
| Rectangle | `R` | `Shift` square, `Alt` from centre, optional fill |
| Ellipse | `O` | `Shift` circle, `Alt` from centre, optional fill |
| Polygon | `P` | 3–24 sides, inscribed in the drag box's ellipse, optional fill |
| Star | `S` | 3–24 points, inner radius 5–100 %, optional fill |
| Bucket fill | `F` | Contiguous flood fill with tolerance, fill mode and sample scale |
| Gradient | `G` | Linear or radial, two stops, optional middle stops |
| Colour picker | `I` | Samples the merged composite; not an edit |
| Guides | `U` | Place and move composition guides |
| Pan | `H` | Move the canvas view; also middle-drag |

Every tool draws through the same pointer pipeline, so the sample the user
drew and the sample that was committed agree.

### 2.3 Brush engine

- Size **1–512** document pixels, opacity, edge **hardness** (0–100 %).
- **Pressure**: size, opacity and a piecewise-linear response curve (2–32
  points), captured per stroke.
- **Sampling**: 2–200 % of diameter (sample density).
- **Stabilizer**: 0–100 %, exponential follow with a visible release settle;
  brush and eraser only.
- **Grain texture**: 0–100 %, deterministic document-anchored grain over the
  finished coverage.
- **Stamp (dab) mode**: a stroke becomes a chain of round dabs at a fixed
  arc-length interval, with **stamp spacing**, **stamp hardness**, and a
  per-dab **directional bristle texture** whose lanes run along the path.
  Coverage is unioned with a per-pixel maximum, so self-overlap never darkens
  and the stroke's opacity is applied once.
- **Tips**: the closed set `round`, `felt`, `chisel`, `blot`, `bristle`.
- **Colour**: any CSS colour, plus an eight-swatch palette and a live brush
  preview.
- **Presets**: save, apply, rename, duplicate, delete, star, search, sort,
  group; the library survives a restart. All fields round-trip, including
  pressure curve, stamp, texture and tip.
- **Bundled presets**: a protected built-in set that cannot be renamed or
  deleted; duplicating is how a user gets an editable copy.
- **Krita 4**: 69 translated defaults added with one click (see §5).

### 2.4 Colour

- **HSV colour wheel**: angle = hue, distance from centre = saturation, plus a
  value slider and three keyboard-operable sliders. Exact RGB↔HSV conversion
  over the whole 8-bit cube.
- **Colour input** accepts `#rgb`, `#rrggbb`, **8-digit hex**, `hsl()`/`hsla()`
  and `oklch()`. An out-of-gamut `oklch()` is clamped into sRGB; garbage input
  reverts to the last valid colour; a translucent colour is reported as not a
  solid colour rather than silently measured.
- **Contrast readout**: WCAG 2.2 contrast ratio between the ink and the paper.
- **Colour difference**: CIEDE2000 between the ink and a second colour, plus
  the perceptually nearest palette swatch. Computed from WCAG relative
  luminance, sRGB→CIELAB and CIEDE2000, with the published verification table
  as a test fixture.
- The readout is read-only: no control, no state, no history entry.

### 2.5 Layers and compositing

- Add, duplicate, delete, rename (inline), reorder, visibility, opacity and
  selection.
- **Layer groups**: an indented, draggable tree. Create an empty group, rename
  it, expand/collapse, drag layers into, out of and between groups, reorder
  siblings, ungroup, and move a layer out one level. Group visibility and
  isolated opacity/blend are composited correctly; deletion and undo restore
  the whole subtree.
- **Eleven blend modes**: `normal`, `multiply`, `screen`, `overlay`,
  `soft-light`, `hard-light`, `color-dodge`, `darken`, `lighten`, `difference`
  and `exclusion`. Each maps to a platform composite operation with the
  separable formula recorded in code and pinned by expected-pixel tests.
- Layer edits are **refused while a gesture is in flight**, so a release can
  never commit into a layer that was removed mid-drag.
- No masks or adjustment layers yet.

### 2.6 Selection and transform

- Marquee or click selection of whole strokes of the active layer; combining
  modes and a lasso marquee are available.
- Drag to move; arrow keys nudge (1 px, `Shift` 10 px, coalesced); `Ctrl+D`
  duplicates; `Ctrl+Shift+H`/`V` flip; `Delete` removes; `Esc` cancels.
- **Four corner handles** scale uniformly about the selection frame's centre;
  the factor is clamped so a selection can never collapse or invert (5 %
  floor).
- A **rotation handle** above the frame turns about the same centre, snaps to
  15° while the pointer is held, and `Shift` turns the snap off.
- Both transforms are **baked on apply**: they move the strokes' samples and
  nothing else, so brush, colour, opacity and pressure are untouched. One undo
  step per transform.
- The Selection menu mirrors the fixed-step operations: scale 150 %, rotate
  ±15°, flip, nudge, duplicate, delete, clear.
- Selection is an overlay only: never serialized, never exported, and painting
  is not clipped to it.

### 2.7 Drawing aids

- **Composition guides** (`U`): drag on empty canvas to place a vertical or
  horizontal guide; the axis follows the dominant drag direction and the
  position is the press coordinate. A drag shorter than 3 screen pixels creates
  nothing. Drag a guide to move it, click to select, `Delete` removes it, `Esc`
  cancels. Guides are document state but **display-only** — they never reach a
  layer surface or an export.
- **Grid**: a lattice over the paper with spacing in **document pixels**
  (2–500), so it means the same thing at every zoom.
- **Snapping**: a magnet within **6 screen pixels** of a guide or grid line.
  The tolerance is screen space, so the same gesture snaps alike at 100 % and
  400 %. Applied in the engine's single pointer entry point.
- **Rulers**: horizontal and vertical rulers with ticks and labels; toggled
  from the View menu or `Ctrl+Alt+R`.
- **Symmetry**: off, vertical, horizontal or both, with draggable axis
  positions. Mirrored copies are committed as one undo step, and the axes are
  an overlay that never reaches an export.
- Grid, snapping, rulers and guides are **view/document aids**: no pixels
  change, no history step, no dirty flag.

### 2.8 View and navigation

- Wheel scroll, `Shift+Wheel` horizontal, `Ctrl`/`Alt+Wheel` zoom at cursor.
- Pan tool and middle-drag.
- Zoom in/out, actual size, fit to window; the View menu and keyboard chords
  agree with the status bar.
- Status bar: document size, zoom, history depth, selected count, cursor
  position, input device and pressure, file name/messages, unsaved marker.

### 2.9 Panels and workspace

- A **tabbed side dock** with movable panels: **Color**, **Brushes**,
  **Layers**, **Navigator** and **Shortcuts**.
- Drag a tab to reorder it; drag a tab out to **float** it as its own window;
  use the panel actions menu for the keyboard-and-pointer equivalent; **Reset
  Panel Layout** in the Panels menu restores the registry order.
- Panels can be folded and hidden; the layout is persisted.
- **Workspace profiles**: the arrangement of the window can be saved, renamed,
  applied and deleted. The picker lists the saved arrangements and shows the
  active one.
- **Tool options bar**: a one-row context strip whose controls follow the
  selected tool, with a tiered brush section and popovers for advanced
  controls. The strip keeps a stable height and scrolls horizontally in a
  narrow window.
- **Keyboard shortcuts**: one command registry owns every chord; the menu bar
  and the keyboard read the same table, so they cannot disagree. The Shortcuts
  panel lets the user rebind a command and records the override.

### 2.10 Files and persistence

- **Projects**: `File → New/Open/Save/Save As`; `Ctrl+O`, `Ctrl+S`,
  `Ctrl+Shift+S`; versioned `.paka` JSON with ordered layer content (stroke
  samples, fill masks, gradient geometry, layer tree), atomic writes, dirty
  indicator and discard guard.
- **PNG export**: full composite at document size, honouring layer visibility,
  opacity, blend mode and groups; leaves the document untouched.
- **Settings**: a per-user file in the OS configuration folder
  (`%APPDATA%\com.paka.drawing\settings.json` on Windows) holds editor
  preferences only — never a drawing. Changing a preference is not an edit: no
  history step, no dirty flag. A missing, corrupt or future-versioned file
  starts with defaults and no error.
- **Autosave / crash recovery**: the machinery and its policy seam exist and
  are tested, but **nothing is enabled** and no recovery file is written. The
  policy decisions belong to the owner.

---

## 3. Architecture

### 3.1 Layers of the system

```
React shell (features/, components/, hooks/, state/)
        │  snapshots and intents
        ▼
DrawingEngine (core/engine/)
        │  tools, gestures, history, view state
        ├──────────────► CommandStack + commands (core/commands/)
        ├──────────────► DrawingDocument + layers (core/document/)
        ├──────────────► Canvas2DRenderer (core/rendering/)
        └──────────────► ProjectFiles / SettingsStore (core/project/, core/settings/)
```

The React layer is a **view of engine snapshots** and a source of intents. It
does not own drawing state. The engine owns the document, the history, the
selection, the viewport, the tools and the editor preferences. The renderer
owns pixels. Pure modules own geometry and validation so they can be tested
without a browser.

### 3.2 Key modules

| Area | Module |
| --- | --- |
| Engine, gestures, history seam | `core/engine/DrawingEngine.ts` |
| Document, layers, layer tree | `core/document/document.ts`, `layerGroups.ts`, `strokeStore.ts` |
| Commands | `core/commands/commandStack.ts`, `documentCommand.ts`, `strokeEditCommand.ts` |
| Stroke capture | `core/brushes/strokeBuilder.ts`, `stabilizer.ts` |
| Rasterization | `core/rendering/Canvas2DRenderer.ts`, `canvas2dStroke.ts`, `stampCoverage.ts` |
| Brush tips | `core/rendering/brushTip.ts` |
| Blend modes | `core/document/blendModes.ts` |
| Selection geometry | `core/document/strokeSelection.ts`, `selectionTransform.ts`, `selectionHandles.ts` |
| Fill | `core/fill/fillScan.ts`, `floodFill.ts`, `fillOptions.ts` |
| Gradients | `core/gradient/gradientRecord.ts`, `gradientHandles.ts` |
| Guides / grid / symmetry | `core/document/guides.ts`, `grid.ts`, `symmetry.ts` |
| Rulers | `core/rendering/rulers.ts` |
| Viewport | `core/rendering/viewport.ts` |
| Project format | `core/project/projectFormat.ts` |
| Settings | `core/settings/appSettings.ts`, `settingsStore.ts` |
| Actions / chords | `core/actions/registry.ts`, `keyboard.ts` |
| Panel registry | `core/shell/panelRegistry.ts`, `core/panels/` |
| Workspace | `core/workspace/workspaceSettings.ts`, `workspaceProfiles.ts` |
| Native I/O | `src-tauri/src/project_io.rs`, `settings_io.rs`, `lib.rs` |

### 3.3 Design rules the code follows

1. **The model is the truth.** Pixels are a pure function of the document,
   the viewport and the raster scale. Live drawing, commit, rebuild,
   undo/redo, reopen and export all read the same model.
2. **Pure modules for geometry.** Grid, guides, symmetry, selection
   transforms, shape geometry, rulers, wheel geometry and colour metrics are
   plain functions with unit tests; the engine and renderer call them.
3. **One command per user action.** A gesture is one history step; a slider
   drag is one step; a symmetry commit containing four mirrored copies is one
   step.
4. **Refuse, do not repair, bad files.** A malformed project or settings file
   is rejected with a message, not silently reinterpreted.
5. **Display-only means display-only.** Selection, guides, grid, symmetry axes,
   rulers and the brush cursor never reach a layer surface or an export.
6. **Editor state is not document state.** Changing a brush, tool, panel or
   workspace preference never dirties the drawing.

---

## 4. Project and settings formats

### 4.1 Project format (`.paka`, version 13)

The file is JSON with an explicit `format` and `version`, a `document` header,
a `layers` tree and ordered `elements`. Strokes store their samples, brush and
pressure data; fills store a binary mask patch; gradients store geometry and
stops. Layer entries carry `kind` (`layer` or `group`), and groups carry
`children`.

Version history (abridged):

| Version | Change |
| --- | --- |
| 3 | Filled shapes |
| 4 | Bucket-fill patches |
| 5 | Gradients |
| 6 | Brush hardness |
| 7 | Grain texture |
| 8 | `normal` / `multiply` / `screen` blend modes |
| 9 | Stamp (dab) brush |
| 10 | Per-dab directional texture |
| 11 | Eight more blend modes |
| 12 | Pressure-response curve |
| 13 | Layer tree (`kind`, `children`) and brush tip shape |

A reader refuses a **newer** version rather than half-reading it. Older files
load unchanged: missing additive fields take their documented defaults, and a
v12 reader refuses a v13 file rather than drawing an unknown layer kind or tip
as a plain one.

### 4.2 Settings format (version 1)

A small JSON document holding the brush, the preset library, the selected
tool, shape options, fill tolerance, gradient settings, grid settings, panel
layout, workspace profiles and shortcut overrides. Every field is validated:
missing → default, out of range → clamped, malformed → default, newer version
→ ignored wholesale, invalid JSON → defaults. The file never stops the editor
from starting. Symmetry and ruler visibility are session/view state, not
persisted preferences.

---

## 5. New in this build: the Krita 4 brush pack

### 5.1 What the user gets

A **Krita 4** button in the Brushes panel header. One press adds **69**
translated presets to the user's own library, named `Krita - ...`. They are
ordinary user presets: apply, rename, duplicate, star, delete and export them
like any other brush.

A second press adds nothing: only names not already in the library are
imported. A brush the user deleted is restored on the next press, without
creating `(2)` copies.

### 5.2 Provenance

Source: `Krita_4_Default_Resources.bundle` from Krita **4.4.8**
(`krita/data/bundles/`). The bundle's `meta.xml` names **Deevad** with
derivations by **Ramon Miranda, Razvanc, Radian, Wolthera, Storm, Scottyp** and
others, and declares **`license = CC-0`**.

Only preset **names** and **numeric settings** were used. No tip image,
pattern, texture or other binary asset from Krita is copied or shipped. Every
brush is Paka's own rasterization of those numbers through fields Paka
actually implements.

### 5.3 Coverage

| Krita engine | Count | Paka representation |
| --- | --- | --- |
| `paintbrush` (non-eraser) | 63 | Smooth or stamped dabs with hardness, texture and pressure |
| `roundmarker` | 1 | Smooth round stroke |
| `sketchbrush` | 2 | Smooth round stroke |
| `spraybrush` | 2 | Stamped brush |
| `hairybrush` | 1 | Stamped bristle brush |

**Skipped (26):** 14 `colorsmudge`, 3 `deformbrush`, 3 erasers, and one each
of `duplicate`, `curvebrush`, `gridbrush`, `tangentnormal`, `hatchingbrush` and
`experimentbrush`. Paka has no smudge, deform, clone, grid, curve, tangent or
hatching engine, so those presets would be misleading if imported.

### 5.4 Translation rules

- **Size**: the mask diameter when stated; otherwise the tip file's real pixel
  size × the Krita brush scale, read from the PNG header, the wrapped GIMP
  `.gbr` header or the `.gih` text header. Clamped to 1–512.
- **Opacity**: `OpacityValue` (and the older percentage), times `FlowValue`.
- **Hardness**: `vfade`/`hfade`, a softness curve or the image tip; mapped to
  0.05–1.
- **Spacing**: the brush's spacing attribute, clamped 0.02–2; stamped brushes
  reuse it as `stampSpacing`.
- **Stamp**: image tips, `spraybrush`, `hairybrush`.
- **Tip**: mask type (circle vs rect) and, for image tips, the file name →
  `round`, `chisel`, `blot` or `bristle`.
- **Texture**: the Krita pattern strength when enabled, or light grain for
  grainy image tips.
- **Pressure**: `PressureSize`/`PressureOpacity` become 0.8 or 0 on the
  identity curve; `minSizeRatio` is 0.12.

### 5.5 Files

| File | Purpose |
| --- | --- |
| `src/core/brushes/kritaDefaults.ts` | 69 specs, the brush builder, `missingKritaPresets`, provenance |
| `src/features/brushes/BrushPresetPanel.tsx` | The **Krita 4** button and import handler |
| `src/test/kritaPresets.test.ts` | 12 unit tests |
| `tests/visual/krita-presets.spec.ts` | One-click import in a real browser |
| `docs/qa/krita-brushes/REPORT.md` | Implementation evidence and provenance |

No new dependency. No project-format, settings-schema or document-model change.

### 5.6 Verification for this slice

| Command | Result |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 95 files, 2,382 tests passed |
| `pnpm test:visual` | 82 tests passed |
| `pnpm build` | exit 0; existing >500 kB chunk warning only |

The targeted runs also passed: `pnpm exec vitest run src/test/kritaPresets.test.ts`
(12 tests) and `pnpm exec playwright test tests/visual/krita-presets.spec.ts`
(1 test). No test was skipped, and no check is claimed without a run.

---

## 6. Quality and verification

### 6.1 The suite

- **95 unit/integration test files, 2,382 tests.** Pure modules are tested
  directly; the engine and renderer are tested through their public seams with
  a software pixel canvas; format tests round-trip and reject malformed files.
- **82 Playwright browser tests** across the visual harness and the live app:
  shell layout at eight window sizes, tool rail, tool-options strip, panel
  movement, layer groups, blend modes, colour comparison, selection menu, new
  document sizes, the feature wave and the Krita import.
- **Pixel-agreement harness**: the same scene is rendered through the live
  stroke path, a layer rebuild and the export composite, and the three must
  agree.
- **Performance evidence**: the bounded-rebuild change was measured
  (47×–187× less touched area for small strokes) in
  `docs/PERFORMANCE_AUDIT_2026-10-20.md`.
- **Packaged evidence**: layer groups, panel movement, native save/open and
  PNG export were driven in a packaged Tauri build; the logs and artifacts are
  under `docs/qa/layer-groups-wave/`.

### 6.2 Commands used for this report

Run in `D:/dev/Paka-overnight-worktrees/integration`:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm test` | 95 files / 2,382 tests passed |
| `pnpm test:visual` | 82 passed |
| `pnpm build` | exit 0; existing chunk-size warning |

The Rust tree was not changed by the Krita slice. Packaged-build checks from
the layer-group wave remain the most recent native verification.

---

## 7. Deliberate limits

These are product decisions, not defects.

- **No text tool.** Tools are brush, eraser, select, line, rectangle, ellipse,
  polygon, star, bucket, gradient, picker, guides and pan.
- **Shapes are baked strokes.** A committed polygon or star stores points, not
  its kind, so it cannot be re-edited as a shape. There is no rotation gesture
  (an option covers the need), no irregular polygon and no per-vertex handles.
- **Selection is stroke-level** and active-layer only; it is dropped on a layer
  or tool switch, is not a painting mask, and has no perspective or
  non-uniform scale. A transform is baked on apply, so there is no persistent
  transform to re-edit, and painted width is not scaled with the path.
- **Gradients** have two required stops plus optional middle stops, paint the
  whole layer in element order, and are not selectable/movable as objects.
- **Fills** are binary masks with no feather, gap closing or pre-commit
  preview.
- **Hardness** is a single Gaussian feather of the finished silhouette, so the
  edge can extend slightly beyond the nominal diameter. The stamp engine's own
  `stampHardness` is a true per-dab profile and does not.
- **The stamp engine** uses round dabs only: no elongated/offset tips, scatter,
  rotation, jitter or per-dab opacity. A very large brush with fine spacing is
  expensive to re-rasterize; the planner stops after a fixed work budget and
  cuts an extreme stroke short rather than stalling.
- **Texture** is procedural grain and procedural bristle lanes, not an
  image-based texture.
- **Stabilizer** is exponential follow with visible lag; no look-ahead or rope
  catch-up; shapes ignore it.
- **Layers**: no masks, adjustment layers or clipping/alpha-inheritance
  groups. The document pixel budget covers the first layer; each additional
  layer adds a full-resolution surface, and the layer count is not capped.
- **Project files are JSON**, so they can grow large; there is no compressed
  or binary container.
- **No autosave and no crash recovery are enabled.**
- **Krita brushes are approximations**: no image tips, no smudge/deform
  engines and no per-sensor response curves, so they read like the Krita
  brushes rather than identically. Krita diameters above 512 px are clamped.
- **The React layer has no automated unit tests**; it is covered by the
  browser suite and by the pure modules it composes.

---

## 8. Open items and blockers

1. **Notion publication.** The requested new page could not be created from
   this session: the browser is at `https://app.notion.com/login`, no Notion
   MCP resources are configured and no `NOTION`/`NOTION_TOKEN` is present in
   the environment. This document is ready to paste once the owner signs in or
   supplies an integration token and a parent page.
2. **Packaged verification of the newest slices.** The layer-group and
   panel-movement slices have packaged evidence. The canvas-size presets and
   the Krita import are verified in the browser app, unit suite and production
   build, but not yet in a freshly packaged installer.
3. **Owner decisions still open**: autosave policy, recovery policy, and
   whether to distribute original Krita `.kpp` files or tip images (which
   would need a separate licence review, because Krita itself is GPLv3 and the
   bundle's CC-0 metadata alone would not settle a mixed-asset
   distribution).

---

## 9. Running and verifying Paka

### 9.1 Development

```bash
pnpm install
pnpm dev          # Vite dev server
pnpm tauri dev    # desktop shell
```

### 9.2 Checks

```bash
pnpm typecheck
pnpm test
pnpm test:visual
pnpm build
```

### 9.3 Packaged build

```bash
pnpm tauri build
```

The Windows executable and installers are produced under
`src-tauri/target/release/`. The current build is unsigned.

### 9.4 Using the Krita brushes

1. Open the **Brushes** tab in the right-hand panel dock.
2. Press **Krita 4** in the panel header.
3. Search for `Basic`, `Ink`, `Pencil`, `Stamp`, `Texture`, … or scroll.
4. Apply a brush as usual; edit, star, duplicate or delete it like any user
   preset.
5. Press **Krita 4** again to restore a brush that was deleted.

---

## 10. Repository map

```
src/
  app/            shell composition, panel imports
  components/     layout, toolbar, panels
  features/       brushes, canvas, color, document, gradient, grid,
                  history, layers, navigator, options, project,
                  shortcuts, view, workspace
  core/
    actions/      the one command/shortcut registry
    brushes/      defaults, presets, stabilizer, stroke builder, Krita pack
    commands/     command stack and document/stroke commands
    document/     document, layers, groups, guides, grid, symmetry,
                  selection geometry, blend modes
    engine/       DrawingEngine, canvas views
    export/       PNG export
    fill/         flood fill and scan pipeline
    gradient/     gradient records and handles
    input/        pointer ownership
    panels/       panel manager adapter
    project/      project format, files, gateways
    rendering/    Canvas2DRenderer, strokes, stamps, tips, rulers
    settings/     settings document and store
    shell/        panel registry and slots
    tools/        tool definitions and geometry
    workspace/    workspace settings and profiles
  hooks/          React bindings
  state/          stores
  test/           unit and integration tests
  types/          shared types
  utils/          colour, math, records, paths
tests/visual/     Playwright browser suite
src-tauri/        Rust shell, native project/settings I/O, window fitting
docs/             architecture, format, roadmap, session brief and QA evidence
```

### 10.1 Where to start reading

- Product state and plan: `docs/SESSION-BRIEF.md`, `docs/ROADMAP.md`.
- File/symbol map and reading protocol: `AGENTS.md`.
- Pixel pipeline: `docs/ARCHITECTURE.md` (rendering, strokes, eraser, shapes,
  bucket, gradients, selection, undo, testing).
- File format: `docs/PROJECT_FORMAT.md`.
- Verification recipes and toolchain: `docs/HANDOFF.md` §7–§8.

---

## 11. Conclusion

Paka is a small, coherent raster painting app with a deliberately narrow
scope and an unusually strict relationship between its model, its pixels and
its files. The current branch adds a usable, provenance-clean translation of
Krita 4's default brushes without widening the engine's claims: the brushes
use only features Paka actually implements, and the report says plainly where
they approximate the originals.

The suite is green: typecheck, 2,382 unit tests, 82 browser tests and the
production build. The remaining work is packaging verification and the
owner's autosave and distribution decisions — not unfinished drawing
functionality.
