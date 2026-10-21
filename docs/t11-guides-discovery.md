# T-11 — Guides: technical discovery and implementation-ready specification

**Status:** discovery and specification only. **No production code, test, package
manifest, lockfile or shared file was modified.** This document is the only file
written, in an isolated worktree.

**Feature:** T-11 "guides" — the first item of Phase 6 in `docs/ROADMAP.md`
L184 (*"Guides, grids, snapping"*). The roadmap groups the three; this document
covers **guides only** — grids and snapping-to-guide are separate slices and are
called out in §5.3.

**Baseline inspected:** the worktree checkout of `main` at `47e309f`
(*"docs: make docs/g1/ the canonical provenance record"*), which includes the
merged stamp-engine slice. Every claim below is cited to the file and line it
came from; nothing is inferred from prose.

**How to read this:** §1 is what exists today (evidence). §2 is the proposed
design. §3–§7 are the acceptance criteria, tests, scope, risks, dependencies and
the questions that need a **product** answer — those are flagged, not guessed.

---

## 1. What exists today (evidence)

### 1.1 There is no guide, ruler, grid or snapping infrastructure

A search across the repository for `guide|ruler|snap` finds **no implementation**
— only prose:

| Hit | Where | What it says |
| --- | --- | --- |
| "no guides/grids" | `docs/SESSION-BRIEF.md` L404 (limitations) | Confirms the feature does not exist |
| "Guides, grids, snapping" | `docs/ROADMAP.md` L184 | The unchecked Phase 6 item |
| "45-degree snapping" | `docs/ARCHITECTURE.md` L1143 | The **shape tool's** `Shift` constraint (`shapeGeometry`), not guide snapping |

So T-11 is greenfield. What follows is the infrastructure it must fit into.

### 1.2 The coordinate system and the viewport transform

`src/core/rendering/viewport.ts` L7–9 states the convention:

> *"a document point maps to canvas-local CSS pixels via `screen = doc * zoom +
> offset`. Screen coordinates are relative to the canvas element's top-left
> corner, never to the window."*

- `screenToDoc` (L25–30) and `docToScreen` (L32–37) are the two directions;
  `zoomToAt` (L43–56) pins the document point under the cursor while zooming.
- `MIN_ZOOM = 0.02`, `MAX_ZOOM = 64` (L16–17) — the zoom range a guide's screen
  chrome must survive.
- `src/core/input/pointer.ts` L96–129: every normalized sample carries **both**
  spaces — `docX/docY` (document px) and `screenX/screenY` (canvas-local CSS px)
  — plus `kind` (`mouse`/`pen`/`touch`), `pressure`, `hasPressure` and
  `modifiers` (`shift`/`alt`/`ctrl`/`meta`).

**Consequence for guides:** a guide can be stored in document space and hit-tested
in either space; the sample already carries both, so no extra transform is needed
at the gesture layer.

### 1.3 The display path — and the overlay precedent that matters most

`src/core/rendering/Canvas2DRenderer.ts`:

- `render()` L474–487 sets the canvas transform to
  `scale = devicePixelRatio * viewport.zoom` with the viewport offset, then
  calls `paintDocument(ctx, preview)` and `paintSelection(ctx, scale)`. **The
  canvas context is in document coordinates while painting** — a line drawn at
  `ctx.moveTo(guide.position, 0)` lands on the right device pixel at any zoom.
- `paintSelection` (L506–549) is the model for a guide overlay:
  - constant **screen** width via `ctx.lineWidth = SELECTION_TRACE_WIDTH / scale`
    (L515) and the dash idiom `SELECTION_MARQUEE_DASH[0] / scale` (L543);
  - `SELECTION_COLOR` (L64), `SELECTION_TRACE_WIDTH = 1.5` (L68),
    `SELECTION_MARQUEE_DASH = [6, 4]` (L69);
  - and the rule that decides everything else (L502–504):

    > *"The trace is not part of the document: it is drawn on the display canvas
    > only, so an export of a document with a selection is byte-identical to one
    > without."*

- `src/core/rendering/types.ts` L26–38 says the same about the selection
  contract: *"UI overlay, not document content - it never appears in an export,
  and the renderer owns no selection state of its own."*

**Consequence for guides:** the renderer needs **no new interface method**. The
guides live on the document (§1.4), and the engine already pushes the whole
document to the renderer on every change — `applyDocumentState` calls
`renderer.setDocument(next)` (`DrawingEngine.ts` L2056) and then
`requestRender()` (L2067). A renderer that reads `doc.guides` during `render()`
gets them for free, and a guide change repaints without a new plumbing path.

### 1.4 The document model, and the command machinery that makes guides undoable

`src/core/document/types.ts` L34–46:

```ts
export interface DrawingDocument {
  readonly id: string; readonly name: string;
  readonly width: number; readonly height: number;
  readonly background: string;
  readonly layers: readonly Layer[];
  readonly activeLayerId: LayerId | null;
}
```

The file's header (L3–8) states the invariant that decides where guides go:

> *"A document is pure metadata: dimensions, background and an ordered list of
> layers. Pixel data is not stored here."*

A guide is metadata — it has no pixels — so it belongs on `DrawingDocument`, not
on a `Layer` and not in the layer's `LayerElement[]` list (which is the painting
order of *painted* content: `StrokeRecord | FillPatchRecord | GradientRecord`,
`document/types.ts` L176).

**Undo/redo comes free.** `src/core/commands/documentCommand.ts`:

- `createDocumentCommand(spec, host)` (L106–151) stores the **whole document
  before and after** the change (L44–47) and reverses by swapping them — the
  module's header (L5–9) says exactly that: *"A command stores the two document
  states around the change … keeping two of them costs a couple of small
  objects - never a bitmap snapshot."*
- `mergeKey` (L52–57, L132–137) coalesces metadata-only changes — the idiom a
  guide *drag* should use, so a drag is one undo step (the same pattern the
  layer-opacity slider uses).
- `preserveActiveLayer` (L58–67) keeps undo from moving the user off the layer
  they are looking at.

So: **a guide add, move or delete is an ordinary document command** — no new
command type, no new history concept.

### 1.5 The input pipeline and the tool model

- `src/core/input/canvasInputBinder.ts` L8–14: pointer capture keeps a gesture
  alive off-canvas; **one pointer is tracked at a time** (`activePointerId`,
  L47) so a second finger or device cannot interleave; `pointercancel` and a
  lost capture end the gesture; coalesced move events are replayed.
- `src/core/engine/DrawingEngine.ts` L2117–2152 is the router: a middle-button
  drag always pans (L2122–2126), otherwise the active tool gets every sample.
- `src/core/tools/types.ts` L121–138: a tool implements `onPointerDown`,
  `onPointerMove`, `onPointerUp`, `onPointerCancel` and `reset`, and owns
  nothing but gesture bookkeeping (L121–129).
- `src/core/tools/selectTool.ts` L31–75 is the closest precedent for a
  multi-gesture tool: **one tool, two gestures, chosen by where the press
  lands** — inside the selection → translate; anywhere else → marquee. Its
  header (L9–13) sets the rule this slice must respect: *"The tool owns only
  the gesture bookkeeping … Everything else … belongs to the engine."*
- Tool registration is cheap and mechanical: `ToolId` (`src/types/tool.ts`
  L3–13), the definition + rail order (`src/core/tools/toolDefinitions.ts`
  L83–95), the instance (`src/core/tools/toolRegistry.ts` L23–41), and the
  single-key shortcut lookup (`findToolByShortcut`, `toolDefinitions.ts`
  L97–100).

### 1.6 The project format envelope

`src/core/project/projectFormat.ts`:

- `SerializedProject.document` (L168–181) is the envelope a guide would join:
  `id, name, width, height, background, activeLayerId`.
- The writer (L417–423) emits that object field by field.
- The reader builds the in-memory document at L656–666 and collects
  **non-fatal repairs** in a `warnings` list (L197, returned at L668) — the
  pattern for reading an optional or slightly-broken field.

**Version policy** (the repo's own rule, `docs/SESSION-BRIEF.md` §6): *"a bump is
required when an older reader would render a different picture, not for
convenience."* A guide that is **display-only** (never exported) satisfies an old
reader: it ignores the field and draws the same picture — the same situation as
`stabilizer`, which was added additively within v6. A guide that is **exported**
does not, and would force a version bump. See §8, decision **P1**.

---

## 2. Proposed design

### 2.1 Coordinates: guides live in **document space**

| Option | Verdict |
| --- | --- |
| **Document coordinates** (recommended) | The guide is part of the document, is stored with it, and must mean the same thing at every zoom and on every machine. The display transform already maps document → device (`Canvas2DRenderer.ts` L474–483), so zoom and pan need **no special handling**. |
| Viewport/screen coordinates | A guide would move when the user pans — wrong for a stored artifact, and it would have to be re-anchored on every viewport change. Rejected. |
| Both | Needed only for the *chrome*: the line width, the handle and the label are screen-space constants, exactly as `SELECTION_TRACE_WIDTH / scale` already does (L515). The rule: **the guide's position is document space; its appearance is screen space.** |

### 2.2 The data model

```ts
// src/core/document/types.ts
export type GuideAxis = "vertical" | "horizontal";

