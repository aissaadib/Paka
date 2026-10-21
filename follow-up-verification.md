# Follow-up verification — `PHASE3-STAMP-ENGINE`

> **Artifact type:** independent verification of `feature-analysis.md` and
> `feature-evidence.json`. Read-only: no application source, test, configuration
> or existing report was modified. This file is **new**; the two analysis
> artifacts are untouched.
>
> It does **not** resolve the format-version policy conflict (Q1) — the
> evidence is recorded for the coordinator. It does **not** resolve licensing —
> that is Agent 3's. It does **not** choose an architecture.

| Field | Value |
| --- | --- |
| Verification date | 2026-10-20 |
| Repository / branch | `https://github.com/aissaadib/Paka.git` @ `main` |
| Verified commit | `ad2ef11bb4fac508f0dda375a3eba5d7a9b7d7c9` (unchanged from the analysis) |
| Working tree at verification | **dirty, and moving** — see §1 and §10. The tree changed **twice** during this verification |
| Prior artifacts verified | `feature-analysis.md` (712 lines), `feature-evidence.json` (26 keys, valid JSON) |
| Verdict | **The original analysis is safe to use as the basis for architecture planning.** Two refinements and one new finding below; none invalidates a claim. The in-progress implementation (§10) is consistent with the report's findings. |

---

## 0. Summary of outcomes

| # | Item | Outcome |
| --- | --- | --- |
| 1 | Critical finding A — live-preview vs committed coverage | **CONFIRMED**, with a **refinement**: the divergence is specific to the *hard, untextured* path; the soft/textured path is bounded identically in both |
| 2 | Critical finding B — no Canvas 2D max-alpha composite; 58-byte budget | **CONFIRMED**, now with an authoritative spec citation and verified arithmetic |
| 3 | Critical finding C — format-version rule vs `SESSION-BRIEF.md` §9 | **CONFIRMED**, all three quotes verbatim |
| 4 | Line-number and test-reference audit | **180/194 spot-checks pass**; 78 symbol-index citations **77 in range**; **1 stale** (caused by tree drift, not by an error in the report) |
| 5 | 32 acceptance cases classified | 7 `verified`, 21 `proposed`, 4 `uncertain` (§4) |
| 6 | Could existing tests pass despite the mismatches? | **YES for the union rule — entirely unguarded.** Partially guarded for the region mismatch (§5) |
| 7 | Smallest additional tests | 4 regression tests proposed (§6) |
| 8 | **New finding** | The working tree **does not type-check**; the in-progress stamp scaffold has exactly the defect the report's coupling **C8** predicted (§2) |

---

## 1. Tree drift since the analysis — read this first

The analysis was written against commit `ad2ef11` with a clean tree. The tree
is no longer clean, and **two application source files have been modified
(uncommitted)** by another agent:

```
 M src/core/brushes/defaults.ts   (+14 / -1)
 M src/types/brush.ts             (+29)
```

plus new untracked artifacts: `docs/acceptance-criteria.json` (27 criteria),
`docs/architecture-port-plan.md`, `qa/` (a QA harness — see §5.4), and
`.opencode/agents/paka-feature-analyst.md` (the agent file from the brief).

The diff adds three required fields to `BrushSettings`:

```ts
readonly stamp: boolean;        // off-by-default switch
readonly stampSpacing: number;  // MIN_STAMP_SPACING 0.02 .. MAX_STAMP_SPACING 1
readonly stampHardness: number; // 0..1
```

**Consequences for the verification:**

- The analysis's line anchors for `src/types/brush.ts` and
  `src/core/brushes/defaults.ts` are **correct for `ad2ef11` and stale for the
  current tree**. Every other cited file is untouched, so all other anchors
  still resolve.
- **None of the three critical findings is affected**: neither modified file is
  on the rendering, engine or format path. Findings A, B and C are re-verified
  below against the current tree and stand unchanged.
- The drift is itself **evidence for the report** — see §2.

---

## 2. NEW FINDING — the working tree does not type-check, and the cause is the report's coupling C8

`pnpm typecheck` fails with **3 errors**, all of the same kind:

```
src/core/project/projectFormat.ts(693,25): error TS2345:
  Argument of type '{ size; opacity; color; hardness; pressureSize; pressureOpacity;
  minSizeRatio; spacing; stabilizer; texture; }' is not assignable to parameter of type 'BrushSettings'.
  Type '{ ... }' is missing the following properties from type 'BrushSettings':
    stamp, stampSpacing, stampHardness

src/test/brushSettings.test.ts(42,39): error TS2345:   ... same three properties
src/test/canvas2dRenderer.test.ts(38,7): error TS2739: ... same three properties
```

**Root cause.** The scaffold updated two of the four sites the report said
must change (coupling **C8**, `feature-analysis.md` §5.8):

| Site | Status |
| --- | --- |
| `src/types/brush.ts` — the interface | done |
| `src/core/brushes/defaults.ts` — `DEFAULT_BRUSH`, `normalizeBrush`, `brushSettingsEqual` | done (verified in the diff) |
| `src/core/project/projectFormat.ts` — `readBrush` (L686-719) | **MISSING** |
| test fixtures that build a `BrushSettings` literal | **MISSING** (2 files) |

**Why the field being *required* turned a silent drop into a compile error.**
The report predicted a *silent* failure. The actual failure is louder,
because `stamp` / `stampSpacing` / `stampHardness` are declared non-optional
in `BrushSettings`, so every construction site must supply them. That is
strictly better than the predicted failure mode, and it means the report's
coupling C8 is **confirmed in substance** (the field is dropped unless the
construction sites are updated) even though the *symptom* differs.

**A second, latent defect sits behind the compile error.** `readBrush`
(`src/core/project/projectFormat.ts:686-719`) builds the brush object
literally and does not read the new fields, while the **serializer** dumps the
whole brush object (`brush: element.brush`, `projectFormat.ts:454`).
Therefore, the moment the type error is silenced (by adding the fields to
`readBrush`, or by casting):

- a stroke drawn with `stamp: true, stampSpacing: 0.35, stampHardness: 0.5`
  is **written** with those values, but
