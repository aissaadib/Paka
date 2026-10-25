# Consolidation ledger

What this branch is, what it took from the other work, what it refused, and
what it verified. Written at the tip of `integration/consolidation`.

## 1. Recovery points and branch

| Ref | Commit | Meaning |
| --- | --- | --- |
| `integration/consolidation` | `eac9c17` | this round's work (2 commits) |
| tag `integration/pre-consolidation-8bd164e` | `8bd164e` | the verified wave-3 + wave-4 tip, untouched |
| `integration/wave-3-shell` | `8bd164e` | the previous verified branch |
| `preserve/swarm-working-tree` | `0f47ea6` | the other swarm's converged tree, untouched |
| `verify-main` (worktree) | `514b69d` | scratch tree used to measure `origin/main` |

`8bd164e` was verified before this round and again after it. Nothing was
rebased, reset or force-pushed; `main` was not touched.

## 2. The other branches, measured rather than read

`origin/main` at `514b69d` (its own repair commits included) is **not a
compiling tree**:

- `tsc` reports **401 errors across 5 files**;
- three of those files do not parse at all (`BrushCursor.tsx`,
  `ToolOptionsBar.tsx`, `core/actions/registry.ts`), so **26 of 70 test files
  never load**;
- the 821 tests that do run are the ones whose imports survive.

The corruption was introduced by merges (`5db8524`, `fae9aa1`), not by the
feature commits themselves: `4428116`'s `BrushCursor.tsx` is 110 clean lines,
`origin/main`'s copy is 156 mangled ones. So `origin/main` is neither a usable
base nor a safe source of UI files, and its repair commits did not restore it.

A dry-run merge of `origin/main` into this branch (`git merge-tree`, no working
tree touched) reports **277 conflicting paths**. Both branches independently
implemented the same 29 areas, so that merge is a choose-one-per-file rewrite,
not an integration. It was rejected: it would not be reviewable and would risk
silently losing whichever side lost each file.

`preserve/swarm-working-tree` (`0f47ea6`) is 8 commits of the same work at its
pre-merge state; its own green numbers were reported by its authors and were
not re-measured here.

## 3. What was integrated this round

Two commits, both additive, both verified:

### `a129f26` — the built-in panels join the registry

Navigator, Shortcuts and the brush browser were written, tested and *never
imported*, so the shell's registry never knew them and the side column showed
only Color and Layers. `src/app/panelModules.ts` imports them for their side
effects and registers the browser (which takes parameters). The app now shows
five panels: Color, Layers, Brushes, Navigator, Shortcuts.

### `eac9c17` — the overlay registry reaches the display

The overlay registry and the ruler painter existed and were tested, but the
renderer never painted the registry, so rulers were unreachable. The renderer
now paints the `under` layer before the document and the `over` layer after the
selection, handing each overlay the frame geometry, the selection bounds and
the device pixel ratio.

