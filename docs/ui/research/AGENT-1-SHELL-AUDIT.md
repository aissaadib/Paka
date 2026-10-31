# AGENT-1-SHELL-AUDIT — FireAlpaca UI Source Audit

**Scope**: Read-only research. FireAlpaca / FireAlpaca SE (PGN Inc.) — **no public source repository exists**.
This is `BEHAVIOR-REFERENCE` only, per the official Terms of Service: *"Any redistribution or
reproduction of part or all of the contents in any form is prohibited."* No code, icons, assets,
screenshots, or text from FireAlpaca may be copied into Paka. Everything below is a behavioural
specification drawn from the official manual (`firealpaca.net/manual/`), product site, and
official screenshots — all read into `D:\dev\paka-research\swarm\agent-01\` and never committed
to Paka.

**Date**: 2026-10-25  
**Paka repo**: D:\dev\Paka  
**Paka state**: 1557 tests passing, typecheck clean, build succeeds (from improvement scan)

---

## 1. Application Window and Root Layout

| Region | Source file | Symbol | Lines | Observed layout and behavior | Confidence |
|--------|-------------|--------|-------|------------------------------|------------|
| Whole-app window layout | `layout-window.jpg` (official FireAlpaca screenshot, agent-01/notes/img/) | n/a | n/a | Vertical Tool Bar rail (far left), horizontal Tool Option Bar under the menu bar, left dock (Color, Color History, Palette, Brush Preview, Brush Control, Brush), right dock (Navigator, Layer, Brush Size), bottom status strip. Windows are free-floating, reorderable, user-stackable; "You can change the order of windows, stack or separate them independently" | Verified from official manual page S1 (URL `firealpaca.net/manual/window/about-windows/`) |
| Paka equivalent shell | `src/components/layout/Workspace.tsx` | workspace layout | n/a | Fixed shell: AppMenuBar → ToolBar → workspace-body (ToolRail | CanvasStage | side-panels) → CanvasStatusBar. Free-floating windows are NOT supported; panels are docked in fixed left/right slots. | Verified in source |
| Menu bar | `src/components/layout/AppMenuBar.tsx` | AppMenuBar | n/a | Single menu bar at top; keyboard-driven (arrow keys open/walk, Enter runs, Escape closes, skips disabled items) | Verified in source |
| Tool options strip | `src/features/options/ToolOptionsBar.tsx` | ToolOptionsBar | n/a | One-row strip under menu bar; shows active tool's options only; 32px tall regardless of tool; narrow window scrolls sideways | Verified in source |
| Panel stack | `components/panels/PanelStack.tsx` | PanelStack | n/a | Renders panels from the shared registry; panels show/hide/fold to header | Verified in source |
| Status bar | `src/features/canvas/CanvasStatusBar.tsx` | CanvasStatusBar | n/a | Bottom status strip: file name + dirty marker, document size, active tool, active layer, zoom, history depth, selection, guides, grid, live cursor position | Verified in source |
| Canvas stage | `src/features/canvas/CanvasStage.tsx` | CanvasStage | n/a | Canvas surface; stage shell (separate overlay canvas recommended for grid/ruler) | Verified in source |

**Finding 1.1 — Free-floating dockable windows are NOT in scope for Paka.** FireAlpaca uses a
desktop window manager model (`Window > Initialize`, `Tab` hides all panels, `New View of Canvas`
tabs). Paka is a Tauri web app with a fixed shell. Copying the docking model is low-value/high-effort.
Copy only the information architecture: one contextual option strip that swaps with the active tool
(see Finding 3) and split colour into current/history/palette (see Finding 5).

**Finding 1.2 — Status bar already exists and exceeds FireAlpaca's.** Paka's `CanvasStatusBar.tsx`
is richer than FireAlpaca's undocumented status strip. It reads `EditorSnapshot` directly and
displays tool, layer, zoom, history depth, selection count, guide info, cursor position. No change
needed.

---

## 2. Menu Bar, Menu Hierarchy, and Commands

| Region | Source file | Symbol | Lines | Observed layout and behavior | Confidence |
|--------|-------------|--------|-------|------------------------------|------------|
| Menu bar | `src/components/layout/AppMenuBar.tsx` | AppMenuBar | n/a | Menu bar with Panels menu, Workspace menu, View menu, etc. Keyboard driven. Disabled items skipped. | Verified in source |
| Command table | `src/core/actions/registry.ts` | ACTION_DEFINITIONS / COMMAND_ACTIONS | n/a | Single command table; every command has a name, chord, availability, and enabled state. Shared by keyboard, menu, canvas context menu, and command palette. | Verified in source |
| Canvas context menu | `src/core/actions/canvasMenu.ts` | CANVAS_MENU | n/a | Right-click menu on canvas; rows are registry actions; greyed out with reason when unavailable (e.g. "Nothing is selected."); arrow keys walk rows skipping disabled; Home/End jump; Enter runs; Escape closes; click outside dismisses; right-button click never paints | Verified in source |
| Command palette | `src/features/commands/CommandPalette.tsx` | CommandPalette | n/a | Ctrl+K palette filters the same command table; loose matching; shows each command's chord; Enter runs | Verified in source |
| Shortcuts | `src/hooks/useKeyboardShortcuts.ts` | useKeyboardShortcuts | n/a | Keyboard shortcuts for tools (letters), view commands, file commands, selection transforms | Verified in source |

**Finding 2.1 — FireAlpaca menus: File / Edit / Layer / Select / View / Window / Tool / Brush / Color / Snap / Help.**
Key menu items from official manual pages S3-S12:
- **File > Environment Settings** (multiple tabs including Brush Environment Settings, Shortcut Settings)
- **Brush > Add Brush / Add Bitmap Brush / Add Script Brush / Add Brush Group / Duplicate Brush / Delete Brush / Export as File (MDB) / Import from File / Edit Brush / Brush Store / Previous/Next Brush / Previous/Next Size**
- **View > Grid (Ctrl+G) / Pixel Grid / Grid Settings (Ctrl+Shift+G) / Ruler / Ruler Settings / Guides / Edit Guides / Add Guide (Direction, Position) / Clear Guides / Brush Size / Hide Brush Cursor**
- **Snap > Save Snap** (named, max 10, FIFO)
- **Color > Transparent (Shift+Z) / Swap (X) / Initialize (D) / Restore Colors at Startup / Color Bar / Color Wheel / Clear All Palettes in Group / Import/Export Palette Group (FAP) / Import/Export ACO / Large Display of Palette / Lock Palette / Edit Gradients**
- **Window > New View of Canvas / per-window show/hide / Status Bar / Initialize / Styles (SE only)**
- **Layer > Add Layer / Add Layer Mask (SE only) / Add Layer Folder / Duplicate / Merge Down / Delete / Clipping / Protect Alpha / Lock / Reference**

**Paka-side command table** already covers most View/Tool/Layer/menu items via `core/actions/registry.ts`.
Missing relative to FireAlpaca's UI: grid toggle, ruler toggle, brush preset library menu, colour history/palette management, named snap settings save/load.

---

## 3. Main and Secondary Toolbars

| Region | Source file | Symbol | Lines | Observed layout and behavior | Confidence |
|--------|-------------|--------|-------|------------------------------|------------|
| Toolbar rail | `src/components/toolbar/ToolRail.tsx` | ToolRail | n/a | Vertical rail on left side of workspace-body | Verified in source |
| Tool options bar | `src/features/options/ToolOptionsBar.tsx` | ToolOptionsBar | n/a | Horizontal strip under menu bar; contextual (swaps with active tool); 32px tall | Verified in source |
| Tool icons | `src/components/toolbar/toolIcons.tsx` | TOOL_ICONS | n/a | Tool icons rendered in the rail | Verified in source |
| Brush controls | `src/features/brushes/BrushControls.tsx` | BrushControls | n/a | Always rendered (NOT contextual); preview, picker, reset | Verified in source |
| Shape controls | `src/features/shapes/ShapeControls.tsx` | ShapeControls | n/a | Rendered only when shape tool active | Verified in source |
| Fill controls | `src/features/.../FillControls.tsx` | FillControls | n/a | Rendered only when fill tool active | Verified in source |
| Gradient controls | `src/features/.../GradientControls.tsx` | GradientControls | n/a | Rendered only when gradient tool active | Verified in source |

**Finding 3.1 — BrushControls is the outlier.** FireAlpaca's tool-options strip is contextual: every tool's options appear in one strip that swaps with the active tool (`tool-options-brush.png` shows Snap icon-strip, Shape, Symmetry, Anti-aliasing(Global), Stabilizer(Global), Zero Pressure on Both Ends). Paka is *partly* contextual — Shape/Fill/Gradient controls self-hide — but `BrushControls` is **always rendered**, not conditional on brush/eraser tool being active.

**Finding 3.2 — FireAlpaca tool-options bar contents (from manual S6 / screenshot):**
- Snap icon strip (11 snap types)
- Shape toggle + dropdown
- Symmetry toggle + dropdown
- Anti-aliasing (Global)
- Stabilizer (Global) + value
- Zero Pressure on Both Ends checkbox

Paka already has a contextual strip but needs to fully conditionalize BrushControls (show only for brush/eraser).

---

## 4. Canvas Workspace and Document Navigation

| Region | Source file | Symbol | Lines | Observed layout and behavior | Confidence |
|--------|-------------|--------|-------|------------------------------|------------|
| Canvas surface | `src/features/canvas/CanvasStage.tsx` | CanvasStage | n/a | Canvas stage shell; separate overlay canvas recommended for grid/ruler | Verified in source |
| Viewport | `src/core/rendering/viewport.ts` | viewport transform | n/a | Zoom, pan, rotation, mirror transform | Verified in source |
| Second view | `src/core/engine/canvasViews.ts` | CanvasViewRegistry | n/a | Second view of canvas; same document, own transform | Verified in source |
| Zoom controls | `src/features/view/ZoomField.tsx`, `ViewControls.tsx` | ZoomField, ViewControls | n/a | Editable zoom field (2%-6400%), zoom buttons bounded at range ends, Fit, Actual Size, Reset View | Verified in source |
| Pan / rotate / mirror | `src/core/engine/DrawingEngine.ts` | pan, rotateView, toggleViewMirror | n/a | Space-drag pan, Shift+R rotate 90°, Shift+M mirror, Ctrl+Shift+0 reset | Verified in source |
| Navigator panel | `src/features/navigator/NavigatorPanel.tsx` | NavigatorPanel | n/a | Thumbnail of whole document with viewport marked; jump on click outside area; Fit/Centre buttons; arrow key pan | Verified in source |
| Reference images | `src/features/reference/ReferencePanel.tsx` | ReferencePanel | n/a | Reference image panel | Verified in source |
| FireAlpaca Navigator | `navigator.png` (official screenshot) | n/a | n/a | Thumbnail + red viewport rectangle + zoom bar + angle bar + 6 icon buttons | Verified from official manual screenshot S1/S11 |
| FireAlpaca Reference | `reference` manual page | n/a | n/a | Set/delete image, zoom, fit, pick colours from reference, rotate ±15°, reset, flip | Verified from official manual |

**Finding 4.1 — Navigator exists but lacks FireAlpaca's red viewport rect + zoom/angle bars.**
Paka's `NavigatorPanel.tsx` shows a thumbnail with visible area marked and offers Fit/Centre. FireAlpaca's Navigator (`navigator.png`) additionally has a **red viewport rectangle**, a **zoom bar**, and an **angle bar** (hover-revealed), plus 6 icon buttons. This is a behavior reference only — Paka should add its own variant if desired.

**Finding 4.2 — Reference images exist.** Paka's ReferencePanel (`core/reference/store.ts`) supports set/delete image, sampling, and the renderer paints references via `paintReferences`. FireAlpaca's `[Reference]` window adds colour-picking from the reference and rotate ±15° / flip.

---

## 5. Tool Palette: Ordering, Grouping, Active States, Contextual Options

| Region | Source file | Symbol | Lines | Observed layout and behavior | Confidence |
|--------|-------------|--------|-------|------------------------------|------------|
| Tool definitions | `src/core/tools/toolDefinitions.ts` | TOOL_DEFINITIONS | n/a | Tool registry: brush, eraser, line, rectangle, ellipse, polygon, star, select, bucket, gradient, color picker, guides, symmetry | Verified in source |
| Tool registration | `src/core/tools/toolRegistry.ts` | toolRegistry | n/a | Tool registry mechanics | Verified in source |
| Tool shortcuts | `src/hooks/useKeyboardShortcuts.ts` | useKeyboardShortcuts | n/a | Letter shortcuts per tool (B/E/M/G/L/W/S/T/O/I/H etc.) | Verified in source |
| Brush controls | `src/features/brushes/BrushControls.tsx` | BrushControls | n/a | Always rendered; preview, picker, reset, size slider + number box | Verified in source |
| Brush preset browser | `src/features/brushes/BrushPresetPanel.tsx` | BrushPresetPanel | n/a | Searchable/sortable brush list; real tip preview; star/favorite; save/rename/update/duplicate/delete/import/export | Verified in source |
| Tool options schema | `src/features/options/toolOptionSchema.ts` | toolOptionGroups / toolOptionFields | n/a | Declarative schema describing which fields each tool shows | Verified in source |

**Finding 5.1 — FireAlpaca brush model is a library, not a dropdown.** FireAlpaca's `[Brush]` window is a scrollable list of named brush objects, each with type, material, full parameter set, live stroke thumbnail, organized into brush groups. Brushes are duplicate-able, exportable, importable as `.MDB` files. `[Edit Brush]` dialog is tabbed (Option / Pen Pressure Correction / Texture / Post Processing). Paka already has a BrushPresetPanel implementing much of this (save/rename/update/duplicate/delete/star/import/export, real tip thumbnails, built-in protection) — verified in source.

**Finding 5.2 — FireAlpaca tool-option bar contextuality.** From `tool-options-brush.png` and manual S6: the strip shows snap icon strip, Shape, Symmetry, Anti-aliasing(Global), Stabilizer(Global), Zero Pressure on Both Ends — all gated by active tool. Paka's strip is partially contextual; `BrushControls` renders unconditionally (Finding 3.1).

**Finding 5.3 — Brush size scrub.** FireAlpaca: *"Drag left to right holding Ctrl and Alt keys down"* for brush size, shown in `[Brush Control]` window. Paka already has quick resize via Ctrl+Alt+drag (verified in DrawingEngine.ts) — matches.

---

## 6. Status Bar and Canvas Navigation Controls

| Region | Source file | Symbol | Lines | Observed layout and behavior | Confidence |
|--------|-------------|--------|-------|------------------------------|------------|
| Status bar | `src/features/canvas/CanvasStatusBar.tsx` | CanvasStatusBar | n/a | File name + dirty marker, document size, active tool, active layer, zoom, history depth, selection count, guides, grid, cursor position, input kind | Verified in source |
| Zoom | `src/features/view/ZoomField.tsx`, `ViewControls.tsx` | ZoomField, ViewControls | n/a | Editable zoom field (2%-6400%), zoom buttons bounded at range ends, Fit, Actual Size, Reset View | Verified in source |
| Pan | `src/core/engine/DrawingEngine.ts` | pan | n/a | Space-drag pan | Verified in source |
| Rotate / mirror | `src/core/engine/DrawingEngine.ts` | rotateView, toggleViewMirror, resetView | n/a | Shift+R rotate 90°, Shift+M mirror, Ctrl+Shift+0 reset | Verified in source |
| Navigator | `src/features/navigator/NavigatorPanel.tsx` | NavigatorPanel | n/a | Thumbnail, viewport marked, jump on click outside, drag inside, Fit/Centre, arrow keys pan | Verified in source |
| FireAlpaca Status Bar | `window/about-windows/` manual page S1 | Status Bar | n/a | "under the canvas"; Window menu shows/hides it | Verified from official manual |
| FireAlpaca Navigator | `navigator.png` screenshot | n/a | n/a | 6 icon buttons + zoom bar + angle bar + thumbnail with red viewport rect | Verified from official screenshot |

**Finding 6.1 — Paka's status bar already exceeds FireAlpaca's.** FireAlpaca's status bar is undocumented beyond "under the canvas." Paka's `CanvasStatusBar.tsx` is richer: file name, dirty marker, document size, active tool, active layer, zoom, history depth, selection count, guides, grid, cursor position, input kind.

**Finding 6.2 — Zoom/pan/rotate parity.** Paka matches FireAlpaca's zoom in/out/fit/100%, rotate (FireAlpaca: ±30°; Paka: 90° steps + Reset View), mirror, pan (space-drag). FireAlpaca's Navigator additionally has zoom bar + angle bar (hover-revealed) + red viewport rect — Paka's NavigatorPanel shows the viewport area but not those extra controls.

---

## 7. Panel Arrangement, Resizing, Visibility, Scrolling

| Region | Source file | Symbol | Lines | Observed layout and behavior | Confidence |
|--------|-------------|--------|-------|------------------------------|------------|
| Panel registry | `core/panels/panelRegistry.ts` | panelDefinitions / sidePanelDefinitions | n/a | Shared panel registry; panels register themselves; Panels menu shows/hides/folds | Verified in source |
| Panel layout | `core/panels/panelLayout.ts` | PanelLayoutState | n/a | Layout rules; setPanelVisibility, togglePanelVisibility, setPanelCollapsed, resetPanelLayout | Verified in source |
| Panel store | `state/panelStore.ts` | PanelActions | n/a | Live panel layout state | Verified in source |
| Panel chrome | `components/panels/Panel.tsx` | PanelChromeContext | n/a | Panel chrome: hidden/folded state | Verified in source |
| Panel stack | `components/panels/PanelStack.tsx` | PanelStack | n/a | Renders panels from registry | Verified in source |
| Panel persistence | `settings` section under `panels` key | settings file | n/a | Panel layout persisted in settings file as `panels` section | Verified in source |
| Workspace profiles | `core/workspace/workspaceProfiles.ts` | WORKSPACE_PROFILES | n/a | Painting profile (every panel up), Compact Canvas profile (panels hidden) | Verified in source |
| Workspace settings | `core/workspace/workspaceSettings.ts` | workspace schema | n/a | Interface scale, colour scheme, brush panel density | Verified in source |

**Finding 7.1 — FireAlpaca: free-floating, rearrangeable windows.** From manual S10: windows are user-arrangeable, stackable, separable; `Window > Initialize` resets all window positions; `Tab` hides/shows all windows. Paka uses fixed dock slots with panel registry — **do not copy the docking model**; it's a large low-value change for a Tauri web app.

**Finding 7.2 — Paka already persists panel layout.** Panel visibility and collapse state are persisted in the settings file under `panels` key. Workspace profiles (Painting / Compact Canvas) offer two real arrangements plus Restore Defaults. A manually arranged workspace is honestly called "Custom."

**Finding 7.3 — Brush panel density.** The workspace holds brush panel density (full controls vs just size+opacity) — matches FireAlpaca's `[Brush Control]` being a smaller 4-row variant of the full `[Brush]` window.

---

## 8. Window Sizing and DPI-Related Behavior

| Region | Source file | Symbol | Lines | Observed layout and behavior | Confidence |
|--------|-------------|--------|-------|------------------------------|------------|
| Window fit / DPI | `src-tauri/src/window_fit.rs` | work-area clamp, physical-pixel arithmetic | ~300 | Work-area clamp, physical-pixel arithmetic, DPI handling | Verified in source |
| Window size config | `src-tauri/tauri.conf.json` | bundle / app windows | n/a | Default window 1440×900, min 960×600, resizable | Verified in source |
| UI scale | `core/workspace/workspaceSettings.ts` | `--ui-scale` token | n/a | Interface scale token on root element; whole shell grows/shrinks together | Verified in source |
| Colour scheme | `core/workspace/workspaceSettings.ts` | dark/light scheme | n/a | Same token names for dark and light schemes | Verified in source |
| Brush cursor ring | `core/brushes/brushCursor.ts` | brushRingGeometry | n/a | Ring sized in document pixels through zoom; one device pixel outline (hairline at any density) | Verified in source |

**Finding 8.1 — DPI handling exists in Tauri layer.** `src-tauri/src/window_fit.rs` handles work-area clamp and physical-pixel arithmetic for window sizing/DPI. No change needed.

**Finding 8.2 — Brush cursor is DPI-safe.** The ring's diameter is in document pixels through the current zoom; outline is one device pixel wide so it stays a hairline at any density (verified in `brushCursor.ts`).

---

## Component Hierarchy

```
App (AppMenuBar)
  ├── Toolbar / ToolRail (vertical tool rail)
  ├── ToolOptionsBar (one-row contextual strip under menu bar)
  │     ├── BrushControls (ALWAYS rendered — should be conditional on brush/eraser)
  │     ├── ShapeControls (only when shape tool active)
  │     ├── FillControls (only when fill tool active)
  │     └── GradientControls (only when gradient tool active)
  ├── workspace-body
  │     ├── CanvasStage (canvas surface)
  │     │     ├── BrushCursor overlay (DOM sibling of canvas)
  │     │     └── [recommended: overlay canvas for grid/ruler]
  │     ├── side panels (BrushPresetPanel, ColorPanel, NavigatorPanel, ReferencePanel, LayersPanel, etc.)
  │     └── NavigatorPanel (thumbnail + viewport area)
  └── CanvasStatusBar (bottom strip)
