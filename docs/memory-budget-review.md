# Memory budget review — stamp (dab) brush engine

**Reviewer role:** Agent 4 follow-up (memory budget verification).
**Scope:** validate the memory accounting and cache lifecycle in
`docs/architecture-port-plan.md` against the live tree.

**Status:** review only. **No production code or test was modified.** Two files
were changed: this review, and `docs/architecture-port-plan.md` (corrections only,
listed in §9 and marked in the document).

**Tree reviewed:** `main` at `ad2ef11` **plus the uncommitted stamp implementation**
in the working tree (`src/core/rendering/stampCoverage.ts` is new; `src/types/brush.ts`,
`src/core/brushes/defaults.ts`, `src/core/engine/DrawingEngine.ts`,
`src/core/project/projectFormat.ts`, `src/core/rendering/Canvas2DRenderer.ts` and
`src/features/brushes/BrushControls.tsx` are modified; the branch is **not
committed**). Because an implementation exists, this review checks the plan's
*claims* against that implementation rather than against the plan alone.

**Headline result:** the plan's central memory claim — *"the peak moves from 58 to
62 bytes per document pixel"* — **is not supported by the evidence and is
wrong**. The documented 58 B/doc-pixel envelope **still holds** (worst observed
scenario: 56 B/doc px), *provided* one allocation is bounded: the rebuild path's
`putImageData` upload buffer, which today can be **document-sized (256 MiB at
the cap)**. One correctness/robustness finding is also material: the
implementation has **no dab budget**, so a hostile or merely large project file
can drive the renderer out of memory.

---

## 1. Method and limits of this review

**Read in full:** `src/core/document/document.ts` (L1–130), `src/core/rendering/stampCoverage.ts`
(all 323 lines), `src/core/rendering/layerSurfaceStore.ts` (119), the stamp-related
diff of `src/core/rendering/Canvas2DRenderer.ts`, the diffs of
`src/types/brush.ts`, `src/core/brushes/defaults.ts`, `src/core/engine/DrawingEngine.ts`,
`src/core/project/projectFormat.ts`, `src/core/fill/floodFill.ts` (L95–190),
`src/test/documentRasterBudget.test.ts` (L30–74), and the `fae138c` commit that
introduced the budget model.

**Verified by reading code:** every allocation site listed in §3, the device-pixel
grid of the coverage map, and the lifecycle of both coverage maps.

**Not verified (explicitly):**

- **No timing was measured.** Every millisecond figure in §7 is **arithmetic**,
  derived from the code's own loop bounds. `docs/PERFORMANCE_AUDIT_2026-10-20.md`
  F7e records that harness timings in this project did not reproduce on an idle
  machine; the same caution applies here, and more strongly, because no
  measurement was taken at all.
- **No memory was measured.** The byte counts are derived from the allocation
  sizes in the code, not from a heap profile.
- **Nothing was run in the packaged Tauri app**, and no canvas behaviour was
  observed in a browser. The `putImageData` performance risk in §6.4 is a
  *mechanism-level* concern taken from the audit's F7b, not an observation.
- **The browser's canvas backing store is not necessarily 4 bytes/pixel.**
  `RASTER_SURFACE_BYTES_PER_PIXEL = 4` is the repo's model
  (`src/core/document/document.ts` L61); the model itself says it is "a guard on
  calculable backing-store pixels, not a promise about browser, GPU or compositor
  overhead" (L57–59).

---

## 2. Source evidence: where the 58 bytes per document pixel comes from

The budget is **code, not prose**. The authoritative source is
`src/core/document/document.ts` L17–98:

| Constant | Value | Meaning |
| --- | --- | --- |
| `RASTER_SURFACE_BYTES_PER_PIXEL` | 4 | RGBA backing store, `document.ts` L61 |
| `BUDGETED_RASTER_SCALE` | 2 | HiDPI supersampling factor, L62 |
| `BUDGETED_FULL_RES_SURFACES` | 3 | "Layer surface + stroke buffer + one of {erase snapshot, preview scratch}", L63–64 |
| `BUDGETED_SCAN_BYTES_PER_PIXEL` | 10 | "A bucket scan's composite + `ImageData` + visited bitmap + mask", L65–66 |
| `PEAK_BYTES_PER_DOCUMENT_PIXEL` | **58** | `3 * 4 * 2 * 2 + 10`, L69–74 |
| `RETAINED_SCRATCH_BYTES_PER_DOCUMENT_PIXEL` | 74 | The over-budget case if the preview scratch lingers, L81–86 |
| `DOCUMENT_RASTER_BUDGET_BYTES` | 1 GiB | L67 |
| `MAX_DOCUMENT_PIXELS` | 16,777,216 | 4096 × 4096, L92 |

**What the 58 explicitly includes** (`document.ts` L22–43, the commit message of
`fae138c`):

1. Two **always-resident** 2× RGBA surfaces: the **layer surface** and the **live
   stroke buffer** — 32 B/doc px.
