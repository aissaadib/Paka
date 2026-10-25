# Branch audit — release candidate

Date: 2026-10-23
Worktree: `D:/Dev/Paka-overnight-worktrees/integration`
Candidate branch: `feat/krita-brushes`
Candidate SHA: **`b7953df345abccb3d1c84a3b2740e77019661599`**
Status at audit: **clean working tree, no untracked files, nothing staged**

All commands below were run in that worktree. Nothing was reset, cleaned,
rebased, force-pushed or merged during this audit. The only existing recovery
tag (`integration/pre-consolidation-8bd164e` → `8bd164e`) and every worktree
listed in §7 were left untouched.

---

## 1. Working state

```
$ git rev-parse --show-toplevel      -> D:/dev/Paka-overnight-worktrees/integration
$ git branch --show-current          -> feat/krita-brushes
$ git rev-parse HEAD                 -> b7953df345abccb3d1c84a3b2740e77019661599
$ git status --porcelain=v1          -> (no output)
```

The candidate is pushed: `origin/feat/krita-brushes` = `b7953df`.

---

## 2. Branches inspected

`git merge-base --is-ancestor <branch> b7953df` and
`git rev-list --count b7953df..<branch>` for each branch:

| Branch | SHA | Ancestor of candidate | Commits not in candidate | Merge base |
| --- | --- | --- | --- | --- |
| `feat/krita-brushes` | `b7953df` | yes (it is the candidate) | 0 | `b7953df` |
| `feat/bigger-canvas-sizes` | `bbf1521` | **yes** | 0 | `bbf1521` |
| `integration/layer-groups-wave` | `6754ff9` | **yes** | 0 | `6754ff9` |
| `integration/feature-wave` | `3af055a` | **yes** | 0 | `3af055a` |
| `feat/ui-reference-redesign` | `0cfd982` | **yes** | 0 | `0cfd982` |
| `integration/consolidation` | `b63fb74` | **yes** | 0 | `b63fb74` |
| `integration/next-build-wave` | `5e5beb0` | **yes** | 0 | `5e5beb0` |
| `feat/movable-panels` | `b146d98` | **yes** | 0 | `b146d98` |
| `main` (local) | `ad2ef11` | **yes** | 0 | `ad2ef11` |
| `origin/main` | `514b69d` | **no** | 1 | `8fe02cc` |

A merge base equal to the branch's own tip, with zero commits outside the
candidate, means the candidate is a **strict descendant** of every required
branch. There is no divergence to reconcile and no merge to perform.

The history is **linear**: `git log --first-parent` from the candidate back to
`b63fb74` lists one parent per commit. 217 commits separate the local `main`
tip from the candidate; 4 separate `bbf1521` from the candidate.

---

## 3. Candidate-only commits

```
$ git log --oneline bbf1521..b7953df
b7953df docs(qa): point the report at both of its editions
07151e3 feat(brushes): widen the Krita 4 pack to 81 presets
e68b4d8 docs(qa): deliver the app report as a text document
4be7fca feat(brushes): add the translated Krita 4 default presets
```

---

## 4. Where each required feature actually lives

These are the commits that introduced the implementation, verified by
`git show --stat` (file counts are real, not inferred from commit subjects).

| Required work | Commit | Date | Files |
| --- | --- | --- | --- |
| UI redesign — tabbed dock, layers share | `7497dce` | 2026-10-22 | — |
| UI redesign — one-row context bar | `5856fc3` | 2026-10-22 | — |
| UI redesign — shell pinned at eight sizes | `30b3884` | 2026-10-22 | — |
| UI redesign — brush browser fits its dock | `018305b` | 2026-10-22 | — |
| UI redesign — size-optimised release build | `0cfd982` (`feat/ui-reference-redesign` tip) | 2026-10-22 | 2 |
| Feature wave — fill: global fills, sample scale | `b723f46` | 2026-10-22 | 5 |
| Feature wave — lasso marquees, combining modes | `a141137` | 2026-10-22 | 14 |
| Feature wave — symmetry across one/both axes | `0b22505` | 2026-10-22 | 10 |
| Feature wave — evidence | `3af055a` | 2026-10-22 | — |
| Layer groups — tree moves, empty groups, group-safe ops | `ff9a3be` | 2026-10-23 | 9 |
| Layer groups — renderer composites the real tree | `945a2fd` | 2026-10-23 | 2 |
| Layer groups — indented, draggable panel tree | `242a5c1` | 2026-10-23 | 21 |
| Layer groups — evidence | `70f5267`, `3ea1ab5`, `d4a8c94`, `6754ff9` | 2026-10-23 | — |
| Panel workflow — move, float, reset | `b146d98` | 2026-10-23 | 14 |
| Bigger canvas presets | `bbf1521` | 2026-10-23 | 7 |
| Krita 4 import (69 presets) | `4be7fca` | 2026-10-23 | 7 |
| Krita 4 widened to 81 presets | `07151e3` | 2026-10-23 | 6 |

---

## 5. Tree verification (not the report's word)

The commits above are only worth what is in the tree at `b7953df`. Each of the
following was confirmed present by `git ls-files`:

