# Follow-up handoff — stamp engine regression (Agent 02)

> **Artifact type:** actionable handoff to the coordinator and the QA agent.
> Read-only: no application code, test, configuration or existing report was
> modified. This file is **new**.
>
> It does **not** implement fixes, does **not** create tests, and does **not**
> resolve the format-version policy (the tree has now answered it — §5.3), the
> licence question (Agent 3), or any architecture choice.

---

## 0. State inspected

| Field | Value |
| --- | --- |
| Repository | `https://github.com/aissaadib/Paka.git`, branch `main` |
| HEAD | `ad2ef11bb4fac508f0dda375a3eba5d7a9b7d7c9` (unchanged; **all stamp work is uncommitted**) |
| Working tree | **dirty** — 9 modified tracked files, 14 untracked paths |
| `pnpm typecheck` | **exit 0 — clean** |
| `pnpm test` | **30 files, 508 tests, all pass** (1.72 s) |
| `node_modules/.bin` | present (it was **missing** mid-session — see §1.3) |
| Snapshot taken | 2026-10-20, after `src/test/drawingEngine.test.ts` mtime `2026-10-20 17:52:19` |

> **The tree moved four times while this handoff was being written.** Another
> agent is actively implementing the slice *and* writing its tests. Every
> statement below is tagged **[stable]** (holds against `ad2ef11` — i.e. against
> the committed tree) or **[tree-dependent]** (holds against the working tree at
> the snapshot above). **Re-run §1.1 before acting** — the test count moved
> 461 → 497 → 508 during this handoff, and several of the tests specified in
> §3 have since been written by the other agent. §4 records the current
> status of each.

**Modified tracked files:** `skills-lock.json`, `src/core/brushes/defaults.ts`,
`src/core/engine/DrawingEngine.ts`, `src/core/project/projectFormat.ts`,
`src/core/rendering/Canvas2DRenderer.ts`, `src/features/brushes/BrushControls.tsx`,
`src/test/brushSettings.test.ts`, `src/test/canvas2dRenderer.test.ts`,
`src/types/brush.ts`.

**Untracked (feature-relevant):** `src/core/rendering/stampCoverage.ts`,
`src/test/stampCoverage.test.ts`, `docs/architecture-port-plan.md`,
`docs/acceptance-criteria.json`, `docs/memory-budget-review.md`,
`qa/`, `final-audit.md`, `provenance-record.json`, `reuse-decision.md`.

---

## 1. The typecheck status

### 1.1 Current result — clean

```
> pnpm typecheck
> tsc -p tsconfig.json --noEmit
=== EXIT 0 ===
```

### 1.2 The previously reported errors are FIXED

`follow-up-verification.md` §2 reported **3 errors** against the tree as it
stood earlier. All three are resolved:

| Previously reported error | Current state |
| --- | --- |
| `src/core/project/projectFormat.ts(693,25)` TS2345 — missing `stamp`, `stampSpacing`, `stampHardness` | **Fixed.** `readBrush` now reads all three (`projectFormat.ts`, `readBrush` L686-719 → the new block after L730) |
| `src/test/brushSettings.test.ts(42,39)` TS2345 | **Fixed.** Fixture updated (`brushSettings.test.ts` L54-56, assertions L68-69) |
| `src/test/canvas2dRenderer.test.ts(38,7)` TS2739 | **Fixed.** `BRUSH` gained the three fields (`canvas2dRenderer.test.ts` L49-51) |

**[tree-dependent]** The cause was exactly the report's coupling **C8**: a new
required `BrushSettings` field must be added to the interface, to
`normalizeBrush`, to `brushSettingsEqual` **and** to every construction site.

### 1.3 A transient tooling failure — recorded because it will recur

Mid-inspection `pnpm typecheck` failed with:

```
'tsc' is not recognized as an internal or external command,
```

`node_modules/.bin` had been pruned (only 12 packages present in
`node_modules`, `@jridgewell/sourcemap-codec` missing from the pnpm store).
`pnpm test` failed the same way when invoked as
`node node_modules/vitest/vitest.mjs` (`ERR_MODULE_NOT_FOUND`). The
environment recovered on its own; `node_modules/.bin` is present again.

