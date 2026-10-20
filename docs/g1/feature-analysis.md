# Feature analysis — stamp-based brush engine (Paka, Phase 3)

> **Artifact type:** analyst report for the License/Provenance Gate and the
> Architecture Translator. It is *not* a project doc and not an implementation
> plan. Nothing in the analysed repository was modified to produce it.

| Field | Value |
| --- | --- |
| Feature ID | `PHASE3-STAMP-ENGINE` — "Stamp-based brush engine behind the existing stroke interface (per-dab spacing, true hardness curves, directional/stamp textures)" |
| Repository | `https://github.com/aissaadib/Paka.git` (`origin`, branch `main`) |
| Exact commit | `ad2ef11bb4fac508f0dda375a3eba5d7a9b7d7c9` — *"docs: clarify how to measure frames in the packaged app"*, 2026-10-20 16:56:36 +0000 |
| Checkout path | `C:\Users\aissa\Desktop\Paka` |
| Working tree at analysis | `main` clean except `skills-lock.json` (modified) and `.agents/skills/**` (untracked) — neither is in the feature's blast radius |
| Project licence | MIT (`LICENSE`, "Copyright (c) 2026 HumanHEART") |
| Stack (locked) | Tauri 2 + React 19 + strict TypeScript + Vite; Rust for native I/O; HTML Canvas 2D behind a `DrawingRenderer` interface |
| Baseline verified | `pnpm test` → 461 tests / 29 files, all pass; `pnpm typecheck` clean (per `docs/SESSION-BRIEF.md` §2, last verified 2026-10-20) |
| Status of the feature today | **Not implemented.** No stamp, dab-placement, per-dab texture or hardness-curve code exists in the tree (verified by `rg -n "stamp\|dab" src` — 33 hits, all either the single-dab helper `stampDot`, prose, or unrelated words such as "timestamp") |
| Analysis date | 2026-10-20 |

All line numbers below were read at the commit above. `rg` is authoritative if
they drift.

---

## 1. Scope and method

**Question answered:** *what must a stamp-based brush engine reproduce, and
where is the behaviour implemented today?*

**Method.** Grep the symbol → read a ±40-line window → read tests by name.
Never a folder listing, never a whole file over 250 lines. The reading order
was: roadmap/brief (scope) → rasterizer → renderer → engine → format → UI →
tests → docs.

**What was read in full** (all under 250 lines):
`src/core/rendering/canvas2dStroke.ts` (207), `src/types/brush.ts` (68),
`src/core/brushes/defaults.ts` (74), `src/core/brushes/strokeBuilder.ts` (210),
`src/core/document/types.ts` (191), `src/core/rendering/types.ts` (109),
`src/core/rendering/layerSurfaceStore.ts` (119), `src/core/tools/brushTool.ts` (59),
`src/core/tools/toolDefinitions.ts` (108), `src/features/brushes/BrushControls.tsx` (105),
`src/test/support/recordingCanvas.ts` (238), `src/test/canvas2dStroke.test.ts` (274).

**What was read in windows** (large files):
`src/core/rendering/Canvas2DRenderer.ts` (1295) — L1-130, 274-453, 600-849, 850-969, 960-1149, 1145-1295;
`src/core/engine/DrawingEngine.ts` (2249) — L810-869, 1055-1174, 1252-1351, 1400-1469;
`src/core/project/projectFormat.ts` (735) — L40-99, 255-334, 430-489, 680-735;
`src/test/canvas2dRenderer.test.ts` (2730) — L60-129, 1440-1619, 1790-1919, 2010-2069, 2083-2177, 2423-2507, 2506-2665.

**Not read** (per `AGENTS.md` §2, and not needed for this feature):
`src-tauri/target/`, `node_modules/`, the other 24 test files, `README.md` beyond
the brush/limitations lines, `docs/HANDOFF.md` §§1-6.

**Not verified (gap, stated not guessed):** the packaged Tauri app, HiDPI
rendering in the packaged shell, and any browser-level visual confirmation. The
brief itself records these as open (§7 "Verification gaps"). Nothing in this
report depends on them.

---

## 2. Feature identity

### 2.1 Where the feature is specified

Two documents, and they are **not identical in strictness** (see §9.2):

- `docs/ROADMAP.md` L156-157 (Phase 3, the only unchecked Phase 3 box) and
  L195-228 ("Next slice" — *the authority*).
- `docs/SESSION-BRIEF.md` §9 L441-499 ("Next slice — stamp-based brush engine").

`docs/ROADMAP.md` L197-201 states the intent precisely:

> "**Stamp-based brush engine behind the existing stroke interface** (the last
> Phase 3 item). Texture now ships as a coverage post-pass; this slice is about
> true dab placement, per-dab spacing/hardness and directional/stamp textures.
> The current rasterizer draws segments between samples, and `spacing` means
> sample density. A stamp engine must not silently change what existing files
> look like."

### 2.2 Target observable behaviour (what must be reproducible)

A **stamp engine** replaces the current "draw a round-capped segment between
each pair of samples" rasterization with **discrete dabs placed along the
path** at a controlled spacing, each dab carrying its own coverage profile
(hardness curve) and, optionally, its own texture (directional / image-based).

The behaviour a user must be able to observe after the slice:

1. **Per-dab spacing.** Dabs are placed at a controllable distance along the
   path. At a spacing larger than the dab diameter the stroke is visibly
   *gapped* (a dashed/segmented line); at a small spacing it is continuous.
   Today no such control exists: `spacing` in Paka means *sample density*
   (`src/core/brushes/strokeBuilder.ts` L146), and
   `docs/README.md` L275 states outright: "**Spacing is sample density, not
   stamp spacing.**"
2. **True hardness curves.** The soft edge of a *dab* is a coverage profile,
   not a blur of the finished silhouette. Today hardness is a single Gaussian
   feather of the whole stroke (`strokeFeatherRadius`,
   `src/core/rendering/canvas2dStroke.ts` L43-49), which `docs/ARCHITECTURE.md`
   L345-350 explicitly calls out as the thing a stamp engine would replace:
   > "The trade-off is deliberate: this is a Gaussian blur of the silhouette,
   > not an exact Photoshop-style hardness cone, so the falloff is smooth and
   > extends a little beyond the nominal diameter. […] a true per-pixel
   > hardness profile would require the deferred stamp/distance-field engine,
   > not this path."
3. **Directional / stamp texture.** Texture that varies *per dab* and can
   follow the path direction, rather than one document-anchored grain post-pass
   over the finished coverage (`docs/ARCHITECTURE.md` L352-380).
4. **Everything else unchanged.** A hard, soft or grain stroke drawn with no
   stamp settings must be **pixel-identical** to what it is today
   (`docs/ROADMAP.md` L208-210, L225).

### 2.3 What exists today (the baseline that must not move)

| Behaviour | Implementation | Anchor |
| --- | --- | --- |
| Stroke = round-capped segments at full coverage | `rasterizeStroke` | `src/core/rendering/canvas2dStroke.ts` L151-207 |
| Single-sample press = one round dab | `stampDot` | `canvas2dStroke.ts` L117-129 (called at L172) |
| Per-segment width from mean pressure of the pair | `strokeDiameter` | `canvas2dStroke.ts` L82-85, used L198-199 |
| One alpha for the whole stroke (mean-pressure modulated) | `strokeOpacity` | `canvas2dStroke.ts` L97-108 |
| Soft edge = one Gaussian feather of the finished silhouette | `strokeFeatherRadius` + `featherStroke` | `canvas2dStroke.ts` L43-49; `Canvas2DRenderer.ts` L1123-1164 |
| Grain = one document-anchored `destination-in` post-pass | `textureCoverage` + `applyStrokeTexture` | `canvas2dStroke.ts` L65-79; `Canvas2DRenderer.ts` L1058-1108 |
| Filled shape = polygon fill, then outline trace | `rasterizeStroke` | `canvas2dStroke.ts` L184-195 |
| Sample density / stabilizer | `StrokeBuilder.addSample` / `finish` | `src/core/brushes/strokeBuilder.ts` L114-196 |
| Brush captured per stroke | `createStrokeRecord` | `strokeBuilder.ts` L46-64 (`brush: { ...brush }`) |
| Brush is editor state, not an edit | `DrawingEngine.setBrush` | `src/core/engine/DrawingEngine.ts` L836-844 |

