# Paka roadmap

This is the working plan for turning Paka from a drawing-engine foundation into
a professional raster drawing application. It tracks the product brief phase by
phase and records what is actually done, not what is planned.

**Status legend.** `Done` = implemented and verified (automated test and/or
verified in the running app). `Partial` = some of it works. `Todo` = not
started.

The plan is executed **one vertical slice per session**: a coherent,
end-to-end, testable feature. No placeholder buttons and no half-wired tools.

## Ground rules (locked)

- **Stack**: Tauri 2 + React + strict TypeScript + Vite, Rust for native work,
  Canvas 2D behind a renderer interface. No Electron, Qt, Fabric.js or Konva.
  No renderer rewrite or WebGL without profiling evidence.
- **Separation of concerns**: shell/UI, document model, input/coordinate
  transforms, tools/tool options, brush engine, rendering/compositing, layers,
  commands/history, persistence/export, and UI state vs high-frequency input
  state all stay separate. The document model is authoritative; caches are
  rebuildable; React never processes individual pointer samples.
- **Correctness first**: no action should lose work or write corrupted files.
  Invalid or cancelled actions must be safe.
- **Honest reporting**: automated, browser and real-device verification are
  reported separately, and a feature is not "done" until the real interaction
  works.

## Phase 0 - Correctness and no data loss

- [x] Pointer-down, clipping and coordinate edge cases: document/screen
      transform is isolated and tested; pointer capture, `pointercancel` and
      lost capture end a stroke cleanly.
- [x] Reject a press **outside the document rectangle** instead of recording an
      invisible out-of-bounds stroke.
- [x] Remove self-overlap darkening for semi-transparent strokes: segments are
      rasterized at full coverage and the stroke's opacity is applied once, when
      its buffer composites.
- [x] Live rendering and re-rasterization agree pixel for pixel (the starter dab
      is discarded when a stroke grows past its first sample).
- [x] The live preview composites **inside its own layer**: it honours the
      active layer's stacking, visibility, opacity and blend mode, so a stroke
      is never previewed above a layer it does not belong to, and the release
      produces the same picture the user watched.
- [x] Transactional document/layer mutations: every layer edit is a reversible
      command; deleting a layer no longer discards its strokes irrecoverably.
- [x] Layer and history safety: a layer change is refused while a stroke, fill,
      gradient or selection gesture is in flight (the release could not commit
      into a layer that no longer exists); undo/redo of a metadata change keeps
      the active layer, and therefore the selection; an action between two
      same-keyed changes ends the merge run, so two gestures stay two undo
      steps.
- [x] Reject invalid or unsupported project files before touching the live
      document; the parser returns a result object and never throws.
- [x] Dirty-revision tracking; new documents start clean; save clears it.
- [x] Guard paths for Save-first / Cancel / Discard and failed saves, including
      close-with-unsaved-work and New/Open while dirty.
- [x] PNG export leaves the document unchanged and clean.
- [x] A regression test accompanies each of the fixes above.

## Phase 1 - The daily drawing loop

- [x] A reliable **eraser** with predictable compositing and brush options.
      Strikes subtract coverage (`destination-out`) instead of painting, share
      the brush's size/opacity/pressure, are undoable, and survive save/reopen.
- [x] Add, delete, rename, duplicate, reorder and select layers.
- [x] Undoable layer operations and undoable layer visibility/opacity changes.
- [x] Expected keyboard shortcuts (undo/redo, zoom, brush size, tool switch,
      save/save-as/open, duplicate layer).
