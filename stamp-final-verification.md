# Stamp engine — final verification

> **Artifact type:** closing evidence report for the coordinator and the QA
> agent. Read-only: no production code, test, configuration or existing report
> was modified. This file is **new**. Nothing was staged, committed, reverted
> or reset.
>
> It makes **no decisions** reserved for the coordinator: the format-version
> policy, the plan/impl reconciliation and the doc rewording are all recorded
> as evidence with options, not chosen.

---

## 0. State inspected

| Field | Value |
| --- | --- |
| Repository | `https://github.com/aissaadib/Paka.git`, branch `main` |
| HEAD | `ad2ef11bb4fac508f0dda375a3eba5d7a9b7d7c9` — **unchanged; all stamp work is uncommitted** |
| Working tree | **dirty** — 16 modified tracked files, 14 untracked paths |
| `pnpm typecheck` | **exit 0 — clean** |
| `pnpm test` | **30 files, 515 tests, all pass** (1.86 s) |
| `node_modules/.bin` | present |
| Snapshot | 2026-10-20, after `src/test/stampCoverage.test.ts` mtime `2026-10-20 17:58:37` |

**Modified tracked:** `docs/ARCHITECTURE.md`, `docs/HANDOFF.md`,
`docs/PERFORMANCE_AUDIT_2026-10-20.md`, `docs/SESSION-BRIEF.md`,
`skills-lock.json`, `src/core/brushes/defaults.ts`,
`src/core/engine/DrawingEngine.ts`, `src/core/project/projectFormat.ts`,
`src/core/rendering/Canvas2DRenderer.ts`, `src/features/brushes/BrushControls.tsx`,
`src/test/brushSettings.test.ts`, `src/test/canvas2dRenderer.test.ts`,
`src/test/drawingEngine.test.ts`, `src/test/projectFormat.test.ts`,
`src/test/projectLifecycle.test.ts`, `src/types/brush.ts`.

**Untracked, feature-relevant:** `src/core/rendering/stampCoverage.ts`,
`src/test/stampCoverage.test.ts`, `docs/architecture-port-plan.md`,
`docs/acceptance-criteria.json`, `docs/memory-budget-review.md`, `qa/`,
`final-audit.md`, `provenance-record.json`, `reuse-decision.md`.

> **The tree is still moving — twice during this task.** The test count has
> gone 461 → 474 → 497 → 508 → 514 → **515**, the scratch benchmark file
> `src/test/tmpStampBenchmark.test.ts` appeared and was then **removed**, and
> `src/core/rendering/stampCoverage.ts` was **refactored** to introduce a
> `StampDabCursor` class. Every claim below is tagged:
>
> - **[EXECUTED]** — I ran it against the real modules.
> - **[READ]** — verified by reading the source at the cited lines.
> - **[PROPOSED]** — a test that has **not** been written and **not** been run.
>
> **All the numbers in §2 were re-executed after the refactor and still hold.**
> Re-run §1 before acting.

---

## 1. Baseline confirmation (Task 1)

```
> pnpm typecheck
> tsc -p tsconfig.json --noEmit
=== EXIT 0 ===

> pnpm test
 Test Files  30 passed (30)
      Tests  515 passed (515)
   Duration  1.86s
```

**[EXECUTED]** Both green at the snapshot above.

### 1.1 What the 515 tests cover for the stamp engine

| File | Stamp coverage |
| --- | --- |
| `src/test/stampCoverage.test.ts` (25 cases) | spacing floor; dab lattice; arc-length placement; sample-density independence; pressure-driven radius; **`describe("stamp dab cursor")` L103-137** — the incremental cursor equals the one-shot walk, and a reset starts over; the coverage profile; the **max union** (L180-203); the rectangle; the RGBA write; determinism; tile release |
| `src/test/canvas2dRenderer.test.ts` L2738-2940+ | a new `describe("Canvas2DRenderer stamp engine (real pixels)")`: four-way parity at **one pixel**, a self-crossing no-darkening case, the dab chain inside the brush radius, the coverage upload |
| `src/test/projectFormat.test.ts` L506-612 | v9 round trip, a v8 file opening with the stamp off, three missing-field refusals, three invalid-value refusals |
| `src/test/projectLifecycle.test.ts` L226-252 | the engine-level save/reopen round trip |
| `src/test/drawingEngine.test.ts` L297-357 | the stamp settings as editor state, per-stroke capture, one undo step, shapes keeping the segment path |
| `src/test/brushSettings.test.ts` L54-69 | `normalizeBrush` clamping the new fields |

### 1.2 The status of the three gaps

| Gap | Status at the snapshot |
| --- | --- |
| **Prefix stability** (Task 2) | **NOW COVERED.** The implementation was refactored to a `StampDabCursor` (see §2.A) and `src/test/stampCoverage.test.ts` L103-137 now asserts that the cursor's incremental output equals the one-shot walk. The underlying property is **tested**; the cursor's own `reset()` is tested too |
| **Whole-canvas parity** (Task 3) | **NOT covered.** The stamp parity test still compares a single pixel. §2.B specifies the test and the differ it needs |
| **Fractional coordinates / the `ceil`** (Task 4) | **NOT covered.** Every fixture still uses integer sample coordinates. §2.C specifies the test and the expected bounds |

**[EXECUTED]** A search of the whole test tree for the distinguishing terms
returns nothing that matches the remaining two:

```
rg -n "prefix|append|fractional|whole.canvas|wholeCanvas|differ|ceil|boundary" src/test
```

