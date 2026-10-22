# Paka — session brief

**Paste this file into a new session, or tell the new session to read it.**
It is a self-contained snapshot of the project and of how work is done here.
The deeper references are [HANDOFF.md](HANDOFF.md) (verification recipes,
toolchain caveats), [ROADMAP.md](ROADMAP.md) (the authoritative plan) and
[ARCHITECTURE.md](ARCHITECTURE.md) / [PROJECT_FORMAT.md](PROJECT_FORMAT.md).

Last verified: **2026-10-21**, at `87593bc` - the **polygon and star** slice
(T-14), on top of the HSV colour wheel, the stamp (dab) engine and the
visual-regression harness.

> **Before opening source files, read [`AGENTS.md`](../AGENTS.md).** It is the
> token-efficient file/symbol map and reading protocol; this brief is the
> project state and plan.

---

## 1. What Paka is

- **Repo**: `C:\Users\aissa\Desktop\Paka`. A desktop raster drawing application.
- **Stack (locked, do not change)**: Tauri 2 + React 19 + strict TypeScript +
  Vite, Rust for native work, HTML Canvas 2D behind a `DrawingRenderer`
  interface. No Electron, Qt, Fabric.js or Konva. No renderer rewrite or WebGL
  without profiling evidence.
- **Product goal**: grow the drawing-engine foundation into a professional
  raster drawing app, **one complete vertical slice per session**.
- **Architecture rule**: the document model is authoritative; pixel buffers are
  rebuildable caches; React never processes individual pointer samples. React
  reads a low-frequency `EditorSnapshot` and calls intent methods on the engine.

## 2. Current state (verified today)

- Branch `integration/next-build-wave`, cut from the phase-1 integration tip
  `38efc1f`: the **brush preset library**, the **contrast and colour-difference
  readout** with **wider colour input**, the **grid and pointer snapping**, and
  eight new **layer blend modes** (project format 11), on top of the fixed-step
  transforms, settings persistence, per-dab directional texture, live-preview
  compositing, layer-safety, raster-budget, bounded-rasterization, **stamp (dab)
  brush engine**, **HSV colour wheel**, **composition guides**, **polygon and
  star** and **scale/rotate** slices. The feature branches remain; nothing was
  rewritten.
- Measured on this branch: `pnpm test` **968 tests in 44 files, all pass**;
  `pnpm typecheck` clean; `pnpm build` succeeds; `pnpm test:visual`
  **30 tests, all pass**; `cargo check --lib` clean (the Rust tree is unchanged
  by this wave). `docs/qa/INTEGRATION-NEXT-BUILD-WAVE.md` records the exact
  commands, the merge SHAs and the ownership of each branch.
- Project file format **version 11** (`PROJECT_VERSION = 11`); `stabilizer` was
  additive within v6 (missing = 0), `texture` is required from v7,
  `blendMode` may be `multiply` or `screen` from v8, and `stamp`,
  `stampSpacing` and `stampHardness` are required from v9. `stampTexture` is
  required from v10. **v11 widens `blendMode`**: `overlay`, `soft-light`,
  `hard-light`, `color-dodge`, `darken`, `lighten`, `difference` and
  `exclusion` join `normal` / `multiply` / `screen`, and a v10 reader
  refuses a v11 file rather than rendering an unknown mode as `normal`.
  `document.guides` is **additive within v9 and later** (missing = no guides),
  because the guides are display-only.
- A release executable exists at `src-tauri/target/release/paka.exe` (unsigned,
  built before the fill, gradient, hardness, spacing/stabilizer, texture, blend
  mode, raster-budget, bounded-rasterization, stamp and colour-wheel slices);
  packaged-app verification is still outstanding, **except** for the settings
  commands, which were verified in a release build driven through UI
  Automation (see [docs/qa/T06-IMPLEMENTATION-REPORT.md](qa/T06-IMPLEMENTATION-REPORT.md)).
- Phase 2 (illustration tools) is complete. Phase 3 has hardness, spacing +
  stabilizer, grain texture, the stamp (dab) engine, the per-dab directional
  texture, the **brush preset library** and the **grid and snapping** shipped;
  brush-tip and image-based stamp textures remain. Phase 4 has the eleven layer
  blend modes (`normal` / `multiply` / `screen` plus eight separable modes),
  masks and groups remain. The colour panel gained the **contrast and
  colour-difference readout** and **wider input formats** (8-digit hex, `hsl()`,
  `oklch()`). Phase 0 gained three more correctness items: live-preview
  compositing inside its own layer, layer/history safety during a gesture, and a
  bounded document raster budget.

### Shipped slices (newest first)

