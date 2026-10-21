# Integration log — phase 1

**Branch:** `integration/phase1-settings-texture-transforms`
**Cut from:** `feat/stamp-brush-engine` at `fac6441`
**Date:** 2026-10-21
**Status:** local only. Nothing was pushed, and `main` was not touched.

This log records what was integrated, what had to be written to make the four
branches coexist, and what was actually measured. It is a record, not a plan.

---

## 1. What the branch contains

| Slice | Source branch and tip | Commits it brought | Merge commit |
| --- | --- | --- | --- |
| Fixed-step scale/rotate transforms | `feat/ff-fixed-step-transforms` `73dc907` | `d963074` (feature), `3529c71`, `e031a9e`, `73dc907` (docs and the browser test) | `05850a8` |
| T-06 settings persistence | `feat/t06-settings-persistence` `281b33f` | `20f65ac` (feature), `39457f8`, `5b7c25e`, `281b33f` | `7ddc674` |
| FF-01 per-dab directional texture | `feat/ff01-directional-texture` `1bd3d47` | `dc37879` (feature), `1bd3d47` | `26a6b77` |
| Packaged QA report, corrected | `qa/packaged-desktop` `d11073c` → `7730989` | `d11073c` (the report), `7730989` (the erratum) | `98fb056` |

Every original branch tip is preserved. No feature commit was rewritten,
squashed or dropped.

While this branch was being built, four commits landed on
`feat/stamp-brush-engine` (`4d9fcff` the R9/R3 plan, `72347bf` the vendored
skills and their lock file, `37a7c8c` the agent roster, `bc39597` the audit
reports). They are merged in here as `875768c`, so this branch is a superset of
the development branch rather than a stale fork of it.

## 2. Work done on this branch

### 2.1 The QA erratum (`7730989`, on the QA branch, merged by `98fb056`)

The packaged report claimed a **severe** defect: that at 125 % scaling the app
loses the right-hand fifth of its interface because `wry` passes physical pixels
to a DIP API. That claim is withdrawn - see
[`PACKAGED-TAURI-NIGHT-SHIFT-ERRATUM.md`](PACKAGED-TAURI-NIGHT-SHIFT-ERRATUM.md).

The measurement was taken from a **DPI-unaware** PowerShell process, which
Windows reports in DIPs, and compared against CSS pixels, which are also DIPs.
Measured under per-monitor-v2 awareness the client is 1800x1055 physical,
`innerWidth`/`innerHeight` are 1440/844 CSS and `devicePixelRatio` is 1.25:
1800 / 1.25 = 1440 exactly. A window-scoped capture at 125 % shows the whole
interface. No dependency, lockfile, licence inventory or notice change is
warranted, and none was made.

The original report is preserved untouched except for a nine-line banner
pointing at the erratum, so the record of what was claimed and why is intact.
"Defect 2" - the default window is taller than the work area - stands, and is
fixed in this branch (2.4).

### 2.2 Merge conflicts, and how they were resolved

Two files conflicted, both documentation, exactly as the pre-merge analysis
predicted:

* **`AGENTS.md`** - the FF-01 test-map row and the fixed-step test-map row were
  adjacent edits. Both rows are kept; the FF-01 wording (per-dab texture,
  `v9/v10`) is the fuller one.