**Remediation if it recurs:** `pnpm install --frozen-lockfile` (restores the
`.bin` shims). **Do not** edit `package.json` or the lockfile to work around
it.

### 1.4 One error existed mid-session and was fixed by the other agent

For the record, at snapshot ~17:41 the typecheck reported exactly one error:

```
src/test/stampCoverage.test.ts(171,18): error TS2339:
  Property 'right' does not exist on type 'StampRect'.
```

`StampRect` (`src/core/rendering/stampCoverage.ts`) is
`{ left, top, width, height }` — it has **no `right`/`bottom`**. `unionStampRect`
computes `right`/`bottom` internally (`stampCoverage.ts` L320-321) but returns
only `left/top/width/height`.

**This is worth remembering** because it is the exact class of defect the
original report's §5.1(c) warned about: `strokeRegion` floors the min edge and
**ceils** the max edge (`Canvas2DRenderer.ts`), and that `ceil` is a no-op for
integer sample coordinates, so the suite never exercises fractional geometry.

---

## 2. `BrushSettings` lifecycle trace

The three new fields are `stamp: boolean`, `stampSpacing: number`,
`stampHardness: number`. **[tree-dependent]** throughout — none of this exists
at `ad2ef11`.

| Stage | Location | State |
| --- | --- | --- |
| **Type** | `src/types/brush.ts` (L68-96) | `stamp`, `stampSpacing`, `stampHardness` — all `readonly`, all **required** (not optional) |
| **Defaults** | `src/core/brushes/defaults.ts` L18-32 | `stamp: false`, `stampSpacing: 0.1`, `stampHardness: 1` |
| **Bounds** | `src/core/brushes/defaults.ts` L10-12 | `MIN_STAMP_SPACING = 0.02`, `MAX_STAMP_SPACING = 1` (fraction of the brush **size**) |
| **Normalize** | `src/core/brushes/defaults.ts` L47-49 | `stamp: brush.stamp === true`; `stampSpacing` clamped to [0.02, 1]; `stampHardness` clamped to [0, 1] |
| **Equality** | `src/core/brushes/defaults.ts` L73-75 | all three compared — a missing entry would make the slider look dead |
| **Editor state** | `DrawingEngine.setBrush` (L836-844) → `updateBrushSettings` → `normalizeBrush` + `brushSettingsEqual` | brush changes stay **editor state**: no history step, no dirty flag (`commands.breakMerge()` then `publish()`) |
| **Per-stroke capture** | `src/core/brushes/strokeBuilder.ts` L55 (`brush: { ...brush }`) | the whole brush is copied onto the record → the stroke stays self-describing |
| **Shape exclusion** | `src/core/engine/DrawingEngine.ts` `shapeBrush()` (new, ~L218-227), used at `beginShape` | a shape records `{ ...brush, stamp: false }` → shapes keep the segment path |
| **Renderer gate** | `src/core/rendering/Canvas2DRenderer.ts` `isStamped()` L941-943 | `stroke.brush.stamp === true && stroke.fill !== true` |
| **Serialization** | `src/core/project/projectFormat.ts` `serializeElement` → `brush: element.brush` | the **whole object** is emitted — no serializer change was needed |
| **Deserialization** | `src/core/project/projectFormat.ts` `readBrush` (L686-719 + the new block) | v9-gated: `stamp` via `readBoolean`, `stampSpacing` via `readNumber(…, MIN_STAMP_SPACING, MAX_STAMP_SPACING)`, `stampHardness` via `readNumber(…, 0, 1)`; for `version < 9` → `stamp: false`, `stampSpacing: DEFAULT_BRUSH.stampSpacing` (0.1), `stampHardness: DEFAULT_BRUSH.stampHardness` (1) |
| **Format version** | `src/core/project/projectFormat.ts` | `PROJECT_VERSION` **8 → 9**; the version-history comment block gained a v9 entry |
| **UI** | `src/features/brushes/BrushControls.tsx` (new block after L79) | a **"Stamp"** toggle, plus **"Stamp spacing"** and **"Stamp hardness"** sliders shown only while the toggle is on. The existing **"Spacing"** slider is untouched |
| **Fixtures** | `src/test/brushSettings.test.ts` L54-56/L68-69; `src/test/canvas2dRenderer.test.ts` L49-51 | both updated |