| Commit | Slice |
| --- | --- |
| `feat/agent09-view-navigation` | **Status bar, zoom, pan and view navigation** - the status bar now reports what the engine actually holds: the file name and its unsaved marker, the document's size, the **active tool**, the **active layer**, the zoom, the history depth, the selection, the guides, the grid and the live cursor position. Every field is read from the engine's own snapshot, so none of them can drift away from the canvas, and a field that does not apply is not shown at all. The **zoom is an editable field**: it shows the zoom the canvas really has and takes a typed one (`150`, `150%` or `1.5x`), clamped to the range the viewport supports (2 %-6400 %), so it can never ask for a zoom the canvas cannot show; `Enter` commits, `Escape` throws the typing away. The zoom **buttons are bounded** - they grey out at the ends of the range - and a zoom keeps the point under the pointer where it is (the middle of the window when the pointer is elsewhere). The canvas can be **turned**: a 90° rotation (`Shift+R`) and a left-right mirror (`Shift+M`), with **Reset View** (`Ctrl+Shift+0`) putting it back the way it was found. The orientation is **view state**: it moves the canvas and nothing else, so it adds no history step, bumps no revision and never marks the file unsaved, and the status bar names the view while it is not upright. Panning has a third answer: the **space bar** held down turns any drag into a pan, so a user without a middle mouse button is not left out; the modifier only decides what a *new* press does, so a stroke in flight keeps drawing. **No project-format change.** |
| `feat/agent28-workspace-layout` | **Persistent workspace layout and editor preferences** - Paka now remembers how the window was arranged. A **Workspace** menu offers two real **profiles** - *Painting* (every panel up, the full brush controls, the designed size) and *Compact Canvas* (the side panels and the tool rail hidden, the interface smaller, so the canvas fills the window) - plus **Restore Workspace Defaults**. A profile is an **arrangement, not a label**: applying it puts the shell into that state, the side panels included, and the settings file keeps it, so the window comes back the way the user left it. The workspace also holds the **interface scale** (a `--ui-scale` token on the root element, so the whole shell grows and shrinks together), the **colour scheme** (a dark and a light one, the same token names either way) and the **brush panel's density** (the full controls or just the size and the opacity, and the preset row on or off). The profile the menu offers is **computed**, never trusted: a workspace the user arranged by hand is honestly called *Custom*. It is a **section of the settings file** under `workspace`, beside the panel layout's `panels` key - one file, one writer - and it is **shell state**, so rearranging the window is not an edit (no history step, no dirty flag) and nothing of it reaches a `.paka` file. A missing, corrupt or future-versioned workspace starts the app with the defaults and no error, and an out-of-range scale is clamped rather than rejected. The **status bar is not hideable**: it carries the outcome of the last file operation, and a preference that could swallow a failed save would be a lost message. **Reference-image metadata is deliberately not persisted** - a reference is session state, its placement is in workspace pixels and its file path is not kept, so there is nothing meaningful to restore without the pixels. **No project-format change.** |
| `feat/agent24-secondary-view` | **A second view of the canvas** - `View → New View of Canvas` opens a second canvas beside the main one, showing the **same** document through a transform of its own (its own zoom, pan, rotation and mirror, with **Fit** and **100 %** of its own). It is a second *window* on one document, never a second document: the engine keeps **one** document, **one** history and **one** dirty flag, and a view owns only its canvas, its transform and its size. A stroke drawn in either view is one stroke in one document and shows up in both at once; undo from either view undoes that one step; opening or closing the view changes no pixel, adds no history step and never marks the file unsaved; a PNG export is the document, not a view. The two views are two **display targets of one renderer**, so they share the rasterized layer surfaces and the in-progress stroke - the second view costs a projection of pixels that are already drawn, not a second copy of the artwork. Each view has its own input binding (a wheel over one moves that one), a press makes a view the **active** one, and the zoom, the fit and the rotation act on the active view. The selection is one thing and is drawn in both views. **No project-format change** - a view is display state, like the grid. |
| `feat/agent06-preset-browser` | **Brush preset browser** - the preset picker becomes a **Brushes panel**: a searchable, sortable list of the user's brushes and the **built-in** ones, each row showing a **real tip** - the mark the preset paints, drawn by the renderer's own code from the preset's own brush settings, so a property that changes a stroke changes the swatch. The list can be ordered by **name**, by **recent use** or by **size**, and narrowed to the **starred** brushes; a star is the user's own note and works on a built-in brush too. Every operation is wired to the engine: **save**, **rename**, **update** (write the live brush back into the preset), **duplicate**, **delete**, **star**, **import** and **export**. A **built-in brush is code**, so it cannot be renamed, overwritten or deleted - duplicating it is how the user gets a version they can change - and a deletion of the user's own brush is **confirmed** before it happens. The **live brush and the stored preset stay apart**: applying a preset copies its values into the brush, so an edit of the brush is visibly *not* an edit of the preset until it is written back, and the panel says which preset is in effect and whether it has been changed. A **library file** (`.json`) exports the user's brushes and imports somebody else's: a file that is not a library, one from a newer version, one that is too large and one with more than 200 brushes are **refused with a message**, a malformed entry is skipped and the rest is imported, and an imported brush gets a **fresh id and a name that does not clash**. Everything is editor state: applying or managing a preset adds no history step and never marks the drawing unsaved. Settings stay **version 1** - the three new fields are additive and a file without them loads unchanged. |
| `feat/agent18-gradient-editing` | **On-canvas gradient editing** - a committed gradient can now be **selected and its geometry edited** on the canvas. The gradient tool owns a selection of its own: a press on the gradient's **axis** (linear) or its **circle** (radial) selects it - the hit test is against the *geometry*, because a gradient paints its whole layer - and the **two handles** appear: the ends of the axis, or the centre and the radius handle. Dragging a handle replaces the record in place and re-rasterizes the layer, so the gradient follows **live**; the release records **one** undo step (`GradientEditCommand`, which carries the committed record and the one that replaced it), and a cancel - `pointercancel`, a tool switch or `Esc` - puts the committed record back **exactly**, with no history entry and no dirty flag. The handles are a **display overlay**: painted on the display canvas, never in a layer surface, a PNG export or the project file. The handle the user last grabbed is **focused**, and the arrow keys nudge it by one document pixel (`Shift`: ten), coalescing into one undo step. The status bar reads the selected gradient's geometry. **No project-format change** - the record already stored the two points the renderer draws from. The stops of a *committed* gradient are still not editable: the middle-stop editor describes the **next** drag, so an on-canvas stop marker would need a second, different data path. |
| `feat/agent04-panel-manager` | **Panel manager** - the shell's **shared panel registry** (`core/shell/panelRegistry.ts`) makes a panel **register itself**, so adding one to the shell means editing the panel's own module and nothing else, and the shell renders whatever the registry says. A **Panels** menu shows and hides the panels, folds them to their header and resets the layout; *Show All*, *Hide All* and *Reset Layout* sit in the same menu, and the two that would change nothing are disabled. **Hiding a panel gives the space straight back to the canvas** - the column's width follows its content - and it never loses the panel's state: a panel that keeps React state of its own stays mounted while it is hidden, and a panel derived from the document is unmounted. The layout is **shell state**, so showing a panel is not an edit (no history step, no dirty flag), and it is persisted in the **settings file as a section** under `panels`, so there is one settings file and one writer. The menu bar is keyboard driven: the arrow keys open a menu and walk its items, the disabled items are skipped, and `Escape` closes it and puts the focus back. |
| `feat/n1-brush-presets` | **Brush presets** - the brush panel can **save the current brush under a name**, switch between saved brushes, **rename** one and **delete** one, and the library survives a restart in the per-user settings file. Applying a preset goes through the normal brush setter, so it is **not an edit**: no history step, no dirty flag, nothing to undo. A preset stores every `BrushSettings` field (`stamp`, `stampTexture`, `texture`, `stabilizer`, `blendMode`, pressure and colour), and a **table-driven guard enumerates `DEFAULT_BRUSH`** so a field silently dropped by the reader fails a test instead of losing data - the exact bug that `stampTexture` hit in the phase-1 slice. Settings stay **version 1**: the preset list is additive and a file without it loads as an empty list. |
| `feat/n2-n3-colour-workflow` | **Colour contrast, colour difference and wider colour input** - the colour panel can compare the ink against the paper (**WCAG 2.2 contrast ratio**) and against a second colour, and names the palette swatch perceptually closest to the ink (**CIEDE2000**), computed from WCAG relative luminance, sRGB to CIELAB and the CIEDE2000 formula, with the published verification table as a test fixture. Contrast and colour difference answer different questions and neither is used as a proxy for the other. The readout is **read-only**: no control, no state, no history entry. The hex field now accepts **8-digit hex**, **`hsl()`/`hsla()`** and **`oklch()`**, clamps an out-of-gamut `oklch()` into sRGB, and keeps the stored colour a hex string, so there is **no project-format change**; garbage input reverts to the last valid colour, and a translucent colour is reported as **not a solid colour** rather than silently measured. |
| `feat/n6-blend-modes` | **Layer blend modes** - `overlay`, `soft-light`, `hard-light`, `color-dodge`, `darken`, `lighten`, `difference` and `exclusion` join `normal` / `multiply` / `screen` in the layer panel and the compositing path, mapped onto the platform's composite operation with the separable formula recorded in `core/document/blendModes.ts` and pinned by expected-pixel tests. `normal`, `multiply` and `screen` are **unchanged**. Format **v11**: a v10 file still opens, a v11 file is refused by a v10 reader instead of rendering an unknown mode as `normal`, and every mode round-trips through save and reopen. |
| `feat/t06-settings-persistence` | **Settings persistence** - the nine editor preferences (brush, tool, shape fill, shape sides, star inner ratio, shape rotation, fill tolerance, gradient type, gradient end colour) live in a per-user settings file in the OS configuration folder and are restored at startup. The file holds preferences only - never a drawing - and changing one is not an edit, so it adds no history step and never marks the document unsaved. A missing, corrupt or future-versioned file starts the app with the defaults and no error. The **autosave** machinery and its policy seam exist and are covered by tests, but the decisions that govern autosaving are the owner's, so nothing is enabled and no recovery file is ever written. |
| `feat/ff01-directional-texture` | **Per-dab directional texture** — a stamped stroke can carry **bristle lanes that run along the path**: each dab's coverage is multiplied by a lane pattern laid out in the dab's own frame, so the streaks rotate with the stroke. The lanes are measured against the brush's **centre line** (so every dab on a path sees the same offset at the same pixel, the union preserves the lanes instead of filling them in, and drawing a stroke backwards gives the same picture) and against the brush's **nominal size** (so the pattern is the same in document pixels at every `rasterScale`). The texture is multiplied in **before** the per-pixel maximum union, so it can only remove ink and a stroke still cannot darken. `stampTexture` is `0` by default, so every existing stroke is byte for byte unchanged. Format v10. |
| `feat/ff26-transform` | **Scale and rotate a selection** - the select tool's overlay grows **four corner handles** and a **rotation handle** above the frame. A corner handle scales the selection uniformly about the centre of its frame (the corner keeps its direction from the centre; the factor is clamped so a selection can never collapse or invert); the rotation handle turns it about the same centre, **snapping to 15 degrees** while the pointer is held down, with **`Shift` turning the snap off** for a free turn. The transform is **baked on apply**: it moves the selected strokes' samples and nothing else, so the brush, the colour, the opacity and the pressure are untouched and there is **no project-format change**. One undo step per transform, exactly like a move. The geometry is a pure module (`core/document/selectionTransform.ts`) with unit tests; the handles are display-only and never reach a layer surface or a PNG export. |
| `feat/n4-grid-snapping` | **Grid and snapping** - a **Grid** switch draws a lattice over the paper and a **Snap** switch makes the drawing follow the guides and the grid lines, with a **Spacing** control in **document pixels** (2-500), so the grid means the same thing at every zoom and pans with the paper. The snap is a **magnet**: a drawing point within **6 screen pixels** of a guide or a grid line lands exactly on it, and a point that is nowhere near one keeps its position. The tolerance is screen space, so the same physical gesture snaps alike at 100 % and at 400 %. The snap is applied in the engine's single pointer entry point, so the sample the user drew and the sample that was committed agree. Both switches are **view state**: no pixels change, no history step, no dirty flag, nothing reaches an export, and the settings survive a restart in the per-user settings file. **No project-format change** - the grid is not in the drawing at all. |
| `feat/t11-guides` | **Composition guides** (`U`) - a **Guides** tool places a vertical or horizontal guide by dragging on empty canvas (the axis follows the dominant drag direction, the position is the press coordinate) and moves an existing guide by dragging it. A click selects a guide, `Delete` removes it, `Esc` cancels a drag. A guide is document state (`DrawingDocument.guides`) but **display-only**: it is painted over the artwork and never reaches a layer surface or a PNG export, exactly like the selection overlay, so the project format change is **additive** and the version stays **9**. |
| `feat/t14-polygon-star` | **Polygon and star shape tools** (`P`, `S`) - a regular *n*-gon inscribed in the dragged box's ellipse (3-24 sides, a vertex at the top) and the classic *2p*-vertex star (3-24 points, an inner radius of 5-100 %), both with a rotation option, both fillable through the existing **Fill shape** switch. The options are editor state, read at press time; a shape is still an ordinary stroke, so there is **no format change**. |
| `dbcb446` | **HSV colour wheel** — a **Colour** panel with a disc (angle = hue, distance = saturation), a value slider and three keyboard-operable sliders. It writes the same brush colour the canvas picker and the toolbar's colour input write, so colour keeps one source of truth; the RGB↔HSV conversion is exact over the whole 8-bit sRGB cube. No format change: the brush colour is still `#rrggbb`. |
| `9b2aceb` | **Stamp (dab) brush engine** — a stroke can be drawn as a chain of round dabs placed along its path at a fixed arc-length interval, with the dabs' coverage unioned (a per-pixel maximum, so a stroke never darkens where it crosses itself) and a true per-dab hardness curve. The dabs are a pure function of the samples and the brush, so live drawing, commit, rebuild, undo/redo, reopen and export agree. Format v9. |
| `2fa34cc` | **Element-scratch variant reverted** — the experiment in `f7cf50c` was reverted: it bought nothing demonstrable, it differed by 1/255 of alpha on a few dozen pixels at rasterScale 2, and it would have moved the raster budget from 58 to 59 bytes per document pixel. The reverted commit stays in the history. |
| `4ac040b` | **Bounded layer rasterization** — a rebuild clears and blends only the rectangle each element inks, so the cost follows the stroke geometry instead of the document size (47x-187x less touched area); the pixels are unchanged. Measured in [PERFORMANCE_AUDIT_2026-10-20.md](PERFORMANCE_AUDIT_2026-10-20.md). |
| `520aa77` | **Preview scratch lifetime** — the grouped live-preview scratch is released whenever no preview is active (on end, on cancel, on a document or raster-scale change, and before an eraser takes its snapshot), so the erase snapshot and the scratch are never alive together and the raster budget's peak holds. |
| `21cd7c7` | **Finished-gesture notice reset** — a refused layer change explains once per gesture, and a finished gesture ends that state. |
| `fae138c` | **Honest peak raster model** — the budget models the peak surface set (three 2× surfaces plus a transient scan buffer, 58 bytes per document pixel) instead of four full surfaces; the 16,777,216-px cap is unchanged. |
| `372e7be` | **Refusal notice once per gesture** — a layer change refused during a gesture explains why once, instead of on every attempt. |
| `3580e82` | **Document raster budget** — a document may use at most 16,777,216 px in total (4096×4096), derived from a 1 GiB budget for the peak surface set; New Document and project loading enforce it before anything is allocated; format stays v8. |
| `4c68c89` | **Layer and history safety** — layer changes are refused while a gesture is in flight; undo/redo of a metadata change keeps the active layer; an action between two same-keyed changes ends the merge run. |
| `e1071d9` | **Live preview compositing** — the in-flight stroke is drawn in its own layer's slot, honouring that layer's visibility, opacity and blend mode; grouped path for a non-default layer opacity/blend. |
| `32e06bb` | **Layer blend modes** — `normal`, `multiply` and `screen` per layer, applied when the finished layer composites over the paper and lower layers; one undoable step, no re-rasterization; display, PNG export, bucket sampling and picker share the composite; format v8. |
| `59c4cd6` | **Grain texture** — deterministic document-anchored grain post-pass over the finished coverage (0-100 %); one `destination-in` pass, cached strength tiles, no self-darkening; brush/eraser/shapes; format v7. |
| `567a091` | **Brush spacing and stabilizer** — spacing exposed as sample density (2-200 % of diameter); exponential stabilizer (0-100 %) with a visible release settle; brush/eraser only; captured per stroke; additive within format v6. |
| `56b12ab` | **Brush hardness** — soft edges via one post-pass feather of the finished stroke silhouette; `hardness` captured per stroke, applies to brush/eraser/shapes; format v6. |
| `dc87f1d` | **Gradients** — first-class `GradientRecord` (linear/radial, two stops, opacity) in the ordered element list; live preview, one undo step; format v5. |
| `8b7152b` | **Bucket (flood) fill** (`F`) — `FillPatchRecord` in an ordered per-layer list; composite sampling, tolerance, cancel/undo/redo; format v4. |
| `84af123` | **Filled shapes** — toolbar **Fill shape** switch for rectangle/ellipse; `fill: true` on the stroke; format v3. |
| `e93c770` | **Bug-hunt round** on the transform slice (three test-first fixes). |
| `a3f4804` | **Nudge / duplicate / flip** for a selection, plus a Selection menu. |
| `253f5e4` | **Marquee selection and stroke moves**. |
| `636e43f` | **Line, rectangle and ellipse** shape tools (Shift constrain, Alt from centre). |

