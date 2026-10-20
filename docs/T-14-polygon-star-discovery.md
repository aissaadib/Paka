# T-14 — Polygon and star tools: technical discovery and implementation-ready specification

| Field | Value |
| --- | --- |
| Task | **T-14** — polygon and star tools (Wave 1, UI lane) |
| Deliverable | Discovery + specification. **No production code was written.** |
| Paka source inspected | `C:\Users\aissa\Desktop\Paka` at `9b0a885` ("Merge branch 'feat/visual-regression-harness' into feat/stamp-brush-engine") — i.e. post-G1 (the stamp engine) and post-T-01 (the visual harness) |
| Isolated worktree | `C:\Users\aissa\AppData\Local\Temp\opencode\paka-t14-discovery` (detached at `9b0a885`, **read-only**) |
| Artifact root | `C:\Users\aissa\Desktop\Paka-feature-factory\wave1\T-14-polygon-star-discovery.md` |
| Paka checkout | Untouched by this task: no file in `C:\Users\aissa\Desktop\Paka` was created, edited or deleted. |

---

## 1. Method

Grep the symbol → read a ±40-line window → read tests by name (the AGENTS.md
protocol). No file over 250 lines was read end to end except
`shapeGeometry.ts` (182 lines) and `shapeTool.ts` (98 lines), which are the
whole of the shape machinery. Every line number below was read in the worktree
at `9b0a885`; `grep` is authoritative if they drift.

---

## 2. Existing capabilities (verified, not proposed)

### 2.1 A shape is an ordinary stroke — this is the single most important fact

A committed shape is **not a new kind of content**. It is a `StrokeRecord`
whose `xs`/`ys` hold the outline's points:

- `src/core/document/types.ts` L76–104 — `StrokeRecord` with `erase?` and
  `fill?: boolean`, plus four parallel sample arrays.
- `src/core/document/types.ts` L86–97 — the `fill` flag's own doc comment:
  *"A fill is still a stroke: same samples, same brush, same history entry,
  same place in the project file… the interior is rasterized from the outline
  every time the layer is rebuilt."*
- `src/core/engine/DrawingEngine.ts` L1118–1148 — `beginShape` creates the
  record with `createStrokeRecord(layerId, shapeBrush(this.brush), erases, fill)`.
- `src/core/engine/DrawingEngine.ts` L1158–1174 — `setShapeOutline` replaces
  `xs`/`ys` with the outline and pushes pressure `1`, time `0` for every point.
- `src/core/engine/DrawingEngine.ts` L1177–1189 — `finishShape` → `finishStroke`
  (one undo step); `cancelShape` → `cancelStroke` (nothing recorded).
- `src/core/engine/DrawingEngine.ts` L226 — `shapeBrush()`: a shape always uses
  the plain segment path, even with the stamp engine on (added by the G1 slice).

**Consequence for T-14: a polygon or a star needs no document-format change, no
new element kind and no new command type.** It is a different *outline* fed
into the existing pipeline. The file stores the points, not the "kind" — the
same is already true of a rectangle, so a saved polygon reopens as the same
pixels but is no longer "a polygon" (it cannot be re-edited as one).

### 2.2 The shape pipeline, end to end