### 2.1 Save/reopen behaviour — correct, and **untested**

**[tree-dependent]** The path is sound by inspection:

- `serializeElement` writes `brush: element.brush` → the three fields are
  emitted, and `version: PROJECT_VERSION` = 9 is written.
- `readBrush` reads them back for v9 → the values survive.
- A v1–v8 file is read with `stamp: false` → the segment path → the same
  picture it was written by.
- A v9 file **missing** any of the three fields is refused, because
  `readBoolean` / `readNumber` fail on `undefined` for `version >= 9`.

**But no test exercises any of it.** `src/test/projectFormat.test.ts` and
`src/test/projectLifecycle.test.ts` contain **zero** occurrences of `stamp`
(verified by `rg -n "stamp|Stamp" src/test` — 72 hits in total, of which the
only feature-related ones are in `stampCoverage.test.ts` (46),
`brushSettings.test.ts` (4) and `canvas2dRenderer.test.ts` (3, the fixture
only)).

This is the single largest remaining coverage hole: the defect that broke the
build 40 minutes ago (fields silently dropped on read) is fixed, but **nothing
prevents it from coming back**.

---

## 3. The three regression tests

### 3.1 R-1 — per-pixel maximum union: **ALREADY COVERED AND PASSING**

**[tree-dependent]** `src/test/stampCoverage.test.ts` L141-164:

| Test | What it asserts |
| --- | --- |
| L141-154 "unions overlapping dabs instead of adding them" | painting the **same** soft dab twice leaves the coverage byte-identical (`coverageAt(twice, 28, 20) === softEdge`) → a maximum, not a sum |
| L156-164 "keeps the larger of a soft edge and a neighbour's opaque core" | a hard dab's core at the soft rim raises it to 255, and the soft rim was < 255 → the union is `max(a, b)` |

**What it must catch (and does):** a `source-over` accumulation, which would
saturate the overlap to 255 and destroy the per-dab hardness curve. The
implementation's union is at `src/core/rendering/stampCoverage.ts` L229-231
(`if (value > tile[index]) { tile[index] = value; }`), with a correct early-out
at L211-213.

**Status: closed. No further work.** (My earlier report's "R-1 is entirely
untested" is superseded — it was true when written, and the other agent has
since added it.)

### 3.2 R-3 — whole-canvas live-preview vs committed parity: **PARTIALLY COVERED**

**[tree-dependent]** A `describe("Canvas2DRenderer stamp engine (real pixels)")`
block now exists at `src/test/canvas2dRenderer.test.ts` L2738-2860+ and covers:

| Test | Line | Covers |
| --- | --- | --- |
| "agrees across rebuild, live, release and export" | L2820 | the four-way parity, **at a single pixel** (16, 14) |
| "agrees for a soft dab" | L2824 | the same with `stampHardness: 0.25` |
| "does not darken a self-crossing stamped stroke" | L2828 | T-09 — expects `rgb(128,128,128)`, the same value the legacy path asserts |
| "keeps the dab chain inside the brush radius of the path" | L2850 | the §5.1 footprint guard |
| `coverageInside(harness.strokeBuffer, 2, 2, 30, 30)` | L2791 | coverage stays inside the composited rectangle |
| "uploads the stamped coverage as pixels" | L2893 | the `putImageData` upload |

**Three residual gaps remain**, and they are exactly the ones a single-point
comparison and an integer-coordinate fixture cannot see.

#### R-3a — the dab list is prefix-stable under sample appends *(pure, no canvas)* — **STILL MISSING**

**Why this is the right guard.** The live path unions dabs **incrementally**:
`extendStampStroke` (`Canvas2DRenderer.ts` L955-979) calls
`stampDabs(stroke, stroke.brush)` afresh but only paints from the cursor
`this.stampDabCount` (L963, L975) onward. Its own doc comment (L948-953)
states the assumption: *"the dabs that are already painted are simply the first
ones of the new list"*. The rebuild path instead unions the whole list at once
(`rasterizeStampStroke`, L989-1009). If the list were **not** prefix-stable,
the live union and the rebuild union would differ, and live ≠ commit.

