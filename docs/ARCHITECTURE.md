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
| `src/core/tools` | Tool registry and per-tool behaviour (brush, eraser, shapes, picker, pan) | core/document, types |
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

`Canvas2DRenderer` owns three kinds of canvas, plus two temporary:

1. **The display canvas** - the element in the DOM. Its backing store is
   `CSS size * devicePixelRatio`.
2. **One surface per layer** - `document size * rasterScale`. This is where
   layer pixels actually live.
3. **One stroke buffer** - same resolution as a surface, holding the stroke
   currently under the pointer.
4. **An erase snapshot** - a copy of the active layer taken when an *erasing*
   stroke begins, allocated only while one is in flight (see
   [Eraser strokes](#eraser-strokes)).
5. **A 1x1 colour probe** - a scratch canvas the colour picker samples through,
   allocated lazily on the first pick and reused after (see
   [Colour sampling](#colour-sampling)). It is kept off the constructor so the
   stroke buffer stays the first canvas created.

A frame (`render()`) does, in order:

1. reset the transform and clear the display,
2. set the document transform (`scale = zoom * dpr`, `translate = offset * dpr`),
3. fill the paper with the document background,
4. composite each **visible** layer with `opacity > 0`, bottom-first, applying
   the layer's blend mode and alpha,
5. composite the in-progress stroke buffer on top, at the stroke's own opacity -
   unless the stroke erases, in which case the layer composited in step 4
   *already contains* the erasure, so drawing the buffer would paint the erased
   coverage back,
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
into the layer surface **once** and cleared. A shape tool does not append: it
replaces the whole outline and redraws the buffer (`replaceStroke`, see
[Shape tools](#shape-tools)).

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

A press with no movement is a dab, and a dab alone in the buffer would be
overdrawn by the first segment's round cap: the same area painted twice, which
costs a second pass of antialiasing on the start ring and makes the live image
differ from a re-rasterization of the same stroke. So when a stroke grows past
its first sample, the buffer is cleared and the stroke redrawn from scratch
(`extendStroke` with `fromIndex <= 1`); from then on appending segments is
already identical to a full re-rasterization. Live drawing and the pixels that
undo, reopen and export produce are therefore the same, which is asserted
against the real display canvas, not just the draw-call stream.

### Eraser strokes

An eraser is a brush whose strokes **subtract** coverage instead of adding it.
The stroke record is the same shape, carrying `erase: true` (see
`docs/PROJECT_FORMAT.md`), so a saved file and a re-rasterized layer both know
how to reproduce it. The tool itself is the same `BrushTool` instance
parameterised with the eraser's definition and `erases: true`; the engine stamps
`erase` onto the stroke it captures, which keeps the decision in the tool and
the stroke self-describing.

Subtracting is `destination-out` when the buffer composites into the layer, at
the stroke's own opacity. Painting does `source-over` at the same point, so
"one stroke, one alpha" holds for both tools: a half-opacity eraser removes half
the covered alpha, and going over the same area twice within one stroke does not
remove more than going over it once.

That last property is why an erasing stroke keeps a **snapshot** of the layer's
pixels from before the stroke. `destination-out` is not idempotent for partial
alpha: applying it twice to the same pixel removes more each time, so an eraser
that crosses itself would erase twice as hard at the crossing. Painting does not
have this problem, because the *buffer* accumulates full coverage and the alpha
is applied once. For erasing, the equivalent is to rebuild the layer from a fixed
base on every update:

```
surface = snapshot;                    // clear + drawImage(snapshot)
surface @ destination-out alpha = ...  // drawImage(stroke buffer)
```

The same snapshot makes cancellation exact. While an erasing stroke is in flight
the layer holds *snapshot minus the stroke*, which is not what the stroke list
says; `cancelStroke` therefore restores from the snapshot rather than trying to
paint the erasure back (compositing the snapshot `source-over` would not restore
erased pixels, it would only raise their alpha again, leaving a halo exactly
where the erase had been). `endStroke`, by contrast, does nothing at all: the
layer is already correct, and the stroke is about to enter the store.

Re-rasterization takes the same path as painting, differing only in the
composite operation per stroke:

```
for stroke in layer.strokes:
  rasterizeStrokeToBuffer(stroke)
  compositeStrokeBuffer(surface, strokeOpacity(...),
                        stroke.erase ? "destination-out" : "source-over")
```

Because each stroke composites once, in order, the rebuilt pixels match what
live drawing produced - the same guarantee the starter-dab rule enforces for
painting. The cost of the snapshot is one extra surface-sized canvas while an
erasing stroke is in flight; it is allocated lazily, reused across strokes, and
dropped when the stroke ends, is cancelled, or the document is replaced.

### Colour sampling

The colour picker reads the *composited* document - paper plus every visible
layer at its own opacity, bottom-first - because that is what the user sees.
Sampling the active layer instead would return the colour a pixel was authored
with, not the colour on screen: a 50%-opacity stroke over white looks like the
blend, not the stored colour, and a picker that ignored the paper and the layers
below would contradict the pixels under the eye.

`DrawingRenderer.readCompositePixel(docX, docY)` performs the read through a
lazily allocated **1x1 probe canvas**, not through the display canvas or the
export composite. The probe is filled with the paper colour, then each visible
layer is drawn with an integer offset of `-floor(docX * rasterScale)`, so the
surface texel under the sample lands exactly on pixel `(0, 0)` with **no
interpolation** - the read is the pixel under the pointer rather than a blend of
its neighbours, at any `rasterScale`. The paper is opaque, so the returned
colour needs no alpha, and the precision is the surfaces': 8 bits per channel in
sRGB. A pick is therefore the colour on screen, not a value that was
mathematically authored.

Two rules make picking safe:

- **It is a read, not an edit.** Like selecting a layer, a pick changes no
  pixels. It sets the brush colour through the same `setBrush` path the colour
  control uses, so colour has one source of truth, and it pushes no history
  entry, bumps no revision and never marks the document dirty.
- **A press outside the paper is ignored**, exactly like `beginStroke`: there is
  no composite there to sample.

The tool itself (`PickerTool`) is stateless - a pick is complete on pointer-down
and there is nothing to finish or cancel - and it stays selected afterwards,
consistent with the eraser. `B` returns to the brush.

### Shape tools

A line, rectangle or ellipse is a **stroke whose samples trace the shape's
outline** rather than a path the pointer traced. That is the whole trick: a
committed shape is an ordinary `StrokeRecord` (`ShapeTool` → `shapeOutline` →
stroke buffer → `StrokeCommand`), so it inherits one-undo-step semantics, the
project file, re-rasterization after undo or reopen, and layer compositing -
without a line of shape-specific rendering. The cost is honest and visible:
shapes are brush strokes, so they are **outlines drawn with round joins** (a
rectangle's corners are slightly rounded, an ellipse is a polygon of many short
segments) and they do not fill. Their samples carry pressure `1`, so a shape has
the brush's full, constant width.

The gesture is a drag from an anchor to the current point.
`core/tools/shapeGeometry.ts` is pure - it turns
`{ anchor, current, shift, alt }` into document-space points and touches neither
the engine nor the renderer: a two-point line, a five-point closed rectangle, an
ellipse sampled on a multiple of four segments so it touches its bounding box
exactly. `ShapeTool` owns only the anchor and recomputes the *whole* outline on
every move, which is what lets `Shift` and `Alt` change the shape mid-drag
(45-degree lines, squares and circles; drawing from the centre).

Because the outline is **replaced** rather than appended, the renderer contract
gains `replaceStroke(stroke)`: it clears the stroke buffer and re-rasterizes from
index 0. The preview therefore lives in the same buffer as a live brush stroke,
is composited above the layers at the stroke's own opacity, and still commits
through the same `endStroke` path.

Nothing reaches the layer until the press is released, which is what makes
cancellation exact: a cancelled gesture, a tool switch mid-drag or a lost capture
clears the buffer and leaves the layer untouched - unlike a brush stroke, whose
pixels are already real when it is cancelled. A release that never moved is
discarded as well, because its outline has no extent, so a stray click cannot
leave a dot; a gesture that starts outside the paper records nothing at all
(the same guard as `beginStroke`). The position and the modifier state of the
**release** sample decide the committed geometry, so the shape settles on where
the pointer was let go: holding `Shift`/`Alt` through the release keeps the
constraint, releasing the modifier first drops it.

### Selection and transform

A selection holds **whole strokes of one layer**, never part of a stroke and
never pixels. `core/document/strokeSelection.ts` is the entire hit-test rule and
is pure: the marquee is a rectangle in document space, and a stroke is selected
when its centreline meets that rectangle, inflated by half the stroke's painted
width (`strokeDiameter(brush, 1) / 2`) so a wide stroke whose pixels reach into
the marquee selects even when its samples stay outside. Segments are tested
**continuously** (Liang-Barsky), not just sample by sample: a sparse stroke that
crosses the marquee with both endpoints outside it is still selected. The test is
against the *active* layer's stroke list only, because a transform writes stroke
samples and a stroke belongs to exactly one layer.

A press that never moved is a zero-size marquee, so a click runs through exactly
the same rule: it selects the strokes under the pointer, or clears the selection
when it meets none. There is no separate click path to keep in step.

Only *which* strokes are selected is stored (`{ layerId, strokeIds }`). The frame
the user sees is **derived** from those strokes' bounds on every draw, which is
what makes it follow a move, an undo and a redo without any second piece of state
that could drift. Selection is editor state, not document state: it is not
serialized, it adds no history step, and it never marks the document dirty.

The overlay is **display-only**. The engine hands the renderer
`{ bounds, strokes }` through `setSelection(...)`; the renderer traces the
centrelines in blue and draws the frame as a dashed rectangle, after the layers
and the in-progress stroke and before the document border. It never reaches a
layer surface and `composeDocumentImage` (and therefore PNG export) never sees it.

Two gestures, chosen on press by `isInsideSelection`:

- **Marquee** - drag anywhere outside the frame. The rubber band is live in the
  overlay; the committed selection is decided on release and re-derived from the
  strokes. A marquee that meets nothing clears the selection.
- **Move** - drag from inside the frame. Every selected stroke's samples are
  written as `original + delta` and the layer is re-rasterized, so the pixels on
  screen are always exactly what the stroke list would produce; the store stays
  authoritative throughout the drag. On release one `MoveStrokesCommand` is
  **pushed** (the effect is already visible) holding the pre-drag copies:
  `apply` writes `original + offset`, `revert` writes the originals back. Because
  both directions are computed from the *same* stored originals rather than from
  the current state, undo and redo are exact and repeatable - there is no
  accumulation drift. Cancelling (a lost capture, a tool switch, `Esc`) writes
  the originals back and records nothing, and a press inside the frame that never
  moved records nothing either.

Three menu/keyboard transforms reuse the same "copy the originals, edit stroke
data, push one command" machinery:

- **Nudge** (arrow keys, `Shift` for 10 px) writes `original + delta`.
  Consecutive nudges **coalesce** into one history entry: the command carries the
  running total plus the copies taken before the first nudge, and a merge sums
  the deltas over those copies. Summing - rather than chaining commands - is
  what makes redo after an undo re-apply the whole run in one step instead of
  only the last press. It is the same rule the opacity slider follows.
- **Duplicate** (`Ctrl+D`) inserts a copy of each selected stroke directly above
  its source, preserving painting order, and then selects the copies so the next
  nudge or drag acts on what is visibly on top. The clone objects are created
  once, which is why redo re-inserts the same strokes (and ids) rather than
  minting new ones; undo removes them.
- **Flip** (`Ctrl+Shift+H`/`V`) is a coordinate map about the selection's own
  centre: `x -> 2cx - x`, or `y -> 2cy - y`. Brush and pressure data are
  untouched, and because the map is applied to the stored originals rather than
  to the current state, undo and redo never compound error. Two flips are the
  identity up to floating-point rounding, which is what composing a reflection
  with itself should be.

A transform is refused while a pointer gesture is in flight - a keyboard edit and
a drag would be writing the same sample arrays - and when nothing is selected.
Undoing a duplicate or a delete can leave the selection pointing at strokes that
no longer exist, so every history change re-derives the overlay from the store: a
frame that outlives the strokes it describes would be a lie the user can see.

`DeleteStrokesCommand` removes the selected strokes and, on revert, re-inserts
each at its **original index**, so undo restores the layer's painting order rather
than shuffling the deleted strokes to the top.

The selection is cleared when it stops meaning what it says: switching the active
layer, removing that layer, replacing the document (new/open) and switching away
from the select tool. It is deliberately *not* a mask - painting is never clipped
to it - so leaving it visible under another tool would imply a constraint that
does not exist.

The cost of the live move is honest: one full layer re-rasterization per pointer
move. That is the price of never showing a preview that could differ from the
committed result; caching the moved strokes' pixels is the obvious optimisation
if a heavy layer makes dragging lag.

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
- **`MoveStrokesCommand` / `DeleteStrokesCommand`** edit existing strokes rather
  than adding or removing a layer's paint. A move keeps each stroke's pre-drag
  sample arrays and writes `original + offset` on apply and the originals on
  revert; a delete keeps each stroke together with its index and re-inserts it
  there on revert. Neither snapshots a bitmap, for the same reason as
  `StrokeCommand`: the stroke list is the record and pixels are a cache.

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

`src-tauri` holds the project file I/O: `read_text_file`,
`write_text_file_atomic`, `write_binary_file_atomic` (all path-validating,
extension-restricted and size-capped) plus `native_environment()`, which returns
the compiled-in OS, architecture and crate version so the status bar can report
the real host instead of guessing. `useNativeEnvironment` shows
`native unavailable` when the frontend runs outside Tauri.

The native side is intentionally thin: nothing was moved into Rust
pre-emptively, and the file commands exist because the WebView has no filesystem
access at all.

## Replacing Canvas 2D with WebGL/WebGPU

`DrawingRenderer` (`src/core/rendering/types.ts`) is the seam. It is the only
interface the engine uses to touch pixels:

```
setDocument / setViewport / setDisplaySize / setRasterScale
invalidateLayer
beginStroke / extendStroke / replaceStroke / endStroke / cancelStroke
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
- Tool geometry is tested directly: `shapeGeometry` covers 45-degree snapping,
  squares and circles, drawing from the centre, the ellipse's bounded and
  exactly-closed outline, and the degenerate extent. Shape *behaviour* is
  covered through the recording renderer on the engine: a drag previews with a
  full-buffer redraw and commits nothing, the release commits exactly one stroke
  carrying the outline's samples, and cancellation, a mid-drag tool switch, an
  out-of-bounds start and a click that never moved all leave the document and
  the history untouched. `replaceStroke` is asserted on the draw-call stream: it
  clears the buffer and redraws the whole outline, and the preview composites at
  the stroke's own alpha.
- `canvas2dStroke` is tested directly: diameter/opacity curves, and - through the
  recording context - that rasterization is always **full coverage** (which is
  what stops semi-transparent overlap from darkening), that width still follows
  pressure per segment, and that `fromIndex` redraws only the new part.
- Selection is tested at three levels. `strokeSelection` is pure geometry:
  drag-direction normalization, edge-inclusive containment, inflation and
  translation, and segment-versus-rectangle cases including a segment that
  crosses with both ends outside, a segment whose bounding box overlaps but whose
  line misses (the case a bounding-box test gets wrong), a parallel near miss,
  a zero-length segment, and painted-width padding bridging a near miss. The
  engine suite drives the select tool through the same `handlePointerSample`
  entry point as the binder: marquee selection, click-to-select and
  click-to-clear, the live rubber band, an exact `original + delta` move with one
  undo step and exact undo/redo, a press that never moved recording nothing, a
  cancelled move restoring the strokes and recording nothing, deletion as one
  step with painting order restored on undo, active-layer scoping, and the
  selection dropping on a layer change, a new document and a tool switch. It also
  covers the keyboard transforms: a nudge run coalescing into a single step with
  exact undo and redo, duplicate inserting above its source and selecting the
  copies (so a following nudge moves only the copy), redo re-inserting the same
  clones, flips about the selection's centre with exact undo and the
  two-flips-are-the-identity property, and every transform refusing to run with
  nothing selected. The
  renderer suite asserts the overlay stream: the trace and the dashed frame come
  after the layers and before the solid border, `setSelection(null)` leaves only
  the border, and the exported composite contains neither.
- `Canvas2DRenderer` is tested with a **recording** fake canvas and 2D context:
  the compositor's rules (paper, layer order, visibility, opacity, the
  in-progress stroke, the border, dirty-driven re-rasterization, post-destroy
  no-ops) are asserted on the draw-call stream, including that a stroke reaches
  both the display and the layer at its own alpha exactly once. The eraser suite
  pins down the same stream for `erase: true` strokes: re-rasterization
  subtracts with `destination-out`, a live eraser stroke rebuilds its layer from
  the pre-stroke snapshot on every update (restore and subtract alternate, so a
  crossing stroke erases once), cancellation restores the snapshot, and the
  display never paints the eraser buffer. Real pixel coverage is out of scope for
  the unit suite.

Behaviour that only exists in a browser or a real window is verified manually
against the running app (composited pixels on the display canvas, layer
visibility and opacity effects, brush thickness in device pixels, the new
document dialog, the native status bar). Shape tools are verified the same way,
by dispatching real pointer drags at the live canvas and reading the display
pixels back: a rectangle inks its four edges and leaves its interior as paper, an
ellipse inks the four points on its axes while its bounding-box corners and
centre stay paper (which is what distinguishes it from a rectangle), a line inks
its midpoint only, and a `Shift` drag is confirmed to snap by inking the snapped
axis and leaving the unconstrained one bare. Undo after each shape returns the
canvas to paper, and the status bar shows the history depth rising by exactly one
per shape, which is the on-screen proof that a drag is one undo step. Selection is
verified the same way: a marquee drag selects the strokes it meets and traces
them (the dash frame hugs their bounds, and the status bar reads `N selected`),
dragging from inside the frame moves the ink to the new position and leaves the
old position as paper while the history depth rises by exactly one, `Esc` clears
the frame and the trace without moving anything, `Delete` removes the selected
strokes and undo restores them, and undo/redo of the move returns the ink to the
exact original and moved positions. Stroke compositing is verified that way
against the real rasterizer and the platform PNG encoder: a 50%-opacity stroke
that retraces itself is pixel-identical in its retraced and single-covered
parts, two separate strokes that overlap do build up, and the live composite
matches the one rebuilt from the stroke list after undo/redo exactly. The eraser
is verified the same way, by sampling the PNG produced by the app's own export
path: a full-opacity pass across a stroke reads back as pure paper (`255,255,255`)
with no halo, a half-opacity pass reads back as exactly the 50% blend
(`139,140,142` for `#16181c` over white), a stroke that retraces itself within one
stroke removes exactly as much as a single pass, undo restores the covered pixels
bit-for-bit and redo re-applies them, and a save/reopen round trip reproduces
every sampled pixel. The same harness confirms the format guard in the running
app: a file from a newer version is refused with a message and the open drawing
is left untouched, while a version-1 file opens with its strokes painted (a
version-1 file has no erasures to lose). What has and has not been verified is
reported separately rather than being implied by the test count.

## Known limitations

These are real gaps, not footnotes:

- **Tools**: only `brush`, `eraser`, `select`, `line`, `rectangle`, `ellipse`,
  `picker` and `pan`. There is no fill, gradient or text tool.
- **Selection is stroke-level, layer-scoped and limited to translation,
  duplication and reflection.** A marquee
  selects whole strokes (never part of one, so a selection cannot split a stroke
  or mask a brush stroke), only on the active layer, and it is dropped when the
  layer or the tool changes. There is no add/subtract modifier, no feathering, no
  clipping, and no scale, rotate or perspective; duplicate stays on the layer
  (there is no cross-layer copy/paste). The frame is the selected
  strokes' bounding box, not the region that was dragged.
- **A live selection move re-rasterizes the whole layer per pointer move.** The
  stroke list stays authoritative and the pixels are rebuilt from it, which is
  why the drag can never drift from the committed result; caching the moved
  strokes is the optimisation to reach for if a heavy layer makes dragging lag.
- **Shapes are stroke outlines, not vectors.** A committed shape is stored as
  ordinary stroke samples and cannot be recognised or edited as a rectangle
  afterwards, it does not fill, and it takes the brush's round joins. Shapes are
  also pressure-blind by construction: their samples carry pressure `1`, so a
  `Shift` drag gives a constant-width outline rather than a tapered one.
- **The colour picker samples the composite only.** It always reads paper plus
  visible layers; there is no per-layer sampling, no `Alt`-click temporary
  picker from the brush, no magnifier preview and no colour history or swatches
  from picks. Precision is the surfaces' - 8-bit sRGB - so sampling a
  semi-transparent area yields the blended screen colour by design.
- **An eraser stroke costs one extra surface-sized canvas** while it is in
  flight (its pre-stroke snapshot). It is allocated lazily and released when the
  stroke ends, but on a very large document it is a visible memory spike next to
  the stroke buffer. Erasing inside a GPU backend becomes a blend mode, and the
  snapshot disappears.
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
