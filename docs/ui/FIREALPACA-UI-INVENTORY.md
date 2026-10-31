# FireAlpaca UI Inventory (Paka)

## Status

No FireAlpaca source checkout was found in this environment (`D:\dev\paka-research` contains gegl, gimp, krita, opentoonz, libmypaint, pencil only; no alpaca/firealpaca directory). The reference repository named in the task is therefore unavailable for direct symbol/path verification. All claims about FireAlpaca's actual hierarchy below are **unverified** and must be confirmed against a real FireAlpaca checkout before implementation. This document records Paka's current UI structure and the intended mapping points so work can proceed once a reference is supplied.

## Paka current UI hierarchy

- `src/main.tsx` → app root
- `src/components/layout/AppMenuBar.tsx` — top menu bar
- `src/components/layout/ToolBar.tsx` — toolbar
- `src/components/layout/Workspace.tsx` — main workspace shell
- `src/components/toolbar/ToolRail.tsx` — tool palette
- `src/components/panels/PanelStack.tsx` / `Panel.tsx` — docked panels
- `src/features/tabs/DocumentTabs.tsx` — document tabs
- `src/features/canvas/CanvasStatusBar.tsx` — status bar
- `src/features/view/ViewControls.tsx`, `ZoomField.tsx` — view controls
- `src/features/options/ToolOptionsBar.tsx` — tool options strip
- `src/features/brushes/*` — brush controls/presets
- `src/features/color/*` — color dock
- `src/features/layers/*` — layers panel
- `src/features/navigator/*` — navigator
- `src/features/reference/*` — reference images
- `src/features/commands/CanvasContextMenu.tsx`, `CommandPalette.tsx` — menus

## Paka component mapping (intended)

| Region | Paka file | Status |
|---|---|---|
| Main window shell | `src/components/layout/Workspace.tsx` | exists |
| Menu bar | `src/components/layout/AppMenuBar.tsx` | exists |
| Tool palette | `src/components/toolbar/ToolRail.tsx` | exists |
| Canvas workspace | canvas features | exists |
| Document tabs | `src/features/tabs/DocumentTabs.tsx` | exists |
| Docks/panels | `src/components/panels/*` + `src/core/panels/*` | exists |
| Brush/color/layer controls | `src/features/brushes`, `color`, `layers` | exists |

## Missing / structurally different (unknown pending reference)

Cannot determine without FireAlpaca source. Candidate areas to compare once reference is available: menu ordering, toolbar icon grouping, dock default layout, status bar fields, context menu entries, shortcut chords.

## Screenshot references

None available. Visual comparison harness exists at `tests/visual/visual.spec.ts`.

## Known uncertainties

- FireAlpaca checkout location unknown/not present.
- No direct source evidence for hierarchy or symbol names.

## Phased implementation plan

1. Obtain/locate FireAlpaca source checkout and record path.
2. Capture reference screenshots and hierarchy.
3. Map to Paka components (table above).
4. Implement deltas in small PRs per region.
5. Run tests/typecheck/lint/build and visual regression.

## Verification

Pending. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` after changes.