---

## 3. Current data flow (traced, not inferred)

```
DOM pointer events
  → core/input/canvasInputBinder → core/input/pointer      (PointerSample: docX, docY, pressure, time)
  → core/engine/DrawingEngine.beginStroke                   (L1056-1083)
        createStrokeRecord(layerId, this.brush, erases)     (strokeBuilder.ts L46)  ← brush copied here
        builder.addSample(toStrokeSample(sample))            (L1072)  ← interpolation, stabilizer, spacing
        renderer.beginStroke(stroke) / renderer.extendStroke(stroke, 0)   (L1080-1081)
  → core/engine/DrawingEngine.extendStroke                  (L1085-1094)
        fromIndex = builder.addSample(sample)
        renderer.extendStroke(stroke, fromIndex)              ← only the new part is rasterized
  → core/rendering/Canvas2DRenderer.extendStroke            (L295-325)
        if fromIndex <= 1: clear buffer, rasterizeStroke(ctx, stroke, 0)   (full redraw)
        else:              rasterizeStroke(ctx, stroke, fromIndex)         (append)
  → core/rendering/canvas2dStroke.rasterizeStroke           (L151-207)
        per segment: beginPath / moveTo / lineTo / stroke, lineWidth = strokeDiameter(mean pressure)
        alpha fixed at 1 throughout
  → display: Canvas2DRenderer.render (L405) → paintDocument (L628)
        for each composited layer: drawImage(surface)
        preview stroke: paintStrokeCoverage(ctx, preview)    (L670)  ← whole buffer, no region
  → release: DrawingEngine.finishStroke (L1408-1445)
        builder.finish()  (settle the stabilized path)
        renderer.endStroke(stroke)                           (L1437)
             → compositeStrokeBuffer(surface, stroke)        (L373-374)
                 → paintStrokeCoverage(surface.ctx, stroke, region)   ← REGION-bounded
        strokes.insert(stroke); commands.push(createStrokeCommand(stroke, index, host))  (L1438-1443)
  → undo/redo/reopen/export: rasterizeLayer (L765-785) → rasterizeStrokeToBuffer (L879)
        → rasterizeStroke(ctx, stroke, 0) → compositeStrokeBuffer(surface, element, op)
```

**State ownership**

| State | Owner | Lifetime |
| --- | --- | --- |
| Brush (incl. any future stamp settings) | `DrawingEngine.brush` (L325) | session; editor state, never history, never dirty |
| Stroke samples (`xs/ys/pressures/times`) | `StrokeRecord` in `StrokeStore` | document lifetime; the authoritative record |
| Stroke coverage pixels | `Canvas2DRenderer.strokeBuffer` | one gesture; cleared on begin/end/cancel |
| Layer pixels | `LayerSurfaceStore` surfaces | until invalidated; a rebuildable cache |
| Feather scratch | `Canvas2DRenderer.featherBuffer` (L1167-1175) | reused for every soft stroke |
| Grain tile cache | `Canvas2DRenderer.textureTiles` (L121) | per renderer, keyed by strength quantized to 1/20 |
| Grouped-preview scratch | `Canvas2DRenderer.previewSurface` (L1275-1277) | only while a grouped preview is on screen |
| Undo stack | `CommandStack` | 200 commands; not serialized |

**Units and coordinates**

- Stroke samples, brush size, spacing, feather radius, texture: **document
  pixels** (float).
- `StrokeRecord.xs/ys` are document coordinates; `rasterizeStroke` works in
  document coordinates and the caller owns the transform
  (`src/core/rendering/canvas2dStroke.ts` L13-14: "every function here works in
  document coordinates so the caller controls the transform (screen zoom never
  affects rasterized pixel data)").
- The stroke buffer and the layer surfaces are the document at `rasterScale`
  (1 or 2, HiDPI). `prepareStrokeBuffer` (L1279-1285) sets the transform to
  `scale`, so a document-space radius is automatically supersampled.
- The grain pattern transform is explicitly scaled by `rasterScale` and anchored
  to the document origin (`applyStrokeTexture` L1072-1073) so the tile is in
  document space.
- Colour is 8-bit sRGB; surfaces are straight-alpha RGBA.

**Threading** — single-threaded, main thread only. `FrameScheduler`
(`src/core/rendering/frameScheduler.ts`) batches repaints to animation frames.
React never sees a pointer sample.

---

## 4. The invariants a stamp engine must preserve

These are the load-bearing rules. Each is asserted by an existing test, and
each has a named owner in the code.

| # | Invariant | Owner / anchor | Existing test |
| --- | --- | --- | --- |
| I1 | **Coverage is full (alpha 1) inside the buffer; the stroke's opacity is applied exactly once**, when the buffer composites. Overlapping segments must never darken the stroke. | `canvas2dStroke.ts` L136-140, L163; `strokeOpacity` L97-108; `compositeStrokeBuffer` L976 | `canvas2dStroke.test.ts` L118-127; `canvas2dRenderer.test.ts` L2600-2621 (expects `rgb(128,128,128)` for a 50 %-opacity self-crossing stroke over white) |
| I2 | **Live preview, layer commit, undo/redo rebuild, reopen and PNG export must produce the same pixels**, at every zoom and `rasterScale`. | one funnel: `paintStrokeCoverage` (L997-1047) | `canvas2dRenderer.test.ts` L2540-2598 (`checkEveryPathAgrees` for hard / soft / grain) |
| I3 | **A stroke is self-describing**: it carries the brush it was drawn with; re-rasterizing never consults editor or tool state. | `createStrokeRecord` L55; `StrokeRecord.brush` (`src/core/document/types.ts` L79) | `drawingEngine.test.ts` L254-294 |
| I4 | **A stroke is one undo step.** `StrokeCommand` carries no pixels; undo removes it from the store and re-rasterizes the layer. | `DrawingEngine.finishStroke` L1438-1443; `docs/ARCHITECTURE.md` L819-822 | `commandStack.test.ts`, `strokeCommand.test.ts` |
| I5 | **The vector samples stay authoritative.** Stamps are a *rasterization strategy*, not a new element kind; the file format stores samples, not pixels. | `docs/ROADMAP.md` L205-207; `StrokeRecord` (structure-of-arrays) | `projectFormat.test.ts`, `projectLifecycle.test.ts` |
| I6 | **Determinism.** No `Math.random()`, no time, no zoom dependence in a repaint path. Same document point → same pixel, always. | `textureCoverage` (fixed hash) L65-79; `docs/ROADMAP.md` L215-217 | `canvas2dStroke.test.ts` L256-264 |
| I7 | **The cost follows the inked area, not the document size.** The rebuild clears/blends only the rectangle an element inks. | `rasterizeStrokeToBuffer` L879-888; `strokeRegion` L935-949; `compositeStrokeBuffer` L970 | `canvas2dRenderer.test.ts` L2442-2503; L2423-2440 (`coverageInside`) |
| I8 | **The brush is editor state.** Changing a brush field is not an edit: no history step, no dirty flag, no rewrite of committed strokes. | `DrawingEngine.setBrush` L836-844; `docs/SESSION-BRIEF.md` §6 | `drawingEngine.test.ts` L157-212, L254-294 |
| I9 | **`DrawingRenderer` and `StrokeRecord` stay the boundary.** A different backend must be possible without touching the app. | `src/core/rendering/types.ts` L46-108 | — (architectural) |
| I10 | **The raster budget.** A document may use at most 16,777,216 px; the peak is 58 bytes per document pixel. The erase snapshot and the grouped-preview scratch are mutually exclusive. | `docs/ARCHITECTURE.md` L774-812; `beginStroke` L282-291; `dropPreviewSurface` L1275-1277 | `canvas2dRenderer.test.ts` L2654-2720 |

---

## 5. Coupling analysis — where a stamp engine will break if it ignores the code

These are the findings that matter. Each is a concrete, located hazard.

### 5.1 CRITICAL — the bounded blit silently drops out-of-region coverage

`compositeStrokeBuffer` composites **only** the rectangle
`strokeRegion(stroke)` (L970, L978), and `strokeRegion` is derived from
`strokeSampleBounds` (L935-949, L908-927):

```
spread = strokeDiameter(brush, 1) / 2 + strokeFeatherRadius(brush) * 3 + 1
bounds = samples ± spread
```

But the **live preview** path draws the **whole** buffer:
`paintDocument` L670 calls `paintStrokeCoverage(ctx, preview)` with **no
region**, which takes the `ctx.drawImage(this.strokeBuffer, 0, 0, doc.width, doc.height)`
branch (L1028).

**Consequence.** Any coverage a stamp engine produces *outside*
`strokeSampleBounds` is **visible while drawing and gone after the release** —
a live/commit divergence, and the commit/rebuild/export paths then disagree
with each other in a different way (rebuild is region-bounded too, so live and
committed differ; the export matches the commit, not the live view).

This bites any stamp whose footprint exceeds the brush radius: a bristle brush
offset from the centreline, an elongated/directional stamp, a stamp with a
soft skirt wider than the nominal diameter, or a dab placed with a small
along-path offset. The bound is currently derived from *brush radius* only.

**Required:** the stamp engine's footprint must be inside the bound, **or** the
bound must be widened to account for the stamp's actual extent — and the
widening must be identical in `strokeSampleBounds` (used by the blit) and
`strokeFeatherRadius`/feather (used by the blur). This is the single most
likely source of a silent visual corruption.

### 5.2 CRITICAL — `rasterizeStroke`'s incremental contract is stateless

`rasterizeStroke(ctx, stroke, fromIndex)` draws segments `(i-1, i)` for
`i >= max(1, fromIndex)`. It is **stateless**: given a `fromIndex` it can
reproduce the tail of a segment path without any cursor.

Dab placement is **not** stateless: the position of the next dab depends on
where the last dab was placed. Placing dabs by arc length from the start of
the path means a dab at arc length `s` may lie *between* samples `i` and `i+1`,
and the dab that straddles the join between the previously-drawn part and the
newly-appended part is not reproducible from `fromIndex` alone.

Callers that depend on the current contract:

| Caller | Anchor | Consequence for a dab engine |
| --- | --- | --- |
| `Canvas2DRenderer.extendStroke` | L295-325 (append branch L317-320) | needs a persistent dab cursor across calls |
| `Canvas2DRenderer.extendStroke` (redraw branch) | L305-316 (`fromIndex <= 1`) | cursor must be reset to the path start |
| `Canvas2DRenderer.replaceStroke` (shapes) | L336-345 | full redraw from 0 every move; cursor reset each time |
| `Canvas2DRenderer.rasterizeStrokeToBuffer` (rebuild) | L879-888 | full redraw from 0 |
| `DrawingEngine.extendStroke` | L1085-1094 (`fromIndex` = first index appended by the builder) | the `fromIndex` semantics ("first new sample") is a *sample* index, not an *arc-length* index |
| `StrokeBuilder.addSample` | `strokeBuilder.ts` L114-175 (returns `firstIndex`) | returns a sample index; a dab engine needs an arc-length/position notion |

**Required:** either `rasterizeStroke` grows a cursor parameter, or the dab
placement is defined so that it is a pure function of the *whole* stroke (e.g.
dabs are placed on a fixed lattice derived from the path start, so the dab
covering arc length `s` is determined by the full path) — but then an
incremental append must still find the lattice phase, which requires the arc
length at the join.

**Note the existing escape hatch:** `extendStroke` already redraws the whole
stroke when `fromIndex <= 1` (L305-316) because "a dab alone in the buffer
would be overdrawn by the first segment's round cap" (ARCHITECTURE L288-296).
That branch already tolerates a full redraw; the incremental branch does not.

### 5.3 CRITICAL — "max/union" coverage is not available in Canvas 2D

`docs/ROADMAP.md` L212-214 requires:

> "Accumulate per-dab coverage into **one** stroke buffer (max/union, not
> repeated source-over), then composite once at the stroke opacity. A
> self-crossing stamped stroke must not darken."

