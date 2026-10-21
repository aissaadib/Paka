# Fixed-step selection transforms — QA report and design note

> **Artifact type:** the report for the fixed-step transform slice, and the
> design note for its pivot and inverse-operation semantics.
> The code is on `feat/ff-fixed-step-transforms`; this file is the evidence
> behind it, not a project document.

| Field | Value |
| --- | --- |
| Feature | Fixed-step scale and rotation commands in the **Selection** menu |
| Branch | `feat/ff-fixed-step-transforms` |
| Base commit | `a1c9c1d` — *"docs: extend the overnight log with scale/rotate, the merged concurrent commit and the withdrawn export claim"* |
| Feature commit | `d963074` — *"feat: fixed-step scale and rotation in the Selection menu"* |
| Worktree | `C:\Users\aissa\Desktop\Paka-feature-factory\worktrees\ff-fixed-step` (isolated) |
| Shared branch | **Not modified.** `feat/stamp-brush-engine` was not checked out or committed to from this worktree. |
| Files changed | 4 source files, 1 new test file, 2 documentation files |
| Report date | 2026-10-21 |

---

## 1. What was verified before any change

The reported proposal was checked against the live repository rather than
assumed.

| Check | Result |
| --- | --- |
| Development tip | `feat/stamp-brush-engine` at `a1c9c1d`, **in sync with `origin/feat/stamp-brush-engine`** (the earlier "ahead 3" is gone: the scale/rotate work was pushed and merged as `a42e67f`). |
| Scale/rotate merged? | **Yes** — `1622517 feat: scale and rotate a selection`, merged as `a42e67f`. The handles, the pure geometry module and the history command all exist. |
| The proposed API | Confirmed: `createTransformStrokesCommand` (`src/core/commands/strokeEditCommand.ts` L215) and its two callers in `DrawingEngine.ts` (L1937 for the flip, L2295 for the handle gesture). |
| The Selection menu | `AppMenuBar.tsx` — File / Edit / Selection / View; the Selection menu holds Nudge, Flip, Delete and Clear. |
| The pure geometry | `src/core/document/selectionTransform.ts` — `createScaleTransform`, `createRotateTransform`, `selectionFrame`, `boundsCentre`, `ROTATION_SNAP_DEGREES`. |
| Existing transform tests | `src/test/selectionTransform.test.ts` (the geometry), `src/test/selectionHandles.test.ts` (the handles), and the handle-driven cases in `src/test/drawingEngine.test.ts` (L1934, L2042). |
| Documented constraints | `docs/ARCHITECTURE.md` §Selection (the bullet at L981 on the frame's centre, and the two limits that follow it) and `docs/SESSION-BRIEF.md` §6 (L131-152). |
| Other agents' work | 13 other worktrees are active (T-01, T-10, T-11, T-13, T-14, the release-readiness and gate work). None touches the files this slice changes. |

**The reported API was unchanged**, but the line numbers in the brief were not
used: every reference below was re-read at `a1c9c1d`.

### 1.1 Where this slice sits in the factory's plan

| Question | Answer |
| --- | --- |
| Is there a roadmap row for it? | **No.** `Paka-feature-factory/audit/12-roadmap.md` has rows `T-01`…`T-58`+; none of them is "fixed-step transforms in the Selection menu". The brief gave no task id, and neither the roadmap nor `STATE.md` records this slice. |
| What is it a follow-on to? | **T-12** — *"Scale + rotate with angle snap (bake-on-apply)"*, which is the merged handle feature (`1622517`, merged as `a42e67f`). This slice adds the **menu** route to that same transform, not a new capability. |
| Which id namespace does it use? | The factory's own convention (`docs/FEATURE-FACTORY-MATRIX.md` §0.2) separates **feature** (`FF-nn`), **analyst-test** (`AT-nn`) and **task** (`TASK-nn`) ids, and says explicitly that the three "never overlap". This slice has no id in any of them, so **this report does not invent one** — it is identified by its branch and its commit. If the coordinator wants it tracked, `TASK-nn` is the namespace that fits, and the roadmap would need a row. |
| A related note | That same §0.2 already adopts the `AT-nn` rename that the T-06 settings/autosave discovery recommended for the `T-01`…`T-32` analyst-test ids. The two ids that collided (`T-06` as a task and as an analyst test) are now separated upstream. |

---

## 2. Design note — the geometry of each operation

### 2.1 The pivot

**Both operations pivot on the centre of the selection's *frame*, and the frame
is the samples' bounds widened by each stroke's own half-diameter.**

That is the same point for the corner handle, the rotation handle, the flip
and the new commands:

| Path | How it gets the frame |
| --- | --- |
| Corner / rotation handle | `DrawingEngine.beginSelectionTransform` → `this.selectionBounds()` → `boundsOfStrokes(...)` (L2116, L2126) |
| Flip | `flipSelection` → `boundsOfStrokes(entries.map(...))` (L1910) |
| **The new commands** | `scaleSelection` / `rotateSelection` → `boundsOfStrokes(entries.map(...))` (L1968, L2019) |

`selectionBounds()` (L2438) is a one-line call to the same `boundsOfStrokes`
the commands use, so **the handle and the command pivot on one point**, not on
two that happen to agree.

Two consequences worth stating:

* The pivot is the **padded** frame's centre. With strokes of different brush
  widths that is **not** the centre of the samples taken together: the wide
  stroke's padding pushes the frame's left edge further out. A command that
  pivoted on the samples' centre would move the selection somewhere else
  entirely. `fixedStepTransform.test.ts` proves the pivot is the frame's, by
  building a selection whose two centres differ.
* The padding does **not** scale with the geometry. A scaled stroke is the
  same stroke drawn along a different path, so the *painted* extent grows by
  a little less than the factor. That is the existing architecture's
  property, not something this slice introduced.

### 2.2 "Scale by 150 %"

| Question | Answer |
| --- | --- |
| Relative to the selection centre? | **Yes** — the centre of the selection's frame (§2.1). |
| Does 150 % mean a 1.5× scale of the geometry? | **Yes** — a uniform factor of 1.5 on the samples' positions about that centre. |
| Is the scale uniform? | **Yes** — the same factor on both axes (`createScaleTransform` maps x and y with the same `scale`), so the selection keeps its proportions. A non-uniform scale is not offered. |
| Is it a *target* size? | **No — and it deliberately is not.** The transform does not remember what the selection used to be, so it could not honour a target even if one were asked for. The factor is **relative**: 1.5 makes the selection one and a half times as large, and applying the command again makes it two and a quarter times as large. This is why the label reads "Scale **by** 150 %" and not "Scale **to** 150 %". |
| What is scaled? | The samples' positions only. The brush, colour, opacity, pressure and sample count are untouched. |
| Is the pivot clamped? | Yes, by the existing `clampScaleFactor`: a factor below 5 % is refused, a negative one is refused (that would be a flip), and a factor that is not a number leaves the selection where it is. |

### 2.3 "Rotate 15 degrees clockwise" and "… counter-clockwise"

| Question | Answer |
| --- | --- |
| Which way? | A **positive angle turns the content clockwise**, because the document's y axis points down. The menu's "Clockwise" is +15°, "Counter-Clockwise" is −15°. |
| About which centre? | The centre of the selection's frame (§2.1). |
| What is the step? | **15°** — the same `ROTATION_SNAP_DEGREES` the rotation handle snaps to, so the two routes through the feature agree on what a step is. The fixed step is *not* snapped again: it is already a step, and snapping it again could only move it. |
| Is the angle measured from a press? | No. There is no press: the angle is supplied, not dragged. |
| Does it preserve distances? | Yes — it is a rotation, so a sample's distance from the pivot is unchanged. |
| What happens to a sample on the pivot? | Nothing: it stays put. |

### 2.4 Rounding

**There is no rounding of stroke samples anywhere in the pipeline.**

* `transformStrokeSamples` (`strokeEditCommand.ts` L168-182) writes the map's
  output into `stroke.xs` / `stroke.ys` directly — full-precision doubles.
* The project format serialises them as they are (`projectFormat.ts` L509-510,
  `xs: element.xs`) and the parser accepts any finite number
  (`readAnyNumber`, L282-287), so a saved and reopened file keeps the same
  doubles.
* The only rounding nearby is the **document size** (L571-572) and the
  **guide positions** — neither is a stroke sample.

So the loss in an inverse operation is **not** rounding of the stored data. It
is two other things, and they are different:

| Loss | Where it comes from |
| --- | --- |
| **Floating point** | The reciprocal of 1.5 is not a number binary floating point can hold, so a second scale lands a hair away from where it started. The *stored* samples are exact; the *computed* ones are not. |
| **The pivot moves** | A turn moves the selection's frame, so the second turn is about the new frame's centre (`docs/ARCHITECTURE.md` L981-985). With strokes of different brush widths, a scale can move the frame's centre too. |

### 2.5 Inverse operations — what is and is not exact

**No inverse command is offered, and no label claims one.** The reasoning:

| Candidate inverse | Exact? | Why |
| --- | --- | --- |
| **Undo** | **Yes, exactly.** | The history command restores the stored originals verbatim (`revert()` writes `entry.original` back). Undo of a fixed step is bit-for-bit the original geometry. This is the only exact inverse. |
| Rotate +15° then −15° | **No.** | The turn moves the frame's centre, so the counter-turn pivots elsewhere. The result is a *different drawing*, not the original. This is the architecture's documented property, not a defect of the fixed step. |
| Scale by 150 % then by 1/1.5 | **No.** | Close, but not exact: the reciprocal of 1.5 is inexact in binary floating point, and with mixed brush widths the pivot moves as well. A sample that lies *on* the pivot is restored exactly; the others are a hair away. |
| Scale "back to 100 %" | **Not definable.** | The transform does not remember the original size, so there is no 100 % to return to. |

Two facts worth knowing, though no command uses them:

* A **180° turn is exactly self-inverse**: a half turn maps the padded frame
  onto itself about the same centre (the padded bounds `[A, B]` become
  `[2C − B, 2C − A]`, whose centre is again `C`), so two half turns are the
  identity. Every other angle moves the centre.
* The **flip** already had this property, which is why `ARCHITECTURE.md`
  describes two flips as "the identity up to floating-point rounding".

### 2.6 When there is no valid selection

| Situation | Behaviour |
| --- | --- |
| Nothing selected | The command **refuses** and returns `false`. No history step, no change. The menu entries are **disabled** (`disabled: selectedStrokes === 0`), the same convention the Nudge, Flip and Delete entries use. |
| A gesture is in flight | The command **refuses** — `beginSelectionEdit()` returns `null` when a stroke, fill, gradient or selection gesture is active. A keyboard transform during a drag would fight the gesture for the same sample arrays. This is the existing rule for the flip and the nudge. |
| The transform would move nothing | The command **refuses**: a single dab, or a selection already symmetric about its centre, maps every sample onto itself. No history step whose undo does nothing — which would read as a broken undo button. |
| The selection is on another layer | A selection belongs to the layer it was made on; a transform writes stroke samples, and strokes live in a layer. Unchanged by this slice. |

---

## 3. What was implemented

| File | Change |
| --- | --- |
| `src/core/document/selectionTransform.ts` | `FIXED_SCALE_FACTOR` (1.5) and `FIXED_ROTATION_DEGREES` (= `ROTATION_SNAP_DEGREES`). The two transform factories take an **optional** history label, defaulting to the existing `"Scale"` / `"Rotate"`, so the handle's labels are untouched. |
| `src/core/engine/DrawingEngine.ts` | `scaleSelection(factor): boolean` and `rotateSelection(degrees): boolean`, each following `flipSelection` exactly: `beginSelectionEdit()` → `boundsOfStrokes` → the map → `transformChangesSamples` → `transformStrokeSamples` → `commitSelectionEdit(entries, createTransformStrokesCommand(...))`. |
| `src/state/editorStore.ts` | `EditorActions.scaleSelection(factor)` and `EditorActions.rotateSelection(degrees)`. |
| `src/components/layout/AppMenuBar.tsx` | Three entries in the Selection menu, between the Nudge group and the Flip group. |
| `src/test/fixedStepTransform.test.ts` | 17 engine-level tests (new file). |
| `tests/visual/selection-menu.spec.ts` | 5 **browser** tests of the menu itself (new file): the entries exist, grey out with nothing selected, light up with a selection, and choosing one runs the real transform and leaves the right history entry. |
| `README.md` | The sentence that said "the scale and the rotation are handle gestures" was **stale** after this change; it now lists the three commands and what they do. |
| `docs/ARCHITECTURE.md` | Two bullets in §Selection: the fixed steps are the same transform with a different number, and undo is the exact inverse while the opposite command is not. |

**No second transform system was built.** The commands are the existing
`createTransformStrokesCommand` path, with the existing maps, about the
existing pivot.

**No project-format change, no new persisted state, no new dependency, no
lockfile change.** The transform moves samples; the format stores samples.

### 3.1 The menu

```
Selection
  Nudge Left / Right / Up / Down
  ────────────────────────────
  Scale by 150%
  Rotate 15° Clockwise
  Rotate 15° Counter-Clockwise
  ────────────────────────────
  Flip Horizontal      (Ctrl+Shift+H)
  Flip Vertical        (Ctrl+Shift+V)
  ────────────────────────────
  Delete Selected      (Delete)
  Clear Selection      (Esc)
```

**Labels.** "Scale **by** 150 %" says the operation is a factor, so the user
can predict that using it twice gives 2.25×. "Rotate 15° Clockwise" and
"Rotate 15° Counter-Clockwise" name the direction in the user's terms, because
"Rotate 15°" alone would leave the sign to be guessed. Neither label claims to
be an inverse of anything.

**Disabled state.** The three entries use the existing
`disabled: selectedStrokes === 0`, so they grey out with nothing selected —
the same rule the neighbouring entries use. The command also refuses
internally, so the disabled state is a convenience and not the only guard.

**Keyboard and focus.** The entries are the same `MenuItemSpec` the other
entries use: a native `<button role="menuitem">` inside the menu popup, so
focus, tab order and the `Esc`-to-close handler are **exactly** the existing
behaviour. **No new keyboard shortcut was added** — the feature does not
require one, and the existing shortcut space (`Ctrl+Shift+H`/`V` for the
flips, the arrows for the nudge, `Ctrl+D`, `Delete`, `Esc`) was left alone
rather than risk a collision. The menu was not given a modal, a panel or a
toolbar entry: three commands did not warrant a new surface.

---

## 4. Tests

`src/test/fixedStepTransform.test.ts` — 17 tests, all engine-level, driving
the real `DrawingEngine` through the same path the menu uses.

| # | Test | What it pins |
| --- | --- | --- |
| 1 | *"does nothing without a selection"* | The no-selection case: `false`, no history step, no change to the strokes. |
| 2 | *"scales a selected stroke about the centre of its frame"* | The pivot and the factor on a **non-square, asymmetric** stroke; one history step; the label `Scale 150%`; the brush, pressures, sample count and id untouched. |
| 3 | *"scales about the padded frame's centre, not the samples' centre"* | The pivot, with two strokes of **different brush widths**, so the frame's centre and the samples' centre genuinely differ. |
| 4 | *"scales every selected stroke"* | Several selected strokes, one history step, every stroke transformed. |
| 5 | *"scales a selection that has negative coordinates"* | Negative coordinates, reached the only way they can be — **a transform can push a stroke off the document**, and the document keeps the negative coordinates. A stroke cannot be *painted* outside the document (the press is ignored there, `DrawingEngine.ts` L1324), so the test reaches the case through a scale and then turns the result. |
| 6 | *"undoes and redoes the scale exactly"* | Undo restores the originals **verbatim** (`toEqual`, not `toBeCloseTo`); redo re-applies the same map to the same originals. |
| 7 | *"applies a repeated scale as a repeated factor"* | Two commands give **2.25×**, not 1.5×, and two history steps. |
| 8 | *"does not restore the geometry exactly when a scale is undone by another scale"* | The round trip is **close but not the identity** — the array is not equal, and every sample is within 9 decimal places. |
| 9 | *"turns the selection clockwise"* | The direction in the user's terms (a point right of the centre moves **down**; a point above the centre moves **right**), plus the exact map and the label `Rotate 15°`. |
| 10 | *"turns the selection counter-clockwise"* | The opposite direction (a point right of the centre moves **up**; a point above the centre moves **left**), and the label `Rotate -15°`. |
| 11 | *"turns every selected stroke"* | Several strokes, one history step. |
| 12 | *"undoes and redoes the rotation exactly"* | Verbatim undo, and redo. |
| 13 | *"does not restore the geometry when a turn is undone by the opposite turn"* | The counter-turn is **not** an inverse: the result is more than a pixel away from the original — and undo is the exact way back. |
| 14 | *"refuses a turn that would move nothing"* | A single dab maps onto itself: `false`, no history step, the sample untouched. |
| 15 | *"refuses a transform while a gesture is in flight"* | The documented rule: a marquee in flight owns the selection, the commands refuse, and the same command works once the gesture ends. |
| 16 | *"leaves the handle's own transform labels alone"* | The optional label parameter **defaults** to `"Scale"` / `"Rotate"`, so the handle's history labels are unchanged. |
| 17 | *"uses the same 15-degree step the rotation handle snaps to"* | The fixed step and the handle's snap are the same number. |

**On symmetry.** Every geometry test uses a stroke that is neither square nor
symmetric about either axis — the samples are (100, 80), (160, 110) and
(130, 150), whose bounds are 60 × 70 and whose pivot is (130, 115). A square,
symmetric selection would hide a wrong pivot, a sign error and an unintended
translation, which is why none is used.

**On the handle behaviour.** The existing handle-driven tests in
`drawingEngine.test.ts` (L1934, L2042) and the whole of
`selectionTransform.test.ts` and `selectionHandles.test.ts` are unchanged and
still pass, which is the regression evidence that the handle path is intact.
Test 16 additionally guards the one thing this slice changed in that path —
the default history label.

### 4.1 The menu, in a real browser

`tests/visual/selection-menu.spec.ts` — 5 tests, driven with Playwright
against the **running application** in Chromium. The application is served by
the same Vite dev server the visual harness uses, so this needs no
configuration of its own.

| # | Test | What it pins |
| --- | --- | --- |
| 1 | *"the fixed-step commands are in the Selection menu"* | The three entries are in the Selection menu, with the exact labels. |
| 2 | *"the fixed-step commands grey out when nothing is selected"* | The `disabled: selectedStrokes === 0` behaviour, in the real DOM. |
| 3 | *"the fixed-step commands are enabled once something is selected"* | A stroke drawn with the mouse, a marquee over it, and the three entries light up. |
| 4 | *"choosing a scale runs the real transform and leaves one undo step"* | Clicking **Scale by 150 %** makes the undo button read **"Undo Scale 150 %"** — so the command really ran and recorded a step — and the status bar shows **unsaved**, so the edit really happened. |
| 5 | *"choosing a rotation runs the real transform, in both directions"* | The same, for **Rotate 15° Clockwise** ("Undo Rotate 15°") and **Rotate 15° Counter-Clockwise** ("Undo Rotate -15°"). |

**What a browser result is, and is not.** Following Agent 1's labelling rule
in `docs/qa/PACKAGED-TAURI-NIGHT-SHIFT.md`: *"A browser result is never
presented as proof of desktop behaviour."* These five tests prove the
**front end** — the menu's entries, their disabled state, and that choosing
one reaches the real transform path and leaves the right history entry — in
Chromium, which is the same engine family as the Windows WebView2 the
packaged app uses. They are **not** a packaged-app result, and §5.1 says so
where it matters.

---

## 5. Verification

Every command was run in the isolated worktree
`Paka-feature-factory/worktrees/ff-fixed-step`.

| # | Command | Result |
| --- | --- | --- |
| 1 | `pnpm exec vitest run src/test/fixedStepTransform.test.ts` | **17 passed (17)**, 1 file, 506 ms |
| 2 | `pnpm exec playwright test tests/visual/selection-menu.spec.ts` | **5 passed (5)**, 6.8 s — the menu, in a real browser against the running app |
| 3 | `pnpm test` | **728 passed (728)**, 35 files, 2.24 s — run six times, all green |
| 4 | `pnpm typecheck` | **clean** (`tsc -p tsconfig.json --noEmit`, no output) |
| 5 | `pnpm build` | **built in 396 ms**, 111 modules transformed; `dist/assets/index-DVW-pf_7.js` 361.58 kB (gzip 109.13 kB) |
| 6 | `pnpm test:visual` | **24 passed (24)**, 9.4 s — the 19 scene goldens unchanged, plus the 5 new menu tests |

**The full-suite count before this slice was 711 tests in 34 files** (the
`docs/SESSION-BRIEF.md` §2 figure). The unit suite is now 728 in 35: **+17**
tests, all in the new file. The Playwright suite is now 24: **+5**.

**A note on the first full-suite run.** The very first `pnpm test` in this
worktree reported one failure:
`color.test.ts > round-trips every one of the 16,777,216 colours of the cube
exactly`. It is **not** caused by this slice and **not** a colour bug:

* `src/utils/color.ts` and `src/test/color.test.ts` are **byte-identical** to
  the base commit `a1c9c1d` (verified by comparing against `git show`);
* this slice changes neither file, and the failing test converts colours in a
  loop of 16.7 million iterations;
* the failing run took **10.18 s** (a cold Vitest cache); every later run
  takes ~3 s and the file passes in **2.2 s** in isolation;
* the test carries **no explicit timeout**, so it inherits Vitest's 5 s
  default, and under a cold start it crossed it.

So: a **latent timeout fragility in the T-10 colour slice's exhaustive cube
sweep**, which this slice's extra test file can tip over on a cold cache. It
was left alone deliberately — the file belongs to another feature, it is live
on other branches, and a one-line timeout there would be a merge hazard for no
benefit. **If the coordinator sees it flake, the fix is to give that test an
explicit timeout** (for example 30 s), which changes nothing about what it
asserts.

### 5.1 What was **not** verified

* **The packaged Tauri app was not built or run.** `pnpm tauri build` is a
  Rust build and belongs to Agent 1, who owns the packaged verification. When
  this slice was checked, Agent 1's packaged release build was **running**
  (`paka.exe`, started 09:42) and their report's runtime sections were still
  placeholders, so **no Rust build was started here** — the instruction was to
  avoid concurrent Rust builds, and the evidence of one in flight was enough.
  **Nothing in this report claims packaged-app behaviour.** The front end is
  verified in a real browser (§4.1); the desktop shell is not, and this slice
  changes no native code.
* **The desktop shell's own behaviour is unverified for this slice**: the
  native window, the native file dialogs and the Tauri IPC are untouched by
  the change, and the menu is ordinary React.
* **The Rust side was not touched**, so there is nothing to verify there.

### 5.2 The packaged verification, handed over

The packaged check is Agent 1's, and the recipe below is theirs, adapted to
this branch. It is written out so it can be run without re-deriving
anything.

```powershell
cd C:\Users\aissa\Desktop\Paka-feature-factory\worktrees\ff-fixed-step
pnpm install --frozen-lockfile                    # a fresh worktree has no node_modules
$env:PATH = "<WinLibs mingw64\bin>;$env:PATH"     # rustc calls dlltool.exe by name
$env:CARGO_TARGET_DIR = "C:\Users\aissa\Desktop\Paka\src-tauri\target"
pnpm tauri build --no-bundle
```

The shared `CARGO_TARGET_DIR` keeps the build to a recompile of Paka's own
crate — **this slice changes no Rust code at all**, so the Rust side of the
build is byte-identical to the one Agent 1 already has warm.

**What to look for in the packaged app**, to match the browser evidence in
§4.1:

1. Open the **Selection** menu with nothing selected: the three new entries
   are greyed out.
2. Draw a stroke (`B`), press `M`, marquee over it, and open **Selection**
   again: the three entries are live.
3. Choose **Scale by 150 %**: the undo button reads **"Undo Scale 150 %"** and
   the status bar shows **unsaved**.
4. Choose **Rotate 15° Clockwise** and **Rotate 15° Counter-Clockwise**: the
   undo button reads **"Undo Rotate 15°"** and **"Undo Rotate -15°"**.
5. `Ctrl+Z` restores the drawing **exactly** — the undo button's label goes
   back to "Undo Stroke" and the pixels return.

---

## 6. Conflicts and boundaries

| Other work | Overlap | Boundary |
| --- | --- | --- |
| `feat/stamp-brush-engine` (the development branch) | None in the files changed. | The work was done in an isolated worktree on a separate branch. The shared branch was not checked out or committed to. |
| The scale/rotate feature (`1622517`, merged as `a42e67f`) | **Deliberate reuse**, not conflict: the same maps, the same command, the same pivot. | The only change to the merged feature is the **optional** label parameter, whose default keeps the handle's labels byte-identical. |
| The HSV colour wheel (T-10) and the contrast readout (T-13) | None. | `src/test/color.test.ts` was left alone (§5). |
| The visual-regression harness (T-01) | The **test directory** is shared: the new browser spec lives in `tests/visual/` as a **new file**, so no existing file is edited and the harness's own rules are untouched. The goldens cannot be affected by a menu entry — the harness imports `Canvas2DRenderer` directly and never mounts the app shell. | Its 19 golden tests pass unchanged, and the 5 new ones run in the same project with no configuration change. |
| The project format, the brush, the guides, the colour workflow, autosave and project I/O | **None touched.** | The change is confined to the Selection menu, the transform commands and their tests. |

---

## 7. Remaining limitations

1. **No packaged-app verification.** See §5.1. The front end is verified in a
   real browser (§4.1); the desktop shell is not. The change touches no Rust
   code, and Agent 1's warm `CARGO_TARGET_DIR` makes their rebuild of this
   branch a recompile of Paka's own crate only.
2. **The brush width does not scale.** A scaled stroke is the same stroke
   drawn along a different path, so the *painted* extent grows by slightly less
   than the factor. This is the existing architecture's property, shared with
   the handle drag, and it is documented in `ARCHITECTURE.md`.
3. **The scale is a factor, never a target.** There is no "scale to 200 % of
   the original", because the transform does not keep the original size. A
   user who wants an absolute size must drag a handle.
4. **A fixed step of a single-dab selection is refused**, because the dab
   sits on the pivot and maps onto itself. The handle drag refuses the same
   thing for the same reason.
5. **The counter-turn is not a round trip.** §2.5. Undo is the exact inverse.
6. **Only one scale step and one rotation step are offered.** The proposal
   asked for 150 % and ±15°, and the step sizes live in one place
   (`FIXED_SCALE_FACTOR`, `FIXED_ROTATION_DEGREES`) so more can be added
   without touching the engine.
7. **No keyboard shortcuts.** Deliberate (§3.1). If the coordinator wants
   them, the shortcut space has to be checked against the flips, the nudge,
   `Ctrl+D`, `Delete` and `Esc` first.
8. **The Selection menu is not keyboard-navigable by arrow keys.** That is the
   existing menu's behaviour — the entries are native buttons, so `Tab` reaches
   them and `Esc` closes the menu — and this slice does not change it.
9. **The colour cube sweep's timeout fragility** (§5) is a pre-existing risk
   that this slice can tip over on a cold cache.
10. **`docs/SESSION-BRIEF.md` was not updated.** Its §6 describes the
    selection and transform behaviour, and a line about the three fixed steps
    belongs there. The file was left alone because it is being edited by the
    coordinator's own work; the wording is in §3.1 of this report and in the
    README, so it can be applied without re-deriving anything.

---

## 8. How to read this slice

1. `src/core/document/selectionTransform.ts` — the two constants and the
   optional label.
2. `src/core/engine/DrawingEngine.ts` — `scaleSelection` and
   `rotateSelection`, which are `flipSelection` with a different map.
3. `src/components/layout/AppMenuBar.tsx` — the three entries.
4. `src/test/fixedStepTransform.test.ts` — the 17 engine-level tests.
5. `tests/visual/selection-menu.spec.ts` — the 5 browser tests of the menu.
6. This report — the pivot, the inverse semantics, the verification and what
   is still open.

**A note on where the browser spec lives.** `pnpm test:visual` now runs 24
tests: the 19 visual goldens and the 5 menu tests. The menu spec is not a
golden test — it asserts behaviour, not pixels — but it runs in the same
Playwright project, against the same Vite server, with no configuration
change and no new dependency, which is why it is there rather than in a
second project.