**Confirmed still missing:** `src/test/stampCoverage.test.ts` has 23 cases
(L26-224) and **none** of them tests prefix-stability — there is no
"prefix", "append" or "stable" case.

**What to assert:** for a path `P` and any prefix `P'`, `stampDabs(P', brush)`
must be a prefix of `stampDabs(P, brush)` — same count, same x/y/radius per
element.

**What incorrect behaviour it must catch:** a dab whose position or radius
changes when a later sample is appended — e.g. if the lattice were re-anchored
to the path's end, if the `carried` remainder (`stampCoverage.ts` L108, L119-129)
were recomputed from a different origin, or if the first dab's radius
(`path.pressures[0]`, L103) depended on a later sample. Any of these would
make the live preview differ from the committed and rebuilt pixels **with no
error and no visible artifact in the unit tests** — and the single-pixel
comparison at (16,14) would not notice.

**Functions to exercise:** `stampDabs` (`src/core/rendering/stampCoverage.ts`
L90-134), `stampSpacing` (L72-74), `strokeDiameter`
(`src/core/rendering/canvas2dStroke.ts` L82-85).
**Where:** `src/test/stampCoverage.test.ts` (a new `describe` block).

#### R-3b — whole-canvas live == commit == rebuild == export *(pixel)* — **STILL MISSING**

The new stamp parity test (L2775-2818) reuses the legacy helper's shape: it
compares live / rebuild / commit / export **at a single pixel**
(`STAMP_X = 16`, `STAMP_Y = 14`, L2739-2740). A mismatch at any other pixel is
invisible to it.

**What to assert:** for a stamped stroke, the live preview canvas, the
committed layer surface, the rebuilt layer surface and the exported canvas are
**pixel-identical over the whole canvas** — not at one point. Concretely:
compare every pixel of `harness.display` against every pixel of
`harness.surfaces[0]`, and against the exported canvas, and assert zero
differing pixels.

**What incorrect behaviour it must catch:**
- coverage that escapes `strokeRegion` — the live path draws the **whole**
  buffer (`Canvas2DRenderer.ts` L670 → L1028) while the commit composites only
  the region (L978 → L1009-1025), so escaping coverage is visible while drawing
  and absent after release;
- a coverage-upload offset error — `writeStampCoverage` (L1019-1037) writes at
  `putImageData(image, left, top)` in **device** pixels, ignoring the context
  transform (its doc comment L1014-1017 says so), so a scale or offset mistake
  would move the whole stroke rather than shift it;
- the incremental-vs-full divergence of R-3a;
- a colour error — the upload writes the brush colour with the coverage as
  alpha (`stampCoverage.ts` `writeRect` L246-284).

**Utilities to exercise:**
- `withPixels` — `src/test/canvas2dRenderer.test.ts` L2130 (installs the
  pixel-accurate `document`, returns `renderer`, `display`, `doc`,
  `strokeBuffer`, `surfaces`, `elements`)
- `PixelCanvas` — L1501, with `createImageData` L1938, `putImageData` L1946,
  `getImageData` L1968, and the `pixels` `Float32Array`
- `readPixel` L2086 / `expectPixel` L2095 — a whole-canvas differ over
  `PixelCanvas.pixels` is still needed; the browser harness has one at
  `qa/harness.ts` L200 (`comparePixels`) that can be mirrored
- `coverageInside` — L2426

**Renderer entry points to drive:** `beginStroke` (L279), `extendStroke`
(L295), `endStroke` (L347), `invalidateLayer` (L274), `render` (L405),
`composeDocumentImage` (L511).
**Stamp path to exercise:** `extendStampStroke` (L955), `rasterizeStampStroke`
(L989), `writeStampCoverage` (L1019).

#### R-3c — dabs near the stroke-region boundary *(pixel, fractional geometry)* — **STILL MISSING**

