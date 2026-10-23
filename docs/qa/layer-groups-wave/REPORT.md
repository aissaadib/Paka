# Layer groups — implementation and packaged verification

Branch: `integration/layer-groups-wave`, cut from the verified feature-wave tip
`3af055a`. The wave's implementation tip is **`242a5c1`**; this report and its
evidence are committed after it. Nothing is pushed to `main`, and no other
branch, tag, installer or QA artifact was rewritten, merged or deleted.

## 1. What the audit changed

The previous wave's report said layer groups already existed "in the model,
commands, renderer and format". The audit found that only the **model, the
commands and the format** existed. The renderer never visited a group's
children, so grouping two layers made their artwork disappear; the Layers panel
rendered the root list only, so a group could not be created, seen, edited or
undone from the UI. The full audit, with file/line evidence, is
[`INVENTORY.md`](INVENTORY.md).

This wave therefore did three things, in this order:

1. made the renderer composite the real tree (display, colour probe, bucket
   read and PNG export share one painter);
2. made the engine's layer operations tree-aware and added the missing
   structural commands (empty group, generic parent + index move, multi-layer
   element transfer for group deletion);
3. built the panel workflow on top: indented rows, drag into/out of groups,
   inline rename, collapse/expand, visibility inheritance, contextual
   Ungroup/Move out, and the accessible `Inside` selector.

## 2. Commits

| Commit | What it contains |
| --- | --- |
| `f35c75d` | `docs(layers): inventory the real layer-group support and its gaps` |
| `ff9a3be` | `feat(layers): add tree moves, empty groups and group-safe engine operations` |
| `945a2fd` | `feat(render): composite layer groups with visibility and isolated opacity/blend` |
| `242a5c1` | `feat(layers): expose groups as an indented, draggable tree` |

The documentation/evidence commit follows `242a5c1`.

## 3. What now works

| Capability | State | Evidence |
| --- | --- | --- |
| Create an empty group above the active node at the same level | **Implemented and verified** | `addGroup`, `createAddGroupCommand`, `DrawingEngine.createGroup`; `layerGroups.test.ts`, `layerPanel.test.ts`; browser test creates and renames |
| Rename inline; Enter commits, Escape cancels, blank/whitespace is refused | **Implemented and verified** | `LayerRow` input + `LayersPanel.commitRename`; `layerGroups.test.ts`; `layer-groups.spec.ts` |
| Expand / collapse a group | **Implemented and verified** | view-only `collapsedGroups` Set in `LayersPanel`; `layerTreeRows(..., { collapsed })`; keyboard Left/Right; browser test asserts history does not move |
| Move layers into, out of and between groups | **Implemented and verified** | `moveLayerToParent`, `createMoveLayerToParentCommand`, `layerTreeDrag.ts`; pure, command, engine and browser tests |
| Reorder siblings inside a group, and across levels, without breaking compositing order | **Implemented and verified** | `moveLayerToParent` index convention; `layerGroups.test.ts`; `layerTreeDrag.test.ts` |
| Refuse cycles (a group into itself or its descendant) | **Implemented and verified** | `isAncestor` guard in `moveLayerToParent`; `layerTreeDrag.resolveLayerDrop`; unit tests |
| Delete a group safely | **Implemented and verified** | empty group deletes without a question; a non-empty group asks with its descendant layer count; undo restores every child and every child's elements; `removeLayer` multi-element transfer; browser test |
| Group and child visibility | **Implemented and verified** | renderer inherits visibility; panel shows inherited-hidden; `toggleLayerVisibility` finds nested nodes; unit + browser tests |
| Group opacity and blend as one composite | **Implemented and verified** | isolated scratch only when `opacity < 1` or `blendMode !== "normal"`; renderer tests + `layer-groups-render.spec.ts` pixel samples |
| Nested groups | **Implemented and verified** | recursive renderer painter, recursive panel rows, recursive format reader; renderer nested test, format nested test |
| Undo/redo one entry per structural operation | **Implemented and verified** | document commands; `layerGroups.test.ts`, `layerPanel.test.ts`; browser undo restores a deleted group |
| Save / reopen | **Implemented and verified** | v13 already carried `kind`/`children`; no bump; `projectFormat.test.ts` now also covers empty and nested groups |
| Export matches the grouped artwork | **Implemented and verified at the pixel level** | `paintLayerNodes` is shared by display and export; visual scenes `group-opacity`, `group-hidden`, `group-blend`; `layer-groups-render.spec.ts` |
| Active group is metadata-only; drawing is refused with an explanation | **Implemented and verified** | `activePaintableLayerId`, `GROUP_DRAW_NOTICE`; `layerPanel.test.ts` |
| A structural layer change during a pointer gesture is refused | **Implemented and verified** | `refuseLayerChangeDuringGesture` on every layer operation; engine test starts a stroke, refuses group creation, switches tool, then succeeds |
| Selection inside a group | **Implemented and verified** | selection uses the active paintable layer; `layerPanel.test.ts` selects one child's stroke and never the group |
| Small-window panel layout | **Implemented and verified** | compact two-column Blend/Inside row, scroll-capped footer, `shell-layout.spec.ts` at 700x640, 960x600 and the larger sizes |