| Stage | Location | What it does |
| --- | --- | --- |
| Pointer normalisation | `src/core/input/pointer.ts` L104–108 | `modifiers` = `shift`, `alt`, `ctrl`, `meta` from the DOM event; positions already in document space. |
| Tool interface | `src/core/tools/types.ts` L17–119, L121–138 | `Tool` (`onPointerDown/Move/Up/Cancel`, `reset`) drives the engine through `ToolContext`; `beginShape`/`setShapeOutline`/`finishShape`/`cancelShape` are the shape half of the context. |
| Tool implementations | `src/core/tools/shapeTool.ts` L27–98 | One class, `ShapeTool`, parameterised by `kind`. Keeps the anchor, recomputes the whole outline on every move (so Shift/Alt can change the shape mid-drag), previews in the stroke buffer, commits on release. |
| Geometry | `src/core/tools/shapeGeometry.ts` L20–182 | `ShapeKind = "line" \| "rectangle" \| "ellipse"`; `shapeOutline(kind, drag)`; `outlineExtent(points)`; the private `dragBox` (Shift/Alt handling), `lineOutline`, `rectangleOutline`, `ellipseOutline`. |
| Definitions | `src/core/tools/toolDefinitions.ts` L11–108 | One `ToolDefinition` per tool with `id`, `label`, `shortcut`, `description`, and `fillable?`. `TOOL_DEFINITIONS` (L84) is the rail order; `findToolByShortcut` (L97) is case-insensitive. |
| Registry | `src/core/tools/toolRegistry.ts` L23–41 | `new ShapeTool("line" \| "rectangle" \| "ellipse", …)` — the registry is where a new kind is bound to a definition. |
| Tool id | `src/types/tool.ts` L3–13 | A closed `ToolId` union; L31 documents `fillable` as "the geometry, not the gesture". |
| Rail | `src/components/toolbar/ToolRail.tsx` L21–32 | `TOOL_ICONS: Record<ToolId, ReactNode>` — **exhaustive**, so a new tool without an icon is a type error. |
| Icons | `src/components/icons.tsx` | Hand-written inline single-path SVGs on a shared 16 px viewBox (e.g. `IconRectangle` L98, `IconEllipse` L106). |
| Engine | `src/core/engine/DrawingEngine.ts` L439–442 | The `ToolContext` implementation; L431 `getBrush`. |
| Rasterization | `src/core/rendering/canvas2dStroke.ts` L151–207 | `rasterizeStroke`: L184–195 fills the closed outline with the **non-zero** rule when `stroke.fill === true` and `fromIndex === 0`, then traces the outline at full coverage. |

### 2.3 The modifier conventions already in force

| Modifier | Existing meaning | Source |
| --- | --- | --- |
| **Shift** | Constrain: a line snaps to 45°, a rectangle/ellipse to a **square** box (the larger side wins) | `shapeGeometry.ts` L89–95 (line), L113–117 (box) |
| **Alt** | Draw from the centre: the anchor is the shape's midpoint | `shapeGeometry.ts` L97–106 (line), L119–127 (box) |
| Ctrl / Meta | Not read by the shape tools at all | — |
| `PointerSample.modifiers` | `shift`, `alt`, `ctrl`, `meta` | `pointer.ts` L104–108 |

The keyboard handler ignores `Alt` (L141–143) and `Shift` (L160–162) before
the tool-shortcut lookup (L177), so a tool shortcut is a bare lowercase letter.

### 2.4 The degenerate-drag rule that already exists

`shapeTool.ts` L25 and L65–68: a shape whose `outlineExtent` (the bounding-box
diagonal, `shapeGeometry.ts` L62–77) is below `MIN_SHAPE_EXTENT = 0.5` document
pixels is **discarded** — no history entry, no pixels, no dirty flag. A bare
click therefore cannot leave a dot behind.

### 2.5 Fill and stroke settings

- `src/features/shapes/ShapeControls.tsx` L18 — the panel shows the **Fill
  shape** switch only when the active tool's definition has `fillable === true`.
  A new tool with `fillable: true` therefore gets the switch for free.
- `src/core/engine/DrawingEngine.ts` L128–134, L866–873 — `shapeFill` is
  **editor state**: not undoable, not dirtying, published in `EditorSnapshot`,
  read at press time so a committed shape keeps the flag it was drawn with.
- `src/core/engine/DrawingEngine.ts` L881–892 — `setFillTolerance` is the
  canonical pattern for a *numeric* editor option: clamp → no-op check →
  `commands.breakMerge()` → `publish()`.

### 2.6 Serialization

- `src/core/project/projectFormat.ts` L271–302 — `readStroke` reads the `fill`
  flag (L291) and only writes it when true (L301); the `erase` flag likewise.
- `src/core/project/projectFormat.ts` — `serializeElement` writes the whole
  brush object and the samples; **there is no field describing a shape's kind**,
  so nothing about a polygon/star needs to be added.
- `docs/PROJECT_FORMAT.md` §`elements[]`, §`brush`, §`Versioning` — the format
  is at **v9** after the G1 slice.

### 2.7 What the codebase does **not** have (the gap list)

1. No polygon, star, path or any other shape beyond line/rectangle/ellipse.
2. No per-shape numeric options (the sides/points/inner-radius/rotation of a
   polygon or star do not exist).
