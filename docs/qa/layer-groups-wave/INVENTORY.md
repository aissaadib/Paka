# Layer groups — inventory of the real implementation

Audited on `integration/layer-groups-wave`, cut from the completed feature-wave
tip `3af055a`. Baseline: `pnpm typecheck` clean, `pnpm test` 91 files / 2306
tests passing, working tree clean.

This document corrects the previous wave's claim that layer groups already
existed "in the model, commands, renderer and format". The model, the commands
and the project format do. **The renderer does not composite group children,
and the Layers panel never shows them.** A grouped document is therefore
currently unusable in the application, even though the data survives save and
reopen.

## 1. What the model actually supports

| Capability | State | Evidence |
| --- | --- | --- |
| Node kinds: paintable `layer` and container `group` | Implemented and verified | `src/core/document/types.ts` (`LayerKind`, `Layer.kind`, `Layer.children`) |
| Children held bottom-first; document order is depth-first | Implemented and verified | `src/core/document/layerGroups.ts` (module doc, `layerTreeRows`) |
| Arbitrary nesting depth (groups may hold groups) | Implemented in model and format; **no UI** | `Layer.children`, `readLayerTree` recursion in `projectFormat.ts` |
| Group owns no content (`children` empty for a layer) | Implemented and verified | `createLayer`, `createGroup`, format writer/reader |
| Group id/name/visibility/opacity/blend mode | Implemented and verified | `Layer`, `updateLayer`, format v13 |
| Duplicate ids refused on read | Implemented and verified | `readLayer` (`state.seenLayerIds`) |
| Cyclic parent relationships | Structurally impossible on read (JSON tree); moves guard against them | `isAncestor` + `moveLayerIntoGroup`; no id-based parent pointers |
| Empty groups | Accepted by model and format | `createGroup(name, [])`, `readLayerTree([])` |
| Active layer may be a group | Allowed by `setActiveLayer`; **unsafe** (see §3) | `document.ts` `setActiveLayer`, `DrawingEngine.beginStroke` |

### Pure tree operations

Implemented and tested in `src/core/document/layerGroups.ts` and
`src/test/layerGroups.test.ts`:

- `flattenLayers`, `paintableLayers`, `findLayer`, `findLayerPath`, `findParent`,
  `isAncestor`, `layerDepth`, `subtreeIds`, `allLayerNames`, `uniqueGroupName`.
- `createGroup` — new group node, no content.
- `groupLayers` — groups **two or more sibling paintable layers**; refuses
  groups among them, non-siblings and unknown ids. The group takes the place of
  the topmost grouped layer.
- `dissolveGroup` — children take the group's place, order and content intact.
- `moveLayerIntoGroup` — appends a node to the top of a group; refuses
  self/descendant moves.
- `moveLayerOutOfGroup` — moves a child just above its group.
- `removeLayerNode`, `replaceLayerNode`, `layerTreeRows`.

There is **no** pure operation for:

- inserting an empty group at an explicit parent/index;
- moving a node to an explicit parent **and index** in one step (needed for
  unambiguous drag-and-drop reordering across levels);
- counting a group's descendant layers or elements.

### Commands

Implemented, tested, **not wired** (`src/core/commands/documentCommand.ts`,
`src/test/layerGroups.test.ts` L348-545):

- `createGroupLayersCommand` — one undo step.
- `createRenameGroupCommand` — trims, refuses empty and non-groups.
- `createMoveGroupMemberCommand` — into/out, one undo step.
- `createDissolveGroupCommand` — tree-only, one undo step, pixels untouched.
- All refuse while a gesture is in flight (`gestureInFlight`).
- All preserve the active layer across undo/redo.

Gaps:

- No command for creating an **empty** group.
- No command for a generic parent + index move.
- `DocumentCommandSpec.removedElements` / `addedElements` holds a **single**
  layer's elements. Deleting a group must restore every descendant layer's
  elements, so the current transfer shape cannot express group deletion
  correctly.
