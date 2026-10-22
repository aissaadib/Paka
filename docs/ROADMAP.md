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
- [x] Bounded raster memory: a document may use at most 16,777,216 pixels in
      total, so an 8192x8192 document can no longer ask for a ~1.07 GB surface.
      New Document and project loading enforce it before anything is allocated.
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
- [x] Scale, stretch and rotate a selection: the selection's overlay grows four
      **corner handles**, four **side handles** and a **rotation handle** above
      the frame. A corner handle **scales** the selection uniformly about the
      centre of its frame - the corner keeps its direction from the centre, so
      a drag away from the centre grows the selection and a drag towards it
      shrinks it - and the factor is clamped so a selection can never collapse
      or invert. A **side handle** stretches one axis only: the dragged edge
      follows the pointer and the **opposite edge stays put**, `Shift` locks
      the aspect ratio, and a side is never squashed to nothing or mirrored.
      The rotation handle **rotates** it about the same centre; the angle snaps
      to **15 degrees** while the pointer is held down and `Shift` turns the
      snap **off** for a free turn. The **anchor** - the point that does not
      move - is chosen when the gesture starts: `Alt` anchors a corner at the
      opposite corner and a side at the frame's centre. All three are measured
      **from where the press landed**, so a press that misses the handle by a
      little does not jump the content. All are
      **baked on apply**: the transform moves the selected strokes' samples and
      nothing else, so the brush, the colour, the opacity and the pressure are
      untouched, a scaled stroke is still the same stroke, and the project format
      did not move. Each transform is one undo step, through the
      same command as a move. The handles belong to the committed selection and
      are display-only: they never reach a layer surface or a PNG export. The
      side handles sit just **outside** the frame so a press inside it always
      moves the content, the cursor says what a press will do (resize over a
      handle, move arrow over the frame), the handle under the pointer is
      highlighted, and a dragged handle snaps to the grid and the guides with
      the same magnet the drawing tools use. See
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
- [x] Polygon and star tools (`P`, `S`): a **polygon** is a regular *n*-gon
      (3-24 sides, default 5) inscribed in the **ellipse** of the dragged box
      with a vertex at the top, and a **star** is the classic *2p*-vertex
      outline (3-24 points, default 5) - a tip and a valley alternating, not a
      self-crossing pentagram, because the rasterizer fills with the non-zero
      rule and would fill a pentagram's crossings as one blob. The star is
      inscribed in the **same ellipse** as the polygon, so a star's tips are a
      polygon's tips, and its **inner radius** (5-100 %, default 50 %) sets how
      deep the valleys reach. Both take a **rotation** (0-360°, default 0°) about
      the box's centre - a rigid turn, so the shape keeps its side lengths and
      its size - because a shape is drawn, not transformed. `Shift` squares the box, which is what makes either shape
      regular; `Alt` draws from the centre, as for the other shapes. The three
      options are **editor state**: they are clamped, they are not undoable, they
      do not dirty the file, they are read when the gesture starts (so a shape
      keeps the values that were active when the user pressed) and they are not
      stored on the stroke - one number serves both tools, so the slider is
      labelled **Sides** for the polygon and **Points** for the star. A polygon
      and a star are ordinary strokes, so the file format did not move. See
      [ARCHITECTURE.md](ARCHITECTURE.md#the-polygon-and-the-star).
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
- [x] Stamp-based brush engine behind the existing stroke interface (per-dab
      spacing and a true per-dab hardness curve, with the dabs unioned so a
      stroke never darkens where it crosses itself). Format v9.
- [x] Per-dab directional texture: bristle lanes that run along the path and
      follow the stroke's direction, multiplied into a dab's coverage before the
      union, so the union is still a maximum and a stroke still cannot darken.
      Deterministic from the document coordinates and the dab's direction.
      Format v10.
- [x] Brush presets: the brush panel saves the current brush under a name and
      switches, renames and deletes saved brushes, and the library survives a
      restart in the per-user settings file. Applying a preset is not an edit
      (no history step, no dirty flag), a preset stores every `BrushSettings`
      field, and a table-driven guard over the default brush prevents a field
      from being silently dropped by the settings reader. Settings stay v1.
- [ ] Image-based or brush-tip stamp textures: a tip that is a mask rather than
      a round disc, so a stroke can be stamped with a felt tip or a dry ink
      blot. The per-dab machinery FF-01 added is what a tip would build on.

## Phase 4 - Layer system

- [x] Blend modes beyond `normal`: eleven modes on a layer - `multiply`,
      `screen`, `overlay`, `soft-light`, `hard-light`, `color-dodge`, `darken`,
      `lighten`, `difference` and `exclusion` - applied
      when the finished layer composites over the paper and the layers below it.
      Changing the mode is one undoable step and does not re-rasterize layer
      pixels - it only changes the final composite. Display, PNG export, bucket
      sampling and the colour picker share that composite. Format v11, because a
      v10 reader rejects the new values instead of drawing them as `normal`; a
      v10 file still opens.
- [ ] Layer masks and clipping.
- [ ] Groups.

## Phase 5 - Import/export and colour workflows

- [x] Versioned `.paka` project file (metadata + ordered strokes, fill patches
      and gradients).
- [x] PNG export with an honest encoder.
- [x] HSV colour wheel: a **Colour** panel that picks a hue and a saturation on
      a disc and a value on a slider, with three keyboard-operable sliders
      naming the same numbers. It writes the same brush colour the canvas
      picker and the toolbar's colour input write, so colour has one source of
      truth, and choosing a colour is not an edit.
- [x] Contrast and colour-difference readout: the **WCAG 2.2 contrast ratio**
      between the brush colour and the document's paper, and the palette
      swatch perceptually closest to the ink (**CIEDE2000**). Two numbers for
      two questions - a contrast ratio is a lightness comparison and a colour
      difference is a perceptual one - and neither is used as a proxy for the
      other. A read-only view: no control, no state, no history entry.
- [x] Wider colour input: the colour field accepts 8-digit hex, `hsl()` /
      `hsla()` and `oklch()`, clamps an out-of-gamut `oklch()` into sRGB,
      reverts garbage input to the last valid colour, and reports a translucent
      colour as **not a solid colour** instead of silently measuring it. The
      stored colour stays a hex string, so there is no project-format change.
- [ ] Open/import raster images.
- [ ] Palettes, colour history, swatch management.
- [x] **Preferences survive a restart**: the brush, the tool, the shape options,
      the fill tolerance and the gradient settings live in a per-user settings
      file in the OS configuration folder, and are restored at startup. The
      file holds preferences only - never a drawing - and changing one is not
      an edit, so it never dirties a document. It is the file a palette list
      and the autosave preferences would live in.

## Phase 6 - Aids and non-destructive editing

- [x] **Guides**: a dedicated **Guides** tool places a vertical or horizontal
      guide by dragging on empty canvas (the axis follows the dominant drag
      direction, the position is the press coordinate) and moves an existing
      guide by dragging it; a click selects it, `Delete` removes it, `Esc`
      cancels a drag. A guide is document state but **display-only**, so the
      project format change is additive and the file version stays 9.
- [x] **Grid**: a **Grid** switch draws a lattice over the paper, and a
      **Spacing** control sets the distance between the lines in **document
      pixels** (2-500), so the grid means the same thing at every zoom and
      pans with the paper. The grid is **view state**: it changes no pixels,
      adds no history step, never dirties a document and never reaches an
      export, and it is remembered in the per-user settings file.
- [x] **Snapping to guides and to the grid**: a **Snap** switch makes a
      drawing point that comes within 6 *screen* pixels of a guide or a grid
      line land exactly on it. The tolerance is screen space, so the same
      physical gesture snaps alike at every zoom. The snapping is applied in
      the engine's single pointer entry point, so the sample the user drew and
      the sample that was committed agree. Off by default.
- [ ] Rulers.
- [ ] Adjustment layers / non-destructive effects.

## Phase 7 - Advanced

- [ ] Animation, 3D references, plugin/extension API.

## Documented limitations that are not planned yet

- Undo history is not stored in the project file (reopening rebuilds one step
  per stored element: one per stroke, fill patch or gradient).
- There is no autosave or crash recovery. The recovery machinery and its
  policy seam exist and are covered by tests, but the decisions that govern
  them are the owner's, so nothing is enabled and no recovery file is ever
  written.
- The React layer has no automated tests; it is verified in the running app.
- `Ctrl+N` is not bound; use `File -> New Document...`.

## Next slice

**Brush-tip and image-based stamp textures** (the rest of Phase 3). The stamp
engine has shipped (a chain of round dabs placed along the path, unioned so it
never darkens where it crosses itself, with a true per-dab hardness curve,
format v9) and the per-dab **directional texture** has shipped with it (bristle
lanes along the path, multiplied into a dab's coverage before the union, format
v10). The grain is still one document-anchored post-pass over the finished
coverage.

This slice is about the **shape** of a dab rather than its texture: a brush tip
that is a mask rather than a round disc, so a stroke can be stamped with a
felt tip, a dry ink blot or a bristle bundle.

Non-negotiable constraints:

- `DrawingRenderer` and `StrokeRecord` remain the boundary. A texture is a
  rasterization strategy, not a new element kind; the vector samples stay the
  authoritative record for undo, reopen and export.
- The existing segment path, the existing grain pass and the existing stamp
  engine must stay unchanged by default: a hard, soft or grain stroke drawn
  with no stamp settings stays pixel-identical.
- A tip must stay **deterministic from document coordinates**, so live drawing,
  layer rebuild, undo/redo, reopen and PNG export agree at every zoom and
  `rasterScale`. No `Math.random()` in a repaint path.
- A tip that changes the pixels needs a format bump (v11 if a field changes
  appearance), and the older reader must refuse the file rather than draw the
  wrong look.
- A tip in the project file inflates the JSON: the tip must be a **mask** (no
  colour), so the single-alpha composite and the union maximum still hold.
- Keep `spacing` (sample density) distinct from the stamp's dab spacing.
- UI: real texture controls only when the engine honours them, with no
  placeholders.

Acceptance bar: existing output unchanged by default; a tipped stroke is one
undo step; live, committed, reopened and exported pixels match; the tip is
anchored to the document, not to the frame.