## 3. What the app can do

- **Drawing**: pointer/pen/touch, pressure-sensitive width and opacity, round
  joins/caps. Each stroke is composited once at its own opacity, so
  semi-transparent self-overlap never darkens. **Hardness** softens the finished
  stroke's outer edge in one pass: the interior keeps full coverage, self-overlap
  still cannot darken, and hardness `1` is the unchanged crisp edge. Presses
  outside the paper are ignored. The **live preview** composites inside its own
  layer, so it honours that layer's position, visibility, opacity and blend
  mode, and releasing the stroke never changes the stacking.
- **Eraser** (`E`): same footprint, subtracts coverage (`destination-out`);
  one undo step; survives save/reopen.
- **Shapes** (`L` line, `R` rectangle, `O` ellipse, `P` polygon, `S` star): live
  preview, one stroke = one undo step; `Shift` constrains (45°, squares, circles,
  a regular polygon or star), `Alt` draws from the centre. Rectangle/ellipse/
  polygon/star can be filled via the **Fill shape** switch; a line cannot.
  Shapes ignore pen pressure (constant width).
- **Polygon and star** (`P`, `S`): a regular *n*-gon (3-24 sides, default 5)
  inscribed in the **ellipse** of the dragged box with a vertex at the top, and
  the classic **2p-vertex** star (3-24 points, default 5) inscribed in the
  **same ellipse** (so a star's tips are a polygon's tips) with an **inner
  radius** (5-100 %, default 50 %). Both take a **rotation** (0-360°, default
  0°) about the box's centre - a rigid turn, so the shape keeps its size -
  because the selection cannot rotate. The three
  options are editor state (not undoable, not dirtying, read at press time) and
  are shared: the slider is labelled **Sides** for the polygon and **Points**
  for the star. The shape's own box is not the drag's box: the polygon's own
  box **equals** the drag's box when the side count is a multiple of four, is
  **narrower in one axis** when the side count is two more than a multiple of
  four, and is **smaller in both axes** when the side count is odd; and a
  rotated shape swings off the ellipse, so its box can be **larger** than the
  drag's box in one axis - and smaller in the other.
- **Bucket fill** (`F`): flood-fills the region under the pointer and writes a
  bounded pixel-exact patch to the active layer. **Sample** picks what the
  region is measured against - the **merged** visible composite, the **active**
  layer alone, or **one layer** of the document's own; a hidden layer never
  contributes and the `one layer` mode refuses it with a notice.
  **Tolerance** 0–255 per-channel; transparent pixels match each other.
  **Grow / shrink** (-32…+32 px) reshapes the region from its boundary with an
  exact Euclidean distance transform, **Soft edge** (0–8 px) turns the boundary
  into a coverage ramp, and **Close gaps** (0–16 px) seals a passage too narrow
  for the fill to leak through. The mask is a coverage byte per pixel, replayed
  on redo/reopen; documents over 16,777,216 px refuse the scan with a
  status-bar notice.
- **Gradients** (`G`): drag to paint linear or radial (toolbar **Radial**
  switch) from the brush colour to the **To** colour, at brush opacity. Real
  preview element, one undo step, cancel removes it. Paints the whole layer in
  element order; no angle snapping. The middle-stop editor adds middle stops
  for the **next** drag.
  A committed gradient can be **edited on the canvas**: press its **axis**
  (linear) or its **circle** (radial) to select it - the hit test is against
  the geometry, because a gradient paints the whole layer - and its **two
  handles** appear (the ends of the axis, or the centre and the radius
  handle). Dragging a handle previews the new geometry live and records **one**
  undo step on the release; `Esc` (or a lost capture) restores the committed
  gradient exactly and records nothing. The handles are a display overlay only:
  no layer surface, no PNG export, no project file. The last grabbed handle is
  **focused**, and the arrow keys nudge it (1 px, `Shift` 10 px, coalesced into
  one undo step); the status bar reads the selected gradient's geometry. The
  stops of a committed gradient are still not editable.
- **Selection/transform** (`M`): marquee or click selects whole strokes of the
  active layer; drag moves them; the four **corner handles** scale the
  selection and the **rotation handle** above the frame turns it; arrow keys
  nudge (1 px, `Shift` 10 px, coalesced); `Ctrl+D` duplicates;
  `Ctrl+Shift+H`/`V` flips; `Delete` removes; `Esc` cancels; all one undo step
  each and mirrored in the **Selection** menu.
  Selection is an overlay only, never serialized or exported, and painting is
  not clipped to it.
  A **scale** is uniform and about the centre of the selection's frame: the
  corner keeps its direction from the centre, so dragging away from the centre
  grows the selection and dragging towards it shrinks it, and the factor is
  clamped so a selection can never collapse or invert (5 % is the floor). A
  **rotation** is about the same centre; the angle is the pointer's compass
  angle clockwise from "up", it **snaps to 15 degrees** while the pointer is
  held down, and **`Shift` turns the snap off** for a free turn. Both are
  measured **from where the press landed**, so a press that misses the handle
  by a little does not jump the content. Both are
  **baked on apply**: the transform moves the strokes' samples and nothing else,
  so the brush, the colour, the opacity and the pressure are untouched, a
  scaled stroke is still the same stroke, and there is **no project-format
  change**. The handles belong to the **committed selection**: they appear on
  its frame and never on a marquee's rubber band.
- **Colour picker** (`I`): samples the merged composite at the pointer, stays
  selected, is not an edit.
- **Preferences survive a restart**: the brush, the tool, the shape options, the
  fill tolerance and the gradient settings are stored in a per-user settings file
  in the operating system's configuration folder (`%APPDATA%\com.paka.drawing\
  settings.json` on Windows) and restored at startup. The file holds
  preferences only - never a drawing - and changing one is not an edit, so it
  adds no history step and never marks the document unsaved. A missing, corrupt
  or future-versioned file starts the app with the defaults and no error.