- No group-deletion command with confirmation semantics.

### Project format

Implemented and verified in `src/core/project/projectFormat.ts`, version 13:

- Group entries carry `kind: "group"` and `children`; paintable layers carry
  `kind: "layer"` and `elements`.
- Version 12 and earlier are refused if they carry `kind: "group"` or
  `children`.
- Duplicate ids are refused; unknown kinds, elements on a group and children on
  a layer are refused.
- Nested groups round-trip; empty groups are accepted.
- No explicit nesting-depth cap, but the file is a JSON tree and the reader is
  recursive; cycles cannot be expressed.
- Tests: `src/test/projectFormat.test.ts` L1671-1780.

No format bump is needed for this wave. Panel expansion/collapse and row focus
will be view-only React state, not document data.

### Renderer — **blocking gap**

`src/core/rendering/Canvas2DRenderer.ts`:

- `paintDocument` (L1027) and `readCompositePixel` (L944) iterate
  `doc.layers` **only**. A group's `children` are never visited.
- `LayerSurfaceStore.retain` is called with `doc.layers.map(...)` (L360), so
  child surfaces are dropped.
- Consequence: a group row draws an empty surface; every layer inside it
  disappears from the canvas and from PNG export. This is not a cosmetic gap.
- `isComposited` only checks the node's own `visible`/`opacity`; inherited
  visibility and group opacity/blend isolation do not exist.
- Existing "group" renderer tests are about the preview scratch, not layer
  groups (`canvas2dRenderer.test.ts` L2745, L3085).

### Engine — flat-list assumptions

`src/core/engine/DrawingEngine.ts`:

- `toggleLayerVisibility` searches `doc.layers` only (L1155), so a nested
  layer's eye cannot be toggled.
- `duplicateLayer` finds the copy with `after.layers.find(...)` (L1092), so
  duplicating a nested layer silently does nothing. Group duplication is
  refused by the model.
- `removeLayer` transfers only the removed node's own elements (L1117). Deleting
  a group leaves every child's elements orphaned in the stroke store. The tree
  returns on undo, but the data is not carried by the command.
- `applyDocumentState` checks selection existence against `next.layers` only
  (L3869); `invalidateLayers` iterates the root list.
- `beginStroke`, `beginShape`, `beginFill`, `beginGradient` and the selection
  code take `doc.activeLayerId` without checking that it is paintable. If a
  group is active, strokes are recorded against a container that cannot render
  or export them.
- No engine facade exists for any of the group commands.

### Layers panel — flat list

`src/features/layers/LayersPanel.tsx` (589 lines):

- Uses `topFirstLayers(layers)` = `[...rootLayers].reverse()`; group children
  are not rendered at all.
- Selection is the engine's active layer. No multi-selection.
- Create/rename/delete/duplicate/visibility/opacity/blend/reorder are wired for
  root layers only.
- Drag-and-drop uses the flat-list arithmetic in `layerOrdering.ts`.
- Keyboard rules in `layerKeyboard.ts` know only focus/rename/delete/move.
- Delete confirmation (`layerDeletion.ts`) knows only "layer with content";
  deleting a group currently asks nothing and removes the whole subtree.
- No folder icon, no expand/collapse, no way to move a layer into or out of a
  group, no ungroup action.

### UI-only or untested claims

- No visual/browser test ever creates, opens or manipulates a group.
- `layerGroups.test.ts` is absent from the (stale) test map in `AGENTS.md`.
- Nothing in `src/features/layers` references `kind`, `children` or
  `layerGroups.ts`.

## 2. Classification

