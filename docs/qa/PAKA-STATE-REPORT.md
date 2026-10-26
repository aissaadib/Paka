# Paka: state report

**App:** Paka 0.1.0 (Tauri 2 + React + TypeScript, Windows x64)
**Branch:** `integration/editable-shapes-wave`
**Commit:** `e871e8a` — "docs(bench): record a paired before/after run"
**Date:** 26 October 2026
**Worktree:** `D:/dev/Paka-overnight-worktrees/integration`

This is a snapshot, not a specification: the code is the authority, and
`README.md` §What works is the user-facing list. It replaces the snapshot taken
at `abfeedb` on 25 October, which described the vector-icon wave; that wave is
still in the tree, but the app has moved on and several of that report's numbers
are now stale.

---

## 1. What the app is

Paka is a desktop raster drawing application: a Tauri shell around a React front
end and a Canvas 2D renderer. The document is a list of **elements** — strokes,
fill patches, gradients and native shapes — grouped into layers; the renderer
rasterizes those lists into per-layer surfaces and composites them. Nothing is a
destructive bitmap edit, so undo, reopen and export all reconstruct the same
picture from the same list.

| | |
| --- | --- |
| Front end | React 19 + TypeScript, Vite |
| Renderer | Canvas 2D, per-layer surfaces, one stroke scratch buffer |
| Shell | Tauri 2, six Rust modules (`lib`, `main`, `native_environment`, `project_io`, `settings_io`, `window_fit`) |
| Source | 346 `.ts`/`.tsx` files, ≈ 90 800 lines |
| Tests | 106 unit/behaviour files (2634 tests), 16 visual specs (98 tests) |
| Project format | v15 |
| Package version | 0.1.0 (unreleased) |

---

## 2. What it does

### Drawing

- **Brush** (`B`): pressure-sensitive, with size, opacity, hardness, spacing,
  stabilizer, texture/grain, and a pressure curve of up to 32 control points.
  Round, and also stamped: a dab engine with its own hardness, spacing,
  directional per-dab texture and a brush **tip** frame.
- **Eraser** (`E`): the same footprint, subtracting coverage instead of adding
  it.
- **Shapes** (`L` line, `R` rectangle, `O` ellipse, `P` polygon, `S` star):
  drawn with a live preview, Shift constrain and Alt draw-from-centre, and
  committed as **native, editable shape records** rather than baked samples (see
  below).
- **Shape edit** (`V`): click a shape to select it, drag it to move, pull a corner
  to resize, pull the rotation handle to turn it, and edit width/height,
  rotation, polygon sides, star points and inner radius, fill, colour, stroke
  width and opacity. One history entry per gesture.
- **Bucket fill** (`F`): a tolerance-based scan of the composited canvas, either
  the contiguous region around the seed or every matching pixel (`global` mode),
  sampled at 1, 2, 4 or 8 document pixels. The result is a committed raster
  patch, not an editable region.
- **Gradient** (`G`): a linear or radial gradient with draggable handles, mid
  stops and a stop editor.
- **Selection** (`M`): marquee, move, nudge, scale and rotate, plus fixed-step
  transforms; the result is committed as an ordinary edit.
- **Colour picker** (`I`), **composition guides** (`U`), **grid and snapping**,
  **rulers** (a display-only toggle), **reference images**, and **pan/zoom**.

### Native editable shapes

A committed shape is a `ShapeRecord` — `{ id, layerId, kind: "shape", geometry,
brush, fill }` — not a list of stroke samples. That is the difference between
the old behaviour and the current one, and it is what makes a shape editable
after it is drawn:

- `geometry` is a discriminated union. A **line** keeps its two endpoints; a
  **box** shape (rectangle, ellipse, polygon, star) keeps `x, y, width, height,
  rotation, sides, innerRatio`. The `shape` field is the identity, so nothing
  ever guesses a primitive back out of samples.
- One derivation feeds preview, commit, reopen and export:
  `shapeSpecFromDrag(kind, drag, options)` turns a drag plus the options into a
  spec, and `shapeGeometryOutline(geometry)` turns a spec into the outline. The
  tool previews that outline, the engine commits it, the renderer rebuilds it
  and the export rasterizes it — there is no second geometry path to drift.
- The renderer reuses the stroke rasterizer: `strokeFromShape(shape)` expands the
  shape to a derived `StrokeRecord` with the same outline and brush, so
  appearance is preserved exactly and legacy baked shapes keep their old pixels.
- Creation commits geometry on release; a cancel, tool switch, lost capture or
  `Esc` discards the preview and records nothing. The **Shape edit** tool chooses
  its gesture by what the press hits: a handle resizes or rotates, a shape
  selects and moves, empty canvas clears. A gesture previews by replacing the
  record in the store and records **one** edit command on release.
- The selection overlay (frame, accent outline, handles) is display-only: it is
  painted in the overlay pass and never reaches a layer surface, the document
  model or a project file.
