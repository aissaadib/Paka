# Paka — session brief

**Paste this file into a new session, or tell the new session to read it.**
It is a self-contained snapshot of the project and of how work is done here.
The deeper references are [HANDOFF.md](HANDOFF.md) (verification recipes,
toolchain caveats), [ROADMAP.md](ROADMAP.md) (the authoritative plan) and
[ARCHITECTURE.md](ARCHITECTURE.md) / [PROJECT_FORMAT.md](PROJECT_FORMAT.md).

Last verified: **2026-10-20**, at commit `dc87f1d` on `main` — clean and in sync
with `origin/main`.

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

- Branch `main`, `HEAD = origin/main = dc87f1d`, working tree clean.
- `pnpm test` → **380 tests in 26 files, all pass** (re-run today).
- `pnpm typecheck` clean; `pnpm build` succeeds (verified for the gradient
  slice).
- Project file format **version 5** (`PROJECT_VERSION = 5`).
- A release executable exists at `src-tauri/target/release/paka.exe` (unsigned,
  built before the fill and gradient slices); packaged-app verification is
  still outstanding.
- Phase 2 (illustration tools) is complete. **Phase 3 has not started.**

### Shipped slices (newest first)

| Commit | Slice |
| --- | --- |
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
  semi-transparent self-overlap never darkens. Presses outside the paper are
  ignored.
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
- **Brushes**: size 1–512 doc px, opacity, colour + 8-swatch palette, pressure
  size and pressure opacity toggles.
- **Navigation**: wheel scroll, `Shift+Wheel` horizontal, `Ctrl`/`Alt+Wheel`
  zoom at cursor, pan tool / middle drag, zoom buttons, actual size, fit.
- **Layers**: add, duplicate, delete, rename (double-click), reorder, visibility,
  opacity, selection. Layer edits are undoable (including the deleted layer's
  elements).
- **History**: 200 commands; one step per gesture; a slider drag is one step.
- **Projects**: `File → New/Open/Save/Save As` (`Ctrl+O`, `Ctrl+S`,
  `Ctrl+Shift+S`), versioned `.paka` with ordered layer content (stroke samples,
  fill masks, gradient geometry), atomic writes, dirty indicator, discard guard.
  `Ctrl+N` is **not** bound; use the menu/dialog.
- **PNG export**: full composite at document size, honours layer visibility and
  opacity, leaves the document untouched.
- **Status bar**: document size, zoom, history depth, selected count, cursor
  position, file name/messages, `● unsaved`.
- **HiDPI**: layer surfaces rasterized at up to 2×, display follows DPR.
- **New document**: 8–8192 px per side, validated.

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
    project/    format v5, gateway port, file orchestration
    export/     PNG export
  types/        shared value types
  utils/        math, colour, ids, paths, store