- on reopen it is read back as `stamp: false, stampSpacing: 0.02,
  stampHardness: 0` — `stamp` because `normalizeBrush` does
  `brush.stamp === true` (false for `undefined`), and the two numbers because
  `clamp(undefined, 0.02, 1)` collapses a non-finite value to the **minimum**
  (`src/utils/math.ts:4-7`: *"Non-finite values collapse to `min`"*).

That is a **save/reopen data loss that breaks the self-describing-stroke
invariant (I3)** — the stroke would reopen looking different from how it was
drawn. It is currently masked only by the compile error.

> **Correction to my own earlier reasoning:** I initially expected `NaN` from
> `clamp(undefined, …)`. That is **wrong** — `clamp` handles non-finite
> values explicitly and returns `min`. Verified at `src/utils/math.ts:4-7`.
> There is no NaN propagation. The defect is the *loss of the drawn values*,
> not NaN.

**Also noted (not a defect, a coordination risk):** the plan in
`docs/architecture-port-plan.md` and `docs/acceptance-criteria.json` uses a
**different field set** from the scaffold in the tree — the plan says
`stampSpacing` + `stampFalloff` with **`stampSpacing = 0` as the "off"
sentinel** (acceptance-criteria.json AC-01, AC-02), while the tree's scaffold
uses `stamp: boolean` + `stampSpacing` + `stampHardness` with **`stamp =
false`** as the sentinel. The plan's sentinel is also **unreachable** under
the tree's own `MIN_STAMP_SPACING = 0.02` clamp, since `stampSpacing = 0`
would clamp to `0.02`. This is a plan-vs-implementation divergence for the
coordinator and the architecture translator; it is outside this agent's
remit to resolve.

---

## 3. Re-verification of the three critical findings

### 3.1 Critical finding A — live-preview coverage vs committed-stroke coverage

**Claim under test** (`feature-analysis.md` §5.1, coupling C1): the live
preview draws the *whole* stroke buffer, while the commit composites only
`strokeRegion(stroke)`; coverage outside that region would therefore be
visible while drawing and absent after release.

**Evidence re-read at the current tree:**

| Path | Call | Region? | Effect |
| --- | --- | --- | --- |
| Live preview, opaque `normal` layer | `Canvas2DRenderer.ts:670` → `this.paintStrokeCoverage(ctx, preview)` | **no** | → `L1028` `ctx.drawImage(this.strokeBuffer, 0, 0, doc.width, doc.height)` — **whole buffer** |
| Live preview, grouped (layer opacity < 1 or blend ≠ normal) | `Canvas2DRenderer.ts:710` → `this.paintStrokeCoverage(ctx, stroke)` | **no** | → `L1028` — **whole buffer** |
| Commit / layer rebuild | `Canvas2DRenderer.ts:978` → `this.paintStrokeCoverage(surface.ctx, stroke, region)` | **yes** | → `L1009-1025` — **region only**, 1:1 blit under the identity transform |
| Eraser subtract, live | `Canvas2DRenderer.ts:1221` → `this.paintStrokeCoverage(surface.ctx, stroke)` | **no** | → `L1028` — **whole buffer** |
| Eraser subtract, rebuild | `Canvas2DRenderer.ts:778-782` → `compositeStrokeBuffer(surface, element, "destination-out")` | **yes** | → region only |

The region is derived from `strokeSampleBounds` (`L908-927`):
`spread = strokeDiameter(brush, 1) / 2 + featherRadius * 3 + 1`, bounds =
samples ± spread. The method's own doc comment (`L903-906`) states the
invariant explicitly:

> "It is a superset of the rasterized coverage - round caps and joins never
> reach past the brush radius - and of the region the feather pass reads, so
> one rectangle serves for all three."

**Verdict: CONFIRMED.** The asymmetry is real, and the code's own comment
makes clear the superset property is a *property of the current segment
rasterizer* — "round caps and joins never reach past the brush radius" — which
is exactly the premise a stamp engine changes.

**REFINEMENT (new, and it narrows the hazard).** The `region` argument is
consulted **only** in the `radius <= 0 && texture <= 0` branch
(`L1008-1026`). In the soft/textured branch (`L1033-1046`) the parameter is
**ignored**: the feathered copy is drawn in full, and that copy is itself
bounded by `strokeSampleBounds` (`featherStroke`, `L1139-1144`, using the same
clamped rectangle as `strokeRegion`, `L941-944`).

Therefore:

- **Hard, untextured stroke** → live draws the whole buffer, commit draws the
  region → **divergence possible** for coverage outside `strokeSampleBounds`.
- **Soft or textured stroke** → live and commit *both* draw a
  `strokeSampleBounds`-bounded copy → **they agree**; out-of-region coverage
  is dropped in both.

So the live/commit divergence window is **narrower than the report implies**:
it is the hard, untextured path only. The underlying requirement — a stamp's
footprint must fit inside `strokeSampleBounds`, or the engine must widen it —
is **unchanged and still correct**, and the soft/textured case shows the
"both bounded" behaviour is what the engine should converge on.

The report's §5.1 text says "the live preview path draws the **whole** buffer"
without qualifying that this is the hard path. That statement is *true as
written for the hard path*; this refinement should be added.

### 3.2 Critical finding B — no Canvas 2D max-alpha composite; the 58-byte budget

**Claim under test** (§5.3, §10.3): the roadmap's "max/union" coverage
requirement has no direct Canvas 2D primitive, and a separate document-sized
coverage surface would break the documented 58-bytes-per-document-pixel
budget.

