# Editable shapes wave — inventory

Audit of the shape pipeline before implementation. Written on
`integration/editable-shapes-wave` at `e393b53`.

## 1. Repository verification

| Check | Result |
| --- | --- |
| Worktree | `D:/Dev/Paka-overnight-worktrees/integration` |
| Starting branch | `integration/reference-images-wave` |
| Starting HEAD | `e393b533a4bb0e3f2097b8f8e30e844571f88b8e` |
| Working tree | clean |
| New branch | `integration/editable-shapes-wave`, created at `e393b53` |
| Reference-image wave | `docs/qa/reference-images-wave/INVENTORY.md` and `REPORT.md` present |
| Project format | `PROJECT_VERSION = 14` (`src/core/project/projectFormat.ts`) |
| Baseline typecheck | `pnpm typecheck` exit 0 |
| Baseline unit suite | `pnpm test`: 98 files, 2449 tests passed, exit 0 |
| `main` | not modified, not merged; `origin/main` not imported |

Nothing was reset, cleaned, rebased or checked out over existing work. Other
worktrees were listed but not touched.

## 2. How a shape is made today

| Stage | Implementation | Classification |
| --- | --- | --- |
| Options model | `src/core/tools/shapeOptions.ts` — `ShapeKind`, `ShapeOptions`, ranges, defaults, `SHAPE_OPTION_FIELDS` | implemented, verified |
| Geometry | `src/core/tools/shapeGeometry.ts` — `shapeOutline`, `dragBox`, line/rectangle/ellipse/polygon/star outline, rigid `rotateAboutCentre`, `outlineExtent` | implemented, verified (unit + visual scenes `polygon.json`, `star.json`) |
| Gesture | `src/core/tools/shapeTool.ts` — press captures anchor + options, move recomputes the whole outline, release recomputes at the release point | implemented, verified |
| Modifiers | `ShapeDrag.shift` / `.alt`: 45° line snap, square/circle, draw-from-centre | implemented, verified |
| Preview | `DrawingEngine.beginShape` builds a temporary `StrokeRecord`; `setShapeOutline` rewrites its samples; `Canvas2DRenderer.beginStroke` / `replaceStroke` draw it in the preview buffer | implemented, verified |
| Commit | `DrawingEngine.finishShape` → `finishStroke`: appends the temporary stroke to the store, records one `createStrokesCommand`, applies symmetry copies | implemented, verified |
| Cancel | `cancelShape` → `cancelStroke`; tool switch calls `ShapeTool.reset`; lost capture calls `onPointerCancel` | implemented, verified |
| Fill | `StrokeRecord.fill?: boolean`; the outline is filled with the non-zero rule by the stroke coverage path | implemented, verified |
| Appearance | The full `BrushSettings` is copied into the stroke, with `stamp` forced off by `shapeBrush` | implemented, verified |
| Persistence | The committed shape is serialized as an ordinary stroke (`SerializedStroke`), with `fill` as an optional flag | implemented, but **baked / non-editable** |
| Renderer | `Canvas2DRenderer.rasterizeLayer` treats every non-fill, non-gradient element as a stroke; `rasterizeStrokeToBuffer` + `compositeStrokeBuffer` | implemented, verified |
| Export | `composeDocumentImage` uses the same layer surfaces; the preview buffer is never included | implemented, verified |
| Selection | `core/document/strokeSelection.ts`, `selectionTransform.ts`, `selectionHandles.ts`, `core/commands/strokeEditCommand.ts` — marquee/lasso, move, scale, rotate, nudge, flip, duplicate, delete | implemented for **strokes only** |
| Shape reselection | none | **missing** |
| Shape parameter editing | none; committed shapes store only points | **missing** |
| Shape identity | not preserved; a rectangle and a hand-drawn closed polyline are the same record | **missing** |

### Why the current model cannot be made editable by reading pixels

- `StrokeRecord` stores parallel `xs/ys/pressures/times` arrays. A rectangle's
  four corners, an ellipse's sampled arc, and a freehand closed loop are all
  the same kind of data.
- Recovering "this is a polygon with 7 sides rotated 30°" from samples is a
  guess. The requirement forbids guessing shape identity from stroke samples.
- The existing `fill` flag is a rasterization instruction, not geometry: it
  does not say which primitive produced the outline.
- `isStroke` is defined as "anything that is not a fill patch or a gradient"
  (`src/core/document/types.ts`), so adding a new element kind requires
  updating it and every element dispatch.

## 3. Required workflow, current state

