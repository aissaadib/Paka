# Layer groups and layer locks — implementation report

**Branch**: `feat/agent26-layer-groups` (based on the wave-2 integration tip
`74023e9`, plus the `PROJECT_VERSION` repair `1f212c2`).

**Ownership**: the layer model, the layer commands, the history and the project
format. The **panel** belongs to Agent 08, and this slice deliberately does not
touch `src/features/layers/*`: it delivers the model, the actions and a
ready-made view model, and section 6 says exactly how to mount them.

---

## 1. What the slice had to start from

There was no group representation in the tree at all. `DrawingDocument` held a
flat `layers: readonly Layer[]` (bottom-first, the painting order) and a
`guides` array; `Layer` held `id`, `name`, `visible`, `opacity` and
`blendMode`. `docs/SESSION-BRIEF.md` listed "No layer masks/groups" as a known
gap, and `docs/ROADMAP.md` carried an unchecked `Groups` line under phase 4.

The renderer composites `doc.layers` in order and keys its surfaces by layer
id, so the flat list is the painting order and the thing every other part of
the app already agrees on.

## 2. The model

### 2.1 The tree

```ts
interface LayerGroup {
  id: string;
  name: string;
  collapsed: boolean;
  children: readonly LayerTreeEntry[];
}
type LayerTreeEntry =
  | { kind: "layer"; id: LayerId }
  | { kind: "group"; id: string };
interface LayerTree {
  groups: readonly LayerGroup[];
  root: readonly LayerTreeEntry[];
}
```

The groups live in one flat list and the child lists name them, so a group id
is looked up in one place and the file format stays a plain, non-recursive
structure. `DrawingDocument.layerTree` holds the tree.

### 2.2 The rule that keeps the panel honest

> A group occupies **one slot in the stack**, and its members are drawn in that
> slot.

The tree says where a layer sits in the panel; the flat `layers` list says
where it sits in the stack. The two are kept in step by construction: the
members of a group occupy one **contiguous run** of the flat list, and the
flat list is re-derived from the tree whenever the tree changes
(`syncLayersToTree`). The invariant is therefore

```
layerTreeLayerIds(document.layerTree) === document.layers.map(l => l.id)
```

and it is what lets the panel show the layers in the order they are composited.
Moving a layer into a group therefore moves it into that group's slot - the
layer's place in the stack changes with it, which is the honest consequence of
"a group is a slot" and is the only rule that keeps panel order and painting
order the same order.

### 2.3 What a group is **not**

A group has **no pixels, no opacity and no blend mode**. The layers it holds
keep their own visibility, opacity and blend mode, and they are composited
against the paper and their neighbours exactly as they were without the group.
There is no group-level blending, no clipping and no alpha inheritance - those
would need a renderer change and are not in this slice.

`collapsed` is **display-only**, exactly like the guides: a folded group still
holds its layers and they are still drawn.

### 2.4 The lock

`Layer.locked` is one optional boolean. Absent means unlocked, which keeps
every layer that was never locked free of a redundant field.

The lock is **enforced by the engine**, not by the panel. Every path that could
change a locked layer's pixels or its place in the stack goes through
`refuseLockedLayer`:

| Path | Refused |
| --- | --- |
| `beginStroke` (brush and eraser) | yes |
| `beginShape` (line, rectangle, ellipse, polygon, star) | yes |
| `beginFill` (bucket) | yes |
| `beginGradient` | yes |
| `beginSelectionMove`, `beginSelectionTransform` (the drags) | yes |
| `nudgeSelection`, `flipSelection`, `scaleSelection`, `rotateSelection` | yes |
| `deleteSelection`, `duplicateSelection` | yes |
| `moveLayer` (the reorder - the lock on the *position*) | yes |
| `removeLayer` (the lock on the *pixels*) | yes |

A refused edit is a no-op: no history step, no dirty flag, and a notice that
says which layer is locked and why.

Deleting a locked layer is refused as well. Photoshop lets a locked layer be
deleted; here the lock is read as "this layer keeps its pixels", and a delete
would take them away, so the layer has to be unlocked first.

A **duplicated** layer starts **unlocked**: the copy is a different layer, and
the lock protects the layer it was set on. The original stays locked.

## 3. The commands

Every tree mutation and every property change is a `DocumentCommand`, so it is
one undoable step, it marks the document dirty, and it is refused while a
gesture is in flight - the same rules the other layer changes already follow.

| Engine method | History label |
| --- | --- |
| `createLayerGroup(parentId, name)` | `Add Layer Group` |
| `renameLayerGroup(groupId, name)` | `Rename Layer Group` |
| `setLayerGroupCollapsed(groupId, collapsed)` | `Collapse/Expand Layer Group` |
| `moveLayerGroup(groupId, delta)` | `Reorder Layer Groups` |
| `removeLayerGroup(groupId)` | `Delete Layer Group` |
| `moveLayerToGroup(layerId, groupId)` | `Move Layer into/Out of Group` |
| `setLayerLocked(layerId, locked)` | `Lock/Unlock Layer` |

They are metadata-only changes, so they carry `preserveActiveLayer`: undoing
a group change does not move the user off the layer they are looking at.

**Removing a group keeps its layers.** The children move up into the group
that held it, in the same order, so removing a folder never removes a layer -
and never a pixel with it.

