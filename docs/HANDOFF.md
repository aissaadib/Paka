# Handoff — Paka drawing app

**Read this first if you are a new agent session on this repository.** It is the
briefing that the previous session would have given you: what Paka is, how work
is done here, what is already shipped, which decisions are settled, how to verify
anything, and what to do next.

Last verified: **2026-10-20**, at the raster-budget commit on `main` (the current
`HEAD` when this file was written; clean and in sync with `origin/main`).

A condensed, paste-ready version of this briefing lives in
[SESSION-BRIEF.md](SESSION-BRIEF.md); use it to start a fresh session quickly,
and this file for the detail.

---

## 1. What this is

- **Repo**: `C:\Users\aissa\Desktop\Paka` — a raster drawing application.
- **Stack (locked, do not change)**: Tauri 2 + React + strict TypeScript + Vite,
  Rust for native work, Canvas 2D behind a renderer interface. No Electron, Qt,
  Fabric.js, Konva; no renderer rewrite or WebGL without profiling evidence.
- **Architecture**: the document model is authoritative, pixel buffers are
  rebuildable caches, React never processes individual pointer samples.
- **Product goal**: grow Paka from a drawing-engine foundation into a
  professional raster drawing app, one vertical slice at a time.

The real plan lives in [ROADMAP.md](ROADMAP.md) (phases, status legend, and a
"Next slice" section that is kept current). Architecture prose is in
[ARCHITECTURE.md](ARCHITECTURE.md); the file format is in
[PROJECT_FORMAT.md](PROJECT_FORMAT.md).

## 2. How work is done here (non-negotiable)

1. **One complete, verified vertical slice per session.** A coherent,
   end-to-end, testable feature. Then: build → test → check → push → next.
2. **No placeholder buttons and no half-wired tools.** A tool that is not part of
   the slice stays absent rather than half-working.
3. **Never state that a test passed unless it was actually run.** Report
   automated, browser and real-device verification separately and honestly.
4. **Docs move with behaviour.** When behaviour or the file format changes,
   update `README.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT_FORMAT.md` and
   `docs/ROADMAP.md` **in the same commit**.
5. **Commit messages: never inline in PowerShell.** Write the message to a file
   and use `git commit -F <file>` (PowerShell mangles quotes and newlines).
   Example files from previous sessions:
   `C:\Users\aissa\AppData\Local\Temp\opencode\commit-fill.txt`.
6. **Do not run cargo while `paka.exe` is running.** It locks
   `src-tauri/target/debug/*.dll` → `os error 32`. Quit the app first.
7. **The React layer has no automated tests** — it is verified in the running
   app. Do not add a React test framework as a side effect of another slice.
8. Prefix commit subjects with their kind (`feat:`, `fix:`, `docs:`, `test:`) and
   describe the user-visible change, as the existing history does.

## 3. Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server on port **1420** (`strictPort: true`). Frontend only — native APIs unavailable. |
| `pnpm test` | `vitest run` (the test suite). |
| `pnpm test:watch` | Vitest in watch mode. |
| `pnpm typecheck` | `tsc -p tsconfig.json --noEmit`. |
| `pnpm build` | Typecheck **and** `vite build` → `dist/`. |
| `pnpm tauri dev` | Desktop app against the dev server. Needs cargo on `PATH` (see §7). |
| `pnpm tauri build --no-bundle` | Release executable only → `src-tauri/target/release/paka.exe`. |
| `pnpm tauri build` | The above plus MSI/NSIS installers (needs WiX/NSIS downloads). |

## 4. Current state (verified 2026-10-21)

- Branch `integration/t10-hsv-color-wheel` at `bc062c7`, after the
  live-preview compositing, layer-safety, raster-budget, bounded-rasterization,
  **stamp (dab) brush engine** and **HSV colour wheel** slices. Both the stamp
  slice (`9b2aceb`) and the colour wheel slice (`dbcb446`) are committed and
  merged; nothing is waiting in the working tree.
- **`pnpm test` → 554 tests in 31 files, all pass** (the colour wheel slice).
  `pnpm typecheck` clean; `pnpm build` succeeds.
- **Project file format version 9** (`PROJECT_VERSION = 9`).
- A release executable has been built and launched successfully:
  `src-tauri/target/release/paka.exe` (4.58 MB) next to `WebView2Loader.dll`.
  It is **unsigned** and its link emitted a MinGW `.rsrc merge failure: multiple
  non-default manifests` warning (see §8). The executable predates the fill,
  gradient, hardness, spacing/stabilizer, texture, blend mode, raster-budget,
  bounded-rasterization and stamp slices.

### Shipped slices (this arc, newest first)

