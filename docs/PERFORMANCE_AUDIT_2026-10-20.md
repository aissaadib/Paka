# Paka rendering performance audit — 2026-10-20

**Status:** research only. No production source, test, shared doc or config file
was changed by this audit. The only repository file this audit added is this
report.

**State at the end of the session:** `main` at `9b2aceb`, which contains

* `4ac040b` — **R1 (dirty bounds) shipped**: the rebuild is bounded by each
  element's inked rectangle (47x-187x less touched area), byte-identical
  pixels.
* `520aa77` — the grouped-preview scratch is released when no preview is
  active, which is what keeps the raster budget's peak model true.
* `2fa34cc` — **the element-scratch variant (F7) was reverted**: it bought
  nothing demonstrable, it differed by 1/255 of alpha on a few dozen pixels at
  rasterScale 2 (F7d), and it would have moved the documented raster budget
  from 58 to 59 bytes per document pixel.
* `9b2aceb` — the stamp (dab) brush engine, with the tiled coverage map and
  the per-stroke work budget.

> ## ERRATA (2026-10-20, end of session) — read this before using any number
>
> **Every millisecond in this report is retracted.** The benchmarks used a 1x1
> `getImageData` to flush the canvas before timing — necessary, because
> unflushed Canvas 2D timings are meaningless — but **the flush itself is
> charged the canvas's area**. Agent 1 measured this directly (Chromium over
> CDP, 200 calls per size, warm-up, detached and attached canvases, headless
> and headed, agreeing): `putImageData` 0.0075-0.0145 ms per call, **flat**
> across 0.26-16.78 Mpx destinations; `drawImage` 0.0005-0.0015 ms, flat;
> `getImageData` on an *idle* canvas flat; but a `getImageData` on a canvas
> with **pending work** is charged that canvas's area (0.30 ms per draw at
> 16.78 Mpx).
>
> So the "knee" in F7, the 10x swings, the "85x" and the "destination is the
> cost" of F7f were **my sync, not the renderer**. What survives is what does
> not depend on a clock: the structural call counts (F1, F3, F4), the *area*
> results (F1b, F1c), the *pixel* verdicts (F7d) and the *memory* findings
> (F5). The sections below are kept as the record of what was measured, with
> the affected claims marked; the authoritative list is:
>
> | Claim | Status |
> | --- | --- |
> | One full-document clear + one full-surface blend **per element** (F1) | **Stands** — call counts, not timings. |
> | R1 cuts the touched area 47x-187x (F1c) | **Stands** — geometry, not timing. |
> | F1b is byte-identical to the pre-F1b rendering in 8 configurations (F7d) | **Stands** — byte comparison. |
> | F7 vs F1b: byte-identical at rasterScale 1, <=1/255 at rasterScale 2 (F7d) | **Stands** — byte comparison. |
> | Live surfaces: 2 / 3 / 4, i.e. 48 / 58 / 74 bytes per document pixel (F5) | **Stands** — counted canvases and arithmetic. |
> | Rebuild cost per element in ms (F2, F7, F7e) | **Retracted** — measured a flush. |
> | "The blur cost is linear in the scratch area" (F3) | **Retracted** — the flush of the scratch is charged the scratch's area, so the reading was circular. The *structural* claim (every frame re-blurs the whole bbox) stands. |
> | "A draw from a just-written canvas is a whole-canvas operation" (F7b) | **Retracted** — it was the flush of the canvas with pending work. |
> | "The destination is the cost" (F7f) and the tile/batching lead | **Closed** — a read-back cost, not a rendering-path cost. It survives only for the rare read-back paths (PNG export, bucket scan, picker probe). |
>
> The method lesson is the one this report's Appendix C already gave, and
> which this audit then failed to apply to its own harness: **sample frame
> deltas with `requestAnimationFrame` and never force a sync with
> `getImageData` inside a measurement.**

