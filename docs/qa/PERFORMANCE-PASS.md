# Performance pass: the stroke buffer and the eraser

**Branch:** `integration/editable-shapes-wave`
**Baseline:** `38d86d3` — the renderer as it stood before this pass
**Optimized:** `e09c465` — the renderer after it
**Date:** 26 October 2026
**Machine:** Windows x64, 20 logical cores, HeadlessChrome 156.0.8078.4, 1280×800 at 1 device pixel per CSS pixel

This is a measurement report, not a benchmark description. The harness it reads
is in `bench/` and explains itself in `bench/README.md`; the recorded runs are in
`bench/results/`.

---

## 1. Executive summary

Three changes, all in `Canvas2DRenderer`, all about doing work proportional to
the **stroke** instead of to the **document**:

| Change | Effect |
| --- | --- |
| The stroke buffer clears only the pixels a stroke inked, except at the end of a stroke where it discards the whole texture | A shape drag on a 4096 page: **844 → 374 ms** (−56 %); on 2048: **99.8 → 50.4 ms** (−49 %) |
| The eraser subtracts only the stroke's own rectangle | A 160-sample eraser on 2048: **333 → 154 ms** (−54 %) |
| The eraser's snapshot restore stays a *whole-layer* blit, on purpose | This is the negative result: making it partial made the same workload **333 → 589 ms** |

The live stroke path is unchanged within noise. That is the expected result and
the report says why in §4: it never cleared the buffer between samples, so there
was no document-sized work to remove. The cost that remains in a live stroke on a
large page is the **display pass**, which is a different problem (§8).

Nothing about drawing changed: brush behaviour, pressure, spacing, hardness,
opacity, texture, stamp dabs, blend modes, layers, selection, undo/redo, the
`.paka` format and the PNG export are all untouched, and every test that pins
them still passes (§6).

---

## 2. Repo state

| Item | Value |
| --- | --- |
| Branch | `integration/editable-shapes-wave` |
| Commits added by this pass | 7 (`e0284d8` … `e871e8a`) |
| Production files changed | 1 (`src/core/rendering/Canvas2DRenderer.ts`, +162/−7) |
| Test files changed | 1 (`src/test/canvas2dRenderer.test.ts`, +131) |
| Harness added | `bench/` (4 source files, 5 recorded results) |
| Config changed | `tsconfig.json` (the harness is typechecked) |
| Unit / behaviour suite | 106 files, 2634 tests, all passing |
| Visual suite | 98 tests, all passing |
| Typecheck | clean |
| Production build | clean (619.61 kB JS / 182.67 kB gzip, 49.70 kB CSS) |
| Rust `cargo check` | clean |
| Rust `cargo test --lib` | **cannot run on this toolchain** — pre-existing, see §6.4 |
| Project format | v15, unchanged |
| Retained heap after 120 strokes | +0.00 MiB, before and after |

---

## 3. Baseline and diagnosis

### 3.1 The signal

The same 240-sample stroke, the same brush, the same 15 frames, on three page
sizes:

| Page | Before |
| --- | --- |
| 1024² | 4.8 ms |
| 2048² | 12.4 ms |
| 4096² | 107.4 ms |

A 16× increase in page area produced a 22× increase in cost for the same stroke.
That is not stroke work; that is document work.

The short-stroke rows isolate it further. The same 60-sample stroke confined to a
320 px square costs **9.9 ms on a 2048 page and 51.6 ms on a 4096 page** — the
stroke's footprint is identical, so the difference is entirely the page.

### 3.2 Where it came from

The stroke buffer is a canvas the size of the document. Before this pass it was
cleared **in full** at three points:

- `beginStroke` — a document-sized `clearRect` on every press;
- `extendStroke`'s re-rasterization branch — a document-sized `clearRect` on the
  second sample of every stroke;
- `endStroke` / `cancelStroke` — a document-sized `clearRect` on release;
- and `replaceStroke`, which is what a shape drag calls on **every pointer move**:
  120 document-sized clears and 120 full re-rasterizations for one drag.

The eraser had a second, worse version of the same problem: every pointer sample
restored the whole layer from its snapshot and subtracted the whole document.

### 3.3 The probe that changed the plan