2. **At most one** further 2× RGBA surface — the **erase snapshot** (alive only
   while an eraser is in flight) *or* the **grouped live-preview scratch** — 16
   B/doc px. They are mutually exclusive **by construction**, because an eraser
   previews by mutating its own layer surface.
3. **One transient scan buffer** — 10 B/doc px: a bucket scan's composite
   `ImageData` (4) + visited bitmap (1) + mask (1) + the scan stack (allowance
   ~4). The PNG export composite (4 B/doc px at 1×) is covered by the same
   allowance.

**What it explicitly excludes** (`document.ts` L51–55):

- The **display canvas** (sized by the viewport, not the document).
- The **feather scratch** (sized by the stroke's own bounding box).
- **Every layer beyond the first**: "the model covers a one-layer document plus
  its working buffers, not an unbounded layer stack". Each extra layer adds
  another full 16 B/doc px surface — a documented gap, not a rounding error.

The model is asserted in `src/test/documentRasterBudget.test.ts` L31–71
(`PEAK_BYTES_PER_DOCUMENT_PIXEL === 3 * 4 * 2 * 2 + 10`, `PEAK_DOCUMENT_RASTER_BYTES === 973_078_528`,
and the 74 B/doc px case being *over* the budget), and it is restated in
`docs/PERFORMANCE_AUDIT_2026-10-20.md` F5 and in `docs/ARCHITECTURE.md` L774–812.

**Structural reading of the model:** it is *"three full-resolution surfaces plus
**one** transient"*. Any new allocation has to be classified: is it a fourth
full-resolution surface (forbidden — 74 B/doc px is already over budget), a
transient that replaces the 10 B/doc px scan allowance, or something the model
does not cover at all?

---

## 3. Allocation inventory (verified against the code)

Every row is a real allocation in the live tree. "B/doc px" is the cost at
`rasterScale = 2` (the budgeted scale) for a 4096 × 4096 document
(16,777,216 doc px → 268,435,456 B = 256 MiB per 2× surface).

| # | Allocation | Site | Dimensions | Lifetime | B/doc px |
| --- | --- | --- | --- | --- | --- |
| 1 | Layer surface (**per layer**) | `layerSurfaceStore.ts` L52–69 (`ensure`) | doc × `rasterScale` | until the layer is dropped | 16 **each** |
| 2 | Live stroke buffer | `Canvas2DRenderer.ts` L204 (created), L247/L283 (resized) | doc × `rasterScale` | the renderer's lifetime | 16 |
| 3 | Erase snapshot | `Canvas2DRenderer.ts` L1341 (`beginErase`) | layer-surface size | during an erasing stroke | 16 |
| 4 | Grouped-preview scratch | `Canvas2DRenderer.ts` L758 (`ensurePreviewSurface`) | doc × `rasterScale` | while a grouped preview is on screen | 16 |
| 5 | Feather scratch | `Canvas2DRenderer.ts` L1322 (`ensureFeatherBuffer`) | stroke bbox × `rasterScale` | resident after the first soft stroke | ≤16 (bbox-bounded) — *excluded by the model* |
| 6 | Probe canvas | `Canvas2DRenderer.ts` L776 | 1 × 1 | resident | ~0 |
| 7 | Export composite canvas | `Canvas2DRenderer.ts` L551–562 | doc at **1×** | during an export | 4 |
| 8 | Composite `ImageData` (bucket fill) | `Canvas2DRenderer.ts` L844–853 | doc at 1×, 4 B/px | during a fill | 4 (inside #9's 10) |
| 9 | Fill scan buffers | `floodFill.ts` L103 (`visited`), L105 (`stack`), L178 (`mask`) | doc-sized | during a fill | ~6 (inside the 10) |
| 10 | **Stamp coverage tiles — in-flight** | `Canvas2DRenderer.ts` L181 (`stampCoverage`), `stampCoverage.ts` L297 | 64 × 64 **device** px tiles, 1 B/px | during a stamped stroke | **≤4** |
| 11 | **Stamp coverage tiles — rebuild scratch** | `Canvas2DRenderer.ts` L185 (`stampScratch`) | 64 × 64 device px tiles, 1 B/px | **resident** after the first stamped rebuild | **≤4** |
| 12 | **Stamp upload `ImageData`** | `Canvas2DRenderer.ts` L1034 (`createImageData`) | dirty rect × 4 B/px | during the upload | **≤16** (document-sized in the rebuild path!) |
| 13 | `Map` overhead for the tile index | `stampCoverage.ts` L168 | ~16,384 entries at the cap | with the map | ~0.06 (heap, outside the model) |

**Item 10/11 are JS heap, not canvas backing stores.** The budget model is
explicitly about "calculable backing-store pixels" (`document.ts` L57–59), so a
`Uint8ClampedArray` is *strictly outside* the model's scope — but it is real
memory and is counted here anyway. Items 1–9 and 12 are canvas or canvas-adjacent
buffers.

---

## 4. The peak calculation

### 4.1 Per-scenario peak at the cap (4096 × 4096, `rasterScale = 2`)

| Scenario | 1 layer | stroke buffer | 3rd surface | scan buffer | in-flight tiles | resident tiles | upload `ImageData` | **B/doc px** | **MiB** | ≤ 58? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A — idle | 16 | 16 | 0 | 0 | 0 | ≤4 | 0 | ≤36 | 576 | ✅ |
| B — bucket fill | 16 | 16 | 0 | 10 | 0 | ≤4 | 0 | ≤46 | 736 | ✅ |
| C — stamped brush stroke | 16 | 16 | 0 | 0 | ≤4 | ≤4 | 0 | ≤40 | 640 | ✅ |
| D — stamped **eraser** stroke | 16 | 16 | 16 | 0 | ≤4 | ≤4 | 0 | **≤56** | **896** | ✅ |
| E — grouped preview + stamped stroke | 16 | 16 | 16 | 0 | ≤4 | ≤4 | 0 | **≤56** | **896** | ✅ |
| F — layer rebuild of stamped elements | 16 | 16 | 0 | 0 | 0 | ≤4 | ≤16 | ≤52 | 832 | ✅ |
| G — **rebuild during a grouped preview** | 16 | 16 | 16 | 0 | ≤4 | ≤4 | ≤16 | **≤72** | **1152** | ❌ **over the 1 GiB budget** |

> **Resolved by the design in `docs/architecture-port-plan.md` §19.2.** With the
> coverage uploaded **per tile** (one reused 64 × 64 `ImageData` = 16 KiB), the
> upload term drops from ≤ 16 B/doc px to ≤ 0.005 B/doc px, and scenario G falls
> to **≤ 56.005 B/doc px (896 MiB)** — inside the documented envelope. See
> §11 of this review for the recalculated envelope.

Mutual exclusions that make the table work (all verified in code):

- A fill cannot run during a stroke and vice versa —
  `DrawingEngine.ts` L1069, L1208, L1328 all refuse when another gesture is
  active. So the 10 B/doc px scan buffer never coexists with a coverage map.
- The erase snapshot and the grouped-preview scratch never coexist — an eraser
  previews by mutating its own layer, so no group is built
  (`Canvas2DRenderer.ts` L305–306: `beginStroke` drops the preview scratch
  before taking the snapshot).
- Undo/redo and layer edits are refused during a gesture
  (`DrawingEngine.ts` L1028–L1054 `isGestureActive`), so a rebuild normally
  happens with no gesture in flight → scenario F, not G.

### 4.2 What this means for the plan's claim

The plan said (§9.3): *"the peak moves from 58 to **62** bytes per document
pixel (1 byte per device pixel over the inked area at `rasterScale = 2`), i.e.
992 MiB at the cap"*.

**That arithmetic treats the coverage cache as additive to the model's transient
allowance. It is not.** The model is *"3 surfaces + **one** transient"*; the
coverage caches are transients, and the two of them together (4 + 4 = 8 B/doc px)
fit **inside** the existing 10 B/doc px transient allowance. Concretely:

- Scenarios C, D and E (the live stroke cases) peak at **56 B/doc px**, i.e.
  **896 MiB** — *below* the documented 928 MiB envelope, with 2 B/doc px of
  headroom instead of a 4 B/doc px overrun.
- The **documented envelope does not need to change**. What changes is the
  *headroom*: the transient allowance drops from 10 B/doc px of slack to 2.

The plan's "62 B/doc px" and the resulting "992 MiB" are therefore **not
supported** and must be corrected.

### 4.3 The one allocation that breaks the envelope

**Scenario G is the finding.** It needs a layer rebuild to happen while a
grouped preview is alive. The grouped preview exists only while a gesture is in
flight, and undo/redo and layer edits are refused during a gesture — but the
*layer surface* can still be **dirty** when the gesture starts (the scheduler
coalesces repaints into animation frames, `frameScheduler.ts`, so a change made
in the previous frame may not have been repainted yet). In that window, the
next `render()` re-rasterizes the layer (`ensureRasterized` → `rasterizeLayer`
→ `rasterizeStrokeToBuffer` → `rasterizeStampStroke`) **while the preview
scratch is alive**, and the rebuild's upload buffer is document-sized (§4.4).

The window is narrow (it needs an invalidation and a press inside one frame),
but it is reachable: the keyboard-undo-then-click case lands in it.

**With the upload bounded (see §8, recommendation 1), scenario G becomes
16+16+16+4+4+≤0.25 ≈ 56 B/doc px and the envelope holds unconditionally.**

### 4.4 The upload buffer is document-sized in the rebuild path

`writeStampCoverage` (`Canvas2DRenderer.ts` L1019–1037) creates one `ImageData`
for the **whole dirty rectangle**:

```
const image = this.strokeCtx.createImageData(width, height);   // L1034
coverage.writeRect(image.data, width, {...}, rgb);              // L1035
this.strokeCtx.putImageData(image, left, top);                 // L1036
```

In the **live** path the dirty rect is the union of the *new* dabs' boxes — small.
In the **rebuild** path (`rasterizeStampStroke`, L989–1010) the dirty rect is the
union of **all** the stroke's dabs, i.e. the stroke's bounding box. For a
document-wide stroke at `rasterScale = 2`:

```
8192 × 8192 px × 4 bytes = 268,435,456 bytes = 256 MiB
```

That is a **full-resolution allocation** — precisely the shape the budget model
forbids ("A union/max coverage accumulation implemented as a separate
document-sized buffer would be a fourth full-resolution surface",
`docs/g1/feature-analysis.md` §10.3). It is transient (freed after the call), but it is
allocated **per element** during a rebuild: a 100-element layer of
document-wide strokes would allocate and discard 100 × 256 MiB.

> **The design that closes it:** `docs/architecture-port-plan.md` §19.2 — upload
> **per coverage tile** (64 × 64 device px), with one reused 16 KiB `ImageData`
> per renderer. The temporary allocation becomes ≤ 80 KiB regardless of the
> stroke's size, and the coverage buffer mirrors the map tile by tile.

The coverage *map* is correctly tiled (`stampCoverage.ts` L167–300, 64 × 64 device
px tiles) — it is only the **upload** that is unbounded. The plan (§8.2 step 3)
specified per-tile uploads; the implementation batches per dirty rect.

---

## 5. Cache lifecycle and scaling risks

### 5.1 The coverage map is measured in **device** pixels ✅ (the plan's assumption holds)

Verified in code: `extendStampStroke` and `rasterizeStampStroke` pass
`dab.x * scale`, `dab.y * scale`, `dab.radius * scale`
(`Canvas2DRenderer.ts` L964–970, L996–1002), and `paintDab` documents "The dab
is given in device pixels, because that is the grid the coverage is kept on"
(`stampCoverage.ts` L172–176). Tiles are 64 × 64 **device** px
(`COVERAGE_TILE_SIZE`, `stampCoverage.ts` L38) and each is one byte per pixel
(`new Uint8ClampedArray(64 * 64)`, L297).

Therefore:

| `rasterScale` | device px per doc px | coverage cost per doc px of footprint |
| --- | --- | --- |
| 1 | 1 | **1 byte / doc px** |
| 2 (budgeted) | 4 | **4 bytes / doc px** |

The budgeted scale is 2 (`BUDGETED_RASTER_SCALE`), so **4 B/doc px is the number
to use** — the plan's figure was right on this point.

**High-DPI note:** `rasterScale` is `clamp(devicePixelRatio, 1, 2)`, so the same
document costs 4× more coverage on a 2× display. The budget model already
assumes the 2× worst case (`BUDGETED_RASTER_SCALE = 2`), so the estimate is
already the pessimistic one. ✅

### 5.2 Tile granularity — the waste is bounded and small

A tile is 64 × 64 device px = **4096 bytes**. A dab of device radius *r* touches
the tiles covering its (2r+2)² box:

- **Large brush / dense stroke:** the tiles tile the device grid exactly — a
  document-wide stroke at 2× is 16,384 tiles = **67,108,864 B = 64 MiB**, with no
  waste (the footprint is the grid).
- **Small brush:** a size-6 brush at 2× has r = 6 device px → a 14 × 14 box →
  1–4 tiles → up to 16 KB allocated for ~200 useful bytes. The overhead is
  bounded by the tile granularity (≤ 3 extra tiles per dab) and is small in
  absolute terms.

The `Map` index costs ~50–80 B/entry → ~1 MB at 16,384 entries. That is heap, so
it sits outside the canvas budget model (§3, item 13).

### 5.3 Lifecycle of the two coverage maps

| Event | In-flight map (`stampCoverage`, L181) | Rebuild scratch (`stampScratch`, L185) |
| --- | --- | --- |
| `beginStroke` (L297) | **new map allocated** per stroke ✅ | untouched |
| `extendStroke` | new dabs painted into it; the map is the authority ✅ | untouched |
| `endStroke` (L415; the erase branch L405) | **released** — `dropStampCoverage()` sets it to `null` ✅ | untouched |
| `cancelStroke` (L432) | **released** ✅ | untouched |
| `destroy` (L652) | **released** ✅ | untouched (the object dies with the renderer) |
| `abandonStroke` (L1415–1418) — also called by `setRasterScale` (L284) | **released** ✅ | untouched |
| `rasterizeStampStroke` (L989–991) | — | `clear()`ed at the **start** of each stroke → holds at most **one** stroke's footprint ✅, but is **never cleared afterwards** ⚠ |
| `setDocument` | not touched — relies on the engine aborting strokes before a document swap (the same contract the legacy path relies on, L233–238) | not cleared ⚠ — the old document's tiles linger |

**Two findings:**

1. **The rebuild scratch is resident, not transient.** After the first stamped
   rebuild it holds up to one stroke's footprint (64 MiB at the cap) for the
   renderer's lifetime. It fits the envelope (§4.2), but the model's language is
   "one *transient*", and a resident 64 MiB that is never released is not that.
   *Recommendation: clear it when the rebuild batch ends.*
2. **`setRasterScale` is handled correctly** ✅ — it calls `abandonStroke()`
   (L284), which drops the in-flight map; the next sample takes the defensive
   path (L317–327), which allocates a **new** map and re-plans from dab 0. The
   device-pixel grid of the old map is therefore never reused at the wrong
   scale. The plan's §8.4 requirement ("the cursor must be reset") is satisfied
   in the implementation.

### 5.4 No dab budget — the most serious finding

The plan's Q8 answer (§2.3) requires **a deterministic per-stroke dab budget**,
because the path length in a project file is **not bounded**.

Verified: `readSampleArray` (`projectFormat.ts` L681–697) checks only that each
sample is a **finite number** — there is **no coordinate bound**. The sample
count is bounded (`MAX_PROJECT_SAMPLES = 5,000,000`, L109), but the *distance*
between samples is not.

Consequences in `stampDabs` (`stampCoverage.ts` L90–134), which places one dab
every `stampSpacing(brush) = max(size * stampSpacing, 0.5)` document px
(L72–74):

| Input | Dabs | Consequence |
| --- | --- | --- |
| Two samples at ±10⁹ doc px (a legal file) | ≈ 2 × 10⁹ / 0.5 = **4 × 10⁹** | `stampDabs` allocates one object per dab → **OOM on open** |
| 5 M samples 1 px apart (legal: at the sample ceiling) with a 512 px brush | 5 M / 10.24 ≈ **488 k** dabs | 488 k × 1.05 M device px = **5 × 10¹¹** pixel evaluations in the rebuild → hours |
| A legitimate 5 M-sample stroke with a 1 px brush | 10 M dabs | the dab list alone is ~10 M objects ≈ 560 MB |

The **legacy segment path is not affected**: `strokeRegion`
(`Canvas2DRenderer.ts` L935–949) clamps the stroke's rectangle to the buffer, so
a stroke spanning 2 × 10⁹ px simply paints off-document pixels.

So the stamp path introduces a **new denial-of-service vector**: a project file
that is legal under the current parser can exhaust memory or freeze the renderer
when opened. The codebase already guards the analogous cases with explicit
ceilings (`MAX_PROJECT_SAMPLES`, `MAX_PROJECT_FILL_PIXELS`,
`MAX_FILL_SCAN_PIXELS`), so the convention is established — the stamp path needs
the same guard. **This is the highest-priority item in this review.**

### 5.5 Re-planning cost per event — **closed by the implementation**

`extendStampStroke` used to call `stampDabs(stroke, stroke.brush)` — the **whole**
dab list recomputed on every pointer event — so only the new dabs were painted
(`for (let index = this.stampDabCount; ...)`).

**The tree now has `StampDabCursor`** (`src/core/rendering/stampCoverage.ts`
L110–179), which walks only the samples the pointer has just added and carries
the remainder of the last segment across calls. The live path's planning cost is
therefore O(new samples) per event and O(samples) per stroke ✓. The cursor is an
*accelerator, not a second source of truth* (its own doc comment): the dabs it
returns are the ones the full walk would produce.

The rebuild path still walks the whole path once per element, which is why the
design's Bound 3 (a sample-walk cap) matters — see
`docs/architecture-port-plan.md` §19.3.2.

### 5.6 Adjacent finding (not memory): the colour fallback

`writeStampCoverage` uses `hexToRgb(color) ?? { r: 0, g: 0, b: 0 }`
(`Canvas2DRenderer.ts` L1032). `hexToRgb` only parses hex
(`src/utils/color.ts` L40), and `readBrush` accepts **any** non-empty CSS colour
string (`projectFormat.ts` L699–704). A hand-written project with
`color: "rgb(0,0,255)"` would paint **black** instead of blue — silently, and
only for stamped strokes (the legacy path hands the string to `ctx.fillStyle`
and the canvas parses it). The plan's §7.3 required an *exact* fallback (a 1×1
canvas probe). Cheap to fix, and it is a wrong-picture bug, not a crash.

---

## 6. `putImageData` semantics review

### 6.1 Does it preserve the required pixel semantics? **Yes.**

`putImageData(imageData, dx, dy)` **replaces** the destination pixels — including
alpha — and ignores the context's transform, clip, `globalAlpha` and
`globalCompositeOperation`. That is exactly what the union needs:

- **Replacement, not compositing** → the uploaded rect carries the *union* value
  for every pixel, so no source-over accumulation occurs. The no-self-darkening
  invariant holds by construction. ✅
- **Ignoring the transform** → the upload must be in device pixels. The
  implementation does this correctly: the rect is clipped to the buffer first
  (`left = Math.max(0, rect.left)` … L1024–1028) and the comment explains why —
  "an image put at a negative offset would shift the whole coverage rather than
  crop it". ✅
- **Straight (non-premultiplied) RGBA in, premultiplied internally**: the
  implementation writes the brush colour with the coverage as alpha
  (`stampCoverage.ts` L266–279), so the composite applies the stroke's opacity
  once, exactly like the legacy path. ✅
- **Colour round-trip**: because the canvas stores premultiplied RGBA8, a
  partially covered pixel's colour can shift by ≤ 1/255 relative to a
  canvas-drawn stroke. This does **not** affect the legacy path, and it does not
  affect the stamp path's internal consistency: live, commit, rebuild and export
  all upload the *same bytes*, so they agree exactly. ✅ (Worth one line in the
  slice's notes, because the project's own precedent — the F7 revert — turns on
  a 1/255 difference.)

### 6.2 Does it introduce extra full-resolution allocations? **Yes — see §4.4.**

The `ImageData` created at `Canvas2DRenderer.ts` L1034 is sized to the whole
dirty rectangle, which in the rebuild path is the stroke's bounding box: up to
**256 MiB** at the cap. The *coverage map* is tiled; the *upload* is not.

### 6.3 Does it change unrelated rendering behaviour? **No.**

`putImageData` writes only inside the target rectangle; the rest of the stroke
buffer is untouched. The legacy path is untouched (`isStamped`,
`Canvas2DRenderer.ts` L941–943, gates every stamp branch). The stroke buffer's
own lifecycle (clear on begin, clear on end, region clear before a rebuild) is
unchanged.

### 6.4 One unverified performance risk

`putImageData` writes into the **document-sized** stroke buffer. The audit's F7b
measured that "a draw from a just-written canvas" costs a *whole-canvas* readback
(7.85 ms from a 2048² source in that harness), and F7e later showed those
timings do not reproduce on an idle machine. The legacy path also writes into
the same buffer (with `arc`/`stroke`), so the *condition* already exists — but
`putImageData` is a bulk CPU-side write rather than incremental GPU draws, so
the cost profile may differ. **Unverified.** It must be measured in the packaged
app before the slice is called done, and it is one more reason to upload in
bounded chunks rather than one document-sized image.

---

## 7. Strategy comparison: coverage cache vs no cache

**Strategy A — keep the coverage map (as implemented).** Per event: plan all
dabs (O(n)), paint only the new ones into the map, upload the dirty rect.
**Strategy B — no map.** Per event: plan all dabs and recompute the whole union
from scratch; nothing persists between events.

Memory difference (at the cap, `rasterScale = 2`, a document-wide stroke):

| | A (cache) | B (no cache) |
| --- | --- | --- |
| Coverage heap | ≤ 4 B/doc px (in-flight) + ≤ 4 (resident scratch) | 0 |
| Upload `ImageData` | ≤ 16 B/doc px (unbounded) — *identical in both* | ≤ 16 B/doc px |
| Worst scenario peak (D/E) | ≤ 56 B/doc px | ≤ 48 B/doc px |

So the cache costs **≤ 8 B/doc px** (≈ 128 MiB at the cap, heap) and buys the
time behaviour below.

**Time (arithmetic estimates, not measurements).** Per dab, `paintDab`
(`stampCoverage.ts` L177–237) iterates the dab's box, `(2r+1)²` device px, with
an early-out for already-saturated pixels (L211–214). Total work is therefore
`Σ over dabs of (2r+1)²`:

| Scenario | Dabs | Box (device px) | **A: total box px** | **B: total box px** | B / A |
| --- | --- | --- | --- | --- | --- |
| S1 typical: size 8, spacing 10 % (0.8 px), path 1000 px, 1250 events | 1 250 | 18 × 18 = 324 | 405 k | 253 M | **625×** |
| S2 long: size 8, path 5000 px, 6250 events | 6 250 | 324 | 2.0 M | 6.3 G | **3 125×** |
| S3 big brush: size 512, spacing 2 % (10.24 px), path 2000 px, 250 events | 195 | 1026 × 1026 = 1.05 M | 205 M | 25.7 G | **125×** |
| S4 worst legal file: 5 M samples, size 512, path 5 M px | ~488 k | 1.05 M | 513 G | — | unbounded |

The per-event cost in strategy A is dominated by the **new** dabs' box area,
which the cache does not reduce — for S3 that is ~1.7 M device px per event
(≈ 1–3 ms by the saturated early-out, *estimated*). The cache's benefit is that
it removes the *recomputation of old dabs*, which is what turns B's O(n²) into
A's O(n).

**Reading:** the cache is not a memory optimisation with a time cost — it is what
makes the live path affordable at all for anything but short strokes, and it
costs ≤ 8 B/doc px of heap inside an envelope that has room for it. **The
deciding factor is time, not memory.** The memory difference between the two
strategies is ≤ 14 % of the envelope.

**Neither strategy fixes the real driver.** The dominant cost in both is
`path length × (2r+1)² / spacing` — i.e. the brush radius and the dab count.
That is what the plan's §9.2 guards address, and §5.4 shows they are missing
from the implementation.

---

## 8. Recommendation

Ordered by severity. Items 1 and 2 are, in my judgement, prerequisites for the
slice shipping; the rest are quality items.

1. **Bound the upload buffer.** Upload per coverage tile (64 × 64 → 16 KB) or
   per band of tiles (e.g. 8 tiles → 128 KB), instead of one `ImageData` for the
   whole dirty rect (`Canvas2DRenderer.ts` L1033). This removes the only
   allocation that can exceed the documented envelope (§4.3, scenario G) and the
   256 MiB per-element transient in the rebuild path (§4.4). It also bounds the
   per-upload cost, which is the unverified F7b risk (§6.4).
   *Cheapest form:* reuse one `ImageData` of a fixed tile size and re-upload it
   per tile — no per-upload allocation at all.
   → **Designed:** `docs/architecture-port-plan.md` §19.2 (unit, coordinate
   mapping, edge handling, the pending-tile set, and the equivalence proof).
2. **Add the deterministic dab budget** the plan's Q8 answer specifies
   (§2.3, §9.2). Without it, a legal project file can exhaust memory or freeze
   the renderer on open (§5.4). The guard must be *path-length independent* in
   effect — expressed as a lattice-index truncation — so that live and rebuild
   agree (§5.4 of the plan).
   → **Designed:** `docs/architecture-port-plan.md` §19.3 (three runtime bounds)
   and §19.4 (the unit, the derivation, and the **unresolved** value).
3. **Clear the rebuild scratch when the rebuild batch ends**
   (`stampScratch`, L185), so the coverage heap is transient rather than
   resident (§5.3). It fits the envelope either way; this is about honesty and
   about a 64 MiB resident allocation at the cap.
4. **Fix the colour fallback** (§5.6): resolve a non-hex CSS colour exactly
   (the plan's §7.3 1×1 probe) instead of painting black.
5. **Consider a tile pool** for `StampCoverage`: `clear()` (L332–334) drops every
   array, so a rebuild re-allocates all tiles per element. A small pool would
   remove that churn. *(Quality, not correctness.)*
6. **Measure in the packaged app** (§9.6 of the plan): the live cost of a
   stamped stroke at size 8 and size 128, the rebuild cost of a layer of 100
   stamped strokes, the peak coverage memory, and whether `putImageData` into
   the document-sized buffer triggers the F7b whole-canvas cost. The
   **device-pixel rate** this yields is the input that settles the dab-work
   budget (plan §19.4).

---

## 11. Resolution status after the resource-bounds design

The design in `docs/architecture-port-plan.md` §19 changes two of this review's
conclusions and closes both blockers. This section is the review's summary of
what is now settled and what is not.

### 11.1 The recalculated envelope (with tiled uploads)

| Scenario | Surfaces | Scan | Coverage tiles | Upload | **B/doc px** | **MiB** | ≤ 58? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A — idle | 32 | 0 | ≤ 4 (resident scratch) | 0 | ≤ 36 | 576 | ✅ |
| B — bucket fill | 32 | 10 | ≤ 4 | 0 | ≤ 46 | 736 | ✅ |
| C — stamped brush stroke | 32 | 0 | ≤ 8 | ≈ 0 | ≤ 40 | 640 | ✅ |
| D — stamped eraser stroke | 48 | 0 | ≤ 8 | ≈ 0 | **≤ 56** | **896** | ✅ |
| E — grouped preview + stamped stroke | 48 | 0 | ≤ 8 | ≈ 0 | **≤ 56** | **896** | ✅ |
| F — layer rebuild of stamped elements | 32 | 0 | ≤ 4 | ≈ 0 | ≤ 36 | 576 | ✅ |
| G — **rebuild during a grouped preview** | 48 | 0 | ≤ 8 | ≈ 0 | **≤ 56** | **896** | ✅ |

The upload term is ≤ 0.005 B/doc px (one reused 16 KiB tile image plus at most
four edge images) instead of ≤ 16 B/doc px. **The documented 58 B/doc px
envelope holds in every scenario, including the one that previously exceeded
it.** The residual headroom is **2 B/doc px**.

If the rebuild scratch is also released after a rebuild batch (recommended), the
worst case falls to ≤ 52 B/doc px (832 MiB).

### 11.2 What the design settles

| This review's finding | Status after §19 |
| --- | --- |
| §4.3 / §4.4 — the document-sized upload can leave the budget | **Closed.** Tiled uploads bound the allocation to ≤ 80 KiB; scenario G falls from 72 to ≤ 56.005 B/doc px. |
| §5.4 — no dab budget → a legal file can exhaust memory | **Designed, not implemented.** Three runtime bounds in the planner (§19.3); the work budget's *value* is deliberately unresolved (§19.4). |
| §5.5 — the live path re-plans every event | **Closed by the implementation** (`StampDabCursor`). |
| §5.3 — the rebuild scratch is resident | **Still open** (a one-line lifecycle change; recommended). |
| §5.6 — a non-hex brush colour paints black | **Still open** (a one-line fallback fix). |
| §6.4 — the `putImageData` / F7b cost is unverified | **Still open** (needs the packaged-app measurement, which also settles the budget). |

### 11.3 What the review does **not** claim

- **No measurement was taken.** Every millisecond figure in this review and in
  the design is arithmetic over the code's own loop bounds; the two time
  columns in plan §19.4 use an *assumed* device-pixel rate and are labelled as
  such.
- **The dab-work budget has no value yet**, because the repository documents no
  latency target and the rate is unmeasured. The design fixes the unit, the
  shape and the derivation; the coordinator owns the number.
- **The licensed/provenance position is unchanged** — it belongs to Agent 3
  (`docs/g1/provenance-record.json`) and is not revisited here.

**What I am not recommending:** changing the documented 58 B/doc px envelope.
The evidence says it holds (worst case 56 B/doc px, 896 MiB) once the upload is
bounded. The plan's "62 B/doc px" should be corrected, and the *headroom*
(10 → 2 B/doc px of transient slack) should be recorded so the next feature
knows how little room is left.

---

## 9. Corrections required in `docs/architecture-port-plan.md`

The plan was written before the implementation existed. The following
corrections are required by the evidence; they are applied in the plan and marked
there.

| # | Plan location | Was | Now | Why |
| --- | --- | --- | --- | --- |
| C1 | §9.3 (raster budget) | "the peak moves from 58 to **62** bytes per document pixel (992 MiB at the cap)" | The **58 B/doc px envelope holds**; the worst scenario is **56 B/doc px (896 MiB)**. The coverage caches are transients that fit the existing 10 B/doc px allowance; the transient headroom falls from 10 to **2 B/doc px**. | §4.2 of this review; the plan's arithmetic added the cache to the transient allowance instead of inside it. |
| C2 | §3, §5.1, §5.3 (modules and API) | `src/core/rendering/stampRaster.ts`, fields `stampSpacing` + `stampFalloff` | The implementation is `src/core/rendering/stampCoverage.ts` with fields `stamp: boolean`, `stampSpacing: number`, `stampHardness: number`. | The tree moved while the plan was being written; the plan must describe the code that exists. |
| C3 | §9.2 / §2.3 (Q8) | "the per-stroke coverage budget" (planned) | **Not implemented.** The implementation has a spacing *floor* (`MIN_STAMP_SPACING_PX = 0.5`) but no dab-count or area budget, and the file format does not bound the path length → a legal file can exhaust memory. | §5.4. |
| C4 | §8.2 step 3, §9.3 | "the changed **tiles** become `ImageData` … and are written into the stroke buffer" | The implementation uploads **one `ImageData` for the whole dirty rect**, which is document-sized in the rebuild path. | §4.4, §6.2. |
| C5 | §0 (inputs) | "License / Provenance Decision: **absent**" | **Present**: `docs/g1/provenance-record.json` (agent `paka-license-gate`) approves Strategy A — independent reimplementation from Paka's own documented behaviour — and blocks GPL sources. The plan's chosen strategy is the approved one. | The gate record landed after the plan was written; the plan's §0 gap is closed. (This review does not re-do the provenance review.) |
| C6 | §9.6 (measurements) | the packaged-app list | add the `putImageData` / F7b check and the coverage-heap peak. | §6.4. |

---

## 10. Unresolved questions for the coordinator

1. **Which upload granularity?** Per tile (64 × 64 → 16 KB, 16 k calls for a
   document-wide stroke at 2×) or per band (e.g. 8 tiles → 128 KB, 2 k calls)?
   The trade is call count vs. buffer size. *Recommendation: per tile with one
   reused `ImageData`.*
2. **Where does the dab budget live?** In `stampDabs` (the pure module, so it is
   testable and identical in live and rebuild) or in the renderer? *Recommendation:
   in `stampDabs`, as a truncation of the lattice, so the two paths cannot
   disagree.*
3. **What is the budget's value?** The plan proposed a cumulative coverage-work
   allowance. The number should be chosen against the *packaged-app* profile
   (§8 item 6), not against the harness.
4. **Does the "transient headroom is now 2 B/doc px" fact change the order of
   the open roadmap items?** The budget's headroom for a future feature (tiles,
   masks, groups) has shrunk by 80 %. That is a planning fact the coordinator
   owns; this review does not decide it.
5. **Should the coverage heap be counted in the canvas budget model at all?**
   Strictly it is outside the model's scope (it is JS heap, not a backing
   store), but it is real memory of the same order. *Recommendation: state it
   in `docs/ARCHITECTURE.md` next to the budget rather than in the constants in
   `document.ts`, so the model's stated scope ("calculable backing-store pixels")
   stays true.*