- **Composition guides** (`U`): a dedicated **Guides** tool. Drag on empty canvas
  to place a guide - the axis follows the dominant direction of the drag and the
  position is the **press** coordinate, so the guide marks where the drag
  started. The drag has to travel **3 screen pixels** before its direction
  decides the axis, so **a shorter drag creates no guide at all** (it is a
  click). Drag an existing guide to move it along its own axis; a click selects
  it, `Delete` removes it, `Esc` cancels a drag in flight. A guide is document
  state but **display-only**: it is painted over the artwork and never reaches a
  layer surface or a PNG export, so the format change is additive and the file
  version stays 9.
- **Grid and snapping**: a **Grid** switch draws a lattice over the paper and a
  **Snap** switch makes the drawing follow the guides and the grid lines; the
  **Spacing** control sets the distance between the lines in **document pixels**
  (2-500), so the grid means the same thing at every zoom and pans with the
  paper. The snap is a **magnet**: a drawing point within **6 screen pixels**
  of a guide or a grid line lands exactly on it, and a point that is nowhere
  near one keeps its position. The tolerance is screen space, so the same
  physical gesture snaps alike at 100 % and at 400 %. The snap is applied in
  the engine's single pointer entry point, so the sample the user drew and the
  sample that was committed agree. Both switches are **view state**: no pixels
  change, no history step, no dirty flag, nothing reaches an export, and they
  are remembered in the per-user settings file. `Ctrl+'` and `Ctrl+Shift+'`
  toggle them. No rulers yet.
- **HSV colour wheel** (the **Colour** panel): a disc where the angle is the
  hue and the distance from the centre is the saturation, a value slider, and
  three sliders naming the same numbers. It writes the brush colour through
  `setBrush`, so it follows a colour picked off the canvas and the toolbar's
  colour input; the sliders are keyboard-operable; choosing a colour is not an
  edit.
- **Brushes**: size 1–512 doc px, opacity, hardness (0–100 %, applied to brush,
  eraser and shapes), sampling (2–200 % of diameter, sample density),
  stabilizer (a **mode** — off, smooth or pull — and a 0–100 % strength; brush
  and eraser only), texture (0–100 %, deterministic
  grain over the finished coverage, applied to brush/eraser/shapes), a **stamp**
  switch with **stamp spacing** (2–100 % of the brush size, the distance
  between dabs), **stamp hardness** (the falloff of one dab) and **stamp
  texture** (the strength of the bristle lanes) — all four brush and eraser
  only — colour + 8-swatch palette, pressure size and pressure
  opacity toggles. All settings are captured per stroke.
- **Brush library**: a **Brushes** panel lists the saved brushes and the
  **built-in** ones, with a search box, an order (name, recent use, size) and a
  **starred** filter. Each row shows the **real tip** — the mark the preset
  paints, drawn by the renderer's own code from the preset's own brush — plus
  its name, whether it is the brush in effect and whether the brush has been
  changed since it was applied. A brush can be saved, renamed, overwritten
  (**update**), duplicated, deleted (with a confirmation), starred, and
  exported to or imported from a **library file**. A **built-in brush is code**:
  it cannot be renamed, overwritten or deleted, but it can be starred and
  duplicated. Applying a brush is not an edit: no history step, no dirty flag.
- **Brush controls**: every numeric property is a slider **and** an exact number
  box, and the two speak the same unit: the box asks for `50` for 50 % beside a
  readout that says `50%`, not `0.5`. The number box is a text field first: an
  empty or half-typed value never reaches the editor, and a value outside the
  range is corrected in place rather than silently ignored. The keyboard moves
  a value in three steps — an arrow key by the field's own step, `Shift`+arrow
  by a tenth of it (the fine adjustment), `Page Up`/`Page Down` by ten times it
  — and the brush size moves proportionally, so the step is a pixel at 6 px
  and ten percent at 100 px. **Reset** restores the brush to the defaults it
  came from: the preset's own values when the brush is based on a preset, the
  factory default otherwise. The preset's defaults and the edited values are
  kept apart, so editing a slider does not change the preset until it is
  written back.
- **Live brush preview**: the options bar carries a swatch that shows what the
  current brush draws, on the document's own paper. It is drawn by the
  engine's own primitives — the segment rasterizer, the stamp engine's dab
  plan, the hardness feather and the grain — so a property that changes a
  stroke changes the swatch the same way. It is redrawn when the brush
  changes and at no other time: it never touches the document, and no pointer
  sample reaches it. The swatch is zoomed so the brush fits it, so it shows
  the *shape* of the mark; the size is read from the number box beside it.
- **Stamp (dab) brush**: with the stamp on, a stroke is a chain of round dabs
  placed along its path instead of round-capped segments. The dabs' coverage is
  unioned (a per-pixel maximum), so overlapping dabs and a self-crossing stroke
  never darken, and the stroke's opacity is still applied once. Each dab has a
  true hardness curve: a falloff inside the dab rather than a blur of the
  finished silhouette. The dabs are a pure function of the samples and the
  brush, so live drawing, undo/redo, reopen and export agree.
- **Per-dab directional texture**: with the stamp texture on, each dab's
  coverage is multiplied by bristle lanes that run **along** the path, so a
  stroke reads as a bundle of streaks rather than a line of dots, and the lanes
  rotate with the stroke. The texture is multiplied in **before** the union, so
  it can only remove ink and the union is still a maximum. The lanes are laid
  out against the brush's centre line, so the picture does not change when a
  stroke is drawn backwards, and they are measured against the brush's nominal
  size, so the pattern is the same in document pixels at every `rasterScale`.
- **Navigation**: wheel scroll, `Shift+Wheel` horizontal, `Ctrl`/`Alt+Wheel`
  zoom at cursor, pan tool / middle drag / **space-drag**, zoom buttons, actual
  size, fit, reset. The zoom buttons stop at the ends of the range the canvas
  supports, and the status bar's zoom field takes a typed one.
- **View orientation**: the canvas can be turned 90° (`Shift+R`) and mirrored
  left to right (`Shift+M`); **Reset View** (`Ctrl+Shift+0`) puts it back
  upright. It is *view* state: no pixel changes, no history step, no dirty
  flag, and nothing reaches an export.
- **Navigator**: a panel under the layers shows the whole document with the
  visible area marked. A click outside the marked area jumps the view there, a
  drag inside it keeps the artwork under the pointer, and the arrow keys pan
  it when it has the focus. The panel shows the zoom and offers **Fit** and
  **Centre**. It is a view of the document: no pixels change, no history step,
  no dirty flag, and nothing reaches an export. The overview is a downscale of
  the cached composite and is rebuilt only when the document changes, so a pan
  or a zoom costs nothing.
- **A second view of the canvas** (`View → New View of Canvas`): a second
  canvas beside the main one, showing the **same** drawing through a transform
  of its own — its own zoom, pan, rotation and mirror, with **Fit** and
  **100 %** buttons of its own. It is a second *window* on one document, not a
  second document: a stroke drawn in either view is one stroke in one
  document, it shows up in both views at once, and undo from either view undoes
  that one step. Opening or closing the second view changes no pixel, adds no
  undo step and never marks the drawing unsaved, and a PNG export is the
  document rather than a view. The two views are two **display targets of one
  renderer**, so they share the rasterized artwork and the in-progress stroke:
  the second view costs a projection of pixels that are already drawn, not a
  second copy of them. Each view has its own input binding, so a wheel over one
  moves that one; a press makes a view the **active** one, and the zoom, the
  fit and the rotation act on the active view. The selection is one thing and
  is drawn in both views.