| Area | Classification |
| --- | --- |
| Tree data model, ordering, nesting, ids | Implemented and verified |
| Tree traversal / naming / ancestor guards | Implemented and verified |
| Group-with-existing-layers (`groupLayers`) | Implemented and verified (pure + command) |
| Empty-group creation | Missing |
| Rename group | Core/command implemented, **not wired to UI** |
| Move into/out of group | Core/command implemented, **not wired to UI** |
| Explicit parent + index move | Missing |
| Unambiguous reorder across levels | Missing |
| Group deletion with descendant contents | **Incomplete and unsafe** (orphaned elements, no confirmation) |
| Group visibility (container semantics) | Model/format implemented; **renderer/panel missing** |
| Group opacity/blend isolation | Model/format implemented; **renderer missing** |
| Nested groups | Model/format implemented; **renderer/panel missing** |
| Expand/collapse | Missing (view state) |
| Tree panel representation and keyboard | Missing |
| Engine facade for group operations | Missing |
| Renderer tree compositing and export parity | **Missing; blocking** |
| Save/reopen of groups | Implemented and verified |
| Visual/browser coverage | Missing |

## 3. Why this wave must include the renderer

A complete layer-groups workflow cannot be delivered by adding panel buttons.
With the current renderer, grouping two layers makes their artwork vanish. The
renderer change is therefore the first implementation slice, not a later
polish item. The same painter must be used by the display, the colour picker,
the bucket-fill composite read and PNG export so those four paths cannot
disagree.

## 4. Implementation plan

1. **Core tree primitives and commands**
   - Add empty-group insertion at a parent/index.
   - Add `moveLayerToParent(document, layerId, parentId, index)` with cycle and
     index validation.
   - Add commands and engine facades; make element transfers multi-layer so
     group deletion restores descendants exactly.
   - Fix flat-list engine bugs (nested visibility, nested duplication, selection
     existence, layer invalidation).
   - Decide and enforce active-group behaviour: a group can be selected for
     metadata, but drawing is refused with a one-time notice until a paintable
     layer is selected.

2. **Renderer tree compositing**
   - Walk the tree depth-first; inherit visibility.
   - Flatten normal/opaque groups; isolate non-default group opacity or blend
     mode with a reusable scratch surface per depth.
   - Use the same painter for display, colour probe, fill composite and export.
   - Keep child surfaces alive in the surface store.

3. **Panel**
   - Tree rows with depth, folder mark, child count, chevron.
   - Create group above the active node (empty), focus it and start rename.
   - Rename with Enter/Escape/blur; empty names refused.
   - Expand/collapse (view-only, not persisted, never dirty).
   - Drag into a group and drag across parents at a precise sibling index;
     cycle prevention.
   - Accessible "Inside" parent selector as the keyboard path.
   - Delete: empty groups go directly; non-empty groups confirm with the
     descendant layer count; undo restores hierarchy and contents.
   - Ungroup action; move-out action.
   - Group visibility toggles only the container; children keep their own flags.
   - Sibling-only arrow reordering and tree-aware focus.
   - Footer properties work for groups; drawing hint explains the draw target.

4. **Tests**
   - Pure tree moves, insertions, counts, drag destinations and keyboard rules.
   - Command and engine: one undo step per operation, undo/redo hierarchy and
     contents, failed operations unchanged, active layer, dirty state.
   - Renderer: hidden group, nested visibility, group opacity/blend, ordering,
     export parity, preview inside a group, surface retention.
   - Format: nested and empty groups, duplicate ids, old-version refusal.
   - Browser: create, rename, collapse, move, visible/hidden, ungroup, delete
     confirmation, undo/redo and export parity.

5. **Verification and packaging**
   - Full typecheck, unit suite, visual suite, production build.
   - Sequential `pnpm tauri build`, launch the packaged executable, exercise
     the workflow, save/reopen a grouped project, export PNG.
   - Native dialogs that cannot be driven safely are recorded as blocked, not
     claimed as verified.

## 5. Deliberate limits

- Group duplication (deep clone of subtree and elements) is out of scope; the
  model already refuses it.
- Layer locking, canvas crop, reference images, second view, multi-document
  tabs, pixel masks, mirrored live ink and text tools remain out of scope.
- Group opacity/blend is implemented in the renderer, but no new group-specific
  UI beyond the existing footer controls is introduced.
- No project-format bump. Expansion/collapse is view state.