**Baseline audited:** `main` at `e1071d9` ("fix: composite the live preview
inside its own layer"), project format v8. The renderer file
`src/core/rendering/Canvas2DRenderer.ts` was byte-identical to that commit
during the measurements below (`git diff HEAD -- src/core/rendering/Canvas2DRenderer.ts`
was empty), so the numbers describe the renderer as committed.

**Questions this audit answers** (from the Agent 3 brief):

1. Does layer rebuild / undo scale with element count, and does it repeatedly
   clear and draw document-sized buffers?
2. Do active soft/textured strokes repeatedly feather full surfaces, especially
   at 2x?
3. Do full composite costs rise sharply with layer count at 2x?
4. Can large documents allocate huge layer surfaces (8192^2 at 2x ~ 1.07 GB per
   surface)?

**Headline result**

| Question | Verdict |
| --- | --- |
| Rebuild/undo scales with element count | **Confirmed (structurally).** Per element, one full-document `clearRect` + one full-surface `drawImage`, independent of stroke geometry. **Fixed:** R1 shipped as `4ac040b` — the rebuild is bounded by each element's inked rectangle (F1c). The *milliseconds* are retracted (errata). |
| Rebuild clears/draws document-sized buffers | **Confirmed, deterministically.** One full-buffer `clearRect` + one full-surface `drawImage` **per element**. **Fixed since:** `4ac040b` (same measurement, before/after in F1c). |
| Soft/textured strokes re-feather full surfaces at 2x | **Confirmed (structurally).** Every frame re-blurs the whole stroke bounding box. Still open (R2) — but its *cost* is not quantified here (errata). |
| Composite cost rises sharply with layer count at 2x | **Not confirmed.** One `drawImage` per visible layer; the cost of a draw is flat in the destination (Agent 1's measurement), so the layer count is not the risk. The 2x penalty is a destination-pixel multiplier, not a layer-count effect. |
| Huge layer surfaces | **Confirmed by arithmetic and by counting live canvases; now bounded by the 16,777,216 px document cap** (`isValidDocumentSize`), the peak is stated honestly (58 bytes per document pixel), and the over-budget case is closed by the scratch release (`520aa77`). |

---

## 1. Method

### 1.1 What was measured, and how

Measurements ran in the Vite dev server (`pnpm dev`, port 1420) with the real
`Canvas2DRenderer` imported through Vite (`await import('/src/core/rendering/Canvas2DRenderer.ts')`).
No production code was modified; the harness builds documents, layers and stroke
records in memory and drives the renderer's public API
(`setDocument` / `setViewport` / `setDisplaySize` / `invalidateLayer` /
`beginStroke` / `render` / `rasterizeLayer`).

Two independent kinds of evidence were collected:

* **Structural (deterministic, machine independent).** `CanvasRenderingContext2D.prototype.drawImage`,
  `clearRect` and `fillRect` were wrapped for the duration of a single
  operation and the call counts were recorded. These counts do not depend on
  the GPU, the driver or the machine.
* **Wall clock (indicative, environment specific).** Timings were taken with
  `performance.now()`, and each measured operation was followed by a
  `getImageData(0, 0, 1, 1)` on the target canvas to force the canvas pipeline
  to finish. Without that flush, Canvas 2D command submission is asynchronous
  and the numbers are meaningless (measured 0.0 ms for work that really took
  tens of milliseconds).

Warm-up: one untimed pass per configuration. Samples: 7 interleaved rounds for
the rebuild grid (round-robin over configurations, so machine drift hits all
configurations equally), 5 for the preview components, 3 for the large-surface
cases. Reported as **median** with **min** and **max**; the min is the least
contaminated figure and is used for cross-environment reasoning.

### 1.2 Environment

| Item | Value |
| --- | --- |
| Host OS | Windows 10/11 x64 (`Win32`) |
| Browser | Chromium 152.0.7977.130 inside Electron 44.4.5 (the agent's browser harness) |
| Logical CPUs | 20 |
| `navigator.deviceMemory` | 16 GB |
| Screen / DPR | 1536x864, `devicePixelRatio` 1.25 |
| Renderer under test | `Canvas2DRenderer` at `main` / `e1071d9` |
| Display canvas used in the harness | 1280x800 CSS, DPR 1 and 2 (i.e. 1280x800 or 2560x1600 device pixels) |
| Viewport | "fit" (whole document visible) and "100%" (zoom 1) |
| Surfaces | `rasterScale` 1 and 2, as the app uses `clamp(devicePixelRatio, 1, 2)` |

### 1.3 Threats to validity (read this before quoting any number)

* **Every millisecond here is retracted (see the errata at the top).** The
  timing method used a 1x1 `getImageData` to flush the canvas before each
  measurement, and that flush is charged the canvas's area — so the timings
  measure the flush, not the work. Agent 1's direct measurement (Chromium over
  CDP, 200 calls per size, warm-up, detached and attached canvases, headless
  and headed, agreeing) is the reference: `putImageData` and `drawImage` are
  **flat** in the destination size, while a read-back of a canvas with pending
  work is charged that canvas's area. Read the timing tables as evidence of
  *what was called*, not of *how long it took*.
* **The harness is not the product.** The packaged app renders through the
  Windows WebView2 (Chromium) on a real GPU. This harness rasterises large
  canvases in software or on a virtualised GPU.
* **Timings in this harness were unstable.** The same configuration measured
  64 ms in one run and 684 ms in another (a 10x swing with no code change) —
  which the errata now explains: the cost of the sync depends on the canvas's
  state and on the read-back pressure the harness itself created.
* **Concurrency.** Three other agents were editing the same repository and
  running builds during the session, which added to the drift.

---

## 2. Findings

### F1 — A layer rebuild touches the whole document-sized surface once per element (structural, confirmed)

`rasterizeLayer()` (Canvas2DRenderer.ts:718) loops over the layer's elements.
For each element it calls `rasterizeStrokeToBuffer()` (line 824), which
**clears the entire document-sized stroke buffer** (`clearStrokeBuffer()`,
line 1128) and then `compositeStrokeBuffer()` -> `paintStrokeCoverage()`
(line 865), whose hard-brush path is:

```
ctx.drawImage(this.strokeBuffer, 0, 0, doc.width, doc.height);   // line 873
```

i.e. the whole buffer is blended over the whole surface, at document size.

Measured call counts (wrapper over the 2D context, 2048x2048 document):

| Operation | `clearRect` calls | `drawImage` calls |
| --- | --- | --- |
| Rebuild of a layer with 1 element | 2 | 1 |
| Rebuild of a layer with 25 elements | 26 | 25 |

The counts are **identical for tiny 32 px strokes and for full-document
serpentine strokes** (496 samples each) — the cost of a rebuild depends on the
*number of elements* and the *document area*, not on how much ink was drawn.

Derived pixel volume per element (RGBA, 4 bytes/px, surface = document x
`rasterScale`):

| Document | `rasterScale` | Surface | Pixels cleared + blended per element | Pixels for a 100-element undo |
| --- | --- | --- | --- | --- |
| 1024x1024 | 1 | 1024x1024 | 2 x 1.05 Mpx | 210 Mpx |
| 1024x1024 | 2 | 2048x2048 | 2 x 4.19 Mpx | 839 Mpx |
| 2048x2048 | 1 | 2048x2048 | 2 x 4.19 Mpx | 839 Mpx |
| 2048x2048 | 2 | 4096x4096 | 2 x 16.8 Mpx | 3.36 Gpx |
| 4096x4096 | 2 | 8192x8192 | 2 x 67.1 Mpx | 13.4 Gpx |

**Undo/redo of a single stroke on a busy layer costs a full re-rasterization of
that layer.** The engine marks the layer dirty (`invalidateLayer`), and the
next `render()` re-does every element. At 2048^2 / 2x that is 3.36 Gpx of
clear + blend for a 100-element layer.

#### F1b — the touched area, measured (added 2026-10-20, after the F1 order)

The table above is arithmetic. It was later **measured** with an area
instrument (wrap `clearRect` and `drawImage`, count
`dest width x dest height x |det(transform)|`), against the committed
renderer:

| Document | `rasterScale` | Surface | Elements | Area cleared | Area blended | Total touched |
| --- | --- | --- | --- | --- | --- | --- |
| 1024x1024 | 1 | 1024x1024 | 25 | 27.3 Mpx | 26.2 Mpx | 53.5 Mpx |
| 1024x1024 | 1 | 1024x1024 | 100 | 105.9 Mpx | 104.9 Mpx | 210.8 Mpx |
| 1024x1024 | 2 | 2048x2048 | 25 | 109.1 Mpx | 104.9 Mpx | 213.9 Mpx |
| 1024x1024 | 2 | 2048x2048 | 100 | 423.6 Mpx | 419.4 Mpx | 843.1 Mpx |
| 2048x2048 | 1 | 2048x2048 | 25 | 109.1 Mpx | 104.9 Mpx | 213.9 Mpx |
| 2048x2048 | 1 | 2048x2048 | 100 | 423.6 Mpx | 419.4 Mpx | 843.1 Mpx |
| 2048x2048 | 2 | 4096x4096 | 25 | 436.2 Mpx | 419.4 Mpx | 855.6 Mpx |
| 2048x2048 | 2 | 4096x4096 | 100 | 1694.5 Mpx | 1677.7 Mpx | **3372.2 Mpx** |

The model and the measurement agree: a 100-element undo at 2048^2 / 2x touches
3.37 Gpx, against the 3.36 Gpx predicted. The area is identical for 2-sample
strokes and for 496-sample document-wide strokes, and identical for equal
*surface* sizes (1024^2 at 2x equals 2048^2 at 1x) — so the cost follows the
surface, not the ink.

**Area, not call count, is the metric that shows the R1 win.** The number of
`clearRect` / `drawImage` calls stays one per element after dirty bounds (the
calls are the same, their *extent* shrinks), so an acceptance test that only
counts calls cannot see the improvement. If the per-element clear and blend
are limited to the inked rectangle, a 32 px stroke at 2048^2 / 2x touches
~64x64 px instead of 16.8 Mpx — about 4,000x less per element (a calculation
from the geometry, not a measurement), which would take the 100-element undo
from 3.37 Gpx to well under 1 Mpx.

#### F1c — R1 implemented and measured before/after (2026-10-20, after `4ac040b`)

Recommendation R1 was implemented as `4ac040b` "perf: bound layer rasterization
by the inked rectangle": a layer rebuild now clears and blends each element
over the rectangle that element inks, one to one. To make the comparison
immune to machine drift, the pre-fix rebuild (commit `520aa77`) was emulated
in the same page and the two paths were interleaved (3 rounds each, medians).
The emulation reproduced the earlier area numbers exactly, so it is faithful.

Area touched per rebuild (device pixels):

| Document | Scale | Elements | Before | After | Factor |
| --- | --- | --- | --- | --- | --- |
| 1024x1024 | 1 | 25 short | 53.5 Mpx | 1.13 Mpx | 47x |
| 1024x1024 | 1 | 100 short | 210.8 Mpx | 1.37 Mpx | 154x |
| 1024x1024 | 2 | 100 short | 843.1 Mpx | 5.47 Mpx | 154x |
| 2048x2048 | 2 | 25 short | 855.6 Mpx | 17.1 Mpx | 50x |
| 2048x2048 | 2 | 100 short | 3372.2 Mpx | 18.1 Mpx | 187x |
| 2048x2048 | 2 | 25 dense (document-wide) | 855.6 Mpx | 772.6 Mpx | 1.11x |

Wall clock in the same session (medians, ms):

| Document | Scale | Elements | Before | After |
| --- | --- | --- | --- | --- |
| 1024x1024 | 1 | 25 short | 84.0 | 62.1 |
| 1024x1024 | 1 | 100 short | 347.8 | 244.9 |
| 1024x1024 | 2 | 100 short | 1233.2 | 766.0 |
| 2048x2048 | 2 | 25 short | 650.4 | 12.6 |
| 2048x2048 | 2 | 100 short | 2532.7 | 18.6 |
| 2048x2048 | 2 | 25 dense (document-wide) | 1061.3 | 1306.8 |

Three things this says — but **the two timing columns are retracted** (see the
errata: the sync was charged the canvas's area, so these milliseconds measure
the flush, not the rebuild). What survives is the *area* column and the
*shape* of the comparison:

1. **The area win is real and large** where strokes ink a small part of the
   document: the 100-element undo at 2048^2 / 2x goes from 3.37 Gpx to 18 Mpx.
   The millisecond column next to it (2.53 s -> 19 ms) is **not** a result.
2. **A layer of strokes that together cover the document barely improves**
   (area 1.11x), because the inked rectangle is nearly the whole document
   there. The "~23 % slower" figure is likewise a flush artefact and is
   retracted.
3. The remaining per-element term is **not** the area any more (the area is
   negligible in both rows) — but this report cannot say what it *is*: the
   measurements that would have answered that were flush-dominated.

Pixel invariants were re-checked in the browser at five sample points for a
hard, a soft, a grained and a soft+grained brush: live == post-commit display,
committed == rebuilt, and export == export after a rebuild, all hold.

*Timing caveat:* the wall-clock numbers in F2 (measured hours earlier) are
**not** comparable with the table above — the machine is much slower now
because three other agents are running work on it. The area numbers are pure
geometry and are stable across sessions; the same-session A/B above is the
valid timing comparison.

### F2 — Measured rebuild cost (wall clock, indicative)

`rasterizeLayer(surface)` + 1x1 readback sync, 7 interleaved rounds, medians
(min in brackets):

| Document | Scale | Surface | 0 elements | 25 tiny strokes | 100 tiny strokes | 25 dense strokes | 100 dense strokes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1024x1024 | 1 | 1024x1024 | 0.7 ms | 15.6 (13.7) | 20.8 (20.3) | 25.4 (24.8) | 62.7 (59.3) |
| 1024x1024 | 2 | 2048x2048 | 2.5 ms | 43.7 (30.4) | 53.0 (40.4) | 52.4 (37.9) | 100.7 (89.1) |
| 2048x2048 | 1 | 2048x2048 | 2.4 ms | 42.8 (30.6) | 51.4 (35.2) | 95.6 (85.6) | 263.7 (250) |
| 2048x2048 | 2 | 4096x4096 | 8.9 ms | 157.4 (132.2) | 194.8 (167.1) | 186.2 (147.5) | 392.5 (359.7) |

Reading of the table:

* **Cost follows surface pixels, not document pixels.** 1024x1024 at 2x and
  2048x2048 at 1x have the same 2048x2048 surface and near-identical costs
  (43.7 vs 42.8 ms for 25 tiny strokes). *(Retracted: this is the flush of the
  surface, which is the same canvas in both cases.)*
* **Cost follows area roughly linearly** (16.8 Mpx -> 67.1 Mpx: 157 ms ->
  ~400 ms for the same 25-100 dense elements) — until the surface gets large
  enough that the rasteriser changes behaviour, see F5. *(Retracted: the same
  flush effect, which is charged the surface's area.)*
* **Tiny strokes are cheap per element, dense strokes are not.** Going from 25
  to 100 *tiny* strokes costs only ~20% more (43.7 -> 53.0 ms). *(Retracted as
  a cost claim; what survives is the area column of F1b: the same rebuild
  touches 47x-187x less area for tiny strokes than for document-wide ones.)*
  The bad case is a layer full of strokes that together cover the document —
  an illustration, a painted area, a scribbled layer.

### F3 — Live preview of a soft or textured stroke re-feathers the whole stroke every frame (confirmed structurally)

Per-frame call counts for one preview frame (2048x2048 document, 2x,
structural):

| Brush | `clearRect` | `drawImage` | `fillRect` | What happens per frame |
| --- | --- | --- | --- | --- |
| hard | 1 | 2 | 1 | display clear, layer composite, **full-document stroke-buffer draw** |
| soft | 2 | 3 | 1 | + clear + blurred copy of the stroke bbox, then draw the blurred copy |
| soft + grain | 2 | 3 | 2 | + grain pattern fill over the scratch |

`featherStroke()` (line 968) blurs the stroke's **whole** bounding box into a
scratch canvas, and `render()` calls it again on every frame (line 384 ->
`paintStrokeCoverage` -> `featherStroke`). The bounding box grows with the
stroke, so the cost of every frame grows with the stroke, and the scratch is
sized in *raster* pixels, so it grows with `rasterScale^2` as well.

Measured component costs (2048x2048 document; medians):

| Brush | bbox fraction | Scale | Feather scratch | Blur per frame | Grain per frame | Composite of coverage |
| --- | --- | --- | --- | --- | --- | --- |
| hard | 25% | 1 | (none) | - | - | 41.7 ms |
| hard | 100% | 1 | (none) | - | - | 49.4 ms |
| soft | 25% | 1 | 1010x994 (1.0 Mpx) | 24.0 ms | - | 23.4 ms |
| soft | 100% | 1 | 2034x2041 (4.15 Mpx) | 107.7 ms | - | 107.4 ms |
| soft + grain | 100% | 1 | 2034x2041 (4.15 Mpx) | 102.9 ms | 26.0 ms | 124.1 ms |
| hard | 25% | 2 | (none) | - | - | 32.2 ms |
| soft | 25% | 2 | 2018x1986 (4.0 Mpx) | 111.9 ms | - | 109.0 ms |
| soft | 100% | 2 | 4066x4081 (16.6 Mpx) | **555.9 ms** | - | 590.2 ms |
| soft + grain | 100% | 2 | 4066x4081 (16.6 Mpx) | 539.9 ms | **239.8 ms** | 766.1 ms |

Interpretation — **and the retraction that applies to it**:

* The blur is **linear in the scratch area** (4.15 Mpx -> 107.7 ms,
  16.6 Mpx -> 555.9 ms, i.e. 4x area -> 5.2x time) and scales with
  `rasterScale^2` because the scratch is in raster pixels. **Retracted as a
  cost claim:** the sync that followed each blur is itself charged the
  scratch's area, so this reading is circular. The *structural* claim stands
  and is the durable one: the scratch is sized to the stroke's bounding box in
  raster pixels, so a bigger stroke or a bigger `rasterScale` means more
  pixels to blur and to copy every frame.
* A soft stroke that covers a large area therefore re-blurs its whole bbox
  **on every frame**; adding grain adds a second full-scratch pass (a pattern
  fill with `destination-in`).
* The *hard* path is not free either — it draws the whole document-sized
  stroke buffer to the layer surface on every commit (`paintStrokeCoverage`),
  which is why its "composite of coverage" column is the same order as the soft
  path's.

### F4 — Composite cost versus layer count (hypothesis NOT confirmed)

Structural: a composite frame issues exactly **one `drawImage` per visible
layer** (8 layers -> 8 `drawImage` calls, plus 1 clear and 1 paper fill).

Measured per-frame cost, excluding the readback (20 frames per timed batch,
1280x800 CSS):

| Viewport | DPR | `rasterScale` | Layers | ms/frame |
| --- | --- | --- | --- | --- |
| fit | 1 | 1 | 1 | 0.00 |
| fit | 1 | 1 | 8 | 0.12 |
| fit | 2 | 1 | 1 | 0.01 |
| fit | 2 | 1 | 8 | 0.04 |
| fit | 2 | 2 | 1 | 0.03 |
| fit | 2 | 2 | 8 | 0.22 |
| 100% | 2 | 2 | 1 | 0.03 |
| 100% | 2 | 2 | 8 | 0.14 |
| fit | 2 | 2 | 8 (multiply blend, opaque content) | 4.21 |

Two separate observations, and they must not be conflated:

* The **command-submission** cost of a composite is negligible (0.01-0.22 ms);
  the real work happens in the rasteriser, which the 1x1 readback only
  partially forces. The last row is the only one that had real content and a
  real blend mode, and it is 10-20x the empty rows — a reminder that these
  figures are dominated by whether the rasteriser actually did the work.
* The **pixel volume** is deterministic and does grow with the layer count:
  each visible layer blends `min(document, viewport)^2 x zoom^2 x dpr^2`
  destination pixels. At 1280x800 CSS with DPR 2 the display canvas is
  4.1 Mpx, so 8 layers blend up to 32.8 Mpx per frame; on a 4K display at DPR 2
  that is 4x more again.

**Verdict:** the brief's "composite cost rises sharply with layer count at 2x"
is *not* supported by the measurements. What is supported is that the
composite is **linear in the number of visible layers** and that the 2x/DPR
penalty is a **4x destination-pixel multiplier** applied to every layer. A
sharp cliff would need either many layers (dozens) or a very large display;
neither was reachable in this harness, so the claim stays a hypothesis.

### F5 — Large surfaces are a cliff, and they are now bounded

Measured rebuild of a 25-element layer (tiny strokes), 3 samples, medians:

| Document | Scale | Surface | Surface size | Rebuild |
| --- | --- | --- | --- | --- |
| 2048x2048 | 1 | 2048x2048 | 16 MiB | 42.8 ms (F2 grid) |
| 4096x4096 | 2 | 8192x8192 | 256 MiB | 2609.9 ms (min 2544) |
| 8192x8192 | 1 | 8192x8192 | 256 MiB | 2607.3 ms (min 2532) |

* The two 256 MiB cases are indistinguishable, as expected: what matters is
  the surface, not the document size.
* 16 MiB -> 256 MiB surface (16x pixels) cost 61x the time. Part of that is
  memory bandwidth and part is that canvases of this size stop being handled
  by the fast path in this harness. Either way the practical statement is:
  **a 256 MiB surface makes a 25-element undo take ~2.6 s here**, and the
  pre-budget 8192x8192-at-2x case (1.07 GiB per surface) was never viable.

Memory arithmetic (RGBA, 4 bytes/px), the question from the brief:

| Document | Scale | One surface | Steady state (1 layer + stroke buffer) | While erasing (+ snapshot) | + export composite (1x) |
| --- | --- | --- | --- | --- | --- |
| 4096x4096 | 1 | 64 MiB | 128 MiB | 192 MiB | +64 MiB |
| 4096x4096 | 2 | 256 MiB | 512 MiB | 768 MiB | +64 MiB |
| 8192x8192 | 1 | 256 MiB | 512 MiB | 768 MiB | +256 MiB |
| 8192x8192 | 2 | **1024 MiB** | **2048 MiB** | **3072 MiB** | +256 MiB |

Extra surfaces the renderer keeps: one per layer (`LayerSurfaceStore`), the
document-sized stroke buffer, a feather scratch (up to surface sized), an
erase snapshot while an eraser is in flight, and a transient document-size
composite for PNG export / bucket fill.

**This is exactly the risk the shipped budget addresses**: the document is
capped at 16,777,216 px total (`isValidDocumentSize`), so the largest legal
document is 4096x4096, i.e. 256 MiB per 2x surface. The budget is now stated
as a **peak** of 58 bytes per document pixel (three 2x surfaces — the layer
surface, the stroke buffer, and at most one of the erase snapshot or the
grouped live-preview scratch — plus a transient scan buffer of about 10
bytes/px), i.e. 928 MiB at the cap, inside the 1 GiB budget.

That peak was **measured**, not assumed (live canvases of the renderer,
1024x1024 document at 2x): idle = 2 surfaces (32 B/px), grouped preview active
= 3 (48 B/px), eraser in flight = 3 (48 B/px, the preview scratch is absent
because an eraser previews by mutating its own layer), and a grouped preview
followed by an eraser = 4 (64 B/px, 1.16 GiB at the cap) *unless* the scratch
is released when no preview is active. The renderer now releases it
(`holdsPreviewScratch`), so the over-budget peak is closed and 58 B/px holds.

The remaining, *unaddressed* part of the budget is that **every additional
layer adds another full-resolution surface** (16 B/px at 2x), which the
document cap does not bound.

**The stamp engine does not move the peak (2026-10-20).** The stamp (dab)
brush engine keeps its coverage in a JavaScript map of 1 byte per **device**
pixel over the **stroke's own footprint** - at most 4 bytes per document pixel
at the budgeted scale of 2 - and it is a transient, so it fits inside the same
10 bytes-per-document-pixel allowance as the bucket scan: the in-flight map and
the resident scratch together use at most 8 of those 10 bytes, leaving **2
bytes per document pixel of transient headroom** for the next feature that needs
scratch space (masks, groups, tile-based layer surfaces). Two details keep it
there:

* the coverage map is **tiled and allocated on demand**, so it follows the
  inked area rather than the document size;
* the upload from the coverage map into the stroke buffer is **one `ImageData`
  per tile** (64 x 64 x 4 = 16 KB), never one for the whole dirty rectangle -
  which would be document-sized (256 MiB at the cap) in the rebuild path.

The coverage map is JavaScript heap rather than a canvas backing store, so it
sits outside the budget model's stated scope ("calculable backing-store
pixels"). It is stated here next to the budget rather than folded into the
constants in `document.ts`, so the model keeps describing exactly what it says
it describes. The envelope therefore stays **58 bytes per document pixel**
(worst observed scenario 56 B/px, 896 MiB at the cap, inside the 1 GiB budget).

The stamp engine's own cost is quadratic in the brush radius, because each dab
touches its whole bounding box: a 512 px brush at `rasterScale` 2 is a thousand
device pixels across, so a million pixels per dab. The planner therefore
enforces a **per-stroke work budget** (`MAX_STAMP_COVERAGE_WORK`), cut at a
lattice index so the live path and the rebuild path truncate identically; an
extreme stroke is cut short rather than stalling the app. The live path pays
only for the new dabs of each pointer event.

### F7 — After R1: the remaining per-element cost (SUPERSEDED — the "knee" and the split below are flush artefacts)

> **This whole section is superseded by the errata at the top of the report.**
> The split below (99 % of the time in the blit) and the "knee" are what the
> harness's read-back sync produced, not what the renderer does: a read-back
> of a canvas with pending work is charged that canvas's area, and the
> measurements here flush after every rebuild. The *structural* facts survive
> (F1, F1b) and the *pixel* facts survive (F7d); the timing story does not.
> The section is kept as the record of what was measured, and F7b and F7f
> carry the corrections.

R1 removed the area term, so the rebuild was profiled again by wrapping the
renderer's per-element internals (50 tiny strokes, one layer, medians of 3
rounds):

| Surface | Total per element | `compositeStrokeBuffer` (the blit) | `rasterizeStrokeToBuffer` | `strokeRegion` |
| --- | --- | --- | --- | --- |
| 2048x2048 (4.19 Mpx) | 6.85 ms | **6.77 ms** | 0.07 ms | 0.03 ms |
| 3072x3072 (9.44 Mpx) | 0.28 ms | **0.24 ms** | 0.02 ms | 0.01 ms |

99 % of what is left is the bounded blit onto the surface, and its cost has a
**knee**: a 100-element rebuild of tiny strokes takes 323.8 ms on a 1024^2
surface, 901 ms on a 2048^2 surface, 917 ms on a 2048^2 surface at 2x, and
**17.9 ms on a 3072^2 surface** and 18.9 ms on a 4096^2 surface. The
per-element cost is 3.2 / 9.0 / 9.2 / 0.18 / 0.19 ms — about 50x lower above
~4-9 Mpx — while the inked area is the same (a few kpx) in every case. An
ordinary 2048^2 document sits on the wrong side of that knee in this harness.

An isolated micro-benchmark (no renderer, static source canvas) shows the
bounded blit itself is cheap and size-independent: a 64x64 canvas-to-canvas
blit costs 0.02 ms from a 2048^2 source and 0.03 ms from a 4096^2 source,
while a *full-canvas* draw costs 1.6 ms and 10.5 ms respectively. So the
expensive part is not the blit but reaching the source.

**Hypothesis (not proven here):** the source is the document-sized stroke
buffer, which was just drawn into, so each blit must flush or read back that
canvas, and that cost is paid per element and scales with the whole buffer;
the knee would then be Chromium's canvas acceleration switching at a few
megapixels. **If that is right**, the next step is small: do not draw from a
document-sized canvas that was just written — rasterize each element into a
reused, element-sized scratch and blit that — which should make the
per-element cost independent of the document size. A per-layer cache of the
last rasterization (so an undo re-rasterizes only the changed element)
attacks the same term from the other side.

The numbers above are measured; the mechanism and the proposed fix are a
hypothesis and a proposal.

> **Correction (2026-10-20, late in the day):** the *magnitude* of the effect
> is session-dependent, and the "knee" quoted above does not reproduce on an
> idle machine — see F7e. The mechanism itself (F7b) is a reproducible
> measurement; the rebuild timings around it are not.

#### F7b — the mechanism, tested directly (SUPERSEDED: it measured the sync, not the draw)

> **Correction (errata):** the table below is reproducible, but the reading
> drawn from it was wrong. The 7.85 ms at 2048^2 was the **flush of the canvas
> with pending work** — the harness's `getImageData` sync, which is charged
> that canvas's area — not a "read-back of the source" inside the draw. Agent
> 1's direct measurement settles the axis: `drawImage` and `putImageData` are
> **flat** in the destination (0.0005-0.0145 ms per call from 0.26 to 16.78
> Mpx), while a read-back of a canvas with pending work is charged its area.
> The size cliff in the table below is therefore the *size of the canvas the
> harness flushed*, not a property of the renderer.

The mechanism above was then tested in isolation from the renderer: draw a
64x64 sub-rect from a canvas source in three variants — (a) the source is
static, (b) the source was written to inside the sampled region just before
the draw, (c) the source was written to somewhere else just before the draw.

| Source canvas | Static source | Written inside the sampled region | Written elsewhere |
| --- | --- | --- | --- |
| 2048x2048 | 0.02 ms | 7.85 ms | 7.60 ms |
| 3072x3072 | 0.04 ms | 0.05 ms | 0.05 ms |
| 4096x4096 | 0.04 ms | 0.06 ms | 0.05 ms |

What this settles:

* The cost is **not the blit** and **not the dirty region** — a 64x64 blit
  from a static source is 0.02-0.04 ms at every size.
* The cost appears only when the **source canvas has pending writes**, and it
  is then paid in full whether the write was inside or outside the sampled
  region (7.85 vs 7.60 ms), so it is a whole-canvas operation rather than
  dirty-region tracking.
* At 2048^2 a draw from a just-written canvas costs ~7.8 ms; at 3072^2 and
  4096^2 the same draw costs ~0.05 ms. That is the knee, and it is the
  per-element cost measured on the renderer in F7 (6.77 ms/element at
  2048^2 versus 0.24 ms/element at 3072^2).

**Conclusion (measured):** the per-element rebuild cost is the renderer
reading back the document-sized stroke buffer it has just written to, once per
element. The internal reason for the size knee (very likely Chromium switching
the canvas between a CPU-backed and a GPU-backed surface around a few
megapixels) remains a **hypothesis**; the effect and the threshold are
measurements.

**What it implies:** the blit must not read the document-sized buffer.
Rasterize each element into a small, reused, element-sized scratch and blit
*that* — the scratch is small, so reading it back is cheap — or keep the
element's coverage as an `ImageData` / `ImageBitmap` rather than a canvas.
A per-layer cache of the last rasterization (so an undo re-rasterizes only the
changed element) attacks the same term from the other side. Either way the
change touches the composite path (one alpha applied once, no self-darkening,
live == commit == rebuild == export) and the eraser path, so it needs the same
pixel-equality proof R1 got, plus the area and call-count assertions.

> **Correction (2026-10-20):** the *timing* this predicted did not reproduce
> on an idle machine, because the source side was not the whole story — the
> **destination** is (F7f). The element scratch is still the right shape (and
> it shipped as `f7cf50c`), but the win it can deliver is bounded by the
> destination cost, which it does not touch.

#### F7c — the proposed fix, prototyped: the cost model holds, but a naive implementation is not pixel-identical

The fix was then prototyped in the page (not in the repo): rasterize each
element into a reused, element-sized scratch and blit that, instead of the
document-sized stroke buffer, using the renderer's own region computation and
an identity transform for the blit.

Cost (50 tiny strokes, per element, medians):

| Document | Scale | Shipped (F1b) | Prototype | |
| --- | --- | --- | --- | --- |
| 1024x1024 | 1 | 2.28 ms | 0.08 ms | 28x faster |
| 2048x2048 | 1 | 6.80 ms | 0.08 ms | 85x faster |
| 2048x2048 | 2 | 0.23 ms | 0.25 ms | neutral |
| 3072x3072 | 1 | 0.15 ms | 0.12 ms | neutral |

> **Correction (errata):** **both columns of this table are retracted.** They
> were measured on a loaded machine, with a `getImageData` sync after each
> rebuild, and that sync is charged the canvas's area (F7b, F7f, and Agent 1's
> write-cost measurement) — so the table measures the flush, not the rebuild.
> The "cost model" line that followed it is withdrawn with it: there is no
> measured "whole-canvas operation" in a draw, because a draw is flat in the
> destination size.
>
> What survives from this section is the *pixel* part (below) and the
> structural fact that the prototype and the shipped path differ only in where
> the coverage is rasterized.

So the cost model is confirmed: reading back the document-sized buffer *is*
the remaining per-element cost, and an element-sized scratch removes it. Where
the shipped path is already fast (surfaces above the knee) the prototype is
neutral, so it is not a trade-off there.

**The pixel trap, which matters more than the timing:** the prototype is
**not** pixel-identical to the shipped path.

| Document | Scale | Differing bytes | Of | Max byte delta |
| --- | --- | --- | --- | --- |
| 1024x1024 | 1 | 4,749 | 4,194,304 (0.11 %) | 27 |
| 2048x2048 | 1 | 4,831 | 16,777,216 (0.03 %) | 27 |
| 2048x2048 | 2 | 21,178 | 67,108,864 (0.03 %) | 10 |
| 3072x3072 | 1 | 4,821 | 37,748,736 (0.03 %) | 27 |

**Correction (2026-10-20, after the shipped implementation was measured):**
this difference was **not a property of the approach and not a real defect** —
the measurement was taken while another agent's F7 implementation was being
written in the working tree, and the "shipped" side of the comparison was
therefore a *moving target* (the renderer was imported with a cache-busting
query, so it picked up the file as it was on disk at that moment). A
controlled re-run on the committed tree gives **0 differing bytes** between
the shipped element-scratch path, the document-buffer path and this very
prototype (1024x1024, 50 tiny hard strokes, full layer surface). The pixel
table above is void; the cost numbers above stand, because they measure the
same work and agree with the F7b mechanism — though the *magnitude* of that
mechanism's effect is itself session-dependent (F7e). See F7d.

#### F7d — F1b is pixel-identical to pre-F1b (measured, Chromium)

The open question — does the bounded clear and bounded blit of F1b change any
pixel? — was settled by a browser A/B on the real renderer (512x512, 20
strokes, hard / soft / grain / soft+grained, rasterScale 1 and 2), comparing
the layer surface *and* the display canvas (1,048,576 to 4,194,304 bytes
each). The pre-F1b reference was emulated faithfully: the document-sized
buffer path with a **full** clear of the buffer instead of the bounded one.

| Comparison | rasterScale 1 | rasterScale 2 |
| --- | --- | --- |
| F1b vs pre-F1b | **0 differing bytes** (all four brushes, surface and display) | **0 differing bytes** (all four brushes, surface and display) |
| F7 (element scratch) vs F1b | 0 differing bytes (all four brushes) | 44 bytes (max delta 1) hard, 10 (max 1) soft, 40 (max 1) grain, 9 (max 1) soft+grained, out of 4.2 M |

So:

* **F1b, already on main, changes no pixel.** The antialiasing-ring worry
  behind the F7c warning does not hold for the shipped path.
* The element-scratch approach is safe: byte-identical at rasterScale 1, and
  at rasterScale 2 it differs by at most 1/255 on at most 44 bytes of 4.2 M
  (0.001 %). If a future slice wants zero difference at every raster scale,
  that 1/255 is the thing to chase, and it is in the scratch blit.

**Outcome:** the element-scratch variant shipped as `f7cf50c` and was
**reverted** as `2fa34cc` — the timing benefit did not reproduce (F7e), the
1/255 difference at rasterScale 2 is exactly the pixel proof the project's
own rule for a rasterization change asks for, and the scratch would have moved
the documented raster budget from 58 to 59 bytes per document pixel. The
1/255 here is the measurement the revert rests on, so it is the one number in
this audit that changed a decision.

The lesson for the method: a quick prototype can invent a defect that the real
implementation does not have, and a cache-busted import of a file another
agent is actively editing measures their work-in-progress rather than a
shipped implementation. An A/B that decides such a question must compare
**the shipped path** against a **faithful reference**, on a **committed
tree**.

#### F7e — the timing claims do not reproduce on an idle machine (correction)

Late in the day, with the other agents idle, the three paths were measured
again — interleaved in one session on the committed tree (`f7cf50c`), 100 tiny
strokes, per element:

| Document | Scale | Surface | pre-F1b | F1b | F7 (element scratch) |
| --- | --- | --- | --- | --- | --- |
| 1024x1024 | 1 | 1.05 Mpx | 0.30 ms | 0.26 ms | 0.28 ms |
| 2048x2048 | 1 | 4.19 Mpx | 0.53 ms | 0.54 ms | 0.49 ms |
| 2048x2048 | 2 | 16.78 Mpx | 1.87 ms | 1.72 ms | 1.84 ms |

All three paths are within ~10 % of each other. The same configuration that
measured 901 ms earlier in the day now measures 54 ms, and the "knee" (where
3072^2 and 4096^2 were *faster* than 2048^2) is gone: the per-element cost now
grows monotonically with the surface size (0.26 / 0.54 / 1.84 ms at
1.05 / 4.19 / 16.78 Mpx) for *every* path.

So, stated plainly:

* The **area** results (F1c) are durable — they are geometry, not timing.
* The **mechanism** (F7b) is durable — it is an isolated measurement of
  Chromium's canvas behaviour.
* The **timings** around them are not: the 85x and the knee were artefacts of
  a loaded machine and of the canvas state at the time (a canvas that has
  been read back many times, or one demoted to a CPU-backed surface, makes
  every read of it expensive).
* The remaining per-element cost still scales with the **surface** size, not
  with the inked area, and neither F1b nor F7 removes it. That is the next
  real lever, and it needs a profile **in the packaged app** (real GPU, no
  readback pressure) before anyone acts on it.

A smaller, honest claim is worth more here than a large one that does not
reproduce.

#### F7f — the remaining cost is the DESTINATION, not the source (SUPERSEDED: it measured the sync)

> **Correction (errata):** this section's conclusion — that the per-element
> cost of a rebuild is the *destination* canvas, and that the tile/batching
> lead follows — is **withdrawn**. The table below is reproducible, and it
> measures one thing: 100 blits into a destination, followed by a
> `getImageData` sync. The cost tracks the destination's area because the
> **sync** is charged the destination's area (Agent 1's measurement), not
> because the blits are expensive — `drawImage` is flat in the destination
> (0.0005-0.0015 ms per call), and a single 800x800 blit of the same 0.64 Mpx
> into a 4096^2 destination cost 178.8 ms *with the sync* and nothing like that
> without it.
>
> So: the destination-area term is a **read-back** cost, not a rendering-path
> cost. The app's per-frame path draws and writes; it reads back only for the
> colour picker, the PNG export and the bucket scan, which are rare one-shot
> operations. **The tile/batching lead is closed on this basis**, and the
> stamp engine's per-tile `putImageData` (flat, ~0.01 ms per tile) is fine as
> it stands.
>
> What remains genuinely open is the one thing no measurement here settled:
> **how long a rebuild actually takes in the packaged app.** That needs rAF
> frame deltas in a visible window (Appendix C), not a harness read-back.