The only hits are unrelated (`commandStack.test.ts:169`, `base64.test.ts:44`,
`floodFill.test.ts:62`, `path.test.ts:44`, `strokeBuilder.test.ts:33`, …) plus
`Math.ceil` uses **inside** the `PixelCanvas` software rasteriser
(`canvas2dRenderer.test.ts:1607-1608, 1884-1885, 1918-1919`) — the rasteriser's
own geometry, **not** the renderer's `strokeRegion`.

### 1.3 The leftover scratch file — resolved

**[READ]** `src/test/tmpStampBenchmark.test.ts` (88 lines: `console.log`
timings, asserting only `expect(total).toBeGreaterThanOrEqual(0)`) existed in
an earlier snapshot of this session. **It has since been removed** by the
other agent, and the file count dropped from 31 to 30. No action needed.

---

## 2. The three specified tests

### 2.A — Prefix stability of the dab list (Task 2)

**The implementation has been refactored since the previous handoff, and
this gap is now closed.** `src/core/rendering/stampCoverage.ts` now exports a
`StampDabCursor` class (L107), and `stampDabs` (L90-91) is a one-shot wrapper
around it:

```ts
export function stampDabs(path: StampPath, brush: BrushSettings): StampDab[] {
  return new StampDabCursor(brush).advance(path);
}
```

The cursor owns the lattice state (`sampleIndex`, `carried`, `started`,
`previousX/Y`, L109-113), has a `reset()` (L120-126) and an
`advance(path)` (L129) that returns **only the dabs the path gained since the
last call**. The renderer now holds `stampCursor: StampDabCursor | null`
(`src/core/rendering/Canvas2DRenderer.ts` L183) instead of the old
`stampDabCount`, and `extendStampStroke` (L955) calls `cursor.advance(stroke)`
(L961).

Its own doc comment (L96-106) states the contract:

> "The cursor is an accelerator, not a second source of truth: it walks the
> same path as `stampDabs` and keeps the remainder of the last segment, so the
> dabs it returns are exactly the ones the full walk would produce. […] A
> cursor belongs to one stroke: it must be reset when the path it follows
> changes, because a dab's place depends on the path before it."

**The property is now asserted** by `src/test/stampCoverage.test.ts` L103-137:

- L104 *"places the same dabs incrementally as it does in one go"* — walks a
  five-sample path through a cursor, concatenates each step's output, and
  asserts `expect(incremental).toEqual(stampDabs({xs, ys, pressures}, settings))`.
  Because the concatenation must equal the one-shot list exactly, this proves
  both that the cursor never re-emits an earlier dab and that the incremental
  output is the full list.
- L128 *"starts over when it is reset"* — `reset()` then `advance()` reproduces
  the first result.

**[EXECUTED] The suite is green with these cases** (515 tests, 30 files).

What remains is the *end-to-end* form of the same property — that the
**renderer's** live union and the **rebuild** union agree — which is §2.B.

#### 2.A.1 The property, stated precisely (unchanged by the refactor)

`stampDabs(path, brush)` must satisfy, for every prefix `path[0..k)` of an
append-only path:

> `stampDabs(path[0..k), brush)` is a **prefix** of `stampDabs(path, brush)` —
> same length, and every element `i` has identical `x`, `y` and `radius`.

**[READ] Why it holds.** The walk is forward-only: `dab 0` depends only on
`path.xs[0]`, `path.ys[0]`, `path.pressures[0]`; every later dab depends only
on the two samples that straddle it and the `carried` remainder carried forward
from earlier segments. Appending a sample adds segments at the end and changes
nothing earlier. The engine only ever appends (`StrokeBuilder.addSample`
pushes; `finish` appends the settle point), and `replaceStroke` (shape
outlines) resets the cursor (`Canvas2DRenderer.ts` L373).

#### 2.A.2 Verified expected values — re-executed after the refactor

**[EXECUTED]** Against the real `stampDabs` (Vite SSR load of
`/src/core/rendering/stampCoverage.ts`), with

```ts
const brush = updateBrushSettings(DEFAULT_BRUSH, {
  size: 8, stamp: true, stampSpacing: 0.25, stampHardness: 1,
});
// stampSpacing(brush)          === 2      (document px)
// strokeDiameter(brush, 1)      === 8      -> dab radius 4
// strokeFeatherRadius(brush)    === 0
// spread (strokeSampleBounds)   === 5
```

and the path `{ xs: [0, 20, 40], ys: [0, 0, 0], pressures: [1, 1, 1] }`:

| prefix | dab count | dab x values | is a prefix of the full list? |
| --- | --- | --- | --- |
| `[0]` | 1 | `0` | **yes** |
| `[0, 20]` | 11 | `0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20` | **yes** |
| `[0, 20, 40]` | 21 | `0, 2, 4, …, 38, 40` | identical to the full list |

**[EXECUTED] Every dab has `y = 0` and `radius = 4`.** These values are
**unchanged by the `StampDabCursor` refactor** — re-run after it landed.

#### 2.A.3 What the existing cursor test does *not* cover

**[READ]** The new test compares the cursor's output against the one-shot
`stampDabs`, both of which are *pure functions of the same path*. It does
**not** assert:

1. that the **coverage** is the same, only that the dab **list** is — the
   union lives in `StampCoverage.paintDab`, and a change there would not be
   caught by a list comparison. A pixel-level variant (paint the incremental
   dabs into one map, paint the one-shot dabs into another, compare the bytes)
   would close this;
