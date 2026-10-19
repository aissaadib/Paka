# Handoff — Paka drawing app

**Read this first if you are a new agent session on this repository.** It is the
briefing that the previous session would have given you: what Paka is, how work
is done here, what is already shipped, which decisions are settled, how to verify
anything, and what to do next.

Last verified: **2026-10-20**, at the gradient commit on `main` (the current
`HEAD` when this file was written; clean and in sync with `origin/main`).

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

## 4. Current state (verified 2026-10-20)

- Branch `main`, in sync with `origin/main` after the gradient slice.
- **`pnpm test` → 380 tests in 26 files, all pass.** `pnpm typecheck` clean;
  `pnpm build` succeeds.
- **Project file format version 5** (`PROJECT_VERSION = 5`).
- A release executable has been built and launched successfully:
  `src-tauri/target/release/paka.exe` (4.58 MB) next to `WebView2Loader.dll`.
  It is **unsigned** and its link emitted a MinGW `.rsrc merge failure: multiple
  non-default manifests` warning (see §8). The executable predates the fill and
  gradient slices.

### Shipped slices (this arc, newest first)

| Commit | Slice |
| --- | --- |
| current `main` | **Gradients** — first-class `GradientRecord` (linear/radial, stops, opacity) in the ordered element list; live drag preview, one undo step, format version 5. |
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
  bounding-box mask, not a full-canvas copy.
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
- **Project format is version 5.** `layers[].elements` is one ordered list of
  `kind: "stroke"`, `kind: "fill"` and `kind: "gradient"` entries; versions 1-3
  have only `layers[].strokes`, read as stroke elements in the same order.
  Version-4 files open unchanged and may contain fills; a gradient in a
  version-4 file is rejected. The bump is required because a version-4 reader
  cannot read the new kind.
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
  size/opacity/pressure; stroke opacity is composited once, so self-overlap does
  not darken.

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
- `src/core/document/strokeStore.ts` — ordered `LayerElement` list plus the
  filtered stroke view and in-place `replace` for gradient previews.
- `src/core/commands/fillCommand.ts` — redo replays the committed patch.
- `src/core/commands/gradientCommand.ts` — redo re-inserts the committed record.
- `src/core/rendering/canvas2dStroke.ts` — `rasterizeStroke`, including the fill
  branch for filled shapes.
- `src/core/rendering/Canvas2DRenderer.ts` — `rasterizeFillPatch`,
  `rasterizeGradient`, `readCompositeImage`, element-ordered layer rebuilds.
- `src/core/document/types.ts` — `StrokeRecord` (incl. `fill?: boolean`),
  `FillPatchRecord`, `GradientRecord`, `LayerElement`, type guards, `Layer`.
- `src/core/project/projectFormat.ts` — `PROJECT_VERSION`, serialize/parse,
  version-history comment, fill and gradient validation.
- `src/core/tools/toolDefinitions.ts`, `src/types/tool.ts` — tool definitions and
  the `fillable` field.
- `src/features/shapes/ShapeControls.tsx` — the **Fill shape** switch.
- `src/features/fill/FillControls.tsx` — the bucket **Tolerance** control.
- `src/features/gradient/GradientControls.tsx` — **Radial** and **To** colour.
- `src/state/editorStore.ts` — editor (UI) state actions, e.g. `setShapeFill`,
  `setFillTolerance`, `setGradientType`, `setGradientEndColor`, `dismissNotice`.
- Tests: `src/test/floodFill.test.ts`, `src/test/fillCommand.test.ts`,
  `src/test/gradient.test.ts`, `src/test/canvas2dRenderer.test.ts`,
  `src/test/drawingEngine.test.ts`, `src/test/projectFormat.test.ts`,
  `src/test/projectLifecycle.test.ts`, shared fakes in
  `src/test/support/recordingCanvas.ts` (gradient methods are injected alongside
  the recorded methods).

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

## 9. Next move

**Brush hardness** (the first Phase 3 item). The "Next slice" section of
[ROADMAP.md](ROADMAP.md) is kept current and is the authority; it now describes
the hardness slice rather than gradients.

The constraints that matter:

- a `hardness` field is editor state for the next stroke, like `shapeFill` and
  `fillTolerance`, and must be captured per stroke so undo/reopen reproduce it;
- soft coverage must come from the rasterizer, not from lowering each segment's
  alpha - stroke opacity is applied once per stroke today, and overlapping
  translucent dabs would reintroduce self-overlap darkening;
- decide explicitly whether the brush field is additive (no version bump) or
  required (version 6), based on whether an older reader ignoring it changes the
  picture;
- do not start the stamp-based brush engine until hardness has a verified raster
  path; they share the coverage question.

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
- **High-DPI behaviour of the release executable is unverified.** The link warned
  about merged resource manifests; the app launches, its window responds and its
  title updates from the frontend, but DPI scaling of the packaged build was not
  visually checked.
- **`cargo test --lib` cannot run** on this toolchain (§7).
- Product limitations documented in ROADMAP and not planned yet: undo history is
  not stored in the project file (reopening rebuilds one step per element); no
  autosave or crash recovery; the React layer has no automated tests; `Ctrl+N` is
  not bound (use `File -> New Document...`); fills are binary/unselectable;
  gradients are two-stop, whole-layer, have no stop editor and are unselectable.

## 11. First five minutes of a new session

1. `git status -sb` and `git log --oneline -8` — confirm you are on `main` at the
   commit this file names.
2. `pnpm test` and `pnpm typecheck` — establish the baseline before touching
   anything.
3. Read the **"Next slice"** section of `docs/ROADMAP.md`.
4. Pick **one** vertical slice, implement it, and add a regression test with it.
5. `pnpm test`, `pnpm typecheck`, `pnpm build`; verify the interaction in the
   running app (§8); update the docs (§2.4); commit with `git commit -F`; push.