On an idle machine the last term was isolated with a micro-benchmark: 100
blits of 80x80 px (0.64 Mpx written in total) from a small static source into
destinations of growing size.

| Destination | Destination area | Time for 100 blits | Per draw | Per destination Mpx per draw |
| --- | --- | --- | --- | --- |
| 512x512 | 0.26 Mpx | 5.8 ms | 0.06 ms | 0.22 ms |
| 1024x1024 | 1.05 Mpx | 13.5 ms | 0.14 ms | 0.13 ms |
| 2048x2048 | 4.19 Mpx | 43.1 ms | 0.43 ms | 0.10 ms |
| 4096x4096 | 16.78 Mpx | 247 ms | 2.47 ms | 0.15 ms |

The pixels written are the same 0.64 Mpx in every case, so the cost is
proportional to the **destination's area**, not to the blit and not to the call
count — one blit of 800x800 px (the same 0.64 Mpx, resampled) into a 4096^2
destination costs 178.8 ms.

This matches the renderer's own numbers from the same session: **0.28 /
0.49-0.54 / 1.72-1.84 ms per element** at 1.05 / 4.19 / 16.78 Mpx surfaces.
The per-element cost of a rebuild is therefore the *destination*: every
element is blitted into the document-sized layer surface, and each blit is
charged the destination's area.