- **Layers**: add, duplicate, delete, rename (double-click), reorder, visibility,
  opacity, blend mode (`Normal`, `Multiply`, `Screen`) and selection. A blend
  mode combines the finished layer with the paper and every lower layer. Layer
  edits are undoable (including the deleted layer's elements) and are **refused
  while a gesture is in flight**, so a release can never commit into a layer
  that was removed mid-drag.
- **History**: 200 commands; one step per gesture; a slider drag is one step.
- **Panels**: the **Panels** menu shows and hides the side panels (the colour
  wheel, the layers, the navigator), folds them to their header and resets the
  layout; *Show All*, *Hide All* and *Reset Layout* sit beside them. Hiding a
  panel gives its space straight back to the canvas, and it never loses the
  panel's state: a panel that keeps state of its own stays mounted while it is
  hidden, and a panel that reads the drawing is unmounted. The layout is shell
  state (showing a panel is not an edit) and it survives a restart in the
  settings file, under the `panels` key. The menu bar is keyboard driven: the
  arrow keys open a menu and walk its items, and `Escape` closes it.
- **Projects**: `File → New/Open/Save/Save As` (`Ctrl+O`, `Ctrl+S`,
  `Ctrl+Shift+S`), versioned `.paka` with ordered layer content (stroke samples,
  fill masks, gradient geometry), atomic writes, dirty indicator, discard guard.
  `Ctrl+N` is **not** bound; use the menu/dialog.
- **PNG export**: full composite at document size, honours layer visibility,
  opacity and blend mode, leaves the document untouched.
- **Status bar**: document size, active tool, active layer, zoom (editable),
  history depth, selected count, cursor position, file name/messages,
  `● unsaved`.
- **HiDPI**: layer surfaces rasterized at up to 2×, display follows DPR.
- **New document**: 8–8192 px per side and at most 16,777,216 px in total,
  validated. The total limit is a raster-memory budget (three 2× RGBA surfaces
  plus a transient scan buffer, 58 bytes per document pixel, inside 1 GiB), so
  a large document cannot ask for a multi-gigabyte surface.

## 4. Code map

```
src/
  app/          entry, provider wiring, global styles
  components/   shell: menu bar, toolbars, panels, icons
  features/     canvas, brushes, colour, layers, history, document,
                project (file commands/dialogs/title/close guard),
                shapes, fill, gradient
  hooks/        React bindings, keyboard shortcuts, native environment
  state/        editorStore (snapshot + intents) and context,
                panelStore (the panel layout) and context
  core/
    panels/     the panel manager's adapter over the shell's panel registry,
                the layout rules and the layout's settings section
    shell/      the shared shell contracts: the panel registry, the slots
    document/   document/layer metadata, ordered element store, selection,
                guides (the guide model, geometry and document operations),
                selectionTransform (the scale/rotate geometry) and
                selectionHandles (the transform handles)
    brushes/    defaults/normalization, strokeBuilder (sample capture)
    fill/       pure flood scan, fill-patch record
    gradient/   gradient geometry/stops/cloning
    tools/      registry, per-tool behaviour, shape geometry
    commands/   command stack, stroke/fill/gradient/document commands
    input/      pointer normalization, DOM binder
    rendering/  viewport, frame scheduler, Canvas2DRenderer, canvas2dStroke,
                stampCoverage (dab placement + coverage union)
    engine/     DrawingEngine: integration, gestures, history, snapshot
    project/    format v9, gateway port, file orchestration
    export/     PNG export
  types/        shared value types
  utils/        math, colour, ids, paths, store
src-tauri/      Rust shell: environment probe, scoped project/PNG I/O
docs/           architecture, format, roadmap, handoff, this brief
```

Key files for the next slice (directional / per-dab stamp textures):

- `src/core/rendering/stampCoverage.ts` — the dab plan (`stampDabs`, the cursor),
  the coverage union (`StampCoverage.paintDab`) and the per-dab texture
  (`STAMP_TEXTURE_LANES`, `stampTextureLaneWidth`); a brush **tip** would
  replace the radial profile inside `paintDab`, and the tile upload has to
  stay bounded.
- `src/core/rendering/Canvas2DRenderer.ts` — `rasterizeStampStroke`,
  `extendStampStroke`, `writeStampCoverage`; the coverage buffer, the
  single-alpha composite and the post-dab grain are the invariants a brush tip
  must keep.
- `src/types/brush.ts` / `src/core/brushes/defaults.ts` — brush fields
  (a tip descriptor) and defaults/clamping/equality.
- `src/features/brushes/BrushControls.tsx` — controls for real tip settings.
- `src/core/document/types.ts` — `StrokeRecord`/`brush`, the authoritative record.
- `src/core/project/projectFormat.ts` — `PROJECT_VERSION`, `readBrush`,
  serializer; a tip descriptor that changes the pixels needs v11.
- Tests: `stampCoverage.test.ts`, `canvas2dRenderer.test.ts`,
  `projectFormat.test.ts`, `drawingEngine.test.ts`.
- `src/test/support/recordingCanvas.ts` — fake canvas used by renderer tests.

## 5. How work is done here (non-negotiable)

1. **One complete, verified vertical slice per session.** End-to-end, testable.
   No placeholder buttons, no half-wired tools. A tool that is not part of the
   slice stays absent.
2. **Never claim a test passed unless it was actually run.** Report automated,
   browser and real-device verification separately and honestly.
3. **Docs move with behaviour** in the same commit: `README.md`,
   `docs/ARCHITECTURE.md`, `docs/PROJECT_FORMAT.md`, `docs/ROADMAP.md`, and this
   brief / `docs/HANDOFF.md` when the state changes.
4. **Commit messages are never inline in PowerShell.** Write the message to a
   file and use `git commit -F <file>` (PowerShell mangles quotes/newlines).
   Prefix subjects with `feat:`, `fix:`, `docs:` or `test:` and describe the
   user-visible change.
5. **Do not run cargo while `paka.exe` is running** — it locks
   `src-tauri/target/debug/*.dll` (`os error 32`).
6. **The React layer has no automated tests**; verify it manually in the running
   app. Do not add a React test framework as a side effect of another slice.
7. **Every new behaviour gets a regression test with it**, written against the
   behaviour, not the implementation.
8. Finish with `pnpm test`, `pnpm typecheck`, `pnpm build`, a real browser check,
   docs updates, commit and push.

## 6. Settled decisions — do not re-litigate without new evidence

- **Element model**: each layer has one ordered `LayerElement[]`
  (`StrokeRecord | FillPatchRecord | GradientRecord`). `strokeStore` is the
  authoritative list; `listStrokes` is a filtered view for stroke-only features.
  `kind: "fill"` and `kind: "gradient"` are discriminators; a stroke has no
  `kind`.
- **Strokes are self-describing**: `brush`, `erase?`, `fill?`, sample arrays
  (`xs`, `ys`, `pressures`, `times`). Re-rasterizing never consults tool state.
  Anything that changes appearance must therefore live on the stroke record
  (or the format cannot reproduce it).
- **Opacity is applied once per stroke**, when its full-coverage buffer
  composites. Segments are always drawn at alpha 1. Never lower per-segment
  alpha to fake softness: overlapping translucent segments reintroduce
  self-overlap darkening.
- **A blend mode is composite-stage layer metadata, not stroke data.** It maps
  to the Canvas 2D `globalCompositeOperation` used when the finished layer
  surface is drawn over the paper and lower layers (`normal` → `source-over`,
  else `multiply` / `screen`). Changing it does not dirty layer pixels or
  re-rasterize; it is one undoable document command and one repaint.
  `paintDocument` is shared by display, PNG export and bucket sampling, and
  `readCompositePixel` (picker) follows the same order. No per-stroke blend,
  group/clipping context or alpha inheritance yet.
- **Hardness is a post-pass feather of the finished silhouette.** The brush
  field is `0..1`, default `1`; `strokeFeatherRadius = size * 0.1 * (1 -
  hardness)` document px, and `0` keeps the old raw-buffer path byte-identical.
  A soft stroke blurs one copy of the stroke buffer in a reused scratch canvas
  sized to its padded bounding box (radius + three blur radii), scaled by
  `rasterScale`, then composites it through the same `paintStrokeCoverage` as
  live drawing, commit, rebuild and eraser. Opacity is still applied once, so a
  soft stroke cannot darken at self-overlap. The trade-off is a Gaussian edge
  that extends slightly beyond the nominal diameter; it is not an exact hardness
  cone or a stamp engine.
- **Spacing means sample density, not stamp spacing.** `spacing` is
  `0.02..2` of the diameter, default `0.12`; the builder interpolates with
  `max(0.75 px, spacing * size)`, capped at 96 points per event and skipped for
  jumps over `MAX_INTERPOLATION_DISTANCE`. It changes stored samples and
  pressure-ramp smoothness, never the nominal width.
- **The stabilizer filters the path, and only the path.** `stabilizer` is `0..1`,
  default `0`, and `stabilizerMode` is `off` | `smooth` | `pull`, default
  `smooth`. The filter lives in `core/brushes/stabilizer.ts` and is a
  capture-time filter: what it produces is what the stroke stores, so live
  drawing, undo/redo, reopen and export replay exactly what was shown. The
  **strength is a time constant**, not a share of the distance, so the same
  gesture is filtered the same way at 60 Hz and at 240 Hz (measured: a 100 px/s
  drag trails the pointer by 4.43 px at every rate). `smooth` shortens that
  time constant as the pointer speeds up, so a slow gesture is smoothed hard
  and a fast one is followed closely; the speed is the **median** of the recent
  steps over six raw samples, and a step much larger than the recent travel
  (a flick) opens the filter at once. `pull` is the rubber band: the captured
  point trails the pointer by a fixed *time*, so the trail grows with the
  speed. The **pressure and the time are the device's own** - the filter moves
  the point, not the pressure - and the brush's pressure curve is applied
  later, at rasterization. The release runs a short **catch-up** of at most
  four points whose last point is the release point **exactly**, so the stroke
  ends where the pointer was released with no hidden post-process. It applies
  to brush and eraser, not shapes.
- **`stabilizer` is additive within format v6 and `stabilizerMode` within
  v12.** They shape samples that are already stored, so an older reader
  ignoring them still renders the same picture; a missing field reads as `0`
  and `smooth`. `spacing` was already in v6.
- **Texture is one deterministic grain post-pass.** `texture` is `0..1`, default
  `0`; above `0`, `paintStrokeCoverage` copies the stroke (feathering first) and
  fills the copy with a cached 128×128 white grain tile under `destination-in`.
  The tile comes from `textureCoverage(index, strength)` (fixed hash, no random),
  and the pattern transform anchors it to document coordinates, so live,
  commit, rebuild, undo/redo, reopen and export agree at every bbox, zoom and
  `rasterScale`. Alpha is multiplied once, so self-overlap cannot darken. It
  applies to brush/eraser/shapes; a filled shape's interior grains too. It is not
  a stamp/per-dab or directional texture.
- **Preview vs commit**: press inserts real preview content (or starts a buffer),
  moves update it in place, release records exactly one command, cancel /
  lost capture / tool switch / over-ceiling removes it with **no history and no
  revision bump**. The preview is composited **inside its own layer** - after
  that layer's committed content and before any layer above it - so it honours
  the layer's visibility, opacity and blend mode, and the release produces the
  same picture the user watched. A layer with `opacity < 1` or a `multiply` /
  `screen` blend groups the layer and the stroke in one reused scratch canvas,
  because the layer's alpha and blend apply to the *finished* layer.
- **A layer change during a gesture is refused.** A stroke, fill, gradient or
  selection drag owns content that is not in history yet, and a layer edit
  could remove the layer the preview is being painted into, so the release
  would commit into a layer that is no longer in the document. The engine
  answers with a notice and changes nothing; the finish and cancel paths
  discard a preview whose layer has vanished.
- **Undo/redo of a metadata-only layer edit keeps the active layer.** Rename,
  visibility, opacity, blend mode and reorder no longer restore whichever
  layer happened to be active when the edit was made, so undo does not move
  the user off the layer they are looking at, and does not drop the selection.
  Structural commands (add, delete, duplicate) still own the active layer.
- **A merge barrier separates gestures.** An action that is not part of the
  same continuous gesture - selecting a layer, changing the brush, a tool or
  the selection, moving the viewport, an undo or a redo - ends a merge run, so
  two same-keyed changes separated by it stay two undo steps.
- **A document is bounded by total pixels, not only by side length.** At most
  16,777,216 document px, from an explicit 1 GiB budget for the peak surface
  set: three 2x RGBA surfaces (the layer surface, the stroke buffer, and at
  most one of the erase snapshot or the grouped live-preview scratch) plus a
  transient scan buffer - 58 bytes per document pixel (`3 x 4 * 2^2 + 10`),
  928 MiB at the cap. Enforced in the document model and in the project parser
  before anything is allocated; the file format version is unchanged.
- **A shape is an ordinary stroke** whose samples trace the outline;
  `fill: true` fills the polygon before tracing the outline. No geometry type.
- **The stamp engine is a rasterization strategy, not a new kind of content.**
  With `stamp` off the stroke is the legacy round-capped segment path, byte for
  byte; with it on it is a chain of round dabs placed along the stored polyline
  at a fixed arc-length interval (`stampSpacing * size` document pixels). The
  dabs' coverage is combined with a **per-pixel maximum** (a union), because
  Canvas 2D has no max-alpha composite; the stroke's opacity is still applied
  once, so overlapping dabs and a self-crossing stroke never darken. Each dab
  carries its own hardness curve (`stampHardness`), a falloff inside the dab
  rather than a blur of the finished silhouette; the stroke-level hardness
  feather and the grain post-pass still run over the finished coverage. The
  dab plan is a pure function of the samples and the brush - no randomness, no
  clock, no zoom, no `rasterScale` - so live drawing, commit, rebuild,
  undo/redo, reopen and export agree. The plan does not depend on the sample
  density, so `spacing` stays non-appearance-changing. The stamp applies to the
  brush and the eraser; shapes keep the segment path and record the stamp
  fields as unused. The coverage map is bounded by the stroke's own footprint
  (like the feather scratch), so the raster budget does not move: the cache
  uses up to 8 of the 10 bytes per document pixel of transient allowance, and
  the upload to the stroke buffer is one 16 KB tile at a time.
- **The per-dab directional texture rides inside the dab's profile.**
  `stampTexture` multiplies a dab's coverage **before** the union, so it can
  only ever remove ink and the union is still a maximum. The lanes run along
  the path, in the dab's own frame, and are laid out against the brush's
  **centre line** rather than against the side of it - which is what makes
  every dab on a straight path see the same offset at the same pixel, so the
  lanes survive the union instead of being filled in, and why the picture does
  not change when a stroke is drawn backwards. The lanes are measured against
  the brush's **nominal size**, so the pattern is anchored to the document and
  is the same in document pixels at every `rasterScale`. The lane's own width
  and offset come from a fixed 32-bit hash of the lane index - the same idiom
  the grain uses - so nothing depends on a clock, a random seed or the order
  the dabs are painted in. `0` is the plain round dab, byte for byte.
- **The first dab has no direction.** It carries the angle `0`, because the
  path has not continued yet and a dab's direction must not depend on samples
  that arrive later; the live path could not unpaint it if it did. Its lanes
  are therefore laid out along the document's x axis rather than along the
  stroke, and the neighbouring dabs overlap it.
- **A fill is a pixel patch**, not a traced contour: colour, tight bbox, a
  coverage mask (a byte per pixel, so a soft edge is a ramp and a hard edge is
  a step). Redo/reopen replay the mask, never re-run the flood. The coverage
  has always been read as the patch's alpha, so a ramp needs **no** project
  format change.
- **The bucket's reference mode decides exactly what the region is measured
  against.** `merged` reads every visible layer, `active` reads the active
  layer alone and `layer` reads one chosen layer; the renderer composites
  exactly those layers and nothing else. A hidden layer never contributes, so
  the `layer` mode refuses the press with a notice rather than sampling the
  paper alone and filling the whole canvas.
- **The bucket's growth and soft edge are measured from the region's boundary
  with an exact Euclidean distance transform**, over the region's own bounding
  box, never over the document. The distance is to a pixel's centre, so the
  numbers mean the same thing at every zoom and at every raster scale.
- **The gap closing seals a passage no wider than the setting**, measured along
  a row or a column: a matching pixel with a barrier within the radius on both
  sides and a passage between the two barriers no wider than the radius is
  sealed. A region narrower than the radius is itself a passage, so it is
  sealed too - that is the rule's one visible consequence, and it is the point
  of the control. Diagonals are deliberately not scanned: two walls meeting at
  a corner look like a one-pixel passage and sealing it would cut the corners
  off every boxy shape.
- **A gradient is geometry + stops**, not pixels; radial = fixed centre, radius
  by distance, inner radius 0. Endpoints clamp to the document.
- **A gradient's geometry is editable, and the edit is a record replacement.**
  The gradient tool owns a selection of its own, and the selection is hit
  against the gradient's **geometry** (the axis of a linear gradient, the circle
  of a radial one) because a gradient paints its whole layer: every point of the
  paper belongs to it, so only the geometry can say which one is meant. A drag
  replaces the record in place - same id, same place in the painting order -
  and the release records **one** `GradientEditCommand` carrying both the
  committed record and the one that replaced it, so undo restores the original
  exactly. A cancel restores the committed record **exactly** and records
  nothing. The handles and the line are a **display overlay**: painted on the
  display canvas, never in a layer surface, an export or the project file. The
  selection is editor state, so it is dropped when the tool, the layer or the
  gradient itself goes away. The stops of a committed gradient are not editable:
  the middle-stop editor describes the **next** drag, so its stops are editor
  state and an on-canvas stop marker would need a second data path.