### Deliberate boundaries

- **No shadow hierarchy in React.** The panel renders `layerTreeRows` from the
  document. The only React-held tree state is `collapsedGroups` and row focus,
  both view state.
- **No format bump.** v13 already describes groups. A v12 file opens unchanged
  as flat layers; a v13 file with groups is refused by an older reader rather
  than silently flattened.
- **Group duplication is out of scope.** The model's `duplicateLayer` refuses a
  group; the panel disables Duplicate for a group. Duplicating a layer inside a
  group is supported.
- **Creating a group does not absorb the active layer.** It creates an empty
  group above the active node and leaves the artist on their paintable layer;
  the group is then moved into through drag or `Inside`. This is a deliberate
  choice: an empty group is reversible without changing what the next stroke
  paints on.

## 4. Format compatibility

`PROJECT_VERSION` remains **13**. The reader still:

- accepts v1–v12 files as flat paintable layers (no `kind`, no `children`);
- requires `kind`/`children` to agree with the node's kind;
- refuses duplicate ids across the whole tree, elements on a group, children on
  a layer, unknown kinds and malformed children;
- accepts an empty `children: []` (a newly created group);
- round-trips nested groups and the order of every sibling list.

New tests in `src/test/projectFormat.test.ts`:

- an empty group round-trips byte-for-byte through the document model;
- a nested group round-trips with its ordering, and the only elements in the
  file belong to the paintable leaf.

## 5. Verification on the implementation tip

Every command was run in
`D:/Dev/Paka-overnight-worktrees/integration` on
`integration/layer-groups-wave`, sequentially. Logs are in this directory.

| Command | Result |
| --- | --- |
| `pnpm typecheck` | clean (strict TypeScript, no errors) |
| `pnpm test` | **92 files, 2354 tests passed** (baseline `3af055a`: 91 files, 2306) |
| `pnpm test:visual` | **76 passed** (the new coverage is `layer-groups.spec.ts` and `layer-groups-render.spec.ts`, plus the three group scenes) |
| `pnpm build` | production bundle built: 527.62 kB JS (159.79 kB gzip), 39.36 kB CSS; exit 0. The >500 kB chunk warning is pre-existing |
| `pnpm tauri build` | see §6 |

Targeted evidence:

| File | Tests | What it covers |
| --- | --- | --- |
| `src/test/layerGroups.test.ts` | 39 | tree traversal, grouping, nesting, ancestor guards, dissolve, rows, empty group, parent+index move, rename and move commands, gesture refusal, active layer through undo/redo |
| `src/test/layerTreeDrag.test.ts` | 13 | the drop zones, cycle-safe resolution, parent options, same-parent no-op |
| `src/test/layerPanel.test.ts` | 24 | engine facade, nested visibility/duplicate, group deletion and element restore, group-active draw refusal, gesture refusal and tool switch, selection inside a group |
| `src/test/projectFormat.test.ts` | 79 | v13 round trips including empty and nested groups, older-version migration, malformed files |
| `src/test/canvas2dRenderer.test.ts` | 111 | group flattening, hidden subtrees, opacity isolation, blend, nesting, export parity, probe path |

Those five files were run together as a targeted pass: **266 tests passed**
(`docs/qa/layer-groups-wave/targeted-tests.txt`).

The new browser specs:

- `tests/visual/layer-groups.spec.ts` drives the real panel: create + rename,
  drag into a group, collapse/expand with keyboard, delete confirmation and undo,
  empty-group deletion, group visibility and opacity, the `Inside` selector and
  Ungroup, Escape/blank rename, and that collapse records no history.
- `tests/visual/layer-groups-render.spec.ts` samples the **exported** pixels of
  three group scenes: a 50 % group fades its composite (not each child), a
  hidden group removes its subtree, and a `multiply` group at 50 % is half the
  multiplied result over the base.

## 6. Packaged Windows build and smoke test

`pnpm tauri build` succeeded in 2 m 08 s. It emitted one linker warning
(`.rsrc merge failure: multiple non-default manifests`) and produced:

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| `src-tauri/target/release/paka.exe` | 3,582,464 | `5DA346B657EE1009FF3D2777B036134BC242F382C336CFC6EE4F8B3DB25807FC` |
| `src-tauri/target/release/bundle/msi/Paka_0.1.0_x64_en-US.msi` | 2,039,808 | `591DE68F603FC5595568494D2CED82583C88D3EABBC4E8C27FCBAA95A3F8481C` |
| `src-tauri/target/release/bundle/nsis/Paka_0.1.0_x64-setup.exe` | 1,459,315 | `FF623E0F529F27A68C189FED42BC9B7DD766709572E252B58FF8FCBF1AB7442B` |

The packaged window was started with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and driven
through WebView2's DevTools protocol at the real window size (client
**1440 × 779**).

### Shell smoke