| Capability | State | Evidence |
| --- | --- | --- |
| Create line/rectangle/ellipse/polygon/star with live preview | implemented, verified | `shapeTool.ts`, `drawingEngine.test.ts` shape block |
| Shift constrain, Alt centre | implemented, verified | `shapeGeometry.ts` |
| Cancel on Escape / tool switch / lost capture | implemented, verified | `ShapeTool.reset`, `onPointerCancel` |
| Commit on valid completion only | implemented, verified | `outlineExtent` + `MIN_SHAPE_EXTENT` |
| Reselect a committed shape | missing | no shape identity |
| Move a shape | only as part of a stroke marquee selection | `selectTool.ts`, `strokeEditCommand.ts` |
| Resize a shape retaining identity | missing | — |
| Rotate a shape retaining identity | missing | — |
| Delete a shape | only by deleting the baked stroke | `deleteSelection` |
| Edit rectangle dimensions / ellipse proportions | missing | — |
| Edit polygon sides / star points / inner radius | only for the **next** shape (editor state) | `shapeOptions.ts`, `toolOptionSchema.ts` |
| Edit fill / colour / width / opacity of a committed shape | missing | — |
| One history entry per edit | implemented for strokes, not for shapes | `commandStack.ts`, `strokeEditCommand.ts` |
| Save/reopen preserves shape identity | missing | format v14 has no shape element |
| Layers / groups / visibility / opacity | implemented for all elements, including the baked strokes | `Canvas2DRenderer.rasterizeLayer`, `layerGroups.ts` |
| Z-order | implemented for all elements | `StrokeStore` ordered list |
| Reference images excluded from export | implemented, verified | reference wave |
| Symmetry copies | implemented for baked shape strokes | `DrawingEngine.symmetryCopies` |

## 4. Format decision

**A version bump is required: v14 → v15.**

Proof:

- `SerializedElement` is a closed union of `stroke | fill | gradient`
  (`projectFormat.ts`). A v14 reader rejects any other `kind` with
  `has the unknown kind "..."`.
- A native shape needs a `kind: "shape"` element carrying the primitive and
  its parameters. A v14 reader cannot represent it, and writing a shape as a
  stroke would throw away the identity this wave exists to preserve.
- A v14 file must keep opening unchanged: its baked shapes remain
  `StrokeRecord`s and are never converted or guessed into shape objects.
- An older build must refuse a v15 file rather than silently drop the shapes;
  the existing `version > maxVersion` gate already does this.

### Planned schema (v15)

```jsonc
{
  "kind": "shape",
  "id": "shape-...",
  "geometry": {
    "shape": "line",
    "x1": 10, "y1": 10, "x2": 90, "y2": 70
  }
  // or, for rectangle / ellipse / polygon / star:
  // "geometry": {
  //   "shape": "star",
  //   "x": 10, "y": 10, "width": 80, "height": 60,
  //   "rotation": 30, "sides": 5, "innerRatio": 0.5
  // }
  ,
  "brush": { /* the complete BrushSettings, stamp forced false */ },
  "fill": false
}
```

Rules:

- `geometry.shape` is the primitive and the only source of identity.
- A line stores endpoints, because a line's direction is its drag and a box
  cannot represent it without losing which end is which.
- Box shapes store the normalized drag box (`x/y/width/height`), the rigid
  rotation in degrees, and the polygon/star parameters. Rectangle and ellipse
  carry the default `sides`/`innerRatio`, which keeps the record uniform and
  makes the editor's per-kind visibility the only thing that hides them.
- `brush` is the full brush the shape was drawn with, so fill colour, width,
  opacity, hardness, texture and tip survive exactly. `stamp` is `false`,
  matching today's baked shape.
- `fill` is the existing appearance flag, moved onto the shape record.
- No selection, handle, hover or preview state is serialized.

### Validation and compatibility

- `kind` must be `"shape"` and is only accepted from version 15 on. A v14 file
  that claims to contain one is refused with a clear message.
- `geometry.shape` must be one of the five kinds; fields are validated per
  kind: finite coordinates, non-negative width/height, `sides` integer
  `3..24`, `innerRatio` `0.05..1`, `rotation` `0..360`.
- The brush is read through the existing `readBrush`, so every brush field is
  validated exactly as for a stroke.
- Malformed shapes fail the file with a message, like a malformed stroke.
- v13 and v14 documents open unchanged. Their baked shapes are not converted.
- v15 documents are refused by v14 and older builds through the version gate.

### Rendering agreement

A shape is rasterized by expanding it to the **same outline** the tool
previewed and the old baked stroke stored, then running the existing stroke
rasterizer. The expansion is one shared pure function used by:

