# Paka architecture

Paka is a desktop raster drawing application. This document describes how the
pieces fit together today, which boundaries are contracts rather than
conventions, and what is deliberately not built yet.

The frontend owns the drawing engine. Rust is used only for native integration
and, later, for work the WebView genuinely cannot do well (tile compositing,
image encoding, file I/O). HTML Canvas 2D is the current raster backend, behind
an interface that a WebGL/WebGPU backend can replace without touching the rest
of the app.

## Design constraints

- **Tauri 2 + React + strict TypeScript + Vite**, `pnpm`, Rust for the native
  shell. No Electron, no Qt, no Canvas wrapper libraries - the rendering and
  input pipeline is ours.
- **Document geometry never depends on the view.** Zoom, pan and device pixel
  ratio change how pixels are *presented*; they never change document
  dimensions, stroke coordinates or brush size.
- **Pointer Events, not mouse events.** Pen, touch and mouse all arrive through
  the same normalized sample type.
- **No React work per pointer move.** Input is bound imperatively and rendering
  is batched to animation frames; React only re-renders on low-frequency state
  changes (tool, brush, layer, viewport, history).
- **Command-based undo/redo.** No per-move snapshots. An episode of drawing
  becomes exactly one undoable command.
- **Nothing is configurable that is not implemented.** There are no dead
  sliders, no blend-mode dropdown with one option, no texture controls.

## Data flow

```
DOM pointer events
  │
  ├─ core/input/canvasInputBinder   raw DOM events → normalized PointerSample
  │      └─ core/input/pointer       pressure policy, screen→document mapping
  │
  └─ core/engine/DrawingEngine      owns document, viewport, tool, brush, history
         ├─ core/brushes/strokeBuilder    samples → StrokeRecord (structure of arrays)
         ├─ core/commands                 one command per finished stroke or layer change
         ├─ core/document                 pure document + layer metadata
         ├─ core/project                  project format + save/open/export workflow
         │      └─ ProjectFileGateway (port) → Tauri invoke / dialogs
         │         └─ PngEncoder (port) → canvas.toBlob
         └─ core/rendering                pixels: layer surfaces, stroke buffer, display
                                            └─ DrawingRenderer (interface)

React UI
  ├─ reads    DrawingEngine.subscribe()   low-frequency snapshot
  └─ writes   DrawingEngine actions       setTool / setBrush / addLayer / undo / …
```

`DrawingEngine` is the only place that knows about all of the above. Every other
module has a single reason to change.

## Project files

A project is a versioned JSON file (`.paka`) holding the document metadata, the
layer list and the **stroke data** - never a flattened image, so a reopened
drawing is still editable stroke by stroke. The format, its validation rules and
its versioning policy are documented in [`PROJECT_FORMAT.md`](./PROJECT_FORMAT.md).

The pieces:

| Piece | Role |
| --- | --- |
| `core/project/projectFormat.ts` | Pure format: `serializeProject` / `parseProject`. No I/O, no engine. |
| `core/project/projectGateway.ts` | `ProjectFileGateway`: pick a path, read text, write text/binary. |
| `core/project/tauriGateway.ts` | The real gateway: native dialogs + three scoped `invoke` commands. |
| `core/project/projectFiles.ts` | The workflow: new/open/save/save-as/export as `FileOutcome` unions. |
| `core/export/pngExport.ts` | Composite → PNG bytes, with the encoder as a parameter. |
| `features/project/*` | React: menu wiring, messages, unsaved-changes dialog, window title, close guard. |

Three rules keep a file operation from corrupting the editor:

1. **Parse before replace.** `open()` validates the text completely before the
   engine sees it; a bad file leaves the current drawing untouched.
2. **Write before clean.** `save()` writes, and only then records the saved
   revision; a failed write keeps the unsaved marker and the previous path.
3. **The dirty flag is a revision comparison.** `revision !== savedRevision`,
   with both counters monotonic. Undoing back to the saved state therefore does
   *not* claim the work is safe - a deliberate conservative choice.

Rust owns the actual disk access (`src-tauri/src/project_io.rs`): a temporary
file in the same folder, `sync_all`, then an atomic rename over the target, so
an interrupted save cannot leave a half-written project.

## Coordinate spaces

Four distinct spaces exist, and every conversion happens in a named function.

| Space | Unit | Produced by | Notes |
| --- | --- | --- | --- |
| Document | logical px | `screenToDoc` | Stroke data and brush size live here. Independent of zoom and DPR. |
| Screen | canvas-local CSS px | `PointerEvent.clientX - canvasRect.left` | Relative to the canvas element, never the window. |
| Device | backing-store px | `css * devicePixelRatio` | Only the display canvas uses this. |
| Surface | raster px | `doc * rasterScale` | Only per-layer surfaces use this. |