- **Symmetry copies are native shapes too**, inserted after the original as one
  history step.
- The stroke marquee stays stroke-only. Native shapes are edited by the Shape
  edit tool; a version-14 file of baked shapes opens unchanged and is never
  guessed back into shape objects.

### Interface

- **15 tools** in the rail, a tool-options strip that follows the tool, and a
  command palette plus a canvas context menu driven by one command registry.
- **5 side panels**: Colour, Brushes, Layers, References, Navigator — each
  registers itself and can be hidden, folded or reordered; the layout is
  persisted.
- **Colour dock**: HSV wheel, primary/secondary chips, an editable palette, recent
  colours, and a WCAG 2.2 contrast plus CIEDE2000 colour-difference readout.
- **Brush library**: six built-in brushes with vector icons, a searchable grid,
  favourites, and import/export of a preset library file.
- **Documents**: multiple open documents in a tab strip, each with its own
  engine, history, selection and viewport; recent files; a second view of the
  same canvas.
- **Persistence**: `.paka` project files, PNG export, a settings file, and a
  workspace file carrying the window's arrangement, theme and UI scale.

---

## 3. Architecture in one screen

The reading index is `AGENTS.md`; this is the shape it describes.

- **`core/document/`** — the model. `DrawingDocument` holds layers, guides and
  references; `StrokeStore` holds the ordered element list; `strokeSelection`,
  `selectionTransform`, `selectionHandles`, `guides`, `grid`, `symmetry` and
  `blendModes` are pure geometry and rules. `shapeRecord.ts` is the pure
  geometry of a native shape: its outline, its hit test, its move/resize/rotate
  and its symmetry copies.
- **`core/engine/DrawingEngine.ts`** (≈ 3 500 lines) — the gesture router and the
  single owner of editor state: tools, strokes, shapes, fills, gradients,
  selection, history, viewport, panels, presets and settings. It publishes an
  immutable `EditorSnapshot` to React.
- **`core/rendering/`** — `Canvas2DRenderer` (≈ 1 750 lines) owns the layer
  surfaces, the stroke buffer, compositing, the overlays and the export; the
  rasterizers (`canvas2dStroke`, `stampCoverage`, `brushPreview`) are separate
  pure-ish modules.
- **`core/commands/`** — undo/redo. Every edit is a `Command` on a `CommandStack`;
  layer edits, stroke edits, gradient edits, shape create/edit/delete and
  transforms each have their own command type.
- **`core/project/`** — serialize/parse/validate and the two native dialogs.
- **`core/settings/`, `core/workspace/`, `core/panels/`** — the three persisted
  preference domains, each with a schema, a tolerant reader and a settings
  section.
- **`features/`** — the React surface, one folder per panel or control strip.
- **`state/`** — the Zustand-style stores the components read.

---

## 4. The document format

`PROJECT_VERSION` is **15**. The format is documented in
`docs/PROJECT_FORMAT.md` and validated on read: unknown versions are refused,
every field is clamped or defaulted, and the closed sets (blend modes, element
kinds) are enumerated. The version history covers, in order: brush settings,
texture, hardness, the stamp engine, per-dab texture, the brush tip, layers and
groups, gradients, and — at **v15** — the native shape element
(`kind: "shape"`). A v15 shape carries its geometry and brush, so it is
reconstructed rather than guessed; a version-14 file's baked shapes stay baked
strokes, because turning samples back into a primitive would be a guess.

Two compatibility rules hold and were not touched by the performance pass: an
absent optional field means the old behaviour (so old files still open), and a
field that changes how stored samples *render* forces a version bump.

---

## 5. Verification, measured today