The reason the union rule matters specifically for stamps: with `source-over`
at alpha 1, a second dab's opaque core **saturates** the alpha of a
neighbouring dab's soft edge to 1 — so a per-dab hardness curve is destroyed
exactly where dabs overlap, which is everywhere at normal spacings. The
current segment path gets away with `source-over` because its overlap
behaviour (saturation) is invisible: the *stroke* alpha is applied once at
composite time (I1), and the segment path has no per-dab profile to preserve.

Canvas 2D's separable blend modes (`lighten`, `screen`, …) are **blend modes
applied with the source-over compositing operator** — they max the *colour*
channels, not the *alpha*. There is no `max-alpha` composite operation in
Canvas 2D. A true coverage union therefore needs either a per-pixel coverage
mask (e.g. an `ImageData` pass) or a coverage-encoded scratch buffer plus a
conversion pass, and the conversion pass is itself a per-pixel cost.

**This is the highest technical risk in the slice** and it is not visible from
the interfaces. The existing `destination-in` grain pass (L1058-1081) is the
closest existing precedent for a "scale an existing alpha" operation.

### 5.4 HIGH — per-dab opacity is not representable in the current model

`strokeOpacity` (L97-108) derives **one** alpha for the whole stroke from the
**mean** pressure, and its doc comment states the reason:

> "A stroke is one shape, so it gets one alpha. Pressure-driven opacity cannot
> vary *within* a stroke without per-pixel max blending, which Canvas 2D does
> not expose — drawing each segment at its own alpha is exactly what piles up
> into a darker line at every overlap. […] A GPU backend can do true per-dab
> opacity later."

`docs/ARCHITECTURE.md` L283-286 repeats it. **Per-dab opacity is therefore
out of scope for a Canvas 2D stamp engine** and must not be promised in the
UI. A "stamp" that varies opacity per dab would break I1.

### 5.5 HIGH — the fill-shape interior is a *flat* polygon fill, not brush coverage

`rasterizeStroke` L184-195 fills the closed polygon the shape's samples trace
with `ctx.fill()` at the brush colour, then traces the outline. The interior
takes the brush colour but is **not** covered by dabs.

Today that is invisible because hardness and grain are post-passes over the
finished coverage, so the interior feathers and grains like the outline
(`docs/ARCHITECTURE.md` L342-343). Under a stamp engine the question becomes
real: does a stamped brush's *interior* get stamped dabs, or stay a flat
polygon? The two look different, and the answer changes what "the same
settings produce the same picture" means. **Open question Q3 (§11).**

### 5.6 HIGH — the eraser subtracts the *whole* buffer live but a *bounded region* on rebuild

`applyErase` (L1205-1224) calls `paintStrokeCoverage(surface.ctx, stroke)` with
**no region** (L1221) → the whole buffer is subtracted. The rebuild path goes
through `compositeStrokeBuffer(surface, element, "destination-out")` (L781) →
**region-bounded**.

For today's geometry both agree, because the region is a superset of the
coverage by construction (§5.1). For a stamp engine they diverge the moment
the footprint escapes the region — and the divergence is *invisible* until
someone rebuilds the layer. Note also that the eraser deliberately rebuilds
from a snapshot on every update (L1186-1202, `restoreEraseBase` L1234-1247) so
a self-crossing eraser subtracts once, not twice.

### 5.7 MEDIUM — the brush is shallow-copied; a non-primitive stamp field would alias

`createStrokeRecord` does `brush: { ...brush }` (L55) and `cloneStroke` does
the same (L77). A shallow spread copies a **reference** for any non-primitive
field. A stamp definition that is an object (a stamp image descriptor, a
profile curve array, a texture tile id map) would be **shared** between the
original stroke and its clone, and a later mutation of one would change the
other. `BrushSettings` is currently all-primitive, so this is latent.

### 5.8 MEDIUM — new brush fields are silently dropped unless three files change

A new brush field must be added in **three** places or it fails silently:

1. `src/types/brush.ts` — the `BrushSettings` interface.
2. `src/core/brushes/defaults.ts` — `DEFAULT_BRUSH` (L15-26),
   `normalizeBrush` (L29-42, which **clamps** every field) and
   `brushSettingsEqual` (L52-65, which **compares** every field).
   *Miss `normalizeBrush` and the field is dropped on every `setBrush` call
   (`updateBrushSettings` L44-49 always runs `normalizeBrush`). Miss
   `brushSettingsEqual` and every change to the field looks like a no-op, so
   the UI slider does nothing.*