3. No rotation anywhere: the selection can move, nudge, duplicate and flip
   (`Ctrl+Shift+H`/`V`) but **cannot rotate** — so without a rotation option a
   rotated polygon is simply not reachable in the product.
4. No non-round dab or shape, no "spike"/"burst" tool, no irregular polygon.
5. No shape-kind metadata in the document (by design — see §2.1).
6. No angular snapping for any tool.

---

## 3. Proposed behaviour (the specification)

Everything in this section is **proposed**, not existing. It is written to fit
the patterns verified in §2.

### 3.1 The shape kinds

Two new `ShapeKind`s: `"polygon"` and `"star"`. Both are **closed polylines**,
exactly like the rectangle and the ellipse: the last point repeats the first,
so the closing edge is drawn and the polyline is a proper loop.

### 3.2 The drag model

Identical to the rectangle/ellipse: the drag defines an **axis-aligned box**
(`dragBox`, `shapeGeometry.ts` L111–137) and the shape is inscribed in it.

- **Shift** → the box becomes a **square** (the larger side wins) — the same
  rule the rectangle and the ellipse already use. A square box makes a
  *regular* polygon/star.
- **Alt** → the box is centred on the anchor (the anchor is the midpoint) — the
  same rule as the other shapes.
- **Degenerate drag** → the existing rule applies unchanged: an outline whose
  extent is below 0.5 document px is discarded (`shapeTool.ts` L65–68).

### 3.3 The polygon

A regular *n*-gon inscribed in the **ellipse** of the drag's box (the standard
rule: Photoshop, Procreate and Illustrator all inscribe the polygon in the
box's ellipse, which is why a polygon's own bounding box is slightly smaller
than the drag's box for n > 4).

- Vertices: `n` vertices plus the closing repeat → `n + 1` points.
- Vertex *k* (k = 0…n−1) is at the angle
  `-π/2 + 2πk/n` (measured from the +x axis, y down), i.e. **a vertex at the
  top** for the default rotation, at
  `(cx + rx·cos θ, cy + ry·sin θ)`.
- `rx`, `ry` are the box's half-extents; `cx`, `cy` its centre.
- The **side count** comes from the editor option `shapeSides`, clamped to
  **3…24** (24 sides is visually a circle; the sample count stays tiny).
- Default: **5** (a pentagon).

### 3.4 The star

A star with *p* points is the classic **2p-vertex outline**: an outer vertex
and an inner vertex alternating around the same centre. It is deliberately
**not** a pentagram (the five vertices connected in a skipping order): a
pentagram self-intersects, and the renderer fills a shape with the **non-zero**
rule (`canvas2dStroke.ts` L184–195), which would fill the pentagram's crossings
as one blob rather than as a star.

- Vertices: `2p` plus the closing repeat → `2p + 1` points.
- Outer vertex *k* at the angle `-π/2 + 2πk/p`, radius `r`; inner vertex *k* at
  the angle `-π/2 + 2π(k + 0.5)/p`, radius `r · innerRatio`.
- The **point count** reuses the same `shapeSides` option (the UI labels it
  "Points" for the star and "Sides" for the polygon), clamped to **3…24**.
- The **inner radius** is `innerRatio · r`, from the editor option
  `shapeInnerRatio`, clamped to **0.05…1** (a floor above zero keeps the
  outline simple, so the non-zero fill is correct and the shape never
  self-intersects). Default: **0.5**.

### 3.5 Rotation

Rotation is an **editor option** (`shapeRotation`, 0–360°, default 0), applied
about the box's centre, after the vertices are placed. The first vertex/point
then sits at `-π/2 + rotation`.

Why an option and not a fixed convention: the selection can move, nudge,
duplicate and flip but **cannot rotate** (§2.7 item 3), so a rotated polygon is
otherwise unreachable in the product. The option is one number in the same
editor-state pattern as `fillTolerance` (§2.5).

Because the rotation is about the centre, a rotated shape's own bounding box
can exceed the drag's box (a rotated square's does). That is expected: the
shape's bounds are derived from its samples, which is what the selection and
the frame use.

### 3.6 The options (editor state, not document state)

| Option | Range | Default | Used by | Meaning |
| --- | --- | --- | --- | --- |
| `shapeSides` | 3…24 (integer) | 5 | polygon (sides), star (points) | How many sides/points the next shape has. |
| `shapeInnerRatio` | 0.05…1 | 0.5 | star | The inner radius as a fraction of the outer radius. |
| `shapeRotation` | 0–360° (integer) | 0 | polygon, star | The rotation of the outline about the box's centre. |