| Check | Result |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm test` | **106 files, 2634 tests, all passing** |
| `pnpm test:visual` | **98 tests, all passing** (bundled Chromium, port 1422) |
| `pnpm build` | clean — 619.61 kB JS (182.67 kB gzip), 49.70 kB CSS (8.15 kB gzip) |
| `cargo check` | clean |
| `cargo test --lib` | **cannot run on this toolchain** — `0xC0000139 STATUS_ENTRYPOINT_NOT_FOUND` from the MinGW `.rsrc merge failure`. Pre-existing and documented in `docs/HANDOFF.md` §7; `pnpm test` is the suite. |
| Retained heap, 120 strokes | +0.00 MiB |

The visual suite is the only place antialiased and blurred edges are checked; the
software pixel canvas used by the unit tests can disprove a placement or an
extent, but it cannot prove a Chromium edge.

---

## 6. Performance

A measured pass on the renderer landed in this branch; the evidence, the method
and the limits are in **`docs/qa/PERFORMANCE-PASS.md`**, and the harness is in
`bench/`.

In one paragraph: two paths were doing work proportional to the **document**
rather than the **stroke** — the stroke buffer's full-document clear, and the
eraser's full-document restore-and-subtract. Both were fixed; a shape drag is
**56 % cheaper on a 4096 page** and an eraser **54 % cheaper on 2048**. A live
brush stroke is unchanged, because it never did document-sized work between
samples. The remaining cost of a live stroke on a large page is the **display
pass** — a 4096² layer surface downsampled into a 1280×800 canvas every frame —
which is architectural and was not attempted.

The numbers are HeadlessChrome on a development machine, not the packaged app.

---

## 7. Known limitations

These are real, and they are the code's, not the report's:

- **No text tool.** Fifteen tools, none of them type.
- **Selection is stroke-level and is not a mask.** A marquee selects whole
  strokes on the active layer; painting is not clipped to a selection; the frame
  is the bounding box of the selected strokes, not the region dragged.
- **Dragging a selection re-rasterizes the whole layer on every pointer move.**
  The stroke list stays authoritative, so the drag cannot drift, but a heavy
  layer will lag. This is the first thing to cache.
- **A transform is baked on apply**, and the painted width is not scaled with the
  path: a scaled stroke is the same stroke along a different path, not a stroke
  drawn with a bigger brush.
- **Native shapes and stroke selection are two different models.** The marquee
  selects strokes only, so it never picks up a native shape; shapes are selected
  and edited one at a time by the Shape edit tool, and there is no multi-shape
  edit.
- **Guides are axis-only** (vertical or horizontal), with a fixed colour, no
  position label and no duplicate.
- **A bucket fill is a committed raster patch**, not an editable region; the
  scan refuses documents above 16 777 216 pixels.
- **Gradients are content, not masks**: a gradient covers what is below it on its
  layer, and it is not selectable, so it can be undone but not moved.
- **Blend modes are the separable set** (`normal`, `multiply`, `screen`,
  `overlay`, `soft-light`, `hard-light`, `color-dodge`, `darken`, `lighten`,
  `difference`, `exclusion`). Hue/saturation/colour/luminosity are not
  implemented.
- **Layer *selection* is not an undo step**; layer *edits* are.
- **The `README.md` limitations list has drifted from the code.** Four verified
  examples: (1) it says a shape "is stored as ordinary stroke samples, so it has
  no separate geometry to edit afterwards", while v15 ships `ShapeRecord` and the
  Shape edit tool; (2) it says "the stamp engine is round dabs only … there is no
  brush **tip**", while `BrushSettings.tip`, `core/rendering/brushTip.ts`,
  `BrushTipPreview` and `brushTip.test.ts` all ship it; (3) it lists thirteen
  tools and omits `shapeEdit` and `reference`; (4) it says "There are no rulers"
  and that gradients are "two-stop" with "no draggable stop editor", while the
  rulers are a wired overlay with a toggle action and `GradientStopEditor`,
  `gradientMidStops` and `gradientEditCommand` ship mid stops and draggable
  geometry. The code is the authority; the README needs a pass.

---

## 8. Repository state

| | |
| --- | --- |
| `origin/main` | `1312965` — "Merge pull request #17", the colour-dock repair |
| This branch | 10 commits ahead of `origin/main`, 1 behind (the merge commit itself) |
| Open pull requests | none |
| Local `main` ref | stale — do not use it as a base; `origin/main` is the reference |

The 10 commits ahead are this performance pass: the benchmark harness, the
baseline, three renderer changes, the recorded evidence and the two reports.
They are local and unpushed, and the branch has not been rebased onto the merge
commit.

Housekeeping, in order of value:

1. Rebase the branch onto `origin/main` so the 10 commits sit on the merged tree.
2. Open a pull request for them; the branch has no open PR.
3. Refresh `README.md` §What works and §Known limitations against the code (§7).

---

## 9. Next

In priority order, with the evidence behind each:

1. **The display pass.** 5.6 ms per frame to draw one 2048² layer surface into a
   1280×800 canvas, and the dominant remaining cost of a live stroke on a large
   page. Needs a display-resolution or tile cache, and its own measurement.
2. **The dab engine.** 295 ms for a 240-sample stamped stroke on 2048; untouched
   by this pass and not yet profiled internally.
3. **Shape drags.** Still 3.1 ms per pointer move on a 4096 page, down from 7.0.
   Incremental compositing would need a design decision about what the preview
   is.
4. **Documentation.** The four verified README drifts in §7; the code and this
   report are the current description.
5. **The autosave policy.** The machinery exists
   (`core/autosave/autosaveService.ts`) but is deliberately not enabled; the
   policy is the owner's decision, recorded in
   `docs/qa/T06-IMPLEMENTATION-REPORT.md`.

---

## 10. How to reproduce this report

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm test:visual
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
node bench/run.mjs --label my-run      # the performance harness
```

The packaged application is the only place its own frame timing can be measured;
`docs/HANDOFF.md` §7 describes the DevTools-protocol route for that, and
`docs/qa/PACKAGED-TAURI-NIGHT-SHIFT-ERRATUM.md` explains why a browser-harness
frame number is not a packaged-app frame number.