The viewport is a plain value, `{ zoom, offsetX, offsetY }`, with
`screen = doc * zoom + offset`. All of its math is in
`core/rendering/viewport.ts`, free of DOM and renderer state, so it can be unit
tested directly.

`rasterScale` is a *supersampling* factor for layer surfaces (`clamp(dpr, 1, 2)`
in the app). Raising it makes strokes crisper on HiDPI displays at the cost of
memory; it never changes document size or stroke coordinates.

## Module map

| Path | Responsibility | Depends on |
| --- | --- | --- |
| `src/app` | Entry point, provider wiring, global styles | features, components, state |
| `src/components` | Presentational shell: menu bar, toolbars, panels, icons | types only |
| `src/features` | Feature UI: canvas stage, brush/colour/layer/history/document controls | hooks, core types |
| `src/hooks` | React bindings: `useEditor`, `useEditorState`, `useKeyboardShortcuts`, `useNativeEnvironment` | state, core types |
| `src/state` | The editor store + React context that holds the single engine instance | core/engine |
| `src/core/document` | Document and layer metadata, stroke store | types, utils |
| `src/core/brushes` | Brush defaults, stroke sample processing (`StrokeBuilder`) | core/document types |
| `src/core/tools` | Tool registry and per-tool behaviour (brush, pan) | core/document, types |
| `src/core/commands` | Command stack, stroke command, document (layer) command | core/document |
| `src/core/input` | Pointer normalization and DOM binding | core/rendering (viewport math only) |
| `src/core/rendering` | Viewport math, frame scheduler, Canvas 2D renderer, stroke rasterizer, layer surfaces | core/document types |
| `src/core/engine` | Integration: stroke lifecycle, history, layers, viewport, cursor stream | all of `core` |
| `src/core/project` | Project format, file gateway port + Tauri implementation, save/open workflow | core/document, core/engine (types), utils |
| `src/core/export` | PNG encoding of the document composite | core/rendering types |
| `src/types` | Shared value types (brush, pointer, geometry, viewport, tool) | nothing |
| `src/utils` | Small generic helpers (math, ids, base64, paths, a tiny store) | nothing |

Dependency direction is strictly downward in that table: `features` never
imports from another feature's internals, `core` never imports React, and
`types`/`utils` import nothing. `core/rendering` is the only module allowed to
touch Canvas 2D.

## Rendering pipeline

`Canvas2DRenderer` owns three kinds of canvas:

1. **The display canvas** - the element in the DOM. Its backing store is
   `CSS size * devicePixelRatio`.
2. **One surface per layer** - `document size * rasterScale`. This is where
   layer pixels actually live.
3. **One stroke buffer** - same resolution as a surface, holding the stroke
   currently under the pointer.

A frame (`render()`) does, in order:

1. reset the transform and clear the display,
2. set the document transform (`scale = zoom * dpr`, `translate = offset * dpr`),
3. fill the paper with the document background,
4. composite each **visible** layer with `opacity > 0`, bottom-first, applying
   the layer's blend mode and alpha,
5. composite the in-progress stroke buffer on top, at the stroke's own opacity,
6. stroke a hairline document border whose width is `1 / scale`, so it is
   exactly one device pixel at any zoom.

`composeDocumentImage()` reuses steps 3-4 - paper plus visible layers - into a
**new** canvas at document pixel size, with no viewport transform, no border and
no in-progress stroke. That canvas is what PNG export encodes, and rendering it
touches neither the document nor the display.

### Why a stroke buffer

Drawing directly into the layer surface would require re-rasterizing the whole
stroke on every input event. Instead, new samples are rasterized incrementally
into the buffer (`extendStroke` → `rasterizeStroke(ctx, stroke, fromIndex)`) and
only the new segments are drawn. When the stroke ends, the buffer is composited
into the layer surface **once** and cleared.

The buffer is also what makes a stroke one shape rather than a pile of
overlapping segments. Segments are rasterized at **full coverage**, and the
stroke's opacity is applied exactly once, when the buffer composites
(`strokeOpacity(brush, pressures)`):

- a stroke is one shape, so it gets one alpha - a semi-transparent stroke can
  never darken at the joints where consecutive segments overlap;
- width still varies per segment with pressure, because coverage is what
  accumulates, not color;
- separate strokes on the same layer still build up where they overlap, which is
  what users expect from "each stroke is a stroke".

`pressureOpacity` therefore contributes through the stroke's **mean pressure**
rather than per sample: a lighter pass yields a lighter stroke. True per-dab
opacity needs per-pixel max blending, which Canvas 2D does not expose - that is
a GPU-backend feature, not a Canvas 2D one.

### Dirty surfaces

