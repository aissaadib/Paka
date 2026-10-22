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
region. The document envelope also carries the **composition guides**, which
are display-only metadata. The format, its validation rules and its versioning
policy are documented in [`PROJECT_FORMAT.md`](./PROJECT_FORMAT.md).

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
| `src/core/document` | Document and layer metadata, ordered element store, the selection hit-test, the transform geometry and the transform handles | types, utils |
| `src/core/brushes` | Brush defaults, stroke sample processing (`StrokeBuilder`) | core/document types |
| `src/core/fill` | Pure flood-fill scan and fill-patch creation/cloning | core/document types |
| `src/core/gradient` | Gradient records, endpoint movement and cloning | core/document types |
| `src/core/tools` | Tool registry and per-tool behaviour (brush, eraser, shapes, bucket, gradient, picker, guides, pan) | core/document, types |
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
8. **A preview group scratch** - a layer-sized canvas used only while a layer
   has a non-default opacity or blend mode. It combines that layer's surface
   with the in-progress stroke so the preview composites exactly like the
   commit will (see
   [Live preview compositing](#live-preview-compositing)). It is allocated
   lazily, reused across frames and dropped when the renderer is destroyed.

A frame (`render()`) does, in order:

1. reset the transform and clear the display,
2. set the document transform (`scale = zoom * dpr`, `translate = offset * dpr`),
3. fill the paper with the document background,
4. composite each **visible** layer with `opacity > 0`, bottom-first, applying
   the layer's blend mode and alpha. The in-progress stroke, when it belongs to
   that layer, is composited in the **same slot** - after the layer's committed
   content and before any layer above it - so the preview keeps the stacking the
   release will produce. A hard stroke draws the raw buffer; a soft stroke
   draws its feathered copy through the same path that commits it to the layer
   (see [Live preview compositing](#live-preview-compositing)),
5. an erasing stroke is not drawn at all: the erasure was already subtracted
   from the layer surface that step 4 composites, so drawing the buffer would
   paint the erased coverage back,
6. stroke a hairline document border whose width is `1 / scale`, so it is
   exactly one device pixel at any zoom.

`composeDocumentImage()` reuses steps 3-4 - paper plus visible layers - into a
**new** canvas at document pixel size, with no viewport transform, no border and
no in-progress stroke. That canvas is what PNG export encodes, and rendering it
touches neither the document nor the display. `readCompositeImage()` is the same
composite read back as an `ImageData`, which is exactly what the bucket fill
scans: the fill's boundary is the picture the user sees, not one layer's
internal pixels.

Rasterizing a layer is a rebuild, not an incremental edit: for every element on
that layer the renderer rasterizes it into the shared stroke buffer and blends it
onto the layer surface, one element at a time, in painting order. Since `4ac040b`
that work is bounded by the element's own footprint instead of by the document:
the buffer is cleared and blended only over the rectangle the element can ink -
the padded bounding box of its samples, which is the brush radius, the blur
spread of a soft edge and one pixel of margin - while the layer's own single full
clear is unchanged, because a rebuild still starts from an empty surface. The
surface and the stroke buffer share the same device pixel grid, so that rectangle
is blitted one to one under the identity transform and nothing is resampled, and
the pixels are the same ones the old full-surface blend produced. The cost of a
rebuild therefore follows the strokes' geometry instead of the document size: a
measured 47x-187x less touched area per rebuild for strokes that ink a small part
of the document, and about 1.1x for strokes that cover the whole document. The
display and the eraser still draw the whole buffer, because the viewport clips
that for us and the eraser subtracts from the layer it mutates. The measured
breakdown - including the environmental limits of those measurements, the
remaining per-draw cost charged for the document-sized surface, and the recipe
for profiling it in the packaged app - is in
[PERFORMANCE_AUDIT_2026-10-20.md](PERFORMANCE_AUDIT_2026-10-20.md).

### Layer blend modes

A layer's `blendMode` is compositing metadata, not part of its pixels. The
renderer maps each mode to the Canvas 2D `globalCompositeOperation` of the same
name in `compositeOperationFor` and applies it when the finished layer surface
is drawn over the paper and the layers below it. The menu offers `normal`
(`source-over`) plus the separable modes `multiply`, `screen`, `overlay`,
`soft-light`, `hard-light`, `color-dodge`, `darken`, `lighten`, `difference` and
`exclusion`. Because the destination is the accumulated composite, `multiply`
and `darken` darken against the paper and lower layers while `screen` and
`lighten` lighten against them; layer opacity still scales the source first
(`globalAlpha`), and the mode is reset to `source-over` after the layer pass so
the document border and the next frame's paper are never blended.

The exact formulas are written down as pure functions in
`core/document/blendModes.ts`; they are the test oracle for the canvas
operations, while the browser keeps the fast native path. Every mode is
separable (per-channel), which is what Canvas 2D exposes without a shader, so
hue/saturation/color/luminosity are deliberately absent.

This is deliberately a composite-stage property. Changing a mode does not
invalidate or re-rasterize any layer surface - only the final draw changes - so
it is one undoable document command and one render, not an edit to stroke data.
`paintDocument` is the single implementation shared by the display, the
document-size PNG export and `readCompositeImage` (the bucket's source), and
`readCompositePixel` (the colour picker) follows the same order, so all four
agree. There is no per-stroke blend mode, group/clipping blend context or alpha
inheritance yet.

### Live preview compositing

An in-progress stroke is **part of its layer**, not a decoration drawn on top of
the picture. The renderer therefore hands the live stroke to the same
`paintDocument` loop that composites the committed layers, and the stroke is
drawn in its own layer's slot: after that layer's committed surface and before
any layer above it. Releasing the stroke does not change the stacking, and the
picture the user watched is the picture the layer ends up holding. A layer that
is hidden (`visible === false`) or fully transparent (`opacity === 0`) is
skipped entirely, which hides its preview with it.

A layer's opacity and blend mode apply to the **finished** layer, so a preview
cannot simply be painted over the layer - a half-opacity layer would apply its
alpha twice, and any non-normal blend mode would blend the stroke with the
backdrop instead of with the layer beneath it. Two paths cover that:

- **Fast path** - an opaque `normal` layer: the surface is drawn, then the
  stroke buffer is drawn with `source-over` at the stroke's own opacity.
  `source-over` is associative, so the result is identical to grouping the two
  first and no extra canvas is needed. This is the common case.
- **Grouped path** - a layer with `opacity < 1` or a non-`normal` blend mode:
  the layer surface and the stroke buffer are combined in a reused layer-sized
  scratch canvas, exactly as a commit combines them, and the group is drawn once
  with the layer's alpha and composite operation.

The group scratch only ever *reads* the committed surface, so a preview never
mutates layer pixels or the document. `composeDocumentImage` (PNG export) and
`readCompositeImage` (bucket sampling) pass no preview, so an in-flight stroke
never leaks into an export or into a fill boundary. The eraser is unchanged:
it subtracts from its own layer surface, so it has no separate preview to
draw.

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

### Stamp engine (dabs)

`BrushSettings.stamp` switches the rasterization strategy for a stroke: with it
off, the stroke is the legacy round-capped segment path, byte for byte; with it
on, the stroke is a **union of round dabs** placed along the stored polyline.

The dabs are placed by **arc length**, not per sample: the first dab sits on the
first sample and the rest every `stampSpacing * size` document pixels along the
path, with the remainder of a segment carried into the next one. Two consequences
matter:

- The plan does not depend on the **sample density**, so the existing `spacing`
  field stays non-appearance-changing: the same path captured at two densities
  produces the same dabs (there is a test for it).
- The plan is a **pure function of the samples and the brush** - no randomness,
  no clock, no zoom, no `rasterScale` - so live drawing, the commit, a layer
  rebuild, undo/redo, a reopened file and a PNG export all produce the same
  dabs. `src/core/rendering/stampCoverage.ts` is the only place that decides
  where a dab goes, so the live path and the rebuild path cannot disagree.

The dabs' coverage is combined with a **per-pixel maximum**, never a sum.
Canvas 2D has no max-alpha composite operation - its `lighten` blend mode
compares colours, not alpha - so the union is computed in plain numbers in a
coverage map and uploaded to the stroke buffer as pixels:

```
coverage map   = 1 byte per device pixel, in 64x64 tiles, allocated on demand
dab profile    = 1 inside the dab's core, a smooth falloff to 0 at its radius
union          = max(existing coverage, the dab's coverage)
upload         = one ImageData per tile (16 KB), putImageData into the stroke buffer
```

A self-crossing or overlapping stamped stroke therefore cannot darken, and the
stroke's opacity is still applied **once**, when the buffer composites - the same
invariant the segment path keeps. The stroke-level hardness feather and the grain
post-pass still run over the finished coverage, so a soft or grainy brush stays
soft or grainy when the stamp is on.

The coverage map is bounded by the **stroke's own footprint**, like the feather
scratch, so the stamp engine adds no document-sized surface and the raster
budget's 58 bytes per document pixel still holds (see *Document size and surface
memory*). The upload is per tile, so the buffer it needs is 16 KB whatever the
stroke's size.

Two guards keep the cost and the memory bounded, and both are deterministic, so
the live path and the rebuild path cut at the same place:

- a **spacing floor** of 0.5 document pixels, so a 1 px brush cannot ask for
  thousands of dabs per pixel;
- a **per-stroke work budget** (`MAX_STAMP_COVERAGE_WORK`): the planner stops
  placing dabs once the dabs' bounding boxes add up to the budget. The cut is a
  lattice index, so the same first K dabs are produced whether the path holds
  ten samples or ten thousand. A project file's path length is not bounded by the
  parser, so this is what stops a hostile file from exhausting memory; an
  extreme stroke is cut short, which is a rendering limit rather than a hang.

The stamp applies to **brush and eraser** strokes. Shape tools keep the segment
path - a shape is an outline, and a filled shape is a flat polygon - and a
shape's stroke record stores the stamp fields as they were not used, so the file
says what was actually drawn.

### The per-dab directional texture

`BrushSettings.stampTexture` adds a texture **inside** each dab, so a stamped
stroke reads as a bundle of bristle lanes rather than a line of dots. `0` is the
plain round dab, byte for byte as before the field existed; above `0` the
lanes take ink out of the dabs.

The lanes run **along** the path. A dab knows the direction of the path at its
own position (`StampDab.angle`), so the texture is laid out in the dab's own
frame: the perpendicular offset from the brush's centre line picks the lane, and
the lane's own width and offset come from a fixed 32-bit hash of the lane index.
A horizontal stroke leaves horizontal streaks, a diagonal one leaves diagonal
streaks, and the picture rotates with the stroke.

Two properties follow from the layout, and both are what make the feature
work inside the existing engine:

- **The lanes are measured against the brush's nominal size**, so they are
  anchored to the document: at `rasterScale` 2 they are twice as wide in device
  pixels and the same distance apart in document pixels.
- **The offset is taken from the brush's centre line, not from the side of it.**
  Every dab on a straight path therefore sees the *same* offset at the same
  pixel, so the lanes are consistent across overlapping dabs and the
  per-pixel maximum union preserves them instead of filling them in. That is
  also why the picture does not change when a stroke is drawn backwards: the
  lanes belong to the path, not to the direction of travel.

The texture multiplies a dab's coverage **before** the union, so it can only
ever remove ink. The union is still a maximum, a self-crossing stamped stroke
still cannot darken, and the stroke's opacity is still applied once.

Two honest limits:

- The **first dab** of a stroke carries the angle `0`, because the path has
  not continued yet and a dab's direction must not depend on samples that
  arrive later. Its lanes are therefore laid out along the document's x axis
  rather than along the stroke. The neighbouring dabs overlap it, so the
  effect is small, but it is there.
- On a **tight curve** the lanes splay slightly, because each dab measures the
  offset from its own centre. On a gentle curve the effect is below a pixel.

The texture costs no extra allocation: it reuses the dab's own pixel loop and
the coverage map's existing tiles, so the raster budget's 58 bytes per
document pixel still holds.

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

### The colour wheel

The **Colour** panel holds an HSV wheel: a disc where the angle of the pointer
is the hue and its distance from the centre is the saturation, a value
(brightness) slider, and three sliders that name the same three numbers. It is
a *view* of the brush colour, not a second source of truth:

- The brush still stores an `#rrggbb` string, and the wheel writes through the
  same `setBrush` path the toolbar's colour input, the swatches and the canvas
  picker use. So a colour picked off the canvas moves the wheel, and a colour
  chosen on the wheel is the colour the next stroke is painted with.
- The conversion is exact. `rgbToHsv` and `hsvToRgb` are inverses over the
  whole 8-bit sRGB cube, so a colour that came from the app comes back as the
  same three bytes (verified over all 16,777,216 of them, by the sweep in
  `src/test/color.test.ts`), and the hue a grey has - none - is reported as hue
  `0` with saturation `0`.
- The disc's geometry is fixed in `src/features/color/wheelGeometry.ts` and
  shared with the CSS: hue `0` is at 3 o'clock, the hue grows clockwise (the
  CSS `conic-gradient` is rotated `from 90deg` to match), the centre is
  saturation `0` and the rim is saturation `1`. A drag that leaves the disc
  keeps tracking the pointer's angle and clamps the saturation at the rim.
  The CSS keeps the same contract: the white overlay is a `closest-side`
  radial gradient, so it reaches zero exactly at the disc's radius - the
  radius at which the saturation is `1` - and the colour the disc draws at a
  point is the colour a click at that point produces. (The outermost
  one-pixel ring of the disc is the decorative inset, not the hue.)

One subtlety is worth stating, because it is the difference between a control
that feels right and one that fights the user: the stored colour is 8-bit
sRGB, and on a dark or desaturated colour that grid is coarse. The default
brush colour `#16181c` has six levels of red, so a hue of 205° is stored as a
colour whose own hue is 220°. The wheel therefore keeps the hue and
saturation the user *asked for* while the brush holds the colour the wheel
wrote, and falls back to the stored colour as soon as the colour is changed
from anywhere else. Without that, dragging the hue slider on a dark colour
would snap the slider back to a nearby hue on every step.

"Changed from anywhere else" is decided by `src/features/color/wheelState.ts`,
not by comparing colours. A colour changed elsewhere and then changed back to
the wheel's last colour is indistinguishable from the wheel's own write, so
the wheel's state remembers the colour it was last reconciled against, and
any change of the brush colour that the wheel did not write drops the request
- once and for good, so a stale hue cannot come back.

### Preferences that survive a restart

The editor's preferences - the brush, the tool, the shape options, the fill
tolerance and the gradient settings - are **session state that happens to
survive a restart**. They live in a per-user settings file in the operating
system's configuration directory, and they are restored at startup.

The file is **not a project file**. It holds preferences only: no drawing, no
document, no history. That is what keeps the two apart:

- restoring a preference goes through the engine's **editor-state** setters,
  so it costs no history entry, no revision bump and no dirty flag - the same
  contract the brush settings have always had;
- a project file is the user's work and is written only when the user asks;
  the settings file is the app's own and is written when a preference
  changes.

**The path belongs to Rust.** Two native commands, `read_app_settings` and
`write_app_settings`, own the configuration directory and the file name; the
WebView asks for the settings and hands them back, and never learns where
they live. The alternative - passing a frontend-chosen path to the generic
project writer - would have widened the WebView's write scope from one file
to any `.json` the user can name. The write reuses the project's own atomic
replace, so a crash or a full disk cannot leave a half-written settings file.

**Every field is validated on the way in**, because the file is on disk and a
user can put anything in it: a missing field takes its default, an
out-of-range value is clamped rather than rejected, a malformed value takes
its default, and a file written by a newer version is ignored wholesale -
its meaning is unknown rather than wrong. A corrupt settings file therefore
cannot stop the editor from starting.

The store (`src/core/settings/`) is framework-free: it reads the file, applies
it, watches the editor's snapshot for changes, and writes the file back
debounced, so a brush-slider drag is one write rather than sixty. A file that
cannot be read or written is recorded and forgotten - it is a minor
inconvenience, not something the user has to act on.

### The autosave seam (not enabled)

`src/core/autosave/` holds the machinery for writing a recovery copy of the
drawing, and **nothing starts it**. The decisions that govern autosaving -
whether it runs, at what interval, how a never-saved document is protected,
whether recovery is automatic, prompted or manual, when a copy is deleted and
how a conflict is presented - are the owner's, so the policy is *injected*
rather than chosen: `enabled`, `intervalMs` and `recoveryPathFor`.

What the code guarantees, and what its tests pin:

- **an autosave never marks the document saved.** The service calls no engine
  mutator, so the dirty flag, the close guard and the title dot keep saying
  "unsaved" whatever it does;
- **an autosave never writes the user's path.** The copy goes to the path the
  policy derives, and the service refuses to write at all when that path is
  the project's own;
- **one write at a time**, and a copy written while the user saved is
  reported as *superseded* rather than passed off as current.

A recovery copy is a **project file** - the same format, the same parser - so
it needs no new format, and it is written with the same `engine.serialize()`
a save uses. It is named `<stem>.autosave.paka` beside the project: the
marker cannot go at the end, because the native writer only accepts `.paka`
and `.json` and the extension is the last part of the name.

Like the rest of the brush, the wheel is session state for the next gesture:
choosing a colour is not an edit, adds no history step and never marks the
document dirty. The three sliders are native range inputs, so the wheel is
fully operable from the keyboard, and the disc is a pointer affordance on top
of them.

### Colour metrics

Under the wheel the **Colour** panel carries a readout with two numbers about
the brush colour: the contrast ratio between the ink and the document's
paper, and the palette swatch that is perceptually closest to the ink. They
are two numbers because they answer two different questions.

- **Contrast ratio** - WCAG 2.2's relative luminance and its contrast ratio,
  `(L_lighter + 0.05) / (L_darker + 0.05)`, over the sRGB transfer function
  linearised with the standard's 0.04045 breakpoint. It is a *lightness*
  comparison and says nothing about hue: a dark blue against a dark red is
  1.44:1 while the two are far apart to the eye. The bands are WCAG 2.2's
  own thresholds (7:1, 4.5:1, 3:1), taken from the unrounded ratio, and they
  are named as contrast - never as visibility, which a luminance comparison
  cannot promise.
- **Colour difference** - CIEDE2000 (CIE 142-2001 / ISO 11664-6) over CIELAB
  (D65). It is the standard for *small* colour differences and the only CIE
  formula that stays meaningful in the blue region and at low chroma, where
  the plain Lab distance over-reports. The implementation reproduces all 34
  published verification pairs of Sharma, Wu & Dalal (2005) to 1e-4
  (`src/test/colorMetrics.test.ts`).

Both live in `src/utils/colorMetrics.ts`, which is **DOM-free** and total: it
reads no canvas, no clock and no randomness, it never throws, and every
function returns a usable result for any input. The metric functions fold a
broken channel into the sRGB cube rather than poisoning the result with a
`NaN`, and the formatters render a value that is not a number as *unknown*,
so no `NaN` can reach the readout.

Three rules keep the readout honest:

- **It is a read, not an edit.** The readout computes from the brush colour
  and the document's paper and writes nothing: no control, no document state,
  no history entry, no dirty flag, and no change to the project format. The
  ink it measures is the brush colour, so it follows a colour chosen on the
  wheel, in the toolbar's colour input, in a swatch or picked off the canvas.
- **A colour that is not a hex colour is not measured.** A project file may
  hold any non-empty string as a colour, so the module parses with
  `hexToRgb` and reports *unknown* together with the reason. It never
  guesses and never throws; the palette itself lives in
  `src/features/color/palette.ts` and is passed in, so the metric module
  knows nothing about the app's colours.
- **The numbers are text.** The ratio, the band and the swatch are words and
  digits, never a coloured chip that has to be interpreted; the ratio also
  carries a spoken form ("17.8 to 1") because "17.8:1" would be announced as
  "seventeen point eight colon one".

### Shape tools

A line, rectangle, ellipse, polygon or star is a **stroke whose samples trace
the shape's outline** rather than a path the pointer traced. That is the whole
trick: a committed shape is an ordinary `StrokeRecord` (`ShapeTool` →
`shapeOutline` → stroke buffer → `StrokeCommand`), so it inherits one-undo-step
semantics, the project file, re-rasterization after undo or reopen, and layer
compositing - without a line of shape-specific rendering. The cost is honest and
visible: shapes are brush strokes, so they are **outlines drawn with round
joins** (a rectangle's corners are slightly rounded, an ellipse is a polygon of
many short segments). Their samples carry pressure `1`, so a shape has
the brush's full, constant width.

A rectangle, an ellipse, a polygon or a star can also be **filled**, and that is
still not a second kind of content: the same stroke carries `fill: true`, and the
rasterizer fills the polygon its samples trace before tracing the outline on top.
So a filled shape is one solid silhouette, its edge lands exactly where an
unfilled shape's edge landed, and it re-rasterizes from the element list like
everything else (see [Rasterization](#rasterization)). A line is never filled -
its outline bounds no interior - which `ToolDefinition.fillable` states: the
*tool* says whether filling is meaningful, the engine says whether the user asked
for it. The setting (`shapeFill`) is editor state, offered in the toolbar only
for a fillable tool and read when a gesture starts, so a shape keeps the setting
it was drawn with and toggling it rewrites nothing.

The gesture is a drag from an anchor to the current point.
`core/tools/shapeGeometry.ts` is pure - it turns
`{ anchor, current, shift, alt }` into document-space points and touches neither
the engine nor the renderer: a two-point line, a five-point closed rectangle, an
ellipse sampled on a multiple of four segments so it touches its bounding box
exactly. `ShapeTool` owns only the anchor and recomputes the *whole* outline on
every move, which is what lets `Shift` and `Alt` change the shape mid-drag
(45-degree lines, squares and circles; drawing from the centre).

#### The polygon and the star

The polygon and the star are the same trick with a different outline, and they
need no new content, no new command and **no format change**: a saved polygon
reopens as the same pixels, and - like every other shape - it is no longer "a
polygon" once it is committed, because the file stores points, not a kind.

Both are inscribed in the **ellipse of the drag's box**, so the two tools agree
on where a tip sits. The polygon's rule is the familiar one - the rule
Photoshop, Procreate and Illustrator use - and the star follows it. A polygon is
a regular *n*-gon: vertex *k* sits at `-π/2 + 2πk/n` on that ellipse, so the
first vertex is at the **top**, and the outline closes by repeating the first
point. Because the polygon is inscribed in the ellipse, its own bounding box is
**not** the drag's box: the two are equal when the side count is a multiple of
four (the vertices sit on all four extremes), the polygon's is narrower in one
axis when the side count is two more than a multiple of four, and it is smaller
in both axes when the side count is odd. A star with *p* points is the classic
**2*p*-vertex outline - an outer and an inner vertex alternating - and
deliberately **not** a pentagram: a pentagram crosses itself, and the rasterizer
fills with the **non-zero** rule, so a self-crossing outline would fill its
crossings as one blob instead of as a star. The star's tips are the polygon's
vertices and its inner vertices are the same ellipse scaled by `innerRatio`
about the centre, so a ratio of `1` is a regular `2p`-gon and the valleys
always point between two tips. The inner ratio has a floor of `0.05`, which is
what keeps the outline simple.

`Shift` squares the drag's box, which is what makes a polygon or a star
**regular**; `Alt` draws from the centre, exactly as for the rectangle and the
ellipse. The **rotation** exists as an option because the selection can move,
nudge, duplicate and flip but cannot rotate - without it, a rotated polygon
would be unreachable in the product. It is a **rigid** turn: the vertices are
placed on the ellipse first and are then turned about the box's centre, so the
shape keeps its side lengths, its distances and its size, and the first vertex
ends up at `-π/2 + rotation`. (Folding the rotation into the ellipse's
*parameter* instead would **morph** the shape on a non-square box: its side
lengths would change with the angle, which is not a rotation.) The turn takes
the shape off the ellipse it was inscribed in, so a rotated shape's own
bounding box can be **larger** than the drag's box in one axis - and smaller in
the other - and it can reach outside the paper. It never leaves the circle of
radius `max(rx, ry)` around the box's centre.

The three options - the side/point count (`3..24`, default `5`), the inner
radius (`0.05..1`, default `0.5`) and the rotation (`0..360°`, default `0`) -
are **editor state** in the engine, published in the `EditorSnapshot` and read
through `ToolContext.getShapeOptions()`. They are not undoable, they do not
dirty the file, and they are not stored on the stroke: a committed shape keeps
only its points, which is why changing an option never rewrites existing work
and why the format does not move. Like `shapeFill`, they are read **when the
gesture starts**, so a shape keeps the values that were active when the user
pressed. One number serves both tools, so the toolbar's slider is labelled
**Sides** for the polygon and **Points** for the star.

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
   brush colour as stop `0`, the toolbar's middle stops, toolbar end colour as
   stop `1`, brush opacity - and inserts a zero-length record at the end of the
   active layer's element list. Nothing enters history and the revision does not
   move.
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
`{ bounds, strokes, handles }` through `setSelection(...)`; the renderer traces
the centrelines in blue and draws the frame as a dashed rectangle, after the
layers and the in-progress stroke and before the document border. It never reaches a
layer surface and `composeDocumentImage` (and therefore PNG export) never sees it.

The **handles belong to the committed selection**, never to the marquee's rubber
band: while a band is being dragged the overlay shows the band and no handles,
and the handles appear only for a real selection, on the frame derived from the
strokes. A handle drawn on the band would be a lie anyway - the hit test uses
the committed selection, so it could not be grabbed.

Four gestures, chosen on press:

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
- **Scale** - drag one of the four **corner handles**. The scale is **uniform**
  and is about the **centre of the selection's frame**, taken when the gesture
  starts. The corner keeps its direction from the centre: the factor is the
  pointer's distance *along that direction* relative to the corner's own
  distance, so dragging away from the centre grows the selection, dragging
  towards it shrinks it, and dragging across the diagonal changes nothing. That
  is the rule a proportional corner handle follows in a vector editor, and it is
  what keeps the scale uniform. The factor is clamped to `MIN_SCALE_FACTOR`
  (5 %): a drag through the centre must not collapse the selection or mirror it.
- **Rotate** - drag the **rotation handle**, the circle above the frame's top
  edge. The rotation is about the same centre, and the angle is the pointer's
  compass angle measured clockwise from "up". The angle **snaps to 15 degrees**
  while the pointer is held down, and **Shift turns the snap off** so the turn
  can be free.

Both transforms are measured **from where the press landed**, not from the
pointer alone. The grab radius is 10 screen pixels, so a press may land up to
that far from the handle it grabs; reading the pointer's angle or factor
directly would jump the content at the press, before the user has moved
anything. The scale is therefore `1 + (the pointer's factor − the press's
factor)` and the rotation is the *change* of the compass angle since the press
(wrapped to the shortest way round). The rates are unchanged: dragging the
pointer one corner-distance further out still doubles the selection.

The handles win over the move: they sit on the frame's corners, which are
inside the frame, so a press on a corner would otherwise start a translation.
Grabbing a handle is an explicit "transform this", and it is checked first.

A scale and a rotation are **baked on apply**, exactly like a move: the
transform is a coordinate map over the selected strokes' *samples*, and the
strokes are committed as they are. There is no persistent transform, no new
element kind and no project-format change, because a stroke stays
self-describing: the same brush, the same colour, the same opacity, the same
pressure and the same number of samples, just at new positions. A transform
never changes a stroke's brush, so the painted width is *not* scaled with it -
the frame of a scaled selection is the scaled frame of its samples plus the
same padding, not the scaled frame.

The transform geometry is **pure and DOM-free**
(`core/document/selectionTransform.ts`): the scale and rotation maps, the
factor and the angle a pointer asks for, the two rules that measure a drag
**from the press** (`scaleFactorFrom`, `rotationAngleFrom`), the clamps, the
angle snap, and the rule that says where the selection's frame is.
`core/document/selectionHandles.ts` owns the handles' layout and their hit
test. The engine holds no transform state of its own: the frame it draws is
**derived from the strokes**, so after a transform the overlay shows the new
frame and the handles sit on its new corners.

The snap's tie - exactly 7.5 degrees between two steps - breaks **away from
zero**, so +7.5 degrees snaps to +15 and -7.5 to -15: a clockwise turn and its
counter-clockwise twin must not land on different angles. A factor that is not
a number at all is refused differently from a small one: the selection
**stays where it is** (the identity) rather than being shrunk to 5 %, because a
selection that suddenly shrank is a surprise and one that did not move is not.

A transform is one undo step, through the same command as the move and the
flip: `createTransformStrokesCommand` runs the map over the copies taken
before the gesture, so `apply` is the committed result and `revert` writes the
originals back. A transform that moves nothing is **refused** rather than
recorded - a scale or a turn of a single dab maps every sample onto itself, and
an undo step whose undo does nothing reads as a broken undo button.

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
if a heavy layer makes dragging lag. A scale and a rotation cost the same: the
transform is written over the samples and the layer is re-rasterized, so the
pixels on screen are always what a re-rasterization would produce.

Two limits are worth stating plainly, because they follow from baking the
transform on apply:

- **A transform is about the frame's centre at the moment the gesture starts.**
  A rotation can move that centre - the axis-aligned envelope of a turned
  selection is not centred on the point it turned around - so a *second*
  rotation is about the new frame's centre, not the first one's. The same is
  true of the flip, which has always had this property.
- **A scaled stroke is not literally the stroke redrawn at the new size.** A
  redraw samples the path at the brush's spacing, so it would have more
  samples. What *is* guaranteed is that the scaled stroke is an ordinary
  stroke whose samples are the transformed ones, so it re-rasterizes, reopens,
  undoes, redoes and exports exactly like any other.
- **The fixed-step commands are the same transform with a different number.**
  The Selection menu offers **Scale by 150 %**, **Rotate 15 degrees clockwise**
  and **Rotate 15 degrees counter-clockwise** alongside the handles. They write
  the same coordinate maps, through the same history command, about the same
  pivot - the centre of the selection's frame, which `selectionBounds()`
  gives the handle and `boundsOfStrokes(...)` gives the command, one function
  and one point. The scale is a **factor**, not a target: 1.5 makes the
  selection one and a half times as large, and applying it again makes it two
  and a quarter times as large, because the transform does not remember what
  the selection used to be. The rotation step is the same 15 degrees the
  handle snaps to.
- **Undo is the exact inverse; the opposite command is not.** Undo restores the
  stored originals verbatim, so it is the only exact way back. A counter-turn
  is **not** a round trip, because a turn moves the frame's centre (the first
  limit above), so the second turn pivots elsewhere. A scale undone by another
  scale is close but not exact: the reciprocal of 1.5 is not a number binary
  floating point can hold, and with strokes of different brush widths the
  frame's centre moves as well. The labels therefore say what the commands do
  and nothing more - no command is called an inverse of another.

### Composition guides

A guide is a marker on an axis: a vertical guide stands at an x, a horizontal one
at a y. It is **document state** - `DrawingDocument.guides` - because it is
stored with the drawing and must mean the same thing at every zoom and on every
machine. It is **display-only**: the renderer paints it over the artwork and it
never reaches a layer surface or a PNG export, exactly like the selection
overlay.

The model is deliberately small (`core/document/types.ts`):

```ts
interface Guide { readonly id: string; readonly axis: "vertical" | "horizontal"; readonly position: number }
```

One number, not a point: a vertical guide's y is meaningless (it spans the
page), so the axis plus a single position is the whole geometry and there is no
second source of truth. The position is always a **whole document pixel**: a
guide is a registration mark, and a fractional position would draw a soft edge
at some zooms. `core/document/guides.ts` is the pure module that holds the
rules - the axis heuristic, the rounding, the hit-test, the duplicate rule and
the document operations - and it is unit tested without a canvas.

**Two spaces, on purpose.** The guide's *position* is document space, so zoom
and pan need no special handling: the canvas transform already maps document to
device. Its *grab radius* is screen space (8 CSS px, `8 / zoom` document px),
because a press is made with a finger or a mouse: a fixed document radius would
make a guide ungrabbable when zoomed out and impossible to miss when zoomed in.

The **Guides tool** (`core/tools/guidesTool.ts`) is one tool with two gestures,
chosen by where the press lands - the same shape as the select tool:

- **Press on empty canvas** - drag out a new guide. The axis comes from the
  dominant direction of the drag (`|dx| > |dy|` is vertical, otherwise
  horizontal), and the position is the **press** coordinate along that axis, so
  the guide marks where the user started rather than where they let go. The
  axis is decided once and never changes afterwards.
- **The axis-decision threshold: 3 CSS pixels.** The drag has to travel
  **3 CSS px** (the same distance on screen at every zoom, so `3 / zoom`
  document px) before its direction decides the axis - otherwise the first
  pixel of jitter would fix the axis for the whole drag. **A drag shorter than
  3 CSS px creates no guide at all**: until the threshold is reached no guide
  exists, so a press-and-release inside it is a click and a drag inside it
  leaves the document untouched.
- **Press on an existing guide** (within the grab radius) - drag it along its
  own axis. A vertical guide follows x and ignores y.
- **A press that never moves** is a click: on a guide it selects it, on empty
  canvas it clears the selection. `Delete` removes the selected guide, `Esc`
  cancels the drag in flight and clears the selection.

The **duplicate rule**: two guides on the same axis at the same position are
pointless, so a create or a move that would land on another guide is refused
and the drag does nothing. A guide may sit **outside the paper** - a guide
marks a position, and clamping would lose the intent; it is drawn across the
whole viewport either way.

**History.** A guide gesture never enters history while it is in flight. The
guide lives in the document during the gesture - that is how the renderer shows
it - and the release commits **one** document command; a cancel puts the
document back exactly as it was and records nothing. A gesture that changed
nothing (a click on empty canvas, or a drag that ended where it started) commits
nothing either, so history never holds a step that appears to do nothing. The
command is an ordinary `DocumentCommand`, so undo and redo restore the guide set
exactly; the guide selection is *editor* state and is dropped when the guides
tool is left or when the selected guide disappears.

**Display.** The guides are painted in the display pass, after the layers and
before the selection overlay and the document border, as full-viewport lines one
device pixel wide (`1 / scale`, the same hairline idiom as the border). The
selected guide is drawn in the selection accent so the two overlays can be told
apart. `composeDocumentImage` never sees them, so a PNG export of a document
with guides is byte-identical to one without - which is exactly why the project
format needs no version bump for them.

**Saving during a drag.** The live preview is part of the document while the
gesture runs, so a save taken mid-drag writes the *preview*, not the document
the user is going to keep. The file is therefore **not** marked clean by such a
save: the engine remembers that the file holds a preview, and the dirty flag
stays on until the file is written again. The same rule as everywhere else in
the editor applies - an operation must never mark the document clean when the
document is not what was written.

### Grid and snapping

The grid is a lattice of lines over the paper and the snap is the rule that
pulls a drawing point onto one of them - or onto a composition guide. Both are
**view state**, not document state: the grid is not stored with the drawing, it
changes no pixels, it enters no history and it never reaches an export.

**The spacing is document space.** A spacing of 50 means 50 *document* pixels,
never 50 CSS pixels, so the grid means the same thing at every zoom and pans
with the paper: the canvas transform already maps document to device, so the
lines need no special handling. The spacing is a whole document pixel (2-500),
because a fractional lattice would draw a soft edge at some zooms.

`core/document/grid.ts` is the pure module that holds the rules, and it is unit
tested without a canvas:

- `nearestGridLine(value, spacing)` - the line nearest a coordinate, or `null`
  when there is no grid. The lines sit at whole multiples of the spacing, and a
  coordinate exactly between two lines rounds up.
- `gridLinesBetween(from, to, spacing)` - the lines between two coordinates.
  The renderer draws these, so **the drawn grid and the snapped grid are the
  same lines by construction**: what the user sees is what the pointer lands on.
- `snapDocumentPoint(x, y, targets)` - the snap itself.

**The snap is a magnet, not a lattice lock.** A point is pulled onto a target
only when it is within **6 CSS pixels** of one (`SNAP_TOLERANCE_PX`). The
tolerance is *screen* space and is converted with the live zoom
(`6 / zoom` document px), so the same physical gesture snaps alike at 100 % and
at 400 %, and a grid is equally magnetic at 2 % and at 6400 %. Between the
magnet zones a point keeps its position, which is what stops a grid the user
cannot even see from dragging the drawing around.

The rules that pick the target:

- the **nearest** target wins, whether it is a guide or a grid line;
- on an exact tie a **guide** wins over a grid line - a guide is a mark the
  user placed on purpose - and between two guides the **lower** position wins,
  so the answer never depends on the order the guides are listed in;
- each axis is decided on its own: a vertical guide can pull the x while the y
  still falls on a grid line.

**Where the snap happens.** The engine has one pointer entry point
(`handlePointerSample`), and the snap is applied there, *after* the viewport
transform and *before* the tool sees the sample. The sample the user drew and
the sample that is committed therefore agree, and the rule is applied once
rather than in every tool. Two rules keep the snap from changing what a
gesture *is*: a press **outside the paper** is ignored by every drawing
gesture, so the snap never pulls a point that started outside onto the paper,
and a snap that would leave the paper is not applied, so a gesture can never be
refused by its own snap.

The tools that commit drawing samples - the brush, the eraser, the shape tools,
the line and the gradient - follow the snap. The bucket and the colour picker
read pixels rather than place geometry, and the select, guides and pan tools do
not commit drawing samples, so they are left alone.

**Display.** The grid is painted in the display pass, after the layers and
before the guides, clipped to the **paper** (a grid belongs to the artwork,
unlike a guide, which spans the whole viewport). It is one device pixel wide,
like the guides and the document border, and it is hidden when the lines would
be closer than 3 device pixels - below that they merge into a wash. The snap
keeps working at that density; only the drawing is hidden. `composeDocumentImage`
never sees the grid, so a PNG export of a document with the grid on is
byte-identical to one with it off.

**Preferences.** The grid visibility, the spacing and the snap switch are
**view preferences**: they live in the editor, they are published in the
`EditorSnapshot` and they are stored in the per-user settings file, so they
survive a restart. Changing one is not an edit: no history step, no revision
bump, no dirty flag.

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

A stroke flagged `fill` (a filled rectangle, ellipse, polygon or star)
additionally fills the
closed polygon its samples trace, once, before the outline is traced - and only
on a full re-rasterization (`fromIndex === 0`), which is the only way a shape is
ever drawn. Both passes are drawn at full coverage and the stroke's alpha is
applied once when the buffer composites, so filling and tracing cannot darken
each other. The default non-zero winding rule is enough: the outline is a single
simple loop.

### Document size and surface memory

Document geometry is bounded twice. Each side is limited to 8..8192 px, and the
**total** pixel count is limited to 16,777,216 (4096x4096), so an 8192-wide
document may be at most 2048 px high.

The total limit is a memory budget, not an arbitrary cap. A canvas backing
store is RGBA, so one document-resolution surface costs `width * height * 4`
bytes at raster scale 1 and four times that at the app's maximum display scale
of 2. The renderer can hold several of those at once: one surface per layer,
the live stroke buffer, and - at most one more - either a full-resolution erase
snapshot while an eraser is down *or* the grouped live-preview scratch for a
layer with opacity below 1 or a non-`normal` blend mode. Those two are
mutually exclusive by construction: an eraser previews by mutating its own
layer surface, so the renderer passes no preview for it and never builds the
group scratch while the erase snapshot exists. A transient scan buffer adds
about 10 bytes per document pixel (a bucket scan's composite + `ImageData` +
visited bitmap + mask; the 1x PNG export composite is 4).

That peak is `3 * 4 * 2^2 + 10 = 58` bytes per document pixel - 928 MiB at the
cap - inside a 1 GiB budget, which keeps one 2x surface at 256 MiB instead of
the roughly 1.07 GB an 8192x8192 document would need for a single surface. The
one-surface rule is a requirement of the renderer, not a hope: if the
grouped-preview scratch were retained after a preview and an eraser then ran,
the peak would be `4 * 4 * 2^2 + 10 = 74` bytes per document pixel (1.16 GiB),
over the budget. The renderer therefore releases the scratch whenever no
preview is active.

The limit lives in the document model (`isValidDocumentSize`), so it applies
wherever a document is created - the New Document dialog and `createDocument` -
and in the project parser, which checks the dimensions before it reads any
layer content. An oversized file is therefore refused before the engine
replaces the open document or allocates a surface, and a project that is inside
the budget keeps opening unchanged; nothing is scaled down silently.

This bounds *calculable backing-store pixels*, not the browser's total memory:
the display canvas, the compositor and the GPU driver add their own overhead,
and every additional layer adds another full-resolution surface. The budget
covers a one-layer document plus the working buffers.

The stamp engine's coverage map does not move the peak. It is **1 byte per
device pixel over the stroke's own footprint** - at most 4 bytes per document
pixel at the budgeted scale of 2 - and it is a transient like the scan buffer,
so it fits inside the same 10 bytes per document pixel allowance: the in-flight
map and the resident scratch together use at most 8 of those 10 bytes, leaving
**2 bytes per document pixel of transient headroom** for the next feature that
needs scratch space (masks, groups, tiles). Two details keep it there: the
coverage map is tiled and allocated on demand, so it follows the inked area
rather than the document, and the upload to the stroke buffer is **one
`ImageData` per tile** (16 KB), never one for the whole dirty rectangle, which
would be document-sized in the rebuild path. The coverage map is JavaScript
heap rather than a canvas backing store, so it sits outside the budget model's
stated scope; it is stated here next to the budget rather than folded into the
constants, so the model keeps describing what it says it describes.

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
- A **merge barrier** ends a merge run. An action that is not part of the same
  continuous gesture - selecting another layer, changing the brush, a tool or
  the selection, moving the viewport, an undo or a redo - breaks the run, so
  the next same-keyed change starts a fresh history entry instead of folding
  into an older one. Two opacity drags separated by a layer change are two
  gestures, and therefore two undo steps.
- Layer operations are **transactional**: no layer mutation touches the document
  directly. Deleting a layer is therefore recoverable, and every edit bumps the
  revision that drives the dirty flag. Selecting a layer is the one exception -
  it changes no pixels and is not an edit, so it neither dirties the document
  nor enters history.

Layer changes are **refused while a gesture is in flight**. A stroke, fill,
gradient or selection drag owns content that is not in history yet, and a layer
edit at that moment could remove or reorder the layer the preview is being
painted into, so the release would commit into a layer that is no longer part
of the document. The engine answers with a notice ("Finish the current stroke
or selection before changing layers.") and changes nothing. As a last resort -
an external document swap - the finish and cancel paths check that the target
layer still exists and discard the preview instead of recording an orphan
stroke, fill or gradient.

A metadata-only layer edit (rename, visibility, opacity, blend mode, reorder)
**preserves the active layer** across undo and redo. Such a command no longer
restores whichever layer happened to be active when the edit was made: undoing
an opacity change keeps the layer the user is looking at, and with it the
selection the user made. Structural commands (add, delete, duplicate) still own
which layer becomes active, because they create or remove layers.

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

### The brush cursor and the quick resize

The brush's size is visible on the canvas as a **ring**, and it can be changed
without leaving the canvas. Both are *views*, never content.

**The ring.** `features/canvas/BrushCursor.tsx` is a DOM overlay: a sibling of
the canvas element, not a layer of it. It therefore cannot reach a layer
surface, a PNG export, the document history or the project file, and because it
is a separate compositing layer it cannot flicker with the artwork underneath
it. The ring's diameter is the brush's diameter in **document** pixels mapped
through the viewport zoom, so it is the brush's real footprint rather than a
decoration:

```
cssDiameter = max(4, brush.size * zoom)
```

The four CSS pixels are the floor: a 1 px brush at 10 % zoom is a tenth of a
pixel, and a ring that thin is invisible rather than honest. The device pixel
ratio enters through the outline's width - one *device* pixel is `1 / dpr` CSS
pixels, with a half-pixel floor - so the ring stays a hairline on a
high-density display instead of thickening with the zoom.

The engine owns the answer. `engine.subscribeBrushCursor` reports the size, the
zoom and two states (a resize in flight, a stroke in flight); the overlay
writes them straight to the DOM, like the cursor position, so pointer movement
never re-renders React. The ring fades while a stroke is in flight so it does
not sit on top of the artwork being drawn.

**The quick resize.** `Ctrl`+`Alt` and drag on the canvas changes the brush
size: up grows it, down shrinks it. The gesture is owned by the engine and
runs *before* any tool sees the press, so a resize can never leave a stroke
behind.

- The drag is **relative**: `size = start * e^(-dy / 100)`, so the ring does
  not jump when the drag begins and the gesture feels the same at every zoom.
  One e-fold of travel (100 screen pixels) multiplies the size by `e`; the
  result is clamped to the brush's own `1..512` range.
- A travel of three pixels or less is a **click**, not a resize, and leaves
  the size alone.
- The size is written through the ordinary `setBrush`, so the ring, the
  readout, the toolbar's slider and the next stroke all agree. It is editor
  state: no command is pushed, the revision does not move and the file stays
  clean.
- **Escape cancels** the resize and puts the size back. It has to work while
  `Ctrl`+`Alt` is still held, because the gesture only ends when the pointer
  is released - so the cancel is handled in `useKeyboardShortcuts` before the
  chord table, which claims an exact set of modifiers and would otherwise
  ignore the key.
- A **lost pointer capture** cancels the resize the same way. If the capture
  could not be taken at all, the release never arrives, and the next press is
  the only sign that the gesture was over: the orphaned gesture is put back
  the way it was, so the size is never left half-changed.
- The gesture is **not taken away from a surface that owns the interaction**:
  a field the user is typing in keeps the keyboard, and a press there reaches
  the tool as usual. A modal dialog covers the canvas, so the canvas never
  receives the press at all, and the brush-size shortcuts stand down while a
  dialog is open.

The gesture is a shortcut, not the only way in: `[` and `]` step the size,
`Alt`+`[` and `Alt`+`]` change it by exactly one pixel, and the toolbar's
**Size** slider is a labelled range input that a keyboard or a screen reader
can drive. The ring's readout is a visual duplicate of what that slider
already exposes, so it stays out of the accessibility tree; the final size is
announced once, when the gesture ends.

## React integration

There is exactly one engine instance per window, created by `EditorProvider`
and shared through a React context. `useEditor()` returns the stable
`{ engine, actions }` handle; `useEditorState()` subscribes to the snapshot.

The snapshot is republished only when something with visual meaning changes
(tool, brush, layer list, viewport, history, document). Field-identity checks
keep it from churning. Two things deliberately bypass React:

- **Cursor position and pressure** are written imperatively through
  `engine.subscribeCursor`, because they change on every pointer move.
- **The canvas cursor style** is applied from the same cursor stream, because a
  tool can ask for a more specific cursor than its own: the select tool's
  transform handles want a diagonal resize cursor and the rotation handle a grab
  cursor. The engine recomputes that answer on every pointer move **and on
  every viewport change** - a zoom moves the handles, so a cursor that still
  claimed a resize cursor would be lying.

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
  as one undoable, dirtying step, and the compositor test checks every operation
  mapping, exact blended pixels (including alpha), the reset between layers and
  the shared export path. The format suite asserts a version-11 round trip of
  interleaved strokes, fills and gradients with every blend mode, version-1 to
  -10 compatibility, and rejection
  of bad boxes, masks, stops, geometry, opacity, unknown blend modes, gradients
  in a version-4 file, missing or out-of-range hardness in version 6, missing or
  out-of-range texture in version 7, future versions, and the fill pixel
  ceiling.
- Tool geometry is tested directly: `shapeGeometry` covers 45-degree snapping,
  squares and circles, drawing from the centre, the ellipse's bounded and
  exactly-closed outline, and the degenerate extent. The polygon and the star
  are covered there too: the vertex count, the first vertex at the top, the
  inscribed-ellipse rule, the clamped side count, the star's alternating tips
  and valleys, its inner-radius ratio, the rotation about the centre, the
  degenerate drag, and the proof that the star's outline is a **simple** loop
  even at the smallest inner ratio (which is what makes the non-zero fill fill
  a star rather than a blob). The rotation is tested on a **non-square** box
  as well as a square one, and the assertion is that the turned outline is the
  rigid turn of the unrotated one - the same side lengths, the same distances -
  because a square box cannot tell a rigid turn from a morph. The star's
  **absolute** placement is pinned too: its tips sit on the box's ellipse and
  its valleys on the same ellipse scaled by the inner ratio, so a star drawn
  at the wrong size cannot pass. Shape *behaviour* is
  covered through the recording renderer on the engine: a drag previews with a
  full-buffer redraw and commits nothing, the release commits exactly one stroke
  carrying the outline's samples, and cancellation, a mid-drag tool switch, an
  out-of-bounds start and a click that never moved all leave the document and
  the history untouched. The fill setting is covered the same way: a shape is
  flagged only while the setting is on, each shape keeps the setting it was
  drawn with, a line is never filled even with the setting on, and the setting
  survives a tool switch without becoming an edit. The polygon's and the star's
  options are editor state too: they are clamped, they never enter history or
  dirty the file, and they are read when the gesture starts, so a shape keeps
  the values that were active when the user pressed. `replaceStroke` is asserted on
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
  transform geometry has its own pure suite: the scale about a centre, the
  rotation about a centre, the clamps (a selection can neither collapse nor
  invert), the 15-degree angle snap and the free angle `Shift` asks for, the
  factor a pointer asks for, and the selection's frame **after** a transform -
  which is the frame of the transformed samples plus the same padding, because a
  transform never changes a stroke's brush. The handle suite pins the corner
  positions, the rotation handle on the centre's ray, the grab radius and the
  nearest-handle-wins rule. The engine suite drives the scale and the rotation
  through the same pointer entry point: one undo step, exact undo and redo, the
  brush and the pressures untouched, the frame and the handles following the
  transformed strokes, a cancel restoring the originals and recording nothing, a
  transform that would change nothing being refused, and the transformed stroke
  surviving a save and reopen.
  The
  renderer suite asserts the overlay stream: the trace and the dashed frame come
  after the layers and before the solid border, `setSelection(null)` leaves only
  the border, the handles are painted on the display canvas only, and the
  exported composite contains neither the frame nor the handles.
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
exact original and moved positions. The transform handles are verified the same
way: the four corner squares and the rotation circle appear on the selected
frame, the cursor becomes a diagonal resize cursor over a corner and a grab
cursor over the rotation handle, dragging a corner out doubles the ink's extent
about the frame's centre and the history depth rises by exactly one, dragging
the rotation handle a quarter turn turns the ink by a quarter turn, the
snapped turn lands on 15 degrees while a `Shift` turn keeps the free angle,
and a press that misses a handle does not jump the content. The PNG export
**cannot run in a browser** - it asks the Tauri save dialog, which is absent
outside the desktop shell - so "the handles never reach an export" is covered
by the renderer unit suite and by `composeDocumentImage()` calling
`paintDocument()` only, not by a browser measurement.
Stroke compositing is verified that way
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
survive a save/reopen, an unset flag is absent from the file, version 11 preserves
every layer blend mode, an interleaved stroke/fill/gradient order with its mask
bytes, geometry, per-stroke hardness and texture, a version-10 file keeps its
version-8 blend mode, a version-7 file opens with
normal blend mode, a version-6 file opens with no texture, a version-5 file opens
with hard strokes, a version-4 file still opens with fills and strokes, and a
version-1, -2 or -3 file opens with its shapes traced rather than filled.

## Known limitations

These are real gaps, not footnotes:

- **Tools**: only `brush`, `eraser`, `select`, `line`, `rectangle`, `ellipse`,
  `polygon`, `star`, `bucket`, `gradient` and `picker`, plus `pan`. There is no
  text tool. A bucket
  fill writes a region; a gradient is a two-stop linear/radial colour function,
  not an editable gradient with draggable stops.
- **Selection is stroke-level, layer-scoped and limited to translation, scaling,
  rotation, duplication and reflection.** A marquee
  selects whole strokes (never part of one, so a selection cannot split a stroke
  or mask a brush stroke), only on the active layer, and it is dropped when the
  layer or the tool changes. **Fill patches and gradients are not selectable** -
  the stroke-only view deliberately filters them out - so they can only be
  undone, not moved, duplicated or flipped. There is no add/subtract modifier, no
  feathering,
  no clipping, no perspective and no non-uniform scale; duplicate stays on the
  layer (there is no cross-layer copy/paste). The frame is the selected strokes'
  bounding box, not the region that was dragged.
- **A transform is baked on apply.** A scaled or turned selection is committed
  as new sample positions, so there is no persistent transform to edit later,
  and the painted width is not scaled with the path - a transform changes where
  a stroke was drawn, not how wide it is.
- **A live selection move re-rasterizes the whole layer per pointer move.** The
  element list stays authoritative and the pixels are rebuilt from it, which is
  why the drag can never drift from the committed result; caching the moved
  strokes is the optimisation to reach for if a heavy layer makes dragging lag.
  A scale and a rotation cost the same.
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
  semi-transparent area yields the blended screen colour by design. The colour
  wheel picks colours *by* hue rather than by sampling, and has no swatch
  library, no colour history and no eyedropper of its own.
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
- **Blend modes**: the eleven separable modes (`normal`, `multiply`, `screen`,
  `overlay`, `soft-light`, `hard-light`, `color-dodge`, `darken`, `lighten`,
  `difference`, `exclusion`). They are compositing operations over the finished
  layer, so they combine with the paper and every lower layer; there are no
  group, clipping or alpha-inheritance contexts, and the non-separable hue /
  saturation / color / luminosity operations are not exposed.
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
