# FF-01 — Per-dab directional texture: implementation report

**Slice:** FF-01, the last Phase 3 item of the brush engine.
**Branch:** `feat/ff01-directional-texture` (from `feat/stamp-brush-engine` at
`a1c9c1d`).
**Author:** Agent 3 (brush-engine engineer).
**Status:** implemented, tested, documented. **Not merged, not pushed.**

---

## 1. What shipped

A stamped stroke can now carry **bristle lanes that run along the path**. The
lanes are multiplied into each dab's coverage *before* the dabs are unioned, so
the union is still a maximum and a stroke still cannot darken where it crosses
itself. The lanes follow the stroke's direction, so the picture rotates with
the stroke.

The control is one slider, **Stamp texture** (0-100 %), inside the existing
**Stamp** block in the brush panel. It is off by default, so every stroke
drawn before this slice is byte for byte unchanged.

Two deliberate limits, both documented:

- The **first dab** of a stroke carries the angle `0` — the path has not
  continued yet, and a dab's direction must not depend on samples that arrive
  later — so its lanes run along the document's x axis rather than along the
  stroke. The neighbouring dabs overlap it.
- On a **tight curve** the lanes splay slightly, because each dab measures the
  offset from its own centre.

---

## 2. Provenance and reuse decision

**Decision: Paka-native implementation. No upstream code, no upstream
documentation and no upstream asset was used, and no dependency was added.**

| Clone | Revision | Licence | Used? |
| --- | --- | --- | --- |
| `fabric.js` | `4748495` | MIT | **No.** `packages/core/src/brushes/PatternBrush.ts` is the nearest upstream analogue (it stamps a texture); it was **not opened** for this implementation |
| `chroma.js` | `14e2b8a` | MIT | No — colour conversions, not brush rasterization |
| `perfect-freehand` | `176e00f` | MIT | No — stroke geometry, not texture |
| `react-colorful` | `8506e8c` | MIT | No |
| `opentype.js` | `5d65b6d` | MIT | No |
| `gifenc` | `27db5b9` | MIT | No |
| `svg-path-editor` | `937d75a` | Apache-2.0 | No |
| `tauri-apps-plugins-workspace` | `11211c3` | — | No |

