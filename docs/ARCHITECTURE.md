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
  sliders and no blend-mode dropdown with only one real option.

## Data flow

```
DOM pointer events
  │
  ├─ core/input/canvasInputBinder   raw DOM events → normalized PointerSample
  │      └─ core/input/pointer       pressure policy, screen→document mapping
  │
  └─ core/engine/DrawingEngine      owns document, viewport, tool, brush, history
         ├─ core/brushes/strokeBuilder    samples → StrokeRecord (structure of arrays)
         ├─ core/fill                     composite pixels → patched fill region
         ├─ core/commands                 one command per finished stroke, fill or layer change
         ├─ core/document                 pure document + layer metadata, ordered element store
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
layer list and the **ordered element data** - strokes and serialized fill
patches - never a flattened image, so a reopened drawing is still editable
element by element. A fill stores its committed pixels (colour, box and coverage
mask), not its seed and tolerance, so reopening cannot re-derive a different
region. The format, its validation rules and its versioning policy are
documented in [`PROJECT_FORMAT.md`](./PROJECT_FORMAT.md).

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
| `src/core/document` | Document and layer metadata, ordered element store | types, utils |
| `src/core/brushes` | Brush defaults, stroke sample processing (`StrokeBuilder`) | core/document types |
| `src/core/fill` | Pure flood-fill scan and fill-patch creation/cloning | core/document types |
| `src/core/gradient` | Gradient records, endpoint movement and cloning | core/document types |
| `src/core/tools` | Tool registry and per-tool behaviour (brush, eraser, shapes, bucket, gradient, picker, pan) | core/document, types |
| `src/core/commands` | Command stack, stroke/fill/gradient commands, document (layer) command | core/document |
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

`Canvas2DRenderer` owns three persistent kinds of canvas plus three temporary
ones:

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
6. **A feather scratch canvas** - holds a blurred copy of a soft stroke's
   silhouette, sized to that stroke's padded bounding box rather than the whole
   document, allocated lazily on the first soft stroke and reused after (see
   [Soft edges (hardness)](#soft-edges-hardness)).
7. **A transient document-resolution composite** - allocated by
   `composeDocumentImage()` for PNG export and by `readCompositeImage()` for a
   bucket scan. It is not retained, so it never grows the renderer's steady
   memory footprint.

A frame (`render()`) does, in order:

1. reset the transform and clear the display,
2. set the document transform (`scale = zoom * dpr`, `translate = offset * dpr`),
3. fill the paper with the document background,
4. composite each **visible** layer with `opacity > 0`, bottom-first, applying
   the layer's blend mode and alpha,
5. composite the in-progress stroke buffer on top, at the stroke's own opacity -
   unless the stroke erases, in which case the layer composited in step 4
   *already contains* the erasure, so drawing the buffer would paint the erased
   coverage back. A hard stroke draws the raw buffer; a soft stroke draws its
   feathered copy through the same path that commits it to the layer,
6. stroke a hairline document border whose width is `1 / scale`, so it is
   exactly one device pixel at any zoom.

`composeDocumentImage()` reuses steps 3-4 - paper plus visible layers - into a
**new** canvas at document pixel size, with no viewport transform, no border and
no in-progress stroke. That canvas is what PNG export encodes, and rendering it
touches neither the document nor the display. `readCompositeImage()` is the same
composite read back as an `ImageData`, which is exactly what the bucket fill
scans: the fill's boundary is the picture the user sees, not one layer's
internal pixels.

### Layer blend modes

A layer's `blendMode` is compositing metadata, not part of its pixels. The
renderer maps `normal` / `multiply` / `screen` to the matching Canvas 2D
`globalCompositeOperation` in `compositeOperationFor` and applies it when the
finished layer surface is drawn over the paper and the layers below it. Because
the destination is the accumulated composite, `multiply` darkens against the
paper and lower layers and `screen` lightens against them; layer opacity still
scales the source first (`globalAlpha`), and the mode is reset to `source-over`
after the layer pass so the document border and the next frame's paper are
never blended.

This is deliberately a composite-stage property. Changing a mode does not
invalidate or re-rasterize any layer surface - only the final draw changes - so
it is one undoable document command and one render, not an edit to stroke data.
`paintDocument` is the single implementation shared by the display, the
document-size PNG export and `readCompositeImage` (the bucket's source), and
`readCompositePixel` (the colour picker) follows the same order, so all four
agree. There is no per-stroke blend mode, group/clipping blend context or alpha
inheritance yet.

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

### Soft edges (hardness)

`BrushSettings.hardness` is part of the brush, so every stroke carries the value
it was drawn with. `1` means the hard, antialiased edge described above; lower
values soften it. The feather radius is
`size * SOFT_EDGE_RADIUS_RATIO * (1 - hardness)` in document pixels, with
`SOFT_EDGE_RADIUS_RATIO = 0.1`, so "soft" is proportional to the brush and a
4 px pen and a 200 px brush fall off at the same visual rate. At `1` the radius
is exactly `0`, which is what keeps the hard path byte-identical to the old
renderer: `paintStrokeCoverage` draws the raw stroke buffer and never allocates
the scratch canvas.

A soft stroke is produced in **one pass after the silhouette exists**, not by
lowering per-segment alpha. Segments are still rasterized at full coverage into
the stroke buffer; when the coverage is drawn - live, on layer commit, during a
rebuild, or in an eraser's subtract - `paintStrokeCoverage` blurs a copy of the
whole buffer and submits that instead:

```
feather = scratch canvas the size of the stroke's padded bounding box
feather.ctx.filter = blur(radius * rasterScale)
feather.ctx.drawImage(strokeBuffer, bbox)
surface @ alpha = strokeOpacity(stroke)   // once, as before
surface.ctx.drawImage(feather, bbox)
```

The bounding box is the samples' extent padded by the full-pressure radius plus
three blur radii, clamped to the document; the pad is where a Gaussian has faded
out and it keeps the blur from clipping at the scratch canvas edges. The scratch
is allocated lazily, reused for every soft stroke, and sized to the stroke's
footprint rather than the document, so the pass costs the stroke's area instead
of a document-wide blur on every frame. Blur length and rectangle are scaled by
`rasterScale`, which is why the soft edge measures the same at raster scales 1
and 2.

Because this is a post-pass over the finished coverage, all the earlier
invariants survive:

- the interior is still full coverage, and opacity is applied exactly once, so a
  semi-transparent soft stroke does not darken where it crosses itself;
- live drawing, layer commit, undo/redo/test rebuild and PNG export all call the
  same `paintStrokeCoverage`, so they agree pixel for pixel;
- an eraser subtracts the feathered copy, keeping the snapshot-based
  "subtract once" rule;
- a filled shape's polygon is filled at full coverage before the outline, so its
  interior stays solid and only the outer silhouette softens.

The trade-off is deliberate: this is a Gaussian blur of the silhouette, not an
exact Photoshop-style hardness cone, so the falloff is smooth and extends a
little beyond the nominal diameter. The ratio is calibrated from measured
coverage - the core of even a 4 px stroke stays at full alpha - and a true
per-pixel hardness profile would require the deferred stamp/distance-field
engine, not this path.

### Grain texture

`BrushSettings.texture` is a **post-pass over the finished coverage**, in the
same place as the hardness feather. It is not a stamp engine and it does not
change the samples. `0` takes the existing raw-buffer path byte for byte; a
value above `0` makes `paintStrokeCoverage` copy the stroke (feathering it first
when hardness is below `1`) and fills that scratch copy with a repeating grain
pattern under `destination-in`:

```
grain = white 128x128 tile, alpha = 0.28..1 scaled by texture strength
grain.ctx.globalCompositeOperation = "destination-in"
grain.ctx.fillStyle = pattern(grainTile, repeat)
grain.ctx.fillRect(scratch)
```

`destination-in` multiplies the scratch's existing alpha by the tile's alpha, so
it cannot expand the silhouette, add colour, or darken where the stroke crosses
itself. A hard textured stroke still uses the scratch path with a zero-radius
copy, which leaves the raw stroke buffer as the input for the next extend.

The tile is generated once per strength from `textureCoverage(index, strength)`
- a fixed 32-bit hash, never `Math.random()` or time - and cached. The pattern's
transform maps document coordinates to scratch pixels, so the same document
point gets the same grain regardless of the stroke's bounding box, zoom,
`rasterScale`, or whether the pixels come from live drawing, a layer rebuild,
undo/redo, reopen or PNG export. The grain applies to brush, eraser and shapes
through the shared coverage path; a filled shape's interior grains along with
its outline. It is a visible surface texture, not per-dab spacing or a true
texture brush, and it still composites at the stroke opacity once.

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
  compositeStrokeBuffer(surface, stroke,
                        stroke.erase ? "destination-out" : "source-over")
```

