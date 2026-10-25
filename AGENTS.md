# AGENTS.md — token-efficient repo map

**Read this before opening source files.** It tells you which file and symbol to
open for a task, and what not to read. Line numbers are from commit `474d04a`
and drift; **grep is authoritative**.

The project state, settled decisions and next slice live in
[`docs/SESSION-BRIEF.md`](docs/SESSION-BRIEF.md) and
[`docs/ROADMAP.md`](docs/ROADMAP.md). Read those two; do not re-derive the
architecture by browsing.

---

## 1. Reading protocol (in order)

1. **Grep the symbol, not the folder.** `rg -n "SymbolName" src` (or the
   harness `grep` tool). One good match beats a directory listing.
2. **Read a window, not a file.** Open ±40 lines around the match, plus the
   top-of-file doc comment when the contract matters.
3. **Read tests by name.** `rg -n "describe\\(|it\\(" <test-file>` to find the
   relevant block; open only that block. Test files are the largest in the repo.
4. **Never read a file over 250 lines end to end.** Use the big-file list in §3.
   Exception: you may read a whole file under 150 lines.
5. **Stop rule.** If you have read roughly 600 lines and still cannot name the
   file *and* function you need to change, stop opening files and search for
   the missing symbol instead (or ask). More browsing is not progress.
6. **After editing, use `git diff --stat` / `git diff -- <path>`**, not a
   re-read of the file.
7. **Do not read a file to confirm it exists.** `git ls-files` or `rg --files`
   is cheaper.

## 2. Do not read (generated, vendored or redundant)

| Path | Why |
| --- | --- |
| `node_modules/`, `dist/`, `.dist/`, `.git/` | Generated / huge |
| `src-tauri/target/` | Cargo artifacts (tens of thousands of lines) |
| `pnpm-lock.yaml` | 681 lines of dependency data |
| `.agents/skills/**` | Vendored skill docs, not this project |
| `public/` | Static icons only |
| `src-tauri/gen/` | Generated Tauri schemas, if present |
| `licenses/*.txt` | Verbatim third-party licence texts; regenerate the notice file, do not read them |
| All 34 test files | Use the test map in §8 |
| `README.md` end to end | Feature prose duplicates SESSION-BRIEF; open only for user-facing wording |
| `docs/HANDOFF.md` and `docs/SESSION-BRIEF.md` both, end to end | Read SESSION-BRIEF first; HANDOFF only §7/§8 when you need toolchain or verification detail |
| `docs/ARCHITECTURE.md` end to end (1549 lines) | Read the named section in §6 |

## 3. File sizes (source only)

**Large (>250 lines) - never read whole:**

| Lines | File | What is in it |
| --- | --- | --- |
| 3441 | `src/core/engine/DrawingEngine.ts` | snapshot, gestures, history, layers, selection, grid and snapping |
| 3503 | `src/test/drawingEngine.test.ts` | engine behaviour (grep `it(`) |
| 3684 | `src/test/canvas2dRenderer.test.ts` | renderer behaviour (grep `it(`) |
| 1555 | `src/test/projectFormat.test.ts` | format round-trips/rejections |
| 1752 | `src/core/rendering/Canvas2DRenderer.ts` | buffers, compositing, feather scratch, rebuilds |
| 890 | `src/core/project/projectFormat.ts` | serialize/parse/validate |
| 355 | `src/core/commands/strokeEditCommand.ts` | move/delete/nudge/flip/duplicate |

**Medium (100-250) - read targeted windows:** `AppMenuBar`, `icons`,
`document.ts`, `recordingCanvas.ts`, `canvasInputBinder`, `useKeyboardShortcuts`,
`floodFill`, `document/types.ts`, `document/guides.ts`,
`document/selectionTransform.ts` (the scale/rotate geometry),
`document/selectionHandles.ts` (the transform handles),
`canvas2dStroke`,
`strokeBuilder`, `strokeSelection`, `commandStack`,
`types.ts` (tools), `guidesTool.ts` (138),
`features/color/wheelGeometry.ts` (102),
`core/brushes/presets.ts` (161: the preset model, its validation and its equality),
`core/brushes/kritaDefaults.ts` (169: the Krita 4 preset translation, its provenance and its import helper),
`features/brushes/BrushPresets.tsx` (176),
`features/brushes/BrushPresetPanel.tsx` (the browser: the grid, the search, the order, the keys),
`features/brushes/PresetRow.tsx` (one tile of the grid: the thumbnail, the corner star and the edited dot),
`features/brushes/brushIcons.ts` (the six built-in icons: the grid, the palette, the run grouping and the preset lookup),
`features/brushes/brushIconFromBrush.ts` (the generated icons: the kind, the per-kind palettes, the mark and the preset lookup),
`features/brushes/BrushIcon.tsx` (the icon, drawn as one path per colour, at 40 px),
`core/document/blendModes.ts` (125: the closed mode list and the separable formulas),
`utils/colorPair.ts` (179),
`features/color/ContrastReadout.tsx` (198),
`features/options/OptionControl.tsx` (134: the one control for every kind),
`features/document/NewDocumentDialog.tsx` (147: the size fields and presets),
`features/options/toolOptions.css` (161),
`core/settings/settingsStore.ts`,
`core/autosave/autosaveService.ts`,
feature controls in `features/`, `ProjectFiles`, `project_io.rs`.