3. `src/core/project/projectFormat.ts` — `readBrush` (L686-719) reads fields
   **explicitly**; an unlisted field is not read back.

The serializer needs nothing: `brush: element.brush` (L454) dumps the whole
object, so a new field is written automatically — which is exactly why the
version policy matters (§5.9).

### 5.9 MEDIUM — the format version decision is a genuine fork

The project's own rule (`docs/SESSION-BRIEF.md` §6, "Format versioning"):

> "a bump is required when an older reader would render a **different
> picture**, not for convenience."

By that rule, a **purely additive, off-by-default** stamp field does **not**
require a version bump: a v8 reader would ignore it and draw the segment path
— the same picture the new reader draws for a default brush.

But `docs/SESSION-BRIEF.md` §9 constraint 5 and its acceptance criteria say
the opposite:

> "Appearance-changing fields that a v8 reader cannot ignore require **format
> version 9**; prove it with tests." […] "Old projects open unchanged; a v9
> file requires the new fields and an older reader refuses it rather than
> drawing the wrong look."

And `docs/ROADMAP.md` L218-221 is the softer version: "A non-default
stamp/dab appearance that an older reader cannot reproduce requires a format
bump (v9 if fields change appearance)".

These three statements are not equivalent. The conflict is reported in §9.2 as
**Q1**; the existing machinery for the strict reading already exists — the
parser refuses a newer version outright (`projectFormat.ts` L510-514:
`"this build reads up to ${PROJECT_VERSION}"`).

### 5.10 MEDIUM — `spacing` must stay non-appearance-changing, and that is *provable but fragile*

`docs/ROADMAP.md` L220-221: "keep `spacing` (sample density) distinct from
stamp spacing or document an explicit migration if they are merged."

A stamp engine that places dabs by **arc length along the polyline of the
stored samples** is *geometrically* invariant to `spacing`, because
`StrokeBuilder.addSample` inserts points **on the straight line** between raw
samples (`strokeBuilder.ts` L149-160, `lerp` with a uniform `t`), and pressure
is interpolated linearly along the same parameter. So the arc-length
parameterised path — and hence the dab positions and their pressures — is the
same at any sample density.

That is a **derivation, not a guarantee**: it holds only while interpolation
stays linear and the raw point is always appended (`addSample` L170-173 drops
a raw point closer than `MIN_SAMPLE_DISTANCE` = 0.05 px). If a stamp engine
instead re-interpolates the path itself, or places dabs per *sample* rather
than per arc length, `spacing` becomes appearance-changing and the format
policy changes with it. **Q4 (§11).**

### 5.11 MEDIUM — the eraser/brush share one rasterizer, so a stamp engine changes the eraser too

`src/core/tools/brushTool.ts` L8-11:

> "The same behaviour drives the eraser, which is a brush whose strokes
> subtract coverage: the pointer handling, the pressure policy and the sampling
> are identical, so the two tools differ only in their definition and in
> `erases`."

`ToolDefinition.erases` is read at `DrawingEngine.beginStroke` L1070 and at
`beginShape` L1119-1127. A stamp engine therefore applies to brush, eraser
**and** shapes (all three share `rasterizeStroke`). `docs/ARCHITECTURE.md`
L378-380 makes the same point for grain.

### 5.12 LOW — the "single dab" special case is load-bearing

`rasterizeStroke` L169-182: a one-sample stroke deposits `stampDot` and
returns. `Canvas2DRenderer.extendStroke` L305-316 redraws the whole stroke
once it grows past one sample, *specifically* because the initial dab would
otherwise be overdrawn by the first segment's round cap — "it is a second pass
of antialiasing exactly at the start, so the live buffer would differ (by up
to a few levels, on the start ring) from what undo, reopen and export produce"
(L306-313).

A dab-based engine changes the shape of this problem (the initial dab is no
longer redundant — it *is* the first dab), so this branch may become
unnecessary **or** may need a different rule. It must be re-derived, not
assumed. The invariant it protects — live == commit at the start ring — is
asserted by `canvas2dRenderer.test.ts` L378-414.

### 5.13 LOW — the texture tile cache is keyed by a quantized strength

`textureTile(strength)` L1084-1108 keys the cache by
`Math.round(clamp(strength,0,1) * 20) / 20` — 21 buckets. Two strokes with
strengths 0.501 and 0.504 share a tile. Harmless for grain (it is a visual
texture), but **a stamp engine that quantizes a user-visible parameter must
document the quantization**, or the UI slider will appear not to respond
between buckets.

---

## 6. Existing test coverage — what it proves, and what it does not

### 6.1 What exists

| File | Scale | Covers |
| --- | --- | --- |
| `src/test/canvas2dStroke.test.ts` (274 lines, 29 `it`s) | **draw-call stream** (`RecordingCanvas`) | `strokeDiameter`, `strokeFeatherRadius`, `strokeOpacity`, `rasterizeStroke` (full coverage, per-segment width, single dab, `fromIndex` redraw, fill-flag behaviour), `stampDot`, `textureCoverage` |
| `src/test/canvas2dRenderer.test.ts` (2730 lines, 86 `it`s) | draw-call stream **+ a software pixel canvas** | compositing order, layer opacity/blend, live preview, eraser snapshot behaviour, hardness feather, grain pattern pass, fill patches, gradients, export, colour probe, selection overlay, bounded rebuild, preview-scratch lifetime |
| `src/test/projectFormat.test.ts` | parsed values | brush round-trip (L450-567), per-version defaults, field validation (L887-940), version rejection (L807) |
| `src/test/drawingEngine.test.ts` | engine state | brush is editor state (L157-212), per-stroke capture (L254-294), undo/redo of strokes, layer safety |
| `src/test/strokeBuilder.test.ts` | builder | interpolation, spacing, stabilizer, finish settle |
| `src/test/commandStack.test.ts`, `strokeCommand.test.ts` | history | one command per gesture, redo re-inserts at the original index |
| `src/test/projectLifecycle.test.ts`, `projectFiles.test.ts` | I/O | save → reopen reproduces the document |

### 6.2 Two harnesses, with different power

**(a) `RecordingCanvas`** (`src/test/support/recordingCanvas.ts`) — records
every draw call with the live `globalAlpha`, `globalCompositeOperation`,
`fillStyle`, `lineWidth`, `lineDash`, `filter`. `RECORDED_METHODS` (L15-31)
covers `save/restore/setTransform/clearRect/fillRect/drawImage/beginPath/
moveTo/lineTo/arc/closePath/fill/stroke/strokeRect/putImageData`; `createPattern`
(L148-163), `createImageData` (L166-175), `getImageData` (L112-127) are
specialised. **It proves *what was drawn and with what state*; it proves
nothing about pixels.**

**(b) `PixelCanvas`** (in `canvas2dRenderer.test.ts` L1498-2059) — a software
Canvas 2D with straight-alpha float pixels, implementing `fillRect`,
`clearRect`, 1:1 `drawImage` with transforms, `save`/`restore`, and the
`source-over` / `destination-out` / `destination-in` / `multiply` / `screen`
operations (L1523-1587). It **does** rasterize paths: `arc` → a 24-gon
(L1851-1859), `fill` → point-in-polygon per pixel (L1863-1892), `stroke` → a
capsule per segment (L1893-1930). Edges are **hard** (no antialiasing).

> ⚠ **Stale comment — a trap for the implementer.** The header comment at
> L1457-1459 says "Stroke rasterization (paths, arcs) is deliberately a no-op:
> coverage is seeded straight into the stroke buffer, because these tests are
> about where that coverage is composited, not about how it was rasterized."
> **That comment is out of date**: the implementation at L1835-1930 *does*
> rasterize `arc`, `fill` and `stroke`. The consequence for the stamp engine is
> favourable — the pixel harness *can* check dab geometry — but the comment
> will mislead anyone who reads it first. See §9.3.

### 6.3 What the existing tests do **not** prove