A surface is marked dirty only when its pixels no longer match its stroke list:
undo/redo of a stroke, document *replacement* (new/open, where a reused layer id
can describe different pixels), document resize and raster-scale change.

Layer metadata and stack order never invalidate anything. A new layer gets a
dirty surface the first time it is composited, a removed layer's surface is
dropped when the renderer is handed the shorter layer list, and reordering,
hiding, renaming or selecting a layer changes only the composite. That is why a
rename or a layer click costs nothing but a repaint, not a re-rasterization of
every stroke on every layer. `render()` re-rasterizes a layer only if it is
dirty, then clears the flag.

### Frame batching

`FrameScheduler` coalesces many render requests inside one frame into a single
callback. Every mutation path calls `requestFrame()`; nothing renders
synchronously from an input handler.

### Rasterization

`rasterizeStroke` draws round-capped, round-joined segments between consecutive
samples, with diameter and alpha interpolated from the pressure of each pair.
It works entirely in document coordinates - the caller owns the transform - so
zoom never affects rasterized pixel data. This is a deliberately small brush
model: no stamps, no texture, no hardness curve.

## Undo / redo

Two kinds of step share one stack, so undo behaves uniformly whether the last
action was a stroke or a layer change:

- **`StrokeCommand`** captures no pixels. Undo removes the stroke from the
  `StrokeStore` and asks the renderer to re-rasterize that layer from the
  strokes that remain. Redo inserts it back **at its original index**, so the
  painting order inside the layer is identical to what the user drew.
- **`DocumentCommand`** captures the two document states around a layer change
  (`before`/`after`). Documents are pure metadata, so keeping two of them costs
  two small objects. When the change creates or destroys stroke data - layer
  duplication, or deletion, which must not lose the deleted layer's strokes -
  the command also carries that stroke list and restores it on revert.

Stack mechanics:

- `push` records a command whose effect is already visible (the normal case for
  painting - the stroke is rasterized while it is drawn).
- `execute` applies first, then records. The apply runs *inside* the
  re-entrancy guard, so a command cannot enqueue further commands.
- `undo`/`redo` never re-enter the stack.
- **Coalescing**: a command may declare a `mergeKey`. Consecutive commands with
  the same key collapse into one entry via `mergeWith`, keeping the earliest
  revert point and the latest apply point. The opacity slider uses this, so a
  drag is a single undo step instead of one per tick.
- Layer operations are **transactional**: no layer mutation touches the document
  directly. Deleting a layer is therefore recoverable, and every edit bumps the
  revision that drives the dirty flag. Selecting a layer is the one exception -
  it changes no pixels and is not an edit, so it neither dirties the document
  nor enters history.

History depth is capped (200 commands by default), dropping the oldest entries.

This is why no bitmap snapshots exist anywhere in the codebase: the stroke list
*is* the authoritative record, and pixels are a cache derived from it.

## Input pipeline

`CanvasInputBinder` attaches pointer/wheel listeners to the canvas element. It
is attached by the engine, not by React, so pointer movement never triggers a
React render. Behaviour:

- **Pointer capture** keeps a stroke alive when the pointer leaves the canvas;
  a lost capture cancels the stroke explicitly rather than leaving it dangling.
- **Presses outside the paper are ignored.** The canvas is larger than the
  document, so `beginStroke` rejects a sample that is not on the document
  rectangle (an inclusive test, so the edge pixel still paints). Without this a
  press in the grey margin recorded samples nothing could ever display: an undo
  step that appeared to do nothing and, if it was the only stroke, a blank PNG.
  A stroke that *starts* on the paper and wanders off it keeps recording; the
  surface clips the out-of-bounds part at composite time.
- **One pointer at a time** (`activePointerId`), so a second finger or device
  cannot interleave samples into a single stroke.
- **Coalesced events** are replayed, so high-frequency pen input is not dropped
  between frames.
- **Middle-button drag pans** regardless of the active tool; `mousedown` on
  button 1 is suppressed to stop Chromium's autoscroll.
- **Wheel** scrolls vertically, `Shift+Wheel` scrolls horizontally, and
  `Ctrl`/`Alt+Wheel` zooms around the cursor.

Pressure policy (`core/input/pointer.ts`): a pen reporting pressure is used
as-is; a pen reporting zero falls back to `0.5`; mouse, touch and unknown
devices report `1.0` so that moving the size slider changes width exactly.

## React integration

There is exactly one engine instance per window, created by `EditorProvider`
and shared through a React context. `useEditor()` returns the stable
`{ engine, actions }` handle; `useEditorState()` subscribes to the snapshot.

The snapshot is republished only when something with visual meaning changes
(tool, brush, layer list, viewport, history, document). Field-identity checks
keep it from churning. Two things deliberately bypass React:

- **Cursor position and pressure** are written imperatively through
  `engine.subscribeCursor`, because they change on every pointer move.
