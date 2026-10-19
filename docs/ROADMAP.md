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
- [x] Transactional document/layer mutations: every layer edit is a reversible
      command; deleting a layer no longer discards its strokes irrecoverably.
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
      trade-off is that shapes are unfilled brush outlines with round joins.
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
- [ ] Fill and gradient.

## Phase 3 - Brush feel

- [ ] Hardness/texture, spacing controls surfaced in the UI, stabilizers.
- [ ] Stamp-based brush engine behind the existing stroke interface.

## Phase 4 - Layer system

- [ ] Blend modes beyond `normal`.
- [ ] Layer masks and clipping.
- [ ] Groups.

## Phase 5 - Import/export and colour workflows

- [x] Versioned `.paka` project file (metadata + strokes).
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
  per stroke).
- There is no autosave or crash recovery.
- The React layer has no automated tests; it is verified in the running app.
- `Ctrl+N` is not bound; use `File -> New Document...`.

## Next slice

**Fill and gradient** (Phase 2). This is the first slice that cannot be expressed
as "more strokes": a bucket fill reads the pixels it is filling and writes a
region, and a gradient is not stroke geometry at all. The model question comes
first, exactly as it did for selection: the architecture keeps the stroke list
authoritative and pixels a cache, so a pixel-writing tool needs a *new kind of
command* - a bounded pixel patch with a revert image, layered like a stroke - and
a decision about whether a fill on a layer is an operation on that layer's
surface or a new stroke-like primitive. The slice also has to define the tolerance
and anti-aliasing rule (what counts as "the same colour" on 8-bit sRGB surfaces),
what undo restores, what a reopened project reproduces (a pixel patch has to be
serialized or regenerated), and how the in-progress preview stays out of the
layer until the release. Tools that are *not* part of it stay absent rather than
half-wired.