export interface Guide {
  readonly id: string;
  /** A vertical guide sits at `position.x`; a horizontal one at `position.y`. */
  readonly axis: GuideAxis;
  /** Position along the guide's axis, in document pixels. */
  readonly position: number;
}
```

and on the document: `readonly guides: readonly Guide[]`.

Why this shape:

- **Axis-aligned only.** Every raster app's guides are axis-aligned; a free
  (diagonal) guide would need its own hit-test and its own snapping story. A
  diagonal guide is flagged as a **product** decision (§8, **P2**) and is out of
  scope for the smallest slice.
- **A single `position` number, not a point.** A vertical guide's y is
  meaningless (it spans the page), so storing a point invites two sources of
  truth. The axis + one number is the whole geometry.
- **`id` on every guide** — the same reason strokes and layers carry ids: the
  command stack, the selection and the renderer all need stable identity.
- **Plain primitives** — so the shallow copies in `createStrokeRecord`
  (`strokeBuilder.ts` L55) and the document-command snapshots stay cheap
  (`documentCommand.ts` L5–9).

**Placement in the model:** `DrawingDocument.guides` — document-level, next to
`background` and `activeLayerId`. Not a layer property: guides are not layer
content, they are not painted into a layer surface, and they survive a layer
delete.

### 2.3 Interaction rules

With **no rulers** in the app (§1.1), the classic "drag out of the ruler"
gesture is unavailable. The proposed rules use the app's existing tool model.

**A dedicated "Guides" tool** (a new `ToolId`, `toolDefinitions.ts` L83–95, one
registry entry) is the trigger. Within that tool, the gesture is chosen by where
the press lands — the `SelectTool` pattern (`selectTool.ts` L31–42):

| Gesture | Rule | Result |
| --- | --- | --- |
| **Press on empty canvas** | Drag defines the guide. The axis is chosen by the dominant direction of the drag: `\|dx\| > \|dy\|` → vertical, else horizontal. The guide's position is the **press** coordinate along that axis (not the release), so the guide does not follow the pointer during the drag. | One new guide at the press point. |
| **Press on an existing guide** (within the grab radius) | Drag moves that guide along its axis. The position follows the pointer. | The guide moves; the drag is one undo step. |
| **Click (press + release with no movement) on a guide** | Selects it (the tool's own selection, one guide at a time). | The guide is highlighted; `Delete` removes it. |
| **Click on empty canvas** | Clears the tool's guide selection. | — |
| **`Esc` during a drag** | Cancels the gesture; the guide returns to its previous position (or the new guide disappears). | The live-preview rule the rest of the app already follows (`cancelStroke`, `Canvas2DRenderer.ts` L432–445). |

**Fixed rules for every case:**

1. **Grab radius** — a press grabs a guide within a **screen-space** radius
   (recommended: 8 CSS px), i.e. `8 / zoom` document px. A fixed *document*
   radius would make the guide ungrabbable when zoomed out and impossible to
   miss when zoomed in.
2. **The axis of a moved guide never changes.** Dragging a vertical guide moves
   it in x only; the axis is fixed at creation. Changing the axis would be a
   different gesture (delete + create) and would silently invalidate a
   user's mental model.
3. **One guide per axis position is allowed** — two vertical guides at the same
   x are legal but pointless. Recommend: **reject a duplicate** (the drag does
   nothing) rather than stack them. *(Product decision **P3** — "duplicates are
   allowed" is a one-line change.)*
4. **Guides may sit outside the paper.** A guide at `x = -50` is legitimate
   (it marks a position off-canvas) and is drawn across the whole viewport.
   Clamping to the document would lose the user's intent. *(Product decision
   **P4**: clamp to the document, or allow outside.)*
5. **The guide position is snapped to whole document pixels.** A guide is a
   registration mark; a fractional position would draw a soft, blurry edge at
   some zooms. Rounding to an integer document pixel keeps the line crisp at
   100 % and stable across zoom levels.
6. **A guide drag never creates history until it ends.** The live drag updates
   the preview only; the release commits **one** undo step (the `mergeKey`
   idiom, `documentCommand.ts` L52–57). A drag that ends where it started
   commits nothing.

### 2.4 Display

- Painted in `render()` **after** `paintDocument` and **before**
  `paintSelection` (`Canvas2DRenderer.ts` L485–487): guides sit above the
  artwork ✓, and the selection marquee stays on top of them ✓.
- **Not** painted into `composeDocumentImage()` (L551+) → the PNG export is
  unaffected ✓, exactly like the selection (L502–504).
- A guide is drawn as a **full-viewport line** (not clipped to the paper): a
  vertical guide at `x = 1200` runs the whole height of the canvas, so it is
  visible while the paper is panned away.
- **Appearance** (screen-space constants, divided by `scale` like the selection):
  | Element | Proposed | Note |
  | --- | --- | --- |
  | Line width | `1 / scale` (one device pixel) | the same hairline idiom as the document border (`Canvas2DRenderer.ts` L490) |
  | Colour | a new constant, e.g. `GUIDE_COLOR = "#e0567f"` | the selection uses `#2f7bff` (L64); the guide needs a *different* hue so the two overlays are distinguishable |
  | Dashed? | solid, 1 px | a dash pattern costs a second constant and reads as "temporary" |
  | Handle | a small square/tick at the document edge (top for horizontal, left for vertical) | **optional**; a hit-test can work on the line itself |
  | Label (the position in px) | **not in S1** | text rendering at a constant screen size needs a font metric; it is a separate slice (§8, **P5**) |
