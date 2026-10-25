# Release candidate report — Paka 0.1.0

Date: 2026-10-23
Worktree: `D:/Dev/Paka-overnight-worktrees/integration`
Candidate branch: `feat/krita-brushes`
Candidate SHA: **`b7953df345abccb3d1c84a3b2740e77019661599`**

---

## 1. Verdict

The candidate is **one identifiable source commit** whose tree contains every
required feature. On that exact tree:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | **pass** (exit 0) |
| `pnpm test` | **pass** (exit 0, 95 files / 2382 tests) |
| `pnpm test:visual` | **pass** (exit 0, 82 tests) |
| `pnpm build` | **pass** (exit 0, one chunk-size warning) |
| `pnpm tauri build` | **pass**, both bundles rewritten (§5) |
| Packaged smoke | **pass** on the freshly built executable (§6) |

No release-blocking regression was found, so no source was changed. The only
files added by this mission are the two release documents, the packaged-smoke
logs and screenshots under `docs/qa/release-candidate/`, and one QA helper
script (`scripts/packaged-rc-step.mjs`). Nothing was reset, rebased, merged,
force-pushed, cleaned or deleted; `main` and `origin/main` were not touched.

---

## 2. Candidate identity

```
branch      feat/krita-brushes
HEAD        b7953df345abccb3d1c84a3b2740e77019661599
remote      origin/feat/krita-brushes = b7953df (already pushed)
worktree    clean before this mission; only the release artefacts below are new
```

The full ancestry analysis is in
[`BRANCH-AUDIT.md`](BRANCH-AUDIT.md). In short: every required branch
(`feat/bigger-canvas-sizes` `bbf1521`, `integration/layer-groups-wave`
`6754ff9`, `integration/feature-wave` `3af055a`, `feat/ui-reference-redesign`
`0cfd982`, `integration/consolidation` `b63fb74`, `integration/next-build-wave`
`5e5beb0`, `feat/movable-panels` `b146d98`, local `main` `ad2ef11`) is a strict
ancestor with **0 commits outside the candidate**. History is linear. The
candidate adds exactly 4 commits over `bbf1521`:

```
b7953df docs(qa): point the report at both of its editions
07151e3 feat(brushes): widen the Krita 4 pack to 81 presets
e68b4d8 docs(qa): deliver the app report as a text document
4be7fca feat(brushes): add the translated Krita 4 default presets
```