- **Editor options describe the next gesture and are not serialized**:
  `shapeFill`, `shapeSides` (3-24, default 5), `shapeInnerRatio` (0.05-1,
  default 0.5), `shapeRotation` (0-360°, default 0), `fillTolerance` (default
  24), `gradientType`, `gradientEndColor`. Each is read at press time so the
  committed record keeps the setting it was drawn with. Changing an option is
  not an edit. The brush is the
  same: the current brush is session state, while every stroke stores the
  full brush it was drawn with, including `hardness`, `spacing`, `stabilizer`,
  `texture`, `stamp`, `stampSpacing`, `stampHardness` and `stampTexture`.
- **Preferences are session state that happens to survive a restart.** The
  settings file holds the nine editor preferences and nothing else: no
  drawing, no document, no history. Restoring them goes through the engine's
  editor-state setters, so a restored preference costs no history entry, no
  revision bump and no dirty flag - the same contract the brush settings have
  always had. The file lives in the OS configuration directory, its path is
  owned by Rust (the WebView never learns it), and it is written with the
  same atomic replace the project file uses. Every field is validated on the
  way in: a missing field takes its default, an out-of-range value is clamped,
  a malformed value takes its default, and a file from a newer version is
  ignored wholesale. A corrupt settings file cannot stop the editor from
  starting.
- **The colour wheel is a view of the brush colour, not a second source of
  truth.** The brush still stores an `#rrggbb` string, and the wheel writes
  through the same `setBrush` path as the toolbar's colour input, the swatches
  and the canvas picker, so colour has one place and a colour picked off the
  canvas moves the wheel. `rgbToHsv` and `hsvToRgb` are exact inverses over
  the whole 8-bit sRGB cube, and a grey reports hue `0` with saturation `0`.
  The wheel keeps the hue and saturation the *user* asked for while the brush
  holds the colour the wheel wrote, because the 8-bit grid is coarse on a dark
  colour - the default `#16181c` stores a hue of 205° as a colour whose own
  hue is 220° - and any colour changed elsewhere replaces it with the stored
  colour. Choosing a colour is session state for the next gesture, not an
  edit.