- **The selected guide** is drawn with the selection colour, or with a thicker
  line — the cheapest signal is the accent colour ✓.

### 2.5 Persistence

- The project format's `document` envelope gains `guides`
  (`projectFormat.ts` L168–181, write at L417–423, read at L656–666).
- **No version bump** if the guides are display-only: an older reader ignores
  the field and draws the same picture (the `stabilizer`-within-v6 precedent,
  `docs/SESSION-BRIEF.md` §6). A v9 file with guides opens in a v9 build and
  renders identically; a v8 build ignores the field and still renders the same
  artwork ✓.
- **Reading is forgiving, writing is strict** — the repo's existing pattern
  (`readBrush` for brushes, the `warnings` list for repairs,
  `projectFormat.ts` L197/L668):
  - a missing `guides` field → `[]` (old files) ✓;
  - a guide with a non-finite position, an unknown axis, or a missing id → **a
    non-fatal repair** (drop that guide, add a warning) rather than refusing
    the whole file. A hostile or hand-edited file must not become unopenable
    because of a decorative overlay.
  - a guide count ceiling (e.g. 10 000) → refuse beyond it, like
    `MAX_PROJECT_SAMPLES` / `MAX_PROJECT_FILL_PIXELS`
    (`projectFormat.ts` L109/L111) — a guide is small, but the array is
    unbounded input.
- The guide **ids** must be unique in a file; a duplicate id is repaired by
  regenerating it (the `readId`/`reserveId` machinery,
  `projectFormat.ts` L672–678).

### 2.6 Interaction conflicts

| Conflict | Finding | Resolution |
| --- | --- | --- |
| **Drawing while the guides tool is active** | The router gives every sample to the active tool (`DrawingEngine.ts` L2127/2136). A dedicated tool means the guides tool *replaces* drawing while selected — the user switches back to the brush. | Accepted (the same trade as the select/pan tools). |
| **Middle-button pan** | The router handles `button === 1` before the tool (L2122–2126) → panning works in any tool, including a guides tool ✓. | No conflict. |
| **Wheel zoom / pan** | `handleWheel` (L2154+) is tool-independent ✓. | No conflict. |
| **Pen input** | A pen press reports `button === 0` and `kind === "pen"` (`pointer.ts` L66–77). The guides tool ignores pressure ✓. A pen's `pointerdown` can also arrive with `buttons` already set — the binder tracks one pointer at a time (L47) ✓. | The guides tool works with pen, touch and mouse identically. |
| **Touch** | One pointer at a time (`canvasInputBinder.ts` L47) → a second finger cannot create a second guide mid-gesture ✓. | No conflict. |
| **The select tool's marquee** | The select tool's gestures are independent of the guides ✓ — but if a user drags a marquee over a guide, the guide is not selected (guides have their own selection). | Documented: guide selection belongs to the guides tool only. |
| **`Delete` / `Esc` shortcuts** | `useKeyboardShortcuts` currently binds `Delete` to "remove the selected strokes" and `Esc` to "clear/cancel". With the guides tool active, `Delete` should remove the selected **guide** instead. | The keyboard handler needs a tool-aware branch — or, simpler, the guides tool handles `Delete` through the existing shortcut map only when its selection is non-empty. **Check `useKeyboardShortcuts.ts` before implementing** (not read in this pass — see §7). |
| **Undo during a guide drag** | Undo is refused while a gesture is active (`isGestureActive`, `DrawingEngine.ts` L988–994) → a guide drag must register as an active gesture, or undo could land mid-drag. | The guides tool's gesture must set the engine's gesture flag (the same path the selection gesture uses). |
| **A layer change during a guide drag** | Layer changes are refused during a gesture (`refuseLayerChangeDuringGesture`, L1027–1036). A guide drag is a *document* change, not a layer change → unaffected ✓. | No conflict. |
| **The document boundary line** | Drawn last in `render()` (L490–492) at one device pixel. | Draw the guides **before** the border so the border stays crisp on top. |