## 4. The project format

Two **additive** fields, and **no version bump** (`PROJECT_VERSION` stays 12):

- `document.layerTree` - the groups and the order they hold.
- `layers[].locked` - the lock flag, written only when the layer is locked.

The reason no bump is needed is the same reason the guides needed none: a
reader that does not know these fields draws **the very same picture**. The
groups hold no pixels and the painting order stays in the flat `layers` list;
the lock is a protection flag and changes no pixel. The file also only carries
`layerTree` when the document actually has groups, so a document without
folders is written byte for byte as it was before.

Reading is forgiving, like the guides:

| The file has | The reader does |
| --- | --- |
| no `layerTree` | opens the layers flat, in the written order (every file written before this slice) |
| a `layerTree` that is not an object, or whose `groups`/`root` are not lists | ignores the tree, warns, opens flat |
| a group with a missing or duplicate id, or an entry that names an unknown layer or group | drops that entry, warns, opens flat when the tree no longer matches the layers |
| groups nested in a loop | ignores the tree, warns, opens flat |
| a tree whose layer order does not match `layers[]` | ignores the tree, warns, opens flat |
| a `locked` value that is not a boolean | opens the layer unlocked, warns |

A tree is used only when it agrees with the flat list - the same layers in the
same order - which is what keeps the panel's order and the painting order the
same order after a reopen. A file with more than 10,000 groups is refused,
like the other ceilings.

## 5. Tests

`src/test/layerTree.test.ts` (14 tests) - the pure model: a flat start, a
group holding a layer, nested groups, an empty group, renaming, folding,
reordering a group, removing a group while keeping its layers, a layer leaving
a group, a removed layer leaving the tree, the panel's rows, and the
consistency invariant.

`src/test/layerGroups.test.ts` (21 tests) - the engine and the file: one
undoable step per group change, the undo/redo of each, the order the tree
implies, a stroke that keeps its layer when the layer moves into a group, the
refusals (a group change during a gesture, a locked layer), the unlock, the
duplicated layer's own copy, the round trip through save and reopen, an older
file without groups, a broken tree, a loop in the tree, a broken lock flag, and
the bytes that are written.

The whole suite: **1,086 tests in 50 files, all pass**; `pnpm typecheck` is
clean; `pnpm build` succeeds.

## 6. The panel contract (Agent 08)

Nothing in `src/features/layers/` was touched. The slice leaves the panel these
pieces:

**The rows.** `layerTreeRows(document.layerTree, document.layers)` in
`src/core/document/layerTree.ts` returns the panel's rows, **top-first** (like
the canvas composites):

```ts
interface LayerTreeRow {
  kind: "layer" | "group";
  id: string;        // the layer id or the group id
  name: string;
  depth: number;     // 0 at the top level, 1 inside a group, and so on
  collapsed: boolean;
  layer?: Layer;     // the layer itself, on a layer row
}
```

A folded group shows only its own row; its children are not in the list.

**The actions** (`EditorActions`, all wired to the engine):

```ts
createLayerGroup(parentId?: string | null, name?: string): string | null;
renameLayerGroup(groupId: string, name: string): void;
setLayerGroupCollapsed(groupId: string, collapsed: boolean): void;
moveLayerGroup(groupId: string, delta: number): void;
removeLayerGroup(groupId: string): void;
moveLayerToGroup(layerId: LayerId, groupId: string | null): void;
setLayerLocked(layerId: LayerId, locked: boolean): void;
toggleLayerLock(layerId: LayerId): void;
```

`createLayerGroup` returns the new group's id (or `null` when the change was
refused), so a panel can select the group it just made.

**The rules a panel has to honour.**

- A group row is a header: a fold toggle, a name (double-click to rename) and
  the "new group" / "remove group" actions. It has no visibility and no
  opacity - a group has none.
- `moveLayerToGroup(layerId, null)` takes a layer out of every group.
- Moving a layer into a group moves it into that group's slot, so the layer's
  place in the stack changes. A panel that wants a different rule (for
  instance, keeping the layer where it was) would need a model change, not a
  panel change.
- The existing `moveLayer(id, delta)` moves a layer among its **siblings** -
  inside its group, if it is in one - so the panel's up/down buttons keep
  working for a grouped layer.
- The lock toggle is per layer; a group is not lockable in this slice.

## 7. Boundaries and what is **not** in this slice

- **No group compositing**: no group opacity, no group blend mode, no
  clipping, no alpha inheritance. A group is a folder.
- **No alpha/transparency lock.** The one lock flag covers both the pixels and
  the position, because a lock that only some paths honoured would be a
  decoration. A separate "lock transparency" would need the renderer to
  composite a layer's alpha as a mask, which is not implemented.
- **No drag-and-drop** in the panel. The actions exist and are undoable; the
  gesture is the panel's.
- **No group-level visibility or lock**, and no renaming of several layers at
  once.
- **No undo granularity inside a group**: one step per change, like every other
  layer change.

## 8. How to read this slice

The model is `src/core/document/layerTree.ts` (pure, no rendering, no React),
the commands are `src/core/document/document.ts` and the engine methods in
`src/core/engine/DrawingEngine.ts`, and the file is
`src/core/project/projectFormat.ts`. The two test files are
`src/test/layerTree.test.ts` and `src/test/layerGroups.test.ts`.
