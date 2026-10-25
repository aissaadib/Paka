# Feature wave — what the app can do, three finished features, and the packaged build

Branch: `integration/feature-wave`, cut from the verified UI-redesign tip
`0cfd982` (itself on `feat/ui-reference-redesign`). Final commit on this branch:
**`0b22505`**. Nothing is pushed to `main`, and no other branch was rewritten,
merged or rebased. The 27 untracked `qa/` files and the packaged artifacts that
were already on disk are untouched.

The wave had one rule: **audit the code, not the buttons.** A control in the
options bar is not a feature until a test drives the real engine gesture and
the real renderer. The audit therefore classified every capability, and the
implementation picked the three largest gaps that could be closed without a
project-format change.

## 1. Method

1. Read the tool registry, the engine's gesture router, the renderer's element
   path and the format's version, then cross-checked each against its tests.
2. Grepped for modules that are tested but imported only by tests. Five such
   modules existed at `0cfd982`: the fill scan (`fillScan`/`fillOptions`), the
   symmetry model (`symmetry.ts`), the selection-combining model
   (`selectionModes.ts`), the reference-image stack (`core/reference/*`) and
   parts of `layerGroups.ts`. That gap - **built and tested, not wired** - is
   the cheapest capability in the repository, so it set the wave's scope.
3. Implemented in three thin slices, each behind its own commit, each touching
   the shared engine (`DrawingEngine.ts`) only in its own block. There was one
   owner for the shared interfaces; parallel agents were used for read-only
   audit only, because every drawing feature edits the same engine file.
4. Re-ran the full matrix on the final commit, then packaged once, sequentially.

## 2. What the app can actually do

| Capability | State | Evidence |
| --- | --- | --- |
| Brush and eraser: size, opacity, hardness, pressure size/opacity/curve, texture/grain, stamp tips, spacing, stabilizer, primary/secondary colour pair | **Implemented and verified** | `brushSettings`, `strokeBuilder`, `stabilizer`, `stampCoverage`, `canvas2dStroke`, `canvas2dRenderer`; visual scenes `hard-brush`, `soft-brush`, `grain-brush`, `stamped-brush`, `soft-erase-rim` |
| Brush presets: built-in set, save, apply, rename, duplicate, delete, favourite, search, sort, import/export library | **Implemented and verified** | `brushPresets`, `presetBrowser`, `presetTransfer`, `presetLibraryFiles`; packaged smoke reads 6 brush rows |
| Line, rectangle, ellipse, polygon, star: fill, polygon sides, star inner ratio, rigid rotation | **Implemented and verified** | `shapeGeometry.test.ts` (51 tests: vertex counts, clamps, rotation, closed outline); visual scenes `polygon`, `star` |
| Bucket fill: tolerance, contiguous/global region, sample scale | **Implemented and verified in this wave** | `fillScan`, `floodFill`, `fillOptions`; engine tests added in `b723f46` |
| Gradient: linear/radial, stops (including mid stops), on-canvas handles, nudge, one undo step | **Implemented and verified** | `gradient.test.ts`, `gradientEditing.test.ts`, visual scene `gradient` |
| Selection: rectangle, freehand lasso, Shift add / Alt subtract / Shift+Alt intersect, select all, invert, deselect, move, nudge, duplicate, delete, scale/rotate handles | **Implemented and verified in this wave** (lasso, combining, all/invert/deselect are new) | `strokeSelection.test.ts`, `selectionCombining.test.ts`, `selectionTransform`, `selectionHandles`, engine tests; visual `selection-menu`, and a new browser test in `feature-wave.spec.ts` |
| Colour picker (foreground and background), colour formats, contrast/difference readouts | **Implemented and verified** | `colorInput`, `colorMetrics`, `colorPair`, picker tests, visual `color-compare` |
| Guides (drag, snap, delete, duplicates), rulers, grid and snapping, symmetry | **Implemented and verified**; symmetry is new | `guides`, `drawingAids`, `grid`, `gridSnapping`, `rulerOverlay`, `symmetryAxesOverlay`; symmetry tests added in `0b22505` |
| Pan, zoom (buttons, field, fit, actual size), rotate/mirror view, navigator | **Implemented and verified** | `viewNavigation`, `navigator.test.ts`, `viewport` |
| Layers: add, duplicate, delete, rename, visibility, opacity, blend mode, reorder | **Implemented and verified** | `document.test.ts`, `blendModes`, `canvas2dRenderer`, layers panel in the visual shell test |
| Layer **groups** | **Core, commands, renderer and format are ready; no UI and no engine action** | `layerGroups.ts`, `documentCommand.ts` (`createGroupLayersCommand`, `createDissolveGroupCommand`), grouped rendering tests, v13 format reads/writes groups. `LayersPanel.tsx` and `EditorActions` have no group operation |
| Layer **locking** | **Missing** | No lock field in the layer model, the project format or the panel |
| Undo / redo across strokes, shapes, fills, gradients, selection edits, guides, layer operations | **Implemented and verified** | `commandStack`, `strokeCommand`, `documentCommand`, engine and visual tests |
| Project: save, save as, open, versioned format (v13), size guard, malformed-file rejection | **Implemented and verified** | `projectFormat` (77 tests), `projectFiles`, `projectLifecycle` (19 tests), packaged save (see §7) |
| PNG export of the document composite (no overlays, no guides, no selection chrome) | **Implemented and verified at the pixel level**; the native export dialog is not automated | `pngExport.test.ts` (8 tests), the visual harness compares the live, rebuilt and exported renderings of every scene |
| Autosave and crash recovery | **Built but deliberately disabled** | `autosaveService.ts`, `recovery.ts`, `autosave.test.ts`; enabling it is an owner policy decision |
| Reference images | **Pure modules only** — decode, geometry and store are tested, nothing outside tests imports them | `core/reference/*`, `referenceImages.test.ts`; no engine seam, no renderer pass, no panel |
| A second view of the same document | **Missing** | `canvasViews.ts` is the navigator/overview geometry, not a display-target registry; no engine `openSecondaryView`-style API |
| Multiple open documents (tabs) | **Missing** | No session registry in this baseline |
| Canvas resize / crop | **Missing** | No document command and no format field for it |
| Text, vector paths, pixel-mask selection | **Missing** | Not in `ToolId`; the selection model is stroke-based and does not select fill patches or gradients by region |