| Area | File |
| --- | --- |
| Layer-group model and tree operations | `src/core/document/layerGroups.ts`, `layerOrdering.ts`, `layerDeletion.ts`, `layerTreeDrag.ts` |
| Group compositing | `src/core/rendering/Canvas2DRenderer.ts` (`paintLayerNodes`, group scratch surface) |
| Group UI | `src/features/layers/LayersPanel.tsx` |
| Canvas presets | `src/core/document/canvasSizePresets.ts`, `src/features/document/NewDocumentDialog.tsx` |
| Krita pack | `src/core/brushes/kritaDefaults.ts`, `src/features/brushes/BrushPresetPanel.tsx` |
| Symmetry | `src/core/document/symmetry.ts` |
| Lasso and combining | `src/core/document/selectionModes.ts` |
| Fill options | `src/core/fill/fillOptions.ts` |
| Tests | `src/test/layerGroups.test.ts`, `canvasSizePresets.test.ts`, `kritaPresets.test.ts`, `symmetry.test.ts`, `selectionCombining.test.ts` |
| Browser tests | `tests/visual/layer-groups.spec.ts`, `layer-groups-render.spec.ts`, `new-document-sizes.spec.ts`, `krita-presets.spec.ts`, `feature-wave.spec.ts`, `panel-movement.spec.ts` |

Symbol-level spot checks in the tree at `b7953df`:

- `layerGroups.ts` exports `createGroup`, `groupLayers`, `addGroup`,
  `moveLayerToParent`, `moveLayerIntoGroup`, `moveLayerOutOfGroup`,
  `dissolveGroup`, `removeLayerNode`, `layerTreeRows` — the full tree surface,
  not just the model.
- `Canvas2DRenderer.ts` paints `node.children` onto an isolated scratch
  surface and composites it with the group's own opacity and blend mode
  (`paintLayerNodes`, lines ~1066–1146).
- `canvasSizePresets.ts` defines all six presets (Full HD, QHD, 4K UHD,
  A4 300 dpi, Panorama 8192×2048, Square max 4096×4096).
- `kritaDefaults.ts` carries 81 `Krita - ` specs plus `missingKritaPresets`.
- `symmetry.ts` exports the modes, the axis normalisation and
  `symmetryMirrors`, which `DrawingEngine.ts` consumes at line 2682.
- `selectionModes.ts` exports `combineSelectionIds`; `fillScan.ts` exports
  `scanFill`.

---

## 6. Divergences and exclusions

1. **`origin/main` (`514b69d`) is deliberately excluded.** It is one commit
   ahead of the local `main` (`ad2ef11`) and is **not** an ancestor of the
   candidate:

   ```
   $ git log --oneline -1 514b69d
   514b69d fix(test): repair the tool options test the merge mangled
   ```

   The candidate does not need it: its own tool-options tests pass in the full
   run recorded in `REPORT.md`. The instruction not to import `main`'s history
   stands, and no branch was merged to obtain it.

2. **No required branch has commits outside the candidate** (§2). Nothing is
   missing from `feat/ui-reference-redesign`, `integration/feature-wave`,
   `integration/layer-groups-wave`, `feat/movable-panels` or
   `feat/bigger-canvas-sizes`.

3. **No uncommitted implementation work on the candidate.** The candidate
   worktree is clean. Other worktrees were inspected read-only; the only
   untracked material found was helper files in `D:/dev/Paka`
   (`package-lock.json`, `playwright.config.local.ts`, `qa/`,
   `scripts/smoke-packaged.mjs`) on `feat/agent04-panel-manager`. That work is
   preserved and is not part of this candidate.

4. **Stale local branches are not evidence.** Several branch names point at the
   same commit (the `feat/swarm-*` family at `5e5beb0`, the `feat/wave4/B*`
   family at `629e168`). They are historical labels, not additional work, and
   this audit does not rely on them.

---

## 7. Preservation

- Recovery tag kept: `integration/pre-consolidation-8bd164e` → `8bd164e`.
- 80+ worktrees left in place, including
  `D:/dev/Paka-feature-factory/worktrees/integration-next-build-wave`,
  `qa-packaged-desktop` and `D:/dev/Paka-overnight-worktrees/verify-main`.
- Existing QA evidence under `docs/qa/**` untouched.
- The previously built executable at `src-tauri/target/release/paka.exe` was
  not deleted; it is superseded by a new build in `REPORT.md` and its old
  timestamp is recorded there.
- No installer from an earlier wave was removed.

---

## 8. Verdict

**The candidate `feat/krita-brushes` at `b7953df` already contains every
required feature commit.** It is a strict descendant of the UI redesign, the
feature wave (fill, lasso, combining modes, symmetry), the layer-group wave,
the movable-panel work and the bigger-canvas presets, and it adds the Krita 4
brush import on top.

Therefore, per the mission's stop condition:

- **no missing commits** to integrate;
- **no divergent history** to reconcile;
- **no history rewrite, merge, rebase or reset is required or permitted**.

Verification proceeds on this exact SHA. The only branch action contemplated is
pushing release documentation to `feat/krita-brushes` itself.
