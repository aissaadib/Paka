# Movable panels - implementation report

Branch: `feat/movable-panels`

## Objective

Make Paka's side panels movable rather than a fixed colour-wheel / brushes /
navigator / shortcuts stack. The named targets were the colour wheel, the
brush selection panel, and the settings shell around them. The work also had to
preserve the layer-groups behaviour and evidence built on
`integration/layer-groups-wave`.

## What the reference apps do

- **Krita** treats each docker as a panel that can be dragged to a side, left
  floating, or joined to another docker's tab strip. The Krita manual describes
  dockers as movable and tabbable, and the scripting documentation describes
  the same three states: docked, floating, and part of a tab group.
- **FireAlpaca** exposes the same broad model in its panel-manipulation
  tutorial: panels can be rearranged in the workspace rather than being locked
  to one column.

Paka already had most of the model for this, but not the gesture:

- `core/shell/slots.ts` names the slots (`left`, `right`, `bottom`, `floating`,
  `hidden`) and the placement rules.
- `core/shell/preferences.ts` persists `panelOrder`, `panelSlots`,
  `hiddenPanels`, and `foldedPanels`.
- `core/workspace/workspaceSettings.ts` composes the panels into the shell.
- The live `Workspace` only rendered the `right` slot and never called a
  placement mutator.

## What changed

### Pure movement model

`src/core/shell/panelMovement.ts` adds:

- `movePanelInPreferences(preferences, { panelId, slot, index })` - moves a
  registered panel to a slot and an index inside that slot.
- `resetPanelPlacement(preferences)` - restores the registry order and clears
  folds, hidden entries, and explicit slot overrides.
- `panelSlotOf(preferences, panelId)` - the effective slot, with the registry
  default as the fallback.

The module is pure and framework-free. A move keeps unknown panel ids in the
preferences list, clamps an out-of-range drop index, removes a moved panel from
the hidden list, and returns the same object when nothing changed.

### Live workspace store

`src/state/workspaceStore.ts` now exposes:

- `actions.movePanel(id, slot, index?)`
- `actions.resetPanels()`
- `applyPreferences(preferences)` for the settings reader

The preferences source gained an optional `setPreferences` write. A read-only
source (a test double or a profile) still works.

### Dock gestures

`src/components/panels/PanelDock.tsx` now supports:

- dragging a tab over another tab to reorder the dock;
- dragging a tab onto the canvas to float it, with a drop target over the
  canvas side of the column;
- a small panel-actions menu with **Float panel** and **Reset panel layout**;
- keeping the existing keyboard tab behaviour (Left/Right/Home/End).

The tab strip and the actions trigger share a `panel-dock__bar`, so the trigger
is outside the ARIA tablist rather than an invalid child of it.

### Floating windows

`src/components/panels/FloatingPanels.tsx` renders the `floating` slot as
fixed-position windows. A window can be:

- moved by its header (pointer drag, or arrow keys on the focused header);
- resized from its bottom-right corner;
- docked again with the dock button;
- hidden with the close button.

The floating layer ignores pointer events outside its windows, so the canvas
continues to work underneath.

### Shell and menu

- `src/components/layout/Workspace.tsx` renders the floating layer and passes
  the movement actions to the dock.
- `src/components/layout/AppMenuBar.tsx` adds **Panels -> Reset Panel Layout**.
- `src/app/App.tsx` creates one workspace store and registers the panel-layout
  and workspace settings sections.
- `src/app/EditorProvider.tsx` accepts those sections and hands them to the
  single `SettingsStore` writer.

### Persistence

The panel arrangement is persisted through the existing section contract:

- `core/panels/panelLayoutSection.ts` reads and writes `hiddenPanels`,
  `panelOrder`, `panelSlots`, and `foldedPanels`.
- `core/workspace/workspaceSettingsSection.ts` keeps the shell parts and
  profiles.
- `App` is now the composition root that creates the workspace store, because
  the shell and the settings file share it.

Floating window **geometry** (position and size) is deliberately not persisted;
only the fact that a panel is floating is. The window opens at a sensible
position on the next run. This keeps the persisted format to the existing panel
layout fields.

## Tests

New unit coverage in `src/test/panelMovement.test.ts`:

- move to the front of a slot;
- move to floating and out of hidden;
- dock at the end;
- clamp an out-of-range index;
- unknown panel and unknown slot are no-ops;
- unknown ids are preserved;
- the move is idempotent;
- reset clears folds and placement but keeps theme;
- the workspace store action updates the composition;
- a move round-trips through the panel-layout settings section.

New browser coverage in `tests/visual/panel-movement.spec.ts`:

- drag a tab to reorder the dock;
- float a panel from the menu, move its window, and dock it again;
- drag a tab onto the canvas to float it;
- reset the arrangement from the Panels menu.

## Verification

Run on 2026-10-23 in
`D:\Dev\Paka-overnight-worktrees\integration`:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | passed |
| `pnpm test` | 93 files, 2366 tests passed |
| `pnpm test:visual` | 80 tests passed |
| `pnpm build` | passed; Vite reported the existing chunk-size warning |
| `pnpm tauri build` | passed; the existing `.rsrc merge failure: multiple non-default manifests` linker warning remains |

The new visual spec alone ran 4 tests and passed.

## Limits and open items

- The shell still renders only the `right` slot plus the reserved layers list.
  The `left`, `bottom`, and `hidden` slots are modelled and persisted, but no
  visible control currently drops a panel into `left` or `bottom`.
- The layers list is not part of the tabbed dock and has no float handle. The
  colour wheel, brush selection, navigator, and shortcut panels are movable.
- Floating window geometry is not persisted (see above).
- Dragging a floating window back onto the dock is not implemented; the dock
  button is. This is a deliberate first slice: the button is keyboard- and
  pointer-reachable, while drag-to-dock needs a more careful hit model.
- The packaged executable was rebuilt but not interactively smoke-tested for
  this slice. Browser tests cover the gestures; the Tauri build proves the
  frontend bundles and the native shell still link.

## Files

- `src/core/shell/panelMovement.ts` (new)
- `src/state/workspaceStore.ts`
- `src/components/panels/PanelDock.tsx`
- `src/components/panels/FloatingPanels.tsx` (new)
- `src/components/panels/panel.css`
- `src/components/layout/Workspace.tsx`
- `src/components/layout/AppMenuBar.tsx`
- `src/app/App.tsx`
- `src/app/EditorProvider.tsx`
- `src/components/icons.tsx`
- `src/test/panelMovement.test.ts` (new)
- `tests/visual/panel-movement.spec.ts` (new)