The new stamp fixture (L2753-2765) uses **integer** coordinates
(`xs: [6, 16, 26]`, `ys: [6, 14, 6]`) — identical to the legacy fixture.

**What to assert:** a stamped stroke whose samples have **fractional**
coordinates, placed so that a dab's antialiased rim lands within ~1 device
pixel of the region's edge, still produces identical live and committed
pixels — and no coverage pixel falls outside the composited region.

**What incorrect behaviour it must catch:** the `ceil`/`floor` asymmetry in
`strokeRegion` (`Canvas2DRenderer.ts`, `left = floor(minX*scale)`,
`right = ceil(maxX*scale)`). For **integer** sample coordinates and an integer
spread, `floor(v) === ceil(v)` — so the existing suite never exercises the
asymmetric case. Confirmed: **no fixture in `canvas2dRenderer.test.ts` uses
fractional sample coordinates** (the only fractional values in the file are
`pressures: [0.5, 1, 0.5]` at L107 and two alpha expectations). A stamp engine
introduces exactly this geometry, because dab positions are arc-length
interpolations and need not be integral.

**Utilities:** `coverageInside` (L2426), `withPixels` (L2130), and the
renderer's own `strokeRegion` / `strokeSampleBounds` for the expected box.

### 3.3 Save/reopen preservation — **NOW COVERED AT THE FORMAT LEVEL**

**[tree-dependent]** `src/test/projectFormat.test.ts` L506-612 now covers
everything §3.3 specified:

| Test | Line | Covers |
| --- | --- | --- |
| "round-trips the stamp engine's settings at version 9" | L506 | S-1 — `stamp`, `stampSpacing: 0.25`, `stampHardness: 0.4` survive parse **and** re-serialize (L524-536) |
| "opens version 8 files with the stamp off, which is the path they were written by" | L539 | the v1–v8 case, and it **deletes the three fields** from the JSON (L549-551) before parsing, then asserts `stamp === false` and the `DEFAULT_BRUSH` fallbacks (L558-560) — exactly the "genuinely field-less v8 file" case |
| "refuses a version-9 stroke brush without the stamp settings" | L563 | three sub-cases, each expecting a message naming the field ("brush stamp", "brush stamp spacing", "brush stamp hardness") |
| "refuses a version-9 stroke brush with an invalid stamp setting" | L589 | three sub-cases: `stamp: "yes"`, `stampSpacing: 5`, `stampHardness: -1` |

**The one thing still uncovered:** `src/test/projectLifecycle.test.ts` has
**zero** `stamp` occurrences — the *engine-level* round trip
(`engine.serialize()` → `parseProject` → `loadProject` → assert the stroke's
brush → undo/redo) is not exercised. The format-level test is the stronger
guard for field preservation, so this is now **low priority**, but it would
add the undo/redo-after-reopen dimension that
`projectLifecycle.test.ts` L200-224 already does for `spacing`/`stabilizer`/
`texture`.

**Template if it is wanted:** `src/test/projectLifecycle.test.ts` L200-224 —
*"round-trips spacing, stabilizer and texture through save and reopen"*. It
constructs a `DrawingEngine` with a specific brush, calls `paintStroke(engine, 0)`
(helper at L47), `engine.serialize()`, `parseProject(text)`,
`reopened.loadProject(...)`, then asserts on
`reopened.listStrokes(activeLayerId(reopened))[0].brush` and again after
undo/redo (L220-223).

---

## 4. Summary of the proposed tests — current status