- **The canvas cursor style** is applied in an effect keyed on the tool id.

Keyboard shortcuts live in `useKeyboardShortcuts`; they call the same actions
the menus and buttons do.

## Native boundary (Rust)

`src-tauri` currently contains one command, `native_environment()`, returning
the compiled-in OS, architecture and crate version (`serde` camelCase). Its job
is to prove the IPC bridge is wired and to let the status bar report the real
host instead of guessing. `useNativeEnvironment` shows `native unavailable`
when the frontend runs outside Tauri.

The template's unused `tauri-plugin-opener` dependency was removed. The native
side is intentionally thin: nothing was moved into Rust pre-emptively.

## Replacing Canvas 2D with WebGL/WebGPU

`DrawingRenderer` (`src/core/rendering/types.ts`) is the seam. It is the only
interface the engine uses to touch pixels:

```
setDocument / setViewport / setDisplaySize / setRasterScale
invalidateLayer
beginStroke / extendStroke / endStroke / cancelStroke
render / requestRender / destroy
```

Stroke data is read through the separate one-method `StrokeSource` interface, so
a new backend never needs access to the stroke store itself. To add a WebGL or
WebGPU renderer:

1. Implement `DrawingRenderer` and register it where the engine constructs the
   renderer. Nothing else changes - not the tools, not history, not React.
2. Move segment rasterization to a shader. The data model already helps: strokes
   are structure-of-arrays (`xs`, `ys`, `pressures`, `times`), which uploads to
   GPU buffers with no repacking.
3. Keep the same surface-per-layer and stroke-buffer structure initially; it is
   what makes incremental drawing and stroke-level undo cheap.
4. `rasterScale` becomes less important (a GPU backend renders the display
   directly), but the document/screen separation in `viewport.ts` stays exactly
   as it is.

## Testing

`pnpm test` runs Vitest in a **Node** environment, which is why the core is
DOM-free by design.

- Document/layer operations, viewport math, stroke interpolation, pointer
  normalization, the command stack, the stroke command, the document command and
  the stroke store are tested directly.
- `DrawingEngine` is tested with a `null` renderer, covering stroke commit,
  cancel, undo/redo granularity, layer operations, and new-document reset. A
  separate suite injects a recording renderer to pin down surface-invalidation
  policy (layer metadata never re-rasterizes; a stroke undo does). It also
  asserts that no React-facing state is published while drawing.
- `canvas2dStroke` is tested directly: diameter/opacity curves, and - through the
  recording context - that rasterization is always **full coverage** (which is
  what stops semi-transparent overlap from darkening), that width still follows
  pressure per segment, and that `fromIndex` redraws only the new part.
- `Canvas2DRenderer` is tested with a **recording** fake canvas and 2D context:
  the compositor's rules (paper, layer order, visibility, opacity, the
  in-progress stroke, the border, dirty-driven re-rasterization, post-destroy
  no-ops) are asserted on the draw-call stream, including that a stroke reaches
  both the display and the layer at its own alpha exactly once. Real pixel
  coverage is out of scope for the unit suite.

Behaviour that only exists in a browser or a real window is verified manually
against the running app (composited pixels on the display canvas, layer
visibility and opacity effects, brush thickness in device pixels, the new
document dialog, the native status bar). What has and has not been verified is
reported separately rather than being implied by the test count.

## Known limitations

These are real gaps, not footnotes:

- **Tools**: only `brush` and `pan`. There is no eraser, selection, transform or
  fill tool.
- **Layer selection is not undoable.** Every layer *edit* is - add, duplicate,
  delete, rename, reorder, visibility and opacity - but selecting a layer
  changes no pixels and is deliberately not a history step.
- **Blend modes**: only `normal`. The field exists so layer data can carry a
  mode, but the compositor maps exactly one value.
- **Opacity is per stroke, not per dab.** A stroke gets one alpha, derived from
  the brush opacity and the stroke's mean pressure. Pressure can taper width
  within a stroke but not opacity: per-dab opacity without build-up needs
  per-pixel max blending, which Canvas 2D does not expose.
- **Rasterization is per-segment and CPU-side.** Long strokes mean many
  `stroke()` calls. It is fine at the sizes tested and is the first thing to
  move behind the renderer abstraction when it is not.
- **HiDPI cost**: raising `rasterScale` re-rasterizes every layer.
- **Undo history is not persisted.** A project file stores the document and its
  strokes, not the history: reopening a drawing rebuilds one step per stroke, so
  the work stays editable, but there is no redo of edits made before the save.
  See [PROJECT_FORMAT.md](PROJECT_FORMAT.md).
- **No tests for the React layer.** Hooks, components and the input binder are
  exercised manually in the browser, not by automated tests.
