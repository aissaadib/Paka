# Wave 3 â€” the ledger

**Coordinator:** night shift, session 1 Â· **Base:** `9baec0d`
**Base chain:** `8fe02cc` (origin/integration/swarm-wave-2) â†’ `ad2a5f3`
(the merge repair) â†’ `9baec0d` (the shared contracts).

Every builder has its own worktree under
`D:/Dev/Paka-overnight-worktrees/` and its own branch `feat/wave3/Axx-...`.
No builder edits another builder's worktree. The shared checkout
`D:/Dev/Paka` was **not** touched.

## The base, and why it is not `origin/main`

`origin/main` (`74023e9`) and `origin/integration/swarm-wave-2`
(`8fe02cc`) have **identical trees**, and both are broken: the wave-2 merge
resolved the `PROJECT_VERSION` conflict by keeping *both* sides, so
`src/core/project/projectFormat.ts` declared the constant twice, and the
same merge duplicated a line in `src/test/projectFormat.test.ts` and left
the test block unbalanced. The tree did not compile.

Six builders independently made the same repair, on six branches
(`1f212c2`, `8a2e027`, `0168c52`, `c846821`, `5a11ccb`, `99c0bf0`).
Their trees are byte-identical. The wave base carries **one** copy of that
repair, as `ad2a5f3`.

## The shared contracts

Eight modules, one commit (`9baec0d`), 116 tests:

| Module | What it owns |
| --- | --- |
| `src/core/shell/slots.ts` | the closed set of shell slots and the layout rules |
| `src/core/shell/panelRegistry.ts` | the list of panels the shell may show |
| `src/core/shell/viewportState.ts` | the viewport that survives a resize or a restart |
| `src/core/shell/overlayRegistry.ts` | the things drawn over the canvas |
| `src/core/shell/historyModel.ts` | the shell's read-only view of the undo stack |
| `src/core/shell/preferences.ts` | the shell's own preferences |
| `src/core/shell/toolOptions.ts` | the tool-option contract and its per-tool registry |
| `src/core/brushes/dynamics.ts` | speed and taper as a dynamics layer |

## The builders