| Commit | Slice |
| --- | --- |
| `dbcb446` | **HSV colour wheel** — a **Colour** panel with a disc (angle = hue, distance = saturation), a value slider and three keyboard-operable sliders. It writes the same brush colour the canvas picker and the toolbar's colour input write, so colour keeps one source of truth; the RGB↔HSV conversion is exact over the whole 8-bit sRGB cube. No format change. |
| `9b2aceb` | **Stamp (dab) brush engine** — a stroke can be drawn as a chain of round dabs placed along its path at a fixed arc-length interval, with the dabs' coverage unioned (a per-pixel maximum, so a stroke never darkens where it crosses itself) and a true per-dab hardness curve. The dabs are a pure function of the samples and the brush, so live drawing, commit, rebuild, undo/redo, reopen and export agree. Format version 9. |
| `2fa34cc` | **Element-scratch variant reverted** — the experiment in `f7cf50c` was reverted: it bought nothing demonstrable, it differed by 1/255 of alpha on a few dozen pixels at rasterScale 2, and it would have moved the raster budget from 58 to 59 bytes per document pixel. |
| `4ac040b` | **Bounded layer rasterization** — a rebuild clears and blends only the rectangle each element inks, so the cost follows the stroke geometry instead of the document size (47x-187x less touched area); the pixels are unchanged. Measured in [PERFORMANCE_AUDIT_2026-10-20.md](PERFORMANCE_AUDIT_2026-10-20.md). |
| `520aa77` | **Preview scratch lifetime** — the grouped live-preview scratch is released whenever no preview is active, so the erase snapshot and the scratch are never alive together and the raster budget's peak holds. |
| `21cd7c7` | **Finished-gesture notice reset** — a refused layer change explains once per gesture, and a finished gesture ends that state. |
| `fae138c` | **Honest peak raster model** — the budget models the peak surface set (three 2x surfaces plus a transient scan buffer, 58 bytes per document pixel) instead of four full surfaces; the cap is unchanged. |
| `372e7be` | **Refusal notice once per gesture** — a layer change refused during a gesture explains why once, instead of on every attempt. |
| `3580e82` | **Document raster budget** — at most 16,777,216 document pixels in total (4096x4096), from a 1 GiB budget for the peak surface set; New Document and project loading enforce it before anything is allocated; format stays version 8. |
| `4c68c89` | **Layer and history safety** — layer changes refused during a gesture; metadata undo/redo keeps the active layer; a merge barrier keeps two gestures two undo steps. |
| `e1071d9` | **Live preview compositing** — the in-flight stroke composites in its own layer's slot, honouring visibility, opacity and blend mode; a reused group scratch for a non-default layer opacity/blend. |
| `32e06bb` | **Layer blend modes** — `normal`, `multiply` and `screen` per layer, applied when the finished layer composites over the paper and lower layers; one undoable step, no re-rasterization; display, PNG export, bucket sampling and the picker share the composite; format version 8. |
| `59c4cd6` | **Grain texture** — deterministic document-anchored grain post-pass over the finished coverage (0-100 %), cached strength tiles, no self-darkening, applies to brush/eraser/shapes; format version 7. |
| `567a091` | **Brush spacing and stabilizer** — spacing surfaced as sample density (2-200 % of diameter); exponential stabilizer (0-100 %) captured per stroke, with the release point appended as a visible settle segment; brush/eraser only; additive within format version 6. |
| `56b12ab` | **Brush hardness** — `hardness` on the brush, captured per stroke; one post-pass feather of the finished silhouette (bounded, reused scratch), soft brush/eraser/shapes; format version 6. |
| `dc87f1d` | **Gradients** — first-class `GradientRecord` (linear/radial, stops, opacity) in the ordered element list; live drag preview, one undo step, format version 5. |
| `8b7152b` | **Bucket (flood) fill** — `FillPatchRecord` in an ordered per-layer element list; composite sampling, tolerance, cancel/undo/redo; format version 4. |
| `84af123` | **Filled shapes** — the toolbar **Fill shape** switch (rectangle/ellipse only); `fill: true` on the stroke; format version 3. |
| `e93c770` | **Bug-hunt round on the transform slice** — three defects each reproduced by a test first (undo/redo mid-drag, no-op flip recording a step, nudge coalescing across a reselect). |
| `a3f4804` | **Nudge / duplicate / flip** for a selection, plus a Selection menu. |
| `253f5e4` | **Marquee selection and stroke moves.** |
| `636e43f` | **Line, rectangle and ellipse shape tools** (Shift constrain, Alt from centre). |
| `e68ac78` | *(pre-existing)* colour picker sampling the composite. |

## 5. Settled decisions — do not re-litigate without new evidence

- **A shape is an ordinary `StrokeRecord`.** Its samples trace the outline; there
  is no new geometry type and no shape field. A drag previews in a stroke buffer
  that never touches the layer; the release commits exactly one stroke = one undo
  step. `Esc`, a tool switch or lost pointer capture discards it.