| Gap | Why it matters for the stamp engine |
| --- | --- |
| **No pixel test proves the segment rasterizer's actual coverage.** `PixelCanvas` has hard edges and 24-gon circles; the pixel tests *seed* coverage into the buffer rather than rasterizing a real stroke (the stale comment is a symptom). | A stamp engine's dab profile — the actual new pixels — would be equally unproven unless the harness is extended or a browser check is done. |
| **No test proves the live path and the commit path agree at the *start ring*** beyond the single-dab redraw branch (L378-414). | A dab engine changes the start-of-stroke behaviour (§5.12). |
| **No test covers `rasterScale = 2` for a *soft* stroke's pixels.** `checkEveryPathAgrees` runs at `rasterScale: 1` (L2152) and the soft case "checks the feather path's geometry and placement rather than the kernel" (L2536-2538) because the software canvas has no blur. | A stamp engine whose dab geometry is resolution-dependent would pass every existing test and still be wrong at 2×. |
| **No test proves the grain *pattern* is identical between the live path and the rebuild path at a different bounding box** — only that the pattern transform is set. | A stamp engine needs the document-anchoring invariant asserted at the *pixel* level. |
| **No React-layer test exists at all** (`docs/SESSION-BRIEF.md` §7). | A new stamp control can only be verified manually in the running app. |
| **No packaged-Tauri or HiDPI verification has ever been done** (`docs/SESSION-BRIEF.md` §7). | Same for the stamp engine. |

---

## 7. Dependencies

| Layer | Dependency | How the stamp engine touches it |
| --- | --- | --- |
| **Graphics API** | HTML Canvas 2D only. `globalCompositeOperation` (`source-over`, `destination-out`, `destination-in`, `multiply`, `screen`); `ctx.filter = blur(px)`; `createPattern` + `pattern.setTransform`; `getImageData`/`putImageData`; `arc`, `fill`, `stroke`, `drawImage` | The whole implementation. The two hard limits: **no max-alpha composite** (§5.3) and **`ctx.filter` blur is the only soft-edge primitive** (used today by the feather) |
| **UI toolkit** | React 19 + the `SliderField` component (`src/components/toolbar/SliderField.tsx`), `BrushControls` (`src/features/brushes/BrushControls.tsx`) | A stamp control is a `SliderField` + `actions.setBrush({...})`; a toggle is a `label.toggle` checkbox. No placeholders (`docs/ROADMAP.md` L222-223) |
| **State layer** | `EditorActions.setBrush` (`src/state/editorStore.ts` L26, L86) → `DrawingEngine.setBrush` (L836-844) → `updateBrushSettings` → `normalizeBrush` + `brushSettingsEqual` → `commands.breakMerge()` → `publish()` | Automatic once the field is in `normalizeBrush`/`brushSettingsEqual` |
| **Input stack** | `PointerEvent` → `canvasInputBinder` → `pointer` (pressure policy, screen→document) → `PointerSample` | Unchanged. A stamp engine consumes the *samples*, not the events |
| **File format** | `.paka` JSON, `PROJECT_VERSION = 8` (`projectFormat.ts` L87), `readBrush` (L686-719), serializer `brush: element.brush` (L454) | A new appearance-changing field ⇒ version policy (§5.9); `readBrush` must read it explicitly (§5.8) |
| **Native framework** | Tauri 2 + Rust (`src-tauri/src/project_io.rs`, `lib.rs`, `native_environment.rs`) — scoped project/PNG I/O, environment probe | **None.** The stamp engine is pure front-end; the Rust shell is not involved |
| **Runtime** | Browser (Tauri WebView) | `ctx.filter` (blur) is used today; a stamp engine may want gradients/`createRadialGradient` per dab, which is also WebView-supported |
| **Test runtime** | Vitest on Node with the two fake canvases | The pixel harness must be extended for dab geometry, or the visual proof must come from a browser check |

---

## 8. Essential vs application-specific

**Essential to the feature's behaviour** (a correct implementation must have
these, whatever the architecture):

1. One stroke = one coverage buffer = one alpha applied at composite time
   (I1). A per-dab alpha is wrong.
2. Dabs placed at a controllable spacing along the path, with a per-dab
   coverage profile.
3. Coverage accumulated by union/max, not by repeated source-over (§5.3).
4. Pixel-identical output across live → commit → undo/redo → reopen → export,
   at any zoom and `rasterScale` (I2, I6).
5. All coverage inside the composited region (§5.1).
6. Stamp settings captured on the stroke record and reproduced by the format
   (I3, I5).
7. Determinism from document state alone (I6).
8. One undo step per gesture; the record is the samples, not pixels (I4, I5).
9. Cost follows the inked area (I7).

**Application-specific to Paka** (choices, not requirements — an alternative
architecture may legitimately differ):

- Tauri 2 + React 19 + Vite + strict TS; the React shell; the toolbar layout.
- The `.paka` JSON format and its version-numbering scheme; the "bump on a
  different picture" rule; v8's specific field set.
- The `rasterScale` 1–2 HiDPI scheme and the "surfaces are the document at
  `rasterScale`" model.
- The 58-bytes-per-document-pixel raster budget and the 16,777,216 px cap.
- Hardness as a Gaussian feather with `SOFT_EDGE_RADIUS_RATIO = 0.1`; grain as
  a 128×128 white tile under `destination-in`; the `mean pressure` opacity
  model; the default brush (size 6, `#16181c`, hardness 1, spacing 0.12).
- The eraser-as-negative-stroke model and its snapshot discipline.
- The "Spacing" slider already meaning *sample density* in the UI.
- Layer model, blend modes, selection model, command stack cap of 200.

---

## 9. Documentation vs code

### 9.1 Agreements (verified)

| Claim | Document | Code | Verdict |
| --- | --- | --- | --- |
| Segments are drawn at full coverage; opacity is applied once | `ARCHITECTURE.md` L271-282 | `canvas2dStroke.ts` L136-140, L163; `strokeOpacity` L97-108 | **agree** |
| Hardness is a Gaussian feather of the finished silhouette, radius `size * 0.1 * (1 - hardness)` | `ARCHITECTURE.md` L298-331 | `strokeFeatherRadius` L43-49; `SOFT_EDGE_RADIUS_RATIO` L32 | **agree** |
| Grain is one `destination-in` pass with a document-anchored, cached 128×128 tile | `ARCHITECTURE.md` L352-380 | `applyStrokeTexture` L1058-1081; `textureTile` L1084-1108; `TEXTURE_TILE_SIZE` L52 | **agree** |
| A stroke is one undo step; undo re-rasterizes from the store | `ARCHITECTURE.md` L819-822 | `finishStroke` L1408-1445; `rasterizeLayer` L765-785 | **agree** |
| `spacing` is sample density, not stamp spacing | `README.md` L275-277; `ARCHITECTURE.md` L753-764 | `strokeBuilder.ts` L146; `rasterizeStroke` never reads `spacing` | **agree** |
| Format v8; `texture` required from v7; `stabilizer` additive in v6 | `PROJECT_FORMAT.md` L417-446 | `PROJECT_VERSION = 8` L87; `readBrush` L686-719 | **agree** |
| The rebuild is bounded by each element's inked rectangle | `PERFORMANCE_AUDIT_2026-10-20.md` L9-11, L46-47 | `rasterizeStrokeToBuffer` L879-888; `strokeRegion` L935-949 | **agree** |
| Brush changes are editor state (no history, no dirty) | `SESSION-BRIEF.md` §6 | `setBrush` L836-844 | **agree** |

### 9.2 CONFLICT — the format-version rule vs the slice's acceptance criteria

- The project's rule (`SESSION-BRIEF.md` §6, "Format versioning"): *"a bump is
  required when an older reader would render a **different picture**, not for
  convenience."*
- The slice's criteria (`SESSION-BRIEF.md` §9, acceptance): *"a v9 file
  requires the new fields and an older reader refuses it rather than drawing
  the wrong look."*
- The roadmap (`ROADMAP.md` L218-221): *"A non-default stamp/dab appearance
  that an older reader cannot reproduce requires a format bump (v9 if fields
  change appearance)."*