| ID | Where | Canvas? | Status at the snapshot |
| --- | --- | --- | --- |
| R-1 | `src/test/stampCoverage.test.ts` L143-166 | no | **done — passing** |
| R-3a (dab-list prefix stability) | `src/test/stampCoverage.test.ts` | no | **TO WRITE — highest value** |
| R-3b (whole-canvas live == commit) | `src/test/canvas2dRenderer.test.ts` L2738+ | yes | **TO WRITE** |
| R-3c (fractional coordinates / region edge) | `src/test/canvas2dRenderer.test.ts` L2738+ | yes | **TO WRITE** |
| S-1 (fields survive a round trip) | `src/test/projectFormat.test.ts` L506 | no | **done — passing** |
| S-2 (v9 requires the fields; v8 still opens) | `src/test/projectFormat.test.ts` L539-612 | no | **done — passing** |
| — engine-level save/reopen | `src/test/projectLifecycle.test.ts` L226-252 | no | **done — passing** (added after the snapshot) |
| — stamp settings are editor state | `src/test/drawingEngine.test.ts` L297 | no | **done — passing** |
| — per-stroke capture + one undo step | `src/test/drawingEngine.test.ts` L317 | no | **done — passing** |
| — shapes keep the segment path | `src/test/drawingEngine.test.ts` L346 | no | **done — passing** |
| — self-crossing stamped stroke does not darken | `src/test/canvas2dRenderer.test.ts` L2828 | yes | **done — passing** |
| — dab chain inside the brush radius | `src/test/canvas2dRenderer.test.ts` L2850 | yes | **done — passing** |
| — stamped eraser (Q6) | `src/test/canvas2dRenderer.test.ts` L591-812 | yes | **TO WRITE (low priority)** |
| — `brushSettingsEqual` treats the fields as identity | `src/test/brushSettings.test.ts` | no | **not covered** |

---

## 5. Did the implementation change the scope of the original findings?

### 5.1 Finding A — the region / live-vs-commit hazard: **narrowed, not closed**

**[tree-dependent]** The implementation bounds the dab footprint by
construction: `stampDabCoverage`'s doc (`src/core/rendering/stampCoverage.ts`
L142-143) states *"The falloff never reaches past the dab's radius, so a dab's
footprint stays inside the brush radius the renderer reserves for it"*, and
the dab radius is `strokeDiameter(brush, pressure) / 2` (L103, L126) ≤ the
brush radius. The composited region is samples ± (`diameter/2 + feather*3 + 1`)
document pixels, so the margin is **+1 document pixel** over the dab's reach
(the dab's antialiased rim extends 0.5 px past the radius — confirmed by the
now-passing assertion `stampDabCoverage(10.4, 10, 0) < 0.01` and
`stampDabCoverage(10.6, 10, 0) === 0`, `stampCoverage.test.ts` L122-123).

**So the hazard is mitigated in code — and still unverified by any test.**
R-3b and R-3c are the guards.

### 5.2 Finding B — no Canvas 2D max-alpha composite: **CLOSED**

**[tree-dependent]** Resolved exactly as the report predicted: the union is
computed in plain numbers (`stampCoverage.ts` L229-231) in a **footprint-bounded
64×64-tiled** map (`COVERAGE_TILE_SIZE = 64`, L38), and the module's header
(L1-21) cites the same reasoning. The union is now covered by a passing test
(§3.1).

**One item still open:** the documented raster budget. The map is bounded by
the stroke's own footprint (like the feather scratch), so the **number of
full-resolution surfaces is unchanged** — but the bytes-per-document-pixel
figure moves from 58 to ≈62, and `docs/ARCHITECTURE.md` (L774-812),
`docs/SESSION-BRIEF.md` §6 and `docs/PERFORMANCE_AUDIT_2026-10-20.md` F5 all
still state 58. A new untracked `docs/memory-budget-review.md` appears to
address this; it was not part of this handoff's scope.

### 5.3 Finding C — the format-version conflict: **ANSWERED IN THE TREE**

**[tree-dependent]** The tree has chosen **v9, with the three fields required
in v9** (`PROJECT_VERSION = 9`; `readBrush` gates on `version >= 9`; the
version-history comment block gained a v9 entry). This matches the strict
reading of the project's own rule — a v8 reader ignores the fields and draws
the segment path, which is a **different picture** for a stamped stroke.

**The report's Q1 is therefore answered; no further analysis is needed on it.**
Two consequences the coordinator should note:

1. **The plan and the tree disagree materially.** `docs/architecture-port-plan.md`
   specifies `stampSpacing` + `stampFalloff` (two fields, `stampSpacing = 0` as
   the off-sentinel, spacing as a fraction of the **diameter**, range `[0, 2]`,
   `MIN_STAMP_SPACING_PX = 0.25`, module `stampRaster.ts`, test
   `stampRaster.test.ts`). The tree implements `stamp` + `stampSpacing` +
   `stampHardness` (three fields, `stamp = false` as the off-sentinel, spacing
   as a fraction of the **nominal size**, range `[0.02, 1]`,
   `MIN_STAMP_SPACING_PX = 0.5`, module `stampCoverage.ts`, test
   `stampCoverage.test.ts`). The tree's `stampSpacing` doc
   (`stampCoverage.ts` L68-74) explicitly says *"against the brush's **nominal
   size**, not of the pressure-varying diameter"* — a deliberate divergence.
   **The plan is stale and should be reconciled or marked superseded.**
2. **The docs are stale.** `docs/HANDOFF.md` L74 still says *"Project file
   format version 8 (`PROJECT_VERSION = 8`)"* and L521 still says *"there is no
   stamp engine yet"*. `docs/PROJECT_FORMAT.md` has **no v9 row** in the
   `## Versioning` table (L417) and **no stamp fields** in the `### brush`
   section (L335). The project's own rule (`docs/SESSION-BRIEF.md` §5.3) is
   *"Docs move with behaviour in the same commit"*.

### 5.4 The other open questions — answered in the tree

| # | Question | Tree's answer |
| --- | --- | --- |
| Q2 | control naming | A **"Stamp"** toggle + **"Stamp spacing"** + **"Stamp hardness"** sliders; the existing **"Spacing"** slider is left alone. This avoids the plan's "rename Spacing → Sampling" step. **No conflict with the existing slider** — the report's §9.4 concern is resolved |
| Q3 / Q7 | shape tools | Shapes keep the segment path: `shapeBrush()` in `DrawingEngine.ts` records `stamp: false`, and `isStamped()` excludes `stroke.fill === true` |
| Q4 | is `spacing` non-appearance-changing? | **Yes** — dabs are placed by **arc length**, not per sample (`stampDabs` L80-84, L109-132), and the tree has a test for it (`stampCoverage.test.ts` L70-77, *"does not depend on the sample density"*) |
| Q5 | how is the union realised? | A pure, footprint-bounded, 64×64-tiled coverage map in plain numbers |
| Q6 | does the union apply to the eraser? | Yes — the eraser subtracts the same union-ed buffer via `destination-out` (`applyErase`). **Still untested** with a stamped eraser (the existing eraser pixel tests cover only the segment path) |
| Q8 | the dab budget | **Partially.** A spacing floor exists (`MIN_STAMP_SPACING_PX = 0.5`); a *total* per-stroke dab budget does not |

### 5.5 What has NOT changed

**[stable]** The architecture boundary, the invariants, the rendering funnel
(`paintStrokeCoverage` as the single place that decides raw vs feathered vs
textured), the one-alpha-per-stroke rule, the self-describing-stroke rule, the
stroke-buffer model, the eraser snapshot discipline, the format-version
*rule* itself, and the raster-budget *constraint*.

---

## 6. Ordered next actions

1. **Re-run the baseline before touching anything** —
   `pnpm test` (expect 30 files / 508 tests, all passing) and `pnpm typecheck`
   (expect exit 0). If `pnpm typecheck` reports *"'tsc' is not recognized"*,
   that is the §1.3 tooling fault: `pnpm install --frozen-lockfile`. The test
   count is still moving — re-read it rather than trusting 508.
2. **Write R-3a** (pure, in `src/test/stampCoverage.test.ts`) — the dab list
   must be prefix-stable under sample appends. **This is now the highest-value
   remaining test**: it guards the live-vs-rebuild equality that the whole
   renderer relies on, it needs no canvas, and nothing else covers it.
3. **Write R-3b and R-3c** (in `src/test/canvas2dRenderer.test.ts`) — replace
   the single-pixel comparison in the stamp block with a whole-canvas differ
   over `PixelCanvas.pixels` (mirror `qa/harness.ts` L200, `comparePixels`),
   and add a fixture with **fractional** sample coordinates so the `ceil` in
   `strokeRegion` is actually exercised.