All three are **editor state**: not undoable, not dirtying, published in
`EditorSnapshot`, and **not** stored on the stroke. Like `shapeFill`, they
describe the *next* shape; the committed shape stores only its points, so
changing an option never rewrites committed work. This is why **no format
change is needed**.

They are read **at press time**, so a shape keeps the values that were active
when the user pressed (the same rule `shapeFill` follows).

### 3.7 The UI

The **Fill shape** switch appears automatically for the new tools (it keys off
`fillable`, §2.5). The three new options appear in the same panel, shown only
while the polygon or the star tool is active:

- polygon active → **Sides** and **Rotation** sliders;
- star active → **Points**, **Inner radius** and **Rotation** sliders.

### 3.8 The degenerate and edge cases, decided

| Case | Decision | Why |
| --- | --- | --- |
| The drag never moves (a click) | **Discarded**, no history, no pixels | The existing rule (`shapeTool.ts` L65–68) applies unchanged. |
| The drag is smaller than 0.5 px | **Discarded** | Same rule. |
| A zero-height or zero-width box | **Committed** as a degenerate sliver | The rectangle and the ellipse behave the same way today; consistency beats a special case. |
| The side count below 3 | **Clamped to 3** | A polygon needs three sides. |
| The inner ratio at 0 | **Clamped to 0.05** | Keeps the star's outline simple, so the non-zero fill is correct. |
| A star with 3 points | Allowed (a triangle) | 3…24 is the same range as the polygon. |
| The rotation at 360° | Equivalent to 0° | Clamped/rounded to an integer. |
| The shape is filled (`Fill shape` on) | The interior is filled with the brush colour, the outline is still traced | The existing `fill` flag path; the non-zero rule fills the simple star outline correctly. |
| The brush is stamped | The shape keeps the plain segment path | `shapeBrush()` (`DrawingEngine.ts` L226) already forces it for every shape. |

---

## 4. Implementation boundary — the smallest implementation that fits

### 4.1 Files to change (the proposed scope)

| File | Change | Size |
| --- | --- | --- |
| `src/core/tools/shapeGeometry.ts` | Add `"polygon"` and `"star"` to `ShapeKind`; add `polygonOutline`/`starOutline`; extend `shapeOutline`'s switch | ~70 lines |
| `src/core/tools/toolDefinitions.ts` | Two `ToolDefinition`s (`fillable: true`) + the rail order | ~14 lines |
| `src/core/tools/toolRegistry.ts` | Two registry entries (`new ShapeTool("polygon", …)`) | 2 lines |
| `src/types/tool.ts` | Two members of the `ToolId` union | 2 lines |
| `src/components/icons.tsx` | `IconPolygon`, `IconStar` (hand-written 16 px paths, matching the existing style) | ~16 lines |
| `src/components/toolbar/ToolRail.tsx` | Two entries in the exhaustive `TOOL_ICONS` record | 2 lines |
| `src/core/tools/types.ts` | One `ToolContext` getter, `getShapeOptions()` | ~8 lines |
| `src/core/engine/DrawingEngine.ts` | The three editor-state fields, their setters, the snapshot entries, the `ToolContext` wiring | ~60 lines |
| `src/state/editorStore.ts` | Three `EditorActions` entries | ~6 lines |
| `src/features/shapes/ShapeControls.tsx` | The three sliders, shown for the polygon/star tools | ~45 lines |
| `src/test/shapeGeometry.test.ts` | The geometry tests (below) | ~90 lines |
| `src/test/drawingEngine.test.ts` | The engine tests (below) | ~60 lines |
| `src/test/brushSettings.test.ts` | The tool list and the shortcuts (L117–141) | ~8 lines |

**Roughly 400 lines, of which about 170 are tests.** No new module, no new
dependency, no format change, no new element kind, no new command.

### 4.2 Files that must NOT change

- `src/core/document/types.ts` (`StrokeRecord`, `LayerElement`) — the shape is
  already a stroke (§2.1).