2. the **renderer's** incremental path against its **rebuild** path — that is
   §2.B;
3. that the cursor is **reset** when the path changes shape. The engine does
   reset it (`Canvas2DRenderer.ts` L298, L318, L373 create a fresh cursor;
   L1041 drops it), and the unit test at L128 covers `reset()` in isolation,
   but no test drives the renderer through a path that *changes* and checks the
   cursor was reset.

#### 2.A.4 A guard worth adding

**[READ]** `StampDabCursor.advance` walks `for (let index = this.sampleIndex;
index < count; index += 1)` (L148) and `sampleIndex` only ever moves forward.
If the path ever *shrank*, the cursor would emit nothing and keep its stale
`carried` remainder — the coverage map would keep the old dabs' pixels. The
engine never shrinks a brush stroke (shapes replace their outline, but
`shapeBrush` at `src/core/engine/DrawingEngine.ts` L226 forces `stamp: false`
for every shape, and `replaceStroke` resets the cursor at
`Canvas2DRenderer.ts` L373), so the invariant holds — but it is unguarded. A
one-line assertion ("the dab count never decreases across `extendStroke`
calls") would pin it.

---

### 2.B — Whole-canvas live-preview vs commit parity (Task 3)

#### 2.B.1 The gap

**[READ]** The existing stamp parity test
(`src/test/canvas2dRenderer.test.ts` L2775-2818) compares live / rebuild /
commit / export at **one pixel**, `STAMP_X = 16`, `STAMP_Y = 14` (L2739-2740).
A mismatch at any other pixel is invisible to it.

The asymmetry it cannot see is real: the **live** path draws the *whole* stroke
buffer (`paintDocument` L670 → `paintStrokeCoverage` without a region → L1028
`ctx.drawImage(this.strokeBuffer, 0, 0, doc.width, doc.height)`), while the
**commit** composites only `strokeRegion(stroke)`
(`compositeStrokeBuffer` L1116 → L978-equivalent → the 9-argument region blit).

#### 2.B.2 Proposed test

**Where:** `src/test/canvas2dRenderer.test.ts`, a new `describe` beside the
existing stamp block (L2738+).

**Harness:** `withPixels` (L2134) — installs the pixel-accurate `document` and
hands back `{ renderer, display, doc, strokeBuffer, surfaces, elements }` on a
**32 × 32** document with `rasterScale: 1` (L2158-2164).

**Utilities to use, and why they suffice:**

| Utility | Location | Why |
| --- | --- | --- |
| `PixelCanvas.pixels` | L1501, a `Float32Array` of straight-alpha floats | the whole-canvas comparison is a flat array compare |
| `PixelCanvas.putImageData` | L1950-1971 — **it stores the pixels** | the stamped coverage really lands in the buffer, so a pixel test can see it |
| `PixelCanvas.createImageData` | L1942-1949 | the upload path works end to end |
| `readPixel` / `expectPixel` | L2086 / L2095 | per-pixel assertions |
| `coverageInside` | L2426 | the region guard |
| `comparePixels` (browser harness) | `qa/harness.ts` L200, with an `ignoreBorder` parameter | **the model to mirror** for the whole-canvas differ |

**The whole-canvas differ** must be written locally (the Vitest harness has
none). It compares two `PixelCanvas` buffers element-wise and reports the
number of differing pixels, the maximum channel delta and the bounding box of
the difference — the same shape as `qa/harness.ts` L200.

**Steps (mirroring L2775-2818, but comparing whole canvases):**

1. `elements.set(layerId, [stored])` → `invalidateLayer` → `render` → capture
   the **rebuilt** display pixels.
2. `elements.set(layerId, [])` → `invalidateLayer` → `render` → clear.
3. `beginStroke(live)` → `extendStroke(live, 0)` → `render` → capture the
   **live** display pixels.
4. `endStroke(live)` → `render` → capture the **committed** display pixels.
5. `elements.set(layerId, [live])` → `invalidateLayer` → `render` → capture the
   **rebuilt** display pixels again.
6. `composeDocumentImage()` → capture the **export** pixels.

**Assertions:**

| # | Comparison | Expected |
| --- | --- | --- |
| B1 | live vs committed | **0 differing pixels** over the whole 32 × 32 canvas |
| B2 | committed vs rebuilt | **0 differing pixels** |
| B3 | rebuilt vs export | **0 differing pixels**, excluding the 1-device-pixel border ring |
| B4 | every pixel of the live and committed canvases outside the stroke's own neighbourhood is identical to the paper | no stray ink |

**On B3:** the display canvas draws a hairline document border
(`Canvas2DRenderer.ts` L440-442) and the export does not, so the outermost
1-pixel ring must be excluded. `qa/harness.ts` L205/L227-236 has exactly this
`ignoreBorder` parameter; the Vitest differ needs the same.

**What incorrect behaviour it must catch:**

- **coverage escaping `strokeRegion`** — visible live, dropped at commit. The
  one-pixel comparison cannot see this; a whole-canvas compare can.
- **a coverage-upload offset or scale error** — `writeStampCoverage`
  (L1019-1037) writes `putImageData(image, left, top)` in **device** pixels and
  `putImageData` ignores the context transform (its comment L1014-1017 says
  so). A scale mistake would *move* the whole stroke rather than shift it —
  visible at (16,14) only by luck.
- **the incremental-vs-rebuild divergence of §2.A** — the live path and the
  rebuild path union the dabs differently.
- **a colour error** — the upload writes the brush colour with the coverage as
  the alpha (`stampCoverage.ts` `writeRect` L246-284).

#### 2.B.3 The near-boundary case

The same test, with a stroke placed so its dabs reach the region edge.

**Proposed inputs** (all values **[EXECUTED]**):

```ts
const brush = updateBrushSettings(DEFAULT_BRUSH, {
  size: 8, stamp: true, stampSpacing: 0.25, stampHardness: 1,
});
const stroke = {
  xs: [6.5, 26.5], ys: [10.5, 10.5], pressures: [1, 1],
};
```

| Quantity | Value (executed) |
| --- | --- |
| dabs | **11**, at `x = 6.5, 8.5, 10.5, 12.5, 14.5, 16.5, 18.5, 20.5, 22.5, 24.5, 26.5`, all `y = 10.5` |
| dab radius | **4** |
| document bounds (`strokeSampleBounds`, spread 5) | `minX 1.5, minY 5.5, maxX 31.5, maxY 15.5` |
| region at `rasterScale 1` | `left 1, top 5, right 32, bottom 16` → **x ∈ [1, 31], y ∈ [5, 15]** (31 × 11) |
| actual coverage rectangle | `left 2, top 6, width 29, height 9` → **x ∈ [2, 30], y ∈ [6, 14]** |
| margin | **exactly 1 px on all four sides** |

**Additional assertions for this case:**

- B5: live == committed == rebuilt, every pixel.
- B6: `coverageInside(strokeBuffer, 1, 5, 31, 15)` is **true** — the coverage
  is inside the region, using the **derived** region, not a hard-coded box.
- B7: the coverage's extreme pixels are at **x = 2 and x = 30** and **y = 6 and
  y = 14** — i.e. the 1 px margin is exactly what the geometry says it is. This
  pins the spread formula and the dab footprint together, so a change to
  either is caught.

---

### 2.C — Fractional coordinates and the `ceil` in `strokeRegion` (Task 4)

#### 2.C.1 The mechanism

**[READ]** `strokeRegion` (`src/core/rendering/Canvas2DRenderer.ts` L1090-1104)
computes:

```
left   = max(0, floor(bounds.minX * scale))
top    = max(0, floor(bounds.minY * scale))
right  = min(bufferWidth,  ceil(bounds.maxX * scale))
bottom = min(bufferHeight, ceil(bounds.maxY * scale))
```

and `strokeSampleBounds` (L1063-1082) computes
`spread = strokeDiameter(brush, 1) / 2 + featherRadius * 3 + 1`.

**The `ceil` on the max edge is a no-op whenever the bounds are integral**,
because `floor(v) === ceil(v)` for an integer `v`. Every existing fixture uses
integer sample coordinates, so the asymmetric case is never exercised.

#### 2.C.2 Verified expected values

**[EXECUTED]** brush size 8, hardness 1, texture 0, `stampSpacing 0.25` →
spacing 2, dab radius 4, **spread 5**. At `rasterScale 1`:

| Path | doc bounds | region with `ceil` | region with `floor` | `ceil` vs `floor` |
| --- | --- | --- | --- | --- |
| **integer** `xs [6,16,26] / ys [6,14,6]` | `minX 1, minY 1, maxX 31, maxY 19` | `left 1, top 1, **30 × 18**` → x ∈ [1,30], y ∈ [1,18] | 30 × 18 → x ∈ [1,30], y ∈ [1,18] | **identical** — the `ceil` is a no-op |
| **fractional** `xs [6.5,16.25,26.75] / ys [6.25,14.5,6.75]` | `minX 1.5, minY 1.25, maxX 31.75, maxY 19.5` | `left 1, top 1, **31 × 19**` → x ∈ [1,31], y ∈ [1,19] | 30 × 18 → x ∈ [1,30], y ∈ [1,18] | **differ by 1** — the `ceil` is load-bearing |

**Actual coverage rectangles [EXECUTED]:**

| Path | coverage | margin with `ceil` |
| --- | --- | --- |
| integer | x ∈ [1, 29], y ∈ [1, 17] | left 0, right 1, top 0, bottom 1 |
| fractional | x ∈ [2, 29], y ∈ [1, 18] | left 1, right 2, top 0, bottom 1 |

**The precise conclusion, and it is narrower than "the `ceil` is required":**
with the *current* spread formula the coverage still fits inside the `floor`
region (the fractional coverage's `y = 18` is exactly the `floor` region's last
row, and its `x = 29` is one inside). **The `ceil` therefore buys exactly
1 pixel of margin on the max edges; it is a safety margin, not a correctness
requirement** — *given* `spread = radius + 1`.

That is the honest statement, and it is why the test below asserts the
**margin**, not merely containment: the margin is what would disappear if the
spread formula lost its `+1`, or if a stamp's footprint grew past the brush
radius.

#### 2.C.3 Proposed test

**Where:** `src/test/canvas2dRenderer.test.ts`.

**Inputs:** the same brush; two strokes that differ **only** in their sample
coordinates — the integer path and the fractional path above.

**Assertions:**

| # | Assertion | Expected value (executed) |
| --- | --- | --- |
| C1 | the two strokes produce **different** composited regions | 30 × 18 (integer) vs **31 × 19** (fractional) — this difference *is* the observable effect of the `ceil`, and no integer-only fixture can see it |
| C2 | live == committed == rebuilt, **every pixel**, for the fractional path | 0 differing pixels |
| C3 | the fractional coverage is inside the derived region | `coverageInside(strokeBuffer, 1, 1, 31, 19)` is **true** |
| C4 | the margin is what the geometry says | the fractional coverage's maximum x is **29** (region max 31 → margin 2) and its maximum y is **18** (region max 19 → margin 1) |
| C5 | the integer path still behaves | its region is 30 × 18 and its coverage is x ∈ [1,29], y ∈ [1,17] |

**What incorrect behaviour it must catch:**

- a `ceil` → `floor` regression on the max edges — the fractional region would
  shrink to 30 × 18 and the **1 px margin would vanish** (C4 fails);
- a change to the `spread` formula in `strokeSampleBounds` (L1067) — either the
  region would shrink below the coverage (C3 fails) or grow for no reason (C1
  and C4 fail);
- a dab footprint that outgrew the brush radius — `stampDabCoverage`'s
  antialiased rim reaches `radius + 0.5`
  ( **[EXECUTED]** `stampDabCoverage(4.4, 4, 1) = 0.028` → byte 7;
  `stampDabCoverage(4.5, 4, 1) = 0` → byte 0 ), so a wider profile would push
  the coverage past the region and C3 would fail.

#### 2.C.4 The coverage profile, for reference

**[EXECUTED]** `stampDabCoverage(distance, radius 4, hardness 1)`:

| distance | coverage | byte |
| --- | --- | --- |
| 0 | 1 | 255 |
| 3.9 | 0.648 | 165 |
| 4.0 | 0.5 | 128 |
| 4.4 | 0.028 | 7 |
| 4.5 | 0 | 0 |
| 4.6 | 0 | 0 |

So the rim reaches **0.5 document px past the radius** and is zero beyond —
which is exactly the 1 px of slack the spread's `+1` provides for.

---

## 3. `docs/architecture-port-plan.md` vs the implementation (Task 5)

**[READ]** The plan is a *living* document: it now carries a corrections table
at L1038-1046 (C1-C7) and several sections have been rewritten. Its own
claim at L1036 is that **"all are applied above"**. **That claim is not true.**
The corrections were applied to some sections and not others, and the plan
still contradicts itself internally.

### 3.1 Discrepancies that remain in the plan

| # | Plan location | Plan says | Implementation says | Status |
| --- | --- | --- | --- | --- |
| **P1** | L206 (Q7 answer), L218 (§3 row 4), L389 (§5.3 editor-state row), L412-413 (§5.3 format table), L555, L825-826 (§11.1 test list), L999 | the fields are **`stampSpacing` + `stampFalloff`**; `DEFAULT_BRUSH` gains "`stampSpacing: 0`, `stampFalloff: 0`" | **`stamp: boolean`, `stampSpacing: number`, `stampHardness: number`**; `DEFAULT_BRUSH` gains `stamp: false, stampSpacing: 0.1, stampHardness: 1` (`src/core/brushes/defaults.ts` L29-31) | **STALE in 7 places** — the plan's own C2 correction covers "§1.1, §3 (rows 1, 3), §5.1, §5.3, §11.1" but §5.3 and §11.1 still carry the old names |
| **P2** | L260 (the dispatch diagram), L412, L555, L826, L875 | the legacy path is selected by **`stampSpacing === 0`**, and the format defaults `stampSpacing` to `0` | the dispatch is **`brush.stamp === true`** (`Canvas2DRenderer.ts` L941-943); `stampSpacing` is clamped to a **minimum of 0.02** (`defaults.ts` L11, L48), so `0` is **unreachable** | **STALE, and now describes an impossible state** — L875's fallback option ("ship a build whose default `stampSpacing` is `0`") cannot be built with the current clamp |
| **P3** | L265 ("dab *k* sits at arc length *k* · stampSpacing · **diameter**"), L460 ("arc length `k · stampSpacing · **size`**"), L788 ("Dabs are spaced `stampSpacing · **diameter**` apart") | the spacing unit is variously the *diameter* and the *size* — **the plan contradicts itself between L265 and L460** | the spacing is a fraction of the brush's **nominal size**: `stampSpacing(brush) = max(brush.size * clamp(brush.stampSpacing, 0, 1), MIN_STAMP_SPACING_PX)` (`src/core/rendering/stampCoverage.ts` L72-74; the doc at L68-74 says *"against the brush's **nominal size**, not of the pressure-varying diameter"*) | **STALE at L265 and L788**; L460 is the one that matches the code |
| **P4** | L412 | `stampSpacing` is "**required**, number in `[0, 2]`" | `MIN_STAMP_SPACING = 0.02`, `MAX_STAMP_SPACING = 1` (`defaults.ts` L11-12) | **STALE** — the range in the plan's format table is wrong on both ends |
| **P5** | L188 (Q2 answer), L945 ("UI (two sliders, rename)") | **two sliders**, and the existing control is **renamed** — "Spacing" becomes **"Sampling"** | a **"Stamp" toggle** (`BrushControls.tsx` L88) plus **"Stamp spacing"** (L96) and **"Stamp hardness"** (L106) sliders; the existing **"Spacing"** slider is **unchanged** | **STALE** — and the plan's rename is unnecessary: the implemented names avoid the collision entirely |
| **P6** | L206 (Q7 answer), L555 | "the shape's stroke record stores `stampSpacing: 0` and `stampFalloff: 0`" | the shape's record stores **`stamp: false`**; the other two fields keep their values (`src/core/engine/DrawingEngine.ts` L226-227 `shapeBrush`, used at L1136) | **STALE in wording**; the *behaviour* matches (the shape records the segment path) |
| **P7** | L133, L501, L663 | "58 bytes per document pixel" as the *pre-slice* figure, with §9.3 originally proposing **58 → 62** | the plan's §9.3 has been **corrected** (L663-692) to say the **58 B/doc px envelope holds**, worst case 56 B/doc px (896 MiB) | **RECONCILED** by Agent 4's `docs/memory-budget-review.md`, whose corrections are tabulated at plan L1040 (C1) |

### 3.2 Discrepancies that are already reconciled

| # | Aspect | Reconciled as |
| --- | --- | --- |
| R1 | module name | `src/core/rendering/stampCoverage.ts` — plan L215, L289, L347-348, L1041 (C2) all name it; the note "the plan originally said `stampRaster.ts`" is retained at L215/L347 |
| R2 | test file name | `src/test/stampCoverage.test.ts` — plan L223, L784, L1041 |
| R3 | pure-module API | plan L347-348 maps the sketched `planDabs`/`addDab`/`toImageData`/`reset` onto the real `stampDabs` / `StampCoverage.paintDab` / `writeRect` / `clear` |
| R4 | v9 policy (Q1) | plan L200 now carries the note "*(Implemented: `PROJECT_VERSION = 9` with the three fields required from v9 and defaulted off for v1–v8.)*" — matching `src/core/project/projectFormat.ts` L100 and L736-748 |
| R5 | the dab budget (Q8) | plan L207 correctly marks it **"❌ Not implemented yet — and it is the highest-priority gap"**. **[READ]** the tree confirms this: `MIN_STAMP_SPACING_PX = 0.5` (`stampCoverage.ts` L35) is the only bound; there is **no total dab budget** |

### 3.3 Memory accounting — the corrected figures, restated

**[READ]** the corrected §9.3 (plan L663-692) and `docs/memory-budget-review.md`
§2. The documented envelope is **58 B/doc px**
(`src/core/document/document.ts`: `3 * 4 * 2 * 2 + 10`), and the coverage tiles
are transients that fit **inside** the 10 B/doc px scan allowance:

| Scenario | Peak (plan L680-686) |
| --- | --- |
| Bucket fill | ≤ 46 B/doc px (736 MiB) |
| Stamped brush stroke | ≤ 40 B/doc px (640 MiB) |
| Stamped eraser stroke | ≤ 56 B/doc px (896 MiB) |
| Stamped stroke + grouped preview | ≤ 56 B/doc px (896 MiB) |
| Layer rebuild of stamped elements | ≤ 52 B/doc px (832 MiB) |

**The one allocation that breaks it** (plan L694-699, review §4.4):
`writeStampCoverage` creates **one `ImageData` for the whole dirty rectangle**
(`src/core/rendering/Canvas2DRenderer.ts` L1034) — in the rebuild path that
rectangle is the stroke's bounding box, **document-sized (256 MiB at the cap)**.
It fits only because a rebuild normally happens with no gesture in flight.

**[READ] Independently confirmed.** `rasterizeStampStroke` (L989-1009) unions
every dab's rectangle into `dirty` and then calls
`writeStampCoverage(coverage, dirty, color)`; `writeStampCoverage` (L1019-1037)
does `const image = this.strokeCtx.createImageData(width, height)` for that
whole rectangle and `putImageData(image, left, top)` (L1034, L1036). A stroke
spanning the document therefore allocates a document-sized `ImageData`.

**This is directly relevant to §2.B**: the whole-canvas parity test drives the
rebuild path, so it exercises this allocation. At the harness's 32 × 32 scale
it is trivial; a *large-document* variant of the test would surface it.

### 3.4 The one discrepancy that is a genuine internal contradiction

**[READ]** the plan asserts at **L1036** that "corrections were required; all are
applied above", but **P1-P6 above show they were not all applied**. The plan
therefore currently describes a *different* field set, a different off-sentinel,
a different spacing unit and a different range from the code it plans. A reader
following it would implement `stampFalloff` on top of the tree's
`stampHardness`.

---

## 4. `docs/HANDOFF.md` audit (Task 6)

**[READ]** `docs/HANDOFF.md` was modified in this working tree, but **the diff
is entirely about the pre-slice baseline** — it pins `ad2ef11`, corrects the
test count to 474/29 files, and adds the `2fa34cc` and `4ac040b` rows to the
shipped-slices table. **It contains no stamp-slice documentation at all.**

### 4.1 Stale statements

| # | Line | Current text | Why it is stale |
| --- | --- | --- | --- |
| **H1** | 74 | "**Project file format version 8** (`PROJECT_VERSION = 8`)." | the code is **9** (`src/core/project/projectFormat.ts` L100) |
| **H2** | 167 | "**Project format is version 8.**" | same |
| **H3** | 175-180 | the version-history paragraph ends "version 8 allows `multiply` and `screen` as well" | **incomplete** — needs the v9 sentence (the fields are required from v9, defaulted off for v1-v8) |
| **H4** | 221 | "it is a safety limit, not a schema change: the format version stays 8." | true *of the budget slice*, false as a statement of the current version |
| **H5** | 285 | "a true per-pixel profile needs the deferred stamp/distance-field engine." | the engine now exists (`src/core/rendering/stampCoverage.ts`) |
| **H6** | 448-449 | "A 900 px screenshot confirmed Size/Opacity/Hardness/Spacing/Stabilizer/Texture and both pressure toggles." | the toolbar now has a **Stamp** toggle plus **Stamp spacing** and **Stamp hardness** sliders (`src/features/brushes/BrushControls.tsx` L88, L96, L106) |
| **H7** | 453-456 | "## 9. Next move — **Stamp-based brush engine behind the existing stroke interface**" | the slice is implemented in the working tree; §9 should describe what shipped and what is next |
| **H8** | 466-467 | "a non-default stamp/dab appearance cannot be ignored by a v8 reader without changing the picture, so expect **format version 9** if fields change output" | v9 **has** shipped, with the three fields required |
| **H9** | 524 | "there is no stamp engine yet" | stale |
| **H10** | 520 | "hardness is a Gaussian feather of the stroke silhouette (not a stamp profile)" | still true **of `hardness`**, but the sentence now needs the per-dab alternative alongside it |

### 4.2 Statements that are still correct (and must not be "fixed")

| Line | Text | Verdict |
| --- | --- | --- |
| 216-217 | "58 bytes per document pixel (`3 x 4 x 2^2 + 10`), 928 MiB at the cap" | **correct** — Agent 4's review confirms the envelope holds (worst case 56) |
| 252 | "**Spacing is sample density, not stamp spacing.**" | **correct** — the tree keeps the two distinct (`spacing` vs `stampSpacing`) |
| 269 | "**Texture is a single grain pass over the finished coverage, not stamps.**" | **correct** — the texture post-pass is unchanged |
| 279-281 | "**Texture forced format version 7.**" | correct history |
| 90-101 | the shipped-slices table's "format version 8" / "format version 7" entries | **correct history** — they describe past commits, not the current version |
| 72 | "**`pnpm test` → 474 tests in 29 files, all pass** (re-run at `ad2ef11`)" | correct **for the committed tree**; it will need updating when the slice commits (the working tree is 31 files / 514 tests) |

### 4.3 A section that needs a look but was not verified line by line

**[READ]** the "Brushes" bullet in §5 of `docs/HANDOFF.md` enumerates the brush
fields. It could not be located by a heading grep, so its line number was not
confirmed; it is very likely to list only the pre-slice fields
(`size`, `opacity`, `hardness`, `spacing`, `stabilizer`, `texture`) and would
need the three new ones added. **Flagged for the doc pass, not asserted.**

---

## 5. Verified results vs tests that have not been run

### 5.1 Verified

| Claim | How |
| --- | --- |
| HEAD `ad2ef11`; the stamp work is uncommitted | `git rev-parse HEAD`, `git status` |
| `pnpm typecheck` exits 0; `pnpm test` → 31 files / 514 tests, all pass | executed |
| The dab list **is** prefix-stable under sample appends (1 / 11 / 21 dabs, exact x values, identical y and radius) | executed against the real `stampDabs`, **re-run after the `StampDabCursor` refactor** |
| The incremental cursor equals the one-shot walk, and `reset()` starts over | read, `stampCoverage.test.ts` L103-137; the suite is green |
| The near-boundary path `[6.5, 26.5] × [10.5, 10.5]` yields 11 dabs at x = 6.5 … 26.5, radius 4 | executed |
| Its region is 31 × 11 (x ∈ [1,31], y ∈ [5,15]) and its coverage is 29 × 9 (x ∈ [2,30], y ∈ [6,14]) — a 1 px margin on all four sides | executed |
| The integer path's region is 30 × 18 and the fractional path's is 31 × 19; the `ceil` and `floor` agree for the integer path and differ by 1 for the fractional one | executed |
| The fractional coverage (x ∈ [2,29], y ∈ [1,18]) still fits inside the `floor` region — so the `ceil` buys a 1 px **margin**, not correctness | executed |
| `stampDabCoverage` reaches 0 at `radius + 0.5` (byte 7 at 4.4, byte 0 at 4.5) | executed |
| The union is a true per-pixel maximum (`if (value > tile[index])`) | read, `stampCoverage.ts` L229-231 |
| The rebuild path allocates one `ImageData` for the whole dirty rectangle | read, `Canvas2DRenderer.ts` L1034 |
| The plan retains 6 stale statements and 2 internal contradictions | read, §3.1 and §3.4 |
| `docs/HANDOFF.md` carries 10 stale stamp-related statements | read, §4.1 |

### 5.2 Not run — proposed only

**None of the following exists in the tree, and none has been executed:**

| ID | Test | Where it should go | Status |
| --- | --- | --- | --- |
| **T-A** | dab-list prefix stability | `src/test/stampCoverage.test.ts` L103-137 | **NOW WRITTEN AND PASSING** (by the other agent, after the `StampDabCursor` refactor). The *coverage-level* and *renderer-level* forms remain open — §2.A.3 |
| **T-B** | whole-canvas live vs commit vs rebuild vs export | `src/test/canvas2dRenderer.test.ts` (new `describe` beside L2738+) | **PROPOSED — not written, not run** |
| **T-B2** | the same, with the near-boundary stroke | same | **PROPOSED — not written, not run** |
| **T-C** | fractional coordinates vs integer, and the `ceil` margin | same | **PROPOSED — not written, not run** |
| **T-D** | the cursor monotonicity guard (`dabs.length` never decreases across `extendStroke` calls) | `src/test/canvas2dRenderer.test.ts` | **PROPOSED — not written, not run** |

The **expected values** quoted in §2 are executed against the real modules, so
the assertions are pinned to observed behaviour rather than to a guess. The
tests themselves remain unproven until someone writes and runs them.

---

## 6. Reproduction

```powershell
cd C:\Users\aissa\Desktop\Paka

# state
git rev-parse HEAD                 # ad2ef11bb4fac508f0dda375a3eba5d7a9b7d7c9
git status --short
git diff --stat

# baseline
pnpm typecheck                     # expect: no output, exit 0
pnpm test                          # expect: Test Files 30 passed (30) / Tests 515 passed (515)

# what is and is not covered
rg -n "prefix|wholeCanvas|differ" src/test/stampCoverage.test.ts src/test/canvas2dRenderer.test.ts
rg -n "stamp dab cursor" src/test/stampCoverage.test.ts   # the cursor test DOES exist (L103-137)
rg -n "stamp|Stamp" src/test/projectFormat.test.ts src/test/projectLifecycle.test.ts src/test/drawingEngine.test.ts
rg -n "readPixel\(harness.display" src/test/canvas2dRenderer.test.ts   # single-pixel comparisons

# the plan's stale statements
rg -n "stampFalloff" docs/architecture-port-plan.md
rg -n "stampSpacing === 0|stampSpacing: 0|stampSpacing = 0" docs/architecture-port-plan.md
rg -n "spacing · diameter|stampSpacing · diameter" docs/architecture-port-plan.md

# the doc's stale statements
rg -n "format version 8|PROJECT_VERSION = 8|no stamp engine yet|deferred stamp" docs/HANDOFF.md

# the leftover scratch file
Get-Content src/test/tmpStampBenchmark.test.ts | Select-Object -First 5
```

**How the executed numbers in §2 were produced.** The real modules were loaded
through Vite's SSR transform (`createServer({ root: repo })` +
`server.ssrLoadModule('/src/core/rendering/stampCoverage.ts')`) from a script
in the OS temp directory. **No file was created inside the repository**, no
test was added, and nothing was staged, committed, reverted or reset.