- **A filled shape is still a stroke** — the same samples plus `fill: true`. The
  rasterizer fills the polygon its samples bound (at `fromIndex === 0 && count > 2`)
  and then traces the outline on top, both at full coverage; the stroke's alpha is
  applied once when its buffer composites. No pixel patch, no revert image.
  `ToolDefinition.fillable` (on the definition, not the runtime `Tool`) says which
  tools bound an interior: rectangle/ellipse yes, line no.
- **`shapeFill` is editor state, not an edit.** It lives in the snapshot
  (`setShapeFill`), is read at press time so each shape keeps the setting it was
  drawn with, survives tool switches, and produces no history entry and no dirty
  flag.
- **A bucket fill is a first-class `FillPatchRecord`, not a traced contour.** It
  carries `kind: "fill"`, colour, a tight bounding box and a binary coverage mask
  (`0`/`255`), and lives in the same ordered element list as strokes. That list is
  what the renderer, undo, duplication/deletion and the project writer consume.
- **The flood scans the merged visible composite and writes the active layer.**
  Sampling one layer would let line art on another layer fail to bound the
  region the user sees. The composite includes the paper; the patch is inserted
  on the active layer at the end of its element list.
- **Tolerance is max absolute per-channel difference, 0-255, at 8-bit sRGB.**
  It is editor state (`fillTolerance`, default `24`), read at press time and not
  serialized. Fully transparent pixels match each other regardless of hidden RGB.
- **The mask is binary and replayed, never re-derived.** A committed fill stores
  its pixels; undo removes the patch and redo/reopen re-inserts the same mask.
  Redo must never rerun the flood scan against a composite that may have changed.
- **A press previews; a release commits.** `beginFill` inserts the patch without
  bumping the revision, `finishFill` bumps it and pushes one `FillCommand`, and
  `cancelFill` removes the patch with no history entry and no revision change.
  A successful fill is exactly one undo step.
- **Fill scans are bounded to 16,777,216 document pixels**
  (`MAX_FILL_SCAN_PIXELS`). The transient worst case is roughly 170 MB (composite,
  `ImageData`, visited bitmap and mask); a larger document refuses the press with
  a status-bar notice rather than freezing. A small fill stores only its own
  bounding-box mask, not a full-canvas copy. The document pixel budget is the
  same number, so a document created or opened through the app never reaches
  it; the scan guard still protects a document that bypasses validation.
- **A gradient is a first-class `GradientRecord`, not a pixel snapshot.** It
  carries `kind: "gradient"`, `type` (`linear`/`radial`), endpoints, colour stops
  and opacity, and lives in the same ordered element list as strokes and fills.
  Geometry is the authoritative content: undo/redo and save/reopen rebuild it.
- **A radial gradient has a fixed centre and radius, not an ellipse or an angle.**
  `(x1, y1)` is the centre, `(x2, y2)` defines the outer radius by distance, and
  the inner radius is always `0`. Endpoints are clamped to the document.
- **Gradient preview is real layer content.** `beginGradient` inserts a
  zero-length record, every move replaces it at the same index, and a release
  commits one `GradientCommand`. A drag shorter than `MIN_GRADIENT_LENGTH`, a
  cancel, lost capture or a tool switch removes it with no history or revision
  change. Options (`gradientType`, `gradientEndColor`) are read at press time and
  are not serialized.
- **The gradient paints the whole layer in element order.** It is content, not an
  adjustment layer: an opaque gradient covers earlier elements on its layer. The
  renderer uses a Canvas linear/radial gradient over the full surface, with
  element opacity in `globalAlpha`; zero-length or fully transparent records draw
  nothing.
- **Project format is version 8.** `layers[].elements` is one ordered list of
  `kind: "stroke"`, `kind: "fill"` and `kind: "gradient"` entries; versions 1-3
  have only `layers[].strokes`, read as stroke elements in the same order.
  Version-4 files open unchanged and may contain fills; a gradient in a
  version-4 file is rejected. Version-5 files open unchanged and gain
  `hardness = 1`; every version-6 brush must carry an explicit `0..1` hardness.
  Version-6 files open unchanged with `stabilizer = 0` and `texture = 0`; every
  version-7 brush must carry an explicit `0..1` texture. Version-7 files open
  unchanged as `blendMode: "normal"` layers; version 8 allows `multiply` and
  `screen` as well. Each bump is required because an older reader would ignore
  the field and mis-render the picture (soft strokes for v6, textured strokes
  for v7, normal instead of multiplied/screened layers for v8). `stabilizer`
  remains additive within v6: it only shapes stored samples, so a missing field
  reads as `0`.
- **Blend modes are composite-stage layer metadata.** `blendMode` maps to the
  Canvas 2D `globalCompositeOperation` (`multiply` / `screen`, else
  `source-over`) applied to the *finished* layer surface over the paper and the
  layers below it. Changing it does not invalidate or re-rasterize any surface;
  it is one undoable `DocumentCommand` and one repaint. `paintDocument` is shared
  by the display, PNG export and `readCompositeImage` (bucket sampling), and
  `readCompositePixel` (picker) uses the same order, so they cannot disagree.
  Modes are not per stroke, and there is no group/clipping or alpha-inheritance
  context yet.