- `src/core/commands/*` — one stroke is one `StrokeCommand` already.
- `src/core/project/projectFormat.ts` and `docs/PROJECT_FORMAT.md` — **no
  format change**: a polygon/star is stored as samples, exactly like a
  rectangle.
- `src/core/rendering/*` — the outline is an ordinary polyline; the existing
  segment path, the fill branch and the feather/texture passes apply unchanged.
- `src/core/brushes/strokeBuilder.ts` — shapes bypass it.
- `package.json`, `pnpm-lock.yaml`, `src-tauri/**` — nothing new is needed.

### 4.3 Why the options live in the engine, not in the tool

The tool instance is created once in the registry (`toolRegistry.ts` L23) and
owns no observable state. The UI needs to *display* the current value and the
tool needs to *read* it, so it has to be in the engine's editor state
(`EditorSnapshot` → `ToolContext`), exactly as `shapeFill` is. The alternative
— the tool holding the value and the UI reaching into the tool — would break
the "React reads a low-frequency snapshot and calls intent methods" rule.

### 4.4 The one shared-interface change

`ToolContext` (`src/core/tools/types.ts` L17) gains one getter, e.g.

```ts
/** The options the next polygon or star uses. Editor state, like `shapeFill`. */
getShapeOptions(): ShapeOptions;
```

where `ShapeOptions` is `{ sides: number; innerRatio: number; rotation: number }`.
This is the only cross-cutting interface change, and it is the one the other
Wave 1 lanes would have to be told about (§7).

---

## 5. Test plan

### 5.1 Unit tests — `src/test/shapeGeometry.test.ts` (pure, no canvas)

| # | Test | Assertion |
| --- | --- | --- |
| G-1 | The polygon's vertex count | `shapeOutline("polygon", drag)` with `sides: 5` returns **6** points (5 + the closing repeat) and `points[0] === points[5]`. |
| G-2 | The polygon's first vertex is at the top | with the default rotation, `points[0].y === box.minY` and `points[0].x === centre.x`. |
| G-3 | The vertices lie on the box's ellipse | for every vertex, `((x−cx)/rx)² + ((y−cy)/ry)² ≈ 1`. |
| G-4 | Shift makes the box square | a 100×40 drag with `shift` yields a 100×100 box, and the polygon is regular (all vertices equidistant from the centre). |
| G-5 | Alt centres the box on the anchor | the outline's centre equals the anchor. |
| G-6 | The sides are clamped | `sides: 1` → 3 vertices + repeat; `sides: 99` → 24 vertices + repeat. |
| G-7 | The star's vertex count | `points: 5` → **11** points (5 outer + 5 inner + the closing repeat). |
| G-8 | The inner radius is the ratio of the outer | every inner vertex's distance from the centre is `innerRatio ×` the outer vertices' distance. |
| G-9 | The star's angles alternate | the angle step between consecutive vertices is `π/p`. |
| G-10 | The star never self-intersects at the smallest inner ratio | with `innerRatio: 0.05`, the outline is still a simple loop (the cross-product sign of consecutive edges never flips). |
| G-11 | Rotation | with `rotation: 45°`, every vertex's angle is the unrotated angle + 45°, and the centre is unchanged. |
| G-12 | The degenerate drag | a zero-length drag gives `outlineExtent === 0` (so `ShapeTool` discards it). |
| G-13 | A zero-height box | the polygon's points all share one y (a sliver, committed like a zero-height rectangle). |
| G-14 | Determinism | the same drag and options give the identical point list twice. |

### 5.2 Engine tests — `src/test/drawingEngine.test.ts`

| # | Test | Assertion |
| --- | --- | --- |
| E-1 | The polygon commits as one stroke | the layer holds one stroke; `history.depth === 1`; the stroke's `xs` equal the outline's points. |
| E-2 | The shape is fillable | with `shapeFill` on, the committed stroke has `fill === true`; with it off, it does not. |
| E-3 | The options are editor state | changing `shapeSides` produces no history entry and no dirty flag. |
| E-4 | The options are read at press time | a stroke started with `sides: 6` keeps 6-gon geometry even after the option changes mid-drag. |
| E-5 | A degenerate drag commits nothing | `history.depth === 0`, the layer is empty, the file is not dirty. |
| E-6 | A shape keeps the segment path with a stamped brush | the committed stroke's `brush.stamp === false` (the `shapeBrush` rule). |
| E-7 | The polygon is selectable and movable | a marquee over it selects one stroke; the move is one undo step (the existing selection machinery — a shape is a stroke). |

