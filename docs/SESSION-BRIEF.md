# Paka — session brief

**Paste this file into a new session, or tell the new session to read it.**
It is a self-contained snapshot of the project and of how work is done here.
The deeper references are [HANDOFF.md](HANDOFF.md) (verification recipes,
toolchain caveats), [ROADMAP.md](ROADMAP.md) (the authoritative plan) and
[ARCHITECTURE.md](ARCHITECTURE.md) / [PROJECT_FORMAT.md](PROJECT_FORMAT.md).

Last verified: **2026-10-20**, at the live-preview compositing, layer-safety and
raster-budget slices on `main` — clean and in sync with `origin/main`.

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

- Branch `main`, working tree clean after the live-preview compositing,
  layer-safety and raster-budget slices.
- `pnpm test` → **461 tests in 29 files, all pass** (re-run for this slice).
- `pnpm typecheck` clean; `pnpm build` succeeds (verified for this slice).
- Project file format **version 8** (`PROJECT_VERSION = 8`); `stabilizer` was
  additive within v6 (missing = 0), `texture` is required from v7, and
  `blendMode` may be `multiply` or `screen` from v8.
- A release executable exists at `src-tauri/target/release/paka.exe` (unsigned,
  built before the fill, gradient, hardness, spacing/stabilizer, texture and
  blend mode slices); packaged-app verification is still outstanding.
- Phase 2 (illustration tools) is complete. Phase 3 has hardness, spacing +
  stabilizer and grain texture shipped; the stamp engine remains. Phase 4 has
  `normal` / `multiply` / `screen` layer blend modes; masks and groups remain.
  Phase 0 gained three more correctness items: live-preview compositing inside
  its own layer, layer/history safety during a gesture, and a bounded document
  raster budget.

### Shipped slices (newest first)

| Commit | Slice |
| --- | --- |
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
- **Shapes** (`L` line, `R` rectangle, `O` ellipse): live preview, one stroke =
  one undo step; `Shift` constrains (45°, squares, circles), `Alt` draws from
  the centre. Rectangle/ellipse can be filled via the **Fill shape** switch;
  a line cannot. Shapes ignore pen pressure (constant width).
- **Bucket fill** (`F`): flood-fills the region under the pointer from the
  merged visible composite, writes a bounded pixel-exact patch to the active
  layer. **Tolerance** 0–255 per-channel; transparent pixels match each other.
  Binary mask, replayed on redo/reopen; documents over 16,777,216 px refuse the
  scan with a status-bar notice.
- **Gradients** (`G`): drag to paint linear or radial (toolbar **Radial**
  switch) from the brush colour to the **To** colour, at brush opacity. Real
  preview element, one undo step, cancel removes it. Two stops only; paints the
  whole layer in element order; no stop editor, no angle snapping.
- **Selection/transform** (`M`): marquee or click selects whole strokes of the
  active layer; drag moves them; arrow keys nudge (1 px, `Shift` 10 px,
  coalesced); `Ctrl+D` duplicates; `Ctrl+Shift+H`/`V` flips; `Delete` removes;
  `Esc` cancels; all one undo step each and mirrored in the **Selection** menu.
  Selection is an overlay only, never serialized or exported, and painting is
  not clipped to it.
- **Colour picker** (`I`): samples the merged composite at the pointer, stays
  selected, is not an edit.
- **Brushes**: size 1–512 doc px, opacity, hardness (0–100 %, applied to brush,
  eraser and shapes), spacing (2–200 % of diameter, sample density), stabilizer
  (0–100 %, brush and eraser only), texture (0–100 %, deterministic grain over
  the finished coverage, applied to brush/eraser/shapes), colour + 8-swatch
  palette, pressure size and pressure opacity toggles. All settings are captured
  per stroke.
- **Navigation**: wheel scroll, `Shift+Wheel` horizontal, `Ctrl`/`Alt+Wheel`
  zoom at cursor, pan tool / middle drag, zoom buttons, actual size, fit.