`scripts/smoke-packaged.mjs` reported: no page overflow, the two fixed top rows
at 30/68 px, the dock at 216 px wide, the layers body at **159 px**, no console
errors, and a drawn stroke that Undo removes. Screenshot:
`packaged/paka-window.png`.

### Group workflow in the packaged window

`scripts/packaged-layer-groups-step.mjs group` created a group, renamed it
`Shading`, moved `Layer 1` inside through the accessible `Inside` selector, and
drew inside the child. All six checks were true:

| Check | Result |
| --- | --- |
| child indented under the group | true |
| group reports one child | true |
| hiding the group marks the child inherited-hidden | true |
| showing the group clears inherited-hidden | true |
| collapsing removes the child row | true |
| expanding restores it | true |

The packaged panel is in `packaged/paka-layer-groups.png`.

`delete-undo` added a root layer (the last paintable layer may not be deleted),
selected the non-empty group and read the confirmation. It named **1 layer** and
said **“Undo brings the whole group back”**. After deleting, both rows were
gone; `Ctrl+Z` restored both. All five checks were true
(`packaged-delete-undo.log`).

### Save and reopen

The native Save command opened a dialog that the DevTools protocol could neither
see nor address. It nevertheless completed and the status bar reported
`Saved Untitled.paka`; the app wrote `C:\Users\aissa\Desktop\Untitled.paka`
(20,449 bytes). That file is copied into evidence as
`packaged-native-save.paka`. It is a **version 13** project with one group, one
paintable child and **two strokes** (`packaged-project.json`).

The native **Open** picker was not driven. Instead,
`scripts/packaged-layer-groups-step.mjs open-direct` replaced only the picker and
called the live `ProjectFiles.open` service, so the real parser, document load,
history rebuild and renderer invalidation ran. It opened the saved file with no
warnings; the panel showed the group, the indented child and **2 items**, and the
status bar showed the saved path.

For a clean round trip after the delete/undo exercise, `save-direct` wrote
`packaged-roundtrip.paka` (20,560 bytes; root layer + group + child + two
strokes). Reopening it with `open-direct` restored the same tree and item counts
with no warnings; the project reader reports version 13, 2 roots, 1 group,
2 layers and 2 strokes (`packaged-roundtrip-project.json`).

### Export

`export-direct` called the live `ProjectFiles.exportPng` with only the native
picker replaced. It wrote `packaged-export.png`: **1600 × 1200**, 56,479 bytes.
The four corners and the centre are opaque white; the only non-white pixels are
the two pink strokes, in the bounding box `(348,382)–(548,588)`. There is no
toolbar, panel, guide, grid, selection or other UI overlay in the image. The
exported artwork is visible in the evidence image and contains both strokes that
live inside the group.

The native **Export PNG** picker was not driven; the export path and encoder
were, through `ProjectFiles`.

## 7. Limitations and unperformed checks

- **Native file pickers.** The Windows Save/Open/Export dialogs are outside the
  DevTools protocol. A Save command did complete (the file is in evidence), but
  its dialog could not be observed or controlled. Open and Export used the
  `-direct` steps, which bypass **only** the picker and run the product's
  `ProjectFiles` service. The pickers themselves are unverified in this wave.
- **Group opacity/blend in the packaged window.** They are verified in Chromium
  by `layer-groups-render.spec.ts` against exported pixels, and by the renderer
  unit tests. The packaged smoke did not change a group's opacity or blend
  interactively; the packaged export used the default group settings.
- **Native-dialog cancellation.** A cancelled Save/Open/Export was not exercised
  in the packaged window, because the dialog could not be reached. The
  `ProjectFiles` unit tests cover a cancelled picker.
- **Group duplication.** Deliberately unsupported; the model refuses it and the
  panel disables Duplicate for a group. Duplicating a layer inside a group is
  supported and tested.
- **Canvas resize/crop, layer locking, reference images, secondary view,
  multi-document tabs, pixel masks, mirrored live ink, text/path tools, UI
  redesign and performance work** were not attempted.
- The packaged build emits a linker warning about multiple non-default
  manifests. It is recorded, not hidden; the executable and both installers were
  produced and the executable ran.

## 8. Ranked next work

1. **Canvas resize / crop.** Highest user value after groups, but it needs a
   format field (v14) and a decision about strokes and guides outside the new
   bounds before code.
2. **Layer locking.** Needs a model field, v14, an engine guard and a panel
   toggle; do it with the crop format bump.
3. **Reference images end to end.** Decode, geometry and store are tested; the
   missing pieces are an engine seam, one renderer pass before ink, a panel, and
   an explicit "never in export" test.
4. **Group duplication / copy-paste of a subtree.** The model currently refuses
   group duplication; doing it well needs a deep element transfer and a fresh-id
   pass. Lower value than the three above.
5. **Multi-document tabs and a second view.** Large, independent slices; no
   shared format work.
6. **Autosave / recovery.** Built but deliberately disabled; the policy is the
   owner's decision.

Explicitly not attempted in this wave: canvas resize/crop, layer locking,
reference images, secondary view, multi-document tabs, pixel masks, mirrored
live ink, text/path tools, UI redesign, performance work and unrelated fixes.