The clones live in `C:\Users\aissa\Desktop\Paka-feature-factory\sources\`.

**What the implementation was written from** — Paka's own material only:

1. `docs/ROADMAP.md` "Next slice" and `docs/SESSION-BRIEF.md` §9, the
   documented behaviour of the slice;
2. `docs/FEATURE-FACTORY-MATRIX.md` L210 (the FF-01 row), which records that
   **no clone has a per-dab texture** and that the approach is a "deterministic
   hash-based texture multiplied inside the dab's coverage profile";
3. Paka's own dab engine — `src/core/rendering/stampCoverage.ts` — whose
   `StampDab.angle`, per-pixel-maximum union and footprint-bounded tile map
   the implementation reuses.

**Against the licence gate** (`docs/g1/reuse-decision.md`):

- **C1** (no third-party code or asset enters the tree) — held: no upstream
  file was copied, translated or vendored, and no dependency was added.
- **C3** (no third-party documentation or tutorial content pasted into the
  repository, including in comments) — held: the code comments describe the
  algorithm in Paka's own words and cite the *published standard* (the CIE /
  ISO CIEDE-style approach is not at issue here; the grain's existing 32-bit
  xorshift idiom in `canvas2dStroke.ts` is Paka's own and was reused as the
  house style).
- **§2.3 obligation 2** (a third-party runtime dependency needs the gate
  re-run) — not triggered: **no dependency was added**. `package.json`,
  `pnpm-lock.yaml`, `licenses/dependency-inventory.json` and
  `THIRD_PARTY_NOTICES.md` are untouched.

**No licence-gate re-run is required for this slice.**

---

## 3. The design

### 3.1 The idea

A dab already knows the direction of the path at its own position
(`StampDab.angle`). The texture uses that: the dab's coverage is cut by
**bristle lanes** that run along the direction, so the dab reads as a bundle of
streaks rather than a disc.

The lanes are laid out across the brush's **centre line**:

```
perpendicular = |(pixel - dab centre) . perpendicularTo(dab direction)|
lane          = floor(perpendicular / laneWidth)
bristle       = the lane's own width and offset, from a hash of the lane index
coverage     *= (1 - strength) + strength * bristle
```

`laneWidth` is measured against the brush's **nominal size**
(`size / STAMP_TEXTURE_LANES`), not against the pressure-varying radius, so:

- the lanes do not move when the pressure changes;
- the pattern is anchored to the document — at `rasterScale` 2 the lanes are
  twice as wide in device pixels and the same distance apart in document
  pixels.

### 3.2 Why the offset is taken from the centre line and not from the side

This is the load-bearing decision.

The coverage union is a **per-pixel maximum**. If the texture were a function
of the *signed* offset, then on a straight path every dab would disagree about
the value at a shared pixel, the maximum would pick the largest, and the lanes
would be **filled in** by the union — the feature would not survive the engine
it is built on.

Taking the **absolute** offset from the centre line makes every dab on a
straight path see the *same* value at the same pixel, so the union preserves
the lanes instead of erasing them. It also has two consequences worth stating
plainly:

- **The picture does not change when a stroke is drawn backwards.** The lanes
  belong to the path, not to the direction of travel — which is what a real
  bristle brush does.
- The texture is a function of the dab's own frame, so a dab's contribution is
  a maximum over dabs, never a sum.

### 3.3 Why the texture can only remove ink

The texture multiplies the dab's coverage before the union, and the factor is
`(1 - strength) + strength * bristle` with `bristle` in `[0, 1]`. The factor
is therefore in `[0, 1]` and the textured coverage is never above the plain
coverage. The union stays a maximum, so a self-crossing stamped stroke still
cannot darken, and the stroke's opacity is still applied once.

### 3.4 Determinism

The lane's width and offset come from a fixed 32-bit xorshift of the lane
index — the same idiom the grain already uses in `canvas2dStroke.ts`. Nothing
depends on a clock, a random seed, the order the dabs are painted in, the
zoom or the `rasterScale`. The dab plan is unchanged, so the texture rides on
the existing guarantee that live drawing, commit, rebuild, undo/redo, reopen
and export all produce the same coverage.

---

## 4. Files changed

| File | Change |
| --- | --- |
| `src/types/brush.ts` | `BrushSettings.stampTexture: number` (0-1) |
| `src/core/brushes/defaults.ts` | default `0`, clamped in `normalizeBrush`, compared in `brushSettingsEqual` |
| `src/core/rendering/stampCoverage.ts` | `STAMP_TEXTURE_LANES`, `StampTexture`, `stampTextureLaneWidth`, `laneHash`, and the texture inside `paintDab` |
| `src/core/rendering/Canvas2DRenderer.ts` | the texture is built from the stroke's own brush and passed to `paintDab` in **both** the live path (`extendStampStroke`) and the rebuild path (`rasterizeStampStroke`) |
| `src/features/brushes/BrushControls.tsx` | the **Stamp texture** slider, inside the existing Stamp block |
| `src/core/project/projectFormat.ts` | `PROJECT_VERSION` 9 -> 10, the v10 history entry, and `stampTexture` read from v10 |
| `src/test/stampCoverage.test.ts` | 17 new cases (the texture: layout, rotation, reversal, ink removal, the union, the work budget, fractional coordinates) |
| `src/test/canvas2dRenderer.test.ts` | 2 new cases (parity with the texture on, and the texture being visible) |
| `src/test/projectFormat.test.ts` | 4 new cases (v10 round trip, v9 default, two refusals) + 2 renamed |
| `src/test/brushSettings.test.ts` | the new field in the clamp case |
| `tests/visual/scenes/directional-texture.json` | **new** — the visual-regression scene |
| `tests/visual/visual.spec.ts-snapshots/directional-texture-win32.png` | **new** — its golden |
| `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT_FORMAT.md`, `docs/ROADMAP.md`, `docs/SESSION-BRIEF.md`, `docs/HANDOFF.md` | the behaviour, the format and the next slice |

**Not touched:** the colour panel, the guide UI, the transform menu, the
settings UI, the release-readiness documents, `qa/`, and the renderer beyond
the two `paintDab` call sites. No renderer rewrite; the stamp path gained two
arguments.

---

## 5. The UI and configuration entry point

**UI:** the brush panel, inside the block that only appears when the **Stamp**
switch is on:

```
Stamp                [ ]  (toggle)
  Stamp spacing      25 %
  Stamp hardness     100 %
  Stamp texture      0 %     <- new