**Consequences, stated against this audit's own earlier advice:**

* F1b (bounded blit) could not remove this term, and neither can F7 (small
  source): both shrink the source or the blit, while the cost is the
  destination.
* The only lever is **fewer draws into the document-sized surface**: batching
  (accumulate several elements into one small scratch and blit that once) or
  keeping a layer's coverage in tiles / partial surfaces and compositing per
  tile on demand. This audit had deferred the tile-based option (R5) as
  "not justified by the evidence" — that deferral no longer holds for large
  documents, though spatial batching is the cheaper first step and does not
  change the surface model.
* **Caveat:** the constant (~0.1 ms per destination megapixel) is slow — that
  is this harness, not the packaged app on a real GPU, where the same term
  should be far smaller. The transferable part is the *shape* (per-draw cost
  proportional to the destination area), not the constant, and it needs a
  packaged-app profile before anyone re-architects the surfaces around it.

### F6 — The 1x1 readback itself dominates any display-canvas measurement

A 1x1 `getImageData` on the 2560x1600 display canvas cost 18-23 ms on its own
and 42.9 ms for an empty `render()` + readback. Any future benchmark of the
app's frame cost must therefore either (a) run in the packaged app and sample
rAF deltas, or (b) instrument the renderer rather than the canvas. This audit
deliberately avoided (a) — the agent browser harness suspends `requestAnimationFrame`
when the tab is hidden (`document.hidden === true` here), so no honest
frame-rate number could be obtained in this environment.