| # | Task | Branch | Worktree | Base | Shared files | Brief |
| --- | --- | --- | --- | --- | --- | --- |
| A01 | The application shell's composition: a workspace profile that names the shell's parts, the settings that carry it, and the React context that publishes it | feat/wave3/A01-workspace-shell | D:/Dev/Paka-overnight-worktrees/A01-The application shell's composition: a workspace profile that names the shell's parts, the settings that carry it, and the React context that publishes it | 9baec0d | feat/wave3/A01-workspace-shell | src/components/layout/Workspace.tsx (shell composition) |
| A02 | The options bar: one control component that renders every kind in the tool-option contract (slider, number, toggle, select, colour, group) and the bar that lays them out | feat/wave3/A02-tool-options-bar | D:/Dev/Paka-overnight-worktrees/A02-The options bar: one control component that renders every kind in the tool-option contract (slider, number, toggle, select, colour, group) and the bar that lays them out | 9baec0d | feat/wave3/A02-tool-options-bar | src/features/options/**, src/core/shell/toolOptions.ts (read-only) |
| A03 | The tool rail as a real toolbox: the rail's own model (which tools are shown, their order and their groups), the icon set, the button, the menu, the tooltip and the popover | feat/wave3/A03-toolbox | D:/Dev/Paka-overnight-worktrees/A03-The tool rail as a real toolbox: the rail's own model (which tools are shown, their order and their groups), the icon set, the button, the menu, the tooltip and the popover | 9baec0d | feat/wave3/A03-toolbox | src/components/toolbar/ToolRail.tsx |
| A04 | Brush properties as one validated model: the fields a brush shows, their ranges and their defaults, and the numeric input that edits them without losing a half-typed value | feat/wave3/A04-brush-properties | D:/Dev/Paka-overnight-worktrees/A04-Brush properties as one validated model: the fields a brush shows, their ranges and their defaults, and the numeric input that edits them without losing a half-typed value | 9baec0d | feat/wave3/A04-brush-properties | src/core/brushes/defaults.ts |
| A05 | The brush size gesture (drag on the canvas to resize the brush) and the stabilizer's own model, both as pure modules the engine can call | feat/wave3/A05-brush-size-gesture | D:/Dev/Paka-overnight-worktrees/A05-The brush size gesture (drag on the canvas to resize the brush) and the stabilizer's own model, both as pure modules the engine can call | 9baec0d | feat/wave3/A05-brush-size-gesture | src/core/brushes/strokeBuilder.ts (read-only) |
| A06 | The preset browser: search, apply, and the import/export of a preset library as files | feat/wave3/A06-preset-browser | D:/Dev/Paka-overnight-worktrees/A06-The preset browser: search, apply, and the import/export of a preset library as files | 9baec0d | feat/wave3/A06-preset-browser | src/core/brushes/presetBrowser.ts |
| A07 | The colour dock: the colour panel as a registered shell panel, with its own slot, fold state and mount policy | feat/wave3/A07-color-dock | D:/Dev/Paka-overnight-worktrees/A07-The colour dock: the colour panel as a registered shell panel, with its own slot, fold state and mount policy | 9baec0d | feat/wave3/A07-color-dock | src/features/color/** |
| A08 | The layers panel: safe, keyboard-drivable, with pure reordering and deletion rules | feat/wave3/A08-layer-panel | D:/Dev/Paka-overnight-worktrees/A08-The layers panel: safe, keyboard-drivable, with pure reordering and deletion rules | 9baec0d | feat/wave3/A08-layer-panel | src/features/layers/LayerRow.tsx, LayersPanel.tsx |
| A09 | View navigation: the navigator panel's pure geometry (the mapping between navigator, canvas and document pixels) and the engine's centring intents | feat/wave3/A09-view-navigation | D:/Dev/Paka-overnight-worktrees/A09-View navigation: the navigator panel's pure geometry (the mapping between navigator, canvas and document pixels) and the engine's centring intents | 9baec0d | feat/wave3/A09-view-navigation | src/core/engine/DrawingEngine.ts |
| A10 | The brush cursor and the brush preview: a cursor that shows the brush's real footprint at the real zoom, and a preview of a stroke before it is committed | feat/wave3/A10-brush-cursor | D:/Dev/Paka-overnight-worktrees/A10-The brush cursor and the brush preview: a cursor that shows the brush's real footprint at the real zoom, and a preview of a stroke before it is committed | 9baec0d | feat/wave3/A10-brush-cursor | src/core/rendering/brushPreview.ts |
| A11 | The panel manager: the panel list, the layout rules, the live store and the stack that mounts the panels | feat/wave3/A11-panel-manager | D:/Dev/Paka-overnight-worktrees/A11-The panel manager: the panel list, the layout rules, the live store and the stack that mounts the panels | 9baec0d | feat/wave3/A11-panel-manager | src/core/shell/** (sole owner), src/core/panels/** |
| A12 | Pressure dynamics: the pressure curve and the way it maps the device's pressure to the brush's response | feat/wave3/A12-pressure-dynamics | D:/Dev/Paka-overnight-worktrees/A12-Pressure dynamics: the pressure curve and the way it maps the device's pressure to the brush's response | 9baec0d | feat/wave3/A12-pressure-dynamics | src/core/brushes/dynamics.ts |
| A13 | Symmetry: the mirror axes, the pure geometry of a mirrored point, and the overlay that shows the axes | feat/wave3/A13-symmetry | D:/Dev/Paka-overnight-worktrees/A13-Symmetry: the mirror axes, the pure geometry of a mirrored point, and the overlay that shows the axes | 9baec0d | feat/wave3/A13-symmetry | src/core/document/symmetry.ts |
| A14 | Brush tips: a dab's shape as a mask rather than a round disc, deterministic from the document and the dab's direction | feat/wave3/A14-brush-tips | D:/Dev/Paka-overnight-worktrees/A14-Brush tips: a dab's shape as a mask rather than a round disc, deterministic from the document and the dab's direction | 9baec0d | feat/wave3/A14-brush-tips | src/core/rendering/Canvas2DRenderer.ts, stampCoverage.ts |
| A15 | The shape tools: the shape options as one model, the press-time capture, and the rectangle, ellipse, polygon and star outlines that read it | feat/wave3/A15-shape-tools | D:/Dev/Paka-overnight-worktrees/A15-The shape tools: the shape options as one model, the press-time capture, and the rectangle, ellipse, polygon and star outlines that read it | 9baec0d | feat/wave3/A15-shape-tools | src/core/tools/shapeGeometry.ts, shapeTool.ts |
| A16 | Selection modes: the select tool's modes as one model, and the pure geometry that each mode needs | feat/wave3/A16-selection-modes | D:/Dev/Paka-overnight-worktrees/A16-Selection modes: the select tool's modes as one model, and the pure geometry that each mode needs | 9baec0d | feat/wave3/A16-selection-modes | src/core/tools/selectTool.ts |
| A17 | The transform handles: the corner and rotation handles, their grab radius and their hit-test, as one pure module | feat/wave3/A17-transform-handles | D:/Dev/Paka-overnight-worktrees/A17-The transform handles: the corner and rotation handles, their grab radius and their hit-test, as one pure module | 9baec0d | feat/wave3/A17-transform-handles | src/core/document/selectionHandles.ts |
| A18 | Reference images: the store, the decoder and the pure geometry that places a reference image over the document | feat/wave3/A18-reference-images | D:/Dev/Paka-overnight-worktrees/A18-Reference images: the store, the decoder and the pure geometry that places a reference image over the document | 9baec0d | feat/wave3/A18-reference-images | src/core/reference/** |
| A19 | The rulers: the pure geometry of a ruler's ticks and its labels, and the overlay that paints them | feat/wave3/A19-rulers | D:/Dev/Paka-overnight-worktrees/A19-The rulers: the pure geometry of a ruler's ticks and its labels, and the overlay that paints them | 9baec0d | feat/wave3/A19-rulers | src/core/rendering/rulers.ts |
| A20 | The bucket's options and its scan: the tolerance, the sample scale and the contiguous/edge rule as pure modules | feat/wave3/A20-fill-options | D:/Dev/Paka-overnight-worktrees/A20-The bucket's options and its scan: the tolerance, the sample scale and the contiguous/edge rule as pure modules | 9baec0d | feat/wave3/A20-fill-options | src/core/fill/floodFill.ts |
| A21 | Gradient editing: the handles that move a gradient's stops, the command that makes the move one undo step, and the pure geometry of a handle | feat/wave3/A21-gradient-editing | D:/Dev/Paka-overnight-worktrees/A21-Gradient editing: the handles that move a gradient's stops, the command that makes the move one undo step, and the pure geometry of a handle | 9baec0d | feat/wave3/A21-gradient-editing | src/core/gradient/gradientRecord.ts, src/core/project/projectFormat.ts |
| A22 | The settings document's sections: one contract that lets a feature add its own section to the settings file without editing the reader | feat/wave3/A22-settings-sections | D:/Dev/Paka-overnight-worktrees/A22-The settings document's sections: one contract that lets a feature add its own section to the settings file without editing the reader | 9baec0d | feat/wave3/A22-settings-sections | src/core/settings/appSettings.ts, settingsStore.ts |
| A23 | The shortcut editor: the user's own chords, the conflict rules, and the editor that lists them | feat/wave3/A23-shortcut-editor | D:/Dev/Paka-overnight-worktrees/A23-The shortcut editor: the user's own chords, the conflict rules, and the editor that lists them | 9baec0d | feat/wave3/A23-shortcut-editor | src/core/actions/keyboard.ts, types.ts |
| A24 | Workspace profiles: named shell layouts the user can save and switch between, as a pure model over core/shell/slots | feat/wave3/A24-workspace-profiles | D:/Dev/Paka-overnight-worktrees/A24-Workspace profiles: named shell layouts the user can save and switch between, as a pure model over core/shell/slots | 9baec0d | feat/wave3/A24-workspace-profiles | src/core/workspace/workspaceProfiles.ts |
| A25 | Menu navigation: the keyboard rules for a menu bar (open, close, move between items) as a pure module | feat/wave3/A25-menu-navigation | D:/Dev/Paka-overnight-worktrees/A25-Menu navigation: the keyboard rules for a menu bar (open, close, move between items) as a pure module | 9baec0d | feat/wave3/A25-menu-navigation | src/components/layout/AppMenuBar.tsx |
| A26 | Layer groups: the group as a layer element, its own commands, and the panel that shows the tree | feat/wave3/A26-layer-groups | D:/Dev/Paka-overnight-worktrees/A26-Layer groups: the group as a layer element, its own commands, and the panel that shows the tree | 9baec0d | feat/wave3/A26-layer-groups | src/core/document/types.ts, src/core/project/projectFormat.ts |
| A27 | The bundled brush presets: the shipped library as data, and the rule that keeps a user preset from colliding with a bundled one | feat/wave3/A27-bundled-presets | D:/Dev/Paka-overnight-worktrees/A27-The bundled brush presets: the shipped library as data, and the rule that keeps a user preset from colliding with a bundled one | 9baec0d | feat/wave3/A27-bundled-presets | src/core/brushes/bundledPresets.ts, presets.ts |
| A28 | The panel layout's persisted state: the settings section that carries which panels are shown, folded and in which slot | feat/wave3/A28-panel-layout-state | D:/Dev/Paka-overnight-worktrees/A28-The panel layout's persisted state: the settings section that carries which panels are shown, folded and in which slot | 9baec0d | feat/wave3/A28-panel-layout-state | src/core/panels/panelLayoutSection.ts |
| A29 | Pointer ownership: which gesture owns the pointer, how a capture is taken and released, and the rules that stop two gestures reading one pointer | feat/wave3/A29-pointer-ownership | D:/Dev/Paka-overnight-worktrees/A29-Pointer ownership: which gesture owns the pointer, how a capture is taken and released, and the rules that stop two gestures reading one pointer | 9baec0d | feat/wave3/A29-pointer-ownership | src/core/input/canvasInputBinder.ts |

## The integration order

The contended surfaces are serialized: the shell's composition, the toolbar
and the options bar, the pointer routing, the renderer, the layer model and
the persistence. A builder's commit is merged **after** the commits it
depends on, one at a time, with `--no-ff` and never a rebase.

| Step | Builder | Surface | Depends on |
| --- | --- | --- | --- |
| 1 | A08 | the layers panel | the base |
| 2 | A11 | the shared contracts and the panel manager | the base |
| 3 | A22 | the settings document | A11, A28 |
| 4 | A28 | the panel layout's persisted state | A11, A22 |
| 5 | A24 | the workspace profiles | A11, A28 |
| 6 | A07 | the colour dock | A11 |
| 7 | A02 | the options bar | A11 |
| 8 | A03 | the toolbox | A02 |
| 9 | A25 | the menu's keyboard rules | A03 |
| 10 | A01 | the shell's composition | A07, A11, A24 |
| 11 | A23 | the shortcut editor | A25 |
| 12 | A04 | the brush properties | the base |
| 13 | A05 | the brush size gesture | A04 |
| 14 | A06 | the preset browser | A04, A27 |
| 15 | A27 | the bundled presets | A04 |
| 16 | A10 | the brush cursor and the preview | A04, A14 |
| 17 | A12 | the pressure dynamics | the base |
| 18 | A14 | the brush tips | A12, A17 |
| 19 | A15 | the shape tools | A02 |
| 20 | A16 | the selection modes | A17 |
| 21 | A17 | the transform handles | the base |
| 22 | A09 | the view navigation | A11 |
| 23 | A13 | the symmetry | A11 |
| 24 | A19 | the rulers | A11, A09 |
| 25 | A18 | the reference images | the base |
| 26 | A20 | the fill's options | the base |
| 27 | A21 | the gradient editing | the base |
| 28 | A26 | the layer groups | A08 |
| 29 | A29 | the pointer ownership | the base |