- **A live preview composites inside its own layer.** The in-flight stroke is
  drawn in its layer's slot - after that layer's committed content and before
  any layer above it - so it honours the layer's visibility, opacity and blend
  mode, and the release never changes the stacking. A layer with `opacity < 1`
  or a `multiply` / `screen` blend groups the layer surface and the stroke
  buffer in one reused scratch canvas, because the layer's alpha and blend
  apply to the *finished* layer; an opaque `normal` layer keeps the cheap
  `source-over` path. Export and bucket sampling pass no preview.
- **A layer change during a gesture is refused.** A stroke, fill, gradient or
  selection drag owns content that is not in history yet, and a layer edit
  could remove the layer the preview is being painted into. The engine shows a
  notice and changes nothing, and the finish/cancel paths discard a preview
  whose layer has vanished.
- **Undo/redo of a metadata-only layer edit keeps the active layer.** Rename,
  visibility, opacity, blend mode and reorder no longer restore the layer that
  happened to be active when the edit was made, so undo does not move the user
  off the layer they are looking at and does not drop the selection. Structural
  commands (add, delete, duplicate) still own the active layer.
- **A merge barrier separates gestures.** Selecting a layer, changing the
  brush, a tool or the selection, moving the viewport, and undo/redo end a
  merge run, so two same-keyed changes separated by another action stay two
  undo steps.
- **A document is bounded by total pixels, not only by side length.** At most
  `MAX_DOCUMENT_PIXELS` = 16,777,216 document px, from an explicit 1 GiB budget
  for the peak surface set: three 2x RGBA surfaces (the layer surface, the
  stroke buffer, and at most one of the erase snapshot or the grouped
  live-preview scratch) plus a transient scan buffer - 58 bytes per document
  pixel (`3 x 4 x 2^2 + 10`), 928 MiB at the cap.
  The per-side limit stays 8..8192, so an 8192-wide document may be at most
  2048 px high. The limit is enforced in the document model and in the project
  parser before anything is allocated, and it is a safety limit, not a schema
  change: the format version stays 8.
- **Selection stores only `{ layerId, strokeIds }`.** The dashed frame plus blue
  centreline trace is an overlay: display-only, never in a layer, never exported,
  never serialized.
- **Transforms are `original + delta`**, recorded from the strokes' pre-drag
  copies, so undo restores painting order intact. `Esc` cancels back to the
  originals and records nothing. A flip uses
  `transformChangesSamples` + `TRANSFORM_EPSILON = 1e-6`, so a flip that moves
  nothing records nothing.
- **Undo/redo are refused while a selection gesture is active**, and nudge
  coalescing is scoped to the selection *instance* via `selectionRun` (bumped by
  `setSelection`) — a deselect/reselect starts a new undo step.
- **Stale selection ids are deliberately kept through an undo** so a redo
  re-selects the restored strokes.
- **The eraser subtracts coverage** (`destination-out`) and shares the brush's
  size/opacity/pressure/hardness/spacing/stabilizer/texture; stroke opacity is composited
  once, so self-overlap does not darken.
- **Hardness is a post-pass feather of the finished silhouette**, never a lower
  per-segment alpha. `strokeFeatherRadius` returns `size * 0.1 * (1 - hardness)`
  in document pixels; `0` takes the unchanged raw-buffer path. A soft stroke
  blurs one copy of the stroke buffer in a lazily reused scratch canvas sized to
  its padded bounding box (full-pressure radius + three blur radii) and
  composites that instead, through the same `paintStrokeCoverage` used by live
  drawing, layer commit, rebuild and eraser. Opacity is still applied once.
- **Hardness is captured by the stroke**, with the rest of the brush copy, so
  changing the slider never rewrites old strokes and produces no history entry
  or dirty flag. It applies to brush, eraser and shapes; a filled shape's
  interior stays solid and only its outer silhouette softens.
- **Hardness forced format version 6.** A version-5 reader ignores the field and
  draws a soft stroke hard - a different picture - so it must refuse the file.
  Version-1 to -5 files read their strokes with `hardness = 1`.
- **Spacing is sample density, not stamp spacing.** The builder interpolates a
  long move with a step of `max(0.75 px, spacing * size)`, capped at 96 points
  per input event and skipped for jumps over `MAX_INTERPOLATION_DISTANCE`.
  Exposed as 2-200 % of diameter; default `0.12` (12 %) preserves the old
  behaviour. It changes stored samples, not brush width.
- **Stabilizer is an exponential follow, not a rope.** `follow = 1 - 0.75 *
  strength`; the first point is exact and each later captured point moves that
  fraction from the previous captured point toward the raw sample. At `0` the
  factor is exactly `1`, so the legacy path is unchanged. `finish()` appends the
  last raw point when it differs from the captured tail, and the engine sends
  that settle segment to the renderer before `endStroke`; the committed stroke
  therefore ends on the release point instead of hiding a post-process. At high
  strength the line visibly lags while moving. Shapes ignore it.