The tool inventory is exactly thirteen tools: `brush`, `eraser`, `select`,
`line`, `rectangle`, `ellipse`, `polygon`, `star`, `bucket`, `gradient`,
`picker`, `guides`, `pan`. The wave added no tool; it made three existing ones
do what their models already described.

## 3. The three slices

### 3.1 Bucket: global fills and a sample scale — `b723f46`

**Why.** The engine called the legacy single-mode flood fill, while
`core/fill/fillScan.ts` already implemented a contiguous scan, a global scan,
tolerance matching and a sampling scale, with its own test suite. The bucket
therefore had a tolerance control and nothing else.

**What changed.**
- `src/core/engine/DrawingEngine.ts` now runs `scanFill` with the fill options.
  `fillMode` (`contiguous` | `global`) and `fillSampleScale` (1, 2, 4 or 8) are
  editor state in the snapshot, with setters and normalisation. The tolerance-0
  no-op guard is kept at full resolution, where "exactly the seed colour" has
  always meant "nothing to fill".
- An over-budget document is refused with a notice that names the pixel count
  and the limit; it does not dirty the document or add history.
- `src/state/editorStore.ts` exposes `setFillMode`/`setFillSampleScale`.
- `src/features/options/toolOptionSchema.ts` adds **Mode** and **Sample** to the
  bucket's options group.
- Tests: a global fill reaches both islands of one colour, the sample scale
  clamps 3 → 2, 99 → 8 and `NaN` → 1, and a fill is still one undo step.

**Why no format bump.** A committed fill stores its pixels; the options
describe the next fill only.

### 3.2 Selection: lasso marquees and combining modes — `a141137`

**Why.** The selection model could already add, subtract and intersect id
sets, but the engine only built rectangle marquees and replaced the selection
on every drag. The `selectionModes` module was imported only by its test.

**What changed.**
- `src/core/document/strokeSelection.ts` gains the pure polygon geometry:
  point-in-polygon (even-odd), segment intersection, point-to-segment distance,
  path bounds, and a padded stroke-versus-polygon test so a thin stroke that
  merely touches the traced region is still selected.
- `src/core/document/selectionModes.ts` gains `SelectionShape`
  (`rect` | `lasso`), `SELECTION_SHAPES`, `normalizeSelectionShape`,
  `SelectionCombine`, `selectionCombineFor` (Shift add, Alt subtract,
  Shift+Alt intersect) and `combineSelectionIds`.
- The engine samples the lasso path as the pointer moves (2 px apart, at most
  2000 points), closes it on release and selects the strokes inside or crossing
  it. The combine mode is captured at press time, so releasing a modifier
  mid-drag cannot change what the gesture does. A lasso *click* with no drag
  falls through to the ordinary point hit-test instead of selecting an empty
  region.