- [x] Pressure-sensitive width; pressure-sensitive opacity (applied once per
      stroke, from the stroke's mean pressure).
- [x] Stable, predictable compositing for repeated strokes on one layer.

## Phase 2 - Illustration tools

- [x] Colour picker from the canvas: samples the composited document (paper plus
      visible layers at their opacity) at the pointer and sets the brush colour.
      It stays selected after a pick, and it is not an edit - no stroke, no
      history entry, no dirty flag. Precision is the surfaces' (8-bit sRGB);
      sampling is composite-only. See [ARCHITECTURE.md](ARCHITECTURE.md#colour-sampling).
- [x] Shape tools (line, rectangle, ellipse): a drag draws a live preview that
      does not touch the layer, and the release commits one stroke - one undo
      step - that re-rasterizes identically on undo, reopen and export.
      `Shift` constrains (45-degree lines, squares, circles) and `Alt` draws
      from the centre. A shape is an ordinary stroke whose samples trace the
      outline, so no new geometry type and no new file field was needed; the
      trade-off is that shapes are brush outlines with round joins, filled only
      over their own area (see the filled-shapes entry below).
      See [ARCHITECTURE.md](ARCHITECTURE.md#shape-tools).
- [x] Selection and transform: a marquee (or a click) selects whole strokes of
      the active layer - the strokes whose centreline meets the inflated marquee,
      tested continuously so a sparse stroke cannot slip through - and dragging
      from inside the frame moves them exactly. Releasing records one undo step
      built from the strokes' pre-drag copies, `Esc` cancels back to the
      originals, `Delete` removes the selection as one step and undo restores the
      original painting order. Arrow keys nudge (a run of presses coalesces into
      one step), `Ctrl+D` duplicates in place and selects the copies, and
      `Ctrl+Shift+H`/`Ctrl+Shift+V` flips about the selection's own centre - each
      one undo step, all also available from the Selection menu. The overlay
      (dashed frame plus blue trace) is
      renderer-only and never reaches a layer or an export. See
      [ARCHITECTURE.md](ARCHITECTURE.md#selection-and-transform).
- [x] Filled shapes: rectangle and ellipse commit with `fill: true` when the
      toolbar's **Fill shape** switch is on, so the rasterizer fills the polygon
      their samples bound before tracing the outline on top - one undo step, one
      stroke, the same edge as an unfilled shape. A line is never filled (its
      outline bounds no interior), the setting is read when a gesture starts (so
      a shape keeps the setting it was drawn with and toggling rewrites nothing)
      and it is not an edit. The flag is per stroke, so it survived the project
      format: version 3, because a version-2 reader would trace a filled shape as
      an empty outline - a different drawing. See
      [ARCHITECTURE.md](ARCHITECTURE.md#shape-tools) and
      [PROJECT_FORMAT.md](PROJECT_FORMAT.md#strokes).
- [x] Bucket (flood) fill (`F`): a press flood-fills the contiguous region under
      the pointer and writes it to the active layer as a bounded, pixel-exact
      patch. The scan samples the **merged visible composite** (paper plus every
      visible layer at its opacity), so line art on another layer defines the
      boundary the user sees; the committed pixels go to the active layer. The
      toolbar's **Tolerance** slider (`0`-`255`, max per-channel `R`/`G`/`B`/`A`
      difference) widens what counts as the same region; fully transparent pixels
      always match one another. The patch stores an ordered, tightly cropped
      coverage mask - not a traced contour - so save/reopen, undo and redo
      reproduce exactly the pixels the user saw. Undo removes the patch; redo
      replays the committed mask instead of re-running the scan. One successful
      fill is one undo step; a cancelled press (lost capture, tool switch,
      `pointercancel`) removes the preview and records nothing. A document above
      the scan ceiling (16,777,216 pixels) refuses the fill with a status-bar
      message instead of attempting it. See
      [ARCHITECTURE.md](ARCHITECTURE.md#bucket-flood-fill) and
      [PROJECT_FORMAT.md](PROJECT_FORMAT.md#fills).
- [x] Gradients (`G`): a drag paints a **linear** or **radial** gradient on the
      active layer, from the current brush colour to the toolbar's **To**
      colour, at the brush opacity. The press inserts a real preview element and
      each move replaces its endpoint, so the user sees the result in painting
      order; the release commits exactly one undo step, while cancel and a tool
      switch remove the preview with no history or dirty flag. A gradient is a
      first-class `GradientRecord` (type, endpoints, stops, opacity), not a pixel
      snapshot: undo/redo and save/reopen rebuild it from the record, and layer
      duplication copies stops independently. The project format moved to version
      5 for the new element kind. See
      [ARCHITECTURE.md](ARCHITECTURE.md#gradients) and
      [PROJECT_FORMAT.md](PROJECT_FORMAT.md#gradients).

## Phase 3 - Brush feel

- [x] Hardness (soft edge) surfaced in the UI, captured per stroke, format v6.
- [x] Spacing control and stabilizer surfaced in the UI, captured per stroke;
      stabilizer is additive within v6 because stored samples already describe
      the smoothed path.
- [x] Texture as a deterministic, document-anchored grain post-pass, captured
      per stroke, format v7. This is a surface texture, not per-dab texture.
- [ ] Stamp-based brush engine behind the existing stroke interface (per-dab
      spacing, true hardness curves, directional/stamp textures).

## Phase 4 - Layer system

- [x] Blend modes beyond `normal`: `multiply` and `screen` on a layer, applied
      when the finished layer composites over the paper and the layers below it.
      Changing the mode is one undoable step and does not re-rasterize layer
      pixels - it only changes the final composite. Display, PNG export, bucket
      sampling and the colour picker share that composite. Format v8, because a
      v7 reader rejects the new values instead of drawing them as `normal`.
- [ ] Layer masks and clipping.
- [ ] Groups.

## Phase 5 - Import/export and colour workflows

- [x] Versioned `.paka` project file (metadata + ordered strokes, fill patches
      and gradients).
- [x] PNG export with an honest encoder.
- [ ] Open/import raster images.
- [ ] Palettes, colour history, swatch management.

## Phase 6 - Aids and non-destructive editing

- [ ] Guides, grids, snapping.
- [ ] Adjustment layers / non-destructive effects.

## Phase 7 - Advanced

- [ ] Animation, 3D references, plugin/extension API.

## Documented limitations that are not planned yet

- Undo history is not stored in the project file (reopening rebuilds one step
  per stored element: one per stroke, fill patch or gradient).
- There is no autosave or crash recovery.
- The React layer has no automated tests; it is verified in the running app.
- `Ctrl+N` is not bound; use `File -> New Document...`.

## Next slice

**Stamp-based brush engine behind the existing stroke interface** (the last
Phase 3 item). Texture now ships as a coverage post-pass; this slice is about
true dab placement, per-dab spacing/hardness and directional/stamp textures. The
current rasterizer draws segments between samples, and `spacing` means sample
density. A stamp engine must not silently change what existing files look like.

Non-negotiable constraints:

- `DrawingRenderer` and `StrokeRecord` remain the boundary. Stamps are a
  rasterization strategy, not a new element kind; the vector samples stay the
  authoritative record for undo, reopen and export.
- Keep the existing segment path as the default. Hard, soft and grain strokes
  drawn with no stamp settings must stay pixel-identical, including the
  single-alpha and no-self-darkening invariants.
- Accumulate per-dab coverage into **one** stroke buffer (max/union, not
  repeated source-over), then composite once at the stroke opacity. A
  self-crossing stamped stroke must not darken. Apply grain after the dabs, not
  per dab, unless the format records the difference.
- Any grain must stay deterministic from document coordinates, so live drawing,
  layer rebuild, undo/redo, reopen and PNG export agree at every zoom and
  `rasterScale`. No `Math.random()` in a repaint path.
- Capture any new stamp setting per stroke. A non-default stamp/dab appearance
  that an older reader cannot reproduce requires a format bump (v9 if fields
  change appearance); keep `spacing` (sample density) distinct from stamp
  spacing or document an explicit migration if they are merged.
- UI: real stamp spacing/hardness/texture controls only when the engine honours
  them, with no placeholders.

Acceptance bar: existing output unchanged by default; one gesture remains one
undo step; changing stamp settings never rewrites committed strokes; live,
committed, reopened and exported stamped pixels match; self-overlap and
overlapping dabs do not darken.