- **Spacing and stabilizer are captured per stroke**, like the rest of the
  brush, so changing either never rewrites existing work, adds history or dirties
  the document. `stabilizer` is additive within v6 because the stored samples
  already describe the smoothed path; `spacing` was already in the format.
- **Texture is a single grain pass over the finished coverage, not stamps.** The
  scratch copy (feathered first when hardness < 1) is filled with a 128x128
  white grain tile under `destination-in`, so alpha is multiplied once and
  self-overlap cannot darken. The tile is generated from the fixed
  `textureCoverage(index, strength)` hash, cached per quantized strength, and
  anchored to document coordinates by the pattern transform. It therefore
  matches across bounding boxes, zoom, `rasterScale`, live/commit/rebuild,
  undo/redo, reopen and export. At `0` the raw path is untouched. It applies to
  brush, eraser and shapes through `paintStrokeCoverage`; a filled shape's
  interior grains too.
- **Texture forced format version 7.** A v6 reader ignores the field and draws
  a texture stroke plain, so it must refuse the file. Version-1 to -6 files read
  `texture = 0`; every v7 brush must carry an explicit `0..1` texture.
- **The soft edge is a Gaussian, not an exact hardness cone.** The falloff
  extends slightly beyond the nominal diameter. `SOFT_EDGE_RADIUS_RATIO = 0.1`
  was chosen from measured coverage so even a 4 px stroke keeps a full-alpha
  core; a true per-pixel profile needs the deferred stamp/distance-field engine.

## 6. Key files

- `src/core/engine/DrawingEngine.ts` — snapshot/publish, tools, selection state,
  gesture guards, `shapeFill`, `fillTolerance`, `gradientType`,
  `gradientEndColor`, and the begin/finish/cancel lifecycles for fills and
  gradients.
- `src/core/fill/floodFill.ts` — pure 4-connected scan, tolerance rule,
  transparency rule and `MAX_FILL_SCAN_PIXELS`.
- `src/core/fill/fillPatch.ts` — `FillPatchRecord` creation and deep cloning.
- `src/core/gradient/gradientRecord.ts` — gradient creation, endpoint movement,
  length/degeneracy and cloning.
- `src/core/brushes/strokeBuilder.ts` — `StrokeBuilder` sample capture,
  spacing interpolation, `STABILIZER_MAX_LAG` exponential follow and
  `finish()` settle point.
- `src/core/document/strokeStore.ts` — ordered `LayerElement` list plus the
  filtered stroke view and in-place `replace` for gradient previews.
- `src/core/commands/fillCommand.ts` — redo replays the committed patch.
- `src/core/commands/gradientCommand.ts` — redo re-inserts the committed record.
- `src/core/rendering/canvas2dStroke.ts` — `rasterizeStroke` (including the fill
  branch for filled shapes), `strokeFeatherRadius` / `SOFT_EDGE_RADIUS_RATIO`,
  `TEXTURE_TILE_SIZE` / `textureCoverage`.
- `src/core/rendering/stampCoverage.ts` — the stamp engine: `stampDabs` and
  `StampDabCursor` (the arc-length dab plan), `stampDabCoverage` (the per-dab
  profile), `StampCoverage` (the per-pixel maximum over 64x64 tiles),
  `MAX_STAMP_COVERAGE_WORK` (the per-stroke budget) and
  `MIN_STAMP_SPACING_PX` (the spacing floor).
- `src/core/rendering/Canvas2DRenderer.ts` — `paintStrokeCoverage`,
  `featherStroke` (bounded scratch + scaled blur), `applyStrokeTexture` /
  `textureTile`, `rasterizeFillPatch`, `rasterizeGradient`,
  `readCompositeImage`, element-ordered layer rebuilds, and the stamp path
  (`extendStampStroke`, `rasterizeStampStroke`, `writeStampCoverage`).
- `src/core/document/types.ts` — `StrokeRecord` (incl. `fill?: boolean`),
  `FillPatchRecord`, `GradientRecord`, `LayerElement`, type guards, `Layer`.
- `src/core/project/projectFormat.ts` — `PROJECT_VERSION`, serialize/parse,
  version-history comment, fill/gradient validation, version-aware `readBrush`
  (required `hardness` in v6+, `texture` in v7+, `stamp`/`stampSpacing`/
  `stampHardness` in v9+, defaults for older files).
- `src/core/tools/toolDefinitions.ts`, `src/types/tool.ts` — tool definitions and
  the `fillable` field.
- `src/features/brushes/BrushControls.tsx` — size, opacity, **Hardness**,
  **Sampling**, **Stabilizer**, **Texture** sliders and the **Stamp** switch with
  its **Stamp spacing** and **Stamp hardness** sliders.