### 5.3 Existing tests that must stay green

`src/test/shapeGeometry.test.ts` (the line/rectangle/ellipse blocks),
`src/test/drawingEngine.test.ts` ("DrawingEngine shape tools"),
`src/test/brushSettings.test.ts` ("tool definitions" — the exact tool list at
L119–130 **must** be extended), `src/test/projectFormat.test.ts` (unchanged:
no format change), `src/test/canvas2dStroke.test.ts` (the `fill` branch — the
polygon's fill uses the same path).

### 5.4 Visual-regression scenes (T-01's corpus, `tests/visual/`)

The T-01 handoff states that T-14 "adds shape scenes". Proposed scenes, in the
harness's schema (all outside `src/`, so the unit suite stays untouched):

1. `polygon-5-sides.json` — a 5-gon outline, unfilled.
2. `polygon-filled.json` — a 6-gon with the fill on.
3. `star-5-points.json` — a 5-point star, unfilled.
4. `star-inner-0-4.json` — the same star with a different inner ratio.
5. `polygon-rotated-45.json` — the rotation option.

Each scene must be geometry-only (no text, per the T-01 rules) and must be
generated on the documented platform, since the goldens are platform-sensitive.

### 5.5 Manual checks (the React layer has no automated tests)

1. The rail shows the two new tools; `P` and `S` select them.
2. The sliders appear for the polygon and the star, and the labels change
   ("Sides" ↔ "Points").
3. The Fill shape switch appears for both and fills the interior correctly
   (the star's interior is filled, not a blob).
4. Shift squares the drag, Alt draws from the centre, a click draws nothing.
5. One undo removes the whole shape; redo restores it.
6. Save, reopen and export agree with the display.

---

## 6. Acceptance criteria

| ID | Criterion | How it is checked |
| --- | --- | --- |
| AC-T14-1 | The polygon is a regular *n*-gon inscribed in the drag's box, with a vertex at the top and a closing repeat. | G-1, G-2, G-3 |
| AC-T14-2 | The star is the 2*p*-vertex outline (not a pentagram), with the inner radius at `innerRatio ×` the outer. | G-7, G-8, G-9 |
| AC-T14-3 | The star's outline is simple, so the non-zero fill fills the shape rather than a blob. | G-10, plus the filled-shape scene |
| AC-T14-4 | The side/point count and the inner ratio are clamped to the documented ranges, and the options are read at press time. | G-6, E-4 |
| AC-T14-5 | Rotation is applied about the box's centre and defaults to 0. | G-11 |
| AC-T14-6 | Shift squares the box and Alt centres it, exactly as for the rectangle and the ellipse. | G-4, G-5, manual |
| AC-T14-7 | A degenerate drag (a click, or an extent below 0.5 px) commits nothing: no history, no pixels, no dirty flag. | G-12, E-5 |
| AC-T14-8 | A polygon/star is one ordinary stroke: one undo step, the same history entry as any other stroke. | E-1 |
| AC-T14-9 | The shape is fillable through the existing **Fill shape** switch, and the committed record carries the flag it was drawn with. | E-2, manual |
| AC-T14-10 | The document format is **unchanged**: the shape is stored as samples, an old file opens unchanged, and a new file opens in an old build unchanged (the samples are samples). | `git diff` shows no change in `projectFormat.ts` / `PROJECT_FORMAT.md`; the existing format suite stays green |
| AC-T14-11 | The options are editor state: no history step, no dirty flag, and changing them never rewrites a committed shape. | E-3, E-4 |
| AC-T14-12 | A shape keeps the plain segment path even when the brush is stamped. | E-6 |
| AC-T14-13 | The existing line/rectangle/ellipse behaviour, the tool list test and every other suite stay green. | §5.3 |
| AC-T14-14 | The UI exposes real controls only: the sides/points, inner-radius and rotation sliders are present for the new tools and absent for the others. | manual |
| AC-T14-15 | The two new tools have distinct, unambiguous icons and free single-key shortcuts (`P`, `S`). | The icon map compiles (exhaustive `Record<ToolId, ReactNode>`); the shortcut test |
| AC-T14-16 | The geometry is deterministic: the same drag and options always produce the same points. | G-14 |

---

## 7. Risks

| # | Risk | Severity | Mitigation |
| --- | --- | --- | --- |
| R-1 | **Shared-file contention.** `DrawingEngine.ts`, `src/core/tools/types.ts` (`ToolContext`) and `src/state/editorStore.ts` are the same files the other Wave 1 lanes (T-10's colour wheel, T-06's settings) will want. | High | The file-ownership contract from the T-01 handoff: this lane owns the engine's shape options and the `ToolContext` getter; the other lanes must not touch them, or the slices are serialised. |
| R-2 | **A settings store lands under T-06** and the shape options would belong there rather than in the engine. | Medium | Decide before implementing: if T-06 introduces a persisted settings store, the three options belong in it (and they would then *persist*, which is a product decision — `shapeFill` does not persist). |
| R-3 | **The tool-list test is exact** (`brushSettings.test.ts` L119–130): adding two tools breaks it until it is updated. | Low | Update it in the same slice; it is a one-line-per-tool change. |
| R-4 | **The star's fill** relies on the non-zero rule being applied to a simple polygon. A future change to the fill rule (or a self-intersecting "spiky" variant) would break it. | Medium | AC-T14-3 pins the simple-outline property with a test; the inner ratio's 0.05 floor is what guarantees it. |
| R-5 | **The rotation grows the shape's bounding box** beyond the drag's box, which can surprise a user and can push a shape partly outside the paper. | Low | Document it; the existing rectangle/ellipse have the same "the drag is a box, not the shape" property. |
| R-6 | **A zero-height drag commits a sliver** (consistent with the rectangle, but ugly). | Low | Deliberate: consistency with the existing shapes; the extent rule only catches sub-0.5 px drags. |
| R-7 | **The goldens are platform-sensitive** (T-01's R-2): a new scene's golden is only valid on the generating platform. | Low | Follow T-01's rules: no text, a fixed device scale factor, and the generating platform recorded in the scene README. |
| R-8 | **The visual-regression corpus is a shared file** (`tests/visual/scenes/`): the other lanes add scenes there too. | Medium | Scene files are per-scene and additive; the runner is untouched (T-01's AC-5 already forbids reaching into the renderer). |
| R-9 | **Scope creep into a path/polyline tool** (a free-form point editor) — a much larger feature with a format question of its own. | Medium | The out-of-scope list in §9 holds the line; a path tool is a separate task. |
| R-10 | **Keyboard shortcut collisions** with a future lane that wants `P` or `S`. | Low | Both letters are free as *bare* keys today: the tool shortcuts are b, e, m, l, r, o, f, g, i, h (`toolDefinitions.ts`), and the other bare keys are escape, delete/backspace, the arrows, `[`, `]`, `0`, `1`, `=`, `-` (`useKeyboardShortcuts.ts` L158–188). `Ctrl+S` is Save and `Ctrl+P` is unbound, but the modifier block (L66–139) returns before the tool lookup, so a bare `S` never collides with Save. The tool list test pins the mapping. |

---

## 8. Conflicts with other active work

Observed at the time of writing (`git worktree list`):

| Workstream | Worktree / branch | Lane | Interaction with T-14 |
| --- | --- | --- | --- |
| **T-01** visual-regression harness | `.../worktrees/t01-visual-regression` (`feat/visual-regression-harness`, committed `c659079`, merged into `feat/stamp-brush-engine` as `9b0a885`) | Verification | **T-14 adds shape scenes** to the corpus (§5.4). The harness lives entirely outside `src/`, so no unit-test coupling. The scene files are additive. |
| **T-10** HSV colour wheel | `.../worktrees/t10-hsv-color-wheel` (`feat/t10-hsv-color-wheel`) | UI | Toolbar/control-lane overlap: both touch the toolbar area. If T-10 also changes `DrawingEngine.ts` (a colour action) or `editorStore.ts`, the two slices must be serialised or the files split. |
| **T-11** composition guides | `.../worktrees/t11-guides-discovery` (detached) | UI | Same lane. Discovery only at the time of writing; a guide overlay would touch the renderer's overlay path, which T-14 does not. |
| **T-13** contrast / ΔE | `.../worktrees/t13-contrast-dee` (detached) | UI | Same lane. Colour maths; no file overlap expected beyond a shared colour utility. |
| **T-06** settings and autosave | `.../worktrees/t06-settings-autosave` (`chore/t06-discovery`) | Native | **The real decision point**: if T-06 lands a persisted settings store, T-14's three options should live there (and would then persist — a product decision, see R-2). Otherwise they stay in the engine's editor state, like `shapeFill`. |
| **G1** stamp engine | merged into `feat/stamp-brush-engine` (`9b2aceb`) | Rendering | Already accounted for: `shapeBrush()` forces the segment path for every shape, so a polygon/star is unaffected by the stamp settings. |
| Release readiness | `Paka-release-readiness` (`chore/release-readiness`) | Docs/icon | Adds the app icon and the third-party notices; the new tool icons are hand-written SVGs in `src/components/icons.tsx` and do not touch the app icon. |

**Files this slice would own** (proposed, for the coordinator to ratify):
`src/core/tools/shapeGeometry.ts`, `src/core/tools/toolDefinitions.ts`,
`src/core/tools/toolRegistry.ts`, `src/core/tools/types.ts`,
`src/types/tool.ts`, `src/components/icons.tsx`,
`src/components/toolbar/ToolRail.tsx`, `src/features/shapes/ShapeControls.tsx`,
`src/state/editorStore.ts`, `src/test/shapeGeometry.test.ts`.

**Files it would need but must coordinate over**:
`src/core/engine/DrawingEngine.ts` (the options + the `ToolContext` wiring),
`src/test/drawingEngine.test.ts`, `src/test/brushSettings.test.ts`,
`tests/visual/scenes/*` (additive).

**Files it would not touch at all**: the document model, the commands, the
renderer, the project format, the package manifests, the Rust shell.

---

## 9. Out of scope for T-14 (explicitly)

- A free-form path/polyline tool with point editing (a different task, with
  its own format question).
- Irregular polygons, spirals, "burst" and "spike" tools.
- Per-vertex handles, dragging individual points after the shape is committed.
- Shape groups, shape layers, or any new element kind.
- A rotation *gesture* (dragging to rotate) — the rotation option covers the
  need without a new gesture.
- Persisting the shape options across sessions (that is T-06's settings store
  decision, R-2).
- Any change to the document format.

---

## 10. Open questions for the coordinator

1. **Where do the three options live?** The engine's editor state (like
   `shapeFill`, not persisted) or T-06's settings store (persisted)? The answer
   changes three files and the product behaviour.
2. **Is the rotation option in scope for T-14, or deferred?** Without it a
   rotated polygon is unreachable (the selection cannot rotate); with it, the
   slice grows by one field, one action and one slider.
3. **Should the polygon be inscribed in the box's ellipse (the Photoshop rule)
   or scaled to fill the box exactly?** The first is the industry standard and
   the second makes the shape match the drag exactly.
4. **Shortcut letters**: `P` (polygon) and `S` (star) are free as bare keys
   today; does any other lane want them? (`Ctrl+S` is Save and must stay so.)
5. **File ownership**: does this lane own `DrawingEngine.ts`, `ToolContext` and
   `editorStore.ts` outright, or must the slices be serialised around them?
6. **Should the shape options be per-tool** (the polygon remembers 5 sides, the
   star remembers 7 points) or one shared pair of numbers? The proposal shares
   them (one "Sides"/"Points" slider whose label follows the active tool).

---

## 11. Status

- **Status:** discovery complete; **not implemented, not audited**.
- **Files changed in Paka:** none.
- **Files written:** this artifact only.
- **Commands run:** `git worktree add --detach 9b0a885` (the isolated worktree),
  `git worktree list`, `git log`/`git diff --stat` (the base comparison). **No
  test, typecheck or build was run for this task** — nothing was implemented,
  and the repository's suite is unaffected by a read-only inspection.
- **Known limitations:** the geometry rules in §3 are a *proposal*; the sample
  counts, the fill behaviour under the non-zero rule and the visual result of a
  star are argued from the code and the existing ellipse/rectangle behaviour but
  have not been rendered. The "no format change" conclusion depends on §2.1
  holding — it is a code fact today (a shape is a `StrokeRecord`), not a
  promise about future shapes.
- **Next one action:** the coordinator answers §10 and ratifies the file
  ownership in §8 before an implementer opens the slice.
