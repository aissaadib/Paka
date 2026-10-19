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
- [ ] Shape tools (line, rectangle, ellipse).
- [ ] Selection and transform.
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

**Shape tools** (Phase 2): line, rectangle and ellipse. Each is a tool whose
gesture is a drag from an anchor to the current point, with a live preview that
does *not* touch the layer until the press is released - then a single committed
shape, so one undo step, re-rasterized exactly like a brush stroke so save,
reopen and redo agree. The open questions are where the preview lives (a
transient overlay outside the stroke list, so it never enters history), the
modifier-key constraints (`Shift` for squares/circles and 45-degree lines,
`Alt` to draw from the centre), and representing the result as a first-class
shape the renderer can reproduce rather than a burst of brush samples.