- `src/features/shapes/ShapeControls.tsx` — the **Fill shape** switch.
- `src/features/fill/FillControls.tsx` — the bucket **Tolerance** control.
- `src/features/gradient/GradientControls.tsx` — **Radial** and **To** colour.
- `src/state/editorStore.ts` — editor (UI) state actions, e.g. `setShapeFill`,
  `setFillTolerance`, `setGradientType`, `setGradientEndColor`, `dismissNotice`.
- Tests: `src/test/brushSettings.test.ts`, `src/test/canvas2dStroke.test.ts`,
  `src/test/stampCoverage.test.ts`, `src/test/floodFill.test.ts`,
  `src/test/fillCommand.test.ts`,
  `src/test/gradient.test.ts`, `src/test/canvas2dRenderer.test.ts`,
  `src/test/drawingEngine.test.ts`, `src/test/projectFormat.test.ts`,
  `src/test/projectLifecycle.test.ts`, shared fakes in
  `src/test/support/recordingCanvas.ts` (gradient methods and `filter` state are
  injected alongside the recorded methods).

## 7. Toolchain notes for this Windows machine

- **cargo is not on `PATH`** — it is at `%USERPROFILE%\.cargo\bin`. Prepend it:
  `$env:Path = "$env:USERPROFILE\.cargo\bin;" + $env:Path`.
- **WinLibs `mingw64\bin` must also be on `PATH`.** `~/.cargo/config.toml` points
  the linker at that gcc, but rustc invokes `dlltool.exe` **by name**, so without
  the directory on `PATH` the build dies with
  `error calling dlltool 'dlltool.exe': program not found`. Full prefix used by
  the previous session:
  `C:\Users\aissa\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin`.
- `~/.cargo/config.toml` (machine-local, outside the repo) also passes
  `-C link-arg=-Wl,--exclude-all-symbols`, without which binutils `ld` rejects the
  Tauri cdylib with "export ordinal too large". Do **not** override `RUSTFLAGS` —
  the env var replaces the config's rustflags and reintroduces that failure.
- A **cold release build takes ~5 minutes** (~400 crates, ~1.2 GB of artifacts).
  `target/debug` alone is not enough for `tauri build`.
- The release binary is self-contained apart from
  **`WebView2Loader.dll`, which must sit next to the exe** (Tauri places it there),
  and the WebView2 runtime (present on Windows 10/11).
- **`cargo test --lib` aborts** with `0xC0000139 STATUS_ENTRYPOINT_NOT_FOUND` on
  this toolchain (pre-existing MinGW issue, unrelated to the code). Use
  `pnpm test` for the suite.

## 8. Verification recipes

- **Unit/behaviour**: `pnpm test` (Vitest, jsdom + a recording canvas fake).
- **Browser check of the real app**: `pnpm dev` (port 1420). Inside the page, use
  `browser.evaluate` — Code Mode has no timers and cannot `fetch` localhost.
  - Chrome may report `document.hidden === true` even after focusing the tab, and
    **suspends `requestAnimationFrame`** for hidden tabs. That stalls the app's
    `FrameScheduler` (its pending handle never fires, so every later request is
    dropped and the canvas stops repainting) while `history` still increments.
    Override `window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 16)`
    (and `cancelAnimationFrame`) — note that this only helps *after* the stuck
    handle fires once. **If the canvas is verified blank this way, that is the
    harness, not a bug.**
  - Synthetic input: `PointerEvent` with
    `pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0/-1, buttons: 1/0`;
    keys via `window.dispatchEvent(new KeyboardEvent('keydown', {...}))`.
  - **Getting real pixels without the app's animation loop**: import the module
    straight through Vite, e.g.
    `await import('/src/core/rendering/canvas2dStroke.ts')`, and rasterize into a
    fresh canvas. This is how filled-shape pixels were proven (filled triangle
    solid at its centre and **clear in the corner of its bounding box**). Bucket
    fill pixels were sampled from the live display canvas instead (§8).
- **State checks that work regardless of rendering**: the status bar. `history \d+`,
  `\d+ selected`, `● unsaved` when dirty, nothing when clean. Revision counters are
  monotonic, so undoing back to the saved revision does **not** clear dirty.
- **Canvas mapping** (the one document measured): document 1600×1200, backing
  820×731, CSS 656×584, DPR 1.25, paper rect at (40, 64) → backing paper origin
  (41, 89), 0.46125 backing px per document px. Re-measure for a different window.
- Tool shortcuts: `b` brush, `e` eraser, `m` select, `l` line, `r` rectangle,
  `o` ellipse, `f` bucket fill, `g` gradient, `i` picker, `p`/middle-drag pan;
  `Esc` clears a selection; arrow keys nudge (`Shift` = 10 px); `Ctrl+D`
  duplicate; `Ctrl+Shift+H`/`V` flip.