4. **Reconcile the plan with the tree** (coordinator) — `docs/architecture-port-plan.md`
   describes a different field set, unit and file layout from the one
   implemented. Either update the plan or mark it superseded, so the next
   reader does not implement the plan's `stampFalloff` on top of the tree's
   `stampHardness`.
5. **Update the docs in the same commit** — `docs/PROJECT_FORMAT.md` (a v9
   versioning row and the three brush fields), `docs/HANDOFF.md` L74 and L521
   (both still describe the pre-slice state), `docs/ARCHITECTURE.md` (a stamp
   subsection and the union invariant) and the raster-budget figure if the
   footprint-bounded coverage map is kept.
   **[tree-dependent]** A docs pass is **in flight** as of the final snapshot:
   `docs/ARCHITECTURE.md` (+23/-5), `docs/HANDOFF.md` (+13/-6),
   `docs/PERFORMANCE_AUDIT_2026-10-20.md` (+3/-1) and `docs/SESSION-BRIEF.md`
   (+37/-14) are all modified. At the instant of the final check
   `docs/HANDOFF.md` L74 still read *"Project file format version 8
   (`PROJECT_VERSION = 8`)"* — the edit was mid-flight. **Verify the doc
   update landed before merging; do not trust this note over the files.**
6. **Optional, lower priority** — a stamped-eraser test (Q6), and a
   `brushSettingsEqual` test for the three new fields.

---

### Appendix — commands to reproduce

```powershell
cd C:\Users\aissa\Desktop\Paka

# state
git rev-parse HEAD                 # ad2ef11bb4fac508f0dda375a3eba5d7a9b7d7c9
git status --short
git diff --stat

# baseline
pnpm typecheck                     # expect: no output, exit 0
pnpm test                          # expect: Test Files 30 passed (30) / Tests 508 passed (508)

# if the toolchain is missing its shims
pnpm install --frozen-lockfile

# the four test defects that were live mid-session and are now fixed
#   (for reference; the file is now correct)
rg -n "toBeCloseTo\(12\.5|new Uint8ClampedArray\(4 \* 4 \* 4\)|rect\?\.left" src/test/stampCoverage.test.ts

# what is and is not covered
rg -n "stamp|Stamp" src/test/stampCoverage.test.ts         # 23 cases, but NO prefix-stability case
rg -n "prefix|append|stable" src/test/stampCoverage.test.ts # -> 0 hits: R-3a is missing
rg -n "stamp|Stamp" src/test/projectFormat.test.ts         # 4 new cases: v9 round trip + v8 + 2 refusals
rg -n "stamp|Stamp" src/test/projectLifecycle.test.ts      # 0 hits  -> gap (low priority)
rg -n "stamp|Stamp" src/test/canvas2dRenderer.test.ts      # new describe block at L2738+
rg -n "readPixel\(harness.display" src/test/canvas2dRenderer.test.ts   # single-pixel comparisons
```

**Files inspected in this handoff (all read-only):**
`src/core/rendering/stampCoverage.ts` (full), `src/core/rendering/Canvas2DRenderer.ts`
(L930-1044, L181-185, L290-380, L938-943), `src/core/brushes/defaults.ts` (full),
`src/types/brush.ts` (L68-96), `src/core/project/projectFormat.ts` (L88-100,
L686-719, L454), `src/core/engine/DrawingEngine.ts` (L215-227, L1130-1137),
`src/features/brushes/BrushControls.tsx` (L79-116), `src/test/stampCoverage.test.ts`
(full), `src/test/brushSettings.test.ts` (L50-70),
`src/test/canvas2dRenderer.test.ts` (L36-56, L2086-2173, L2426-2600),
`src/test/projectFormat.test.ts` (L718-810), `src/test/projectLifecycle.test.ts`
(L195-230), `docs/architecture-port-plan.md` (grep), `docs/PROJECT_FORMAT.md`
(grep), `docs/HANDOFF.md` (grep).

**Not done:** no browser run, no packaged-app run, no modification of any file
except the creation of this one; no fix, no test, no revert of another agent's
work.