- The renderer paints the committed marquee as a dashed closed path
  (`RendererSelection.path`).
- Editor actions and shortcuts: **Select All** (`Ctrl+A`), **Invert**
  (`Ctrl+Shift+I`), **Deselect** (`Ctrl+Shift+D`). `Ctrl+D` remains Duplicate.
  Selecting changes no pixels: no history step, no dirty flag.
- The select tool's options group gains **Shape** (Rectangle / Lasso), which is
  editor state and survives a tool switch.
- Tests: new cases across `strokeSelection.test.ts`,
  `selectionCombining.test.ts` (new), `drawingEngine.test.ts`,
  `toolOptions.test.ts` and `actions.test.ts`; a browser test drives a real
  lasso and reads `1 selected` from the status bar.

### 3.3 Symmetry: mirrored strokes across one or both axes — `0b22505`

**Why.** `core/document/symmetry.ts` already modelled vertical, horizontal and
four-way mirroring, with an axis overlay (`symmetryAxesOverlay.ts`) that was
painted by the overlay registry and tested, but no gesture ever produced a
copy.

**What changed.**
- `src/core/commands/strokeCommand.ts`: `createStrokesCommand(strokes, indices,
  host)` inserts a whole group and removes it again as **one** history step.
  The original and its copies share a layer and are inserted in painting order,
  so a redo restores the exact order.
- `src/core/engine/DrawingEngine.ts`: symmetry settings in the snapshot
  (`symmetryEnabled`, `symmetryMode`, `symmetryVerticalAxis`,
  `symmetryHorizontalAxis`), setters (`setSymmetryMode`, `setSymmetryEnabled`,
  `setSymmetryAxis`) and one commit path. On `finishStroke`, the stroke's
  samples are reflected with `mirrorPoint`; a mirror that moves no sample is
  dropped, because it would repaint the original on itself. Copies are ordinary
  `StrokeRecord`s with fresh ids - same brush, pressure, times and the shape
  `filled` flag - so an undo, a reopen and an export need to know nothing about
  symmetry.
- The axes auto-centre when the symmetry is first switched on and when the
  document is created or opened; axis positions are rounded and clamped to the
  document. They are display state: no history step, no dirty flag and no
  format change. The overlay is the already-tested
  `symmetryAxesOverlay`, synchronised through `setSymmetryOverlaySettings`.