---

## 3. Acceptance criteria

Machine-checkable, in the repo's own style ("what to assert and the expected
value", per the analyst matrix in `docs/g1/feature-analysis.md` §12).

### 3.1 Model and geometry

| ID | Criterion |
| --- | --- |
| **G-01** | A guide is stored as `{ id, axis, position }` with `position` a **finite number in document pixels**; `DrawingDocument.guides` is a readonly array, empty by default. |
| **G-02** | `position` is an **integer** document pixel (a drag rounds to the nearest integer) — asserted by dragging to `120.4` and reading `120`. |
| **G-03** | A vertical guide's position is its **x**; a horizontal guide's is its **y**. The other axis is not stored, so there is no second source of truth. |
| **G-04** | Adding, moving and removing a guide each produce **exactly one** history entry; a drag that ends where it started produces **none**. |
| **G-05** | Undo restores the previous guide set exactly (same ids, axes and positions); redo re-applies it. |

### 3.2 Coordinate transforms, zoom and pan

| ID | Criterion |
| --- | --- |
| **G-06** | A vertical guide at document `x = 400` is drawn at **device** `x = 400 · zoom · dpr`; a horizontal one likewise in y. Asserted at zoom 0.25, 1, 4 and 64 with dpr 1 and 2. |
| **G-07** | Panning by `(dx, dy)` CSS px moves the guide's **screen** position by exactly `(dx, dy)` and its **document** position by `0`. |
| **G-08** | Zooming at a cursor point keeps the guide's document position unchanged and its screen position consistent with `docToScreen`. |
| **G-09** | The guide's **line width is constant on screen** at every zoom (one device pixel), i.e. `lineWidth = 1 / scale` — the `SELECTION_TRACE_WIDTH / scale` idiom (`Canvas2DRenderer.ts` L515). |
| **G-10** | A guide outside the paper (`x = -50`, or beyond the right edge) is still drawn, across the viewport. |
| **G-11** | The guide's **hit-test radius is screen-space**: a press within 8 CSS px of the guide grabs it at any zoom, and a press 20 CSS px away does not. |

### 3.3 Rendering and export