**Between 250 and 400 - read targeted windows:** `core/tools/shapeGeometry.ts`
(395: the line, the rectangle, the ellipse, the polygon, the star, the rigid
rotation, the shape options and their clamps), `core/tools/shapeOptions.ts`
(the one options model: the values, the ranges, the defaults and the table of
which shape kind has which option), `core/tools/shapeToolOptions.ts` (the
controls built from that model and registered in the shared registry),
`src-tauri/src/window_fit.rs`
(~300: the work-area clamp, the physical-pixel arithmetic and the cases),
`core/document/grid.ts` (283: the grid lattice, the snap candidates and the
document-space tolerance), `core/settings/appSettings.ts` (269: the settings
document, its readers and its per-field validation),
`core/document/symmetry.ts` (278: the modes, the axes, the mirrors, the mirrored point),
`core/rendering/symmetryAxesOverlay.ts` (152),
`core/input/ownership.ts` (275: the ownership state, the take/release/cancel
rules and the routing).
`core/options/optionControl.ts` (322: the control table for every kind of tool
option, the exhaustive dispatch and the bar's grouping).

**Over 400 - read targeted windows:** `src/test/shapeGeometry.test.ts` (559: the
shape geometry), `core/rendering/stampCoverage.ts` (533: the dab plan, the
per-dab profile, the per-dab directional texture and the coverage union),
`src/utils/colorMetrics.ts` (607: WCAG luminance and contrast, sRGB to CIELAB,
CIEDE2000, the nearest palette entry, and the total/never-throws rules),
`src/test/stampCoverage.test.ts` (508: the dab plan, the texture, the union
and the budget).

**Small (<100) - safe to read whole:** defaults, fillPatch, gradientRecord,
pngExport, viewport, frameScheduler, pointer, documentCommand, fill/gradient
commands, tool definitions, `editorStore.ts`, `features/color/wheelState.ts`,
`core/document/canvasSizePresets.ts` (the New Document quick sizes),
`features/color/ColorField.tsx`, `features/color/colorInput.ts`,
`features/grid/GridControls.tsx`, `utils/record.ts`,
`core/settings/settingsGateway.ts`, `core/settings/tauriSettingsGateway.ts`,
`core/autosave/recovery.ts`,
Rust `lib.rs`/`main.rs`/`native_environment.rs`/`settings_io.rs`,
`scripts/generate-app-icon.mjs`,
`scripts/generate-third-party-notices.mjs`.

## 4. Task → read only this

| Task | Open, in order |
| --- | --- |
| Add or change a tool gesture | `core/tools/<tool>.ts` (≈90 lines), `core/tools/types.ts` (Tool/ToolContext), then the matching `begin*/finish*/cancel*` block in `DrawingEngine.ts` (§5) |
| Change the composition guides | `core/document/guides.ts` (the axis heuristic, the rounding, the grab radius, the hit-test, the duplicate rule), `core/document/types.ts` (`Guide`), `core/tools/guidesTool.ts`, the guide block in `DrawingEngine.ts`, `paintGuides` in `Canvas2DRenderer.ts` |
| Change the reference images | `core/reference/types.ts` (`ReferenceImage`, the patch), `core/reference/geometry.ts` (the placement, the rotation, the corners, the handles, the hit-test, the source-pixel mapping, the resize and the patch/clamp rules), `core/reference/decode.ts` (the format sniff, the byte/pixel ceilings), `core/reference/store.ts` (the one decoded copy per id), `core/document/types.ts` (`DrawingDocument.references`), `core/tools/referenceTool.ts` (the three gestures), the reference block in `DrawingEngine.ts` (`importReference`, the setters, `begin`/`update`/`finish`/`cancelReferenceGesture`, `syncReferences`), `Canvas2DRenderer.ts` (`paintReferences`, `paintReferenceSelection`, `includeReferences`), `features/reference/ReferencePanel.tsx`, `projectFormat.ts` (`readReferences`, v14), `src/test/referenceManipulation.test.ts`, `src/test/referenceRendering.test.ts`, `src/test/referenceFormat.test.ts` |
| Change the symmetry | `core/document/symmetry.ts` (the modes, the axes, the mirrors, the mirrored point), `core/rendering/symmetryAxesOverlay.ts` (the overlay, registered through the shell's registry), `src/test/symmetry.test.ts` |
| Change the grid or the snapping | `core/document/grid.ts` (the pure rules: the nearest grid line, the lines between two coordinates, the magnet tolerance, the target choice), `core/engine/DrawingEngine.ts` (`SNAPPING_TOOL_IDS`, `snapSample`, the three setters), `core/rendering/Canvas2DRenderer.ts` (`paintGrid`), `core/rendering/types.ts` (`setGrid`), `features/grid/GridControls.tsx`, `core/settings/appSettings.ts` |
| Change a shape's geometry (polygon, star) | `core/tools/shapeOptions.ts` (`ShapeOptions`, `normalizeShapeOptions`, `SHAPE_OPTION_FIELDS` - the one options model), `core/tools/shapeGeometry.ts` (`shapeOutline`, `rotateAboutCentre`, `polygonOutline`, `starOutline`), `core/tools/shapeToolOptions.ts` (the controls, registered in the shared registry), `core/tools/shapeTool.ts` (the press-time capture), `core/tools/types.ts` (`ToolContext.getShapeOptions`), `DrawingEngine.ts` (`getShapeOptions`, `setShapeSides`/`setShapeInnerRatio`/`setShapeRotation`), `state/editorStore.ts`, `features/shapes/ShapeControls.tsx`, `src/test/shapeGeometry.test.ts` |
| Register a tool / shortcut | `core/tools/toolDefinitions.ts` (L11-134), `core/tools/toolRegistry.ts`, `types/tool.ts`, `hooks/useKeyboardShortcuts.ts`, `components/toolbar/ToolRail.tsx` |
| Change stroke rasterization | `core/rendering/canvas2dStroke.ts` (207), `Canvas2DRenderer.ts` `rasterizeStrokeToBuffer`/`compositeStrokeBuffer`/`applyErase` |
| Change the stamp (dab) engine | `core/rendering/stampCoverage.ts` (`stampDabs`, `StampDabCursor`, `stampDabCoverage`, `StampCoverage`, `STAMP_TEXTURE_LANES`, `stampTextureLaneWidth`, `MAX_STAMP_COVERAGE_WORK`), `Canvas2DRenderer.ts` `extendStampStroke`/`rasterizeStampStroke`/`writeStampCoverage`, `types/brush.ts`, `BrushControls.tsx`, `projectFormat.ts` `readBrush` (v9/v10) |
| Change brush hardness / soft edge | `canvas2dStroke.ts` `strokeFeatherRadius` (L32-48), `Canvas2DRenderer.ts` `paintStrokeCoverage`/`featherStroke` (L1263/L1389), `features/brushes/BrushControls.tsx`, `projectFormat.ts` `readBrush` (L797) |
| Change texture / grain | `canvas2dStroke.ts` `textureCoverage`/`TEXTURE_TILE_SIZE` (L52-65), `Canvas2DRenderer.ts` `applyStrokeTexture`/`textureTile` (L1324/L1350), `types/brush.ts`, `BrushControls.tsx`, format v7 |
| Change brush sampling (spacing/stabilizer) | `core/brushes/strokeBuilder.ts` (`addSample` L114, `STABILIZER_MAX_LAG` L39, `finish` L193), `DrawingEngine.ts` `finishStroke` (L1607), `types/brush.ts`, `BrushControls.tsx`, tests in `strokeBuilder.test.ts`/`drawingEngine.test.ts` |
| Add a brush field | `types/brush.ts`, `core/brushes/defaults.ts` (the field lists and `readBrushSettings`), `features/brushes/BrushControls.tsx`, `projectFormat.ts` `readBrush`/serialize, `engine.setBrush`. A sampling-only field may be additive; one that changes how stored samples render needs a version bump |
| Change the brush presets | `core/brushes/presets.ts` (the model, the name rules, `normalizeBrushPresets`), `core/brushes/defaults.ts` (`readBrushSettings`), `core/settings/appSettings.ts` (the `presets` field), `DrawingEngine.ts` (`setPresets`/`saveBrushPreset`/`renameBrushPreset`/`duplicateBrushPreset`/`applyBrushPreset`), `features/brushes/BrushPresets.tsx`, `state/editorStore.ts` |
| Change a brush icon | `features/brushes/brushIcons.ts` (the grid model, `framed`, the six hand-drawn icons, `brushIconRuns`/`brushIconPaths`), `features/brushes/brushIconFromBrush.ts` (`brushGlyphId` the kind order, `PALETTES` per kind, `swashRows` the mark, `brushIconForPreset`), `features/brushes/BrushIcon.tsx` (one `<path>` per colour, `BRUSH_ICON_CSS_SIZE`), `features/brushes/PresetRow.tsx` (the tile), `src/test/brushIcons.test.ts`, `tests/visual/brush-icons.spec.ts` |
| Change the brush library's grid | `features/brushes/brushPresets.css` (`.brush-browser__tiles` the grid and the tile minimum, `.brush-tile*` the square, the ring, the corner star and the edited dot), `features/brushes/PresetRow.tsx` (one tile: the pick button, the star, `data-built-in`), `features/brushes/BrushPresetPanel.tsx` (`gridColumnCount`, the arrow keys move a tile or a row, the selected tile is scrolled into view), `core/brushes/presetBrowser.ts` (`nextSelectionId` takes a step), `src/test/presetBrowser.test.ts`, `tests/visual/brush-icons.spec.ts` |
| Add or change the Krita 4 presets | `core/brushes/kritaDefaults.ts` (the specs, the builder, `missingKritaPresets`), `features/brushes/BrushPresetPanel.tsx` (the one-click button), `src/test/kritaPresets.test.ts`, `tests/visual/krita-presets.spec.ts` |
| Add a layer element kind | `document/types.ts`, `document/strokeStore.ts`, renderer rasterize + rebuild path, a command, `projectFormat.ts`, `PROJECT_FORMAT.md` |
| Change the layer groups (the tree) | `core/document/layerGroups.ts` (the tree rules: the children, the order, the ancestor rule, dissolving), `core/document/types.ts` (`Layer.kind`, `Layer.children`), `core/document/document.ts` (the tree-aware layer operations), `core/commands/documentCommand.ts` (the group commands), `core/project/projectFormat.ts` (version 13), `features/layers/LayersPanel.tsx`, `PROJECT_FORMAT.md` |
| Add or change a layer blend mode | `core/document/blendModes.ts` (the closed list, the guard, the formulas), `core/document/types.ts` (`LayerBlendMode`), `Canvas2DRenderer.ts` (`compositeOperationFor`), `features/layers/LayersPanel.tsx`, `projectFormat.ts` (the versioned closed set), `PROJECT_FORMAT.md` |
| Undo/redo behaviour | `core/commands/commandStack.ts`, the command in `core/commands/`, `engine.executeDocumentCommand`/`recordHistoryChange` |
| Persistence / format version | `projectFormat.ts` (`PROJECT_VERSION` L108, `serializeProject` L443, `parseProject` L520, `readBrush` L797), `PROJECT_FORMAT.md` (§§ `brush`, `Versioning`) |
| File open/save orchestration | `core/project/projectFiles.ts`, `projectGateway.ts`, `tauriGateway.ts`, `features/project/useFileCommands.ts` |
| Layer operation | `core/document/document.ts`, `core/commands/documentCommand.ts`, `DrawingEngine.ts` L755-868, `features/layers/LayersPanel.tsx` |
| Selection / transform | `core/document/strokeSelection.ts`, `core/document/selectionTransform.ts` (the pure scale/rotate geometry), `core/document/selectionHandles.ts` (the corner and rotation handles), `core/tools/selectTool.ts`, `DrawingEngine.ts` L1665-1989, `strokeEditCommand.ts` |
| Add a UI control | matching `features/**/…Controls.tsx`, `state/editorStore.ts` (`EditorActions`), the engine setter and `EditorSnapshot` field |
| Change the New Document canvas sizes | `core/document/canvasSizePresets.ts` (the presets and their selected state), `core/document/document.ts` (`MIN_DOCUMENT_SIZE`, `MAX_DOCUMENT_SIZE`, `MAX_DOCUMENT_PIXELS`, `isValidDocumentSize`), `features/document/NewDocumentDialog.tsx`, `src/app/app.css` (`.dialog__presets`), `src/test/canvasSizePresets.test.ts`, `tests/visual/new-document-sizes.spec.ts` |
| Change the top chrome (options bar, document bar) | `components/layout/ToolBar.tsx` (the two rows), `features/options/ToolOptionsBar.tsx` (the contextual row), `features/options/toolOptions.css` (the row, the scroll area, the pinned end), `src/app/app.css` (`.top-bars`, `.toolbar`, `.brush-primary`, `.brush-advanced`) |
| Change the side dock | `components/layout/Workspace.tsx` (`SideColumn`), `components/panels/PanelDock.tsx` (the tabs), `components/panels/panel.css` (`.panel-dock`, the heights and the minimums), `src/app/app.css` (`.side-panels`, `.side-panels__layers`), `core/workspace/workspaceSettings.ts` (`compositionPanelsInSlot`), `tests/visual/shell-layout.spec.ts` |
| Move, float or reset a panel | `core/shell/panelMovement.ts` (the pure move and reset rules), `core/shell/preferences.ts` (`panelOrder`, `panelSlots`, `hiddenPanels`), `state/workspaceStore.ts` (`movePanel`, `resetPanels`, `applyPreferences`), `components/panels/PanelDock.tsx` (the tab drag and the actions menu), `components/panels/FloatingPanels.tsx` (the floating window), `components/layout/Workspace.tsx` (the floating layer and the dock wiring), `components/layout/AppMenuBar.tsx` (Panels -> Reset Panel Layout), `app/App.tsx` (the settings sections), `core/panels/panelLayoutSection.ts`, `tests/visual/panel-movement.spec.ts` |
| Change a tool option or the options bar | `core/shell/toolOptions.ts` (the contract: the kinds, the per-tool registry, the visibility rules), `core/options/optionControl.ts` (the control table for every kind, the exhaustive dispatch, the bar's grouping), `features/options/OptionControl.tsx` (the one control), `features/options/ToolOptionsBar.tsx` (the bar: the tool chip, the scrolling middle row and the pinned Brush settings trigger), `features/brushes/BrushControls.tsx` (the primary and advanced tiers), `features/brushes/BrushAdvancedPopover.tsx` (the advanced panel), `features/brushes/BrushPresets.tsx` (the inline picker and the Manage panel), `core/brushes/brushProperties.ts` (the tier on every field), `features/options/toolOptionSchema.ts` (the built-in options), `src/test/toolOptions.test.ts`, `src/test/brushTiers.test.ts` |
| Change the colour model or the wheel | `utils/color.ts` (`hsvToRgb`/`rgbToHsv`/`hexToHsv`), `features/color/wheelGeometry.ts` (disc geometry, `resolveWheelHsv`), `features/color/wheelState.ts` (what the wheel shows), `features/color/ColorWheel.tsx`, `features/color/ColorPanel.tsx`, `features/color/color.css` |
| Change the colour readout or the colour input | `utils/colorMetrics.ts` (luminance, contrast, CIELAB, CIEDE2000, the nearest swatch, the totality rules), `utils/colorPair.ts`, `features/color/colorInput.ts` (the parsers and the translucent rule), `features/color/ColorField.tsx`, `features/color/ContrastReadout.tsx`, `features/color/ColorPanel.tsx` |
| Change the persisted preferences | `core/settings/appSettings.ts` (the schema, the defaults, `normalizeAppSettings`), `core/settings/settingsStore.ts` (read, apply, watch, persist), `core/settings/settingsGateway.ts`, `core/settings/tauriSettingsGateway.ts`, `src-tauri/src/settings_io.rs` (the two commands) |
| Change the autosave machinery | `core/autosave/autosaveService.ts` (the invariants), `core/autosave/recovery.ts` (where a copy goes). **Not enabled** - the policy is the owner's; see `docs/qa/T06-IMPLEMENTATION-REPORT.md` |
| Export | `core/export/pngExport.ts`, `DrawingEngine.renderDocumentImage` (L755) |
| Native I/O | `src-tauri/src/project_io.rs` (230), `lib.rs`, `core/project/tauriGateway.ts` |
| Window sizing / DPI | `src-tauri/src/window_fit.rs` (the clamp), `src-tauri/src/lib.rs` (`.setup`), `src-tauri/tauri.conf.json` (the default size), `docs/qa/PACKAGED-TAURI-NIGHT-SHIFT-ERRATUM.md` (the measurement rule) |
| Decide what to build next | `docs/SESSION-BRIEF.md` §9 and `docs/ROADMAP.md` §Next slice only |
| Release readiness, licensing or provenance | `docs/RELEASE-READINESS.md`, `docs/g1/reuse-decision.md`, `docs/g1/provenance-record.json`, `THIRD_PARTY_NOTICES.md` |

## 5. Symbol → file (grep the symbol)

| Symbol | File | ≈Line |
| --- | --- | --- |
| `EditorSnapshot`, `DocumentFileState` | `core/engine/DrawingEngine.ts` | 132, 209 |
| `DrawingEngine` (class) | `core/engine/DrawingEngine.ts` | 402 |
| `handlePointerSample` (gesture router) | `core/engine/DrawingEngine.ts` | 2542 |
| `beginStroke` / `extendStroke` / `finishStroke` / `cancelStroke` | `core/engine/DrawingEngine.ts` | 1252 / 1281 / 1607 / 1646 |
| Shape lifecycle | `core/engine/DrawingEngine.ts` | 1302-1371 |
| Fill lifecycle | `core/engine/DrawingEngine.ts` | 1391-1485 |
| Gradient lifecycle | `core/engine/DrawingEngine.ts` | 1511-1595 |
| Selection lifecycle | `core/engine/DrawingEngine.ts` | 1665-1989 |
| `setBrush`, editor setters | `core/engine/DrawingEngine.ts` | 957-1052 |
| `buildSnapshot` | `core/engine/DrawingEngine.ts` | 2653 |
| `BrushSettings` | `types/brush.ts` | 11 |
| `DEFAULT_BRUSH`, `normalizeBrush`, `brushSettingsEqual` | `core/brushes/defaults.ts` | 15, 28, 50 |
| `BRUSH_NUMBER_FIELDS`, `BRUSH_FLAG_FIELDS`, `BRUSH_COLOR_FIELDS`, `readBrushSettings` | `core/brushes/defaults.ts` | grep the symbol |
| `BrushPreset`, `normalizeBrushPresets`, `uniquePresetName`, `normalizePresetName`, `duplicatePreset` | `core/brushes/presets.ts` | grep the symbol |
| `KRITA_DEFAULT_PRESET_ENTRIES`, `KRITA_DEFAULT_PRESET_SOURCE`, `missingKritaPresets` | `core/brushes/kritaDefaults.ts` | grep the symbol |
| `createStrokeRecord`, `cloneStroke`, `StrokeBuilder` | `core/brushes/strokeBuilder.ts` | 46, 71, 86 |
| `STABILIZER_MAX_LAG`, `StrokeBuilder.addSample`/`finish` | `core/brushes/strokeBuilder.ts` | 39, 114, 193 |
| `rasterizeStroke`, `strokeOpacity`, `strokeDiameter`, `stampDot` | `core/rendering/canvas2dStroke.ts` | 121, 67, 52, 87 |
| `SOFT_EDGE_RADIUS_RATIO`, `strokeFeatherRadius` | `core/rendering/canvas2dStroke.ts` | 32, 43 |
| `paintStrokeCoverage`, `featherStroke`, `compositeStrokeBuffer` | `core/rendering/Canvas2DRenderer.ts` | 1263, 1389, 1227 |
| `applyStrokeTexture`, `textureTile` | `core/rendering/Canvas2DRenderer.ts` | 1324, 1350 |
| `TEXTURE_TILE_SIZE`, `textureCoverage` | `core/rendering/canvas2dStroke.ts` | 52, 65 |
| `Canvas2DRenderer` (class) | `core/rendering/Canvas2DRenderer.ts` | 124 |
| `StrokeRecord`, `FillPatchRecord`, `GradientRecord`, `LayerElement` | `core/document/types.ts` | 116, 166, 201, 216 |
| `GuideAxis`, `Guide`, `DrawingDocument.guides` | `core/document/types.ts` | 40, 54, 85 |
| `guideAxisFromDrag`, `roundGuidePosition`, `guideGrabRadius`, `findGuideAt`, `isDuplicateGuide` | `core/document/guides.ts` | 36, 47, 60, 87, 122 |
| `GuidesTool` | `core/tools/guidesTool.ts` | 43 |
| `SymmetryMode`, `SymmetrySettings`, `SymmetryAxis`, `SymmetryMirror`, `activeSymmetryAxes`, `symmetryMirrors`, `mirrorPoint`, `mirrorMovesAny`, `centeredSymmetrySettings` | `core/document/symmetry.ts` | grep the symbol |
| `SYMMETRY_OVERLAY_ID`, `paintSymmetryAxes`, `setSymmetryOverlaySettings` | `core/rendering/symmetryAxesOverlay.ts` | grep the symbol |
| `BRUSH_TIP_OPTION_ID`, `BRUSH_TIP_CHOICES`, `brushTipOption`, `brushTipPreview`, `registerBrushTipOptions` | `core/brushes/brushTipOptions.ts` | grep the symbol |
| `OptionPreview`, `OptionPreviewKind`, `registerOptionPreview`, `optionPreviewFor` | `core/options/optionPreviews.ts` | grep the symbol |
| `getShortcutStore`, `resetShortcutStore` | `core/actions/shortcutSession.ts` | grep the symbol |
| `SHORTCUT_SECTION_KEY`, `createShortcutSection` | `core/actions/shortcutSection.ts` | grep the symbol |
| `useShortcutStore`, `useShortcutOverrides` | `hooks/useShortcuts.ts` | grep the symbol |
| `canonicalPanelId`, `registerPanelIfAbsent`, `isPanelRegistered`, `subscribeToPanelRegistry`, `panelRegistryVersion` | `core/shell/panelRegistry.ts` | grep the symbol |
| `usePanelRegistryVersion`, `useRegisteredPanels`, `useRegisteredPanelsInSlot` | `hooks/usePanelRegistry.ts` | grep the symbol |
| `layoutOfPreferences`, `preferencesOfLayout`, `createShellPreferencesLayoutPort` | `core/workspace/shellLayoutPort.ts` | grep the symbol |
| `createWorkspaceProfileStore`, `WorkspaceLayoutPort`, `sameArrangement`, `createDetachedLayoutPort` | `core/workspace/workspaceProfileStore.ts` | grep the symbol |
| `WORKSPACE_PROFILE_SECTION_KEY`, `createWorkspaceProfileSection` | `core/workspace/workspaceProfileSection.ts` | grep the symbol |
| `useWorkspaceProfileStore`, `useWorkspaceProfiles`, `useWorkspaceProfileActions` | `hooks/useWorkspaceProfiles.ts` | grep the symbol |
| `GridSettings`, `DEFAULT_GRID_SETTINGS`, `nearestGridLine`, `gridLinesBetween`, `snapDocumentPoint`, `snapTolerance` | `core/document/grid.ts` | grep the symbol |
| `MIN_SCALE_FACTOR`, `ROTATION_SNAP_DEGREES`, `scaleFactorFor`, `rotationAngleFor`, `snapRotationAngle`, `createScaleTransform`, `createRotateTransform`, `selectionFrame` | `core/document/selectionTransform.ts` | grep the symbol |
| `SelectionHandleId`, `selectionHandles`, `visibleSelectionHandles`, `handlesWithGrabbedHandle`, `findSelectionHandle`, `handleCursorAt`, `HANDLE_CURSORS`, `handleGrabRadius`, `rotationHandleOffset` | `core/document/selectionHandles.ts` | grep the symbol |
| `StrokeStore` (ordered element list) | `core/document/strokeStore.ts` | 24 |
| `isGroup`, `findLayer`, `findLayerPath`, `isAncestor`, `paintableLayers`, `groupLayers`, `dissolveGroup`, `moveLayerIntoGroup`, `moveLayerOutOfGroup`, `layerTreeRows` | `core/document/layerGroups.ts` | grep the symbol |
| `floodFill`, `MAX_FILL_SCAN_PIXELS` | `core/fill/floodFill.ts` | 56, 47 |
| `createGradientRecord`, `MIN_GRADIENT_LENGTH` | `core/gradient/gradientRecord.ts` | 41, 16 |
| `PROJECT_VERSION`, `serializeProject`, `parseProject` | `core/project/projectFormat.ts` | 108, 443, 520 |
| `readBrush` (format validation) | `core/project/projectFormat.ts` | ~675 |
| `stampDabs`, `StampDabCursor` (dab plan) | `core/rendering/stampCoverage.ts` | 90, 107 |
| `stampDabCoverage` (per-dab profile) | `core/rendering/stampCoverage.ts` | 145 |
| `STAMP_TEXTURE_LANES`, `stampTextureLaneWidth`, `StampTexture` (per-dab directional texture) | `core/rendering/stampCoverage.ts` | 256, 274, 243 |
| `StampCoverage` (coverage union, tiles) | `core/rendering/stampCoverage.ts` | 264 |
| `MAX_STAMP_COVERAGE_WORK`, `MIN_STAMP_SPACING_PX` | `core/rendering/stampCoverage.ts` | 52, 36 |
| `extendStampStroke`, `rasterizeStampStroke`, `writeStampCoverage` | `core/rendering/Canvas2DRenderer.ts` | 1045, 1078, 1112 |
| `Command`, `CommandStack` | `core/commands/types.ts`, `commandStack.ts` | 10, 27 |
| `createMoveStrokesCommand` etc. | `core/commands/strokeEditCommand.ts` | 100+ |
| `Tool`, `ToolContext` | `core/tools/types.ts` | 167, 17 |
| `ShapeKind`, `ShapeOptions`, `normalizeShapeOptions` | `core/tools/shapeOptions.ts` (the model; re-exported by `core/tools/shapeGeometry.ts`) | grep the symbol |
| `SHAPE_OPTION_FIELDS`, `shapeOptionFieldsFor`, `shapeOptionLabel`, `findShapeOptionField` | `core/tools/shapeOptions.ts` | grep the symbol |
| `registerShapeToolOptions` | `core/tools/shapeToolOptions.ts` | grep the symbol |
| `shapeOutline`, `outlineExtent` | `core/tools/shapeGeometry.ts` | 120, 143 |
| `rotateAboutCentre`, `polygonOutline`, `starOutline` (private) | `core/tools/shapeGeometry.ts` | 305, 349, 378 |
| `getShapeOptions`, `setShapeSides`/`setShapeInnerRatio`/`setShapeRotation` | `core/engine/DrawingEngine.ts` | 992, 1004 / 1022 / 1039 |
| `TOOL_DEFINITIONS`, `findToolByShortcut` | `core/tools/toolDefinitions.ts` | 107, 123 |
| `EditorActions` | `state/editorStore.ts` | 24 |
| `createDocument` | `core/document/document.ts` | 183 |
| `CANVAS_SIZE_PRESETS`, `isCanvasSizePresetSelected`, `findCanvasSizePreset` | `core/document/canvasSizePresets.ts` | grep the symbol |
| `renderDocumentPng` | `core/export/pngExport.ts` | 57 |
| `ProjectFiles` | `core/project/projectFiles.ts` | 43 |
| `hsvToRgb`, `rgbToHsv`, `hexToHsv`, `normalizeHue` | `utils/color.ts` | 103, 149, 188, 88 |
| `asRecord` (an untrusted value as a record) | `utils/record.ts` | 12 |
| `AppSettings`, `DEFAULT_APP_SETTINGS`, `normalizeAppSettings`, `parseAppSettings`, `serializeAppSettings` | `core/settings/appSettings.ts` | grep the symbol |
| `SettingsStore` (read, apply, watch, persist) | `core/settings/settingsStore.ts` | grep the symbol |
| `AutosaveService` (the invariants), `recoveryPathFor`, `isRecoveryPath` | `core/autosave/autosaveService.ts`, `core/autosave/recovery.ts` | grep the symbol |
| `wheelPointToHsv`, `hsvToWheelPoint`, `resolveWheelHsv` | `features/color/wheelGeometry.ts` | 47, 66, 92 |
| `createWheelState`, `reduceWheelState` | `features/color/wheelState.ts` | 41, 53 |
| `ACTION_DEFINITIONS`, `findActionForEvent`, `dispatchKeyboardEvent`, `validateRegistry` | `core/actions/registry.ts` | grep the symbol |
| `matchesShortcut`, `logicalKey`, `isTextEntryTarget`, `formatShortcut` | `core/actions/keyboard.ts` | grep the symbol |
| `ActionDefinition`, `ActionContext`, `ShortcutSpec`, `ActionId` | `core/actions/types.ts` | grep the symbol |
| `normalizePressureCurve`, `evaluatePressureCurve`, `pressureCurvesEqual` | `core/brushes/pressureCurve.ts` | grep the symbol |
| `DEFAULT_PRESSURE_CURVE`, `DEFAULT_SECONDARY_COLOR`, `BRUSH_CURVE_FIELDS` | `core/brushes/defaults.ts` | 14, 17, grep |
| `PressureCurveEditor` | `features/brushes/PressureCurveEditor.tsx` | grep the symbol |
| `GradientStopEditor`, `normalizeGradientMidStops`, `gradientStopsEqual` | `features/gradient/GradientStopEditor.tsx`, `core/gradient/gradientRecord.ts` | grep the symbol |
| `TOOL_OPTION_FIELDS`, `visibleToolOptions`, `toolShowsBrushControls` | `features/options/toolOptionSchema.ts` | grep the symbol |
| `ToolOption`, `registerToolOptions`, `appendToolOptions`, `visibleToolOptions`, `toolOptionLabel` | `core/shell/toolOptions.ts` | grep the symbol |
| `TOOL_OPTION_KINDS`, `ToolOptionKind` | `core/shell/toolOptions.ts` | grep the symbol |
| `optionControl`, `sliderControl`, `numberControl`, `toggleControl`, `selectControl`, `colorControl`, `groupControl` | `core/options/optionControl.ts` | grep the symbol |
| `groupToolOptions`, `ToolOptionGroup` | `core/options/optionControl.ts` | grep the symbol |
| `optionNumberValue`, `optionStepValue`, `colorInputValue` | `core/options/optionControl.ts` | grep the symbol |
| `ShellSlotId`, `ShellLayout`, `placePanel`, `movePanel`, `hidePanel`, `normalizeShellLayout` | `core/shell/slots.ts` | grep the symbol |
| `PanelDefinition`, `registerPanel`, `listPanels`, `panelsInSlot` | `core/shell/panelRegistry.ts` | grep the symbol |
| `ViewportState`, `viewportStateFrom`, `viewportFromState`, `normalizeViewportState` | `core/shell/viewportState.ts` | grep the symbol |
| `OverlayDefinition`, `registerOverlay`, `listOverlays`, `overlaysForLayer` | `core/shell/overlayRegistry.ts` | grep the symbol |
| `HistoryEntry`, `HistoryState`, `describeHistory`, `canUndo`, `canRedo` | `core/shell/historyModel.ts` | grep the symbol |
| `ShellPreferences`, `normalizeShellPreferences`, `parseShellPreferences` | `core/shell/preferences.ts` | grep the symbol |
| `DynamicsModel`, `normalizeDynamicsModel`, `dynamicsSizeFactor`, `registerDynamicsModel` | `core/brushes/dynamics.ts` | grep the symbol |
| `ToolOptionsBar` | `features/options/ToolOptionsBar.tsx` | grep the symbol |
| `BrushPrimaryControls`, `BrushAdvancedControls` | `features/brushes/BrushControls.tsx` | grep the symbol |
| `BrushAdvancedPopover` | `features/brushes/BrushAdvancedPopover.tsx` | grep the symbol |
| `BrushPresetControls` | `features/brushes/BrushPresets.tsx` | grep the symbol |
| `BrushIcon`, `BRUSH_ICON_CSS_SIZE` | `features/brushes/BrushIcon.tsx` | grep the symbol |
| `PresetRow`, `PresetRowProps` | `features/brushes/PresetRow.tsx` | grep the symbol |
| `gridColumnCount` | `features/brushes/BrushPresetPanel.tsx` | grep the symbol |
| `nextSelectionId` (a step, not a direction) | `core/brushes/presetBrowser.ts` | grep the symbol |
| `BRUSH_ICONS`, `BrushIcon`, `BRUSH_ICON_BY_PRESET_ID`, `brushIconForBuiltIn`, `brushIconRuns`, `brushIconPaths`, `framed` | `features/brushes/brushIcons.ts` | grep the symbol |
| `brushGlyphId`, `brushIconPalette`, `brushIconFromBrush`, `brushIconForPreset` | `features/brushes/brushIconFromBrush.ts` | grep the symbol |
| `BrushPropertyTier`, `brushPropertiesInTier`, `primaryBrushProperties`, `advancedBrushProperties` | `core/brushes/brushProperties.ts` | grep the symbol |
| `PanelDock`, `DockPanel` | `components/panels/PanelDock.tsx` | grep the symbol |
| `movePanelInPreferences`, `resetPanelPlacement`, `panelSlotOf`, `PanelMove` | `core/shell/panelMovement.ts` | grep the symbol |
| `FloatingPanels`, `FloatingPanelSpec` | `components/panels/FloatingPanels.tsx` | grep the symbol |
| `OptionControl`, `OptionControlView` | `features/options/OptionControl.tsx` | grep the symbol |
| `ColorWheel`, `ColorPanel` | `features/color/ColorWheel.tsx`, `features/color/ColorPanel.tsx` | 69, 12 |
| `PointerOwnership`, `transitionOwnership`, `reduceOwnership`, `routePointerEvent`, `isDragInFlight`, `gestureForButton` | `core/input/ownership.ts` | grep the symbol |

## 6. Docs → section

| Doc | Read |
| --- | --- |
| `docs/SESSION-BRIEF.md` | Whole file once (≈600 lines) for state, workflow, next slice |
| `docs/ROADMAP.md` | L171-197 ("Next slice"); phase checkboxes only when deciding scope |
| `docs/HANDOFF.md` | §7 toolchain, §8 verification recipes, §9 next move; skip the rest |
| `docs/ARCHITECTURE.md` | `## Rendering pipeline` (141), `### Why a stroke buffer` (274), `### Eraser strokes` (457), `### Shape tools` (594), `#### The polygon and the star` (628), `### Bucket` (685), `### Gradients` (750), `### Selection` (792), `## Undo / redo` (994), `## Testing` (1197) |
| `docs/PROJECT_FORMAT.md` | `### elements[]` (215), `### brush` (323), `## Validation` (335), `## Versioning` (393) |
| `docs/RELEASE-READINESS.md` | The release-readiness workstream: icons, licence notices, clean-room attestation, and the open owner decisions |
| `docs/qa/T06-IMPLEMENTATION-REPORT.md` | The settings slice: what is implemented, what is blocked on the owner's autosave decisions, and the verified dirty-state invariants |
| `docs/RELEASE-READINESS-R9-R3-PLAN.md` | The R9 (CI licence allow-list) and R3 (attestation countersignature) preparation: what is verified, what is proposed, and the open owner decisions |
| `docs/CLEAN-ROOM-ATTESTATION.md` | The stamp engine's provenance record: what was read, what was not, and the owner countersignature |
| `THIRD_PARTY_NOTICES.md` | The notice file. Generated - read it, do not edit it; edit `scripts/generate-third-party-notices.mjs` or `licenses/dependency-inventory.json` |
| `README.md` | Only for user-facing wording or the limitations list |

## 7. Search recipes

```bash
rg -n "hardness" src docs                     # current slice keyword
rg -n "PROJECT_VERSION" src docs              # every format bump site
rg -n "begin(Stroke|Fill|Gradient)|finish(Stroke|Fill|Gradient)" src/core/engine
rg -n "compositeStrokeBuffer|rasterizeStrokeToBuffer|applyErase" src/core/rendering
rg -n "^## |^### " docs/ARCHITECTURE.md       # headings before reading a section
rg -n "describe\\(|it\\(" src/test/drawingEngine.test.ts   # coverage without the body
git diff --stat
git diff -- src/core/rendering/canvas2dStroke.ts
pnpm exec vitest run src/test/gradient.test.ts          # one file
pnpm exec vitest run src/test/drawingEngine.test.ts -t "gradient"   # one block
```

## 8. Test map (open only the matching file)

| Area | Test file |
| --- | --- |
| Composition guides | `guides.test.ts` (the model, the axis heuristic, the rounding, the grab radius, the hit-test, the duplicate rule) |
| Reference images | `referenceManipulation.test.ts` (the import, the selection, the gestures, the sliders and their one-step-per-run history, the undo/redo, the save/reopen from embedded bytes, a v13 file), `referenceRendering.test.ts` (the paint order, the rotation, the clip, the export isolation), `referenceFormat.test.ts` (the v14 round trip, the byte/pixel/count ceilings, the malformed and mis-versioned files), `referenceImages.test.ts` (the decode, the store, the sampling), `tests/visual/visual.spec.ts` (the `references` scene: the display golden and the pixel proof that an export is unchanged) |
| Layer groups (tree, commands, format) | `layerGroups.test.ts` (the tree, grouping, nesting, moves, dissolve, the commands and their refusals), `layerTreeDrag.test.ts` (the drop zones, the cycle guard and the parent options), `layerPanel.test.ts` (the engine facade, group deletion rules, gesture refusal, selection inside a group), `projectFormat.test.ts` (v13 round-trip, empty and nested groups) |
| Layer groups in a real browser | `tests/visual/layer-groups.spec.ts` (create, rename, drag, collapse, visibility, delete, ungroup, the Inside selector), `tests/visual/layer-groups-render.spec.ts` (group opacity, visibility and blend pixels) |
| Symmetry | `symmetry.test.ts` (the modes, the axes and where they stand, the mirror about the axis rather than the document's middle, the on-axis rule, the mirrors, and the display-only overlay) |
| Brush tip control | `brushTipControl.test.ts` (the closed set of five shapes, the refusal of a shape this build does not know, the preview, and the write that is editor state - no history step, no dirty flag) |
| The shortcut editor's runtime | `shortcutRuntime.test.ts` (the session store, the dispatcher's overrides, the chord a command gives up, the conflict reason, and the round trip through the section) |
| The named workspace profiles in the file | `workspaceProfilePersistence.test.ts` (the section, the store, the arrangement port, the switch, the custom mark, and the round trip through the settings file) |
| Pointer ownership | `pointerOwnership.test.ts` (the take/release/cancel rules, the routing, the binder's pointer handling and the cancelled gesture) |
| Tool options | `toolOptions.test.ts` (the fields each tool shows, the control for every kind, the bar's grouping, and the path a feature takes to add an option to a tool it does not own), `toolOptionsContract.test.ts` (the registry, the visibility rules and the group rules), `brushTiers.test.ts` (the primary/advanced partition of the brush fields) |
| The shell's layout | `tests/visual/shell-layout.spec.ts` (eight window sizes: no page scroll, the layers and dock bodies, no unreachable or zero-size control; the dock tabs with pointer and keyboard; tool switching; the advanced brush panel; the preset panel) |
| Movable panels | `panelMovement.test.ts` (the move and reset model, unknown ids and slots, the workspace store seam, the settings-section round trip), `tests/visual/panel-movement.spec.ts` (drag reorder, float from the menu, move and dock a floating window, drag-to-float, reset) |
| Grid and snapping | `grid.test.ts` (the pure geometry: the nearest line, the lines between two coordinates, the tolerance, the target choice), `gridSnapping.test.ts` (the engine seam, the viewport, the renderer overlay) |
| Brush settings / capture | `brushSettings.test.ts`, `strokeBuilder.test.ts` |
| Brush presets | `brushPresets.test.ts` (the name rules, save/apply/rename/duplicate/delete, the settings round trip, the next stroke's brush, and no brush field dropped) |
| The brush icons | `brushIcons.test.ts` (one hand-drawn icon per built-in brush and no other, the grid and its palette, the shared frame, the run grouping and the path grouping, an icon for every preset in the library, the kind a set of settings paints, and the mark: its ink, its length, its fade, its taper and its dots) |
| The brush browser (the library's grid) | `presetBrowser.test.ts` (the search, the order, the two groups, the favourites, the actions, the selection and its row step, the library file, the malformed file and the import), `tests/visual/brush-icons.spec.ts` (the grid of square thumbnails with no captions, each built-in tile drawing its own picture, and a saved brush drawn from its settings, never a painted dot) |
| Krita 4 presets | `kritaPresets.test.ts` (the translated set, its bounds and names, the import helper, and the library-file round trip), `tests/visual/krita-presets.spec.ts` (the one-click import and the second press in a real browser) |
| Colour model / wheel | `color.test.ts` (conversions, the whole-cube round trip), `colorWheel.test.ts` (disc geometry, what the wheel shows) |
| Colour contrast and difference | `colorMetrics.test.ts` (WCAG luminance and contrast, sRGB to CIELAB, CIEDE2000 against the published verification table, the nearest swatch, the unknown and translucent states, totality), `colorPair.test.ts` (comparing two colours), `tests/visual/color-compare.spec.ts` (the readout in a real browser) |
| Colour input formats | `colorInput.test.ts` (8-digit hex, `hsl()`, `oklch()`, the gamut clamp, the round trip, garbage and translucent input) |
| Settings persistence | `settings.test.ts` (the round trip, the defaults, the malformed and future-versioned file, the clamping, the no-dirty contract, a failed write) |
| Autosave | `autosave.test.ts` (the dirty-state invariants, the recovery path, the races with a user save) |
| Brush spacing / stabilizer | `strokeBuilder.test.ts`, `drawingEngine.test.ts`, `projectFormat.test.ts`, `projectLifecycle.test.ts` |
| Brush texture / grain | `canvas2dStroke.test.ts` (`textureCoverage`), `canvas2dRenderer.test.ts` (pattern pass), `projectFormat.test.ts`, `drawingEngine.test.ts`, `projectLifecycle.test.ts` |
| Stamp (dab) engine | `stampCoverage.test.ts` (dab plan, per-dab texture, union, budget), `canvas2dRenderer.test.ts` (stamped pixels, parity), `projectFormat.test.ts` (v9/v10), `drawingEngine.test.ts`, `projectLifecycle.test.ts` |
| Fixed-step transforms (the Selection menu) | `fixedStepTransform.test.ts` (the pivot, both directions, undo/redo, the two non-exact inverses), `tests/visual/selection-menu.spec.ts` (the menu in a real browser) |
| Brush hardness / soft edge | `canvas2dStroke.test.ts`, `canvas2dRenderer.test.ts`, `projectFormat.test.ts` |
| Stroke raster | `canvas2dStroke.test.ts` |
| Shape geometry (line, rectangle, ellipse, polygon, star) | `shapeGeometry.test.ts` (the vertex counts, the inscribed ellipse, the clamps, the rotation, the closed polyline, the star's simple outline) |
| Renderer / layers / compositing | `canvas2dRenderer.test.ts` (grep `it(`) |
| Engine gestures, history, selection | `drawingEngine.test.ts` (grep `it(`) |
| Format | `projectFormat.test.ts` |
| Save/open lifecycle | `projectLifecycle.test.ts`, `projectFiles.test.ts` |
| Bucket fill | `floodFill.test.ts`, `fillCommand.test.ts` |
| Gradients | `gradient.test.ts` |
| Layer blend modes | `blendModes.test.ts` (the formulas and their boundaries), `canvas2dRenderer.test.ts` (the canvas operation mapping, exact pixels, alpha, preview and export) |
| Selection math | `strokeSelection.test.ts` |
| Scale / rotate a selection | `selectionTransform.test.ts` (the scale and rotation about a centre, the clamps, the 15-degree snap, the frame after a transform), `selectionHandles.test.ts` (the corner and rotation handles, the grab radius, the hit-test, when the handles are shown, and the three defects the first review found), `drawingEngine.test.ts` (the gestures, the undo step, the reopen) |
| Commands | `commandStack.test.ts`, `strokeCommand.test.ts`, `documentCommand.test.ts` |
| Document/layers | `document.test.ts` |
| Canvas size presets | `canvasSizePresets.test.ts` (the presets, their limits, the selected state), `tests/visual/new-document-sizes.spec.ts` (the dialog in a real browser) |
| Layer groups (the tree) | `layerGroups.test.ts` (the children, the order, the ancestor rule, dissolving, the panel rows and the group commands) |
| Viewport/input | `viewport.test.ts`, `pointer.test.ts`, `path.test.ts` |
| Export | `pngExport.test.ts` |
| Misc | `base64`, `color`, `frameScheduler`, `fileMessages` |
| Colour wheel (HSV) | `color.test.ts` (conversions, boundaries), `colorWheel.test.ts` (disc geometry, which colour the wheel shows) |

## 9. Keep this file useful

- Add a row here when you add, rename or move a file. Do not add prose.
- Line anchors are hints, not contracts. If `rg` disagrees, fix the anchor.
- This is an index, not a second architecture document. The authority is
  `docs/SESSION-BRIEF.md`, `docs/ROADMAP.md` and the code itself.
