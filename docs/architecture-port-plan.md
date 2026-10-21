# Architecture port plan — stamp (dab) brush engine

**Status:** plan only. No production code, test, architecture file or config file was
changed by this plan. The only files it adds are this document and
`docs/acceptance-criteria.json`.

**Baseline inspected:** `main` at `ad2ef11` (project format **v8**, 461 tests in 29
files), read against the live tree, not against memory. Architecture facts were taken
from `src/`, not from `docs/`; the docs were used only to confirm intent.

**Upstream feature:** `PHASE3-STAMP-ENGINE` — the last open Phase 3 item in
`docs/ROADMAP.md` (Phase 3, "Stamp-based brush engine behind the existing stroke
interface") and `docs/SESSION-BRIEF.md` §9.

**Companion artifacts read:** `docs/g1/feature-analysis.md` and `docs/g1/feature-evidence.json`
(the Feature Analysis, analyst `paka-feature-analyst`, 2026-10-20, at commit
`ad2ef11`). This plan reconciles with that analysis, answers its eight open
questions (§2.3) and adopts its three CRITICAL findings as hard design
constraints (§8.7–§8.9).

> **Updated 2026-10-20 after `docs/memory-budget-review.md`.** An implementation
> of this slice now exists in the working tree (uncommitted), so the plan was
> re-checked against it. Six corrections were required and are applied below:
> the memory claim in §9.3 was **wrong** (the 58 B/doc-pixel envelope holds; the
> plan's "62" was not supported), the module and field names were aligned with
> the code that exists, the missing dab budget was recorded as an open gap, the
> upload granularity was corrected, and the provenance gap in §0 is closed. They
> are listed in **§18**.

---

## 0. Inputs, provenance status, and what would change this plan

| Required input | Status | Evidence |
| --- | --- | --- |
| Repository Inventory | **Present** | The repository itself (`src/`, `src-tauri/`, `docs/`, `package.json`), read directly; §3 lists the modules. The Feature Analysis's symbol index (§13 of `docs/g1/feature-analysis.md`) matches what I read. |
| Feature Analysis | **Present** (arrived during this planning session) | `docs/g1/feature-analysis.md` + `docs/g1/feature-evidence.json`, at commit `ad2ef11`. It confirms the feature is **not implemented** in the tree (`rg -n "stamp\|dab" src` → 33 hits, all the single-dab helper `stampDot`, prose, or unrelated words), identifies the three CRITICAL hazards (§5.1–§5.3), the two documentation conflicts (§9.2, §9.4), the raster-budget constraint (§10.3) and eight open questions (§11). |
| License / Provenance Decision | **Present** | `docs/g1/provenance-record.json` (agent `paka-license-gate`, 2026-10-20): it **approves Strategy A — independent reimplementation from Paka's own documented behaviour and code** (the strategy this plan chose) and **blocks** GIMP (GPL-3.0), Krita (GPL-3.0), MyPaint (GPL-2.0) and other GPL sources. Paka's own licence is MIT (`docs/g1/feature-evidence.json`). | The gate outcome matches this plan's strategy exactly, so the plan's provenance reasoning is confirmed rather than changed. (This review does not re-do the provenance review.) |

**Consequence, and the decision it forces.** The Feature Analysis settles the
provenance question: the "upstream feature" is **Paka's own roadmap item**, and no
implementation of it exists anywhere — not in this repository, not vendored, not
copied from another project. There is therefore **no third-party code in scope**
for the recommended path, and no third-party licence obligation attaches to it.
This is not a fallback
choice; it is the only choice the evidence supports, and it is exactly
**Strategy 3 — independently reimplement the behaviour from an independently
written specification**, where the specification is Paka's own
(`docs/ROADMAP.md` "Next slice", `docs/SESSION-BRIEF.md` §9,
`docs/ARCHITECTURE.md`, and the analyser-verified baseline in `docs/g1/feature-analysis.md`).
The licence gate reached that conclusion independently and recorded the
clean-room condition the work must be built under: see
`docs/CLEAN-ROOM-ATTESTATION.md`.

**What would change this plan** (ask the coordinator for these before the
implementer starts):

1. If the coordinator approves a **third-party** implementation (for example a
   named brush engine), this plan's *architecture* stands unchanged — the modules,
   the interfaces, the format bump, the union semantics and the test list are all
   upstream-agnostic. Only the body of `src/core/rendering/stampCoverage.ts` changes.
   The rejected strategies in §13 become live options and must be re-assessed for
   licence, dependency cost and exit cost before any code is written.
2. If the coordinator rules differently on **Q1** (the format version — §2.3), the
   slice shrinks: an additive, off-by-default field needs no writer change and no
   version-rejection test, but then a v8 build silently draws a stamped stroke as
   a segment stroke. This plan argues against that reading (§2.3, Q1).
3. If the coordinator requires the **whole** Phase 3 item (per-dab spacing **and**
   hardness curves **and** directional/image stamp textures) in one slice, this
   plan is too small; §16 splits the work and says which slice carries the
   asset-pipeline part (a different subsystem needing its own gate).

---

## 1. Target Paka behaviour

### 1.1 What ships in the slice this plan recommends (slice **S1**)

A **stamp (dab) brush engine** behind the existing stroke interface:

- A stroke is no longer only "round-capped segments between samples". With the
  stamp engine on, it is a **union of round dabs** placed along the stroke's
  stored polyline at a fixed arc-length interval (a lattice from the path start —
  the shape the Feature Analysis asks for in §5.2).
- Three new brush fields, captured **per stroke** exactly like `hardness`,
  `spacing`, `stabilizer` and `texture` today:
  - `stamp` — a boolean gate. `false` means **off**: the legacy segment path runs
    and the output is byte-identical to today.
  - `stampSpacing` — the distance between dab centres as a **fraction of the
    brush's nominal size** (so the dab positions are a pure function of the path
    and do not follow the pressure-varying diameter). Range `0.02 … 1`.
  - `stampHardness` — the **radial falloff** of one dab, in `0 … 1`. `1` is a
    crisp dab edge with a one-pixel antialiased rim; lower values widen the
    falloff towards the dab's centre, which is a true hardness curve rather
    than a blur of the finished silhouette. It is independent of `hardness`,
    which still feathers the whole stroke after its coverage exists.
- Coverage is the **union** of the dabs (per-pixel maximum), never a sum. A
  self-crossing or overlapping stamped stroke **cannot darken**, exactly like the
  existing "one alpha per stroke" invariant.
- The dab set is a **pure function of the stored samples and the brush**. Nothing
  is random, nothing depends on time, zoom, `rasterScale`, frame timing or the
  order in which pointer events arrived. Live drawing, commit, layer rebuild,
  undo/redo, reopen and PNG export therefore agree.
- The stamp engine applies to **brush and eraser** strokes. **Shape tools keep the
  segment path** (the precedent is `stabilizer`, which is brush/eraser only), and
  a shape's stroke record stores the stamp fields as `0` so the file says what was
  actually drawn.
- Everything else is unchanged: the stroke's opacity is still applied **once**, at
  composite time; the hardness feather is still a **post-pass** over the finished
  silhouette; the grain texture is still a **post-pass**; the stroke is still one
  undo step; the samples are still the authoritative record.

### 1.2 What the slice deliberately does **not** add

Directional / image-based stamp textures, non-round dab shapes, per-dab scatter
and rotation, per-dab opacity (the Feature Analysis §5.4 is explicit that it would
break invariant I1), and a GPU/WASM dab rasterizer. See §15.

### 1.3 The invariants this slice must not break

These are the repo's own settled decisions (`docs/SESSION-BRIEF.md` §6), the
Feature Analysis's invariant table (`docs/g1/feature-analysis.md` §4) and the renderer's
comments; each one becomes a test.

| Invariant | Where it lives | How S1 keeps it |
| --- | --- | --- |
| I1 — the document model is authoritative; pixel buffers are rebuildable caches | `src/core/document/types.ts` | The stroke record still carries samples + brush; the coverage map is a cache, discarded on rebuild. |
| I1 — one alpha per stroke; segments/dabs are drawn at full coverage | `canvas2dStroke.ts` L97–108 | The dab union is a per-pixel **maximum**, so overlaps never accumulate alpha. |
| I2 — live preview == committed pixels == rebuilt pixels == exported pixels | `Canvas2DRenderer` L279–381 | The dab plan is a pure function of the samples; the live path computes the same set incrementally. |
| I3 — a stroke is self-describing | `createStrokeRecord` L55 | The brush (with both stamp fields) is copied onto the record. |
| I4 — a stroke is one undo step | `DrawingEngine.finishStroke` L1408–1445 | No new command type. |
| I5 — the samples stay authoritative; stamps are a rasterization strategy | `docs/ROADMAP.md` L205–207 | No new element kind; the file stores samples, not pixels. |
| I6 — determinism: no `Math.random()`, no time, no zoom dependence in a repaint path | `textureCoverage` L65–79 | The plan is a pure function; no randomness is introduced. |
| I7 — the cost follows the inked area, not the document size | `rasterizeStrokeToBuffer` L879 | The coverage cache is bounded by the stroke's own footprint. |
| I8 — the brush is editor state (no history, no dirty) | `setBrush` L836 | The two new fields behave like `hardness`. |
| I9 — `DrawingRenderer` and `StrokeRecord` stay the boundary | `src/core/rendering/types.ts` L46–108 | The stamp engine is a strategy *inside* `Canvas2DRenderer`. |
| I10 — the raster budget: 58 bytes per document pixel, 928 MiB at the cap | `docs/ARCHITECTURE.md` L774–812 | No new **full-resolution** surface; the coverage cache is footprint-bounded (§9.3). |
| — a layer change during a gesture is refused | `DrawingEngine.ts` L1015 | Unchanged; the stamp path adds no new gesture kind. |
| — React never sees a pointer sample | `docs/SESSION-BRIEF.md` §1 | The dab plan is computed in the renderer, never in React state. |

---

## 2. Strategy selection

### 2.1 The six strategies, compared on the required dimensions

Legend: ✔ good · ◐ workable with a cost · ✘ disqualifying.

| Dimension | 1. Existing library behind an interface | 2. Port an approved upstream algorithm | 3. Independent reimplementation from Paka's own spec | 4. Rust / native / WASM | 5. Separately running subsystem | 6. Reject / defer |
| --- | --- | --- | --- | --- | --- | --- |
| License gate | ◐ MIT-only candidates exist; each needs a provenance record — **none is needed here** because the feature exists nowhere and no upstream is on the table | ✘ the likely upstreams (Krita **GPL-3.0**, GIMP **GPL-3.0**, MyPaint **GPL-2.0**) would force relicensing Paka, which is MIT | ✔ **none — no third-party code is read**; Paka is MIT, so any derivative of GPL code would be incompatible | ✘ same as (2) for a Rust port; a WASM build of a GPL engine inherits the licence | ◐ depends entirely on the subsystem | ✔ none |
| Platform support | ✔ pure JS | ✔ pure JS | ✔ pure JS | ✘ adds a native build to a Tauri app that currently has one small Rust crate (`project_io.rs`, 230 lines) | ✘ a second process on every platform | ✔ |
| Build / dependency cost | ◐ +1 dependency in a bundle that today ships React + Tauri only | ✔ none | ✔ none | ✘ +a WASM toolchain or a Rust crate with a build matrix | ✘ +a second deployment target | ✔ |
| Runtime overhead | ◐ a library that returns an outline polygon cannot produce per-dab coverage | ✔ | ◐ the dab union is computed in JS (§9 gives the cost model) | ✔ fast, but the data must cross the boundary | ✔ | ✔ |
| Pointer / stylus latency | ✘ the outline model has no dab cadence | ✔ | ✔ incremental: only new dabs are computed per event | ✘ an IPC round trip per sample is forbidden by the constraints | ✘ | ✔ |
| Memory | ✔ | ✔ | ◐ 1 byte per **device** pixel over the inked area, freed at commit | ◐ linear memory copy across the boundary | ✔ | ✔ |
| Garbage collection | ◐ per-sample objects in most outline libraries | ✔ | ✔ the coverage map is a `Uint8Array`; the hot path allocates no per-sample objects | ✘ a WASM heap per module | ✔ | ✔ |
| Image dimensions | ✔ | ✔ | ✔ the coverage map is bounded by the stroke's inked rect, not the document | ◐ | ✔ | ✔ |
| Coordinate / colour / alpha semantics | ✘ an outline polygon has no per-pixel coverage to composite once at the stroke's alpha | ✔ | ✔ the union is computed in the same document-pixel space as the rest of the renderer, with 8-bit sRGB coverage like `FillPatchRecord.mask` | ◐ premultiplied-alpha conversions across the boundary | ✔ | ✔ |
| Threading | ✔ | ✔ | ✔ single-threaded, same as today | ✘ a worker/WASM thread adds a scheduling story | ✔ | ✔ |
| Debugging | ◐ one more abstraction | ✔ | ✔ the whole path is plain TypeScript with no new indirection | ✘ | ✘ | ✔ |
| Packaging | ◐ +1 dependency in the Tauri bundle | ✔ | ✔ | ✘ | ✘ | ✔ |
| Distribution | ✔ | ✔ | ✔ | ◐ | ✘ | ✔ |
| Maintainability | ◐ an upstream library's roadmap is not Paka's | ◐ a port needs its own maintenance | ✔ Paka owns the code and the docs | ✘ | ✘ | ✔ |
| User data compatibility | ◐ a library's semantics become the file format | ◐ | ✔ the format bump is Paka's own (v9) and old files keep rendering exactly | ◐ | ✔ | ✔ |
| Long-term exit cost | ◐ the interface is narrow, so replaceable | ✔ | ✔ the interface is narrow and the algorithm is ~200 lines of plain TypeScript | ✘ a WASM boundary is expensive to undo | ✘ | ✔ |

### 2.2 Chosen strategy

**Strategy 3 — independently reimplement the behaviour from Paka's own written
specification.** The specification is `docs/ROADMAP.md` "Next slice" plus
`docs/SESSION-BRIEF.md` §9 plus the renderer contract in
`src/core/rendering/types.ts`, with the baseline behaviour pinned by the Feature
Analysis's symbol index. It is detailed enough to implement without consulting any
upstream source, and it is Paka's own text, so no third-party code enters the
tree, no dependency is added and no attribution obligation is created. The
licence gate confirmed this and added one condition: the work must be built
clean-room — no GPL brush-engine source may be consulted while implementing it.
See `docs/CLEAN-ROOM-ATTESTATION.md`.

**Strategy 1 is kept on the shelf, deliberately.** `perfect-freehand` (MIT) is the
obvious candidate: small, MIT, good tapered strokes. But it computes a **stroke
outline polygon**, not per-dab coverage, so it cannot express "hardness curves" or
"per-dab textures" (the two things the roadmap asks for), and its model (one
filled polygon) would have to be re-expressed as Paka's "coverage buffer,
composited once at the stroke's alpha". It would also add Paka's first rendering
dependency, to a codebase that deliberately has none, and it would put an
upstream's stroke model in the file format's path. **Keep as an option** for a
future taper/outline feature: the interface in §5.1 is narrow enough that swapping
the planner is a one-file change.

**Strategy 4 is deferred, with a trigger.** A native or WASM dab rasterizer is
only worth it if the packaged-app profile shows the JS coverage pass is the
bottleneck. `docs/PERFORMANCE_AUDIT_2026-10-20.md` F7e is the standing warning:
timings measured in the agent harness did not reproduce on an idle machine, so no
renderer-side acceleration may be recommended before a **packaged-app** profile
(Appendix C of that document) exists.

### 2.3 Answers to the Feature Analysis's open questions (Q1–Q8)

`docs/g1/feature-analysis.md` §11 explicitly refers Q1, Q2, Q5, Q7 and Q8 to the
coordinator/architecture translator. These are the answers; the implementer should
treat them as binding.

| # | Question | Answer | Consequence for the slice |
| --- | --- | --- | --- |
| **Q1** | Does the stamp engine require **format v9**, or is an additive off-by-default field enough? | **v9, with the stamp fields required in v9.** The additive reading fails: the field is *not* ignorable — a v8 reader ignores it and draws the segment path, which is a **different picture** for every non-zero value. That is precisely the condition `docs/SESSION-BRIEF.md` §6 names ("a bump is required when an older reader would render a different picture"), and it is what `docs/ROADMAP.md` L218–221 and `docs/SESSION-BRIEF.md` §9 both require. The strict machinery already exists (`parseProject` refuses `version > PROJECT_VERSION`, `projectFormat.ts` L510–514) and the required-field precedent exists (`hardness` from v6, `texture` from v7 — L696–717). | The slice ships a v9 writer **and** reader, a version-rejection test, and per-version defaults for v1–v8. **Consequence for the field set:** the v9 brush field set must be *complete* for what S1 ships — a second appearance-changing stamp field later needs **v10**, so `stamp`, `stampSpacing` and `stampHardness` ship together. *(Implemented: `PROJECT_VERSION = 9` with the three fields required from v9 and defaulted off for v1–v8.)* |
| **Q2** | What is the stamp-spacing control called, and is it one slider or several? | **A toggle plus two sliders**, and the existing control is **left alone**. The tree's answer: a **"Stamp"** toggle (the off state), then **"Stamp spacing"** and **"Stamp hardness"** sliders, shown only while the toggle is on. The existing "Spacing" slider keeps its name and its meaning (sample density) — the toggle removes the need for a "0 % = Off" sentinel on a percentage slider, and the two meanings cannot be confused because one is a toggle and the other is a slider. | One toolbar file changes; `README.md` and `docs/ARCHITECTURE.md` wording updates; the "Spacing is sample density, not stamp spacing" sentence stays true and the UI now shows it as a separate control. *(Superseded the earlier "rename Spacing → Sampling" answer — see §18, C10.)* |
| **Q3** | Does a stamped brush's **fill-shape interior** get stamped dabs, or stay a flat polygon fill? | **Shapes keep the segment path entirely** (see Q7), so the interior stays a flat polygon fill and the outline stays a segment trace. There is no mixed case in S1. | `beginShape` stores zero-valued stamp fields (§3, row 6). This also keeps the polygon fill out of the coverage map: mixing a canvas-drawn polygon fill with `putImageData` tile uploads would corrupt the buffer, because `putImageData` **replaces** pixels rather than compositing them. |
| **Q4** | Is `spacing` provably non-appearance-changing under the chosen dab placement? | **Yes under the chosen placement, and it must be tested rather than assumed.** Dabs are placed by **arc length along the polyline of the stored samples**, and `StrokeBuilder.addSample` interpolates **linearly** along the straight line between raw samples (`strokeBuilder.ts` L149–160), so the arc-length-parametrised path — and therefore the dab positions and their pressures — is invariant to the sample density. The caveat the analyst names is real (`addSample` drops a raw point closer than `MIN_SAMPLE_DISTANCE` = 0.05 px), so the test must use densities above that floor. | `spacing` stays **non-appearance-changing**, so changing it never needs a format bump, and the new field keeps its own name. The proof is a test, not a comment (§11, "sample-density invariance"). |
| **Q5** | How is the per-dab union/max coverage realised in Canvas 2D without a fourth full-resolution surface? | **A footprint-bounded coverage cache in JavaScript, uploaded into the existing stroke buffer.** 1 byte per device pixel over the stroke's *inked* area (64×64 tiles, lazily allocated), then `putImageData` into the stroke buffer the renderer already owns. A document-sized coverage surface is **rejected**: it would be a fourth full-resolution surface (74 bytes per document pixel → 1.16 GiB at the cap), which the audit's §10.3 forbids. A GPU coverage canvas is rejected for the same budget reason plus the conversion cost (§13.3). A "no-cache" variant (recompute the union per event) is the fallback if the coordinator refuses the coverage cache at all (§9.3). | The **documented 58 B/doc-pixel envelope holds** (worst case 56, 896 MiB): the cache is a transient that fits inside the model's existing 10 B/doc px transient allowance, so the headroom falls from 10 to 2 B/doc px rather than the envelope growing (§9.3, `docs/memory-budget-review.md` §4.2). |
| **Q6** | Does the union rule apply to the **eraser** too, and does `destination-out` against a union-ed buffer behave? | **Yes.** The eraser subtracts the same union-ed buffer with `destination-out` (`applyErase` L1205–1224). A union-ed buffer has a different alpha profile from a source-over-accumulated one: at a crossing, the coverage is the single-dab coverage, so the eraser erases that path **once**, exactly like the segment path's snapshot discipline. | The existing eraser pixel tests (`canvas2dRenderer.test.ts` L591–812) are re-run with a stamped eraser; the "crossing erases once" expectation must hold for a stamped stroke. |
| **Q7** | Is the stamp engine allowed to change the **shape tools'** output? | **No, in S1.** Shapes keep the segment path, and the shape's stroke record stores `stampSpacing: 0` and `stampFalloff: 0`, so the file states what was drawn. This follows the `stabilizer` precedent (brush/eraser only) and keeps the roadmap's "default unchanged" bar trivially true for every shape tool. | `beginShape` changes; nothing else. A future slice may revisit it, but then the filled-shape interior question (Q3) must be answered first. |
| **Q8** | What is the **dab budget** per stroke? | **A deterministic truncation, not a spacing change.** The planner stops adding dabs once a fixed budget of dab work is spent, plus a floor of `MIN_STAMP_SPACING_PX = 0.5` document px on the spacing. The truncation is expressed as a **lattice index** (dab *k* is at arc length *k* × spacing), which makes it stable under path growth: the first *K* dabs are the same ones whether the path has 10 samples or 10 000, so the live path and the rebuild path truncate identically and **live == commit** survives. A budget expressed as "spacing grows with the path length" would *not* survive that: the live preview would re-space its dabs as the stroke grows. | The cap is a named constant with a test (§11, "guards"), and the truncation is documented in `docs/ARCHITECTURE.md` as a rendering limit. ❌ **Not implemented yet** — and it is the highest-priority gap, because the file format does not bound the path length (§9.2, `docs/memory-budget-review.md` §5.4). |

---

## 3. Current modules to touch (exact paths)

| # | Path | What changes | Size of the change |
| --- | --- | --- | --- |
| 1 | **new** `src/core/rendering/stampCoverage.ts` | Pure, canvas-free stamp engine: the dab lattice along the sample polyline, the dab coverage profile, and the tiled coverage accumulator. *(This is the name the implementation uses; the plan originally said `stampRaster.ts`.)* | ~250 lines, new file |
| 2 | `src/core/rendering/Canvas2DRenderer.ts` | Route stamp strokes to the new path in `beginStroke` (L279), `extendStroke` (L295), `replaceStroke` (L336), `endStroke` (L347), `cancelStroke` (L383), `rasterizeStrokeToBuffer` (L879); own the per-active-stroke stamp state; release it with the other scratch state (`dropPreviewSurface` L1275, `clearStrokeBuffer` L1287, `setDocument` L218, `setRasterScale` L259). | ~120 lines changed |
| 3 | `src/types/brush.ts` | Add the stamp fields to `BrushSettings` (L11–68) with the contract in §1.1. **As implemented:** `stamp: boolean` (off = the segment path), `stampSpacing: number` (0.02–1, the dab distance as a fraction of the brush size) and `stampHardness: number` (0–1, the dab's radial falloff). | ~25 lines |
| 4 | `src/core/brushes/defaults.ts` | `DEFAULT_BRUSH` (L15) gains `stampSpacing: 0`, `stampFalloff: 0`; `normalizeBrush` (L29) clamps them; `brushSettingsEqual` (L52) includes them (they are brush identity). **Missing either of the latter two is a silent failure** (Feature Analysis §5.8). | ~12 lines |
| 5 | `src/core/project/projectFormat.ts` | `PROJECT_VERSION` 8 → 9 (L87); `readBrush` (L686) requires the two fields from v9 and defaults them to `0` for v1–v8; the version-history comment block (L44–87) gains the v9 entry. The serializer needs no change — `serializeElement` (L425) already writes `element.brush` wholesale, so the new fields are emitted with every stroke. | ~30 lines |
| 6 | `src/core/engine/DrawingEngine.ts` | `beginShape` (L1106) stores shape strokes with the stamp fields zeroed (Q3/Q7); no other engine change — `beginStroke` (L1056) and `extendStroke` (L1085) already pass the whole `StrokeRecord` to the renderer, and `setBrush` (L836) already publishes the whole `BrushSettings`. | ~6 lines |
| 7 | `src/features/brushes/BrushControls.tsx` | Two real sliders (no placeholders): "Stamp spacing" (off = the segment path) and "Stamp hardness"; the existing "Spacing" slider is relabelled "Sampling" (Q2). | ~40 lines |
| 8 | `src/utils/color.ts` | No change expected — `hexToRgb` (L40) resolves the brush colour for the coverage image; a non-hex CSS colour needs one extra resolver (§7.3). | 0–10 lines |
| 9 | **new** `src/test/stampCoverage.test.ts` | Unit tests for the pure module (§11). | ~300 lines |
| 10 | `src/test/canvas2dRenderer.test.ts` | The stamp path's renderer contract, including the **pixel** proofs (§11). `PixelCanvas` already implements `createImageData` (L1935), `putImageData` (L1943) and `getImageData` (L1965), so a coverage upload is verifiable at the pixel level. | ~150 lines |
| 11 | `src/test/projectFormat.test.ts` | v9 round trip, v1–v8 defaults, v9 rejection of a missing field (§11). | ~90 lines |
| 12 | `src/test/brushSettings.test.ts` | Defaults, clamps, brush identity (§11). | ~25 lines |
| 13 | `src/test/drawingEngine.test.ts` | A stamped stroke is one undo step; the brush is captured per stroke; the shape's stamp fields are zero. | ~50 lines |
| 14 | `src/test/support/recordingCanvas.ts` | `putImageData` is recorded (L30) but stores no pixels, and `getImageData` (L112) returns a canned buffer. The stamp path must therefore **never read canvas pixels back** — it is designed that way (§8.3) — but the recorded `putImageData` argument must be inspectable, so `RecordingCanvas` may need to keep the `ImageData` it was handed (one extra field). | ~10 lines |
| 15 | `src/test/canvas2dRenderer.test.ts` (harness comment) | The stale header comment at L1457–1459 ("Stroke rasterization … is deliberately a no-op") contradicts the implementation (Feature Analysis §9.3). Fix the comment in this slice so the next reader is not misled about the harness's capabilities. | 3 lines |
| 16 | `docs/PROJECT_FORMAT.md` | §`brush` (L335) documents the two fields; §`Versioning` (L417) gains the v9 rationale. | prose |
| 17 | `docs/ARCHITECTURE.md` | A "Stamp engine" subsection under the rendering pipeline; the union invariant; the footprint rule; the dab truncation limit. | prose |
| 18 | `docs/ROADMAP.md`, `docs/SESSION-BRIEF.md`, `docs/HANDOFF.md`, `README.md` | Phase 3 progress, key files, next slice, feature prose. | prose |
| 19 | `docs/PERFORMANCE_AUDIT_2026-10-20.md` | The raster budget stays **58 B/doc px**; record that the coverage cache consumes up to 8 B/doc px of the transient allowance (2 B/doc px of slack left) and that the upload buffer must stay bounded (§9.3). | prose |
| 20 | `AGENTS.md` | §5 gains a row for `stampCoverage.ts` and its symbols; §8 gains the new test file. The drifted line anchors the Feature Analysis flags (§9.5) should be refreshed in the same commit — `AGENTS.md` says "if `rg` disagrees, fix the anchor". | 2 rows + anchors |

**Not touched, deliberately:** `src/core/document/types.ts` (no new element kind —
stamps are a rasterization strategy, not content), `src/core/commands/*` (a stamped
stroke is an ordinary stroke command), `src/core/brushes/strokeBuilder.ts` (the
sample capture is unchanged; the stamp engine is downstream of it),
`src/core/rendering/types.ts` (the `DrawingRenderer` interface is unchanged — the
boundary stays intact), `src-tauri/**` (no native work, no IPC), and the whole
React layer beyond one toolbar file.

---

## 4. Data flow

```
pointer sample
   │  (unchanged)
   ▼
StrokeBuilder.addSample            src/core/brushes/strokeBuilder.ts
   │  samples: xs/ys/pressures/times  (unchanged, still the authority)
   ▼
DrawingEngine.extendStroke          src/core/engine/DrawingEngine.ts L1085
   │  renderer.extendStroke(stroke, fromIndex)
   ▼
Canvas2DRenderer.extendStroke       src/core/rendering/Canvas2DRenderer.ts L295
   │
   ├── legacy (stampSpacing === 0) ──► rasterizeStroke()  canvas2dStroke.ts L151
   │                                    (unchanged, byte-identical)
   │
   └── stamp (brush.stamp === true) ──► stampDabs()   src/core/rendering/stampCoverage.ts
        │  · arc-length lattice over the sample polyline:
        │    dab k sits at arc length k · stampSpacing · diameter
        │  · radius from strokeDiameter(brush, pressureAt(s))
        ▼
      StampCoverage (tiles of 64×64 device px, Uint8Array, per-pixel MAX)
        │  · addDab(): union into the touched tiles
        ▼
      ImageData (RGB = brush colour, A = coverage) per touched tile
        ▼
      strokeCtx.putImageData(...) into the *existing* document-sized stroke buffer
        ▼
      paintStrokeCoverage / compositeStrokeBuffer   (unchanged)
        ▼
      layer surface / preview group / PNG export     (unchanged)
```

The **only** new edge in this diagram is the dashed one: *samples + brush → dabs →
coverage → the same stroke buffer the renderer already had*. Every downstream
stage — feather, grain, preview compositing, commit, erase subtraction, rebuild,
export — is untouched, which is what keeps the slice small.

---

## 5. APIs and interfaces

### 5.1 The new pure module (`src/core/rendering/stampCoverage.ts`)

It must not import the DOM, the renderer or React: it takes plain numbers and
returns plain data, so it is unit-testable in Node with the existing Vitest setup
(`pnpm test`) and free of the `RecordingCanvas` limitations.

```ts
/** Smallest distance between two dab centres, in document pixels. */
export const MIN_STAMP_SPACING_PX = 0.5;
/** Edge length of one coverage tile, in device pixels. */
export const COVERAGE_TILE_SIZE = 64;

/** The distance between two dab centres, in document pixels. */
export function stampSpacing(brush: BrushSettings): number;

/** One dab, in document pixels. */
export interface StampDab {
  readonly x: number;          // document px
  readonly y: number;          // document px
  readonly radius: number;     // document px
}

/** The part of a stroke the dabs are placed along. */
export interface StampPath {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  readonly pressures: readonly number[];
}

/**
 * The dabs a stroke's path produces.
 *
 * A pure function of (samples, brush): the same inputs always give the same dabs.
 * The dabs are a lattice from the path start - dab k sits at arc length
 * k * spacing - so an incremental append can find the phase at the join (the
 * arc length already consumed), and a truncation guard stays stable as the path
 * grows.
 */
export function stampDabs(path: StampPath, brush: BrushSettings): StampDab[];

/** Coverage of one dab at a given distance from its centre, in [0, 1]. */
export function stampDabCoverage(distance: number, radius: number, hardness: number): number;

/**
 * Per-pixel union of dab coverage, in device pixels.
 * Tiles are allocated lazily, so the cost follows the inked area, not the document.
 */
export class StampCoverage {
  /** Unions one dab in; returns the device rect the dab can reach. */
  paintDab(centerX: number, centerY: number, radius: number, hardness: number): StampRect | null;
  /** Writes a rectangle's coverage into an RGBA buffer (colour + coverage alpha). */
  writeRect(data: Uint8ClampedArray, dataWidth: number, rect: StampRect, rgb: Rgb): void;
  /** Releases every tile, so the map can be reused for another stroke. */
  clear(): void;
}
```

*(This sketch is the API the implementation actually has, in
`src/core/rendering/stampCoverage.ts`; the plan originally sketched
`planDabs`/`addDab`/`toImageData`/`reset` under the name `stampRaster.ts`.)*

`stampDabs` is the contract that makes the feature reproducible: it is the *only*
place that decides where a dab goes, so the live path and the rebuild path cannot
disagree.

### 5.2 The renderer contract that must not change

`src/core/rendering/types.ts` (`DrawingRenderer`, L46–108) is untouched. The stamp
engine is a **strategy inside** `Canvas2DRenderer`, selected by the stroke's brush,
exactly like the hardness feather and the grain pass are selected today. This is
what keeps the "renderer replaceable later" promise: a WebGL backend would
implement the same `DrawingRenderer` and would need its own dab rasterizer, but
Paka's document, format, history and UI layers would not change.

### 5.3 The brush contract

```ts
export interface BrushSettings {
  // … existing fields unchanged …
  /** Whether the stroke is rasterized as a chain of dabs instead of segments. */
  readonly stamp: boolean;
  /** Distance between dab centres, as a fraction of the brush's nominal size. */
  readonly stampSpacing: number;
  /** Radial falloff of one dab, in [0, 1]. */
  readonly stampHardness: number;
}
```

Both are read **from the stroke's own brush**, never from editor state, so a
reopened file renders what it was drawn with. Both are primitives, so the shallow
copies in `createStrokeRecord` (L55) and `cloneStroke` (L77) stay safe — the
Feature Analysis §5.7 flags aliasing as latent for *non-primitive* stamp fields
(a stamp image descriptor, a profile array), which S1 does not introduce.

---

## 6. State, history and gesture semantics

| Concern | Behaviour in S1 | Why |
| --- | --- | --- |
| Editor state | `stampSpacing` / `stampFalloff` are ordinary brush settings: set via `setBrush` (L836), published in the `EditorSnapshot`, **not** undoable and **not** dirtying the document (same as `spacing`, `hardness`, `texture`). | The brush describes the *next* gesture; the committed stroke keeps the values it was drawn with. |
| Gesture | One press–move–release = one stroke = **one undo step**, exactly as today. No new command type: `createStrokeRecord` copies the brush into the record (`strokeBuilder.ts` L46). | I4. |
| Preview | The live preview keeps the same pipeline: the coverage lands in the stroke buffer, and `paintDocument` (L628) composites the buffer inside the stroke's own layer, honouring that layer's visibility, opacity and blend mode. | The live-preview compositing slice (`e1071d9`) must not regress. |
| Commit | `endStroke` (L347) composites the buffer onto the layer surface once, at the stroke's opacity. | One alpha per stroke. |
| Cancel | `cancelStroke` (L383) clears the buffer and **releases the stamp coverage cache**; no history, no revision bump, no dirty flag. | The cancel path must leave no trace. |
| Undo / redo | Undo removes the stroke from the store and invalidates the layer; the layer is rebuilt by re-running the same pure planner over the same samples → identical pixels. | The union is a pure function; nothing is cached in the document. |
| Layer change during a gesture | Still refused (`refuseLayerChangeDuringGesture`, L1015). | Unchanged. |
| Save / load | The stroke record carries the brush; the file format carries v9 (§7). | The record is the authority. |
| Export | `composeDocumentImage` (L511) rasterizes the layers through the same path, so an exported stamp is the same union at export resolution. | No special case. |

---

## 7. Serialization changes

### 7.1 The format bump

`PROJECT_VERSION` 8 → **9** (`src/core/project/projectFormat.ts` L87). See Q1 in
§2.3 for the reasoning and the rejected additive alternative.

### 7.2 The field rules

| Field | v1–v8 | v9 |
| --- | --- | --- |
| `stampSpacing` | absent → `0` (legacy segment path, byte-identical to today) | **required**, number in `[0, 2]` |
| `stampFalloff` | absent → `0` (hard dab edge) | **required**, number in `[0, 1]` |

Required (not additive-with-default) because the value changes the pixels and
because the serializer already writes the whole brush object (`serializeElement`,
L425), so every v9 file carries both fields with no extra plumbing. The precedent
is `hardness` from v6 and `texture` from v7 (`readBrush` L696–717).

### 7.3 The brush colour in the coverage image

The coverage image needs RGB numbers, but `brush.color` is a CSS colour string.
`hexToRgb` (`src/utils/color.ts` L40) covers every colour the app produces (the
picker writes hex via `rgbToHex`, `DrawingEngine.ts` L833). A hand-written file
with a non-hex CSS colour is accepted by today's parser, so the stamp path needs a
fallback that is **exact, not approximate**: resolve it once through a 1×1 canvas
probe and cache the result per colour string. If neither resolves, the stroke
falls back to the legacy segment path rather than painting the wrong colour — the
fallback is deterministic and documented.

### 7.4 Migration and defaults

No migration is needed: v1–v8 files keep their exact rendering because the new
fields default to `0` (legacy path). A v9 file written by this build reads back
identically. The history in `projectFormat.ts` L44–87 gains a v9 paragraph
explaining the union semantics and the version bump.

---

## 8. Rendering and compositing interaction

### 8.1 What stays exactly as it is

- `rasterizeStroke` (`canvas2dStroke.ts` L151) — untouched; it is the legacy path.
- `strokeDiameter` (L82), `strokeOpacity` (L97), `strokeFeatherRadius` (L43),
  `textureCoverage` (L65) — untouched; they are read from the stroke's brush and
  mean the same thing in both paths.
- `compositeStrokeBuffer` (L961) and `paintStrokeCoverage` (L997) — untouched.
  They composite the buffer at the stroke's opacity and apply the feather and the
  grain, whatever produced the buffer.
- `strokeRegion` (L935) / `strokeSampleBounds` (L908) — untouched. A dab's radius
  equals the brush radius, so the inked rectangle a stamp can reach is the same
  rectangle the legacy path inks. The feather pad (`radius * 3`) already covers
  the soft rim. **But see §8.7 — this is a hard rule, not an accident.**

### 8.2 The new path, step by step

1. **Plan.** `stampDabs(path, brush)` walks the polyline
   (`xs`/`ys`/`pressures`) and returns the dabs on a lattice measured from the
   path start: dab *k* sits at arc length `k · stampSpacing · size`. The arc
   length is measured on the *same* polyline the legacy path strokes, so both
   engines describe the same curve, and the spacing is a fraction of the brush's
   **nominal size**, so the dab positions do not follow the pressure-varying
   diameter.
2. **Union.** Each dab is rasterized analytically into the coverage tiles:
   per device pixel, `coverage = max(existing, stampDabCoverage(distance, radius, hardness))`.
   The profile: with `hardness = 1`, the dab is opaque inside `radius - 0.5` and
   falls to zero at `radius + 0.5` (a crisp edge with a one-pixel rim); with a
   lower hardness, the opaque core shrinks and the falloff widens towards the
   centre — a true hardness curve, whose coverage never reaches past the dab's
   radius (§8.7).
3. **Upload.** The coverage is written into the **existing document-sized stroke
   buffer** with `putImageData`, in device pixels (`putImageData` ignores the
   context transform, exactly like `strokeRegion` works in device pixels).
   `putImageData` **replaces** pixels rather than compositing them, which is
   what the union needs. ⚠ **The upload must be bounded.** The implementation
   currently creates one `ImageData` for the whole dirty rectangle
   (`Canvas2DRenderer.ts` L1034), which in the rebuild path is the stroke's
   bounding box — up to **256 MiB** at the cap, i.e. a full-resolution
   allocation the budget model does not allow. Upload per coverage tile (64 × 64
   → 16 KB) or per band of tiles instead; see
   `docs/memory-budget-review.md` §4.4 and §8.
4. **Composite.** Unchanged.

### 8.3 Why the coverage is computed in JavaScript and not on the GPU

This is the decision the slice turns on, so it is worth stating the reasoning.

- **Canvas 2D has no "max" blend for alpha.** `lighten` blends *colour* channels;
  alpha still composites source-over, so two overlapping 50 % dabs would give
  `0.75`, not the union's `0.5`. There is no composite operation that unions
  alpha. The union therefore has to be computed explicitly — and that is exactly
  what the coverage map does. (The Feature Analysis §5.3 reaches the same
  conclusion independently.)
- **The GPU alternative needs a conversion anyway.** A GPU path would draw the dabs
  into an opaque coverage canvas (colour = coverage) and then convert luminance
  into alpha — Canvas 2D has no luminance-to-alpha filter, so that conversion is a
  JavaScript pixel pass anyway, over the whole stroke's rectangle, on every
  rebuild.
- **The GPU path needs a second full-resolution surface**, which breaks the
  documented raster budget (58 bytes per document pixel, 928 MiB at the cap —
  `docs/PERFORMANCE_AUDIT_2026-10-20.md` F5 and Feature Analysis §10.3).
- **The GPU path is not pixel-testable in this repository.** `RecordingCanvas`
  (`src/test/support/recordingCanvas.ts`) records calls but rasterizes nothing, so
  a sprite-based dab could only be tested for *call shapes*, never for pixels. The
  coverage map is plain typed data, and `PixelCanvas` implements `putImageData`
  (L1943) and `getImageData` (L1965), so the whole chain is verifiable at the
  pixel level in Node.

The cost of this choice is the JS pixel work; it is bounded and measured in §9.

### 8.4 Incremental drawing (the stateless-contract hazard, Feature Analysis §5.2)

`extendStroke(stroke, fromIndex)` receives the index of the first new sample.
`rasterizeStroke` is **stateless** — given a `fromIndex` it can reproduce the tail
of the segment path. **Dab placement is not stateless**: the position of the next
dab depends on where the last one was, and the dab that straddles the join
between the drawn part and the newly appended part is not recoverable from
`fromIndex` alone.

The fix is the **lattice**: dab *k* sits at arc length `k · spacing` measured from
the path start, so a dab's position depends only on the prefix of the path up to
that arc length — and the prefix is immutable (the samples are append-only during
a stroke). The renderer therefore keeps, for the active stroke, the arc length
already consumed and the coverage tiles; on each extend it plans only the dabs
beyond that arc length and unions only those.

Two invariants make this exact:

- The sample polyline is **append-only** during a stroke, so the arc-length
  parametrization of the prefix never changes → a dab's position never changes.
- The coverage tiles hold the **union**, so re-uploading a tile writes the union
  value, not the new dab's contribution alone.

Callers that must reset the cursor: `extendStroke` with `fromIndex <= 1` (the
redraw branch), `replaceStroke` (shapes — not used by stamps in S1, but the reset
must exist), and `rasterizeStrokeToBuffer` (a rebuild plans from `fromArc = 0`).

### 8.5 The eraser (Feature Analysis Q6, §5.6)

An eraser stroke is the same union, written into the same buffer, and subtracted
from the layer with `destination-out` (`applyErase`, L1205). The erase path
rebuilds the layer from its snapshot on every update, so the buffer must hold the
complete union at every update — which the tile cache guarantees.

Note the asymmetry the analyst flags: the **live** erase subtracts the whole
buffer (`paintStrokeCoverage` without a region), while the **rebuild** erase is
region-bounded (`compositeStrokeBuffer` with a region). They agree today because
the region is a superset of the coverage by construction — which is exactly what
§8.7 preserves.

### 8.6 Shapes

`beginShape` (`DrawingEngine.ts` L1106) creates the shape's stroke record with
`stampSpacing: 0` and `stampFalloff: 0`, so a rectangle drawn with a stamped
brush is rasterized by the legacy segment path and the file records that (Q3, Q7).

### 8.7 The footprint rule (Feature Analysis §5.1 — CRITICAL)

`compositeStrokeBuffer` composites **only** the rectangle `strokeRegion(stroke)`,
and the region is derived from `strokeSampleBounds`:

```
spread = strokeDiameter(brush, 1) / 2 + strokeFeatherRadius(brush) * 3 + 1
bounds = samples ± spread
```

but the **live preview** draws the **whole** buffer (`paintDocument` L670 →
`paintStrokeCoverage` without a region → `drawImage(strokeBuffer, 0, 0, doc.width, doc.height)`).

**Consequence:** any coverage outside `strokeSampleBounds` is visible while
drawing and gone after the release — a silent live/commit divergence, and the
rebuild and export paths then disagree with each other in a different way.

**Therefore the rule is: a dab's coverage must stay inside `strokeSampleBounds`.**
With the S1 profile (a disc of radius *r* = the brush radius, plus a half-pixel
antialiasing ring) the coverage extends at most 0.5 px beyond *r*, and the
bound's spread is `r + featherRadius × 3 + 1` — satisfied with ≥ 0.5 px to spare.

This is not an accident, it is a constraint the module must state and test:

- The S1 dab profile is **centred** on the path with radius = the brush radius.
  It is deliberately *not* an elongated, offset or bristle-like stamp.
- Any future dab shape that exceeds the brush radius **must** widen
  `strokeSampleBounds` **and** the feather's pad together — otherwise the
  live/commit divergence reappears. That rule belongs in the module's doc comment.
- The proof is the existing helper `coverageInside` (`canvas2dRenderer.test.ts`
  L2423–2440): for a stamped stroke, every covered pixel must lie inside the
  padded sample bounds.

### 8.8 The start ring (Feature Analysis §5.12)

The legacy path redraws the whole stroke when `fromIndex <= 1` because the initial
single-sample dab would otherwise be overdrawn by the first segment's round cap —
"it is a second pass of antialiasing exactly at the start, so the live buffer
would differ (by up to a few levels, on the start ring) from what undo, reopen and
export produce" (L306–313). The existing test guards it
(`canvas2dRenderer.test.ts` L378–414).

In the stamp path the first dab **is** the first lattice dab, so the duplicate
becomes harmless (a union of the same coverage). The special case may therefore
disappear — but it must be **re-derived, not assumed**: the safe choice is to keep
the full redraw for `fromIndex <= 1` (it is cheap and it is the branch the
existing test already exercises), and to let the parity test prove the start ring
matches.

### 8.9 The single-dab special case

`rasterizeStroke` L169–182 deposits one dab for a one-sample stroke and returns.
In the stamp path, a one-sample stroke is simply "one lattice dab at arc length
0" — the same contract, expressed in the new vocabulary. The existing test
("deposits a single full-coverage dab for a press without movement") must stay
green for the legacy path and gain a stamped twin.

---

## 9. Performance and memory strategy

### 9.1 The cost model

Per dab, the union touches the dab's bounding box: `O(r²)` device pixels, where
`r` is the dab radius in device pixels (`radius_doc × rasterScale`). Over a stroke
of path length `L` with spacing `k · diameter`:

```
dabs          ≈ L / (k · 2r_doc)
pixel work    ≈ dabs · (2r_device)²   =   O(L · r_device² / (k · r_doc))
```

Two consequences the implementer must respect:

- The work is **quadratic in the brush radius** and **linear in `rasterScale²`**.
  A 512 px brush at `rasterScale = 2` is ~1000 device pixels across → a million
  pixels per dab.
- The work is **independent of the spacing** below the point where the dabs stop
  overlapping: denser spacing repeats work over already-saturated pixels.

The Feature Analysis's worst case (§10.1) is the same arithmetic: a 4096 px
document with a 512 px brush at 2 % spacing is ~400 dabs per stroke; at the
0.75 px sample floor it is ~5 461; a layer of 100 such strokes rebuilds to
~546 000 dab writes per undo.

### 9.2 The guards (all deterministic, all identical in the live and rebuild paths)

| Guard | Rule | Why | Status |
| --- | --- | --- | --- |
| Minimum spacing in document pixels | `max(MIN_STAMP_SPACING_PX = 0.5, size · stampSpacing)` | Stops a 1 px brush from asking for thousands of dabs per pixel. | Implemented (`stampCoverage.ts` L35, L72–74) |
| Maximum spacing | `stampSpacing ≤ 1` (fraction of the brush size) | A spacing above the diameter is a dotted line; the UI caps it there. | Implemented (`defaults.ts`, `MIN/MAX_STAMP_SPACING`) |
| **Per-stroke dab budget (Q8)** | The planner stops adding dabs once a fixed budget of dab work is spent, expressed as a **lattice index** so it is stable under path growth and identical in the live and rebuild paths | **The path length in a project file is not bounded** — `readSampleArray` (`projectFormat.ts` L681–697 at the reviewed tree) only checks that samples are finite numbers — so a legal file can ask for billions of dabs and exhaust memory on open. The legacy segment path is not affected (its region is clamped to the buffer), so this is a **new** failure mode the stamp path introduces. | ❌ **Not implemented.** This is the highest-priority gap; see `docs/memory-budget-review.md` §5.4. **The design that closes it is §19.3–§19.4** (three runtime bounds in the planner; the work budget's *value* is left unresolved pending a latency target and one packaged-app measurement). |
| Saturation short-circuit | A pixel already at `255` is skipped; a tile whose pixels are all `255` needs no work | A big brush over its own interior does no work. | Partly implemented (`stampCoverage.ts` L211–214, per pixel) |

The guards are part of the *rendering*, not of the file: the same samples always
produce the same dabs, so nothing about them needs to be serialized.

### 9.3 The raster budget (Feature Analysis §10.3 — hard constraint)

> ⚠ **Corrected 2026-10-20 after `docs/memory-budget-review.md`.** This section
> originally claimed the peak moves from 58 to **62** bytes per document pixel.
> **That was wrong.** The arithmetic added the coverage cache to the model's
> transient allowance instead of *inside* it. The evidence is in the review
> (§4); the correction is summarised here.

The documented peak is **58 bytes per document pixel** (`src/core/document/document.ts`
L69–74): three 2× RGBA surfaces (48 B/doc px) plus **one** transient allowance of
10 B/doc px for a bucket scan (whose composite `ImageData`, visited bitmap, mask
and stack are ~10 B/doc px; the 1× export composite is 4 and is covered by it).
The audit records that a previous attempt at exactly the "extra scratch" shape
(the element-scratch variant F7) was **reverted** (`2fa34cc`) partly because it
"would have moved the documented raster budget from 58 to 59 bytes per document
pixel".

The coverage cache is **not** a fourth full-resolution surface: it is 1 byte per
**device** pixel over the stroke's own footprint, i.e. **≤ 4 bytes per document
pixel** at the budgeted scale of 2, and it is a *transient*. The model's
structure is *"three surfaces + one transient"*, so the cache belongs **inside**
the 10 B/doc px allowance, not on top of it.

**The corrected peak, per scenario** (4096 × 4096, `rasterScale = 2`):

| Scenario | Surfaces | Scan buffer | Coverage tiles | Upload | **Peak** |
| --- | --- | --- | --- | --- | --- |
| Bucket fill | 32 | 10 | ≤ 4 (resident scratch) | 0 | ≤ 46 B/doc px (736 MiB) |
| Stamped brush stroke | 32 | 0 | ≤ 8 (in-flight + scratch) | 0 | ≤ 40 B/doc px (640 MiB) |
| Stamped eraser stroke | 48 | 0 | ≤ 8 | 0 | **≤ 56 B/doc px (896 MiB)** |
| Stamped stroke + grouped preview | 48 | 0 | ≤ 8 | 0 | **≤ 56 B/doc px (896 MiB)** |
| Layer rebuild of stamped elements | 32 | 0 | ≤ 4 | ≤ 16 | ≤ 52 B/doc px (832 MiB) |

**Conclusion: the documented 58 B/doc-pixel envelope holds** (worst case 56,
896 MiB, inside the 1 GiB budget) and **does not need to change**. What changes
is the *headroom*: the transient allowance drops from 10 B/doc px of slack to
**2 B/doc px**, which is a planning fact for the next feature (masks, groups,
tiles).

**The one allocation that breaks it.** The rebuild path's upload buffer must be
bounded. As implemented, `writeStampCoverage` creates one `ImageData` for the
whole dirty rectangle (`Canvas2DRenderer.ts` L1033), which in the rebuild path
is the stroke's bounding box — up to **256 MiB** at the cap. It fits the
envelope only because a rebuild normally happens with no gesture in flight; a
rebuild that coincided with a grouped preview would reach 72 B/doc px
(1152 MiB) and leave the budget.

**The design that closes it is §19.2**: upload **per coverage tile** (64 × 64
device px, one reused 16 KiB `ImageData`), which bounds the temporary
allocation to ≤ 80 KiB and brings the worst case — including the rebuild
scratch and the grouped preview coexisting — to **≤ 56.005 B/doc px (896 MiB)**
(§19.5). See `docs/memory-budget-review.md` §4.3–§4.4 and §11.

**What must be re-documented** (in the same commit):

- `docs/PERFORMANCE_AUDIT_2026-10-20.md` F5 and `docs/SESSION-BRIEF.md` §6:
  the peak stays **58 B/doc px**; add that the coverage cache consumes up to
  **8 B/doc px of the transient allowance** (in-flight map + resident scratch),
  leaving 2 B/doc px of slack, and that the upload buffer must stay bounded.
- The coverage tiles are **JS heap**, not canvas backing stores, so they sit
  outside the model's stated scope ("calculable backing-store pixels",
  `document.ts` L57–59). Say so in `docs/ARCHITECTURE.md` next to the budget
  rather than changing the constants, so the model's scope stays true.

### 9.4 Latency

The dab plan runs in the renderer, on the pointer event's thread, outside React.
Per pointer event the work is the *new* dabs only (§8.4) — typically a handful of
dabs. The re-upload is bounded by the tiles the new dabs touched. **No pointer
sample crosses into React state, and no IPC round trip is introduced.**

### 9.5 Garbage collection

The hot path allocates: the dab list (a small array per event) and one `ImageData`
per changed tile. The coverage tiles are `Uint8Array`s reused between strokes
(`reset()` clears the map but keeps the arrays for reuse). No per-sample objects —
the same discipline the sample arrays already follow (`document/types.ts` L66–74).

### 9.6 What must be measured before the next slice

Per `docs/PERFORMANCE_AUDIT_2026-10-20.md` F7e, harness timings do not transfer.
The implementer must measure, in the **packaged app** (Appendix C recipe):

1. The time to draw a 2000 px stroke with `stampSpacing = 0.1` at size 8 and at
   size 128, at `rasterScale` 1 and 2.
2. The time to rebuild a layer of 100 stamped strokes (this is the path that pays
   the full union cost, unlike the live path).
3. The peak memory of the coverage cache for a document-wide stroke.
4. **Whether `putImageData` into the document-sized stroke buffer triggers the
   F7b whole-canvas cost.** `putImageData` is a bulk CPU-side write into the
   same buffer the legacy path draws with incremental GPU calls, so the cost
   profile may differ. This is the reason to measure with rAF deltas (no
   `getImageData` sync) per the audit's Appendix C.
5. **Whether the upload granularity matters**: per tile versus per dirty rect,
   measured as the rebuild time of a layer of document-wide stamped strokes.

All five are measurements in the packaged app; none of them is a harness number.

These numbers decide whether the deferred native/WASM option (§2.2) ever becomes
worth it. They do **not** block S1.

---

## 10. Dependency changes

**None.** `package.json` stays exactly as it is: React 19, `@tauri-apps/api`,
`@tauri-apps/plugin-dialog`, and the same dev tooling. This is a deliberate
property of Strategy 3 and it is worth preserving: Paka's only runtime
dependencies today are the UI framework and the Tauri bridge, and the bundle
stays small.

Checks performed before recommending "no dependency":

| Check | Result |
| --- | --- |
| License | No third-party code is used, so no third-party licence obligation is created by this slice. Paka is MIT (`docs/g1/feature-evidence.json`), so a GPL derivation would have been incompatible. Confirmed by the licence gate (`docs/g1/reuse-decision.md`, `docs/g1/provenance-record.json`), which also records the clean-room condition the work is built under — see `docs/CLEAN-ROOM-ATTESTATION.md`. |
| Maintenance | Nothing to maintain beyond Paka's own code. |
| Target platforms | Pure TypeScript — the same Windows/macOS/Linux/WebView2 target set as the rest of the app, with no per-platform build. |
| Size | No bundle growth. |
| Security | No new network, filesystem or native surface. |

---

## 11. Tests (written before the code)

The repository's rules: "every new behaviour gets a regression test with it",
written against the behaviour, not the implementation; the React layer has no
automated tests and is verified in the running app.

The Feature Analysis already proposed a 32-row acceptance matrix (T-01 … T-32).
This plan **adopts it** and adds the rows the analysis could not specify without
the architecture decisions of §2.3. `docs/acceptance-criteria.json` is the
merged, machine-readable form.

### 11.1 `src/test/stampCoverage.test.ts` (new, pure module)

| Test | Assertion | From |
| --- | --- | --- |
| dab placement | Dabs are spaced `stampSpacing · diameter` apart along the polyline; the first dab is at the first sample; the recorded positions are exact. | T-05, T-06 |
| placement follows the path, not the sample grid | The dab at a bend carries the path's tangent; the dab count is `ceil(pathLength / spacing) + 1`. | T-07, T-31 |
| pressure | The dab radius follows `strokeDiameter(brush, pressure)` at the dab's arc position. | new |
| **sample-density invariance** | The same raw path captured at two different `spacing` values (sample density) yields the **same dab plan and the same coverage**. This is the test that turns Q4's derivation into a guarantee. | Q4 |
| union, not sum | Two overlapping dabs produce coverage `max(a, b)`, never `a + b`. | T-10 |
| a self-crossing stroke | The coverage at the crossing equals the single-dab coverage (no darkening). | T-09 |
| **union is per stroke** | Two *different* strokes of the same colour still build up where they overlap. | T-11 |
| determinism | The same inputs produce byte-identical coverage; no dependence on time, zoom or `rasterScale` in the *plan*. | T-19, T-16 |
| hardness profile | `stampHardness = 1` gives a hard edge with one pixel of antialiasing; a lower value gives a hard core plus a monotone soft rim that never reaches past the dab's radius. | new |
| single sample | A press without movement deposits exactly one dab, at the sample, with the brush diameter. | T-08 |
| empty stroke | No samples → no dabs, no coverage, no image. | new |
| guards | The minimum spacing floor and the coverage budget hold, and the cut is deterministic and **stable under path growth** (the same first *K* dabs whether the path has 10 samples or 10 000). | T-31, Q8 |
| tiles | A union that crosses a tile boundary is correct in both tiles; a saturated tile is skipped. | new |
| footprint | The coverage of a dab never leaves the brush radius (+ the half-pixel AA ring). | §8.7 |

### 11.2 `src/test/canvas2dRenderer.test.ts`

| Test | Assertion | From |
| --- | --- | --- |
| legacy parity | With `stampSpacing = 0` the renderer's recorded calls are **identical** to today's; the existing hard / soft / grain tests stay green. | T-01…T-04 |
| stamp path uploads coverage | A stamped stroke writes `putImageData` into the stroke buffer at the expected device offset with the expected coverage bytes (`PixelCanvas` L1943 stores them). | new |
| live == rebuild | The coverage after incremental `extendStroke` calls is byte-identical to the coverage after a single full rasterization of the same stroke. | T-12, T-13 |
| one alpha | The stamp path composites at the stroke's opacity once. | I1 |
| no darkening at a crossing | A self-crossing stamped stroke at 50 % opacity over white is `rgb(128,128,128)` — the same expectation the legacy path has today (L2618). | T-09 |
| erase | A stamped eraser subtracts the union, and a crossing eraser stroke erases once. | T-06 of the analyst's Q6, existing eraser tests L591–812 |
| **coverage stays inside the composited region** | `coverageInside` (L2423) is true for a stamped stroke: no coverage escapes the padded sample bounds. | T-20, §8.7 |
| **live preview == committed pixels** | For a stamped stroke, the live preview pixel and the committed layer pixel at the same document point are equal. | T-21 |
| bounded rebuild | The rebuild still touches only the stroke's footprint, not the document. | T-22 |
| resolution independence | The same stroke at `rasterScale` 1 and 2 agrees within 1/255 at document resolution; zoom never changes the rasterized data. | T-17, T-18 |
| release | `cancelStroke` and `endStroke` release the coverage cache; a new document or a raster-scale change drops it. | new |
| preview | The preview is composited inside the stroke's own layer (the existing behaviour, re-run with a stamped stroke). | new |
| **no fourth surface** | The number of document-sized canvases the renderer allocates is unchanged by a stamped stroke. | T-32 |

### 11.3 `src/test/projectFormat.test.ts`

| Test | Assertion | From |
| --- | --- | --- |
| v9 round trip | `stampSpacing` and `stampFalloff` survive a save/load round trip exactly. | T-23 |
| old files | A v1–v8 file opens with `stampSpacing = 0` and `stampFalloff = 0`. | T-24 |
| v9 requires the fields | A v9 file with a missing, out-of-range or non-numeric field is **refused** with a message naming the field. | T-25 |
| future version | A v10 file is refused with "this build reads up to N". | T-26 |
| old and new agree | A v1–v8 file and a v9 file with the same stroke produce the same pixels. | T-27 |
| history | The version-history comment in the file matches `docs/PROJECT_FORMAT.md`. | new |

### 11.4 `src/test/brushSettings.test.ts`

Defaults are `0`; both fields are clamped into range; both are part of the brush
identity (`brushSettingsEqual`) — the silent-failure pair the Feature Analysis
§5.8 warns about.

### 11.5 `src/test/drawingEngine.test.ts`

A stamped stroke is **one** undo step; the brush (including the stamp fields) is
captured per stroke; changing the brush afterwards does not rewrite the committed
stroke; a brush change is not an edit (no history, no dirty flag); a shape's
record stores zero-valued stamp fields.

### 11.6 Manual verification (the React layer has no tests)

In the running app (`pnpm tauri dev`): the two new controls appear with the right
defaults ("Stamp spacing" off, "Stamp hardness" at 100 %); the renamed
"Sampling" slider is unambiguous; a stamped stroke shows visible dabs at a large
spacing; the default brush still looks exactly as before; one undo step removes
the stroke; save and reopen reproduce the stroke; PNG export matches the display.

---

## 12. Rollout, feature flag and rollback

### 12.1 The flag is the data, not a switch

There is **no application-level feature flag**. The flag is
`brush.stampSpacing`, stored per stroke and persisted in the file:

- `0` → the legacy segment path, byte-identical to today. This is the default, so
  every existing document, every existing file and every existing user is
  unaffected.
- `> 0` → the stamp engine.

A per-stroke, per-file flag is strictly better here than a global switch: it
cannot desynchronize the file from the renderer, it survives a save/reopen, and it
rolls back per document rather than globally.

### 12.2 Rollback

| Option | Effect | Cost |
| --- | --- | --- |
| **(a) Disable the engine** — ship a build whose default `stampSpacing` is `0` while the parser still reads v9 | Documents keep opening and render as legacy strokes. The stamped *appearance* is lost (the file says `stampSpacing = 0.1`, the reader ignores it → a different picture). | **Not acceptable** for a v9 file with a non-zero spacing — it violates the "never draw a different picture" rule. |
| **(b) Keep the parser, drop the engine** — the v9 fields are read but the renderer always uses the legacy path | Same picture problem as (a). | Not acceptable on its own. |
| **(c) Revert the whole slice** | The build returns to v8 and **refuses every v9 file** ("created by a newer version of Paka"). No silent misdraw, but the user's stamped documents become unopenable. | Acceptable only before any v9 file has been saved. |

**Recommended rollback: (c) before any v9 file exists; afterwards (c) *plus* an
explicit "this build cannot draw stamped strokes" notice, so the refusal is
explained rather than silent.** The same trade-off the repo already made for
`texture` (v7) and the blend modes (v8): a version bump is the honest way to make
an old build refuse a file rather than draw it wrong.

---

## 13. Alternatives rejected

1. **`perfect-freehand` (MIT) behind a narrow interface.** Rejected for this
   slice: it returns a stroke **outline polygon**, not per-dab coverage, so it
   cannot deliver the roadmap's "true hardness curves" or "per-dab textures"; its
   model (one filled polygon) would have to be re-expressed as Paka's "coverage
   buffer composited once at the stroke's alpha". It would also add Paka's first
   rendering dependency, to a codebase that deliberately has none, and it would
   put an upstream's stroke model in the file format's path. **Keep as an option**
   for a future taper/outline feature; the interface in §5.1 is narrow enough that
   swapping the planner is a one-file change.
2. **Porting a mature brush engine (Krita **GPL-3.0**, GIMP **GPL-3.0**, MyPaint
   **GPL-2.0**).** Rejected on the licence gate: Paka is MIT
   (`docs/g1/feature-evidence.json`), so copying or adapting GPL code would require
   relicensing the whole distribution. Note that the consequence here is
   **relicensing**, not a linking obligation: all three of these projects are
   under the GPL, so there is no permissive or LGPL branch to take instead.
   (`xp-brush` was previously listed here and has been removed — no such
   brush-engine project could be verified.) Paka's stack is "locked, do not change"
   (`docs/SESSION-BRIEF.md` §1). The *behaviour* is nonetheless re-implementable
   from Paka's own written specification, which is exactly what this plan does.
3. **A GPU dab rasterizer (sprite blits with `lighten`, then a luminance→alpha
   conversion).** Rejected: `lighten` blends colour channels, not alpha, so it
   does not union alpha by itself; the conversion is a JavaScript pixel pass
   anyway; it needs a second full-resolution surface, which breaks the documented
   58-bytes-per-document-pixel budget (Feature Analysis §10.3); and it is not
   pixel-testable under `RecordingCanvas`. Revisit only with a packaged-app
   profile showing the JS coverage pass is the bottleneck (§9.6).
4. **A document-sized coverage surface** (the simplest reading of "accumulate
   per-dab coverage"). Rejected: it is a fourth full-resolution surface →
   74 bytes per document pixel → 1.16 GiB at the cap, over the documented 1 GiB
   budget. The coverage cache must be bounded to the stroke's own footprint.
5. **Rust or WebAssembly for the dab rasterizer.** Rejected for now: an IPC round
   trip per pointer sample is explicitly forbidden by the constraints, and the
   profile that would justify a WASM module does not exist. The audit's own lesson
   (F7e) is that harness timings do not transfer to the packaged app.
6. **A separately running subsystem (an external brush service).** Rejected: no
   stable format or protocol makes that boundary worth the complexity, and it
   would put the pixel path outside the process.
7. **Rejecting or deferring the whole feature.** Rejected: the slice is bounded
   (one new pure module, one renderer branch, two brush fields, one format bump),
   it does not touch the renderer architecture, the document model, the command
   model or the React layer, and it retires the last Phase 3 checkbox. What *is*
   deferred is listed in §15/§16, not the feature.
8. **Implementing the whole Phase 3 item (spacing + hardness curves +
   directional/image textures) in one slice.** Rejected: the image/directional
   texture part needs an **asset pipeline** (stamp images in the project file, a
   new content kind in the document model, a new format section, its own
   validation and its own undo semantics). That is a second subsystem and needs
   its own gate; it is sliced off in §16.

---

## 14. Effort and risk

| Area | Estimate (one agent, focused) | Risk |
| --- | --- | --- |
| `stampCoverage.ts` (dab lattice, profile, tiled coverage) | 1.0–1.5 days | **Medium** — the lattice and the union are the parts that must be exactly right. |
| Renderer integration (6 call sites, state lifecycle, uploads) | 0.5–1 day | **Medium** — the live/rebuild parity lives here. |
| Brush fields, defaults, clamps, identity | 0.25 day | Low |
| Format v9 (version, reader, history comment, docs) | 0.25 day | Low |
| UI (two sliders, rename) | 0.25 day | Low |
| Tests (§11) | 1–1.5 days | Medium — the parity, union and region-guard tests are the valuable ones. |
| Docs (7 files + `AGENTS.md`) | 0.5 day | Low |
| **Total** | **≈ 4–6 days** for one agent and one review | **Overall: medium** |

Top risks, in order:

1. **Live ≠ rebuild** (the failure mode the whole repo is organised against).
   Mitigation: the lattice plan is a pure function; the parity test asserts exact
   bytes; the renderer keeps a coverage cache rather than re-deriving from pixels.
2. **Coverage escaping the composited region** (Feature Analysis §5.1) — visible
   while drawing, gone after release. Mitigation: the footprint rule (§8.7), the
   centred dab profile, and the `coverageInside` test.
3. **Performance on large brushes at `rasterScale = 2`** (§9.1). Mitigation: the
   guards in §9.2, the saturation short-circuit, and the packaged-app measurement.
   The legacy path is unaffected, so the worst case is "a stamped brush is slow",
   not "the app is slow".
4. **The raster budget.** The documented **58 B/doc px envelope holds** (worst
   case 56, 896 MiB), but the transient headroom drops from 10 to **2 B/doc px**
   (§9.3), and the rebuild path's upload buffer must be bounded or a rebuild
   coinciding with a grouped preview would reach 72 B/doc px and leave the
   budget. Mitigation: upload per coverage tile; state the headroom in the
   budget's documentation.
5. **Scope creep into the asset pipeline.** Mitigation: §15 and §16 are explicit.

---

## 15. Explicitly out of scope for this slice

- Directional or image-based stamp textures (needs an asset pipeline and a new
  document content kind).
- Non-round dab shapes, elongated or offset stamps, bristle brushes — and with
  them any change to `strokeSampleBounds` (§8.7).
- Per-dab scatter, rotation or jitter — even though it is easy to make
  deterministic (hash of the dab index), it changes the picture and therefore the
  format, and it has no value without non-round dabs.
- Per-dab opacity (Feature Analysis §5.4: it would break I1).
- Velocity-based dynamics (the samples carry `times`, but a velocity model would
  change what the stored samples mean).
- Changing the existing `spacing` field (it remains *sample density*; the new
  `stampSpacing` is *dab spacing*; the two are deliberately distinct — Q4).
- Per-dab texture *type* controls in the UI (deferred with the texture itself).
- A GPU / WebGL / WebGPU backend, a renderer rewrite, or a native IPC path.
- Layer masks, groups, tile-based layer surfaces, and the other open roadmap
  items — this slice must not collide with them.
- Any change to `StrokeRecord`, `LayerElement`, the command types, the history
  cap, the document pixel budget, or the React layer beyond one toolbar file.

---

## 16. Slices and gating

| Slice | Content | Gate |
| --- | --- | --- |
| **S1 (this plan)** | The stamp engine: `stampSpacing` + `stampFalloff`, round dabs, exact union, brush and eraser only, format **v9**, two UI sliders, the full test set, docs. | Ships behind the default-off data flag. |
| **S2 (separately gated)** | Directional / per-dab grain: the grain tile applied **per dab** instead of as a post-pass, which changes the picture and therefore needs **format v10** (or an additive field if the default renders identically). Only worth doing if S1's measurements show the post-pass grain is the bottleneck. | Needs its own Feature Analysis and a format decision. |
| **S3 (separately gated)** | Image-based stamps: an asset pipeline (stamp images inside the project file or a sidecar), a new document content kind, its own validation and undo semantics. A different subsystem — it needs its own design, not this plan. | Needs a Repository Inventory of its own. |

S1 is small enough for one agent and one review: one new pure module, one renderer
branch, two brush fields, one format bump, one toolbar file, one test file plus
additions to four existing ones.

---

## 17. Definition of done for this plan

- [x] Names the exact Paka files to touch, with line anchors verified against the
      live tree.
- [x] Preserves every invariant listed in §1.3, each with its home in the code and
      its test.
- [x] Explains at least one alternative in depth and says why it was rejected
      (§13, eight alternatives with a dimension-by-dimension comparison in §2.1).
- [x] Defines the tests before the code (§11), including the parity,
      anti-darkening and region-guard proofs.
- [x] States the format change, the defaults, the migration and the rollback.
- [x] States the performance and memory strategy, with the guards and the
      measurement that must happen before the next slice.
- [x] Leaves the `DrawingRenderer` boundary, the document model, the command
      model and the React layer untouched.
- [x] Answers the Feature Analysis's open questions Q1–Q8 (§2.3) and adopts its
      three CRITICAL findings as design constraints (§8.4, §8.7, §8.3).
- [x] Has its memory accounting verified against the live tree
      (`docs/memory-budget-review.md`), which corrected §9.3 and found one
      allocation that can leave the documented budget (§8.2 step 3).

---

## 18. Corrections applied after the memory-budget review (2026-10-20)

`docs/memory-budget-review.md` checked this plan's memory accounting against the
live tree and against the stamp implementation now in the working tree. Six
corrections were required; all are applied above.

| # | Location | Was | Now | Why |
| --- | --- | --- | --- | --- |
| C1 | §9.3, §2.3 (Q5), §3 (row 19), §14 (risk 4) | "the peak moves from 58 to **62** bytes per document pixel (992 MiB at the cap)" | The **58 B/doc px envelope holds**; the worst scenario is **56 B/doc px (896 MiB)**. The coverage caches are transients that fit *inside* the model's 10 B/doc px allowance, so the headroom falls from 10 to **2 B/doc px**. | The original arithmetic added the cache to the transient allowance instead of inside it. Review §4.2. |
| C2 | §1.1, §3 (rows 1, 3), §5.1, §5.3, §11.1 | module `stampRaster.ts`; fields `stampSpacing` + `stampFalloff` | module `src/core/rendering/stampCoverage.ts`; fields `stamp: boolean`, `stampSpacing: number`, `stampHardness: number` | The tree moved while the plan was being written; the plan must describe the code that exists. |
| C3 | §9.2, §2.3 (Q8) | the per-stroke dab budget (planned) | marked **not implemented** and recorded as the highest-priority gap: the file format does not bound the path length, so a legal project file can exhaust memory on open. | Review §5.4. |
| C4 | §8.2 step 3 | "the changed **tiles** become `ImageData` … written into the stroke buffer" | the implementation uploads **one `ImageData` for the whole dirty rect**, which is document-sized (256 MiB at the cap) in the rebuild path; the upload must be bounded per tile or per band. | Review §4.4, §6.2. |
| C5 | §0 (inputs) | "License / Provenance Decision: absent" | **present** — `docs/g1/provenance-record.json` (agent `paka-license-gate`) approves this plan's strategy (independent reimplementation from Paka's own documented behaviour) and blocks GPL sources. | The gate record landed after the plan was written; the §0 gap is closed. |
| C6 | §9.6 | four packaged-app measurements | five, adding the `putImageData` / F7b check and the upload-granularity comparison. | Review §6.4. |
| C7 | line anchors throughout | verified against `ad2ef11` | the in-flight implementation has shifted several anchors (e.g. `readBrush` L686 → L699, `readSampleArray` L668 → L681, `MAX_PROJECT_SAMPLES` L96 → L109, `dropStampCoverage()` call sites +3 lines). The **load-bearing** anchors are corrected above; the rest are hints, and `AGENTS.md` says "if `rg` disagrees, fix the anchor". | Review §1 and the corrected citations. |
| C8 | §9.2 (the planning-cost row) | the live path re-plans the whole dab list on every pointer event | **Closed by the implementation**: `StampDabCursor` (`stampCoverage.ts` L110–179) makes the live path O(new samples). The review's §5.5 finding no longer applies. | The tree moved between the review and this design. |
| C9 | §19 (new) | — | The **resource-bounds design** for the two blockers: tiled coverage uploads (§19.2) and the bounded dab-generation policy (§19.3–§19.4), with the recalculated envelope (§19.5). | This follow-up. |
| C10 | §2.3 (Q2), §1.1 | "rename the existing Spacing slider to Sampling; Stamp spacing 0 % = Off" | The tree uses a **"Stamp" toggle** plus "Stamp spacing" and "Stamp hardness" sliders, and **leaves the existing "Spacing" slider alone**. The toggle removes the "0 % = Off" sentinel ambiguity, so the rename is unnecessary. | The implementation chose a different (better) control shape while the plan was being reviewed. |

---

## 19. Resource-bounds design — the two blockers

This section specifies the two designs that close the blockers found by
`docs/memory-budget-review.md`:

1. **B1 — the coverage upload must be tiled**, so no allocation in the stamp
   path is document-sized (§19.2).
2. **B2 — dab generation must be bounded**, so no project file can exhaust
   memory or hang the renderer (§19.3).

It is a **design**, not an implementation: no production code or test is changed
by it. The implementation must live in `src/core/rendering/stampCoverage.ts`
(the planner and the coverage map) and in
`src/core/rendering/Canvas2DRenderer.ts` (the upload loop).

> **State of the tree when this section was written** (uncommitted, in flight):
> the planner is already incremental (`StampDabCursor`,
> `src/core/rendering/stampCoverage.ts` L110–179) and the coverage map is
> already tiled (`COVERAGE_TILE_SIZE = 64`, L38–39), but **the upload is still
> one `ImageData` for the whole dirty rectangle**
> (`Canvas2DRenderer.ts` L1018–1036) and **there is still no dab budget**.

### 19.1 Why the bounds live where they live

| Concern | Boundary | Why |
| --- | --- | --- |
| What the file may contain | `src/core/project/projectFormat.ts` (`readSampleArray`, L681–697) | Already refuses non-finite samples. **Not extended here**: bounding sample coordinates would change what the parser accepts, i.e. a **format-policy change**, which this slice does not make. |
| What the renderer may do | `src/core/rendering/stampCoverage.ts` — the planner (`StampDabCursor.advance`, `stampDabs`) | The **single** point every path goes through: the live path (`extendStampStroke`), the rebuild path (`rasterizeStampStroke`) and the export path all plan through it. A bound enforced here cannot diverge between live and rebuild, which is the invariant the whole renderer rests on. |
| What the user is told | `DrawingEngine` notice / status bar | A truncated stroke is a visible artifact; the user must be able to see that it happened rather than discover a missing tail. |

**The design does not rely on file-loading validation.** A file may contain any
finite coordinates; the planner's bounds are what keep the renderer safe, and
they are enforced on every path, including strokes the user drew.

### 19.2 B1 — tiled coverage uploads

#### 19.2.1 The upload unit

| Property | Value | Rationale |
| --- | --- | --- |
| Upload unit | **one coverage tile** = `COVERAGE_TILE_SIZE` = 64 × 64 **device** px | It is already the map's allocation unit (`stampCoverage.ts` L38, L212–213), so the upload reads exactly the bytes the map holds — no partial-tile arithmetic, no second grid. |
| Upload buffer | one `ImageData` of 64 × 64 = **16 384 bytes (16 KiB)**, allocated lazily per renderer and **reused** for every upload | After the first upload the stamp path allocates nothing per upload. 16 KiB is 0.001 B/doc px at the cap — invisible against the 58 B/doc px envelope. |
| Edge buffers | at most **4** additional `ImageData` objects per stroke (the tiles that straddle the buffer's right/bottom edge), each ≤ 16 KiB, reused for the same size | The stroke buffer is `doc × rasterScale` device px, which is generally not a multiple of 64, so the last tile in each axis straddles the edge. |
| Total temporary upload allocation | **≤ 80 KiB** | versus **256 MiB** today in the rebuild path (`docs/memory-budget-review.md` §4.4). |

A larger upload unit (e.g. 256 × 256 = 256 KiB) would cut the call count 16×
but re-introduce a per-upload allocation 16× bigger and make each call touch
more of the canvas — which matters because the audit's F7b mechanism (a draw
from a just-written canvas) is proportional to the canvas, not to the blit.
**64 is the right unit here**: it is the map's own unit, and the upload is
already the smaller of the two costs.

#### 19.2.2 Coordinate mapping

A tile is addressed by `(tileX, tileY)` in the **document's device grid** and
covers the device pixels

```
[tileX * 64, tileX * 64 + 64) × [tileY * 64, tileY * 64 + 64)
```

The tile's internal layout is row-major with a stride of 64
(`stampCoverage.ts` L253: `rowOffset = (y - tileTop) * COVERAGE_TILE_SIZE`),
which is **identical** to an `ImageData`'s layout (RGBA, row stride = width × 4).
So the tile's bytes copy into a 64-wide `ImageData` row by row with no stride
conversion.

The upload call is:

```
ctx.putImageData(image, tileX * 64, tileY * 64)
```

in **device pixels**, because `putImageData` ignores the context's transform —
the property the current implementation's comment already states
(`Canvas2DRenderer.ts` L1013–1017). The mapping is **1:1**: the `ImageData`'s
pixel `(col, row)` lands on the canvas's device pixel
`(tileX * 64 + col, tileY * 64 + row)`. `putImageData` never resamples, so no
sub-pixel shift is possible.

#### 19.2.3 Edge handling

Three cases, all at the buffer's boundary:

1. **A tile entirely inside the buffer** → the common case. Upload the whole
   64 × 64 tile.
2. **A tile straddling the right or bottom edge** → upload only the in-bounds
   part. The `ImageData` is then `sw × sh` (smaller), written from the tile's
   sub-rect and placed at the matching destination offset. The existing
   `writeRect(data, dataWidth, rect, rgb)` helper
   (`stampCoverage.ts` L291–329) already reads with the tile's stride and
   writes with the caller's stride, so it handles the partial case unchanged —
   only the `ImageData`'s size differs.
3. **A tile entirely outside the buffer** → skip it. This can only happen for a
   dab whose centre is outside the paper; its coverage is clipped by the canvas
   anyway, so skipping is exact.

**Negative tile indices.** A dab outside the paper's left/top edge has a
negative `tileX`/`tileY`. The current implementation clips the dirty rectangle
before the upload and its comment says an image put at a negative offset
"would shift the whole coverage rather than crop it". The HTML specification's
`putImageData` algorithm in fact **crops per destination pixel** (it skips
pixels whose destination is outside the canvas), so both readings would work —
but the design does not rely on that: **the destination is clipped explicitly**
before the upload, exactly as today, so the behaviour does not depend on the
specification's clipping rules.

#### 19.2.4 Which tiles are uploaded

The renderer must upload the tiles the coverage map actually holds, not the
tiles spanned by a bounding rectangle. The map therefore grows a **pending
set**:

- `paintDab` adds every tile it touches to the pending set (it already visits
  exactly those tiles, `stampCoverage.ts` L241–242).
- `takePendingTiles()` returns and clears the pending set.
- `clear()` clears the tiles and the pending set together (the rebuild scratch
  reuses the map, so a stale pending set would re-upload old tiles).

Then:

- **Live path** (`extendStampStroke`): paint the new dabs → take the pending
  tiles → upload each. The set is exactly the tiles the new dabs touched
  (usually one or two).
- **Rebuild path** (`rasterizeStampStroke`): paint all the dabs → take the
  pending tiles → upload each. The set is exactly the stroke's tiles.

This replaces the current "union all the dab rectangles into one dirty rect"
(`Canvas2DRenderer.ts` L960–978) with a per-tile list.

#### 19.2.5 Equivalence with the current behaviour

| Property | Today (one dirty-rect upload) | Tiled uploads | Equivalent? |
| --- | --- | --- | --- |
| Coverage written | the map's union over the dirty rectangle | the map's union over every pending tile | **Yes** — the dirty rectangle is a subset of the pending tiles, and the map is the authority for both. The extra pixels the tiles cover are the tile padding, whose map values are `0` or an earlier union that the buffer already holds. |
| Colour and alpha | RGB = brush colour, A = coverage (`writeRect` L321–324) | identical (the same helper) | **Yes** |
| Buffer content after the upload | union over the dirty rect | union over the pending tiles | **Yes**, given the buffer was cleared before the stroke (live) or over the element's region (rebuild). The tile padding *outside* the region is written with `0` where the old code left it stale; that region is never composited (the rebuild composites the region only) and the preview path is not active during a rebuild. |
| Transform | ignored (`putImageData` is in device pixels) | identical | **Yes** |
| Clipping | the dirty rect is clipped to the buffer | each tile is clipped to the buffer | **Yes** |
| Number of `putImageData` calls | 1 per update | 1 per pending tile | **No — deliberately.** This is the cost of bounding the allocation. |
| Temporary allocation | up to **256 MiB** (rebuild) | **≤ 80 KiB** | — |

#### 19.2.6 What it buys

- The stamp path allocates **no** document-sized buffer, so the documented
  raster budget holds in every scenario (§19.6).
- The rebuild path stops allocating 256 MiB per element (a 100-element layer of
  document-wide strokes allocated and discarded 25.6 GiB).
- The upload cost becomes proportional to the stroke's footprint rather than to
  its bounding box.

### 19.3 B2 — a bounded dab-generation policy

#### 19.3.1 The threats

| # | Threat | Input | What happens today |
| --- | --- | --- | --- |
| T1 | Non-finite segment | two samples at ±10³⁰⁸ | `Math.hypot` → `Infinity`; the placement loop `while (carried + (segment - travelled) >= spacing)` never terminates → **the renderer hangs** |
| T2 | Huge finite segment | two samples at ±10⁹ | the loop iterates ~2 × 10⁹ times → **the renderer hangs** (the `dabs` array grows without bound) |
| T3 | Long path, minimum spacing | 5 000 000 samples (the parser's ceiling) at the 0.5 px floor | 10⁷ dabs → **memory exhaustion** |
| T4 | Large brush | size 512 at 2× | 400 dabs × ~1.05 M device px per dab = 420 M pixel evaluations per stroke → slow but bounded |
| T5 | Repeated sample segments | 5 000 000 identical samples | one dab, but the **rebuild** walks 5 M samples per element → slow but bounded |
| T6 | Non-finite samples | `NaN` in the arrays | already refused at parse (`readSampleArray` checks `Number.isFinite`) ✓ |

#### 19.3.2 The three bounds

All three are enforced **in the planner**
(`src/core/rendering/stampCoverage.ts`), so the live path, the rebuild path and
the export path all obey them.

**Bound 1 — finite, bounded segments (safety).**

- A segment whose length is **not finite** ends the walk: no more dabs are
  placed past that point.
- A segment longer than **`MAX_INTERPOLATION_DISTANCE` (2048 document px)** —
  the project's own constant for "this is a pointer jump, not movement"
  (`src/core/brushes/strokeBuilder.ts` L27) — places at most
  `MAX_STAMP_DABS_PER_SEGMENT` dabs along it, and the lattice then resumes at
  the segment's end. The stroke **continues** (it is not cut), and the worst
  case is a bounded gap in the coverage across the jump.
- Why not "stop the walk" at a long segment: the builder itself refuses to
  interpolate across one, but a fast flick is a legitimate gesture and cutting
  the stroke there would be a visible regression. Capping the dabs *within* the
  jump bounds the work without ending the stroke.

**Bound 2 — the per-stroke dab-work budget (the main bound).**

- The planner stops placing dabs once the **accumulated dab work** exceeds
  `MAX_STAMP_DAB_WORK`.
- The work of one dab is its **box area in device pixels**, `(2r + 2)²`, where
  `r` is the dab's device radius. Device pixels are the same unit as the
  raster budget and the same grid the coverage lives on ✓.
- Work, not a dab **count**: the cost is the box area, so a count budget is
  defeated by a large brush (400 dabs × 1.05 M px) and is absurdly strict for a
  small one (a 1 px brush at 0.5 px spacing = 2 dabs per pixel). A work budget
  is brush-size-aware and maps directly to time.
- Truncation is by **dab index**, so it is prefix-stable (§19.3.3).

**Bound 3 — the sample-walk cap (planning cost).**

- The planner walks at most `MAX_STAMP_SAMPLES` samples of a stroke.
- Rationale: the rebuild path has no cursor and walks the whole path once per
  element, so a 5 M-sample stroke in a 100-element layer is 500 M sample steps.
- This is a **sample-index prefix**, so it is prefix-stable ✓.

#### 19.3.3 Why the bounds cannot break the live/rebuild equality

Every bound is expressed as a **prefix** of the dab sequence:

| Bound | Prefix property |
| --- | --- |
| 1 — segment caps | the dabs before the offending segment are unaffected; the cap applies to the dabs *inside* that segment, and the lattice resumes after it |
| 2 — work budget | the budget is spent in dab order, so the cut is at a **dab index**; the first *K* dabs are the same ones whether the stroke has 10 samples or 10 000 |
| 3 — sample cap | a **sample-index** prefix |

Since the live path (cursor) and the rebuild path (full walk) run the *same*
planner over the *same* samples, and every bound cuts at a prefix, they cut at
the same place → **live == rebuild == export**, and undo/redo and reopen
reproduce it ✓. This is the property the renderer depends on, and it is why the
bounds belong in the planner rather than in the parser or in the renderer.

#### 19.3.4 What the user sees when a bound bites

- Bound 1 (a capped jump) → a bounded gap in the coverage across the jump.
- Bound 2 (the work budget) → the stroke **ends** where the budget ran out.
- Bound 3 (the sample cap) → the stroke ends at the sample cap.

Both truncations are visible, so the slice must **report** them rather than
leave the user guessing: a status-bar notice ("this stroke was truncated")
and a line in `docs/ARCHITECTURE.md` under the rendering limits. The notice is
an editor-state message, not a history entry (like the existing refusal
notices, `DrawingEngine.ts` L1015–1024).

### 19.4 The dab-work budget: unit, derivation, and the unresolved value

**The unit is fixed:** device pixels of dab-box area per stroke.

**What can be derived from the repository's own limits:**

| Input | Value | Source |
| --- | --- | --- |
| Largest legal document | 16 777 216 document px (4096 × 4096) | `MAX_DOCUMENT_PIXELS`, `src/core/document/document.ts` L92 |
| Its device area at the budgeted scale | 67 108 864 device px | 16 777 216 × 2² |
| Largest legal brush | 512 document px (radius 256) | `MAX_BRUSH_SIZE`, `src/core/brushes/defaults.ts` L8 |
| Its dab box at 2× | ≈ 1 050 625 device px per dab | (2 × 512 + 2)² |
| Smallest legal dab spacing | 0.5 document px = 1 device px | `MIN_STAMP_SPACING_PX`, `stampCoverage.ts` L36 |
| The most expensive *legal* single stroke | a document-covering path at the minimum spacing: ≈ 67 M dabs × 16 device px = **≈ 1.07 G device px of work** | derived |
| A *normal* stroke (2000 px path, size 8, 10 % spacing) | 2 500 dabs × 324 device px = **0.81 M device px** | derived |
| A *large-brush* stroke (2000 px path, size 512, 2 % spacing) | 195 dabs × 1.05 M device px = **205 M device px** | derived |
| The coverage map's memory | bounded by the **inked** area, ≤ 67.1 M device px = 64 MiB — **independent of the work budget** | `stampCoverage.ts` L212–213 |

So the work budget is a **time** bound, not a memory bound ✓ (the memory is
already bounded by the footprint).

**Why the numeric value cannot be derived from the repository:**

The value has to answer "how long may one stroke take?", and **the repository
documents no latency or frame-time target**. A search of `docs/` for a frame
budget, a millisecond target or a per-frame limit returns only measurement
*recipes* (the audit's Appendix C) and harness numbers the audit itself
disowns ("the numbers must be re-measured in the packaged Tauri app before they
are used to prioritise work", `docs/PERFORMANCE_AUDIT_2026-10-20.md` §5).
The other input — the rate at which the stamp path consumes device pixels — is
unmeasured, and the audit's F7e records that harness timings in this project do
not transfer.

**Therefore the value is left explicitly unresolved.** What the design fixes:

1. The **unit** (device pixels of dab-box area per stroke).
2. The **shape** of the constant: an absolute value, clamped to a floor and a
   ceiling, so it neither truncates a normal stroke nor permits a hostile one.
3. The **two inputs that settle it**:
   - a **documented latency target** (the project has none — this is a
     coordinator decision, and stating one is cheap and useful beyond this
     slice), and
   - **one packaged-app measurement** of the stamp path's device-pixel rate
     (the audit's Appendix C recipe, applied to a stamped stroke).
4. The **arithmetic that turns those inputs into the constant**:

| Candidate | Work per stroke | Time at an assumed 50 M device px/s | Time at an assumed 100 M device px/s | Truncates a normal stroke (0.81 M)? | Truncates a large-brush stroke (205 M)? |
| --- | --- | --- | --- | --- | --- |
| 16 M | 16 M device px | 0.32 s | 0.16 s | no | **yes** |
| 64 M | 64 M device px | 1.28 s | 0.64 s | no | **yes** |
| 256 M | 256 M device px | 5.1 s | 2.6 s | no | no |
| 1024 M | 1024 M device px | 20 s | 10 s | no | no |

*The two time columns are arithmetic on an **assumed** rate and are **not
measurements** — the rate is exactly what has to be measured.*

The trade the coordinator is choosing: a **lower** budget keeps a hostile file
cheap but truncates legitimate big-brush strokes; a **higher** budget never
truncates a legitimate stroke but lets a hostile file spend seconds per stroke.
A third option — refuse the stroke — is worse: the file is legal, and refusing
it would be a format-policy decision.

**Bound 3's value, by contrast, can be derived**, because it does not depend on
a rate: the builder's interpolation step is `MIN_SPACING_STEP = 0.75` document
px (`src/core/brushes/strokeBuilder.ts` L31), so a stroke of *N* samples
covers ≈ 0.75·*N* document px of path. A budget of **1 000 000 samples** covers
750 000 document px of path — about 129× the diagonal of the largest legal
document (4096² → 5793 px) — which is far beyond any plausible stroke, while
bounding the rebuild's planning to 1 M steps per element. **Proposed:
`MAX_STAMP_SAMPLES = 1_000_000`.**

`MAX_STAMP_DABS_PER_SEGMENT` (Bound 1) is likewise derivable: a segment longer
than 2048 document px is already a jump, and the work of covering it at the
minimum spacing is 4096 dabs. **Proposed: `MAX_STAMP_DABS_PER_SEGMENT = 4096`**
— which coincides with the natural lattice count of a maximal jump, so the cap
bites only for jumps that are longer than the builder's own limit.

### 19.5 The recalculated memory envelope (rebuild scratch + grouped preview)

With the tiled upload (§19.2) the worst case is the scenario the review called
"G" — a layer rebuild running while a grouped live preview is alive — and it
now **fits**:

| Item | B/doc px at 2× | Note |
| --- | --- | --- |
| Layer surface | 16 | `layerSurfaceStore.ts` L52–69 |
| Live stroke buffer | 16 | `Canvas2DRenderer.ts` L204, L247 |
| Grouped-preview scratch | 16 | `Canvas2DRenderer.ts` L758 |
| In-flight coverage map | ≤ 4 | 1 byte per device px over the stroke's footprint |
| Rebuild scratch (resident) | ≤ 4 | one stroke's footprint; see below |
| Upload buffer | ≤ 0.005 | one 16 KiB tile image + ≤ 4 edge images |
| **Peak** | **≤ 56.005** | **896 MiB at the cap** |

| Comparison | B/doc px | at 16 777 216 px |
| --- | --- | --- |
| Documented envelope (`document.ts` L69–74) | 58 | 928 MiB ✓ |
| **With tiled uploads** | **≤ 56.005** | **896 MiB ✓ inside the 1 GiB budget** |
| With today's document-sized upload | ≤ 72.005 | 1152 MiB ✗ **over budget** |
| Peak if the rebuild scratch is also released after a rebuild | ≤ 52.005 | 832 MiB ✓ |

**Recommendation:** release the rebuild scratch when a rebuild batch ends (it is
currently resident for the renderer's lifetime), which takes the worst case to
52 B/doc px and makes the coverage heap transient in the model's own language.

The residual headroom under the documented 58 is **2 B/doc px** — the
planning fact the coordinator should carry into the next feature.

### 19.6 Open decisions for the coordinator

1. **`MAX_STAMP_DAB_WORK`** — unresolved by design (§19.4). Needs: a documented
   latency target **and** one packaged-app measurement of the device-pixel rate.
   Until then the bound is a *shape*, not a number.
2. **The latency target itself** — the project has none. Adopting one (even
   informally) would settle (1) and would be useful beyond this slice.
3. **Whether a truncated stroke is reported in the status bar** — the design
   says yes (§19.3.4); it is a small UI decision with a real user-facing
   consequence.
4. **Whether the rebuild scratch is released after a rebuild** — recommended
   (§19.5); it is a one-line lifecycle change with a 64 MiB effect at the cap.
5. **Whether Bound 1's per-segment cap should end the stroke instead of capping
   the dabs within the jump** — the design caps (§19.3.2) so a fast flick is not
   cut; ending the stroke is simpler but visibly truncates a legitimate gesture.