---

## 3. Options, compared

| # | Option | What it changes | Expected effect (from the evidence) | Risk | Effort |
| --- | --- | --- | --- | --- | --- |
| **R1** | **Dirty bounds for the stroke buffer** — track the inked rect of the stroke buffer and draw only that sub-rect in `paintStrokeCoverage`; clear only that rect instead of the whole buffer in `rasterizeStrokeToBuffer` | Per-element blend goes from `document area` to `stroke bbox` | **SHIPPED** as `4ac040b`: the touched area per rebuild drops 47x-187x for typical strokes (F1b, F1c), byte-identical pixels (F7d). The millisecond effect was never measured (errata) | Medium: the buffer accumulates a whole live stroke, so the dirty rect must cover all of it; the eraser path (`destination-out`) is safe because drawing empty pixels is a no-op, but the *live* buffer and the *rebuild* buffer have different lifetimes | Done |
| **R2** | **Incremental / viewport-limited feathering** — keep the blurred result and re-blur only the newly inked band (plus the 3-radius pad), or blur only the visible region during a live stroke | Per-frame blur work stops growing with the stroke length | F3 (structural): every frame re-blurs the stroke's whole bounding box, in raster pixels, so a long stroke at 2x blurs and copies its entire footprint each frame. The *cost* of that is not quantified here (errata) | High: the "live preview == committed pixels" invariant must survive exactly. A Gaussian blur is not separable across a band boundary, so the incremental result must be proven pixel-identical, not approximately equal | Medium-large, needs pixel-equality tests |
| **R3** | **Composite cache / invalidation** — keep paper+layers in a cached canvas, invalidate on layer content/opacity/blend/visibility change, and during a stroke only draw the preview on top | Per-frame work during a stroke stops re-blending every layer | F4: one `drawImage` per visible layer, and a draw is flat in the destination size (Agent 1), so the payoff is the *number* of layers, not their area. Not quantified in milliseconds (errata) | Medium: Agent 1's fix (preview composited inside its own layer, honouring opacity/blend) must be preserved by the cache; the cache must be invalidated on every path that changes a layer's appearance | Medium |
| **R4** | **Raster-scale and surface budget policy** — keep the 16.7 Mpx document cap; additionally make `rasterScale` doc-size aware (e.g. 2x only up to 2048^2) and/or budget surfaces per layer | Memory and fill rate for big documents | F5: a 1x document at 4096^2 is 64 MiB per surface; at 2x it is 256 MiB. Lowering the scale for large documents is a visible quality trade-off | Medium-high: HiDPI crispness is a product decision; the current rule is `clamp(dpr, 1, 2)` | Small (policy) but touches product behaviour |
| **R5** | **Tile-based / partial surfaces** — keep a layer's coverage in tiles and composite per tile on demand | Would remove a destination-area term | **CLOSED as a lead.** F7f, which motivated it, was retracted: the destination-area term is the *read-back* cost of a canvas with pending work, not a rendering-path cost, and `drawImage`/`putImageData` are flat in the destination. The stamp engine already uses a tiled coverage map, and its per-tile upload is cheap (~0.01 ms per tile) | Very high: it changes the surface model, the export path, the erase snapshot and the format's mental model | Very large — **do not start on this evidence** |