| ID | Criterion |
| --- | --- |
| **G-12** | The guides are drawn **after** the layers and **before** the selection overlay (assert by call order in the recorded draw stream). |
| **G-13** | `composeDocumentImage()` produces a canvas **byte-identical** to one produced with guides present — the export never contains guides (the selection's rule, `Canvas2DRenderer.ts` L502–504). |
| **G-14** | The document's pixel content is unchanged by any guide operation: no layer surface is invalidated, no stroke is re-rasterized (the "metadata-only" rule, `documentCommand.ts` L5–9). |

### 3.4 Persistence

| ID | Criterion |
| --- | --- |
| **G-15** | A guide survives save → reopen with its id, axis and position intact; the reopened document renders the same guide. |
| **G-16** | A file **without** a `guides` field opens with `guides = []` — the v1–v9 files stay unchanged. |
| **G-17** | A file with a guide whose position is not finite, whose axis is unknown, or whose id is duplicated is **repaired** (the guide dropped, a warning recorded) — the file still opens. |
| **G-18** | A file with more guides than the ceiling is **refused** with a message naming the limit (the `MAX_PROJECT_SAMPLES` precedent). |
| **G-19** | The file version is **unchanged** (v9) — because the guides are display-only and an older reader draws the same picture. If **P1** decides that guides are exported, this criterion becomes "the version is bumped and a v9 reader refuses a v10 file". |

### 3.5 Interaction

| ID | Criterion |
| --- | --- |
| **G-20** | Pressing on empty canvas and dragging creates **one** guide whose axis follows the dominant drag direction and whose position is the **press** coordinate, not the release. |
| **G-21** | Pressing within the grab radius of an existing guide and dragging moves **that** guide along its axis; its axis never changes. |
| **G-22** | A press on a guide that does not move selects it; `Delete` removes it; `Esc` clears the selection. |
| **G-23** | `Esc` during a drag cancels it: a moved guide returns to its previous position and a newly created guide disappears; **no** history entry is recorded. |
| **G-24** | Middle-button drag pans while the guides tool is active (the router's middle-button branch, `DrawingEngine.ts` L2122–2126). |
| **G-25** | A pen, a mouse and a touch produce the same guide geometry from the same document coordinates (pressure is ignored). |
| **G-26** | Undo is refused **during** a guide drag (the gesture flag, `isGestureActive`). |

---

## 4. Test plan

Per `AGENTS.md` §8 (the test map) and the repo's rules (every behaviour gets a
regression test; the React layer is verified in the running app).

| File | Cases | Notes |
| --- | --- | --- |
| **new** `src/test/guides.test.ts` | The pure parts: guide geometry (axis from the dominant drag direction), rounding to integer document pixels, the screen-space grab radius (`8 / zoom`), the duplicate-position rule, the guide-id helpers. | A pure module (`src/core/guides/guides.ts` or `src/core/document/guides.ts`) is what makes this testable without a canvas — the same split `strokeSelection.ts` and `shapeGeometry.ts` already use. |
| `src/test/viewport.test.ts` | G-06, G-07, G-08, G-11: `docToScreen`/`screenToDoc` round-trips at the zoom extremes (0.02 … 64) and the grab radius in document units. | `viewport.ts` is already pure and unit-tested ✓. |
| `src/test/canvas2dRenderer.test.ts` | G-09, G-12, G-13, G-14: the guide's device-pixel position at several zooms; the draw-call order (guides after the layers, before the selection); the export is unchanged; no layer invalidation. | `RecordingCanvas` records the call stream; the pixel harness (`PixelCanvas`) can check the guide's colour on the display canvas. |
| `src/test/drawingEngine.test.ts` | G-04, G-05, G-20 … G-26: the gestures, the one-undo-step rule, the cancel rule, the refusal of undo during a drag, the middle-button pan. | The engine's gesture tests are the established home for this. |
| `src/test/projectFormat.test.ts` | G-15 … G-19: the round trip, the missing field, the repairs, the ceiling, the unchanged version. | The v9 brush tests (`readBrush`) are the pattern. |
| `src/test/projectLifecycle.test.ts` | G-15 end-to-end: save → reopen → the guide is there and renders. | One case, mirroring the brush round trip. |
| **manual** (the running app) | The feel: creating, grabbing, moving, deleting; the colour against the artwork; the grab radius at high and low zoom; the pen. | The React layer has no automated tests (`docs/SESSION-BRIEF.md` §7). |

**A pixel-level note.** The guide's *line* is one device pixel wide, so a pixel
assertion must sample the exact device row/column; the existing `readPixel`
helper (`canvas2dRenderer.test.ts`) compares one point, and a whole-canvas
differ would be better (the QA harness has one, `qa/harness.ts`). Flagged, not
blocking.

---

## 5. The smallest safe scope

### 5.1 In scope (the recommended slice)

1. `Guide` / `GuideAxis` types and `DrawingDocument.guides` (default `[]`).
2. A pure guides module: the axis heuristic, the integer rounding, the
   screen-space grab radius, the hit-test, the duplicate rule.
3. A "Guides" tool: create by drag, move by drag, select by click, delete with
   `Delete`, cancel with `Esc`.
4. Engine methods to add/move/remove a guide, each **one** document command
   (with a `mergeKey` for the drag).
5. The renderer paints the guides (one new `paintGuides` in the display pass).
6. The project format reads and writes `guides` (additive; **no version bump**
   under decision **P1**).
7. The tool id, the definition, the registry entry, the shortcut.

### 5.2 Explicitly out of scope

- **Grids** (the roadmap's other Phase 6 item) — a different feature, a
  different model (a repeating pattern, not a list of markers).
- **Snapping to guides** — see §5.3.
- **Diagonal guides** (decision **P2**), **duplicate guides** (**P3**),
  **clamping to the paper** (**P4**), **position labels** (**P5**).
- **Rulers** — they are what makes the classic "drag out of the ruler" gesture
  possible, and they are a whole UI surface of their own.
- **Per-layer guides, guide groups, guide styles/colours per guide.**
- **Exporting guides** (decision **P1**).

### 5.3 Why snapping is a separate slice

Snapping to a guide changes **what a stroke does** (the pointer's position is
altered), which is a different kind of change from adding a marker:

- it touches the **input pipeline** (`pointer.ts` L96–129) or the sampling
  (`strokeBuilder.ts`), i.e. the path the whole app shares;
- it is **appearance-changing** (the stored samples differ), so it interacts
  with the format-version rule ("an older reader would render a different
  picture");
- it needs its own "which guides are active" state and its own thresholds.

Recommendation: ship guides first (a visible, static, low-risk artifact), then
snapping as its own slice with its own version decision.

### 5.4 Files that would change (estimate)

| File | Change | Size |
| --- | --- | --- |
| `src/core/document/types.ts` | `Guide`, `GuideAxis`, `DrawingDocument.guides` | ~15 lines |
| **new** `src/core/document/guides.ts` (or `src/core/guides/guides.ts`) | the pure geometry/hit-test helpers | ~90 lines |
| **new** `src/core/tools/guidesTool.ts` | the tool (gesture bookkeeping only) | ~90 lines |
| `src/core/tools/types.ts` | `ToolContext`: the guide methods the tool calls | ~25 lines |
| `src/core/engine/DrawingEngine.ts` | `addGuide`/`moveGuide`/`removeGuide` + the tool context wiring + the gesture flag | ~120 lines |
| `src/core/commands/documentCommand.ts` | nothing — the existing command covers guides | 0 |
| `src/core/rendering/Canvas2DRenderer.ts` | `paintGuides(ctx, scale)` + the call in `render()` | ~40 lines |
| `src/core/rendering/types.ts` | nothing — the guides arrive with `setDocument` | 0 |
| `src/core/project/projectFormat.ts` | the envelope field, the writer, the reader + the repairs | ~70 lines |
| `src/types/tool.ts`, `src/core/tools/toolDefinitions.ts`, `src/core/tools/toolRegistry.ts` | the tool id, the definition, the instance | ~20 lines |
| `src/hooks/useKeyboardShortcuts.ts` | the `Delete` branch for a selected guide (verify first — not read in this pass) | ~15 lines |
| `src/features/canvas/CanvasStatusBar.tsx` | *optional*: a "N guides" count, mirroring `selectedStrokes` | ~5 lines |
| **new** `src/test/guides.test.ts` + 5 existing test files | §4 | ~400 lines |
| `docs/ARCHITECTURE.md`, `docs/PROJECT_FORMAT.md`, `docs/SESSION-BRIEF.md`, `docs/ROADMAP.md`, `README.md`, `AGENTS.md` | the docs move with the behaviour | prose |

**Total: ≈ 15 files, ≈ 500 source lines + ≈ 400 test lines.** Comparable to a
medium slice of the stamp engine.

**Nothing outside `src/` changes**: no dependency, no Rust, no IPC, no package
manifest, no lockfile ✓.

---

## 6. Risks

| # | Risk | Likelihood | Mitigation |
| --- | --- | --- | --- |
| R1 | **The grab radius fights the zoom.** A document-space radius is unusable across the 0.02–64 zoom range; a screen-space radius needs the live zoom at hit-test time (available: `context.viewport`, `toolDefinitions`/`ToolContext` L18) ✓. | Medium | Screen-space radius from the start; test at both zoom extremes (G-11). |
| R2 | **The tool replaces drawing.** While the guides tool is active the user cannot paint. | Certain | Accepted (the same as select/pan). Mitigation: a clear cursor and an obvious tool-rail entry. |
| R3 | **A guide drag fights the undo model.** If the drag is not registered as an active gesture, undo can land mid-drag. | Medium | Register the gesture (the selection gesture's pattern) and refuse undo during it (G-26). |
| R4 | **Version-policy mistake.** If the guides are ever exported, an additive field becomes a wrong-picture risk for old readers. | Low now | The decision is explicit (**P1**); the criterion G-19 encodes the rule either way. |
| R5 | **A hostile file with a huge guide array.** | Low | The ceiling + the forgiving repairs (§2.5, G-17/G-18). |
| R6 | **The guide's colour reads poorly against some artwork.** | Medium | A fixed accent colour; a product decision (**P6**) if a user-configurable colour is wanted. |
| R7 | **Scope creep into rulers/snapping.** | High | §5.2/§5.3 draw the line; the roadmap's Phase 6 stays open for the other two. |
| R8 | **The `Delete` shortcut collides with the select tool's "delete selected strokes".** | Medium | Check `useKeyboardShortcuts.ts` (not read in this pass) before implementing; make the branch tool-aware. |

---

## 7. Dependencies and open technical checks

**Dependencies of the slice:** none outside `src/`. It builds on:

- the document model + the document command (undo/redo) — §1.4;
- the renderer's display transform and the overlay idiom — §1.3;
- the tool model and the registry — §1.5;
- the project format's envelope + the repair pattern — §1.6;
- the viewport math — §1.2.

**Checks that were NOT done in this pass** (they are cheap, and each could
change a small detail of the design):

1. `src/hooks/useKeyboardShortcuts.ts` — the `Delete` / `Esc` handling and
   whether a tool-aware branch is needed (R8, §6).
2. `src/core/document/strokeSelection.ts` — the selection model's shape, as the
   closest precedent for a *selected* entity (the guides tool's own selection).
3. `src/components/toolbar/ToolRail.tsx` — whether the rail is generated from
   `TOOL_DEFINITIONS` (probably, so a new tool is automatic) or hand-listed.
4. `src/state/editorStore.ts` — the `EditorActions` surface and whether the
   snapshot needs a guide count.
5. The `final-audit.md` / `qa-report.md` artifacts in the main tree — they may
   already list T-11 with a scope the coordinator expects (this worktree does
   not contain them).

---

## 8. Decisions that need product input (flagged, not guessed)

| # | Question | Why it is a product decision | My recommendation (advisory only) |
| --- | --- | --- | --- |
| **P1** | **Are guides exported?** If a PNG export bakes the guides in, an older reader would draw a different picture → the format needs a **version bump**; if they are display-only (the selection's rule), the field is **additive** and no bump is needed. | It changes the file format's compatibility contract, which is the project's stated rule, not an implementation detail. | **Display-only, no export, no version bump** — it matches the selection overlay exactly (`Canvas2DRenderer.ts` L502–504) and keeps the slice small. Revisit if users ask for "burned-in guides". |
| **P2** | **Diagonal guides?** | The model is axis-only by design; a free line needs its own hit-test and its own snapping story. | **No** in the first slice; axis-only. |
| **P3** | **Duplicate guides on the same axis position?** | Two vertical guides at the same x are legal but meaningless; allowing them is a user-visible rule. | **Reject the duplicate** (the drag does nothing) — it keeps the list meaningful and the file small. |
| **P4** | **May a guide sit outside the paper?** | Affects the model (clamped vs. unbounded) and the file's validation. | **Allow it** — a guide marks a position, and clamping loses intent; the guide is drawn across the viewport either way. |
| **P5** | **Show the position label?** (e.g. "1200 px" beside the guide) | Needs a font metric and a constant screen size; it is a visible design choice, not just a number. | **Defer** to a follow-up slice; the guide's position is already discoverable by the status bar if wanted. |
| **P6** | **Guide colour, and is it user-configurable?** | A visible design choice; the selection's colour is a constant (`SELECTION_COLOR`, L64). | A fixed accent constant for now; configurable later. |
| **P7** | **Does the guides tool replace drawing while active, or is a modifier chord used instead?** (a dedicated tool vs. e.g. `Ctrl`+drag with the select tool) | It decides the whole interaction model and the cost (a new tool vs. a chord that collides with existing gestures). | **A dedicated tool** — it matches the repo's tool model, it is discoverable in the rail, and a chord would collide with the select tool's two-gesture logic (`selectTool.ts` L31–42). |

---

## 9. Definition of done for this discovery

- [x] Every claim about the current code is cited to a file and line, and was
      read in the tree at `47e309f` (§1).
- [x] The coordinate system, the viewport transform, the display/overlay path,
      the document model, the command/history machinery, the input pipeline, the
      tool model and the file envelope were inspected (§1.2–§1.6).
- [x] Existing guide-like infrastructure was searched for and **verified not to
      exist** (§1.1); the only snapping in the app is the shape tool's `Shift`
      constraint.
- [x] Creation, movement, selection, removal, display and persistence are
      specified with concrete rules (§2.3–§2.5).
- [x] The document-vs-viewport coordinate question is answered, including the
      screen-space chrome rule (§2.1).
- [x] Interaction conflicts with drawing, dragging, selection, pen, touch, undo
      and the keyboard are enumerated with resolutions (§2.6).
- [x] Acceptance criteria are measurable (G-01 … G-26) and a test plan names
      the files (§3, §4).
- [x] The smallest safe scope and the files that would change are listed
      (§5), with grids and snapping explicitly deferred (§5.3).
- [x] Risks, dependencies and the open technical checks are listed (§6, §7).
- [x] Decisions needing product input are flagged rather than guessed (§8).

**Not done (by instruction):** no production code, test, manifest or lockfile was
written or modified; the feature was not implemented; the budget policy, the
licensing position and the final approval remain with their owners.