1. the live preview (through the tool's outline),
2. the committed layer rebuild (renderer),
3. the reopened project (same renderer),
4. the PNG export (same layer surfaces).

No second rasterizer and no appearance rule change. Legacy artwork keeps its
exact old records and therefore its exact old pixels.

## 5. Appearance audit

| Property | Today | Plan |
| --- | --- | --- |
| `fill` | stored on the stroke | stored on the shape; editable |
| `color` | stored in `brush` | stored in `brush`; editable |
| `size` | stored in `brush` | stored in `brush`; editable |
| `opacity` | stored in `brush` | stored in `brush`; editable |
| `hardness` | stored in `brush`, affects the outline | preserved verbatim; not exposed in the compact editor (it is not a shape parameter) |
| `texture` | stored in `brush`, document-anchored | preserved verbatim |
| `pressure*` | stored in `brush`; shape samples use pressure 1 | preserved verbatim; not exposed |
| `stamp*` | forced off by `shapeBrush` | preserved off; never re-enabled by an edit |
| `tip` | stored in `brush`; irrelevant without stamping | preserved verbatim |

Edits that change the brush only patch the named field and re-apply
`shapeBrush`, so an appearance edit cannot switch a shape to the dab path.

## 6. Interaction design

A dedicated **Shape edit** tool (`shapeEdit`, shortcut `V`) in the existing
"Select & transform" rail group. This mirrors the reference-image tool: a
dedicated tool keeps pointer ownership unambiguous, and the brush never
hit-tests shapes while painting.

- Press on a handle of the selected shape → resize (corner) or rotate
  (handle above the frame). Shift snaps rotation to 15°.
- Press on a shape (topmost first, active paintable layer) → select and move.
- Press elsewhere → clear the selection.
- Release → one history entry if the geometry changed.
- Escape / tool switch / lost capture → restore the press-time geometry and
  record nothing.
- Delete removes the selected shape as one history entry.
- The overlay reuses `RendererSelection` (frame, accent outline, handles);
  it is display-only and never reaches the export.

The stroke marquee selection stays stroke-only. Selecting a baked legacy shape
still works with the marquee; only native shapes use the shape editor. This is
documented as a deliberate boundary rather than silently changing the select
tool.

### Options bar

Registered through the existing `core/shell/toolOptions.ts` contract and shown
only when a shape is selected:

- **Shape**: Fill, Width, Height (box shapes only).
- **Appearance**: stroke width, opacity, colour.
- **Geometry**: Rotation (box shapes), Sides (polygon/star), Inner radius
  (star).

Every control writes a real field of the selected record through an engine
action. No control is shown for a property the record cannot change.

## 7. Undo, history and document correctness

- Creation: one command inserting the shape and any symmetry copies at their
  painting indices.
- Edit: one command replacing the record in place (same id, same index).
- Parameter slider: consecutive writes coalesce through a merge key so one
  drag is one entry; a tool switch or a selection change breaks the run.
- Cancel: the store is restored from the press-time record and the layer is
  re-rasterized; no command is pushed and the revision does not move.
- Shapes live in the existing ordered `StrokeStore` list, so layers, groups,
  visibility, opacity, z-order, reorder, delete, duplicate and format
  serialization keep working through the existing paths.

## 8. Test matrix

| Area | Test |
| --- | --- |
| Geometry refactor and parameter reconstruction | `shapeGeometry.test.ts` additions |
| Shape record transforms, hit-test, equality | new `shapeRecord.test.ts` |
| Creation of all five kinds as shapes | `drawingEngine.test.ts` shape block rewritten |
| Invalid geometry / click discarded | `drawingEngine.test.ts`, `projectFormat.test.ts` |
| Preview vs committed vs export | `canvas2dRenderer.test.ts` + visual scene |
| Modifiers | existing shape block |
| Selection and hit-testing | `shapeRecord.test.ts`, engine gesture tests |
| Move / resize / rotate | engine gesture tests |
| Primitive parameter edits + one history entry | engine + `toolOptions.test.ts` |
| Cancel, lost capture, tool switch | engine tests |
| Undo/redo of creation and each edit | engine tests |
| Failure paths leave document/history unchanged | engine tests |
| Layers/groups/visibility/opacity/z-order | engine + renderer tests |
| Save/reopen round trip | `projectFormat.test.ts`, `projectLifecycle.test.ts` |
| Legacy v13/v14 documents | `projectFormat.test.ts` |
| New-format validation and older-version rejection | `projectFormat.test.ts` |
| Render agreement | `canvas2dRenderer.test.ts`, visual scene |
| Reference/overlay exclusion from export | existing reference tests + shape overlay test |
| Regressions (brush, eraser, bucket, gradient, selection, symmetry, groups, references) | existing suites |

## 9. Risks and boundaries

- **Rebuild cost**: a shape preview re-rasterizes the edited layer per pointer
  move, exactly as the existing stroke transform does. Correctness first;
  a dedicated shape preview buffer is out of scope.
- **Active-layer hit-testing**: like the existing select tool, the shape
  editor selects on the active paintable layer only. Clicking a shape on
  another layer is not a cross-layer selection; that would be a new selection
  model.
- **Line resize** scales its endpoints inside its frame; it does not gain a
  box. **Line rotation** turns its endpoints.
- **Primitive kind change** is not offered: converting a star to a rectangle
  has no deterministic rule.
- **Rotation of a box shape** turns the outline rigidly about the box centre,
  which is the existing shape-tool rotation semantics.

## 10. Deferred

Text/path tools, pixel-mask selection, canvas resize/crop, multi-document
tabs, secondary views, adjustment/clipping layers, UI redesign, general
performance work, and unrelated refactors.