**The conflict:** a *purely additive, off-by-default* stamp field would be
ignored by a v8 reader, which would then draw the **segment path** — the very
same picture the new reader draws for a default brush. By the project's own
rule that needs **no bump**; the slice's acceptance criteria demand a **v9**
anyway. The two readings are only equivalent if the stamp engine is *not*
off-by-default (i.e. the default brush's output changes), or if the v9 file
carries a field that is *required* and whose absence an older reader would
mis-render.

The strict machinery already exists: `parseProject` refuses
`version > PROJECT_VERSION` outright (`projectFormat.ts` L510-514). A
`readBrush` that requires the new field for v9 also already has a precedent
(`hardness` from v6, `texture` from v7 — L696-717).

**This is a decision for the coordinator/architecture translator, not for the
analyst.** It changes the amount of work (a v9 writer + reader + a
version-rejection test vs an additive field) and it changes what "old projects
open unchanged" means.

### 9.3 CONFLICT — a stale comment inside the test harness

`src/test/canvas2dRenderer.test.ts` L1457-1459:

> "Stroke rasterization (paths, arcs) is deliberately a no-op: coverage is
> seeded straight into the stroke buffer, because these tests are about where
> that coverage is composited, not about how it was rasterized."

The implementation contradicts it: `arc` (L1851-1859), `fill` (L1863-1892) and
`stroke` (L1893-1930) all rasterize. The comment is stale.

**Why it matters:** a reader who trusts the comment will conclude that no
pixel test can check a dab's shape, and will defer the proof to a manual
browser check. The harness *can* rasterize a dab (as a 24-gon with hard
edges) — enough to prove spacing, count, coverage extent and the union rule,
though not enough to prove an antialiased hardness curve.

### 9.4 CONFLICT — the UI already spends the word "Spacing"

`src/features/brushes/BrushControls.tsx` L51-59 labels the existing control
**"Spacing"**, with the tooltip "Gap between interpolated samples as a
percentage of brush size". `README.md` L275 and `ARCHITECTURE.md` L753-764
both explain that this is *sample* density.

A stamp-spacing control cannot also be called "Spacing" without a
user-visible contradiction. **Q2 (§11).**

### 9.5 Minor — `docs/AGENTS.md` line anchors have drifted

`AGENTS.md` §5 lists `paintStrokeCoverage` at L767, `featherStroke` at L870,
`compositeStrokeBuffer` at L742, `Canvas2DRenderer.ts` as 961 lines. At the
analysed commit they are at L997, L1123, L961 and 1295 lines respectively.
`AGENTS.md` says "Line anchors are hints, not contracts. If `rg` disagrees,
fix the anchor." — they disagree; the anchors should be refreshed (out of scope
for this analysis, flagged for the coordinator).

---

## 10. Failure modes, hot paths, known bugs

### 10.1 Hot paths a stamp engine will amplify

| Path | Today | With dabs |
| --- | --- | --- |
| `rasterizeLayer` (rebuild on undo/redo/reopen) | one segment path per sample pair | `dabs ≈ pathLength / stampSpacing` draw calls per stroke |
| Live `extendStroke` | one `stroke()` per new sample pair | one `arc`+`fill` (or equivalent) per dab |
| `paintStrokeCoverage` | 1 raw blit / 1 blur / 1 grain pass | unchanged *if* the stamp is baked into the buffer — but the **union** rule (§5.3) may add a per-pixel pass |
| `featherStroke` | one blur of the stroke bbox | unchanged in count; the blur input is now a dab-accumulated buffer |

**Arithmetic for the worst case.** A 4096 px document, a 512 px brush, a
stamp spacing of 2 % of the diameter (= 10.24 px) and a stroke crossing the
whole document: 4096 / 10.24 ≈ **400 dabs**. At a 0.75 px floor (the
`MIN_SPACING_STEP` used by the *sample* builder, `strokeBuilder.ts` L31), the
same stroke is ≈ **5461 dabs**. Each dab is at least one path + fill in
Canvas 2D. A layer with 100 such strokes rebuilds to ~546,000 dab draws on
every undo.