`origin/main` (`514b69d`, "fix(test): repair the tool options test the merge
mangled") is deliberately **not** an ancestor and was not imported. The
candidate's own tool-options tests pass in the full run below, so the commit is
not needed.

### Feature → commit

| Required work | Commit |
| --- | --- |
| UI redesign (dock, one-row context bar, eight-size shell, brush browser, size-optimised build) | `7497dce`, `5856fc3`, `30b3884`, `018305b`, `0cfd982` |
| Fill: global mode and sample scale | `b723f46` |
| Lasso marquees and selection-combining modes | `a141137` |
| Symmetry across one or both axes | `0b22505` |
| Layer groups: model/tree operations | `ff9a3be` |
| Layer groups: group compositing | `945a2fd` |
| Layer groups: indented draggable panel | `242a5c1` |
| Panel workflow: move, float, reset | `b146d98` |
| Bigger canvas-size presets | `bbf1521` |
| Krita 4 import (69 → 81 presets) | `4be7fca`, `07151e3` |

---

## 3. Source verification

Not a restatement of the earlier report: the tree at `b7953df` was opened and
the assertions behind each claim were read.

| Claim | Where it is proved |
| --- | --- |
| Group create / rename / move / reorder / visibility / delete / undo | `src/core/document/layerGroups.ts` (27 exports, including `createGroup`, `groupLayers`, `moveLayerToParent`, `moveLayerOutOfGroup`, `dissolveGroup`, `layerTreeRows`); `src/test/layerGroups.test.ts` (~40 cases) |
| Group rendering | `Canvas2DRenderer.ts` `paintLayerNodes` paints `node.children` on an isolated scratch surface and composites with the group's own opacity/blend (~1066–1146); `tests/visual/layer-groups-render.spec.ts` |
| Groups survive the format | `src/test/projectFormat.test.ts` "round-trips a group with the layers it holds", "round-trips a nested group and its ordering", "round-trips an empty group", plus four rejection cases |
| Fill (global, sample scale) | `src/core/fill/fillOptions.ts`, `fillScan.ts` `scanFill`; `src/test/fillOptions.test.ts` (mode fallback, sample-scale clamp, whole-option reader) and the scan block |
| Lasso + combining | `src/core/document/selectionModes.ts` `combineSelectionIds`; `src/test/selectionCombining.test.ts`; `tests/visual/feature-wave.spec.ts` |
| Symmetry is one undo step | `symmetry.ts` `symmetryMirrors` consumed at `DrawingEngine.ts:2682`; `src/test/drawingEngine.test.ts:3963` "mirrors a stroke across a vertical axis as one undo step" |
| Bigger canvas presets and the budget | `canvasSizePresets.ts` (six presets, largest 8192×2048 and 4096×4096); `document.ts` `MAX_DOCUMENT_SIZE=8192`, `MAX_DOCUMENT_PIXELS=16_777_216`; `src/test/documentRasterBudget.test.ts`, `canvasSizePresets.test.ts` |
| Krita idempotency and translation | `kritaDefaults.ts` (81 specs, `missingKritaPresets`); `src/test/kritaPresets.test.ts` (12 cases incl. idempotent re-import); `src/test/settings.test.ts` "persists a preset and every field of its brush across a restart" |
| Format v13 | `PROJECT_VERSION = 13`; `projectFormat.test.ts` pins v13 and shows a v9 file still opens |
| PNG excludes overlays | `src/test/overlayPipeline.test.ts` "never paints an overlay into the export composite" — and, in the packaged app, §6.6 |

`AGENTS.md` drift noticed while doing this (documentation only, not fixed here):
`src/test/fillScan.test.ts`, `bucketFill.test.ts` and `drawingAids.test.ts` do
not exist on this branch. Fill-scan coverage lives in `fillOptions.test.ts`,
the bucket engine seam in `drawingEngine.test.ts`, and the drawing aids in
`symmetry.test.ts`/`gridSnapping.test.ts`.

---

## 4. Automated checks (fresh, on `b7953df`)

Run sequentially in the candidate worktree. Full output:
`docs/qa/release-candidate/`.

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 1 | `pnpm typecheck` | **0** | `tsc --noEmit`, no diagnostics | `typecheck.log` |
| 2 | `pnpm test` | **0** | **95 files passed / 2382 tests passed**, 0 failed, 0 skipped, 4.92 s | `test.log` |
| 3 | `pnpm test:visual` | **0** | **82 passed**, 0 failed, 0 flaky, 51.8 s | `visual.log` |
| 4 | `pnpm build` | **0** | `tsc` + `vite build`, 212 modules, built in 239 ms | `build.log` |

Warnings, recorded rather than hidden:

- `build.log` contains a PowerShell `NativeCommandError` line. It is the
  harness echoing a stderr line from `vite`, not a build failure; the exit code
  is 0 and `dist/` is complete.
- The only build warning is the chunk-size advisory:
  `dist/assets/index-BGCjSR6C.js 554.70 kB │ gzip: 165.47 kB` exceeds the
  500 kB limit. Pre-existing, non-blocking.
- No test was skipped. `visual.log` has no `failed`, `flaky` or `skipped` line.

---

## 5. Fresh Windows package

Built once, with no other Tauri/Rust build running (verified: zero
`cargo`/`rustc` processes before the build, and the previously running
`paka.exe` PID 8084 was stopped first because Windows locks running binaries).

```
$ pnpm tauri build
> beforeBuildCommand `pnpm build`  -> built in 251ms
> Compiling paka v0.1.0 (src-tauri)
> warning: linker stderr: ... ld.exe: .rsrc merge failure: multiple non-default manifests
> Finished `release` profile [optimized] target(s) in 1m 32s
> Finished 2 bundles at: ...
```

**Packaging exit code: not captured as a number.** The command was run as a
backgrounded `Tee-Object` pipeline, which does not propagate the child exit
status to the harness. Success is established by evidence instead of assertion:
the log's last two lines are the bundle report, there is no error line anywhere
in `tauri-build.log`, and both bundles were rewritten inside the build
window (log created 17:37:47, bundles 17:39:33 / 17:39:46). This is a
measurement gap, not a passed check inferred from an old run.

| Artifact | Bytes | Timestamp | SHA-256 | Fresh this run |
| --- | --- | --- | --- | --- |
| `src-tauri/target/release/paka.exe` | 3,587,584 | 2026-10-23 17:39:46 | `74374B37D0670DF1F289619CD51910571DA2E9E81136458765AD8EA86756485A` | yes (relinked and bundle-patched) |
| `src-tauri/target/release/bundle/msi/Paka_0.1.0_x64_en-US.msi` | 2,039,808 | 2026-10-23 17:39:33 | `25E02D1E453D7D7D572CEF7B855466042EC9E9794CFAF39400BE7C8FC984CC09` | yes |
| `src-tauri/target/release/bundle/nsis/Paka_0.1.0_x64-setup.exe` | 1,464,865 | 2026-10-23 17:39:46 | `0D8552DEA4348F95B795441B74B7A72074AF60340F778889C3C1661F533D96C6` | yes |

The executable's byte count matches the earlier `--no-bundle` build (3,587,584)
because the Rust binary is deterministic; the timestamp and hash above are from
this run, and the smoke test in §6 ran against **this** file (PID 29776, later
3492), not the earlier one.

Pre-existing binaries were copied, not discarded, to
`D:/Dev/Paka-overnight-worktrees/preserved-builds/2026-10-23-pre-rc/`:

- `paka-17-30-20.exe` (3,587,584 B)
- `Paka_0.1.0_x64_en-US-14-22-14.msi` (2,039,808 B)
- `Paka_0.1.0_x64-setup-14-22-25.exe` (1,463,073 B)

Build warning, unchanged from earlier waves and non-blocking: MinGW
`ld.exe: .rsrc merge failure: multiple non-default manifests` — the link still
succeeds. **The binaries are not code-signed.**

---

## 6. Packaged smoke test

Method: the freshly built `paka.exe` was started with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"` and
driven through Playwright `chromium.connectOverCDP("http://127.0.0.1:9222")` —
the same method as the layer-group wave. This is the packaged Tauri window
(WebView2 155.0.4283.60, `native windows/x86_64` in its own status bar), not
`pnpm dev`. No keyboard input was sent to a shared desktop; every native dialog
was avoided rather than guessed at.

### 6.1 Startup and shell

`packaged-smoke.log` — exit 0, `errors: []` (no page errors, no console
errors), the app shell and canvas mounted, one-row context bar at y=34,
document bar at y=68, dock at 216 px wide, layers body 159 px, status bar at
y=757, no page overflow. `paka-window.png`.

### 6.2 Stroke, undo, redo

`packaged-stroke-undo.log` — a real pointer stroke moved history 0 → 1,
`Ctrl+Z` → 0, `Ctrl+Y` → 1, no errors.

### 6.3 Layer groups through the UI

`packaged-groups.log`, `packaged-groups-draw.log`,
`packaged-delete-undo.log`, `packaged-group-render.log`.

| Action | Observed |
| --- | --- |
| Create an empty group, rename it "Shading" | row appears, rename commits on Enter |
| Move "Layer 1" into it | child indented (depth 1), group count "1" |
| Paint while the child is active | strokes land inside the group |
| Hide / show the group | child reports `inheritedHidden` true/false |
| Collapse / expand | child leaves/returns to the tree |
| Hide the group and read the canvas | canvas pixels change; showing restores the **exact** previous screenshot (hash `0d9397b4269303cf` before and after) |
| Delete the non-empty group | prompt "This group holds 1 layer…"; both group and child disappear; `Ctrl+Z` restores both |

### 6.4 Canvas presets and the raster budget

`packaged-canvas-4k.log`, `packaged-canvas-budget.log`.

- File → New Document on a dirty document first raises "Start a new document?"
  with "Discard and create" — the unsaved-changes guard works in the package.
- "4K UHD" preset creates **3840 × 2160**, fresh history 0.
- Typing 8192 × 4096 (33.5 M px) **disables Create** and shows: *"Size must be
  between 8 and 8192 px per side, and at most 16,777,216 px in total…"*.
- The "Panorama" preset (8192 × 2048 = exactly 16,777,216 px) **enables
  Create** — the documented budget boundary is honoured.

### 6.5 Krita 4 presets: import, idempotency, apply, persistence

`packaged-krita.log`, `packaged-krita-apply*.log`,
`packaged-krita-after-restart.log`.

| Step | Observed |
| --- | --- |
| First click on "Krita 4" | rows 6 → **87** (exactly +81), message "Imported 81 brushes." |
| Second click | rows stay 87, message "The Krita 4 brushes are already in the library." |
| Apply "Krita - Ink-8 Sumi-e" | row selected and `aria-current`; the brush **Size** field moves from 3 → **60**, the preset's own size — the translated fields reach the engine |
| Draw with it | stroke committed, history +1 |
| Settings file | `%APPDATA%/com.paka.drawing/settings.json` holds **81** `Krita - …` entries with full brush objects (size, opacity, colour, hardness, pressure, spacing, tip, texture, stamp) |
| Restart the app, click "Krita 4" | library already at 87, adds nothing, "already in the library" — persistence and idempotency across a restart |

`packaged-overlay-symmetry-on.png` shows the imported library, the applied
"Krita - Ink-8 Sumi-e" and its 60 px preview.

### 6.6 Save, reopen, PNG export, overlay exclusion

`packaged-save-direct.log`, `packaged-project.log`,
`packaged-export*.log`, `packaged-open-roundtrip.log`,
`packaged-order-*.log`, `packaged-overlay-*.log`.

- Saved the grouped document with `save-direct` → `packaged-rc.paka`,
  **format `paka-project`, version 13**, 1 root group, 1 layer, 4 strokes.
- Reopened it with `open-direct` (status `opened`, `warnings: []`); the panel
  shows "Shading — group with 1 layer, 4 items" and its child with 4 items.
- **Export before save and after reopen are byte-identical** (85,158 bytes,
  same SHA-256) — the brush artwork survives the round trip.
- Ordering: added a second layer, moved it into the group, saved and reopened.
  The panel order is identical before and after (Shading → Layer 4 → Layer 1),
  and the file stores the same children in bottom-up drawing order
  (Layer 1, Layer 4).
- **Overlay exclusion in the packaged app.** With a 4K document and one
  stroke, three exports were taken and hashed:

  | State | Export bytes | SHA-256 (first 16) |
  | --- | --- | --- |
  | baseline (symmetry off, no selection) | 209,483 | `BCFCD1FB236BB38D` |
  | symmetry **Both** — axes drawn on canvas | 209,483 | `BCFCD1FB236BB38D` |
  | lasso selection active — marquee + handles | 209,483 | `BCFCD1FB236BB38D` |

  `packaged-overlay-symmetry-on.png` shows the cyan axes, and
  `packaged-overlay-selection-on.png` shows the dashed lasso frame, its
  handles and the status bar reading **"1 selected"**. Neither state changes a
  single byte of the export, so guides, symmetry axes, selection frames and
  handles, rulers and the cursor are all excluded.
- `packaged-export-before.png` (1600 × 1200) is visually the two strokes on
  white, painted inside the group — no chrome, no overlays.

### 6.7 Fill in the package

`packaged-fill-global.log` — Bucket fill on a paintable child, Mode
**Global**, Sample **1x**, changed the canvas and added one history step.
Attempting the same while a *group* was the active node is refused with the
status hint "This is a layer group. Select a layer inside it to draw." — the
group guard holds.

---

## 7. Not verified, and why

1. **Native file dialogs.** The Win32 save/open/export pickers were not driven.
   `save-direct`, `open-direct` and `export-direct` replace only the picker and
   call the product's own `ProjectFiles`/`ProjectGateway`; everything after the
   path choice (serialization, format v13, file write, export encode) is the
   real code. **What this does not prove:** that the Tauri dialog plugin opens,
   filters and returns a path correctly on a user's desktop. The serializer and
   export tests are unit/visual evidence, not dialog evidence.
2. **Installer execution.** The MSI and NSIS installers were built but not
   installed. The smoke ran `target/release/paka.exe`. Install/uninstall,
   shortcut creation and per-user paths are unverified.
3. **Code signing / SmartScreen.** The binaries are unsigned.
4. **Exact pixel diff of export vs on-screen composite.** The export was
   verified by byte-identity across reopen and overlay states plus visual
   inspection, not by comparing it pixel-for-pixel with the zoomed display
   composite (different scales make that comparison an approximation).
5. **Layer ordering with more than two children** and **drag-and-drop**
   reordering in the packaged app. The move-in-group ordering above is real;
   deep ordering is covered by `layerGroups.test.ts` and the visual specs.
6. **`origin/main`'s `514b69d`** is excluded by instruction and remains
   unmerged; the candidate does not depend on it.
7. **Notion.** The workspace is not reachable from this environment (login
   wall, no token, no MCP resources), so this report is delivered in-repo as
   Markdown instead of being published there.

---

## 8. Product limitations (unchanged, stated for the record)

- **Krita import is a translation, not a `.kpp` reader.** 81 of the bundle's
  117 presets use engines Paka has (`paintbrush`, `roundmarker`,
  `sketchbrush`, `spraybrush`, `hairybrush`) and a normal paint composite. The
  other 36 need engines Paka lacks, are erasers, or paint with per-stroke
  composites (dodge, multiply, overlay…) that Paka only offers per layer. No
  Krita binary asset is shipped; only names and numbers, re-rasterized by Paka.
  Paka has no per-sensor curves and no image tips, so the strokes read like the
  Krita brushes, not identically.
- **Layer groups** composite children in isolation and support nesting,
  visibility, opacity and blend. There are no clipping masks or group
  pass-through modes beyond what `blendModes.ts` lists.
- **Canvas budget** is a hard 8192 px per side and 16,777,216 px total, which
  is what makes 4K, A4-300, Panorama and Square-max safe; larger documents are
  refused rather than attempted.
- Windows x64 only; unsigned.

---

## 9. Blockers

None for the candidate itself. The gaps in §7 are measurement gaps and
deliberate scope boundaries, not known defects. Nothing in this run contradicts
the application report, so `docs/qa/app-report/APP-REPORT.md` was **not**
modified.

---

## 10. Reproduction

```powershell
cd D:/Dev/Paka-overnight-worktrees/integration
git rev-parse HEAD            # b7953df345abccb3d1c84a3b2740e77019661599

pnpm typecheck
pnpm test
pnpm test:visual
pnpm build
pnpm tauri build              # no other cargo/rustc running

$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
Start-Process src-tauri/target/release/paka.exe
node scripts/smoke-packaged.mjs docs/qa/release-candidate
node scripts/packaged-layer-groups-step.mjs draw
node scripts/packaged-layer-groups-step.mjs group
node scripts/packaged-layer-groups-step.mjs save-direct docs/qa/release-candidate/packaged-rc.paka
node scripts/packaged-layer-groups-step.mjs project docs/qa/release-candidate/packaged-rc.paka
node scripts/packaged-layer-groups-step.mjs export-direct docs/qa/release-candidate/packaged-export-before.png
node scripts/packaged-layer-groups-step.mjs open-direct docs/qa/release-candidate/packaged-rc.paka
node scripts/packaged-layer-groups-step.mjs export-direct docs/qa/release-candidate/packaged-export-after.png
node scripts/packaged-rc-step.mjs krita
node scripts/packaged-rc-step.mjs krita-apply "Krita - Ink-8 Sumi-e"
node scripts/packaged-rc-step.mjs canvas "4K UHD"
node scripts/packaged-rc-step.mjs budget
node scripts/packaged-rc-step.mjs overlays symmetry-on
node scripts/packaged-rc-step.mjs overlays selection
node scripts/packaged-rc-step.mjs fill
node scripts/packaged-rc-step.mjs stroke-undo
# restart paka.exe, then:
node scripts/packaged-rc-step.mjs krita   # expect 87 -> 87, "already in the library"
```

---

## 11. Evidence inventory

| Path | What it is |
| --- | --- |
| `docs/qa/release-candidate/BRANCH-AUDIT.md` | ancestry, merge bases, feature→commit map, verdict |
| `docs/qa/release-candidate/REPORT.md` | this report |
| `docs/qa/release-candidate/typecheck.log` | `pnpm typecheck` |
| `docs/qa/release-candidate/test.log` | `pnpm test` |
| `docs/qa/release-candidate/visual.log` | `pnpm test:visual` |
| `docs/qa/release-candidate/build.log` | `pnpm build` |
| `docs/qa/release-candidate/tauri-build.log` | `pnpm tauri build` |
| `docs/qa/release-candidate/packaged-*.log` | every packaged step, exit code in the caller, JSON in the file |
| `docs/qa/release-candidate/packaged-rc.paka` | the saved v13 project with the group and four strokes |
| `docs/qa/release-candidate/packaged-order.paka` | the two-child group used for the ordering check |
| `docs/qa/release-candidate/packaged-export-before.png` / `-after.png` | the exported composite, byte-identical across reopen |
| `docs/qa/release-candidate/packaged-overlay-*.png` | baseline, symmetry axes, lasso selection, and their exports |
| `docs/qa/release-candidate/paka-window.png`, `packaged-group-hidden.png` | packaged shell and the hidden-group state |
| `scripts/packaged-rc-step.mjs` | the Krita / canvas / budget / overlay / fill / undo packaged steps |