- **Bucket fill check (verified 2026-10-19).** Override `rAF` first (§8), press
  `f`, click inside the paper with synthetic pointer events, wait one frame, then
  read the display canvas: the sampled pixel should be the brush colour and the
  status bar `history 1` plus `● unsaved`. `Ctrl+Z` returns the pixel to paper and
  `history 0`; `Ctrl+Shift+Z` restores it. A press followed by `pointercancel`
  must leave the paper pixel white with history still `0`. Selecting `f` must show
  a `Tolerance` number/range input (default 24).
- **Gradient check (verified 2026-10-20).** Press `g` and confirm the toolbar
  shows **Radial** and **To**; clicking Radial and changing the colour updates
  both controls. A synthetic `pointerdown` → `pointermove` → `pointerup` drag
  raises `history` by one and shows `● unsaved`; `Ctrl+Z` returns it to the previous
  depth and `Ctrl+Shift+Z` restores it. At history zero, a press followed by
  `pointercancel` (with a move in between) leaves history at zero. The harness tab
  suspends `requestAnimationFrame`, so the live display canvas does not repaint:
  verify actual gradient pixels by importing the modules and rendering a document
  through `Canvas2DRenderer` into a fresh canvas (100×100, zoom 1, offset 0).
  A black→white linear gradient along x sampled `[14,14,14,255]` at x=5,
  `[128,128,128,255]` at x=50 and `[243,243,243,255]` at x=95. A red→blue radial
  with centre (50,50) and radius 50 sampled `[251,0,3,255]` at the centre and
  blue at the edges.
- **Hardness check (verified 2026-10-20).** Press `b`; the toolbar shows a
  **Hardness** range and number input (default `1`). Set size 40 and hardness 0
  through the number inputs, dispatch a synthetic pen drag at actual size
  (`Ctrl+1`), and read the live display canvas across the stroke edge: the
  profile was monotone from paper `255` through `248, 209, 126, 52, 26` to a
  `22` interior (the brush colour), while the status bar showed `history 1` and
  `● unsaved`. `Ctrl+Z` returned the sampled pixel to `255` and `history 0`;
  `Ctrl+Shift+Z` restored the stroke. Renderer-level checks (real
  `Canvas2DRenderer`, fresh canvas) additionally showed: a hard edge unchanged
  at the nominal boundary; soft profiles falling off smoothly; interior parity
  at opacity 0.6 for hardness 1/0.5/0; effective parity at `rasterScale` 1 and
  2; no darkening at a soft stroke's self-crossing (crossing and single coverage
  both `0`); a soft eraser removing the core completely; and live preview vs
  committed layer byte-identical (`differingChannels: 0`).
- **Spacing/stabilizer check (verified 2026-10-20).** The brush panel shows
  **Spacing** (default `12 %`) and **Stabilizer** (default `0 %`). Setting size
  80, spacing 100 % and stabilizer 100 %, then dispatching a synthetic pen drag
  at actual size, produced `history 1` and `● unsaved`; the live display had the
  brush colour `[22,24,28]` at both the stroke middle and the release point
  (proving the settle segment was painted), and `Ctrl+Z` returned that pixel to
  paper `[255,255,255]` with `history 0`. Exact lag/settle math, spacing density,
  per-stroke capture, editor-state/no-dirty behaviour, format round-trip
  (including a missing stabilizer defaulting to 0) and save/reopen are covered
  by Vitest; no stabilizer pixel-difference measurement was made.
- **Texture check (verified 2026-10-20).** The brush panel shows **Texture**
  (default `0 %`). At size 80, spacing 12 %, stabilizer 0 %, a synthetic pen drag
  with texture 0 sampled 29 interior points and found exactly one colour
  (`22,24,28`); the same drag with texture 100 % produced 3 distinct interior
  colours (`63,65,68`, `92,94,97`, ...), `history 1`, and `Ctrl+Z` returned
  `history 0`. Drawing with different start points but overlapping the same
  document pixels produced identical grain colours at the overlap, confirming
  document anchoring rather than bbox anchoring. The real-renderer path is
  covered by Vitest for the pattern/`destination-in` pass and tile/capture rules;
  no automated pixel test of the grain itself exists.
- **Brush-row layout check (verified 2026-10-20).** The six sliders plus the
  pressure toggles no longer sit in a clipped single row: `.brush-controls`
  wraps into a dedicated toolbar row and `.app-shell` sizes that row to its
  content. At a 688 px viewport all controls were visible, the toolbar was about
  179 px tall, and `document.scrollWidth` equalled the viewport (no horizontal
  overflow). A 900 px screenshot confirmed Size/Opacity/Hardness/Spacing/
  Stabilizer/Texture and both pressure toggles.

## 9. Next move

**Directional, image-based or per-dab stamp textures** (the rest of the Phase 3
work). The stamp engine itself has shipped: a stroke can be drawn as a chain of
round dabs placed along its path, unioned so it never darkens where it crosses
itself, with a true per-dab hardness curve (format version 9). The grain is
still one document-anchored post-pass over the finished coverage. The "Next
slice" section of [ROADMAP.md](ROADMAP.md) is kept current and is the authority.