**Evidence — W3C Compositing and Blending Level 1** (W3C CR Draft,
21 March 2024, <https://www.w3.org/TR/compositing-1/>):

- §4 enumerates every value `globalCompositeOperation` may take:
  `<composite-mode> = clear | copy | source-over | destination-over | source-in
  | destination-in | source-out | destination-out | source-atop |
  destination-atop | xor | lighter`
  and `<blend-mode> = normal | darken | multiply | color-burn | lighten |
  screen | color-dodge | overlay | soft-light | hard-light | difference |
  exclusion | hue | saturation | color | luminosity`.
- §5: *"In the model described in this specification there are two steps to the
  overall compositing operation - Porter-Duff compositing and blending. The
  blending step determines how the colors from the graphic element and the
  backdrop interact."*
- §6, the general formula: `Co = αs × Fa × Cs + αb × Fb × Cb`, with the blend
  applied **in place** to the *source colour* only: `Cs = (1 - αb) × Cs + αb ×
  B(Cb, Cs)`.
- §10.1.6 `lighten`: `B(Cb, Cs) = max(Cb, Cs)` — a **colour-channel** maximum.
  The spec's framing ("The backdrop is replaced with the source where the
  source is lighter") and the §6 formula show the **alpha is untouched** by
  any blend mode: alpha always follows the Porter-Duff operator's `Fa`/`Fb`.
- For `source-over` (§9.1.4): `αo = αs + αb × (1 - αs)`; with `αs = 1` this
  saturates to `αo = 1`. `lighter` (§9.1.13) is *additive*
  (`αo = αs + αb`), not a maximum.

**Verdict: CONFIRMED, and now authoritative.** No composite mode and no blend
mode in the Canvas 2D specification produces a **max-alpha** result.
`lighten` maximises colour channels only; the alpha saturates or adds.

**Arithmetic re-verified** (`python`, exact):

```
3 surfaces : 3*4*2**2 + 10 = 58 bytes/px  ->  928 MiB at the 16,777,216 px cap
4 surfaces : 4*4*2**2 + 10 = 74 bytes/px  -> 1184 MiB (1.156 GiB) at the cap
```

The 1 GiB budget therefore holds at 3 surfaces and is **exceeded** at 4. The
report's §10.3 conclusion — a union accumulator must reuse the existing
buffer or be bounded to the stroke's own footprint — is **CONFIRMED**.

**Supporting precedent in the repo:** `docs/PERFORMANCE_AUDIT_2026-10-20.md`
L14-18 records that the element-scratch variant (F7) was reverted partly
because "it would have moved the documented raster budget from 58 to 59 bytes
per document pixel". A fourth full-resolution surface is a strictly larger
version of the same mistake.

**Note for the coordinator (evidence only, not a decision):** the plan in
`docs/architecture-port-plan.md` L191/L633 proposes option A — a
footprint-bounded 1-byte-per-device-pixel coverage cache — which moves the
documented figure to **62 bytes/px (992 MiB)**, still inside 1 GiB, and
optionally option B — recompute the union per event — which leaves it at 58
but is quadratic. Both are consistent with the report's §10.3 constraint. The
budget *number* in `docs/ARCHITECTURE.md` and `docs/SESSION-BRIEF.md` would
have to be re-documented either way if option A is taken.

### 3.3 Critical finding C — the format-version rule vs `SESSION-BRIEF.md` §9

**Claim under test** (§9.2, coupling C9, question Q1): the project's own
versioning rule and the slice's acceptance criteria do not agree for an
additive, off-by-default field.

**All three quotes re-read verbatim at the current tree:**

1. `docs/SESSION-BRIEF.md:310-311` (§6, "Format versioning"):
   > "a bump is required when an older reader would render a *different
   > picture*, not for convenience."
2. `docs/SESSION-BRIEF.md:464-465` (§9, constraint 5):
   > "Capture stamp settings per stroke. Appearance-changing fields that a v8
   > reader cannot ignore require **format version 9**; prove it with tests."
3. `docs/SESSION-BRIEF.md:498-499` (§9, acceptance criteria):
   > "Old projects open unchanged; a v9 file requires the new fields and an
   > older reader refuses it rather than drawing the wrong look."

Supporting: `docs/ROADMAP.md:218-221` (the softer form) and the existing
enforcement mechanism at `src/core/project/projectFormat.ts:510-514`
(`version > PROJECT_VERSION` → rejected).

**Verdict: CONFIRMED.** The three statements are not equivalent: an
*additive, off-by-default* field would be ignored by a v8 reader, which would
then draw the segment path — the same picture the new reader draws by
default — so the project's own rule would require **no** bump, while §9
demands **v9**.

**This remains unresolved and is not resolved here.** Evidence is recorded for
the coordinator. Note that the in-progress scaffold does *not* yet bear on
the question: its `stamp` field is a boolean with an off value, and
`readBrush` does not read it at all, so nothing has been decided.

---

## 4. Line-number, test-reference and acceptance-case audit

### 4.1 Citation audit

Two automated passes were run over the current tree:

| Pass | Scope | Result |
| --- | --- | --- |
| Content spot-check | 194 `(file, line, expected-substring)` assertions drawn from both artifacts | **180 pass.** The 14 initial mismatches were re-examined individually: **12 were errors in my audit script**, not in the report (e.g. `rasterizeStrokeToBuffer` is at L777, and the report's cited range `765-785` is correct; `updateBrushSettings` was mis-anchored by one line). **2 are real tree drift** — see §4.2 |
| Symbol-index range check | 78 entries of `feature-evidence.json` → `symbolIndex`; each entry's cited range must bracket the symbol's actual definition line | **77 in range, 1 stale** |

Method: `python` script reading the files directly and comparing the cited
line against the located definition; scripts were kept outside the repository
(`%LOCALAPPDATA%\Temp\opencode\`).

**Re-audit of the 14 initial mismatches — all 14 resolved:**

- 12 were my script's off-by-one anchors (e.g. `Canvas2DRenderer.ts:777`
  `this.rasterizeStrokeToBuffer(element)`; `projectFormat.ts:700` `hardness:`;
  `canvas2dRenderer.test.ts:2151` `rasterScale: 1`; `ROADMAP.md:213`).
  **The report's cited ranges are correct.**
- 2 are genuine drift, both in `src/core/brushes/defaults.ts`:
  - `DEFAULT_BRUSH` reported `15-26` → now `16-30`
  - `updateBrushSettings` reported `44-49` → now `53-58` (**the one stale
    symbol-index range**)
  - `normalizeBrush` reported `29-42` → now `33-49` (the old range no longer
    brackets it, but the *definition* line 33 is still inside the reported
    range, so the range check passed — noted for completeness)
  - `brushSettingsEqual` reported `52-65` → now `59-75`
  - `src/types/brush.ts` `BrushSettings` reported `11-67` → the interface now
    runs to L96; the declaration line is unchanged.

### 4.2 The two real drifts — correction to the report's symbol index

The report's symbol index is **anchored to commit `ad2ef11`**, which it states
in its header. Against the **current working tree**, six entries in
`src/core/brushes/defaults.ts` and one in `src/types/brush.ts` are stale by
the number of lines added by the in-progress scaffold.

**Recommendation:** either re-anchor the report to a commit, or add a one-line
note that the tree has moved. The cleanest fix is a note in
`feature-analysis.md`'s header, because the analysis is otherwise unaffected.

### 4.3 Test-reference audit

Every test name and line cited in the report was located and confirmed to
exist, including:

- `canvas2dStroke.test.ts` — 11 cited cases, all present with the quoted
  titles (L118, 129, 142, 159, 170, 220, 237, 250, 251, 256, 266)
- `canvas2dRenderer.test.ts` — 24 cited cases, all present (L378, 833, 852,
  975, 1457, 1498, 1835, 1851, 1863, 1893, 2017, 2127, 2423, 2442, 2468,
  2477, 2503, 2536, 2540, 2559, 2600, 2618, 2654)
- `projectFormat.test.ts` — 6 cited cases (L450, 482, 545, 807, 887, 926)
- `drawingEngine.test.ts` — 4 cited cases (L157, 174, 254, 277)

**No broken test references were found.** The report's "existing test" column
is accurate.

### 4.4 Classification of the 32 acceptance cases

`verified` = the expected behaviour is supported by source code or an existing
test. `proposed` = a new test or behaviour not yet demonstrated.
`uncertain` = insufficient evidence; the note says what must be inspected.

| ID | Class | Note |
| --- | --- | --- |
| T-01 | `verified` | Existing: `canvas2dStroke.test.ts:118-140` asserts the draw sequence, alpha 1 and the per-segment widths |
| T-02 | `verified` | Existing: `canvas2dRenderer.test.ts:833` asserts the raw-buffer 1:1 blit, no scratch, no pattern |
| T-03 | `verified` | Existing: `canvas2dRenderer.test.ts:852` |
| T-04 | `verified` | Existing: `canvas2dRenderer.test.ts:975` |
| T-05 | `uncertain` | The count `ceil(L/spacing)+1` is **not derivable from any source** — it depends on the lattice definition and the truncation rule, which are undecided (Q8). Inspect: the chosen lattice spec |
| T-06 | `uncertain` | Same — "evenly spaced by exactly spacing" needs a defined lattice origin and a centre-to-centre definition. The tree's `types/brush.ts` says "distance between dab centres", but the along-path parameterisation is undecided |
| T-07 | `uncertain` | The tangent rule at a bend is undecided. The plan's arc-length lattice would define it; nothing in the tree does |
| T-08 | `proposed` | New test. Grounded in the existing `stampDot` contract (`canvas2dStroke.test.ts:142-151`) and the scaffold's doc string |
| T-09 | `proposed` | New test for a *stamped* stroke. The expected value `rgb(128,128,128)` is corroborated by the existing segment-path test at `canvas2dRenderer.test.ts:2618` |
| T-10 | `proposed` | New test. The expectation comes from `docs/ROADMAP.md:212-214` (a requirement, not a demonstration). **Needs harness support**: `PixelCanvas` implements only source-over / destination-out / destination-in / multiply / screen (`canvas2dRenderer.test.ts:1523-1587`) — there is no max operation |
| T-11 | `proposed` | New test. The behaviour is real and documented (`docs/ARCHITECTURE.md:280-281`) but untested at the pixel level |
| T-12 | `proposed` | New test. The existing `checkEveryPathAgrees` compares a **single point** (16,14) — see §5.1 |
| T-13 | `proposed` | New test. The segment-path equivalent exists at `canvas2dRenderer.test.ts:378-414` |
| T-14 | `proposed` | New test. The round-trip pattern exists at `projectFormat.test.ts:450-567`; the new fields are not covered |
| T-15 | `proposed` | New test. One-undo-step behaviour is verified for ordinary strokes; the stamped variant is new |
| T-16 | `proposed` | New test. The grain equivalent is asserted at the draw-call level only |
| T-17 | `proposed` | New test. **No rasterScale-2 pixel test exists at all** for any brush |
| T-18 | `proposed` | New test |
| T-19 | `proposed` | New test. Determinism of the current path is covered at the function level (`canvas2dStroke.test.ts:256-264`) |
| T-20 | `proposed` | New test. `coverageInside` exists at `canvas2dRenderer.test.ts:2423` and is used at `:2559` — this is the direct guard for §5.1 |
| T-21 | `proposed` | New test. The direct guard for the live/commit mismatch |
| T-22 | `proposed` | New test. The bounded-rebuild tests exist at `:2442-2503` |
| T-23 | `proposed` | New test. The brush round-trip pattern exists at `projectFormat.test.ts:482-503` |
| T-24 | `proposed` | New test. The per-version default pattern exists at `:545-567` |
| T-25 | `proposed` | New test. The validation pattern exists at `:887-940` |
| T-26 | `verified` | Existing: `projectFormat.test.ts:807`; the mechanism at `projectFormat.ts:510-514` is unchanged |
| T-27 | `proposed` | New test. Grounded in the existing v6-open test at `:545` |
| T-28 | `verified` | Existing: `drawingEngine.test.ts:174-212`; `DrawingEngine.setBrush` (`:836-844`) inherits the behaviour automatically once the field is in `normalizeBrush` / `brushSettingsEqual` — both of which the scaffold has already done |
| T-29 | `verified` | Existing: `drawingEngine.test.ts:254-294`; `createStrokeRecord:55` copies the brush per stroke |
| T-30 | `proposed` | Manual browser check. Cannot be automated (no React test framework, by policy). Blocked on Q2 (the naming conflict with the existing "Spacing" slider) |
| T-31 | `uncertain` | The bound depends on the undecided dab budget and the minimum-spacing floor (Q8). Inspect: the budget constants once chosen |
| T-32 | `proposed` | New test. Under the plan's option A the *byte count* per pixel changes (58 → 62) but the **number of full-resolution surfaces does not**, so the assertion holds as written |

**Totals: 7 `verified`, 21 `proposed`, 4 `uncertain`.**

Every `uncertain` case is uncertain for the same reason: **the dab lattice is
not yet specified.** Once the lattice, the truncation rule and the
minimum-spacing floor are fixed, T-05, T-06, T-07 and T-31 become `proposed`
with concrete expected values.

---

## 5. Could existing tests pass despite the mismatches?

### 5.1 The preview/commit mismatch — **partially guarded, and weakly**

The mismatch requires coverage outside `strokeSampleBounds`. Today that
cannot happen: the segment rasterizer's coverage stays within the brush
radius of the samples, and the region is padded by exactly that radius plus
the feather spread. So the invariant holds *by construction*, and no test
needs to catch it today.

**The question is what happens after a stamp engine lands.** Answering it
requires knowing what the suite actually asserts:

**(a) `checkEveryPathAgrees` (`canvas2dRenderer.test.ts:2540-2586`) samples
exactly one pixel.** `SAMPLE_X = 16`, `SAMPLE_Y = 14` (`:2507-2508`) — the
*middle sample* of the fixture stroke `(6,6) → (16,14) → (26,6)`. The live,
rebuild, commit and export are all compared **at that one point**
(`:2551, 2564, 2574, 2579, 2583`). A mismatch at any other pixel — which is
exactly where an escaping dab's edge would land — **is not detected**.

**(b) The `coverageInside` guard (`:2559`) is the real guard, and it is
narrow.** It asserts the coverage in the stroke buffer lies inside a
**hardcoded** box `(2, 2, 30, 30)` — not a box derived from `strokeRegion`.
Verified geometry: `BRUSH` is `size: 10, minSizeRatio: 0, hardness: 1`
(`:38-49`); in `checkEveryPathAgrees` the brush is `{ ...BRUSH, size: 8 }`,
so `strokeDiameter(brush, 1) = 8` → radius 4 → coverage ⊆ samples ± 4 →
x ∈ [2, 30]. The hardcoded box is exactly right **for that fixture**.

Consequences:

- The guard **would** fail if a stamped brush put coverage outside that box —
  **but only for the default-brush fixture it is attached to.** There is no
  stamped fixture, so today the guard does not exercise the stamped path at
  all.
- Because the box is hardcoded and the region is derived, the two are not
  *tied together*: a change to `strokeSampleBounds` that shrinks the region
  below the coverage would leave `coverageInside` passing. The separate area
  assertions (`:2468`, `:2477`, `:2503`) pin the region numerically for
  *their* fixture — `:2477` expects the blit at `[144, 144, 32, 32]`, which
  is `samples ± 6` for a 10 px brush — but again only for the default brush.

**(c) The `ceil` in `strokeRegion` is not exercised for hard brushes.**
`strokeRegion` (`:941-944`) floors the min edge and ceils the max edge. For
the existing fixtures the samples are integers and the spread is an integer
(5 for size 8, 6 for size 10, both hard), so `floor(v) === ceil(v)` — the
`ceil` is a **no-op**. It only becomes load-bearing when the spread or the
sample coordinates are fractional (a soft brush, or fractional dab
positions). Verified: **no fixture in `canvas2dRenderer.test.ts` uses
fractional sample coordinates** (the only fractional matches in the file are
`pressures: [0.5, 1, 0.5]` at `:107` and two alpha expectations). So the
"region strictly contains the coverage" property is **not pinned by the suite
for fractional geometry** — which is precisely the geometry a stamp engine
introduces.

**Conclusion for the region mismatch: the existing suite would NOT reliably
catch it.** A stamped brush whose footprint exceeds `strokeSampleBounds`
would pass `checkEveryPathAgrees` (single-point comparison) and is not
exercised by the `coverageInside` guard (default-brush fixture only).

### 5.2 The max-alpha issue — **entirely unguarded**

This is the more serious of the two.

**No existing test would fail if a stamp engine were implemented with
`source-over` accumulation instead of a max-union.** Reasoning:

- The only anti-darkening test is `canvas2dRenderer.test.ts:2600-2621`
  ("does not darken a self-crossing stroke"), which asserts the crossing
  pixel is `rgb(128,128,128)`. That assertion is about the **stroke-level**
  alpha, which is applied once in `compositeStrokeBuffer:976`. Under
  `source-over` accumulation the stroke alpha is *still* applied once, so the
  test **still passes** — while the per-dab hardness profile has been
  destroyed at every overlap.
- `checkEveryPathAgrees` compares live vs rebuild vs commit vs export. All
  four would use the *same* accumulation, so they agree with each other and
  the test **still passes**.
- `canvas2dStroke.test.ts:118-127` ("paints at full coverage so overlapping
  segments cannot darken") asserts `call.alpha === 1` on the recorded
  `stroke` calls — it verifies the *alpha argument*, not the *union
  semantics*, so it **still passes**.

**Nothing in the suite asserts that two overlapping dabs produce
`max(a, b)` rather than `a + b` or a saturated `1`.** The requirement in
`docs/ROADMAP.md:212-214` is therefore **completely unenforced**. This is the
single most important gap the follow-up found, and it is the reason the union
rule must have its own test rather than being assumed from the existing
"no darkening" coverage.

### 5.3 Interaction with the eraser

The eraser is not separately at risk from the union rule — `applyErase`
(`:1205-1224`) rebuilds the layer from its snapshot on every update and
subtracts the buffer once, so a self-crossing eraser still erases once. But
the eraser **inherits the union semantics**: a union-ed buffer has a
different alpha profile from a source-over-accumulated one, and the existing
eraser pixel tests (`:591-812`) exercise only the segment path. The plan's
Q6 answer (`docs/architecture-port-plan.md` L192) agrees the eraser needs
re-running with a stamped brush.

### 5.4 What the existing `qa/` harness already provides

The untracked `qa/` directory (another agent's work, for the R1
dirty-bounds slice) contains a **real-Chromium QA harness** that already
implements the whole-canvas comparison this verification needs:

- `qa/harness.ts:200` — `comparePixels(a, b, width, height, ignoreBorder)`,
  returning `identical`, `pixelsDiffering`, `maxChannelDelta`,
  `firstDifference` and `differenceBounds`.
- `qa/harness.ts:561-623` — `runInvariants()`: for each scenario it drives
  **live → committed → rebuilt → exported** and compares them over the **whole
  canvas** (`:617-619`), reporting `liveVsCommitted`, `committedVsRebuilt` and
  `rebuiltVsExport`.
- `qa/harness.ts:766-768` — two mutants: `m4-feather-spread` and
  **`m6-floored-bounds`**, the latter changing `strokeRegion` from `ceil` to
  `floor` on the max edges — i.e. **shrinking the composited region by up to
  one pixel**, exactly the mutation that would produce the mismatch.

Two observations:

1. The harness is a **manual browser harness** (`qa/parity.html` →
   `window.__qa.runAll()`), **not** part of the automated Vitest suite, and
   **no results file is committed** — so it cannot currently be cited as
   evidence either way.
2. The `m6-floored-bounds` mutant is, by the arithmetic in §5.1(c), a **no-op
   for the existing integer-coordinate fixtures** (`floor(v) === ceil(v)`).
   It would only change pixels for fractional geometry. So the harness's
   mutation set does not currently probe the fractional-geometry case either.

**This is the cheapest route to a regression test for the region mismatch:**
add a fractional-coordinate (or stamped) scenario to `qa/harness.ts`'s
`scenarios()` and let the existing `runInvariants()` whole-canvas comparison
do the work — the harness already has the right shape.

---

## 6. Smallest additional tests needed

Four tests, in priority order. Each names the file, the assertion and the
expected value.

### R-1 — The union rule (highest value; currently zero coverage)

**Where:** a new `src/test/stampRaster.test.ts` (the plan names the same
file), against a **pure** coverage-accumulator function so it needs no canvas.

**Assert:** for two dabs with coverage `a` and `b` on the same pixel, the
accumulated coverage is `max(a, b)` — byte-exactly, **including the
antialiased rim** (a falloff > 0). Also assert that a self-crossing stamped
stroke's coverage at the crossing equals the single-dab coverage, not twice
it.

**Why it is the smallest effective test:** it is the only assertion that
enforces `docs/ROADMAP.md:212-214`, and §5.2 shows nothing else does. It
does not need the renderer, the pixel canvas, or a browser.

### R-2 — The region guard, tied to the derived region

**Where:** `src/test/canvas2dRenderer.test.ts`, in `checkEveryPathAgrees`.

**Assert:** after rasterizing a stroke, `coverageInside(strokeBuffer, …)` is
true **for a box derived from the same `strokeSampleBounds` formula the
compositing uses** — not a hardcoded one. Add the case for a stamped brush
and for **fractional sample coordinates** (e.g. `xs: [6.5, 16.25, 26.75]`),
which is the geometry that currently escapes every fixture.

**Why:** §5.1(a) shows the single-point comparison cannot see an escaping
dab; §5.1(c) shows the fractional case is untested. This converts the
existing hardcoded guard into a derived one.

### R-3 — Whole-canvas live-vs-commit parity

**Where:** `src/test/canvas2dRenderer.test.ts` (or the `qa/` harness for real
Chromium pixels).

**Assert:** live preview, commit, rebuild and export are compared over the
**whole canvas**, not at one sample point. Expected: `pixelsDiffering === 0`
for the segment path (proving the suite is still sensitive), and the same for
a stamped brush. Reuse the `comparePixels` shape from `qa/harness.ts:200`.

**Why:** this is the direct guard for the §3.1 hazard and the only assertion
that can distinguish "live looks right" from "live and commit agree".

### R-4 — The new brush fields round-trip

**Where:** `src/test/projectFormat.test.ts`.

**Assert:** a stroke with `stamp: true`, `stampSpacing: 0.35`,
`stampHardness: 0.5` round-trips through `serializeProject` → `parseProject`
with those exact values; and a v1–v8 file reads them as the documented
off-values.

**Why:** §2 shows the tree is currently one step away from a silent
save/reopen data loss. This test would have caught the defect that the
compile error is currently masking, and it is the test the report's
coupling C8 says must accompany the field.

---

## 7. Corrections and refinements to the original report

| # | Location | Nature | Detail |
| --- | --- | --- | --- |
| 1 | `feature-analysis.md` §5.1 | **Refinement** | The live/commit divergence applies to the **hard, untextured** path only. In the soft/textured branch the `region` argument is ignored (`Canvas2DRenderer.ts:1033-1046`) and both paths draw a `strokeSampleBounds`-bounded feathered copy, so they agree. The underlying requirement (the footprint must fit the bound) is unchanged |
| 2 | `feature-analysis.md` §5.1 | **Refinement** | The live preview's whole-buffer draw is the *hard* branch (`L1028`); the *soft/textured* live path is bounded. Stating this avoids over-claiming the blast radius |
| 3 | `feature-evidence.json` → `symbolIndex` | **Correction (tree drift)** | Six entries in `src/core/brushes/defaults.ts` and one in `src/types/brush.ts` are stale against the current working tree (`updateBrushSettings` is the only range that no longer brackets its definition). The report's header already anchors it to `ad2ef11`; a one-line note would remove the ambiguity |
| 4 | `feature-analysis.md` §5.9 | **Refinement** | Unchanged in substance, but the tree's scaffold now shows the question is live: `readBrush` reads none of the new fields, so "is a bump required" also decides "how are the new fields read for older versions" |
| 5 | `feature-analysis.md` §10.2 / §5.8 | **Addition** | A new failure mode, now observed rather than predicted: adding a **required** field to `BrushSettings` breaks every construction site at compile time (`projectFormat.ts:693`, `brushSettings.test.ts:42`, `canvas2dRenderer.test.ts:38`). The report described the *silent* variant of this; the loud variant is what actually happens |
| 6 | `feature-analysis.md` §5.3 | **Addition** | The "no max-alpha composite" claim is now backed by the W3C Compositing and Blending Level 1 CR (21 March 2024) §4/§6/§9.1.4/§9.1.13/§10.1.6, not just by inference |
| 7 | `feature-analysis.md` §5.3 | **Addition** | The plan's option A (a footprint-bounded 1 byte/device-pixel coverage cache) moves the documented budget 58 → 62 bytes/px (992 MiB, still inside 1 GiB). The *number of full-resolution surfaces* is unchanged, which is the constraint that matters. Evidence recorded; the decision is the coordinator's |
| 8 | `feature-analysis.md` §11 (Q2, Q3, Q7) | **Refinement** | The plan answers Q3 (shapes keep the segment path entirely) and Q7 (brush and eraser only in S1) and Q6 and Q8 — but the plan and the tree's scaffold disagree on the **field set and the off-sentinel** (`stampSpacing = 0` + `stampFalloff` vs `stamp = false` + `stampSpacing` + `stampHardness`), and the plan's `stampSpacing = 0` sentinel is unreachable under the tree's own `MIN_STAMP_SPACING = 0.02` clamp. Flagged for the coordinator and the architecture translator |

**No claim in the original report was found to be false.** Six of the seven
corrections above are refinements or additions; one (the symbol-index drift)
is a consequence of the tree moving, not of an error.

---

## 8. Unresolved questions (for the coordinator)

| # | Question | Status after this verification |
| --- | --- | --- |
| **Q1** | Format v9, or an additive off-by-default field? | **Unresolved — deliberately.** All three governing quotes re-verified verbatim (§3.3). The in-progress scaffold does not decide it. Evidence recorded; the decision is the coordinator's |
| **Q5** | How is the per-dab union realised without a fourth full-resolution surface? | **Unresolved.** The constraint is confirmed and quantified (§3.2). The plan offers two options (58 unchanged but quadratic, or 62 bytes/px and still inside budget). Not chosen here |
| **Q2** | Stamp-control naming | **Unresolved.** The UI already spends "Spacing" for sample density (`BrushControls.tsx:51-59`) |
| **Q3** | Do fill-shape interiors get stamped dabs? | **Partially answered by the plan** (shapes keep the segment path in S1) — but that is the plan's choice, not the code's |
| **Q4** | Is `spacing` provably non-appearance-changing? | **Still a derivation, not a proof.** The plan's arc-length lattice would preserve it; no test exists either way |
| **Q6** | Does the union rule apply to the eraser? | **Plan answers yes**; the code has no stamp path yet. Existing eraser pixel tests (`:591-812`) must be re-run with a stamped brush |
| **Q7** | Does the stamp engine change the shape tools? | **Plan answers no for S1**; the tree's scaffold does not address it |
| **Q8** | The dab budget per stroke | **Unresolved.** T-31 cannot be given a concrete expected value until the budget constant and the minimum-spacing floor are chosen |
| **Q9** *(new)* | Which field set is canonical — the plan's `stampSpacing` + `stampFalloff` (with a `0` sentinel) or the tree's `stamp` + `stampSpacing` + `stampHardness` (with a `false` sentinel)? | **Unresolved.** The two artifacts disagree, and the plan's sentinel is unreachable under the tree's own clamp (§2) |
| **Q10** *(new)* | Should `readBrush` read the new fields, and what are the off-values for a v1–v8 file? | **Unresolved and now urgent** — the current tree loses the drawn values on reopen (§2) |

---

## 9. Is the original analysis safe to use as the basis for architecture planning?

**Yes — with the seven corrections in §7 applied, and with the two additions
in §2 and §5.2 carried forward.**

Reasoning:

1. **Every load-bearing claim was re-verified against the source**, not
   inferred: the live/commit asymmetry (with a narrowing refinement), the
   absence of a max-alpha composite (now with a normative spec citation), the
   58/74 bytes-per-pixel arithmetic, and the format-version conflict (all
   three quotes verbatim).
2. **The citation audit found no false claim** — 78 symbol-index entries,
   77/78 in range, the one exception caused by the tree moving rather than by
   an error; 194 content spot-checks with no broken test reference.
3. **The report's predictions held.** Coupling C8 ("a new brush field is
   silently dropped unless three files change") predicted exactly the defect
   that has since appeared in the working tree, in two of the four required
   sites. The one *addition* to the report is that the failure is louder than
   predicted (a compile error, not a silent drop) — which is good news.
4. **The report's two highest-risk findings are the two that the follow-up
   confirms are least guarded by tests** (§5.1, §5.2). The union rule has
   **zero** test coverage today, and the region rule is guarded only by a
   single-point comparison and a hardcoded box. The architecture translator's
   plan already addresses both (§5.1, §8.7 of `docs/architecture-port-plan.md`),
   which is a positive signal that the analysis was usable as intended.
5. **The one genuinely new risk** — the save/reopen data loss behind the
   current compile error (§2) — is a live defect in the working tree, not a
   theoretical one, and it should be fixed before any stamp field is
   considered complete.

**Recommended immediate actions, in order:**

1. Fix the three typecheck errors, and add the new fields to `readBrush`
   with a defined off-value for v1–v8 files (Q10) — otherwise the
   save/reopen round trip loses the drawn settings.
2. Add **R-1** (the union test) and **R-3** (whole-canvas live-vs-commit
   parity). The union is now **implemented** (`src/core/rendering/stampCoverage.ts`)
   but has **no test at all** (§10.2) — the union rule is the report's
   highest-risk requirement and it is currently unenforced. Both tests are
   small, and together they close the two gaps that §5 shows are open.
3. Reconcile **Q9** (the field set) between the plan and the tree — the
   divergence is now in shipped code (§10.3).
4. Re-document the raster budget if the footprint-bounded coverage map is
   kept (§10.3).

---

## 10. The tree moved again — the implementation has landed (partially)

**Observed while writing this report.** The working tree changed a second
time: another agent is now implementing the stamp engine. New/changed since
§1:

```
 M src/core/rendering/Canvas2DRenderer.ts   (+160)
 ?? src/core/rendering/stampCoverage.ts      (new, 300+ lines)
 ?? final-audit.md, provenance-record.json, reuse-decision.md
```

This section records what the in-progress code shows about the report's
findings. It is **not** a code review of that work — it is the answer to
"do the report's critical findings actually bite, or were they noise?"

### 10.1 The three critical findings are all being honoured

| Report finding | In-progress implementation | Verdict |
| --- | --- | --- |
| **C3 / §5.3** — no Canvas 2D max-alpha composite | `src/core/rendering/stampCoverage.ts` L1-21 states the same reasoning: *"Canvas 2D has no max-alpha composite operation (its `lighten` blend mode compares colours, not alpha), so repeated `source-over` would darken every overlap and would flatten a dab's own hardness curve wherever a neighbour's opaque core covers it."* The union is computed in plain numbers and uploaded as pixels. | **Confirmed and acted on** |
| **C3** — the union must be a true maximum | `StampCoverage.paintDab` L229-231: `const value = Math.round(coverage * 255); if (value > tile[index]) { tile[index] = value; }` — a per-pixel **maximum**, with a correct early-out at L211-213 (*"Already fully covered: a maximum cannot raise it"*). | **Confirmed and acted on** |
| **C1 / §5.1** — the footprint must stay inside `strokeSampleBounds` | `stampDabCoverage`'s doc, L142-143: *"The falloff never reaches past the dab's radius, so a dab's footprint stays inside the brush radius the renderer reserves for it."* The dab radius is `strokeDiameter(brush, pressure) / 2` (L103, L126). | **Confirmed and acted on** |
| **C2 / §5.2** — `rasterizeStroke` is stateless, so dab placement needs a cursor | The renderer now holds `stampCoverage` + `stampDabCount`, and the dab list is a **pure function of the samples**, so *"the dabs that are already painted are simply the first ones of the new list"*. A lattice-index approach — the same shape the plan's Q8 answer proposed. | **Confirmed and acted on** |
| **C10 / §5.10** — `spacing` must stay non-appearance-changing | `stampDabs` L80-90: dabs are placed *"every `spacing` document pixels of **arc length** along the path"*, with the radius from the interpolated pressure. Arc-length parameterisation is what makes the dab set independent of the sample density — the report's derivation, now realised. | **Confirmed and acted on** |
| **C5 / Q3** — the fill-shape interior | `Canvas2DRenderer.isStamped` returns false for `stroke.fill === true`, so shapes keep the flat polygon fill and the segment outline. | **Confirmed and acted on** |
| **§10.3** — the raster budget | The coverage map is **footprint-bounded** and tiled at `COVERAGE_TILE_SIZE = 64` device pixels — the plan's option A. No fourth full-resolution surface. The 58 → 62 bytes/px documentation change is still **outstanding**. | **Acted on; the doc update is pending** |

**This is the strongest possible evidence that the original report was usable
as the basis for architecture planning**: the implementation independently
arrived at the same answers, and in three cases the *comments in the new code
cite the same technical reasoning the report recorded.*

### 10.2 The gap is now sharper, not smaller

`src/core/rendering/stampCoverage.ts` exists and is **pure** — no canvas, no
DOM, no clock, no randomness (its own header, L16-20) — which makes it
directly unit-testable. And yet:

```
Select-String -Path "src/test/*.test.ts" -Pattern "stamp" | Measure-Object
  -> 18 matches, ALL of them `stampDot` (3) or `timeStamp` (15)
```

**There is no test file for the stamp engine at all**, and no
`src/test/stampRaster.test.ts` (the file the plan names at
`docs/architecture-port-plan.md` L211 and the acceptance criteria at
`docs/acceptance-criteria.json` AC-03).

So the union rule — the report's highest-risk finding — is now **implemented
but entirely untested**. The R-1 test in §6 is *more* valuable than it was an
hour ago, because there is now a pure, canvas-free function to test:

```ts
// smallest possible R-1, against src/core/rendering/stampCoverage.ts
const coverage = new StampCoverage();
coverage.paintDab(10, 10, 8, 0.4);   // a dab with a soft rim
coverage.paintDab(14, 10, 8, 1.0);   // an overlapping dab with a hard core
// assert: every pixel's coverage == max(dabA, dabB), byte-exactly,
//         including the antialiased rim
```

`paintDab` returns the touched `StampRect` (L236) and `writeRect`
(L246-…) writes the coverage out, so the assertion can be made on plain
numbers with no canvas at all.

### 10.3 What this changes in the recommendations

| Recommendation | Status after §10 |
| --- | --- |
| 1. Fix the three typecheck errors; add the new fields to `readBrush` with a defined off-value | **Still outstanding and still urgent** — the round-trip data loss (§2) is live |
| 2. Add **R-1** (union) and **R-3** (whole-canvas live-vs-commit) | **Still outstanding, and now the top priority** — the union is implemented but unverified, and the live/commit mismatch (§5.1) is unverified |
| 3. Reconcile **Q9** (the field set) between the plan and the tree | **Still outstanding.** The tree's `stampCoverage.ts` uses `stampHardness` (matching the tree's scaffold), while the plan and `docs/acceptance-criteria.json` still say `stampFalloff` — the divergence is now visible in shipped code, not just in a plan |
| 4. *(new)* Document the raster-budget change if the footprint-bounded coverage map is kept | The map is bounded to the stroke's footprint, so the **number of full-resolution surfaces is unchanged**; the byte figure still moves from 58 to ~62 and `docs/ARCHITECTURE.md` L774-812 and `docs/SESSION-BRIEF.md` §6 must be re-documented |

---

### Appendix — verification method

- **Re-reads:** `src/core/rendering/Canvas2DRenderer.ts` (L655-714, 900-944,
  995-1084, 1139-1164), `src/core/rendering/canvas2dStroke.ts` (full),
  `src/core/project/projectFormat.ts` (L686-725), `docs/SESSION-BRIEF.md`
  (L309-322, 462-471, 496-501), `docs/ROADMAP.md` (L150-228),
  `src/types/brush.ts`, `src/core/brushes/defaults.ts`, `src/utils/math.ts`,
  `src/test/canvas2dRenderer.test.ts` (L36-60, 2423-2505, 2506-2665),
  `qa/harness.ts` (L1-70, 196-240, 560-679), `qa/mutants/*/Canvas2DRenderer.ts`
  (diffed against the shipped renderer).
- **Commands:** `pnpm typecheck` (3 errors, quoted verbatim in §2);
  `git status`, `git diff --stat`, `git diff -- src/types/brush.ts
  src/core/brushes/defaults.ts`, `git log --oneline -3`;
  two Python audit scripts over the repository.
- **External:** W3C Compositing and Blending Level 1, W3C CR Draft
  21 March 2024, <https://www.w3.org/TR/compositing-1/> — §4 (the
  `globalCompositeOperation` value list), §5, §6 (the general formula),
  §9.1.4 (`source-over`), §9.1.13 (`lighter`), §10.1.6 (`lighten`).
- **Not done:** no browser run, no packaged-app run, no test suite execution
  (the tree does not compile, so `pnpm test` would not be meaningful), no
  modification of any file except the creation of this one.