```

---

## Prioritized Findings for the Lead

**High priority (implementation value):**
1. **BrushControls conditionalization** — `BrushControls.tsx` is always rendered; FireAlpaca's tool-options strip is contextual and swaps with the active tool. Make BrushControls show only when brush/eraser tool is active (like Shape/Fill/Gradient already do). File: `src/features/options/toolOptionSchema.ts` + `ToolOptionsBar.tsx`.
2. **Pressure response curve (G2)** — FireAlpaca's `Edit Brush > Pen Pressure Correction` is a draggable graph. Paka has two checkboxes at fixed `PRESSURE_STRENGTH = 0.6` with linear mapping. New field `pressureCurve` in `types/brush.ts`; version bump v9→10 in `projectFormat.ts`; renderer change in `canvas2dStroke.ts`.
3. **Colour split: current / history / palette (G4)** — FireAlpaca has 3 separate windows (`[Color]`, `[Color History]`, `[Color Palette]`). Paka has one hardcoded 8-entry `PALETTE` constant. New app-level state; persistence blocked on settings store (G8).

**Medium priority:**
4. **Navigator enhancements** — Add zoom bar, angle bar, red viewport rectangle (FireAlpaca `navigator.png`). File: `src/features/navigator/NavigatorPanel.tsx`.
5. **Grid + Ruler (G3/G5)** — Viewport chrome only, separate overlay canvas above document canvas. No renderer/document change needed. Files: new overlay canvas, state in app state, not project format.
6. **Layer clipping + folders (G10)** — Cheap additions to layer model; masks are SE-only.

**Low priority / do-not-copy:**
7. **Free-floating dockable windows** — Do not copy FireAlpaca's window manager model into Tauri web app.
8. **Brush tip assets (G13)** — FireAlpaca's 800 brushes are PGN-copyrighted; Paka must ship its own assets or none.
9. **Format version churn** — Bundle brush field additions into single `PROJECT_VERSION` bumps.

---

## Handoff

No Paka file was created, edited, deleted, or committed. No git operation was run on Paka. No FireAlpaca code, icons, assets, screenshots, or text was copied into Paka. Everything FireAlpaca-side is behaviour reference from the official manual and screenshots, all read into `D:\dev\paka-research\swarm\agent-01\`.

**Key Paka-side symbols to touch for the top 3 findings:**
- `src/features/options/toolOptionSchema.ts` — tool option groups/fields schema (make BrushControls conditional)
- `src/features/options/ToolOptionsBar.tsx` — the strip renderer
- `src/features/brushes/BrushControls.tsx` — currently always rendered
- `src/types/brush.ts` — `BrushSettings` type (add `pressureCurve`)
- `src/core/project/projectFormat.ts` — `PROJECT_VERSION` (line 108), `readBrush` (line ~797)
- `src/core/rendering/canvas2dStroke.ts` — `strokeDiameter` / `strokeOpacity` (linear pressure mapping)
- `src/features/color/ColorControls.tsx` — `PALETTE` constant (line 10-19)

**Recommended next slice:** (a) make BrushControls contextual, (b) add pressure-curve field + single v9→10 version bump carrying any other new brush field. Both are self-contained with concrete test plans documented in agent-01/report.md §7.