---

## 4. Recommended order

0. **DONE — R1 shipped.** `4ac040b` bounds the layer rebuild by each element's
   inked rectangle: the touched area per rebuild drops 47x-187x for typical
   strokes (F1b, F1c), and the pixels are unchanged (F7d — byte-identical to
   the pre-F1b rendering in all eight measured configurations).
1. **Measure what a rebuild actually costs, in the packaged app, with rAF
   frame deltas and no read-back inside the measurement** (Appendix C). Every
   millisecond in this report is retracted (errata), so the one thing this
   audit cannot offer is a time budget for a layer rebuild. If the packaged
   app shows the rebuild is slow, the durable levers are, in order: the
   *number* of elements (a per-layer cache of the last rasterization, so an
   undo re-rasterizes only the changed element) and the *blur* work of a
   soft stroke (R2).
2. **R2 — incremental feathering**, if the packaged-app profile says the
   feather is the cost. It touches the "live preview == committed pixels"
   invariant and needs a pixel proof, not just a timing.
3. **R3 — composite cache**, if the profile says the per-frame composite is
   the cost (it scales with the number of visible layers, and each layer is one
   `drawImage`).
4. **R4 — keep the shipped document budget** (Agent 4, `fae138c`: the peak is
   58 bytes per document pixel, 928 MiB at the cap) and treat the per-layer
   surface growth as a separate, explicit policy item: either a
   layer-count/surface budget, or lazy surface allocation for layers that are
   hidden or never drawn.