The first attempt tracked the inked rectangle and used it for **every** clear,
including the eraser's snapshot restore. The erase workload got *worse* — 274.9 →
588.9 ms, reproduced twice — and every other workload drifted up, which looked
like machine noise. It was not noise. A direct probe of the same draw forms in
the same browser:

| Operation (2048² canvas) | Median |
| --- | --- |
| Full `clearRect` | 0.055 ms |
| Region `clearRect` (70 % of the canvas) | 0.255 ms |
| Full `clearRect` + fill | 0.060 ms |
| Region `clearRect` + fill | 0.485 ms |

And on 4096²: 0.245 ms full against 2.46 ms region.

A **partial** `clearRect` *preserves* the canvas texture, and preserving it is a
copy-on-write; a **full** one discards the texture, and discarding is cheap. The
optimization had been backwards for that one call site.

That gives the policy the code now implements, and the reason it is split:

| Situation | Correct clear | Why |
| --- | --- | --- |
| The buffer will be redrawn and re-rendered repeatedly (a shape drag) | **Partial** — the inked rectangle | The texture is preserved across the redraws, which is exactly the win |
| The stroke is over | **Full** — discard the texture | Nothing needs preserving, and a full clear is 5–10× cheaper |
| The eraser restores its layer from a snapshot | **Full** — discard the texture | Same measurement; a partial restore cost 1.27 ms against 0.14 ms |

A fourth finding is recorded as a rejected change: clipping the eraser's blit is
cheaper than the nine-argument `drawImage` (0.63 ms against 1.04 ms), but the
repository's pixel harness implements `drawImage` and not `clip`, so the change
would have made 21 pixel tests unable to see the difference. 0.4 ms is not worth
an unverifiable path.

---

## 4. Changes by file

### `src/core/rendering/Canvas2DRenderer.ts`

**Tracked ink (`7e7254c`).** The buffer now records the device-pixel rectangle it
may hold ink in (`strokeBufferInk`). Every write goes through
`markStrokeInk`/`markStrokeInkRect` — the segment rasterizer, the stamp upload,
the full re-rasterizations — so the rectangle is always a superset of the
coverage. `clearStrokeBuffer` clears only it, and does nothing at all when it is
`null`. `strokeSampleBounds` gained a sample range so the live path can grow the
rectangle by the samples it just appended instead of rescanning the stroke.

**Two clears (`7e7254c`).** `resetStrokeBuffer` discards the whole texture and is
what `endStroke`, `cancelStroke` and `abandonStroke` call. `abandonStroke` resets
rather than clears because it runs after a resize that already discarded the
pixels, so a tracked rectangle could describe the old raster scale.

**Bounded erase (`e09c465`).** `applyErase` subtracts the stroke's own padded
rectangle instead of the document. `restoreEraseBase` keeps its whole-layer
clear-and-blit, and now says why in a comment, because it looks like the same bug
this pass fixed everywhere else.

**A latent HiDPI bug, caught in review.** An intermediate version of
`restoreEraseBase` ran the snapshot blit *before* `surfaces.prepare`, which is
what installs the raster-scale transform. At `rasterScale` 2 that would have
restored only the top-left quarter of the layer. The order is now
clear → prepare → blit, and a comment says why.

### `src/test/canvas2dRenderer.test.ts`

Three tests pin the clear policy, and two of them fail against the old renderer:

- a shape's second move clears only the first move's 32 × 32 px of ink, with the
  exact rectangle asserted;
- a release clears the whole buffer and resets the tracked rectangle with it, so
  the next stroke has nothing stale to clear;
- two 50 % strokes down the same path produce the same pixels as a rebuild, so a
  finished stroke's ink cannot leak into the next one.

The existing live-eraser test gained the asymmetry: the restore is asserted to be
a full-document blit and the subtraction a nine-argument blit of the stroke's
rectangle.

### `bench/`, `tsconfig.json`

A committed harness, its recorded results, and the one-line config change that
puts it under the same typecheck as the code it measures. The README explains
what each column means and, more importantly, what the harness does **not**
measure.

---

## 5. Before / after