The existing audit already flags the rebuild as the dominant cost
(`PERFORMANCE_AUDIT_2026-10-20.md` L46: "Cost is `O(elements x surface
pixels)`") and records that the *area* half of it was fixed by R1 (`4ac040b`)
while the remaining per-draw cost "needs a profile **in the packaged app**"
(L21-24). **A stamp engine multiplies the per-element draw count by the dab
count** — the fix the audit recommends (dirty bounds for the stroke buffer)
does not address it. A dab-count cap, a minimum spacing, or a dab budget per
stroke is a design decision the slice will have to make; none exists today.

### 10.2 Failure modes

| Failure | Trigger | Current behaviour | Relevance |
| --- | --- | --- | --- |
| Out-of-region coverage dropped | a stamp footprint wider than `strokeSampleBounds` | silent (live shows it, commit loses it) | §5.1 — **the** most likely corruption |
| Live ≠ commit at the start ring | the one-sample dab then a segment | fixed today by the `fromIndex <= 1` redraw (L305-316) | §5.12 — a dab engine must re-derive it |
| Self-darkening at a dab overlap | source-over accumulation of dabs | n/a today (no dabs) | §5.3 — the union rule |
| Divergent erase | live erase (whole buffer) vs rebuild erase (bounded region) | equal today by construction | §5.6 |
| Stroke buffer growth | a long stroke at a fine spacing | buffer is document-sized, so bounded | fine; the *draw-call* count is the risk (§10.1) |
| Aliasing of a non-primitive brush field | `brush: { ...brush }` (L55) | latent | §5.7 |
| A field silently dropped | missing `normalizeBrush` / `brushSettingsEqual` / `readBrush` entry | silent | §5.8 |
| Quantized UI response | the texture tile's 1/20 strength buckets (L1085) | visible for grain | §5.13 |
| A cancelled gesture leaving pixels | `cancelStroke` (L383-395) restores the erase snapshot | correct today | a stamp engine must use the same `cancelStroke` path |
| The eraser snapshot and the preview scratch alive together | — | prevented by construction (`beginStroke` L287) | a stamp engine that adds a *third* full-resolution surface (e.g. a dab coverage mask) would **break the 58-byte budget** → see §10.3 |

### 10.3 The raster budget is a hard constraint on the implementation

`docs/ARCHITECTURE.md` L774-812 and `docs/SESSION-BRIEF.md` §6 fix the peak at
`3 × 4 × 2² + 10 = 58` bytes per document pixel: the layer surface, the stroke
buffer, and **at most one** of {the erase snapshot, the grouped-preview
scratch}, plus a transient scan buffer.

A union/max coverage accumulation implemented as a **separate document-sized
buffer** (§5.3) would be a **fourth** full-resolution surface → 74 bytes per
document pixel → 1.16 GiB at the cap → **over the documented 1 GiB budget**.
The audit records that a previous attempt at exactly this shape (the "element
scratch" variant F7) was **reverted** (`2fa34cc`) partly because "it would
have moved the documented raster budget from 58 to 59 bytes per document
pixel" (`PERFORMANCE_AUDIT_2026-10-20.md` L14-18).

**Therefore:** any coverage-union mechanism must either reuse the existing
stroke buffer, or be bounded to the stroke's own footprint (as the feather
scratch is), or the budget must be re-documented. This is a hard constraint
from the audit, not a preference.

### 10.4 Known bugs in the current code

No correctness bug was found in the current rasterizer during this analysis.
The two things that are *wrong* are documentation defects (§9.3 stale comment,
§9.5 drifted anchors) and the open format-version conflict (§9.2).

---

## 11. Open questions (state the gap; do not guess)

| # | Question | Why it blocks | Next inspection required |
| --- | --- | --- | --- |
| **Q1** | Does the stamp engine require **format v9**, or is an additive off-by-default field enough? | Decides the writer, the reader, the validation rules and the version-rejection test | Coordinator decision against the rule in `SESSION-BRIEF.md` §6; if v9, the precedent is `readBrush` L696-717 (required field per version) + `parseProject` L510-514 (refuse newer) |
| **Q2** | What is the stamp-spacing control called, and is it one slider or several (spacing, hardness curve, texture type)? | The UI already uses "Spacing" for sample density (`BrushControls.tsx` L51-59) | A naming decision + a `README.md`/`ARCHITECTURE.md` wording update; no code inspection needed |
| **Q3** | Does a stamped brush's **fill-shape interior** get stamped dabs, or stay a flat polygon fill? | Changes the appearance of every filled rectangle/ellipse and interacts with §5.5 | Decide, then re-derive whether the fill-flag path (`rasterizeStroke` L184-195) stays a `ctx.fill()` |
| **Q4** | Is `spacing` provably non-appearance-changing under the chosen dab placement? | If not, `spacing` becomes appearance-changing → the format policy changes with it (§5.10) | Implement, then **test** it (§12, T-09) rather than rely on the derivation |
| **Q5** | How is the per-dab **union/max** coverage realised in Canvas 2D without a fourth full-resolution surface? | The technical core of the slice (§5.3) and constrained by the raster budget (§10.3) | Prototype against `PixelCanvas` (which implements `source-over`/`destination-out`/`destination-in`/`multiply`/`screen` only — L1523-1587); a `max` operation is **not** implemented in the harness and would have to be added |
| **Q6** | Does the union rule need to apply to the **eraser** too, and does `destination-out` against a union-ed buffer behave? | The eraser subtracts the buffer; a union-ed buffer has a different alpha profile | Decide, then test with the existing eraser pixel tests (`canvas2dRenderer.test.ts` L591-812) |
| **Q7** | Is the stamp engine allowed to change the **shape tools'** output? | Shapes share `rasterizeStroke` (§5.11); a stamped outline would look different from today's | The roadmap's "default unchanged" bar covers it only if the stamp is off by default; decide explicitly |
| **Q8** | What is the **dab budget** per stroke? | §10.1: up to ~5,461 dabs per stroke at a 0.75 px floor | A product decision; no code inspection needed, but it must be enforced somewhere |

---

## 12. Proposed minimal acceptance-test matrix

Each row states **what to assert and the expected value**, not "works".
Test files follow the repo's existing map (`AGENTS.md` §8). All Vitest tests
run on Node with the fake canvases; the browser check is separate and must be
reported separately (`docs/SESSION-BRIEF.md` §5.2-5.3).

### A. The default path is untouched (regression guard)

| ID | Where | Setup | Expected |
| --- | --- | --- | --- |
| T-01 | `canvas2dStroke.test.ts` | default brush, 3 samples | the recorded call sequence is **unchanged** from today: `["save","beginPath","moveTo","lineTo","stroke", …,"restore"]`, every `stroke` call at `alpha === 1`, `lineWidth` = the mean-pressure diameter (5 and 0.1 for the existing fixture) — i.e. the existing test at L129-140 stays green |
| T-02 | `canvas2dRenderer.test.ts` | hard brush, no stamp settings | the renderer blits the **raw** buffer 1:1 (the 9-argument `drawImage` with the identity transform), allocates **no** feather scratch, creates **no** pattern, and applies no filter — the existing test at L833 stays green |
| T-03 | `canvas2dRenderer.test.ts` | soft brush (`hardness 0.4`), no stamp settings | one blur of the padded bbox, then the same blit — the existing test at L852 stays green |
| T-04 | `canvas2dRenderer.test.ts` | grain brush (`texture 1`), no stamp settings | one `destination-in` pattern pass, unchanged — the existing test at L975 stays green |

### B. The stamp path itself

| ID | Where | Setup | Expected |
| --- | --- | --- | --- |
| T-05 | `canvas2dStroke.test.ts` | stamped stroke, straight path of length 100, spacing = 25 % of the diameter | the number of dab draw calls is exactly `ceil(100 / spacing) + 1` (±1 for the endpoint rule) and the call count is **deterministic** across two runs |
| T-06 | `canvas2dStroke.test.ts` | stamped stroke, spacing = 200 % of the diameter | the dab positions are evenly spaced by exactly `spacing` document px along the path (assert the recorded positions, not just the count) |
| T-07 | `canvas2dStroke.test.ts` | a stroke whose path bends | the dab at a bend carries the **path direction** at that point (the tangent), proving dabs follow the path, not the sample grid |
| T-08 | `canvas2dStroke.test.ts` | a single-sample press with stamp settings | exactly **one** dab is deposited, at the sample, with the stamp's diameter — matching the existing `stampDot` contract (L117-129) |

### C. Union / no-darkening (the core new invariant)

| ID | Where | Setup | Expected |
| --- | --- | --- | --- |
| T-09 | `canvas2dRenderer.test.ts` (pixel) | a stamped stroke that crosses itself, `opacity 0.5`, black on white paper | the crossing pixel is `rgb(128,128,128)` — **identical to the existing expectation at L2618**; stacking would give 64 |
| T-10 | `canvas2dRenderer.test.ts` (pixel) | two dabs of the same stroke overlapping, one with a soft edge | the alpha at the overlap equals `max(edgeA, coreB)` — the soft edge is **not** erased by the neighbour's core, and the two do not sum |
| T-11 | `canvas2dRenderer.test.ts` (pixel) | a stamped stroke at `opacity 1` over a painted stroke of the same colour | the two strokes still build up where they overlap (each stroke is a stroke) — the union rule is **per stroke**, not per layer |

### D. Path parity (live → commit → rebuild → undo → reopen → export)

| ID | Where | Setup | Expected |
| --- | --- | --- | --- |
| T-12 | `canvas2dRenderer.test.ts` (pixel) | stamped brush, `checkEveryPathAgrees`-style | the pixel at the sample point is **equal** (`toEqual`, not `toBeCloseTo`) across: rebuild, second rebuild, live preview, release, and `composeDocumentImage()` — the same four-way comparison the existing helper performs (L2547-2584) |
| T-13 | `canvas2dRenderer.test.ts` (pixel) | a stroke that grows from 1 sample to 3 | the live pixels after the 3rd sample equal the pixels a full re-rasterization of the same 3 samples produces (this is the §5.12 invariant, currently guarded by L378-414) |
| T-14 | `projectLifecycle.test.ts` | save → reopen | the reopened stroke's brush (including every stamp field) equals the saved one, and the rebuilt pixels are identical |
| T-15 | `commandStack.test.ts` / `drawingEngine.test.ts` | one stamped gesture | exactly **one** history entry; undo removes the stroke and leaves the layer pixel-identical to the pre-stroke state; redo restores the same pixels |

### E. Determinism and resolution

| ID | Where | Setup | Expected |
| --- | --- | --- | --- |
| T-16 | `canvas2dRenderer.test.ts` (pixel) | two stamped strokes with the **same path** but different bounding boxes | the RGBA at the same **document** pixel is identical (document-anchored variation, like the grain tile) |
| T-17 | `canvas2dRenderer.test.ts` (pixel) | the same stroke at `rasterScale 1` and `rasterScale 2` | the document-resolution pixel is identical within a tolerance of 1/255 — the "soft edge measures the same at raster scales 1 and 2" rule (`ARCHITECTURE.md` L329-331) extended to dabs |
| T-18 | `canvas2dRenderer.test.ts` (pixel) | the same stroke at zoom 1 and zoom 4 | the document-resolution pixel is identical (zoom never affects rasterized data) |
| T-19 | `canvas2dRenderer.test.ts` | a stamped stroke rasterized twice | byte-identical buffers (no `Math.random()`, no time) |

### F. Geometry / clipping (the §5.1 guard)

| ID | Where | Setup | Expected |
| --- | --- | --- | --- |
| T-20 | `canvas2dRenderer.test.ts` (pixel) | a stamped stroke, then `coverageInside(strokeBuffer, …)` | `coverageInside` returns **true** for the padded sample bounds — no coverage escapes the composited region (the existing helper at L2423-2440) |
| T-21 | `canvas2dRenderer.test.ts` (pixel) | a stamped stroke whose dab footprint is deliberately wide | the live preview pixel and the committed layer pixel at the **same** document point are equal (proves no coverage was dropped at commit) |
| T-22 | `canvas2dRenderer.test.ts` (draw-call) | a stamped stroke | the inked rectangle the rebuild touches still equals the stroke's footprint, and is **not** document-sized (the bounded-rebuild tests at L2442-2503 stay green) |

### G. Format

| ID | Where | Setup | Expected |
| --- | --- | --- | --- |
| T-23 | `projectFormat.test.ts` | a v-current file with the stamp fields | round-trips exactly; `payload.layers[0].elements[0].brush.<field>` equals the value written |
| T-24 | `projectFormat.test.ts` | a v1–v8 file | opens unchanged; the stamp fields default to the values that make the **segment path** the output (the v5/v6 precedent, L545-567) |
| T-25 | `projectFormat.test.ts` | a v-current file with a stamp field missing / out of range / non-numeric | **refused** with a message naming the field (the `hardness`/`texture` precedent, L887-940) |
| T-26 | `projectFormat.test.ts` | a file with `version = PROJECT_VERSION + 1` | **refused** with "this build reads up to N" (the existing test at L807 stays green) |
| T-27 | `projectFormat.test.ts` | a v1–v8 file **and** a v-current file, same stroke | the two files produce the **same pixels** for the same stroke (the "old projects open unchanged" bar) |

### H. Editor state and UI

| ID | Where | Setup | Expected |
| --- | --- | --- | --- |
| T-28 | `drawingEngine.test.ts` | `engine.setBrush({ <stamp field>: x })` | the history depth is unchanged and the dirty flag is unchanged (the existing pattern at L174-212) |
| T-29 | `drawingEngine.test.ts` | draw with stamp settings, then change the settings | the committed stroke's brush keeps the values it was drawn with; a later stroke takes the new ones (the existing pattern at L254-294) |
| T-30 | manual (browser) | the toolbar | a stamp control exists, is labelled unambiguously (**not** "Spacing" alone — §9.4), and is **absent** if the engine does not honour it (no placeholders) |

### I. Performance sanity

| ID | Where | Setup | Expected |
| --- | --- | --- | --- |
| T-31 | `canvas2dRenderer.test.ts` (draw-call) | a stroke of length 4000 with spacing 10 % of the diameter | the dab count is `≈ 4000 / (0.1 × size) + 1` and is **bounded** by an explicit per-stroke cap (Q8); the assertion is on the count, not on wall-clock |
| T-32 | `canvas2dRenderer.test.ts` (draw-call) | the renderer's allocated canvases after a stamped stroke | the number of document-sized surfaces is **unchanged** (no fourth surface — §10.3) |

---

## 13. Appendix — symbol index at the analysed commit

| Symbol | File | Lines |
| --- | --- | --- |
| `SOFT_EDGE_RADIUS_RATIO` | `src/core/rendering/canvas2dStroke.ts` | 32 |
| `strokeFeatherRadius` | `src/core/rendering/canvas2dStroke.ts` | 43-49 |
| `TEXTURE_TILE_SIZE` / `TEXTURE_MIN_COVERAGE` | `src/core/rendering/canvas2dStroke.ts` | 52 / 54 |
| `textureCoverage` | `src/core/rendering/canvas2dStroke.ts` | 65-79 |
| `strokeDiameter` | `src/core/rendering/canvas2dStroke.ts` | 82-85 |
| `strokeOpacity` | `src/core/rendering/canvas2dStroke.ts` | 97-108 |
| `stampDot` | `src/core/rendering/canvas2dStroke.ts` | 117-129 |
| `rasterizeStroke` | `src/core/rendering/canvas2dStroke.ts` | 151-207 |
| `BrushSettings` | `src/types/brush.ts` | 11-67 |
| `DEFAULT_BRUSH` | `src/core/brushes/defaults.ts` | 15-26 |
| `normalizeBrush` / `updateBrushSettings` / `brushSettingsEqual` | `src/core/brushes/defaults.ts` | 29-42 / 44-49 / 52-65 |
| `MAX_INTERPOLATED_POINTS` / `MAX_INTERPOLATION_DISTANCE` / `MIN_SAMPLE_DISTANCE` / `MIN_SPACING_STEP` / `STABILIZER_MAX_LAG` | `src/core/brushes/strokeBuilder.ts` | 22 / 27 / 29 / 31 / 39 |
| `createStrokeRecord` / `cloneStroke` | `src/core/brushes/strokeBuilder.ts` | 46-64 / 71-84 |
| `StrokeBuilder.addSample` / `finish` / `append` | `src/core/brushes/strokeBuilder.ts` | 114-175 / 186-196 / 198-209 |
| `StrokeRecord` | `src/core/document/types.ts` | 76-104 |
| `LayerElement` | `src/core/document/types.ts` | 176 |
| `Canvas2DRenderer` | `src/core/rendering/Canvas2DRenderer.ts` | 109-1295 |
| `textureTiles` cache | `src/core/rendering/Canvas2DRenderer.ts` | 121 |
| `beginStroke` / `extendStroke` / `replaceStroke` / `endStroke` / `cancelStroke` | `src/core/rendering/Canvas2DRenderer.ts` | 279-293 / 295-325 / 336-345 / 347-381 / 383-395 |
| `render` / `paintDocument` | `src/core/rendering/Canvas2DRenderer.ts` | 405-443 / 628-676 |
| `buildPreviewGroup` / `ensurePreviewSurface` | `src/core/rendering/Canvas2DRenderer.ts` | 686-714 / 717-732 |
| `rasterizeLayer` | `src/core/rendering/Canvas2DRenderer.ts` | 765-785 |
| `rasterizeStrokeToBuffer` / `clearStrokeBufferRegion` | `src/core/rendering/Canvas2DRenderer.ts` | 879-888 / 891-898 |
| `strokeSampleBounds` / `strokeRegion` | `src/core/rendering/Canvas2DRenderer.ts` | 908-927 / 935-949 |
| `compositeStrokeBuffer` | `src/core/rendering/Canvas2DRenderer.ts` | 961-981 |
| `paintStrokeCoverage` | `src/core/rendering/Canvas2DRenderer.ts` | 997-1047 |
| `applyStrokeTexture` / `textureTile` | `src/core/rendering/Canvas2DRenderer.ts` | 1058-1081 / 1084-1108 |
| `featherStroke` / `ensureFeatherBuffer` | `src/core/rendering/Canvas2DRenderer.ts` | 1123-1164 / 1167-1175 |
| `beginErase` / `applyErase` / `restoreEraseBase` | `src/core/rendering/Canvas2DRenderer.ts` | 1186-1202 / 1205-1224 / 1234-1247 |
| `prepareStrokeBuffer` / `clearStrokeBuffer` / `dropPreviewSurface` | `src/core/rendering/Canvas2DRenderer.ts` | 1279-1285 / 1287-1294 / 1275-1277 |
| `DrawingRenderer` (the boundary) | `src/core/rendering/types.ts` | 46-108 |
| `LayerSurfaceStore.prepare` / `clear` | `src/core/rendering/layerSurfaceStore.ts` | 96-105 / 107-114 |
| `DrawingEngine.setBrush` | `src/core/engine/DrawingEngine.ts` | 836-844 |
| `DrawingEngine.beginStroke` / `extendStroke` | `src/core/engine/DrawingEngine.ts` | 1056-1083 / 1085-1094 |
| `DrawingEngine.finishStroke` / `cancelStroke` | `src/core/engine/DrawingEngine.ts` | 1408-1445 / 1447-1454 |
| `PROJECT_VERSION` | `src/core/project/projectFormat.ts` | 87 |
| serializer (stroke element) | `src/core/project/projectFormat.ts` | 451-465 |
| `readBrush` | `src/core/project/projectFormat.ts` | 686-719 |
| newer-version rejection | `src/core/project/projectFormat.ts` | 510-514 |
| `BrushControls` | `src/features/brushes/BrushControls.tsx` | 15-105 |
| `EditorActions.setBrush` | `src/state/editorStore.ts` | 26, 86 |
| `BrushTool` | `src/core/tools/brushTool.ts` | 17-59 |
| `RecordingCanvas` / `RECORDED_METHODS` | `src/test/support/recordingCanvas.ts` | 51-211 / 15-31 |
| `PixelCanvas` | `src/test/canvas2dRenderer.test.ts` | 1498-2059 |
| `withPixels` / `readPixel` / `expectPixel` | `src/test/canvas2dRenderer.test.ts` | 2127-2170 / 2083-2090 / 2092-2104 |
| `coverageInside` | `src/test/canvas2dRenderer.test.ts` | 2423-2440 |
| `checkEveryPathAgrees` | `src/test/canvas2dRenderer.test.ts` | 2540-2586 |