5. **R5 — closed** as a lead (see the options table): its motivation was
   retracted, and the stamp engine already tiles its coverage.

**Non-goals for this audit and for the follow-up slices:** no renderer
replacement (WebGL/WebGPU stays out of scope until a profile shows Canvas 2D
is the floor), no change to the project format, no change to the document
model, no change to the "one stroke, one alpha" / "live == commit" invariants,
and no change to the stamp-engine slice that is the current roadmap item.

---

## 5. Threats to validity, restated

* **Every millisecond in this document is retracted** (errata at the top):
  the timing method's `getImageData` sync is charged the canvas's area, so
  the timings measure the flush. The durable part of this audit is the
  structural counts, the area results, the pixel verdicts and the memory
  findings — **not** the milliseconds. The one measurement that supersedes
  them all is Agent 1's write-cost benchmark (Chromium over CDP, script at
  `%TEMP%\opencode\canvas-write-cost.mjs`): `putImageData` and `drawImage` are
  flat in the destination size, and only a read-back of a canvas with pending
  work is charged that canvas's area.
* The rebuild grid (F2) and the preview grid (F3) were measured with
  interleaved rounds and a flush after each operation; the flush is the
  dominant term in both.
* The 8192^2 surface measurement (F5) is a single configuration with 3
  samples; it demonstrates a cliff, not a curve — and the cliff it shows is
  the *area* of the surface, which is arithmetic, not a timing.