- **Format versioning**: a bump is required when an older reader would render a
  *different picture*, not for convenience. v1–v3 use `layers[].strokes`, read
  as stroke elements; v4 adds fills and `layers[].elements`; v5 adds gradients;
  v6 requires `hardness` on every stroke brush and reads v1–v5 strokes as hard
  (`1`); `stabilizer` was added additively within v6 (missing = `0`) because the
  smoothed path is already stored in the samples; v7 requires `texture` because
  an older reader would draw a textured stroke plain; v8 allows `multiply` and
  `screen` blend modes because a v7 reader rejects them rather than drawing them
  as `normal`; v9 requires `stamp`, `stampSpacing` and `stampHardness` because
  an older reader would draw a stamped stroke as the segment path; v10 requires
  `stampTexture` for the same reason - an older reader would draw the same
  stamped stroke as plain dabs; unknown/newer
  versions are rejected outright, as are v4 files containing a gradient.
- **Selection stores `{ layerId, strokeIds }` only**; the overlay is
  display-only. Transforms are `original + delta` from pre-drag copies, so undo
  restores painting order. Undo/redo are refused during a selection gesture.
- **Dirty state** compares a mutation counter with the counter at last
  save/load; undoing back to the saved revision does **not** clear dirty.
- **History is capped at 200 commands** and is not stored in the project file;
  reopening rebuilds one step per element.

## 7. Known limitations / open gaps

Product:

- No text tool; only brush, eraser, select, line, rectangle, ellipse, polygon,
  star, bucket, gradient, picker, guides, pan.
- Shapes: a committed shape stores its **points**, not its kind, so a polygon or
  a star cannot be re-edited as one - it is an ordinary stroke afterwards. There
  is no rotation *gesture* (the option covers the need), no irregular polygon,
  no per-vertex handles, and the polygon's and the star's options are session
  state: they are not persisted, and they are shared between the two tools.
- A layer is still re-rasterized from scratch when it changes, but the rebuild is
  bounded by each element's own footprint: it clears and blends only the rectangle
  the element inks, so the cost follows the stroke geometry instead of the
  document size (measured 47x-187x less touched area for strokes that ink a small
  part of the document, about 1.1x for strokes that cover it). What is left is a
  per-draw cost charged for the document-sized layer surface, which needs a
  profile in the packaged app before the surfaces can be restructured; measured
  numbers, their environmental limits and that recipe are in
  [PERFORMANCE_AUDIT_2026-10-20.md](PERFORMANCE_AUDIT_2026-10-20.md).
- Gradients: whole-layer, no stop editor for a *committed* gradient (the
  middle-stop editor describes the next drag), no angle snapping, no
  transparent stop, and the gradient cannot be moved/duplicated/flipped - but
  its **geometry is editable**: the gradient tool selects a gradient by its
  axis (linear) or its circle (radial) and shows two handles, and a handle
  drag previews live, commits as one undo step and is restored exactly by a
  cancel.
- Fills: a committed raster patch with a coverage mask, so the region itself is
  not editable; no pre-commit preview, not selectable. The **Close gaps** rule
  seals a passage no wider than the setting, so a region narrower than the
  setting is sealed too, and only the rows and the columns are scanned - a
  wall at an angle is not sealed. The **Soft edge** is a point-sampled ramp,
  so a one-pixel-wide region is covered at three-quarters rather than a half.
- Hardness: a single Gaussian feather of the finished silhouette, so the edge
  extends slightly beyond the nominal diameter. The stamp engine's own
  `stampHardness` is the true per-dab profile and does not extend past the dab.
- Sampling: sample density only, not the stamp's dab spacing; lower values cost
  memory but do not add grain. Stabilizer: a time-constant filter with three
  modes, so the trail is bounded and the corners survive; the pressure and the
  times are the device's own, and the release lands the stroke exactly on the
  release point; shapes ignore it.
- Texture: one grain post-pass over the finished coverage, not an image-based
  texture. The stamp engine's own `stampTexture` is a per-dab texture, but it
  is a *procedural* bristle pattern, not a picture.
- **No flow.** A stroke's opacity is applied once, when its finished coverage
  composites, so a stroke never darkens where it overlaps itself. A flow is
  the per-dab build-up that *would* darken a slow stroke, and the coverage
  union cannot carry a per-dab alpha. There is therefore **no flow control**,
  and no taper, cap style or size jitter either: a control for a property the
  engine ignores is worse than no control at all. The list is kept in
  `src/core/brushes/brushProperties.ts` with the reason and the work that
  would close each gap, and the brush engine (agents 11-14) owns them.
- The stamp engine: round dabs only - no elongated, offset or tip shapes, no
  scatter, rotation or jitter, and no per-dab opacity (a
  stroke still gets one alpha). A stamped stroke's cost grows with the square of
  the brush radius, so a very large brush with a fine dab spacing is expensive
  to re-rasterize; the planner stops after a fixed work budget, so an extreme
  stroke is cut short rather than stalling the app. The per-dab texture adds
  arithmetic to the same loop - no extra allocation and no extra tile - but it
  is not free: the dab painting costs about 1.5x a plain dab on the machine
  it was measured on.
- Selection: stroke-level (whole strokes), active layer only, dropped on layer
  switch/tool switch, not a painting mask, no perspective and no non-uniform
  scale, no copy/paste across layers. A transform is **baked on apply**, so
  there is no persistent transform to edit afterwards, and the painted width is
  not scaled with the path.
- Blend modes are limited to `normal`, `multiply` and `screen`, composited
  against the paper and lower layers; no group/clipping contexts or alpha
  inheritance. No layer masks/groups; no adjustment layers; `Ctrl+N` unbound.
- **There is no autosave and no crash recovery.** The recovery machinery and
  its policy seam exist (`src/core/autosave/`) and are covered by tests, but
  the decisions that govern autosaving - when it runs, how a never-saved
  document is protected, whether recovery is automatic, prompted or manual,
  when a recovery copy is deleted and how a conflict is presented - are the
  owner's and are unanswered, so **nothing is enabled and no recovery file is
  ever written**. The settings file is written 300 ms after the last
  preference change, so a preference changed in the last moments before the
  window closes can be lost.
- Guides: axis-only (no diagonals), one guide per axis position (a duplicate is
  refused), a fixed accent colour and no position label. A guide does take
  part in the **snapping**, but only within the 6 screen pixel magnet radius.
- Grid and snapping: the spacing is whole document pixels only, the snap is a
  magnet rather than a lock (a point between two lines stays where it is), the
  grid is hidden when its lines would be closer than 3 device pixels, and there
  are no rulers yet.
- A layer with a non-default opacity or blend mode spends one extra
  document-sized scratch canvas while it is being previewed.
- The document pixel budget covers a one-layer document plus the working
  buffers; every additional layer adds another full-resolution surface, and
  the layer count itself is not capped.
- Project files store samples/masks/geometry as JSON, so they can grow large;
  no compressed/binary container yet.
- React layer has no automated tests.

Verification gaps:

- The **navigator** was checked in a real browser against the real engine and
  the real `Canvas2DRenderer`: the panel drew the composite (the paper's white
  and the strokes' colours were read back from the panel's own pixels), the
  marked area moved with the view, a click outside it put the clicked document
  point in the middle of the canvas (the document point under the pointer was
  within 0.1 px of the expected value), a drag inside it carried the artwork
  with the pointer (the view moved by exactly the pointer's distance in
  document pixels), the arrow keys panned it by a tenth of the visible area,
  **Fit** and **Centre** acted on the canvas, the zoom readout followed the
  zoom, and the document's dirty flag and history depth were unchanged by all
  of it. That check found and fixed a real bug: focusing the panel could
  scroll the page and move the rectangle the pointer coordinates are measured
  against. The mapping itself, the resize rules and the overview cache are
  covered by Vitest (`src/test/navigator.test.ts`). The **packaged** Tauri
  window has not been checked, and the React layer still has no automated
  test.

- The grid and the snapping were checked in the browser app on the **live
  display canvas** (the lattice is painted with the spacing in document pixels
  - 120 screen pixels for a 50 px spacing at 241 % zoom - and a rectangle's
  edge moves onto the line when the snap is on), through the real
  `Canvas2DRenderer` (the unit suite plus a visual-regression scene with a
  committed golden), and at the state level (the status bar reads `grid 50 px`
  and `snap on`). The **packaged Tauri window is now verified** (see the
  packaged section of `docs/qa/INTEGRATION-NEXT-BUILD-WAVE.md`): the lattice
  draws over the paper, the Grid switch writes `gridVisible: true` to the
  per-user settings file, and after a relaunch the switch is on and the status
  bar reads `grid 50 px`. A native save/reopen of a document with the grid on is
  unverified: the grid is view state, so it is not in the file at all, and that
  is covered by Vitest.
- Gradients were checked in the browser at state level and their pixels through
  the real `Canvas2DRenderer`; the live display canvas was not sampled because
  the harness suspends animation frames.
- Bucket fill was checked on the live display canvas in the browser.
- Hardness was checked on the live display canvas (soft edge, history, undo/redo)
  and its pixels through the real renderer, including self-overlap, eraser,
  `rasterScale` 1/2 and live-vs-commit equality.
- Spacing/stabilizer were checked in the browser at state level: the controls
  appeared with defaults, a stabilized drag produced `history 1`/unsaved, the
  display showed brush pixels at the release point (settle segment), and undo
  cleared it to paper. Exact lag math, spacing density, format round-trip and
  save/reopen were checked by Vitest; no pixel-level stabilizer comparison was
  made.