`compositeStrokeBuffer` reads the stroke's own brush and pressures, so it also
picks the feathered copy for a soft brush. Because each stroke composites once,
in order, the rebuilt pixels match what live drawing produced - the same
guarantee the starter-dab rule enforces for painting. The cost of the snapshot is one extra surface-sized canvas while an
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
segments). Their samples carry pressure `1`, so a shape has
the brush's full, constant width.

A rectangle or an ellipse can also be **filled**, and that is still not a second
kind of content: the same stroke carries `fill: true`, and the rasterizer fills
the polygon its samples trace before tracing the outline on top. So a filled
shape is one solid silhouette, its edge lands exactly where an unfilled shape's
edge landed, and it re-rasterizes from the element list like everything else (see
[Rasterization](#rasterization)). A line is never filled - its outline bounds no
interior - which `ToolDefinition.fillable` states: the *tool* says whether
filling is meaningful, the engine says whether the user asked for it. The
setting (`shapeFill`) is editor state, offered in the toolbar only for a
fillable tool and read when a gesture starts, so a shape keeps the setting it was
drawn with and toggling it rewrites nothing.

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

### Bucket (flood) fill

A bucket fill is layer content that is **not a stroke**. Its boundary
is a set of pixels, so the document stores the pixels it committed rather than a
traced polygon: a `FillPatchRecord` with an opaque colour, a tight bounding box
and **one coverage byte per pixel in that box**. Strokes, fill patches and
gradients share one ordered `elements` list per layer, so a stroke drawn after a
fill paints above it and undo can restore painting order exactly. The project
format moved to version 4 for that list, version 5 added gradients, version 6
added per-stroke brush hardness, version 7 added texture and version 8 widened
the layer blend mode (see [PROJECT_FORMAT.md](PROJECT_FORMAT.md#fills)).

The gesture is a press, not a drag:

1. On pointer-down the engine rejects a point outside the paper, a document
   larger than `MAX_FILL_SCAN_PIXELS` (16,777,216 pixels) and a missing
   renderer. It then asks the renderer for the **merged visible composite** -
   paper plus every visible layer at its opacity - at document resolution and
   runs `core/fill/floodFill` from the floored document point.
2. The scan is **4-connected** and compares each pixel to the seed with the
   largest absolute difference across `R`, `G`, `B` and `A`, in 8-bit units,
   against the toolbar's tolerance (`0`-`255`; default `24`). Raising it admits
   anti-aliased boundary pixels; it never interpolates a colour. Two fully
   transparent pixels always match each other regardless of their hidden RGB
   bytes, because those bytes have no visible meaning.
3. The selected pixels are cropped to their bounding box and stored as a binary
   mask (`0` or `255`). A pixel either matches the tolerance and is filled or it
   does not - there is no feathered edge invented at commit time. That is what
   lets a save/reopen and an undo/redo reproduce the same bytes.
4. The patch is inserted on the **active layer** at the end of its element list,
   immediately, so the preview is the real result. Nothing has entered history
   and the revision has not moved yet.

On pointer-up `finishFill` bumps the revision and pushes one `FillCommand`
carrying the patch and its index. On `pointercancel`, lost pointer capture, a
tool switch or an abort, `cancelFill` removes the same patch and invalidates
the layer; no history entry or revision change is left behind. A click that
would change nothing - a tolerance-0 fill whose seed already has the brush
colour at full alpha - is dropped rather than recorded as an invisible undo
step.

Redo and reopen replay the **stored mask**; neither re-runs flood fill against a
composite that may have changed since. That is the reason the patch is the
command payload, not the seed and tolerance. Undo removes it and the renderer
rebuilds the layer from the remaining elements, exactly like a stroke. Layer
duplication deep-copies a patch with a new id, and deleting a layer carries its
patches through the same `ElementTransfer` as its strokes.

`rasterizeLayer` walks elements in order: a fill patch is expanded into a
temporary bounding-box canvas (colour + mask as alpha), then drawn through the
surface transform at its document position. Every path - live preview,
re-rasterization after undo, layer duplication, reopen and export - uses that
one function, so they cannot disagree.

Memory stays proportional to the job: a small fill stores only its own
bounding-box mask, never a full-canvas copy. The scan itself is bounded by the
document-pixel ceiling because it needs the RGBA composite, an `ImageData` copy,
a visited bitmap and the coverage mask; at the ceiling that is roughly 170 MB
transiently. A larger document is still editable - only a bucket press is
refused, with a status-bar notice rather than a freeze.

Tolerance lives in the editor snapshot (`setFillTolerance`) and describes the
next fill, like `shapeFill`; it is not serialized. A committed patch carries its
own pixels, so changing the slider never rewrites one.

### Gradients

A gradient is the opposite trade from a fill: its pixels are a function of
geometry, so the document stores **the function**, not the pixels. A
`GradientRecord` carries its type (`linear` or `radial`), two drag points, an
ordered stop list (`offset` plus hex colour) and one opacity. The record is
self-describing and immutable; re-rendering it is deterministic, so undo, redo,
save/reopen, layer duplication and export all rebuild the same content without a
snapshot. The file format moved to version 5 for the new element kind; version 6
then added per-stroke hardness without changing gradient records.

The gesture is a drag, and the live preview is real layer content:

1. On pointer-down `beginGradient` captures the current options - linear/radial,
   brush colour as stop `0`, toolbar end colour as stop `1`, brush opacity - and
   inserts a zero-length record at the end of the active layer's element list.
   Nothing enters history and the revision does not move.
2. Every move replaces that record (same id, same index) with a new endpoint.
   The engine invalidates the layer, so the renderer rebuilds it in painting
   order: content below the gradient stays below, content above stays above.
   The pointer endpoint is clamped to the document bounds.
3. On release, a drag shorter than `MIN_GRADIENT_LENGTH` is cancelled: it has no
   direction and would be an invisible undo step. Otherwise the record stays and
   `GradientCommand` is pushed, carrying the committed geometry and stops.

`pointercancel`, lost capture, a tool switch or an abort removes the preview
without history or a dirty revision. Undo removes the element and redo
re-inserts the *same record* at its original index; no blending is re-run. Layer
duplication clones the record with a new id and independent stop objects, and
deleting a layer carries gradients through the same `ElementTransfer` as strokes
and fills.

The renderer paints a gradient directly onto the layer surface instead of
allocating a document-sized patch. It creates a Canvas linear gradient from the
two points, or a radial gradient centred on the first point with the drag length
as its outer radius, adds the stops, sets `globalAlpha` to the element opacity and
fills the whole layer through the surface transform. The zero-length preview is
skipped. Gradients are therefore content, not an adjustment or a mask: an opaque
gradient covers earlier elements on its layer, which is why painting one on its
own layer is the normal workflow. The editor options (`setGradientType`,
`setGradientEndColor`) describe the next drag only and are not serialized.

### Selection and transform

A selection holds **whole strokes of one layer**, never part of a stroke and
never pixels. `core/document/strokeSelection.ts` is the entire hit-test rule and
is pure: the marquee is a rectangle in document space, and a stroke is selected
when its centreline meets that rectangle, inflated by half the stroke's painted
width (`strokeDiameter(brush, 1) / 2`) so a wide stroke whose pixels reach into
the marquee selects even when its samples stay outside. Segments are tested
**continuously** (Liang-Barsky), not just sample by sample: a sparse stroke that
crosses the marquee with both endpoints outside it is still selected. The test is
against the *active* layer's stroke-only view only, because a transform writes
stroke samples and a stroke belongs to exactly one layer. Fill patches and
gradients are content, not paths, and are filtered out of that view.

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
  screen are always exactly what the element list would produce; the store stays
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
  only the last press. It is the same rule the opacity slider follows. The merge
  key is scoped to one *selection instance* (a counter that moves whenever the
  selection is replaced), so nudging a stroke, deselecting and reselecting the
  same stroke lands as two undo steps - the user's undo steps follow the gestures
  they made, not the identity of the strokes.
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

A transform that would move nothing is **refused** rather than recorded: flipping
a single dab, or a stroke that is already symmetric about the axis, maps every
sample onto itself, and an undo step whose undo does nothing reads as a broken
undo button. The check runs on the stored originals before anything is written,
with a tolerance far below one painted pixel so that a reflection about a
half-pixel centre still counts as a no-op.

A transform is refused while a pointer gesture is in flight - a keyboard edit and
a drag would be writing the same sample arrays - and when nothing is selected.
`undo`/`redo` are held off for the same reason: reversing a command while a drag
is mid-flight would leave the drag applying its delta to strokes the undo just
changed. Undoing a duplicate or a delete can leave the selection pointing at
strokes that no longer exist, so every history change re-derives the overlay from
the store: a frame that outlives the strokes it describes would be a lie the user
can see. The id list is kept through that state on purpose, so redoing the
duplicate re-selects the copies it brings back.

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

A surface is marked dirty only when its pixels no longer match its element list:
undo/redo of a stroke or a fill, document *replacement* (new/open, where a
reused layer id can describe different pixels), document resize and
raster-scale change.

Layer metadata and stack order never invalidate anything. A new layer gets a
dirty surface the first time it is composited, a removed layer's surface is
dropped when the renderer is handed the shorter layer list, and reordering,
hiding, renaming or selecting a layer changes only the composite. That is why a
rename or a layer click costs nothing but a repaint, not a re-rasterization of
every element on every layer. `render()` re-rasterizes a layer only if it is
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
model: no stamps; hardness and grain are post-passes over the finished
silhouette (see [Soft edges (hardness)](#soft-edges-hardness) and
[Grain texture](#grain-texture)), not per-dab curves. Spacing changes how
densely the input path is sampled
(see [Sampling, spacing and the stabilizer](#sampling-spacing-and-the-stabilizer));
it is not stamp spacing and does not alter the rasterizer.

A stroke flagged `fill` (a filled rectangle or ellipse) additionally fills the
closed polygon its samples trace, once, before the outline is traced - and only
on a full re-rasterization (`fromIndex === 0`), which is the only way a shape is
ever drawn. Both passes are drawn at full coverage and the stroke's alpha is
applied once when the buffer composites, so filling and tracing cannot darken
each other. The default non-zero winding rule is enough: the outline is a single
simple loop.

## Undo / redo

Two kinds of step share one stack, so undo behaves uniformly whether the last
action was a stroke, a fill, a gradient or a layer change:

- **`StrokeCommand`** captures no pixels. Undo removes the stroke from the
  `StrokeStore` and asks the renderer to re-rasterize that layer from the
  elements that remain. Redo inserts it back **at its original index**, so the
  painting order inside the layer is identical to what the user drew.
- **`FillCommand`** carries the committed `FillPatchRecord` and its index. Undo
  removes the patch and refreshes the layer; redo re-inserts the **same** patch
  and never reruns the flood scan. The pixels are the command payload because
  the region was defined by composite pixels that may no longer be there.
- **`GradientCommand`** carries the committed `GradientRecord` and its index.
  Undo removes it and refreshes the layer; redo re-inserts the same geometry and
  stops, so the renderer rebuilds the identical gradient without capturing a
  pixel snapshot.
- **`DocumentCommand`** captures the two document states around a layer change
  (`before`/`after`). Documents are pure metadata, so keeping two of them costs
  two small objects. When the change creates or destroys layer content - layer
  duplication, or deletion, which must not lose the deleted layer's strokes,
  fills and gradients - the command also carries that element list and restores
  it on revert.
- **`MoveStrokesCommand` / `DeleteStrokesCommand`** edit existing strokes rather
  than adding or removing a layer's paint. A move keeps each stroke's pre-drag
  sample arrays and writes `original + offset` on apply and the originals on
  revert; a delete keeps each stroke together with its index and re-inserts it
  there on revert. Neither snapshots a bitmap, for the same reason as
  `StrokeCommand`: the element list is the record and pixels are a cache.

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

This is why no layer bitmap snapshots exist anywhere in the codebase: the
element list *is* the authoritative record, and layer pixels are a cache derived
from it. A fill patch records only the pixels that fill committed, and a
gradient records only its colour function; both sit in the same ordered list as
strokes, so undo and redo move them like any other element.

## Input pipeline

`CanvasInputBinder` attaches pointer/wheel listeners to the canvas element. It
is attached by the engine, not by React, so pointer movement never triggers a
React render. Behaviour:

- **Pointer capture** keeps a stroke alive when the pointer leaves the canvas;
  a lost capture cancels the stroke (or an uncommitted fill) explicitly rather
  than leaving it dangling.
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

### Sampling, spacing and the stabilizer

`StrokeBuilder` turns pointer samples into the `StrokeRecord` that is stored,
rendered and saved. Two sampling-time settings shape that record; both are
captured in the stroke's own brush, so changing a slider later never rewrites
existing work, and neither creates a history entry or dirties the document.

- **Spacing** is a fraction of the brush diameter (`0.02..2`, default `0.12`,
  shown as 2-200 %). The builder interpolates a long move with a step of
  `max(0.75 px, spacing * size)`, capped at 96 points per input event and skipped
  for jumps beyond `MAX_INTERPOLATION_DISTANCE`. It therefore controls sample
  density and pressure-ramp smoothness, not brush width; the renderer still
  draws segments between samples.
- **Stabilizer** (`0..1`, default `0`, shown as 0-100 %) applies an exponential
  follow to incoming x, y and pressure: `follow = 1 - 0.75 * strength`. The
  first sample is exact; each later captured point moves that fraction of the
  way from the previous captured point to the raw pointer. At `0` the follow
  factor is exactly `1`, preserving the raw path byte for byte.
- **The release point is part of the path.** Smoothing lags the pointer while it
  moves, so `finish()` appends the last raw point when it differs from the
  captured tail. The engine feeds that final point to the renderer before
  `endStroke`, which means the settled segment is previewed, committed and later
  replayed like any other sample. There is no hidden post-process and no lost
  start or end.
- **Brush and eraser only.** Shapes derive their geometry from the drag corners,
  not the freehand path, so the stabilizer is deliberately not applied to them.
- **Additive in the file.** Stabilizer changes only the samples captured at draw
  time; a reader that ignores the field still replays those samples and produces
  the same picture. It was therefore added within format version 6, and a
  missing field reads as `0` (see
  [PROJECT_FORMAT.md](PROJECT_FORMAT.md#versioning)).

The trade-off is honest: at high strength the line visibly trails the pointer
and closes with one settle segment on release. There is no look-ahead, rope
physics or time-based catch-up, and the stored smoothed samples mean undo,
reopen and export replay exactly the previewed path.

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
readCompositePixel / readCompositeImage
render / requestRender / destroy
```

Layer content is read through the separate `StrokeSource` interface
(`listElements` for painting and persistence, `listStrokes` for stroke-only
features), so a new backend never needs access to the element store itself. To
add a WebGL or WebGPU renderer:

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
  normalization, the command stack, the stroke, fill and gradient commands, the
  document command and the ordered element store are tested directly. `floodFill`
  is a pure module tested against synthetic pixel buffers: enclosed regions,
  tolerance levels, boundaries, transparency, 4-connectivity and the oversized
  guard.
- `DrawingEngine` is tested with a `null` renderer, covering stroke commit,
  cancel, undo/redo granularity, layer operations, and new-document reset. A
  separate suite injects a recording renderer to pin down surface-invalidation
  policy (layer metadata never re-rasterizes; a stroke undo does). It also
  asserts that no React-facing state is published while drawing.
- Bucket behaviour is covered on the engine through the same pointer entry point:
  press previews one patch without history, release records exactly one fill
  step, undo restores the previous pixels and redo replays the same patch,
  separation/tolerance and merged-layer sampling define the region, a transparent
  seed is handled, cancel and a mid-gesture tool switch remove the preview with
  no revision or dirty flag, a tolerance-0 no-op records nothing, an oversized
  document refuses the scan with a notice, and duplication/deletion carry fills
  through their element transfers. Gradient behaviour is covered the same way:
  press inserts one record, moves replace it at the same index without history,
  release commits one step, the radial/colour/opacity options are captured at
  press, zero-length drags and out-of-bounds presses record nothing, cancel and a
  tool switch remove the preview, coordinates clamp to the document, and
  undo/redo replay the identical record. Layer blend mode changes are asserted
  as one undoable, dirtying step, and the compositor test checks the operation
  mapping, the reset between layers and the shared export path. The format
  suite asserts a version-8 round trip of interleaved strokes, fills and
  gradients with every blend mode, version-1 to -7 compatibility, and rejection
  of bad boxes, masks, stops, geometry, opacity, unknown blend modes, gradients
  in a version-4 file, missing or out-of-range hardness in version 6, missing or
  out-of-range texture in version 7, future versions, and the fill pixel
  ceiling.
- Tool geometry is tested directly: `shapeGeometry` covers 45-degree snapping,
  squares and circles, drawing from the centre, the ellipse's bounded and
  exactly-closed outline, and the degenerate extent. Shape *behaviour* is
  covered through the recording renderer on the engine: a drag previews with a
  full-buffer redraw and commits nothing, the release commits exactly one stroke
  carrying the outline's samples, and cancellation, a mid-drag tool switch, an
  out-of-bounds start and a click that never moved all leave the document and
  the history untouched. The fill setting is covered the same way: a shape is
  flagged only while the setting is on, each shape keeps the setting it was
  drawn with, a line is never filled even with the setting on, and the setting
  survives a tool switch without becoming an edit. `replaceStroke` is asserted on
  the draw-call stream: it
  clears the buffer and redraws the whole outline, and the preview composites at
  the stroke's own alpha.
- `canvas2dStroke` is tested directly: diameter/opacity curves, feather radius
  (`0` at hardness 1, proportional for soft strokes), and - through the
  recording context - that rasterization is always **full coverage** (which is
  what stops semi-transparent overlap from darkening), that width still follows
  pressure per segment, that `fromIndex` redraws only the new part, and how a
  `fill` stroke draws: the closed polygon is filled once with the brush colour
  *before* the outline is traced, an outline that bounds no area is not filled,
  and a partial redraw never fills. Soft strokes are asserted to use the same
  full-coverage call shape - the feather is a single later pass, not per-segment
  alpha.
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
  exact undo and redo, a re-made selection starting a new run, duplicate
  inserting above its source and selecting the
  copies (so a following nudge moves only the copy), redo re-inserting the same
  clones, flips about the selection's centre with exact undo and the
  two-flips-are-the-identity property, a flip that would change nothing being
  refused instead of recorded, undo and redo refusing to run mid-drag, and every
  transform refusing to run with
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
  display never paints the eraser buffer. The fill suite asserts that patches are
  rasterized in element order between strokes (colour and mask expanded into a
  bounding-box `ImageData`), and that `readCompositeImage` returns the document
  composite at document resolution. The gradient suite asserts the Canvas
  linear/radial gradients, geometry, stops and element alpha, their position in
  the painting order, and that zero-length or transparent gradients draw nothing.
  Real pixel coverage is out of scope for the unit suite.

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
matches the one rebuilt from the element list after undo/redo exactly. The eraser
is verified the same way, by sampling the PNG produced by the app's own export
path: a full-opacity pass across a stroke reads back as pure paper (`255,255,255`)
with no halo, a half-opacity pass reads back as exactly the 50% blend
(`139,140,142` for `#16181c` over white), a stroke that retraces itself within one
stroke removes exactly as much as a single pass, undo restores the covered pixels
bit-for-bit and redo re-applies them, and a save/reopen round trip reproduces
every sampled pixel. The bucket fill is verified on the live display canvas:
selecting `F` shows the Tolerance control, a click on blank paper inks the paper
with the brush colour and raises the history by one, undo returns the sampled
pixel to white and redo restores the fill, and a `pointercancel` press leaves the
paper white with history still zero. Gradients were verified in the browser app at
the state level: selecting `G` shows the **Radial** switch and **To** colour,
changing both updates the controls, a synthetic linear drag raises the history by
one and marks the document unsaved, `Ctrl+Z` returns it to zero and
`Ctrl+Shift+Z` restores one step, and a press followed by `pointercancel` at
history zero leaves it at zero. The harness tab suspends animation frames, so the
live display canvas did not repaint; the actual **pixels** were verified by
rendering real documents through `Canvas2DRenderer` with the browser's Canvas 2D:
a black-to-white linear gradient sampled `14`, `128` and `243` across the axis,
and a red-to-blue radial gradient sampled red at its centre (`251,0,3`) and blue
at its outer edge (`28,0,227`/`23,0,232`). That covers the renderer path, while
the gesture path is covered by the state checks and the engine suite. The same
harness confirms the format guard
in the running app: a file from a newer version is refused with a message and the
open drawing is left untouched, while a version-1 file opens with its strokes
painted (a version-1 file has no erasures to lose). What has and has not been
verified is reported separately rather than being implied by the test count. The
format's own round trips are asserted in Vitest: the `erase` and `fill` flags
survive a save/reopen, an unset flag is absent from the file, version 8 preserves
an interleaved stroke/fill/gradient order with its mask bytes, geometry,
per-stroke hardness, texture and layer blend mode, a version-7 file opens with
normal blend mode, a version-6 file opens with no texture, a version-5 file opens
with hard strokes, a version-4 file still opens with fills and strokes, and a
version-1, -2 or -3 file opens with its shapes traced rather than filled.

## Known limitations

These are real gaps, not footnotes:

- **Tools**: only `brush`, `eraser`, `select`, `line`, `rectangle`, `ellipse`,
  `bucket`, `gradient` and `picker`, plus `pan`. There is no text tool. A bucket
  fill writes a region; a gradient is a two-stop linear/radial colour function,
  not an editable gradient with draggable stops.
- **Selection is stroke-level, layer-scoped and limited to translation,
  duplication and reflection.** A marquee
  selects whole strokes (never part of one, so a selection cannot split a stroke
  or mask a brush stroke), only on the active layer, and it is dropped when the
  layer or the tool changes. **Fill patches and gradients are not selectable** -
  the stroke-only view deliberately filters them out - so they can only be
  undone, not moved, duplicated or flipped. There is no add/subtract modifier, no
  feathering,
  no clipping, and no scale, rotate or perspective; duplicate stays on the layer
  (there is no cross-layer copy/paste). The frame is the selected strokes'
  bounding box, not the region that was dragged.
- **A live selection move re-rasterizes the whole layer per pointer move.** The
  element list stays authoritative and the pixels are rebuilt from it, which is
  why the drag can never drift from the committed result; caching the moved
  strokes is the optimisation to reach for if a heavy layer makes dragging lag.
- **Shapes are stroke outlines, not vectors.** A committed shape is stored as
  ordinary stroke samples and cannot be recognised or edited as a rectangle
  afterwards; a filled shape is the same samples plus a `fill` flag, so there is
  no separate fill rule, no inner fill, no gradient *inside a shape* and no way
  to turn a fill off after the fact short of undoing it. Shapes take the brush's
  round joins, and a
  filled ellipse's interior is as faceted as its outline (sub-pixel, but not a
  true curve). Shapes are
  also pressure-blind by construction: their samples carry pressure `1`, so a
  `Shift` drag gives a constant-width outline rather than a tapered one.
- **The colour picker samples the composite only.** It always reads paper plus
  visible layers; there is no per-layer sampling, no `Alt`-click temporary
  picker from the brush, no magnifier preview and no colour history or swatches
  from picks. Precision is the surfaces' - 8-bit sRGB - so sampling a
  semi-transparent area yields the blended screen colour by design.
- **A bucket fill is a committed raster patch, not an editable region.** Its
  boundary is the binary set of pixels the scan selected, so there is no
  feathering, no "fill within selection", no gap-closing and no way to change
  its tolerance after the fact - changing the slider only affects the next fill.
  A press scans at click time and does not preview the region before committing.
  The scan samples the merged visible composite (including the paper), and
  documents above 16,777,216 pixels refuse a fill with a notice rather than
  risking a long freeze.
- **A gradient is a two-stop whole-layer colour function.** There is no stop
  editor, no angle or aspect modifier, no transparency stop and no clipping to a
  selection or shape; opacity applies to the entire element. It is content, not
  an adjustment layer, so it covers earlier elements on its layer. A drag
  re-rasterizes the whole layer on every pointer move, the same trade as moving a
  selection; that is the thing to cache first if a heavy layer makes the preview
  lag.
- **An eraser stroke costs one extra surface-sized canvas** while it is in
  flight (its pre-stroke snapshot). It is allocated lazily and released when the
  stroke ends, but on a very large document it is a visible memory spike next to
  the stroke buffer. Erasing inside a GPU backend becomes a blend mode, and the
  snapshot disappears.
- **Layer selection is not undoable.** Every layer *edit* is - add, duplicate,
  delete, rename, reorder, visibility and opacity - but selecting a layer
  changes no pixels and is deliberately not a history step.
- **Blend modes**: only `normal`, `multiply` and `screen`. They are compositing
  operations over the finished layer, so they combine with the paper and every
  lower layer; there are no group, clipping or alpha-inheritance contexts and
  the remaining Canvas blend modes are not exposed.
- **Opacity is per stroke, not per dab.** A stroke gets one alpha, derived from
  the brush opacity and the stroke's mean pressure. Pressure can taper width
  within a stroke but not opacity: per-dab opacity without build-up needs
  per-pixel max blending, which Canvas 2D does not expose.
- **Hardness is a blur of the finished silhouette, not a stamp profile.** The
  soft edge is a single Gaussian feather, so it extends slightly beyond the
  nominal diameter and cannot express a multi-zone falloff. A very large soft
  stroke pays one extra pass over its padded bounding box per repaint; the
  scratch canvas is reused but grows to that footprint. Spacing and the
  stabilizer are sampling-time controls, not raster features; texture is a
  single post-pass grain, not a stamp engine, so per-dab spacing, true hardness
  curves and directional/stamp textures are still absent.
- **Rasterization is per-segment and CPU-side.** Long strokes mean many
  `stroke()` calls. It is fine at the sizes tested and is the first thing to
  move behind the renderer abstraction when it is not.
- **HiDPI cost**: raising `rasterScale` re-rasterizes every layer.
- **Undo history is not persisted.** A project file stores the document and its
  elements, not the history: reopening a drawing rebuilds one step per element
  (stroke, fill patch or gradient), so the work stays editable, but there is no
  redo of edits made before the save. See [PROJECT_FORMAT.md](PROJECT_FORMAT.md).
- **No tests for the React layer.** Hooks, components and the input binder are
  exercised manually in the browser, not by automated tests.