```

`Stamp texture` is a real control wired to `actions.setBrush({ stampTexture })`;
there is no placeholder and the control is absent unless the stamp is on, so
the app never claims a capability the engine does not have.

**Configuration:** none outside the brush. The setting is ordinary brush
state — session state that describes the *next* stroke, captured on the stroke
record when the stroke is made, exactly like `spacing` and `hardness`.

---

## 6. Format compatibility

**`PROJECT_VERSION` 9 -> 10.** `stampTexture` is **required** in version 10 and
defaults to `0` for version-1 to -9 files.

| Situation | Behaviour |
| --- | --- |
| A version-10 file | read; `stampTexture` must be present and in `0..1` |
| A version-10 file without `stampTexture` | **refused**, with a message naming the field |
| A version-10 file with `stampTexture` out of `0..1` | **refused**, with a message naming the field |
| A version-1 to -9 file | opens unchanged; `stampTexture` reads as `0` |
| A version-10 file opened by a version-9 build | **refused** by the existing version check ("this build reads up to 9") — the older reader does not draw the wrong picture |

**Why a bump and not an additive field.** The project's own rule
(`docs/SESSION-BRIEF.md` §6) is that a bump is required when an older reader
would render a *different picture*. `stampTexture` changes how a stamped
stroke's samples are rasterized, so a version-9 reader that ignored it would
draw the same stamped stroke as plain dabs — a different picture. This is the
same reason `hardness` required version 6 and `texture` required version 7.
`stabilizer`, by contrast, is additive within version 6 because it changes the
*samples*, which are already stored.

**Migration:** none. Old files open unchanged; the new field's off value is
exactly the coverage they were written by. There is no lossy migration path
and none is wanted: a file written by a newer version is never opened by an
older one.

**Coordination note for the coordinator:** version 10 is now spent by
`stampTexture`. The next appearance-changing brush field (the brush **tip** in
the next slice) therefore needs **version 11**, unless it lands in the same
release as FF-01. The feature matrix groups FF-01/FF-02/FF-03 as "one bump,
three brush fields"; this slice took that bump on its own.

---

## 7. Acceptance criteria and how each is met

| # | Criterion | How it is met | Test |
| --- | --- | --- | --- |
| AC-1 | Default hard, soft, grain and stamped output is unchanged pixel for pixel | `stampTexture` defaults to `0`; the renderer passes `null` to `paintDab`, and the `strength === 0` branch is the original code path unchanged | `stampCoverage.test.ts` "leaves the coverage byte-identical when the texture is off"; the whole pre-existing suite is green |
| AC-2 | A textured dab stroke is one undo step; it never rewrites existing strokes | the texture is brush state captured on the record; nothing about the command changed | `drawingEngine.test.ts` (unchanged) and the renderer's own one-command-per-gesture contract |
| AC-3 | Live drawing, undo/redo, reopen and export produce the same textured pixels | the live path and the rebuild path both call `paintDab` with the same texture parameters, and the dab plan is unchanged | `canvas2dRenderer.test.ts` "agrees with a directional texture" (the four-way rebuild/live/release/export comparison, in the real `Canvas2DRenderer` against the software pixel canvas) |
| AC-4 | The union still holds: overlapping dabs and a self-crossing stroke do not darken | the texture multiplies the coverage *before* the maximum | `stampCoverage.test.ts` "still unions with a maximum, so a textured stroke cannot darken"; "can only remove ink, never add it" |
| AC-5 | The texture is anchored to the document, not to the frame | the lanes are measured against the brush's nominal size in document pixels | `stampCoverage.test.ts` "lays the lanes out against the brush's own size" (the lane width at `rasterScale` 1 and 2); the visual scene is rendered in Chromium |
| AC-6 | Old projects open unchanged; a v10 file requires the new fields and an older reader refuses it | see §6 | `projectFormat.test.ts` "opens version 9 files with the texture off", "refuses a version-10 stroke brush without the texture", "refuses a version-10 stroke brush with an invalid texture"; the existing "a newer version is refused" case still passes |

### 7.1 The brief's test-case list, and what covers it

| The brief asked for | Where it is covered |
| --- | --- |
| Horizontal, vertical and diagonal strokes | "keeps the lanes along the path, not across it" (horizontal vs vertical cross-sections are equal); "gives a diagonal path its own direction"; the visual scene's two strokes at ~-60° and ~-28° |
| Reversed stroke direction | "gives the same picture when the stroke is drawn backwards" - the lanes belong to the path, not the travel direction |
| Very short and stationary strokes | "textures a stationary dab, which has no direction of its own" (a one-sample stroke) |
| The first dab | "textures a stationary dab" and "gives a diagonal path its own direction" both pin `dabs[0].angle === 0` |
| Degenerate and repeated points | "survives a path of repeated points" |
| Stable results for identical input | "is the same for the same dab" |
| Interaction with existing brush rotation | **There is no brush rotation in Paka.** The *selection* rotation (FF-26) bakes a rotation into the samples, so the lanes follow it for free; "rotates the lanes with the path, not just with the dab" asserts the rotation law exactly (a quarter turn maps the pixel grid onto itself, so 441 pixel comparisons are exact) |
| Live rendering versus rebuild rendering | `canvas2dRenderer.test.ts` "agrees with a directional texture" |
| Export/replay consistency | the same four-way comparison includes the exported canvas |
| Brush sizes and high dab counts | "costs nothing: the same dabs, the same work and the same area" and "does not move the work budget, whatever the texture does" (a 512 px brush at the tightest spacing on a 40,000 px path) |
| Feature disabled versus enabled | "leaves the coverage byte-identical when the texture is off" |
| Project compatibility | the four `projectFormat.test.ts` cases |
| A non-square or asymmetric texture | the bristle lanes are parallel lines, not a rotationally symmetric shape, and the scene's two strokes sit at different angles |


### 7.1 The behaviour the brief asked to be pinned down

| Question | The answer this slice gives |
| --- | --- |
| What does "directional texture" mean visually? | The stroke is crossed by bristle lanes that run **along** it: a horizontal stroke leaves horizontal streaks, a diagonal one leaves diagonal streaks, and the streaks rotate with the stroke |
| Which brush parameters control it? | One: `stampTexture` (0-1). The lane *spacing* is derived from the brush's nominal size (`size / 4` lanes across the diameter), so it scales with the brush as everything else in Paka does |
| Does it follow the stroke direction, the dab orientation, or a chosen angle? | The **dab's own direction**, which is the direction of the path at that dab (`StampDab.angle`). There is no separate angle control and no brush-rotation field to compose with — Paka has no brush rotation, and the *selection* rotation is baked into the samples, so the lanes rotate with the rotated path for free |
| What happens when the direction is undefined, or the pointer barely moves? | The **first dab has no direction yet** (angle `0`), because the plan must not depend on samples that arrive later. Its lanes run along the x axis. A stationary stroke (one sample) is one dab with the same angle |
| Is it deterministic for the same input? | Yes — a fixed 32-bit hash of the lane index; no clock, no random seed, no dependence on the paint order |
| How do existing brushes behave with it disabled? | Byte for byte unchanged. `stampTexture` defaults to `0`, and the renderer passes no texture at all |
| Session-only or persisted? | **Persisted**, like every brush setting: it is captured on the stroke record, so reopening a file reproduces the same picture. That is why it needs version 10 |
| What performance overhead is acceptable? | See §9. No extra allocation, no extra tile, the same dabs. The dab painting costs about **1.5x** a plain dab, measured on one machine |

---

## 8. The regression evidence: mutation testing

The brief asked for "a visual regression scene that would fail if the
directional orientation were ignored". A golden that never fails is not a
guard, so the scene was checked by mutation: the implementation was broken on
purpose and the suite was re-run.

| Mutation | What it simulates | Caught by | Result |
| --- | --- | --- | --- |
| `directionX = 1, directionY = 0` — the texture always uses the document's x axis, i.e. **the dab's direction is ignored** | a stamp engine that stamps a texture but does not follow the path | **4 unit tests**: *"rotates the lanes with the dab's direction"*, *"runs the bands along the path, not across it"*, *"rotates the lanes with the path, not just with the dab"* and *"gives a diagonal path its own direction"* | **all four fail** |
| the same mutation, at the picture level | the same | the visual scene `directional-texture` | **fails**: 620 pixels (4.3 %) differ, above the harness's 2 % tolerance |
| `(1 - strength) + strength * bristle` -> `(1 + strength) - strength * (1 - bristle)` — the texture **adds** ink instead of removing it | a texture that breaks the single-alpha / no-darkening invariant | 3 unit tests: *"removes ink in bands that run along the dab's direction"*, *"can only remove ink, never add it"*, *"textures a stationary dab"* | **all three fail** |
| the texture disabled outright | a regression that loses the feature | the visual scene | the golden changes (the hash differs) |

**A finding worth recording.** The first version of the scene was 200x160 with
two long strokes, and the orientation mutation changed only **587 pixels
(1.83 %)** — just *under* the harness's 2 % tolerance, so the scene passed
against a broken implementation. The scene was rebuilt with a tighter canvas
and more ink (120x120, two strokes at clearly different angles) and the same
mutation now changes **620 pixels (4.3 %)**, comfortably above the tolerance.
The lesson for the next scene: **a visual guard is only as good as the ratio of
changed pixels to canvas**, and a scene with a lot of white space can hide a
real change.

---

## 9. Performance evidence

**Methodology.** The repository's own audit rules apply: **structural counts
and sampled areas are the valid measurements**, and an end-to-end timing is
reported as a *sampled* figure with its spread, never as a claim. The
withdrawn full-canvas synchronization timing claims are not repeated: nothing
here measures a canvas read-back, and no wall-clock figure below is offered as
a general statement.

The numbers come from a script that loads the **real** modules through Vite's
SSR transform (the same modules the app runs) and paints a stroke's dabs into
a real `StampCoverage`. It creates no file in the repository.

### 9.1 Structural (deterministic)

A 2000 px path, a 64 px brush, 10 % dab spacing, `rasterScale` 1:

| Quantity | Value |
| --- | --- |
| Path length | 2000 document px |
| Dabs placed | 313 (unchanged by the texture) |
| Dab radius | 32 device px |
| Coverage pixels examined | 1,322,425 (unchanged) |
| `MAX_STAMP_COVERAGE_WORK` | 16,777,216 — **the budget still holds** |
| 64x64 tiles for the whole stroke | 323 (unchanged) |
| **Extra allocations** | **0** — the texture reuses the dab's own pixel loop and the coverage map's existing tiles |
| **Extra draw calls** | **0** — the texture is inside `paintDab`, not a second pass |
| **Extra document-sized surfaces** | **0** — the raster budget's 58 bytes per document pixel is unmoved |

### 9.2 End-to-end timing (sampled, one machine, one session)

The same 2000 px stroke, painting all 313 dabs into a fresh coverage map:

| | median of 9 runs | min | max |
| --- | --- | --- | --- |
| plain dab | 4.30 ms | 3.95 ms | 5.30 ms |
| textured dab | 6.34 ms | 5.73 ms | 6.66 ms |
| ratio | **1.48x** | | |

**This is a single machine in a single session, not a claim about any
machine.** The spread is reported so the reader can judge it. The first
implementation measured **1.74x**; taking the lane index as a multiply and a
truncation instead of a division and a `Math.floor` brought it to 1.48x, which
is the version that shipped.

**What it costs in context.** The texture adds arithmetic to a loop the dab
path already runs; it adds no memory, no tiles and no passes. The audit's
recorded hot path is the *document-sized layer surface* in the rebuild, not the
dab loop, so this does not move the number the audit reports.

---

## 10. Test results

### 10.1 What was run, and what it said

| Check | Command | Result |
| --- | --- | --- |
| Unit + integration suite | `pnpm test` | **733 tests in 34 files, all pass** (711 before this slice) |
| Type check | `pnpm typecheck` | **clean, exit 0** |
| Production build | `pnpm build` | **succeeds** (165 ms) |
| Visual regression | `pnpm exec playwright test` | **20 scenes, all pass**, including the new `directional-texture` scene |
| Mutation checks | (see §8) | 4 mutations, each caught by the expected guards |

### 10.2 What was NOT run

- **No packaged Tauri build and no packaged-app check.** The brief asked not
  to compete for the desktop-build slot, so `pnpm tauri build` and
  `pnpm tauri dev` were not run. The release executable predates this slice.
- **No hand-drawn stroke in the running desktop app.** The feature was
  verified by the automated suite, by the visual-regression harness in real
  Chromium, and by mutation; it was **not** verified by eye in the packaged
  window.
- **No high-DPI check** at `rasterScale` 2 in a browser. The lane layout is
  document-anchored by construction and the lane width at `rasterScale` 2 is
  unit-tested, but no 2x picture was rendered.
- **No performance measurement in the packaged app.** The timing in §9.2 is
  from Node, on the real modules, not from the app.

---

## 11. Known limitations

1. **The first dab's lanes are not aligned with the stroke.** It carries the
   angle `0` by design (the live path could not unpaint it if it did). The
   neighbouring dabs overlap it, so the artefact is small, but it is there.
   The behaviour is pinned by a test (*"gives a diagonal path its own
   direction"* asserts `dabs[0].angle === 0` while every later dab carries the
   path's angle), so a change that quietly made the first dab direction-aware
   would fail rather than slip through.
2. **Tight curves splay the lanes slightly**, because each dab measures the
   offset from its own centre rather than from the path's centre line.
3. **The lane spacing is derived, not chosen.** It is `size / 4` across the
   brush's diameter. A user cannot change the bristle density without a new
   field and another format version.
4. **The texture is procedural.** There is no image, no tip bitmap and no
   per-dab scatter; the bristle layout is a hash of the lane index.
5. **The paint order of the dabs does not matter, but the *lane index* does**,
   so the lanes are the same everywhere along a straight path and differ
   between strokes that start at different offsets from the centre line.
6. **The texture is a stamp-path feature only.** The legacy segment path and
   the grain post-pass are untouched.
7. **The per-dab texture is not selectable.** It is part of the brush, not a
   transform, like every other brush setting.

---

## 12. Branch and commit

| | |
| --- | --- |
| Branch | `feat/ff01-directional-texture` |
| Base | `feat/stamp-brush-engine` at `a1c9c1d` ("docs: extend the overnight log with scale/rotate, the merged concurrent commit and the withdrawn export claim") |
| Feature commit | `dc378791c21ec06276f60d1b38f536110108cede` — "feat: per-dab directional texture for the stamp engine" |
| Worktree | `C:\Users\aissa\.local\share\opencode\worktree\252257\ff01-directional-texture` |
| Files changed | 20 (18 modified, 2 added) |
| Diff | +1431 / -137 (source, tests and docs) |
| Merged into the development branch? | **No** |
| Pushed? | **No** — not authorised |
| Format version | 8 -> 9 was the stamp engine; **9 -> 10** is this slice |

**Known overlap with other work, for the coordinator:**

- The `qa/` directory and the `docs/g1/` records are untouched.
- The **colour panel**, the guide UI, the transform menu and the settings UI
  are untouched.
- `docs/RELEASE-READINESS.md` is untouched: it is an owner-decision document
  and this slice does not change any of its items.
- The **next slice** (a brush **tip**) needs version 11, because this slice
  spent version 10 on `stampTexture`. If the tip is wanted in the same
  release, the two fields should be added to one version.

---

## 13. What this enables

The per-dab machinery is now in place: a dab carries a direction, a profile and
a texture, and the texture is multiplied into the coverage before the union.
The next Phase 3 item — a **brush tip** whose mask replaces the radial profile
— is a change to the same function, and the format's version 10 is already
spent, so a tip needs version 11 unless the two ship together.