- Texture was checked on the live display canvas: the control defaulted to 0, a
  texture-0 drag had one interior colour, the same drag at 100 % had multiple
  colours and `history 1`, undo cleared it, and two strokes with different start
  points but overlapping document pixels produced identical grain colours
  (document anchoring). The renderer's pattern/`destination-in` pass and format
  v7 round-trip/defaults are covered by Vitest; there is no automated pixel test
  of the grain.
- Layer blend modes were checked in the browser app and with real pixels through
  the app's `Canvas2DRenderer`: the panel control set the layer mode, the
  renderer produced the expected `multiply` / `screen` composite (and left
  `normal` unchanged), the export composite matched, and undo/redo restored the
  layer. The mode mapping, dirty flag, single-step history, duplication and v8
  format round-trip are covered by Vitest. No packaged Tauri or high-DPI check.
- The stamp engine was checked in the browser app with real pixels: the `Stamp`
  switch and its two sliders appeared and toggled, a stamped drag drew a chain
  of separated dabs on the live display canvas, the same drag without the stamp
  drew the continuous legacy line, `Ctrl+Z` restored the stamped dabs and a
  second `Ctrl+Z` cleared the stroke back to paper (`history 0`). The dab
  geometry, the union, the live/commit/rebuild/export parity, the eraser, the
  cancel path, the resolution agreement and the v9 format are covered by
  Vitest, and the renderer was driven with real Chromium pixels through Vite
  (the dabs' spacing and the soft dab's radial falloff were read off the
  canvas). No packaged Tauri or high-DPI check.
- The per-dab directional texture was verified **by the automated suite and by
  the visual-regression harness**, not by hand in the running app: the lane
  layout, the rotation with the dab's direction, the reversal invariance, the
  "only removes ink" property, the union still holding, the live/commit/rebuild
  parity and the v10 format are covered by Vitest, and the new
  `directional-texture` scene was rendered in Chromium and pinned as a golden.
  The scene was checked by **mutation**: an implementation that ignores the
  dab's direction changes 4.3 % of the golden's pixels, which is above the
  harness's 2 % tolerance, so the scene really does guard the orientation.
  The texture's cost was measured structurally (no extra allocation, no extra
  tile, the same dabs) and by a sampled end-to-end timing on one machine.
  **No packaged Tauri check, no high-DPI check, and no hand-drawn stroke in the
  running app.**
- The live-preview compositing was proven with real pixels through the real
  `Canvas2DRenderer` using a software pixel canvas (a brush and a shape preview
  under an opaque and a translucent upper layer, active-layer opacity applied
  once, `multiply` / `screen` over a coloured paper, hidden and zero-opacity
  layers, preview pixels equal to the post-release pixels). The layer-safety
  and raster-budget changes are covered by Vitest. No manual browser check and
  no packaged Tauri or high-DPI check was done for these three slices.
- **None has been verified in the packaged Tauri window**; native save/reopen and
  high-DPI rendering of the packaged build are unverified.
- `cargo test --lib` cannot run on this toolchain (`0xC0000139`); use
  `pnpm test`.

## 8. Verification recipes

- `pnpm test` — Vitest (Node + recording-canvas fake).
- `pnpm typecheck` — `tsc -p tsconfig.json --noEmit`.
- `pnpm build` — typecheck + `vite build`.
- `pnpm dev` — frontend on **port 1420** (`strictPort`). Native APIs absent.
- `pnpm tauri dev` — the desktop app; needs cargo + WinLibs on `PATH`.
- Browser harness quirks (full detail in HANDOFF §8):
  - The tab may report `document.hidden === true` and **suspend
    `requestAnimationFrame`**, stalling the `FrameScheduler` (canvas stops
    repainting while `history` still increments). Override rAF with a
    `setTimeout` shim; a blank canvas this way is the harness, not a bug.
  - Synthetic input: `PointerEvent` with `pointerId: 1, pointerType: 'mouse',
    isPrimary: true`, buttons `1` on down/move and `0` on up; keys via
    `window.dispatchEvent(new KeyboardEvent('keydown', ...))`.
  - To get real pixels without the app loop, import the modules through Vite
    (e.g. `await import('/src/core/rendering/canvas2dStroke.ts')`) and
    rasterize into a fresh canvas. This is how gradient, filled-shape and
    hardness pixels were proven.
  - The hardness slice also sampled the live display canvas after drawing at
    100 % zoom; that works when the tab is visible.
  - State checks that always work: status bar (`history N`, `N selected`,
    `● unsaved`), toolbar controls, document title.
- Shortcuts: `b` brush, `e` eraser, `m` select, `l` line, `r` rectangle,
  `o` ellipse, `p` polygon, `s` star, `f` bucket, `g` gradient, `i` picker,
  `h` pan (middle-drag also pans); `Esc` clears/cancels; arrows nudge
  (`Shift` 10 px); `Ctrl+D` duplicate; `Ctrl+Shift+H`/`V` flip.
- Windows toolchain (details in HANDOFF §7): cargo is at
  `%USERPROFILE%\.cargo\bin` and must be prepended to `PATH`; WinLibs
  `mingw64\bin` must also be on `PATH` (rustc calls `dlltool.exe` by name);
  `~/.cargo/config.toml` supplies the linker and
  `-C link-arg=-Wl,--exclude-all-symbols` (do not override `RUSTFLAGS`). A cold
  release build takes ~5 minutes.

## 9. Next slice — brush-tip and image-based stamp textures (Phase 3)

`docs/ROADMAP.md` "Next slice" is the authority. Hardness, sampling, stabilizer,
grain texture, the stamp (dab) engine and the per-dab **directional texture**
have shipped; the **shape** of a dab is the remaining Phase 3 item.

The goal: let a stroke be stamped with a **tip** that is not a round disc - a
felt tip, a dry ink blot, a bristle bundle - so the dab's coverage is the tip's
mask rather than a radial falloff.

### Constraints to keep

1. `DrawingRenderer` and `StrokeRecord` stay the boundary. A tip is a
   rasterization strategy; the vector samples remain authoritative for undo,
   reopen and export.
2. Keep the existing segment path, the existing grain pass, the existing stamp
   engine and the existing per-dab texture as the defaults. Default hard, soft,
   grain and stamped strokes must stay pixel-identical, including the
   single-alpha composite and the no-self-darkening invariant.
3. A tip multiplies a dab's coverage **before** the union, so the union is still
   a maximum and a stroke still cannot darken. The stroke's opacity is still
   applied once.
4. Any tip variation must be deterministic from document coordinates (and, if it
   follows the path, from the dab's own direction), so live, rebuild,
   undo/redo, reopen and PNG export agree at every zoom and `rasterScale`. No
   `Math.random()` in a repaint path.
5. Capture the tip per stroke. Appearance-changing fields that a v10 reader
   cannot ignore require **format version 11**; prove it with tests.
6. Keep `spacing` (sample density) distinct from the stamp's dab spacing.
7. The coverage map stays footprint-bounded and the upload stays one tile at a
   time: the raster budget's 58 bytes per document pixel must not move.
8. A tip in the project file inflates the JSON, so the tip must be a **mask**
   and not a colour, and it must not be an arbitrary blob of pixels: a bounded,
   documented shape the parser can validate.

### Implementation checklist

- [ ] `src/types/brush.ts` / `defaults.ts`: the tip fields, defaults, clamp
      and equality.
- [ ] `src/core/rendering/stampCoverage.ts`: the tip's mask replacing the
      radial profile inside `paintDab`, deterministic from the document and the
      dab's direction.
- [ ] `src/core/rendering/Canvas2DRenderer.ts`: wire the tip through the
      stamp path; the segment path and the grain post-pass stay untouched.
- [ ] `src/features/brushes/BrushControls.tsx`: real tip controls, no
      placeholders.
- [ ] `src/core/project/projectFormat.ts`: format v11 if the appearance changes,
      validate the new fields, read v1-v10 unchanged.
- [ ] Tests: default parity, deterministic tip at different zoom/scale, the
      union still holds, live/commit/rebuild/export parity, format round-trip
      and old-file defaults.
- [ ] Docs in the same commit: README, ARCHITECTURE, PROJECT_FORMAT, ROADMAP,
      HANDOFF + this brief.
- [ ] Browser check: the default strokes unchanged, the tip visible, one
      undo step, save/reopen and export agree; report automated/browser
      evidence separately.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm build`; commit (`git commit -F`) and
      push.

### Acceptance criteria

- Default hard, soft, grain and stamped output is unchanged pixel for pixel.
- A tipped dab stroke is one undo step; it never rewrites existing strokes.
- Live drawing, undo/redo, reopen and export produce the same tipped pixels.
- The union still holds: overlapping dabs and a self-crossing stroke do not
  darken.
- The tip is anchored to the document, not to the frame: the same stroke
  renders the same at every zoom and `rasterScale`.
- Old projects open unchanged; a v11 file requires the new fields and an older
  reader refuses it rather than drawing the wrong look.

## 10. First ten minutes of a new session

1. `git status -sb` and `git log --oneline -8` — confirm `main` is at the
   commit this file names.
2. `pnpm test` and `pnpm typecheck` — establish the baseline before touching
   anything (expect 968 tests in 44 files).
3. Read the **"Next slice"** section of `docs/ROADMAP.md`; it is the authority
   if it differs from this brief.
4. Pick **one** slice, implement it end to end, and add its regression tests.
5. Run `pnpm test`, `pnpm typecheck`, `pnpm build`; verify the interaction in
   the running app; update the docs; commit with `git commit -F`; push.