* **`docs/SESSION-BRIEF.md`** - three regions: the status header (T-06 and
  FF-01 each rewrote it), the slice table (each added a row), and the brush
  field list (FF-01 appended `stampTexture` next to T-06's new paragraph).
  The resolution keeps one integrated status header, both table rows and both
  pieces of text.

No implementation file conflicted: the three branches touch disjoint source.

### 2.3 `fix(settings): restore the directional stamp texture on startup` (`eb808a9`)

T-06's `brushOr()` in `src/core/settings/appSettings.ts` rebuilds the brush
field by field and predates FF-01's `stampTexture`. The write path serializes
the whole brush, so the value reached the file; the read path dropped it and
`normalizeBrush` supplied `DEFAULT_BRUSH.stampTexture` (0). Because
`settingsStore.applyToEngine()` calls `engine.setBrush()` at startup, a saved
Stamp texture was silently reset to 0 % on every restart.

Confirmed before the fix: the new round-trip test received `0` where the file
held `0.4`, and a malformed-but-in-range value was not clamped. The fix is one
line in `brushOr`, plus three tests:

* the round trip through `engine.getState().brush` after a real reload
  (fails before, passes after);
* the backward-compatible default for a file written before the field existed
  (the default is 0, no error, every other field still restored);
* the 0..1 clamp.

Additive: no settings-version bump, no migration, older files are valid.

### 2.4 `fix(window): fit the initial window inside the monitor work area` (`748f9eb`)

The default window is 1440x900 logical. At 125 % the work area here is
1536x816 logical, so the window cannot fit: the measured outer window was
1818x1102 physical at (102, 0) against a 1920x1020 work area - 82 px past the
bottom of the work area and 22 px off-screen, with the status bar under the
taskbar. At 100 % the same window fits.

`src-tauri/src/window_fit.rs` clamps the outer window to the work area of the
monitor it is on, from `.setup()`, before the window is shown. Both sides of
the arithmetic are physical pixels - the unit `Monitor::work_area()` and the
window geometry APIs use - so no DPI conversion happens and none can be wrong.
A window that already fits keeps its configured size, and the window is never
grown. The window is also clamped in position, so a window that would hang off
an edge is moved inside rather than resized.

`fit_within_work_area` is pure and has eight unit tests (the 125 % case,
horizontal and vertical overhang, a secondary monitor with a negative origin, a
work area smaller than the frame). **Those tests compile but cannot run on this
machine** - see §3.

## 3. Verification, measured on this branch

| Command | Result |
| --- | --- |
| `pnpm test` | **791 tests in 37 files, all pass** |
| `pnpm typecheck` | clean, exit 0 |
| `pnpm build` | succeeds, 114 modules, `dist/` written |
| `pnpm test:visual` | **25 tests, all pass** (20 scenes + 5 Selection-menu tests) |
| `cargo check --lib` | clean, exit 0 |
| `cargo test --lib window_fit` | **cannot execute**: the test executable fails to load with `0xC0000139` (`STATUS_ENTRYPOINT_NOT_FOUND`) before any test runs. A minimal crate on the same toolchain builds and runs its tests, so this is specific to this crate's test link, not the toolchain. The same failure predates this branch. |

Test totals before this branch were reported as 728, 733, 742 and 749 by the
four reports, none of which agree. The number above is measured, not inferred:
711 (dev) + 5 fixed-step browser tests are separate from vitest, + the new
settings and window coverage.

## 4. Packaged application

Built from this branch (`pnpm tauri build --no-bundle`, release, 6m48s) and run
on this machine: 1920x1080 physical, **125 %** scaling (DPI 120), work area
1920x1020. Geometry read under per-monitor-v2 awareness; screenshots captured
with `PrintWindow(PW_RENDERFULLCONTENT)` at physical resolution.

| Check | Result |
| --- | --- |
| Launch at 125 %, whole UI reachable | **pass** - menu bar, toolbar, brush bar, tool rail, canvas, colour wheel, layers panel and status bar all visible; nothing clipped |
| Window fits the work area (the fix) | **pass** - outer **1818x1020** at (64,0) on the first launch and (102,0) on the second, against a 1920x1020 work area: right overhang 0, bottom overhang **0**. Before the fix the same build measured 1818x**1102** at (102,0), 82 px past the work area with the status bar under the taskbar |
| Viewport invariant | **pass** - client 1800x973 physical; 1800 / 1.25 = 1440 = `innerWidth`, 973 / 1.25 = 778.4 against `innerHeight` 779; `devicePixelRatio` 1.25. The 125 % clipping claim stays withdrawn |
| A settings file written **before** `stampTexture` existed | **pass** - the pre-existing file on this machine (no `stampTexture`, `stamp: false`) loaded without error and restored every field (`#cc3366`, size 37, opacity 1, hardness 1, sampling 12 %, stabilizer 0) |
| Stamp texture survives a restart (the regression) | **pass** - set to **40 %** through the rendered control; the file then held `"stamp": true, "stampTexture": 0.4`; after quitting and relaunching the control reads **40 %** and the brush draws with it |
| Directional texture actually renders | **pass** - a stamped stroke shows the bristle lanes along its path (window capture `paka-integration-4-textured-stroke.png`) |
| Fixed-step commands in the Selection menu | **pass** - "Scale by 150 %", "Rotate 15° Clockwise", "Rotate 15° Counter-Clockwise" are present and correctly disabled with no selection |
| Undo / redo labels and counts | **pass** - "Undo Stroke" before the click; after it history went 2 → 1 and the buttons read "Undo Add Guide" / "Redo Stroke"; after two more, history 0 |
| Close guard | **pass** - closing a dirty document shows "Close Paka? The current drawing has unsaved changes..." with Cancel / Save first / Discard and close; "Discard and close" exits the process. A clean document closes with no prompt |
| Settings file restored afterwards | the pre-test settings file was put back, so the test left no changed preferences behind |

**Bounded verification limits.**

* **100 % and 150 % scaling were not exercised**: this machine is configured at
  125 % only. The clamp is unit-tested for the geometry and is expressed purely
  in physical pixels, so the same inputs at 100 % (window fits, no change) and
  150 % (window clamped) are covered by the pure function's tests, but a
  packaged run at those settings remains open.
* **UI interaction method**: the clicks and the slider drag in this run were
  dispatched through WebView2's input pipeline over CDP, not as OS-level mouse
  events, because the Windows foreground lock prevented reliable OS-level
  placement. The settings file, the engine, the rendering and the window
  geometry are all the real packaged application; the pointer events are
  page-level rather than physical.
* **Native save / open / export** through the file dialogs were not re-run in
  this pass. Those paths are untouched by the four branches and were verified
  against the packaged app in `PACKAGED-TAURI-NIGHT-SHIFT.md`.

## 5. What is *not* done, and stays with the owner

* **Autosave and crash recovery remain inert.** Nothing constructs
  `AutosaveService` outside its tests, no recovery file is written, and there
  is no delete command, so the recovery copy cannot be removed. The policy seam
  exists; the owner's gates 1-5 are still unanswered. Nothing in this branch
  changes that.
* **The close guard.** The mechanism is source-supported - Tauri gates
  `api.prevent_close()` on `has_js_listener` - but the two observed bypasses
  were intermittent and the cause is unproven. The proposed fix (unconditional
  `prevent_close()`) is an owner decision, because it risks an unclosable
  window.
* **Licence and provenance gates** (R3 countersignature, R6 patent grant, R9
  CI allow-list, D-1 font identity). Untouched by this branch.

## 6. Preserved

* `main` = `ad2ef11` = `origin/main`. Not merged into, not pushed.
* The shared checkout at `C:\Users\aissa\Desktop\Paka` was not modified: it is
  still at `fac6441` with its pre-existing working-tree entries untouched.
* The four feature branches still exist at their original tips (except
  `qa/packaged-desktop`, which gained the erratum commit `7730989` on top of
  `d11073c`; the original report commit is intact in its history).
* No dependency, lockfile, licence inventory or notice file was changed.