- **Layers**: add, duplicate, delete, rename (double-click), reorder, visibility,
  opacity, blend mode (`Normal`, `Multiply`, `Screen`) and selection. A blend
  mode combines the finished layer with the paper and every lower layer. Layer
  edits are undoable (including the deleted layer's elements) and are **refused
  while a gesture is in flight**, so a release can never commit into a layer
  that was removed mid-drag.
- **History**: 200 commands; one step per gesture; a slider drag is one step.
- **Projects**: `File → New/Open/Save/Save As` (`Ctrl+O`, `Ctrl+S`,
  `Ctrl+Shift+S`), versioned `.paka` with ordered layer content (stroke samples,
  fill masks, gradient geometry), atomic writes, dirty indicator, discard guard.
  `Ctrl+N` is **not** bound; use the menu/dialog.
- **PNG export**: full composite at document size, honours layer visibility,
  opacity and blend mode, leaves the document untouched.
- **Status bar**: document size, zoom, history depth, selected count, cursor
  position, file name/messages, `● unsaved`.
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
  state/        editorStore (snapshot + intents) and context
  core/
    document/   document/layer metadata, ordered element store, selection
    brushes/    defaults/normalization, strokeBuilder (sample capture)
    fill/       pure flood scan, fill-patch record
    gradient/   gradient geometry/stops/cloning
    tools/      registry, per-tool behaviour, shape geometry
    commands/   command stack, stroke/fill/gradient/document commands
    input/      pointer normalization, DOM binder
    rendering/  viewport, frame scheduler, Canvas2DRenderer, canvas2dStroke
    engine/     DrawingEngine: integration, gestures, history, snapshot
    project/    format v8, gateway port, file orchestration
    export/     PNG export
  types/        shared value types
  utils/        math, colour, ids, paths, store
src-tauri/      Rust shell: environment probe, scoped project/PNG I/O
docs/           architecture, format, roadmap, handoff, this brief
```

Key files for the next slice (stamp engine):

- `src/core/rendering/canvas2dStroke.ts` — current segment rasterizer and grain
  tile; `rasterizeStroke` is the function a stamp path must sit behind or beside
  without changing default output.
- `src/core/rendering/Canvas2DRenderer.ts` — `rasterizeStrokeToBuffer`,
  `compositeStrokeBuffer`, `paintStrokeCoverage`, `featherStroke`,
  `applyStrokeTexture`; the stroke buffer, single-alpha composite and
  post-dab grain are the invariants a stamp engine must keep.
- `src/types/brush.ts` / `src/core/brushes/defaults.ts` — brush fields
  (stamp spacing/hardness/texture) and defaults/clamping/equality.
- `src/features/brushes/BrushControls.tsx` — controls for real stamp settings.
- `src/core/document/types.ts` — `StrokeRecord`/`brush`, the authoritative record.
- `src/core/engine/DrawingEngine.ts` — per-stroke brush capture and renderer
  begin/extend/finish lifecycle.
- `src/core/project/projectFormat.ts` — `PROJECT_VERSION`, `readBrush`,
  serializer; appearance-changing stamp fields need v9.
- Tests: `canvas2dStroke.test.ts`, `canvas2dRenderer.test.ts`,
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
- **Stabilizer is an exponential follow.** `stabilizer` is `0..1`, default `0`;
  `follow = 1 - 0.75 * strength` is applied to x/y/pressure from the previous
  captured point. At `0` the factor is exactly `1`, so raw input is unchanged.
  `finish()` appends the last raw point when it differs, and the engine previews
  that settle segment before `endStroke`; the committed path ends on release
  with no hidden post-process. It applies to brush and eraser, not shapes. The
  trade-off is visible lag at high strength; there is no look-ahead or rope
  catch-up.
- **`stabilizer` is additive within format v6.** It shapes samples that are
  already stored, so an older v6 reader ignoring it still renders the same
  picture; a missing field reads as `0`. `spacing` was already in v6.
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
- **A fill is a pixel patch**, not a traced contour: colour, tight bbox, binary
  mask. Redo/reopen replay the mask, never re-run the flood.
- **A gradient is geometry + stops**, not pixels; radial = fixed centre, radius
  by distance, inner radius 0. Endpoints clamp to the document.
- **Editor options describe the next gesture and are not serialized**:
  `shapeFill`, `fillTolerance` (default 24), `gradientType`,
  `gradientEndColor`. Each is read at press time so the committed record keeps
  the setting it was drawn with. Changing an option is not an edit. The brush is
  the same: the current brush is session state, while every stroke stores the
  full brush it was drawn with, including `hardness`, `spacing`, `stabilizer`
  and `texture`.
- **Format versioning**: a bump is required when an older reader would render a
  *different picture*, not for convenience. v1–v3 use `layers[].strokes`, read
  as stroke elements; v4 adds fills and `layers[].elements`; v5 adds gradients;
  v6 requires `hardness` on every stroke brush and reads v1–v5 strokes as hard
  (`1`); `stabilizer` was added additively within v6 (missing = `0`) because the
  smoothed path is already stored in the samples; v7 requires `texture` because
  an older reader would draw a textured stroke plain; v8 allows `multiply` and
  `screen` blend modes because a v7 reader rejects them rather than drawing them
  as `normal`; unknown/newer versions are rejected outright, as are v4 files
  containing a gradient.
- **Selection stores `{ layerId, strokeIds }` only**; the overlay is
  display-only. Transforms are `original + delta` from pre-drag copies, so undo
  restores painting order. Undo/redo are refused during a selection gesture.
- **Dirty state** compares a mutation counter with the counter at last
  save/load; undoing back to the saved revision does **not** clear dirty.
- **History is capped at 200 commands** and is not stored in the project file;
  reopening rebuilds one step per element.

## 7. Known limitations / open gaps

Product:

- No text tool; only brush, eraser, select, line, rectangle, ellipse, bucket,
  gradient, picker, pan.
- Layer rasterization is a full rebuild: for each element on a layer the
  renderer clears the whole stroke buffer and blends one full-surface draw, so
  an undo on a busy layer costs `O(elements x surface pixels)` regardless of the
  stroke geometry. Measured numbers, their environmental limits, and the
  recommended first fix (dirty bounds for the stroke buffer) are in
  [PERFORMANCE_AUDIT_2026-10-20.md](PERFORMANCE_AUDIT_2026-10-20.md).
- Gradients: two stops, whole-layer, no stop editor, no angle snapping, no
  transparent stop, not selectable (cannot move/duplicate/flip).
- Fills: binary mask, no feather/gap-closing, no pre-commit preview, not
  selectable.
- Hardness: a single Gaussian feather of the finished silhouette, so the edge
  extends slightly beyond the nominal diameter; no stamp profile.
- Spacing: sample density only, not stamp spacing; lower values cost memory but
  do not add grain. Stabilizer: exponential follow with visible lag, no
  look-ahead or rope catch-up; shapes ignore it.
- Texture: one grain post-pass, not a stamp/per-dab, directional or image-based
  texture. No stamp engine yet.
- Selection: stroke-level (whole strokes), active layer only, dropped on layer
  switch/tool switch, not a painting mask, no scale/rotate/perspective, no
  copy/paste across layers.
- Blend modes are limited to `normal`, `multiply` and `screen`, composited
  against the paper and lower layers; no group/clipping contexts or alpha
  inheritance. No layer masks/groups; no adjustment layers; no guides/grids; no
  autosave/crash recovery; `Ctrl+N` unbound.
- A layer with a non-default opacity or blend mode spends one extra
  document-sized scratch canvas while it is being previewed.
- The document pixel budget covers a one-layer document plus the working
  buffers; every additional layer adds another full-resolution surface, and
  the layer count itself is not capped.
- Project files store samples/masks/geometry as JSON, so they can grow large;
  no compressed/binary container yet.
- React layer has no automated tests.

Verification gaps:

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
  `o` ellipse, `f` bucket, `g` gradient, `i` picker, `p`/middle-drag pan;
  `Esc` clears/cancels; arrows nudge (`Shift` 10 px); `Ctrl+D` duplicate;
  `Ctrl+Shift+H`/`V` flip.
- Windows toolchain (details in HANDOFF §7): cargo is at
  `%USERPROFILE%\.cargo\bin` and must be prepended to `PATH`; WinLibs
  `mingw64\bin` must also be on `PATH` (rustc calls `dlltool.exe` by name);
  `~/.cargo/config.toml` supplies the linker and
  `-C link-arg=-Wl,--exclude-all-symbols` (do not override `RUSTFLAGS`). A cold
  release build takes ~5 minutes.

## 9. Next slice — stamp-based brush engine (Phase 3)

`docs/ROADMAP.md` "Next slice" is the authority. Hardness, spacing, stabilizer
and grain texture shipped; the stamp/dab engine is the remaining Phase 3 item.

The goal: add a stamp rasterizer behind the existing stroke interface for
**per-dab spacing, true hardness curves and directional/image textures**, without
changing what current hard, soft and grain files look like.

### Constraints to keep

1. `DrawingRenderer` and `StrokeRecord` stay the boundary. Stamps are a
   rasterization strategy; the vector samples remain authoritative for undo,
   reopen and export.
2. Keep the existing segment path and grain post-pass as the default. Default
   hard/soft/grain strokes must stay pixel-identical, including the single-alpha
   composite and the no-self-darkening invariant.
3. Accumulate per-dab coverage into one stroke buffer (max/union, not repeated
   source-over), then composite once at the stroke opacity. Grain stays a
   post-dab pass unless the format records per-dab texture.
4. Any grain/stamp randomness must be deterministic from document coordinates so
   live, rebuild, undo/redo, reopen and PNG export agree at every zoom and
   `rasterScale`.
5. Capture stamp settings per stroke. Appearance-changing fields that a v8
   reader cannot ignore require **format version 9**; prove it with tests.
6. Keep `spacing` (sample density) distinct from stamp spacing, or document an
   explicit migration if they are merged.

### Implementation checklist

- [ ] `src/types/brush.ts` / `defaults.ts`: stamp fields, defaults, clamp and
      equality.
- [ ] `src/core/rendering/canvas2dStroke.ts` / `Canvas2DRenderer.ts`: stamp
      rasterizer behind the existing buffer/composite path; default unchanged.
- [ ] `src/features/brushes/BrushControls.tsx`: real stamp controls, no
      placeholders.
- [ ] `src/core/engine/DrawingEngine.ts`: per-stroke capture and brush setters
      stay editor state (no history, no dirty).
- [ ] `src/core/project/projectFormat.ts`: format v9 if appearance changes,
      validate the new fields, read v1-v8 unchanged.
- [ ] Tests: segment/grain parity at default, stamped live/commit equality,
      self-overlap/no-darkening, deterministic pattern at different zoom/scale,
      format round-trip and old-file defaults.
- [ ] Docs in the same commit: README, ARCHITECTURE, PROJECT_FORMAT, ROADMAP,
      HANDOFF + this brief.
- [ ] Browser check: default hard/soft/grain strokes unchanged, stamp effect
      visible, one undo step, save/reopen and export agree; report
      automated/browser evidence separately.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm build`; commit (`git commit -F`) and
      push.

### Acceptance criteria

- Default hard, soft and grain output is unchanged pixel for pixel.
- A stamped stroke is one undo step; it never rewrites existing strokes.
- Live drawing, undo/redo, reopen and export produce the same stamped pixels.
- Overlapping dabs and a self-crossing stamped stroke do not darken.
- Old projects open unchanged; a v9 file requires the new fields and an older
  reader refuses it rather than drawing the wrong look.

## 10. First ten minutes of a new session

1. `git status -sb` and `git log --oneline -8` — confirm `main` is at the
   raster-budget commit (or the commit this file names).
2. `pnpm test` and `pnpm typecheck` — establish the baseline before touching
   anything (expect 461 tests in 29 files).
3. Read the **"Next slice"** section of `docs/ROADMAP.md`; it is the authority
   if it differs from this brief.
4. Pick **one** slice, implement it end to end, and add its regression tests.
5. Run `pnpm test`, `pnpm typecheck`, `pnpm build`; verify the interaction in
   the running app; update the docs; commit with `git commit -F`; push.