**Not done:** no browser run, no packaged-app run, no modification of any file
except the creation of this one; no fix, no test, no decision taken on the
format-version policy, the plan reconciliation or the doc rewording.

---

### Appendix — key line references at the inspected snapshot

| Symbol | File | Lines |
| --- | --- | --- |
| `MIN_STAMP_SPACING_PX` / `COVERAGE_TILE_SIZE` | `src/core/rendering/stampCoverage.ts` | 35 / 38 |
| `StampDab` / `StampPath` / `StampRect` | `src/core/rendering/stampCoverage.ts` | 41 / 51 / 58 |
| `stampSpacing` | `src/core/rendering/stampCoverage.ts` | 72-74 |
| `stampDabs` (a one-shot wrapper) | `src/core/rendering/stampCoverage.ts` | 90-91 |
| `StampDabCursor` / `reset` / `advance` | `src/core/rendering/stampCoverage.ts` | 107 / 120-126 / 129 |
| `stampDabCoverage` | `src/core/rendering/stampCoverage.ts` | 145-156 |
| `StampCoverage` / `paintDab` / `writeRect` / `clear` | `src/core/rendering/stampCoverage.ts` | 167 / 177-237 / 246-284 / 287 |
| `unionStampRect` | `src/core/rendering/stampCoverage.ts` | 314-323 |
| `isStamped` | `src/core/rendering/Canvas2DRenderer.ts` | 941-943 |
| `extendStampStroke` | `src/core/rendering/Canvas2DRenderer.ts` | 955-979 |
| `stampCursor` (the renderer's cursor) | `src/core/rendering/Canvas2DRenderer.ts` | 183, 298, 318, 373, 1041 |
| `rasterizeStampStroke` | `src/core/rendering/Canvas2DRenderer.ts` | 989-1009 |
| `writeStampCoverage` | `src/core/rendering/Canvas2DRenderer.ts` | 1019-1037 |
| `strokeSampleBounds` | `src/core/rendering/Canvas2DRenderer.ts` | 1063-1082 |
| `strokeRegion` | `src/core/rendering/Canvas2DRenderer.ts` | 1090-1104 |
| `compositeStrokeBuffer` / `paintStrokeCoverage` | `src/core/rendering/Canvas2DRenderer.ts` | 1116 / 1152 |
| `paintDocument` (live preview, no region) | `src/core/rendering/Canvas2DRenderer.ts` | 628, 670 → 1028 |
| `MIN/MAX_STAMP_SPACING`, `DEFAULT_BRUSH`, `normalizeBrush`, `brushSettingsEqual` | `src/core/brushes/defaults.ts` | 11-12, 18-32, 35-51, 61-77 |
| `BrushSettings` stamp fields | `src/types/brush.ts` | 68-96 |
| `PROJECT_VERSION = 9` / `readBrush` / the v9 gate | `src/core/project/projectFormat.ts` | 100 / 699 / 736-748 |
| `shapeBrush` / its use | `src/core/engine/DrawingEngine.ts` | 226-227 / 1136 |
| the Stamp toggle and the two sliders | `src/features/brushes/BrushControls.tsx` | 88, 96, 106 |
| `PixelCanvas` / `putImageData` / `createImageData` | `src/test/canvas2dRenderer.test.ts` | 1501 / 1950-1971 / 1942-1949 |
| `withPixels` / `readPixel` / `expectPixel` / `coverageInside` | `src/test/canvas2dRenderer.test.ts` | 2134 / 2086 / 2095 / 2426 |
| the existing stamp parity block | `src/test/canvas2dRenderer.test.ts` | 2738-2940+ |
| `comparePixels` (the browser model to mirror) | `qa/harness.ts` | 200-236 |