src-tauri/      Rust shell: environment probe, scoped project/PNG I/O
docs/           architecture, format, roadmap, handoff, this brief
```

Key files for the next slice:

- `src/types/brush.ts` — `BrushSettings` (add `hardness` here).
- `src/core/brushes/defaults.ts` — `DEFAULT_BRUSH`, `normalizeBrush`,
  `brushSettingsEqual`.
- `src/core/brushes/strokeBuilder.ts` — `createStrokeRecord` copies the brush
  into every stroke (that is how per-stroke options survive undo/reopen).
- `src/core/rendering/canvas2dStroke.ts` — `rasterizeStroke`, `stampDot`,
  `strokeDiameter`, `strokeOpacity`.
- `src/core/rendering/Canvas2DRenderer.ts` — stroke buffer, `compositeStrokeBuffer`,
  `applyErase`, layer rebuilds (lines around 704–810 are the relevant paths).
- `src/core/engine/DrawingEngine.ts` — `EditorSnapshot` (lines 111–153), editor
  setters, gesture lifecycles, `buildSnapshot`/equality.
- `src/state/editorStore.ts` — `EditorActions` intents.
- `src/features/brushes/BrushControls.tsx` — brush UI (`SliderField`).
- `src/core/project/projectFormat.ts` — `PROJECT_VERSION`, `readBrush`
  (around line 660), serializer, version history comment.
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
- **Preview vs commit**: press inserts real preview content (or starts a buffer),
  moves update it in place, release records exactly one command, cancel /
  lost capture / tool switch / over-ceiling removes it with **no history and no
  revision bump**.
- **A shape is an ordinary stroke** whose samples trace the outline;
  `fill: true` fills the polygon before tracing the outline. No geometry type.
- **A fill is a pixel patch**, not a traced contour: colour, tight bbox, binary
  mask. Redo/reopen replay the mask, never re-run the flood.
- **A gradient is geometry + stops**, not pixels; radial = fixed centre, radius
  by distance, inner radius 0. Endpoints clamp to the document.
- **Editor options describe the next gesture and are not serialized**:
  `shapeFill`, `fillTolerance` (default 24), `gradientType`,
  `gradientEndColor`. Each is read at press time so the committed record keeps
  the setting it was drawn with. Changing an option is not an edit.
- **Format versioning**: a bump is required when an older reader would render a
  *different picture*, not for convenience. v1–v3 use `layers[].strokes`, read
  as stroke elements; v4 adds fills and `layers[].elements`; v5 adds gradients;
  unknown/newer versions are rejected outright, as are v4 files containing a
  gradient.
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
- Gradients: two stops, whole-layer, no stop editor, no angle snapping, no
  transparent stop, not selectable (cannot move/duplicate/flip).
- Fills: binary mask, no feather/gap-closing, no pre-commit preview, not
  selectable.
- Selection: stroke-level (whole strokes), active layer only, dropped on layer
  switch/tool switch, not a painting mask, no scale/rotate/perspective, no
  copy/paste across layers.
- Only `normal` blend mode; no layer masks/groups; no adjustment layers; no
  guides/grids; no autosave/crash recovery; `Ctrl+N` unbound.
- Project files store samples/masks/geometry as JSON, so they can grow large;
  no compressed/binary container yet.
- React layer has no automated tests.

Verification gaps:

- Gradients were checked in the browser at state level and their pixels through
  the real `Canvas2DRenderer`; the live display canvas was not sampled because
  the harness suspends animation frames.
- Bucket fill was checked on the live display canvas in the browser.
- **Neither has been verified in the packaged Tauri window**; native
  save/reopen and high-DPI rendering of the packaged build are unverified.
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
    rasterize into a fresh canvas. This is how gradient and filled-shape pixels
    were proven.
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

## 9. Next slice — brush hardness (Phase 3, first item)

The goal: a **hardness** setting that gives brush strokes a soft edge without
breaking the one-alpha-per-stroke model, captured per stroke so live rendering,
undo/redo, save/reopen and export agree.

### Recommended decisions to make and record

1. **Field**: add `hardness: number` to `BrushSettings`, clamped to `[0, 1]`,
   with `1` meaning the current hard edge. Default **1** preserves every
   existing stroke and document.
2. **Format**: **version 6**, because a version-5 reader that ignores `hardness`
   would render a soft stroke hard — a different picture. Write `hardness` on
   every stroke; when reading v1–v5, default it to `1`. A v5 reader already
   rejects a v6 file, so there is no silent misrender. Bump
   `PROJECT_VERSION`, the version-history comment, the parser, the serializer,
   and `PROJECT_FORMAT.md`/`README.md` together.
3. **Raster path**: soft coverage must be produced after the silhouette exists,
   not by lowering per-segment alpha. Two viable paths:
   - **Feather the finished stroke buffer once** (canvas `filter = "blur(r)"`
     on a scratch buffer, or an equivalent single-pass edge falloff), then
     composite at `strokeOpacity` as today. Cheap, keeps segment rendering, no
     self-overlap darkening; the trade-off is that it is a blur rather than an
     exact hardness profile, and the edge extends slightly beyond `size`.
     Confine the pass to the stroke's bounding box and account for
     `rasterScale`; verify at `rasterScale` 1 and 2.
   - **A coverage mask accumulated with per-pixel max** (stamp/distance-field),
     which gives a true `0..1` hardness profile but is the start of the deferred
     stamp engine. Do not start this unless the buffer-feather path is proven
     inadequate — the roadmap explicitly defers it.
   Whichever is chosen, brightness must stay constant across the stroke: the
   interior is full coverage and opacity is applied exactly once.
4. **Where it applies**: brush and eraser; shapes too, since they are strokes
   (a filled shape's interior should stay solid — only its outer edge softens).
   Decide explicitly and document.

### Implementation checklist

- [ ] `src/types/brush.ts`: add documented `hardness` field.
- [ ] `src/core/brushes/defaults.ts`: default, clamp in `normalizeBrush`,
      include in `brushSettingsEqual`; update `brushSettings.test.ts`.
- [ ] `src/core/brushes/strokeBuilder.ts`: no change needed if the brush is
      copied wholesale — verify with a capture test.
- [ ] `src/core/rendering/canvas2dStroke.ts` / `Canvas2DRenderer.ts`: implement
      the single-pass soft edge, scaled by the surface raster scale; keep
      incremental live rendering identical to a full rebuild; keep the eraser's
      snapshot-and-subtract behaviour intact.
- [ ] `src/core/engine/DrawingEngine.ts`: `setBrush({ hardness })` is editor
      state — no history entry, no dirty flag; the value is captured when the
      stroke starts (existing brush copy does this), so changing it later never
      rewrites old strokes. No new snapshot field is needed if the UI reads
      `snapshot.brush`.
- [ ] `src/features/brushes/BrushControls.tsx`: a **Hardness** slider (0–100 %,
      default 100 %) beside size and opacity.
- [ ] `src/core/project/projectFormat.ts`: version 6, serializer writes
      `hardness`, `readBrush` accepts a missing field only for older versions
      and defaults to 1, rejects out-of-range values in v6.
- [ ] Tests to add/extend:
      `brushSettings.test.ts` (clamp/equality),
      `canvas2dStroke.test.ts` (hard stroke call shape unchanged; soft stroke
      applies the feather once, not per segment),
      `canvas2dRenderer.test.ts` (live vs rebuild, opacity once, eraser),
      `drawingEngine.test.ts` (editor state, per-stroke capture, undo/redo),
      `projectFormat.test.ts` (v6 round-trip, v1–v5 default to 1, invalid
      hardness rejected, v5 reader path), `projectLifecycle.test.ts`
      (save/reopen preserves softness).
- [ ] Docs in the same commit: README (feature + limitations + version),
      ARCHITECTURE (hardness/coverage model and trade-off), PROJECT_FORMAT
      (version history, required field), ROADMAP (tick the item or narrow it,
      move "Next slice" to spacing/stabilizers), HANDOFF + this brief.
- [ ] Browser check: press `b`, set hardness low, draw a stroke, sample the edge
      (soft falloff) and the interior (same colour/brightness as a hard stroke);
      undo/redo, save/reopen, and the eraser path. Report pixel evidence.
- [ ] Commit (`git commit -F`) and push.

### Acceptance criteria

- Hardness `1` renders pixel-identically to today's strokes.
- A soft stroke has a visible falloff at its edge, full-strength interior, and
  **no darkening where it crosses itself** (the key regression).
- Live rendering, undo/redo and reopen produce the same pixels.
- Changing hardness after drawing does not alter existing strokes; hardness is
  captured per stroke.
- No history entry or dirty flag from changing the setting.
- Old projects open and render exactly as before; new files record the value.

## 10. First ten minutes of a new session

1. `git status -sb` and `git log --oneline -8` — confirm `main` at `dc87f1d`
   (or the commit this file names).
2. `pnpm test` and `pnpm typecheck` — establish the baseline before touching
   anything (expect 380 tests in 26 files).
3. Read the **"Next slice"** section of `docs/ROADMAP.md`; it is the authority
   if it differs from this brief.
4. Pick **one** slice, implement it end to end, and add its regression tests.
5. Run `pnpm test`, `pnpm typecheck`, `pnpm build`; verify the interaction in
   the running app; update the docs; commit with `git commit -F`; push.