Rulers join through that path. `setRulersVisible` is display state: no history
step, no dirty flag, no project field, nothing in an export. It is reachable
from **View > Show Rulers** and `Ctrl+Alt+R` (`Ctrl+R` is the webview's reload).

`src/test/overlayPipeline.test.ts` (7 tests) pins the two rules that make
chrome safe to add: registered overlays are painted on the display canvas, and
their pixels never appear in `composeDocumentImage()` — the surface PNG export
reads.

## 4. Deferred, with the blocker rather than a wish

| Work | Where it exists | Blocker |
| --- | --- | --- |
| Multi-document tabs | `origin/main`: `sessionRegistry`, `documentWorkspace`, `DocumentTabs`, `useDocumentSessions` | Built on that tree's editor store and shell. Porting it means restructuring `editorStore`/`EditorProvider` around a session registry — a deep change that would put the 2270 green tests and the single-engine assumptions at risk in the same commit. Not attempted without the ability to verify tabs-vs-secondary-view semantics. |
| Command palette + canvas context menu | `origin/main`: `commands.ts`, `commandsMenu`/`commandSearch`/`commandRows`/`availability`, two components (~800 lines) | Written against a different `ActionDefinition` (command-only actions, availability reasons) and a different registry. Porting means widening the action contract and re-pointing every command at this engine's `EditorActions`. |
| Secondary view | `origin/main`: `SecondaryViewPanel`, renderer display targets | Needs engine attach/detach plus a viewport rewrite in the renderer; entangled with that tree's viewport changes. |
| Reference images | this branch has the tested model (`core/reference/**`, `referenceImages.test.ts`) | No engine seam (`setReferenceSource` / `syncReferenceOverlay` / picker sampling) and no panel. The panel in `origin/main` is written against a different store API. |
| Symmetry | this branch has the tested model (`core/document/symmetry.ts`, `symmetryAxesOverlay.ts`, `symmetry.test.ts`) | No engine state, no copies at stroke commit, no control. Adding it means touching the hottest path (`finishStroke`) and a new multi-stroke undo command. |
| Layer groups | `core/document/layerGroups.ts`, `layerOrdering.ts` | Not composited by the renderer and not in the layer panel. |
| Workspace profile picker | `features/workspace/WorkspaceProfilePicker.tsx` | It is a component, not a panel, and nothing mounts it; the profiles persist and load, but the picker has no home in the shell yet. |
| Brush library file | `presetTransfer.ts`, `presetLibraryFiles.ts` (tested) | No native `PresetLibraryGateway` implementation exists, so the browser opens with Import/Export disabled rather than pretending. |

Nothing was deleted from those branches; they remain where they were.

## 5. Format and settings

- `PROJECT_VERSION = 13`, **one declaration**, in `core/project/projectFormat.ts`.
  The duplicated declaration that broke wave 2 is not present anywhere; grep
  finds a single assignment. No pixel-affecting change was made this round, so
  the version was not bumped.
- Settings documents: `SETTINGS_VERSION` 1, `WORKSPACE_VERSION` 1,
  `SHELL_PREFERENCES_VERSION` 1. The round added no settings section and no
  preference field, so no version moved and no section was re-registered.
- The rulers toggle is deliberately *not* persisted: it is display state, like
  the grid toggle, and writing it would have needed a settings field the rest
  of the shell does not have.

## 6. Verification at `eac9c17`

| Check | Result |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm test` | **2270 passed / 2270**, 89 files, 0 skipped |
| `pnpm test:visual` | **45 passed / 45**, 28.9 s, bundled Chromium |
| `pnpm build` | 200 modules, `index-CPQM_Zec.js` 496.36 kB (gzip 150.63 kB) |

## 7. Packaged application

`pnpm tauri build` (Tauri 2, sequential, no concurrent Rust build) produced:

| Artifact | Bytes | SHA-256 (first 16) |
| --- | --- | --- |
| `src-tauri/target/release/paka.exe` | 4,845,568 | `E8ECFB67190FB11F` |
| `src-tauri/target/release/bundle/nsis/Paka_0.1.0_x64-setup.exe` | 1,712,907 | `CF63E45819F0DE39` |
| `src-tauri/target/release/bundle/msi/Paka_0.1.0_x64_en-US.msi` | 2,465,792 | `45A53E21D25B477A` |

The binary embeds the frontend build produced at `eac9c17`; rebuilding the
frontend from the same tree reproduces `index-CPQM_Zec.js`, the hash the
release bundle was built with.

Smoke test, driven inside the **packaged** executable over the WebView2
debugging protocol (not the dev server):

- window opens, title `Untitled — Paka`, responding;
- five panels present, status bar present, `innerWidth 1440` at dpr 1.25, no
  overflow at the default size;
- draw at the artwork's centre → `history 1`; `Ctrl+Z` → `0`; `Ctrl+Shift+Z`
  → `1`;
- View > Show Rulers changes the canvas's pixels; `Ctrl+Alt+R` removes them;
- no console errors and no page errors during the run.

Not exercised in the packaged app: save/open (native dialogs need a human),
PNG export end-to-end (same dialogs), fill/selection/transform/navigator
interaction beyond the rendering above, and tabs/secondary views (not
integrated). Their coverage is the unit and visual suites, which is a
different claim from "verified in the packaged binary".

## 8. Preservation

- `qa/` in the shared checkout: 27 files, 0 tracked, newest write
  2026-10-20 19:19:40 — untouched by this round.
- `main` (local `ad2ef11`, `origin/main` `514b69d`): not merged into, not
  pushed to, not reset.
- The other swarm's branches, worktrees and `preserve/**` snapshots: untouched.

## 9. Known limitations

- At the configured minimum window (960×600 logical, client 946×563) the shell
  overflows vertically by 103 px: the five panels and the tool-options bar
  cannot all fit, and the colour dock's contents spill. Panels shrink and the
  page scrolls. A scrollable panel column was tried and reverted: it collapsed
  the Layers panel to zero height and pushed most panels below the fold at the
  default size. The honest statement is that the shell is designed for its
  default 1440×900 and degrades below ~1000×600.
- The rulers' pointer line is implemented in the painter but not fed: the
  engine's cursor report is consumed by the DOM brush cursor, and wiring it to
  the canvas overlay would repaint the canvas on every hover move.
- The ruler overlay's visibility is module state, shared by every engine. With
  one document that is correct; with tabs it would need to move into the
  engine's snapshot.