Two **pairs**, each taken back to back: the baseline renderer, then the optimized
one, alternating, in the same browser session. Whole-run drift of 10–20 % is
normal on this machine, so a single pair can invent or hide a change; the number
below is the average of the two runs in each column, with the two-run spread.

| Workload | Before (ms) | After (ms) | Δ | Before spread | After spread |
| --- | --- | --- | --- | --- | --- |
| `shape-replace-4096` | 844.0 | **373.6** | **−56 %** | 838.1–849.9 | 366.0–381.1 |
| `shape-replace-2048` | 99.8 | **50.4** | **−49 %** | 94.0–105.6 | 48.1–52.6 |
| `erase-2048` | 332.7 | **154.2** | **−54 %** | 322.7–342.7 | 152.4–156.1 |
| `stroke-hard-4096-noframes` | 44.7 | 41.4 | −7 % | 39.4–50.0 | 40.5–42.4 |
| `stroke-soft-2048` | 120.8 | 106.4 | −12 % | 117.4–124.2 | 103.1–109.8 |
| `stroke-stamp-2048` | 304.9 | 294.8 | −3 % | 300.8–309.0 | 285.2–304.3 |
| `render-idle-2048` | 345.5 | 334.3 | −3 % | 345.4–345.7 | 331.9–336.7 |
| `stroke-hard-4096` | 107.4 | 108.6 | +1 % | 107.0–107.7 | 108.0–109.1 |
| `stroke-hard-4096-short` | 51.6 | 51.2 | −1 % | 51.4–51.9 | 50.5–52.0 |
| `stroke-hard-2048` | 12.4 | 12.2 | −1 % | 11.8–12.9 | 12.1–12.3 |
| `stroke-hard-2048-short` | 9.9 | 10.4 | +5 % | 9.7–10.1 | 10.1–10.7 |
| `stroke-hard-1024` | 4.8 | 5.0 | +2 % | 4.8–4.9 | 4.9–5.0 |
| `stroke-textured-2048` | 40.0 | 45.0 | +13 % | 38.4–41.5 | 38.8–51.3 |
| Retained heap, 120 strokes | +0.00 MiB | +0.00 MiB | — | — | — |

### How to read this table

**Claimed.** The three large rows. Each is a mechanism that was measured,
explained by a probe, and is reproducible across both pairs with non-overlapping
spreads.

**Not claimed, and why:**

- `stroke-soft-2048` (−12 %) and `stroke-textured-2048` (+13 %) moved in opposite
  directions with no identified mechanism. The soft runs' spreads do not overlap,
  so the change is probably real, but "the clear got cheaper and a soft stroke
  got 12 % faster" has no causal story I can defend. It is recorded as
  unexplained drift, not as a win.
- `stroke-stamp-2048` (−3 %) and `render-idle-2048` (−3 %) are inside the
  spread.
- `stroke-hard-*` and `stroke-hard-*-short` are unchanged, which is the correct
  result: the live path never cleared the buffer between samples (§3.2), so the
  pass had nothing to remove there. The `+2 %`/`+5 %` rows are the cost of the
  bookkeeping that pays for the wins elsewhere.

---

## 6. Regression verification

### 6.1 Unit and behaviour

`pnpm test` — **106 files, 2634 tests, all passing** (2631 before the three new
tests).

### 6.2 Pixel identity

The renderer's central invariant — live drawing, a layer rebuild, and the PNG
export agree — is checked against a software pixel canvas in
`src/test/canvas2dRenderer.test.ts`, and against real Chromium antialiasing and
blur in `tests/visual`. Both pass. The new tests assert exact `clearRect` and
`drawImage` rectangles rather than "some clear happened".

### 6.3 Browser

`pnpm test:visual` — **98 tests, all passing** (16 specs, bundled Chromium, port
1422). This is the only place the bounded blits are checked against real
antialiased edges: a rectangle that is one pixel too small would leave a hard
edge that the software canvas cannot see.

### 6.4 Build and shell

- `pnpm typecheck` — clean.
- `pnpm build` — clean. 619.61 kB JS (182.67 kB gzip), 49.70 kB CSS (8.15 kB
  gzip). The chunk-size warning is pre-existing and unrelated.