* Nothing here was measured in the packaged Tauri window, on a pen device, or
  with a real GPU. No claim about packaged-app or hardware performance is
  made, and the one open question — how long a rebuild takes in the product —
  is exactly what Appendix C is for.

---

## Appendix A — how to reproduce the structural counts

```js
// in the app's page context (dev server or packaged app)
const proto = CanvasRenderingContext2D.prototype;
const orig = { draw: proto.drawImage, clear: proto.clearRect, fill: proto.fillRect };
let counts = null;
proto.drawImage = function (...a) { if (counts) counts.draw++; return orig.draw.apply(this, a); };
proto.clearRect = function (...a) { if (counts) counts.clear++; return orig.clear.apply(this, a); };
proto.fillRect  = function (...a) { if (counts) counts.fill++;  return orig.fill.apply(this, a); };

// ... drive the renderer (e.g. renderer.invalidateLayer(id); renderer.render()) ...
counts = { draw: 0, clear: 0, fill: 0 };
renderer.render();
console.log(counts);           // F1/F3/F4 numbers
proto.drawImage = orig.draw; proto.clearRect = orig.clear; proto.fillRect = orig.fill;
```

## Appendix B — how to reproduce the timings (and how this audit got them wrong)

```js
// Force the canvas pipeline to finish; without this, Canvas 2D timings are meaningless.
const sync = (ctx) => ctx.getImageData(0, 0, 1, 1);

const t0 = performance.now();
renderer.invalidateLayer(layerId);      // simulate one undo
renderer.render();                      // re-rasterizes the whole layer
sync(surfaceCtx);                       // flush
const ms = performance.now() - t0;
```

**Do not use the snippet above to time anything** — it is what invalidated
this audit's own measurements. The `getImageData` sync is not free: it is
**charged the canvas's area**, so the "flush" dominates the measurement and
scales with the canvas, which is exactly the "knee" and the 10x swings this
report originally reported. The correct way to time a frame is to let the
frame clock do it:

```js
// in a VISIBLE window (the agent browser harness suspends rAF when hidden)
const samples = [];
let last = performance.now();
const tick = () => {
  const now = performance.now();
  samples.push(now - last);
  last = now;
  if (samples.length < 120) requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
```

For the *write* costs themselves (which are flat in the destination size),
Agent 1's script drives Chromium over the DevTools protocol from Node and
needs no browser tooling: `%TEMP%\opencode\canvas-write-cost.mjs`. It measures
`putImageData`, `drawImage` and `getImageData` against destinations of
0.26-16.78 Mpx, detached and attached, headless and headed.

## Appendix C — profiling the packaged app (the recipe for the open question)

The one question this audit could not answer — **how long a rebuild actually
takes in the product** — needs the packaged Tauri window, because the harness
suspends `requestAnimationFrame` when its tab is hidden and rasterises large
canvases in software. A practical recipe that needs no new dependency:

1. Run the app (`pnpm tauri dev`, or the packaged build) with a document of a
   known size, e.g. 4096x4096, and a layer with a hundred strokes.
2. Open the WebView2 developer tools (in a dev build: `Ctrl+Shift+I`) and
   paste the instrument from Appendix A **plus** the area accounting, so the
   numbers are directly comparable with this audit:

   ```js
   const proto = CanvasRenderingContext2D.prototype;
   const orig = proto.drawImage;
   const det = (ctx) => { const t = ctx.getTransform(); return Math.abs(t.a * t.d - t.b * t.c); };
   let acc = { calls: 0, area: 0, destArea: 0 };
   proto.drawImage = function (img, ...rest) {
     acc.calls += 1;
     let dw, dh;
     if (rest.length === 2) { dw = img.width; dh = img.height; }
     else if (rest.length === 4) { dw = rest[2]; dh = rest[3]; }
     else { dw = rest[6]; dh = rest[7]; }
     acc.area += Math.abs(dw * dh) * det(this);
     acc.destArea += Math.abs(dw * dh) * det(this);
     return orig.call(this, img, ...rest);
   };
   ```

3. Draw (a) a stroke that is small on screen and (b) a stroke that fills the
   view, and compare the frame cost. Then repeat with a 2048x2048 document and
   a 4096x4096 one. The question is simply **how long a rebuild of a layer
   with a hundred strokes takes in the product**, and how that changes with
   the document size, the brush softness and the number of layers — the
   numbers this audit could not produce. If the per-frame cost grows with the
   *document* size while the on-screen content is the same, the layer surface
   is the lever (batching, or a smaller raster scale); if it does not, the
   per-element work is the lever (a per-layer cache of the last rasterization).
4. Do **not** read frame timings from a hidden window, and do not trust a
   single sample: take the median of at least five, and repeat the whole
   measurement after an unrelated build to check for drift.

**Measure the frames with `requestAnimationFrame` deltas, and do not force a
sync with `getImageData` inside the measurement.** In this harness the same
configuration measured 901 ms and 54 ms in two runs, and a "knee" appeared and
disappeared; a canvas that is read back repeatedly is served differently by
Chromium, so a readback-based sync can move a canvas between a fast and a
slow path and manufacture a cliff that is not there. rAF deltas need no sync
at all — the frame clock *is* the clock. The destination-area accounting
(Appendix A) needs no readback either: wrapping `drawImage` only counts.
If a readback is unavoidable, read a different 1x1 canvas rather than the
destination, so the destination's readback counter is not the thing being
measured.

This is the only measurement this audit could not take itself, and it is the
one that decides whether the next performance slice is worth its cost.
