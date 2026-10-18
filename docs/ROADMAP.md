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
- [ ] Reject a press **outside the document rectangle** instead of recording an
      invisible out-of-bounds stroke. *(Reproduces today.)*
- [ ] Remove self-overlap darkening for semi-transparent strokes (opacity is
      applied per segment, not once per stroke). *(Reproduces today.)*
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

- [ ] A reliable **eraser** with predictable compositing and brush options.
- [x] Add, delete, rename, duplicate, reorder and select layers.
- [x] Undoable layer operations and undoable layer visibility/opacity changes.
- [x] Expected keyboard shortcuts (undo/redo, zoom, brush size, tool switch,
      save/save-as/open, duplicate layer).
- [x] Pressure-sensitive width; pressure-sensitive opacity.
- [ ] Stable, predictable compositing for repeated strokes on one layer
      (depends on the overlap fix in Phase 0).

## Phase 2 - Illustration tools

- [ ] Colour picker from the canvas.
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

**Reject out-of-bounds strokes and fix semi-transparent overlap darkening**
(the two remaining Phase 0 correctness items), then the **eraser** to complete
the basic daily loop.