- `cargo check --manifest-path src-tauri/Cargo.toml` — clean.
- `cargo test --manifest-path src-tauri/Cargo.toml` — **the test binary cannot
  start**: `0xC0000139 STATUS_ENTRYPOINT_NOT_FOUND` from the MinGW toolchain's
  `.rsrc merge failure: multiple non-default manifests`. This is documented as
  pre-existing in `docs/HANDOFF.md` §7 ("`cargo test --lib` aborts … pre-existing
  MinGW issue, unrelated to the code"). No Rust file was modified by this pass.

### 6.5 What was *not* verified

- **The packaged Tauri application.** No packaged build was measured, and none of
  the numbers above come from it.
- **Stylus input.** The harness synthesises pressure; real pen dynamics (tilt,
  hover, barrel rotation) are unmeasured.
- **GPU time.** No GPU timer is involved, and headless Chromium may be
  rasterizing on the CPU. See §7.

---

## 7. Compatibility

- **`.paka` format:** untouched. `PROJECT_VERSION` is still 15, no field was
  added, removed or reinterpreted, and no project file was rewritten.
- **Rendering output:** unchanged by construction. The pass changes *which
  pixels are cleared and blitted*, never *what is drawn*: the same rasterizer,
  the same feather pass, the same grain tile, the same dab engine, the same
  composite operations. The pixel-identity tests (§6.2) are the evidence.
- **Public surface:** no exported type, option, command, shortcut, panel or
  setting changed. `bench/` is new and is not imported by the app; `tsconfig`
  now includes it so it cannot rot.
- **HiDPI:** the raster scale path is exercised at 1 and 2 in the existing
  suites; the `prepare`-ordering bug found in review would have broken it, and is
  fixed.

---

## 8. Remaining opportunities

Ordered by evidence, not by appeal.

**1. The display pass dominates a live stroke on a large page.**
`render-idle-2048` is 334 ms for 60 frames — 5.6 ms per frame to draw one 2048²
layer surface into a 1280×800 canvas. A `stroke-hard-4096-short` still costs
51 ms because every frame downsamples a 4096² texture into the display, not
because of anything the stroke does. This is the largest remaining cost and it is
**architectural**: one full-resolution surface per layer, drawn through the
viewport transform every frame. A fix would be a display-resolution cache or a
tile cache, which is a much larger change than this pass and would need its own
measurement. In a packaged build with GPU compositing this cost may be small;
the harness cannot say.

**2. The dab engine.** `stroke-stamp-2048` is 295 ms and did not move. It was not
touched by this pass. `stampCoverage.ts` has its own budget and its own tests;
whether 295 ms is dab planning, coverage upload or the per-dab texture is not
measured here.

**3. A full-page stroke on a 4096 page.** 108 ms, unchanged. The stroke's ink
covers most of the page, so a bounded clear has nothing to save. The remaining
cost is the rasterization and the per-frame blit of a 4096² buffer.

**4. `shape-replace-4096` is still 374 ms for 120 moves** — 3.1 ms per move, down
from 7.0. Each move still re-rasterizes the whole outline and re-renders. A
shape drag could composite incrementally, but that changes what "the preview is
the stroke" means, so it needs a design decision, not a patch.

**5. The harness itself.** It is one page, one browser, one machine, 1 DPR, no
pen. A CI run of `bench/run.mjs` would catch a regression, but the numbers would
need their own baseline per machine.

---

## 9. Honest conclusion

The pass found and fixed a real, document-proportional cost in two paths — shape
dragging and erasing — and cut both roughly in half, with the mechanism confirmed
by a probe rather than assumed. It also produced one negative result that is
worth more than the win it nearly caused: a partial clear is *not* cheaper than a
full one, and the code now encodes that asymmetry with a comment and a test so
the next person does not re-derive it by breaking the eraser.

It did **not** make a live brush stroke on a large page faster, and it does not
claim to. The evidence says the remaining cost there is the display pass, which
is a different and much larger piece of work. Anyone reading the table should
read the "not claimed" list with it: two rows moved by ±12 % for reasons this
pass could not explain, and they are recorded as drift rather than as results.

The numbers describe HeadlessChrome on a development machine. They are useful
because they are paired and reproducible; they are not a statement about the
packaged application, which was not measured.