The constraints that matter:

- keep `DrawingRenderer`/`StrokeRecord` as the boundary; samples stay the
  authoritative record for undo, reopen and export;
- keep the segment path, the grain pass and the stamp engine as the defaults and
  preserve hard/soft/grain/stamped output;
- a per-dab texture multiplies a dab's coverage **before** the union, so the
  union stays a maximum and a stroke still cannot darken;
- keep the texture deterministic from document coordinates (and from the dab's
  own direction, if it follows the path) so live, rebuild, undo/redo, reopen and
  PNG export agree at every zoom and `rasterScale`;
- a non-default texture appearance cannot be ignored by a v9 reader without
  changing the picture, so expect **format version 10** if fields change
  output;
- keep `spacing` (sample density) distinct from the stamp's dab spacing;
- the coverage map stays footprint-bounded and the upload stays one tile at a
  time: the raster budget's 58 bytes per document pixel must not move.

Optional polish, deliberately not done yet:

- Only `preventDefault` for `Ctrl+D` / `Ctrl+Shift+H` / `Ctrl+Shift+V` when a
  selection actually exists.
- Restore `lineCap`/`lineJoin` after `paintSelection` in `Canvas2DRenderer`
  instead of leaving them set.
- Consider a selection model for fills and gradients (they are currently filtered
  out of the stroke-only selection view) if moving them becomes a user need.
- A gradient stop editor (the format already allows 2-64 stops) and a
  transparent-stop control; the current UI writes exactly two stops.
- A transparency stop would need either an alpha in the colour field or a
  separate alpha on stops; decide before exposing a stop editor.

## 10. Open verification gaps and known limitations

- **Gradients were verified in the browser app at the state level, and their
  pixels through the real `Canvas2DRenderer`** (§8), but the live display canvas
  was not sampled because the harness tab suspends animation frames. They have
  **not** been verified in the packaged Tauri window. A native save/reopen of a
  gradient and high-DPI rendering remain unverified; save/reopen is covered by
  Vitest at the format and lifecycle level.
- **Bucket fill was verified in the browser app, but not in the packaged
  Tauri window.** The live display canvas was sampled for the fill, undo, redo
  and cancel paths, and the tolerance control was checked (§8). A real-device /
  packaged-window check and a native save/reopen of a fill are still unverified;
  save/reopen is covered by Vitest at the format and lifecycle level.
- **Hardness was verified on the live display canvas and through the real
  renderer** (§8), including undo/redo and the soft eraser, but **not in the
  packaged Tauri window**. Native save/reopen of a soft stroke and high-DPI
  rendering of the feather remain unverified; save/reopen is covered by Vitest
  at the format and lifecycle level. The harness edge profile is evidence of
  falloff and parity, not a perceptual review of the curve.
- **Layer blend modes were verified in the browser app and through the real
  `Canvas2DRenderer`** (§8): the panel control changed the mode, the renderer
  composited actual pixels with `multiply` and `screen`, the document export
  matched the display path, and undo/redo restored the full layer composite.
  They have **not** been verified in the packaged Tauri window; native
  save/reopen of a blended layer is covered by Vitest at the format and
  lifecycle level, not by a native round trip.
- **High-DPI behaviour of the release executable is unverified.** The link warned
  about merged resource manifests; the app launches, its window responds and its
  title updates from the frontend, but DPI scaling of the packaged build was not
  visually checked.
- **`cargo test --lib` cannot run** on this toolchain (§7).
- Product limitations documented in ROADMAP and not planned yet: undo history is
  not stored in the project file (reopening rebuilds one step per element); no
  autosave or crash recovery; the React layer has no automated tests; `Ctrl+N` is
  not bound (use `File -> New Document...`); fills are binary/unselectable;
  gradients are two-stop, whole-layer, have no stop editor and are unselectable;
  hardness is a Gaussian feather of the stroke silhouette (not a stamp profile);
  spacing controls sample density rather than stamp spacing; the stabilizer is an
  exponential follow filter with visible lag and no look-ahead/rope catch-up;
  texture is a single grain pass, not a stamped/directional/image texture;
  there is no stamp engine yet; blend modes are limited to `normal`, `multiply`
  and `screen`, composited against the paper and lower layers with no group or
  clipping context.

## 11. First five minutes of a new session

1. `git status -sb` and `git log --oneline -8` — confirm you are on `main` at the
   commit this file names.
2. `pnpm test` and `pnpm typecheck` — establish the baseline before touching
   anything.
3. Read the **"Next slice"** section of `docs/ROADMAP.md`.
4. Pick **one** vertical slice, implement it, and add a regression test with it.
5. `pnpm test`, `pnpm typecheck`, `pnpm build`; verify the interaction in the
   running app (§8); update the docs (§2.4); commit with `git commit -F`; push.