- The options bar gains a **Symmetry** group - mode (Off / Vertical /
  Horizontal / Both) and, only for the axes in force, **Axis X** / **Axis Y** -
  on every tool that commits a stroke: brush, eraser, line, rectangle, ellipse,
  polygon and star. (Shapes commit through the same `finishStroke` path, so a
  filled polygon's mirrored copy is filled too.)
- Tests: six engine cases (vertical, four-way, on-axis self-mirror, off,
  axis clamping without history), two command cases (group undo/redo, erase
  label), three options cases (per-mode axis visibility, read/write,
  unknown-value refusal), and a four-test browser spec that draws with
  four-way symmetry, reads `4 selected`, then undoes the whole gesture with one
  `Ctrl+Z` and confirms `history 0`.

**Known limitation.** The mirrored copies appear when the gesture is committed;
the *live* ink preview during the drag still shows only the original stroke.
Mirroring the preview needs a second scratch surface in the renderer (the
stroke rasterizer forces `globalAlpha = 1`, so a copy cannot be composited
cheaply over the live buffer). That was deliberately not attempted in this
wave.

## 4. Deferred, and the concrete blocker

| Item | Why it was not in this wave | What would unblock it |
| --- | --- | --- |
| Layer groups in the panel | The model, the commands (`createGroupLayersCommand`, `createDissolveGroupCommand`), the renderer and the v13 format are already there; only a panel UI and an engine action are missing | Add `groupLayers`/`dissolveGroup`/`moveLayerIntoGroup` to `EditorActions` and a group row with drag-into-group to `LayersPanel`; no format bump |
| Layer locking | No lock field exists anywhere | Layer model field + format v14 + command + panel toggle + renderer/engine guard |
| Reference images | The decode, placement geometry and store are tested pure modules, but nothing wires them to the engine or the renderer | Engine source/state, a renderer pass before ink, a panel, and an explicit "never in export" test |
| A second view | There is no display-target registry in this baseline | Renderer display targets + a view registry + panel; large |
| Multiple documents (tabs) | No session registry; the app has one document and one engine | `DocumentSessionRegistry`, per-document engine lifecycle, tab strip, close/unsaved rules |
| Canvas resize / crop | No command, no format field, and a crop has to decide what happens to strokes outside the new bounds | Document command + format field (v14) + stroke/guide remapping + viewport refit |
| Autosave / recovery | The service and recovery path exist, but the policy is the owner's decision | Decide cadence, location, retention and the interaction with a user save; then enable |
| Live symmetry preview | Renderer scratch-surface work (see §3.3) | A mirrored preview surface in `Canvas2DRenderer` |
| Pixel-mask selection | The selection is a set of stroke ids; fills and gradients are not selectable by region | A selection-mask model, renderer overlay and element-kind-aware transforms |
| Text and vector paths | Not in the tool registry at all | New tool + element kinds + format version |

## 5. Sequencing and ownership

Every feature in this wave edits `DrawingEngine.ts`, and two also edit
`toolOptionSchema.ts` and `editorStore.ts`. Parallel implementation would have
produced three conflicting versions of the same snapshot and history code, so
the wave was **sequential with one owner** for those files. Parallel agents were
used only to read and classify (the inventory), where their work does not
overlap.

The dependency chain that settled the order:

```
pure model / test-only module
        │
        ▼
engine state + gesture + one history step   ← shared engine (one owner)
        │
        ├──► EditorActions (store surface)
        ├──► toolOptionSchema (the control)
        └──► renderer (only where pixels must change)
```

Fill needed only the engine and the options schema. Selection needed the pure
polygon geometry, the engine, the renderer (the dashed marquee) and the action
registry. Symmetry needed a new multi-element command *before* the engine could
commit copies in one undo step - which is why the command was written first and
tested on its own.

## 6. Verification on the final commit (`0b22505`)

Every command below was run in the worktree
`D:/Dev/Paka-overnight-worktrees/integration` on branch
`integration/feature-wave`, at `0b22505`, with a clean working tree apart from
the report and the packaging script added after it.

| Command | Result |
| --- | --- |
| `pnpm typecheck` | clean (strict TypeScript, no errors) |
| `pnpm test` | **91 files, 2306 tests passed** (baseline `0cfd982`: 90 files, 2276) |
| `pnpm test:visual` | **62 passed** (baseline: 58; the four new tests are `tests/visual/feature-wave.spec.ts`) |
| `pnpm build` | production bundle built: 516.00 kB JS (156.50 kB gzip), 37.14 kB CSS. The >500 kB chunk warning is pre-existing |
| `pnpm tauri build` | released `paka.exe`, MSI and NSIS in 1m41s of Rust (the linker emits a pre-existing "multiple non-default manifests" warning) |

Targeted evidence for the behaviours the wave could have broken:

| File | Tests | What it covers |
| --- | --- | --- |
| `src/test/drawingEngine.test.ts` | 166 | undo/redo, tool switching, pointer cancellation, selection, fill, symmetry, guides, gradients |
| `src/test/projectFormat.test.ts` | 77 | v13 round trips, every older version's migration, malformed and oversized files |
| `src/test/projectLifecycle.test.ts` | 19 | save → reopen → compare, cancelled dialogs, failed writes |
| `src/test/pngExport.test.ts` | 8 | export dimensions, background, overlays excluded |
| `src/test/selectionCombining.test.ts` | 6 | add/subtract/intersect and replace semantics |

The new browser spec is behavioural, not a pixel golden: it reads the engine's
own status bar (`N selected`, `history N`, the unsaved marker) after real
pointer and keyboard input, so it is stable across platforms:

1. bucket options show Mode/Sample, change them, and keep them across a tool
   switch;
2. a lasso traced around a stroke selects exactly one stroke;
3. `Ctrl+A` selects 2, `Ctrl+Shift+I` inverts to none, inverts back, and
   `Ctrl+Shift+D` deselects, with history unchanged;
4. four-way symmetry draws four strokes, selects four, and one `Ctrl+Z` takes
   all four away (`history 0`) before one redo restores them.

## 7. Packaged Windows build and smoke test

`pnpm tauri build` on `0b22505` produced:

| Artifact | Size |
| --- | --- |
| `src-tauri/target/release/paka.exe` | **3,578,880 bytes** (3.41 MiB) |
| `src-tauri/target/release/bundle/msi/Paka_0.1.0_x64_en-US.msi` | **2,031,616 bytes** (1.94 MiB) |
| `src-tauri/target/release/bundle/nsis/Paka_0.1.0_x64-setup.exe` | **1,456,336 bytes** (1.39 MiB) |

The build is sequential (frontend build, then one Rust release build, then the
two bundles). The packaged window was started with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and driven
through WebView2's DevTools protocol with `scripts/smoke-packaged.mjs`. The
window's client area was 1440x779 (the configured 1440x900 outer size).

| Check | Result |
| --- | --- |
| Page overflow | 0 px |
| Options bar / document bar | 38 px / 34 px at y=30 and y=68 (the new Symmetry group does not grow the row) |
| Dock / layers | 360 px / 295 px, layers body 169 px |
| Dock tabs | Color, Brushes, Navigator, Shortcuts; Color active |
| Status bar | 22 px, bottom at 779 (inside the window) |
| Stroke through the real pointer path | history entry created; **Undo** enabled |
| Undo | consumed the entry; **Undo** disabled again |
| Brushes tab | 6 preset rows |
| Console/page errors | none |

Screenshot: `docs/qa/feature-wave/packaged/paka-window.png` (the packaged
application, not the browser - the status bar reports `native windows/x86_64`).

### Save, reopen and export in the packaged app

The native file dialogs are Win32 windows that the DevTools protocol cannot
address. What was verified, and how:

- **Save is real.** `Ctrl+S` opened the native **Save project** dialog; invoking
  its **Save** button wrote a 14,739-byte project to the dialog's default
  location. The app then reported `Saved Untitled.paka`, and the file parsed as
  `format: paka-project`, `version: 13`, `1600 x 1200`, 1 layer, **2 strokes**.
- **A second save needs no dialog.** With the path now known, drawing two more
  strokes and pressing `Ctrl+S` rewrote the same file with **4 strokes**; the
  status bar returned to `Saved`. The temporary file was removed afterwards.
- **The dialog's path field was not driven.** The filename control is a
  DirectUI host that ignores synthetic `WM_SETTEXT`/UIA value injection, and the
  save used the dialog's default name and folder. Blind `SendKeys` was stopped
  because the shared desktop was in active use by another fullscreen
  application, so keystrokes could have landed in the wrong window. Claiming a
  chosen-path save would therefore be dishonest.
- **Open and PNG export were not exercised in the packaged window.** Both go
  through the same native dialogs; the open dialog exposes an empty filename
  combo that synthetic input did not reach, and the export dialog was not
  attempted after that. Their correctness is covered instead by
  `projectFiles.test.ts` / `projectLifecycle.test.ts` (the real serializer,
  reader and file sequencing against a scripted gateway) and by
  `pngExport.test.ts` plus the visual harness, which compares the live, rebuilt
  and exported rendering of every scene.

This is the honest boundary of the packaged smoke: the shell, the pointer path,
undo, the options bar with the new controls, and the real save path are
verified in the packaged binary; the native open/export dialogs are not.

## 8. Limitations and defects found, not fixed

- The live symmetry preview lags the committed result (see §3.3).
- Selection is stroke-based. A fill patch or a gradient cannot be selected by
  dragging a marquee over it; only strokes are hit. This is a model limitation,
  not a regression.
- Layer groups are invisible in the UI even though the format preserves them.
  A project authored elsewhere with groups opens and renders correctly, but the
  panel shows the flat paintable layers and offers no group action.
- `scripts/packaged-file-step.mjs` is a smoke-test helper, not product code. It
  depends on the app running with port 9222 and on the status bar's DOM; it is
  committed only so the next wave can repeat the packaged save check.

## 9. What the next wave should take

Ranked by value per unit of risk, with the blockers from §4:

1. **Layer groups in the panel** (no format bump). The core is ready; this is a
   UI + engine-facade slice with a real user-facing payoff and low risk.
2. **Reference images end to end.** Decode, geometry and store are already
   tested; the missing pieces are an engine seam, one renderer pass before ink,
   a panel, and a test that an export never contains the reference.
3. **Canvas resize / crop** (format v14). High value for a drawing app, but it
   must define what happens to strokes and guides outside the new bounds, so it
   needs a design decision before code.
4. **Layer locking** (format v14) - best done together with the crop/format
   revision.
5. **Live symmetry preview** - renderer scratch surface; polish, not capability.
6. **Multi-document tabs** - the largest item; keep it separate from any format
   work and give it its own wave.

Not recommended next: more per-tool buttons. The inventory shows the remaining
gaps are model-shaped (groups, masks, document geometry, reference images), not
control-shaped.
