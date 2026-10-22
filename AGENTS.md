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
`core/engine/canvasViews.ts` (the view registry: the identities, the active
view, the summaries),
`features/view/SecondaryViewPanel.tsx` (the second view's panel),
`floodFill`, `fillScan` (the scan pipeline: the gap closing, the distance
field, the growth and the soft edge), `fillOptions` (the bucket's options),
`document/types.ts`, `document/guides.ts`,
`document/symmetry.ts` (the modes, the transforms, the copies),
`core/rendering/rulers.ts` (the step, the ticks, the hit test),
`document/selectionTransform.ts` (the scale/rotate geometry),
`document/selectionHandles.ts` (the transform handles),
`canvas2dStroke`,
`core/brushes/stabilizer.ts` (369: the filter, the modes and the catch-up),
`strokeBuilder`, `strokeSelection`, `commandStack`,
`types.ts` (tools), `guidesTool.ts` (138),
`features/color/wheelGeometry.ts` (102),
`features/navigator/navigatorGeometry.ts` (the navigator's coordinate mapping),
`core/brushes/presets.ts` (the preset model, its validation and its equality),
`core/brushes/bundledPresets.ts` (the built-in brushes),
`core/brushes/presetBrowser.ts` (the browser's search, order, selection and actions),
`core/brushes/presetTransfer.ts` (the library file format),
`core/brushes/presetLibraryFiles.ts` (the library's export and import),
`features/brushes/BrushPresetPanel.tsx` (the browser),
`features/brushes/PresetRow.tsx` (a row of the browser),
`features/brushes/BrushTipPreview.tsx` (a preset's tip, drawn by the renderer),
`features/brushes/BrushPresets.tsx` (the toolbar's quick picker),
`core/document/blendModes.ts` (125: the closed mode list and the separable formulas),
`utils/colorPair.ts` (179),
`features/color/ContrastReadout.tsx` (198),
`core/settings/settingsStore.ts`,
`core/autosave/autosaveService.ts`,
feature controls in `features/`, `ProjectFiles`, `project_io.rs`.

**Between 250 and 400 - read targeted windows:** `core/tools/shapeGeometry.ts`
(395: the line, the rectangle, the ellipse, the polygon, the star, the rigid
rotation, the shape options and their clamps), `src-tauri/src/window_fit.rs`
(~300: the work-area clamp, the physical-pixel arithmetic and the cases),
`core/document/grid.ts` (283: the grid lattice, the snap candidates and the
document-space tolerance), `core/settings/appSettings.ts` (269: the settings
document, its readers and its per-field validation).

**Over 400 - read targeted windows:** `src/test/shapeGeometry.test.ts` (559: the
shape geometry), `core/rendering/stampCoverage.ts` (533: the dab plan, the
per-dab profile, the per-dab directional texture and the coverage union),
`src/utils/colorMetrics.ts` (607: WCAG luminance and contrast, sRGB to CIELAB,
CIEDE2000, the nearest palette entry, and the total/never-throws rules),
`src/test/stampCoverage.test.ts` (508: the dab plan, the texture, the union
and the budget).

**Small (<100) - safe to read whole:** defaults, fillPatch, gradientRecord,
gradientHandles, pngExport, viewport, frameScheduler, pointer, documentCommand,
fill/gradient commands, tool definitions, `editorStore.ts`,
`features/color/wheelState.ts`,
`features/color/ColorField.tsx`, `features/color/colorInput.ts`,
`features/grid/GridControls.tsx`, `utils/record.ts`,
`features/view/viewNavigation.ts`, `features/view/ZoomField.tsx`,
`features/view/ViewControls.tsx`, `hooks/usePanModifier.ts`,
`core/brushes/brushProperties.ts`, `core/brushes/numericInput.ts`,
`features/brushes/BrushPreview.tsx`,
`core/settings/settingsGateway.ts`, `core/settings/tauriSettingsGateway.ts`,
`core/workspace/workspaceSettingsSection.ts`, `state/workspaceContext.ts`,
`hooks/useWorkspace.ts`,
`core/autosave/recovery.ts`,
Rust `lib.rs`/`main.rs`/`native_environment.rs`/`settings_io.rs`,
`scripts/generate-app-icon.mjs`,
`scripts/generate-third-party-notices.mjs`.

## 4. Task → read only this

| Task | Open, in order |
| --- | --- |
| Add or change a tool gesture | `core/tools/<tool>.ts` (≈90 lines), `core/tools/types.ts` (Tool/ToolContext), then the matching `begin*/finish*/cancel*` block in `DrawingEngine.ts` (§5) |
| Change the composition guides | `core/document/guides.ts` (the axis heuristic, the rounding, the grab radius, the hit-test, the duplicate rule), `core/document/types.ts` (`Guide`), `core/tools/guidesTool.ts`, the guide block in `DrawingEngine.ts`, `paintGuides`/`paintGuideLabels` in `Canvas2DRenderer.ts` |
| Change the rulers | `core/rendering/rulers.ts` (the pure geometry: the step, the minor step, the ticks, the hit test, the label), `core/rendering/Canvas2DRenderer.ts` (`paintRulers`), `core/rendering/types.ts` (`setRulers`), `features/rulers/RulerControls.tsx`, `core/engine/DrawingEngine.ts` (`setRulersVisible`, `rulerAxisAt`) |
| Change the symmetry | `core/document/symmetry.ts` (the modes, the transforms, the copies, the axes), `core/engine/DrawingEngine.ts` (`setSymmetry*`, `symmetryCopiesFor`, the centre drag), `core/rendering/Canvas2DRenderer.ts` (`paintSymmetry`, `paintSymmetryCenter`, `paintSymmetricCoverage`), `core/rendering/types.ts` (`setSymmetry`), `features/options/toolOptionSchema.ts` (the symmetry group), `src/test/drawingAids.test.ts` |
| Change the grid or the snapping | `core/document/grid.ts` (the pure rules: the nearest grid line, the lines between two coordinates, the magnet tolerance, the target choice), `core/engine/DrawingEngine.ts` (`SNAPPING_TOOL_IDS`, `snapSample`, the three setters), `core/rendering/Canvas2DRenderer.ts` (`paintGrid`), `core/rendering/types.ts` (`setGrid`), `features/grid/GridControls.tsx`, `core/settings/appSettings.ts` |
| Change a shape's geometry (polygon, star) | `core/tools/shapeGeometry.ts` (`ShapeOptions` L42, `normalizeShapeOptions` L86, `shapeOutline` L120, `rotateAboutCentre` L305, `polygonOutline` L349, `starOutline` L378), `core/tools/shapeTool.ts` (the press-time capture), `core/tools/types.ts` (`ToolContext.getShapeOptions`), `DrawingEngine.ts` (`getShapeOptions` L992, `setShapeSides`/`setShapeInnerRatio`/`setShapeRotation` L1004-1053), `state/editorStore.ts`, `features/shapes/ShapeControls.tsx`, `src/test/shapeGeometry.test.ts` |
| Register a tool / shortcut | `core/tools/toolDefinitions.ts` (L11-134), `core/tools/toolRegistry.ts`, `types/tool.ts`, `hooks/useKeyboardShortcuts.ts`, `components/toolbar/ToolRail.tsx` |
| Change the status bar or the view controls | `features/canvas/CanvasStatusBar.tsx` (the fields), `features/view/viewNavigation.ts` (the zoom format and the typed zoom), `features/view/ZoomField.tsx` (the editable zoom), `features/view/ViewControls.tsx` (the rotate/mirror/reset buttons), `core/rendering/viewport.ts` (the transform), `core/engine/DrawingEngine.ts` (`zoomIn`/`zoomOut`/`zoomTo`/`zoomToFit`/`rotateView`/`toggleViewMirror`/`resetView`/`setPanModifier`), `core/actions/registry.ts` (the chords) |
| Change the second view of the canvas | `core/engine/canvasViews.ts` (the view registry: the identities, the active view, the summaries), `core/engine/DrawingEngine.ts` (`openSecondaryView`/`closeSecondaryView`/`attachSecondaryView`/`detachSecondaryView`/`setSecondaryViewSize`/`focusView`/`fitView`/`actualSizeView`), `core/rendering/types.ts` (`DisplayTargetOptions` and the optional display-target methods), `core/rendering/Canvas2DRenderer.ts` (`addDisplayTarget`/`removeDisplayTarget`/`renderTarget`), `features/view/SecondaryViewPanel.tsx` (the panel), `src/test/secondaryView.test.ts` |
| Change stroke rasterization | `core/rendering/canvas2dStroke.ts` (207), `Canvas2DRenderer.ts` `rasterizeStrokeToBuffer`/`compositeStrokeBuffer`/`applyErase` |
| Change the stamp (dab) engine | `core/rendering/stampCoverage.ts` (`stampDabs`, `StampDabCursor`, `stampDabCoverage`, `StampCoverage`, `STAMP_TEXTURE_LANES`, `stampTextureLaneWidth`, `MAX_STAMP_COVERAGE_WORK`), `Canvas2DRenderer.ts` `extendStampStroke`/`rasterizeStampStroke`/`writeStampCoverage`, `types/brush.ts`, `BrushControls.tsx`, `projectFormat.ts` `readBrush` (v9/v10) |
| Change brush hardness / soft edge | `canvas2dStroke.ts` `strokeFeatherRadius` (L32-48), `Canvas2DRenderer.ts` `paintStrokeCoverage`/`featherStroke` (L1263/L1389), `features/brushes/BrushControls.tsx`, `projectFormat.ts` `readBrush` (L797) |
| Change texture / grain | `canvas2dStroke.ts` `textureCoverage`/`TEXTURE_TILE_SIZE` (L52-65), `Canvas2DRenderer.ts` `applyStrokeTexture`/`textureTile` (L1324/L1350), `types/brush.ts`, `BrushControls.tsx`, format v7 |
| Change brush sampling (spacing/stabilizer) | `core/brushes/stabilizer.ts` (the filter, the modes and the catch-up), `core/brushes/strokeBuilder.ts` (`addSample`/`finish`), `DrawingEngine.ts` `finishStroke`, `types/brush.ts`, `features/options/toolOptionSchema.ts` (the mode control), tests in `stabilizer.test.ts`/`strokeBuilder.test.ts`/`drawingEngine.test.ts` |
| Add a brush field | `types/brush.ts`, `core/brushes/defaults.ts` (the field lists and `readBrushSettings`), `features/brushes/BrushControls.tsx`, `projectFormat.ts` `readBrush`/serialize, `engine.setBrush`. A sampling-only field may be additive; one that changes how stored samples render needs a version bump |
| Change the brush presets | `core/brushes/presets.ts` (the model, the name rules, `normalizeBrushPresets`, `mergeBundledPresets`), `core/brushes/bundledPresets.ts` (the built-in brushes), `core/brushes/defaults.ts` (`readBrushSettings`), `core/settings/appSettings.ts` (the `presets` field), `DrawingEngine.ts` (`setPresets`/`saveBrushPreset`/`renameBrushPreset`/`updateBrushPreset`/`duplicateBrushPreset`/`deleteBrushPreset`/`toggleBrushPresetFavorite`/`importBrushPresets`/`applyBrushPreset`/`resetBrush`), `features/brushes/BrushPresetPanel.tsx`, `state/editorStore.ts` |
| Change the brush controls | `features/options/toolOptionSchema.ts` (the brush group's fields, their bounds and their per-tool visibility), `features/options/OptionControl.tsx` (how a field is rendered), `components/toolbar/SliderField.tsx` (the slider, the number box and the keyboard steps), `core/brushes/numericInput.ts` (the number box's rules), `core/brushes/brushProperties.ts` (the properties the engine does *not* have), `features/brushes/BrushControls.tsx` (the group: the preview, the picker, the reset) |
| Change the brush preview | `core/rendering/brushPreview.ts` (`buildPreviewStroke`, `renderBrushPreview`, `previewFit`), `features/brushes/BrushPreview.tsx` (the live swatch), `features/brushes/BrushTipPreview.tsx` (a preset's tip) |
| Change the brush library file | `core/brushes/presetTransfer.ts` (the format, the limits, the reader), `core/brushes/presetLibraryFiles.ts` (the export and the import), `core/project/projectGateway.ts` (the two dialogs), `core/project/tauriGateway.ts` |
| Add a layer element kind | `document/types.ts`, `document/strokeStore.ts`, renderer rasterize + rebuild path, a command, `projectFormat.ts`, `PROJECT_FORMAT.md` |
| Add or change a layer blend mode | `core/document/blendModes.ts` (the closed list, the guard, the formulas), `core/document/types.ts` (`LayerBlendMode`), `Canvas2DRenderer.ts` (`compositeOperationFor`), `features/layers/LayersPanel.tsx`, `projectFormat.ts` (the versioned closed set), `PROJECT_FORMAT.md` |
| Undo/redo behaviour | `core/commands/commandStack.ts`, the command in `core/commands/`, `engine.executeDocumentCommand`/`recordHistoryChange` |
| Persistence / format version | `projectFormat.ts` (`PROJECT_VERSION` L108, `serializeProject` L443, `parseProject` L520, `readBrush` L797), `PROJECT_FORMAT.md` (§§ `brush`, `Versioning`) |
| File open/save orchestration | `core/project/projectFiles.ts`, `projectGateway.ts`, `tauriGateway.ts`, `features/project/useFileCommands.ts` |
| Change the open documents (the tabs) | `core/documents/sessionRegistry.ts` (one engine per document, the active session, the tab strip's view, the close decision), `core/documents/documentWorkspace.ts` (open, save and close across the documents), `core/documents/recentFiles.ts` (the recent list and its settings section), `features/tabs/DocumentTabs.tsx` (the strip), `components/layout/Workspace.tsx` (the close-tab flow), `state/editorStore.ts` (the session-aware editor) |
| Layer operation | `core/document/document.ts`, `core/commands/documentCommand.ts`, `DrawingEngine.ts` L755-868, `features/layers/LayersPanel.tsx` |
| Selection / transform | `core/document/strokeSelection.ts`, `core/document/selectionTransform.ts` (the pure scale/rotate geometry), `core/document/selectionHandles.ts` (the corner and rotation handles), `core/tools/selectTool.ts`, `DrawingEngine.ts` L1665-1989, `strokeEditCommand.ts` |
| Edit a gradient's geometry | `core/gradient/gradientHandles.ts` (the pure handle geometry and the geometry hit test), `core/commands/gradientEditCommand.ts` (the record replacement), `core/tools/gradientTool.ts` (the press resolution), `DrawingEngine.ts` (`selectGradientAt`, `beginGradientHandleDrag`, `updateGradientHandleDrag`, `finishGradientHandleDrag`, `cancelGradientHandleDrag`, `nudgeGradientHandle`, `syncGradientOverlay`), `core/rendering/Canvas2DRenderer.ts` (`paintGradientOverlay`), `core/rendering/types.ts` (`RendererGradientOverlay`), `src/test/gradientEditing.test.ts` |
| Add a UI control | matching `features/**/…Controls.tsx`, `state/editorStore.ts` (`EditorActions`), the engine setter and `EditorSnapshot` field |
| Change the colour model or the wheel | `utils/color.ts` (`hsvToRgb`/`rgbToHsv`/`hexToHsv`), `features/color/wheelGeometry.ts` (disc geometry, `resolveWheelHsv`), `features/color/wheelState.ts` (what the wheel shows), `features/color/ColorWheel.tsx`, `features/color/ColorPanel.tsx`, `features/color/color.css` |
| Change the navigator | `features/navigator/navigatorGeometry.ts` (the pure mapping between navigator, canvas and document pixels), `features/navigator/NavigatorPanel.tsx` (the panel and its pointer/keyboard gestures), `core/rendering/types.ts` (`renderOverview`), `core/rendering/Canvas2DRenderer.ts` (`renderOverview`), `DrawingEngine.ts` (`getOverview`, `centerViewportOn`, `centerViewport`, `viewportSize` in the snapshot), `src/test/navigator.test.ts` |
| Change the reference images | `core/reference/types.ts` (the model and the engine's seam), `core/reference/geometry.ts` (the pure workspace-space transform), `core/reference/decode.ts` (the safe decode, the pixel budget), `core/reference/store.ts` (the state, the one decoded copy, the sampling), `features/reference/ReferencePanel.tsx` (the panel), `core/rendering/Canvas2DRenderer.ts` (`paintReferences`), `DrawingEngine.ts` (`setReferenceSource`/`syncReferenceOverlay`/`pickColor`), `src/test/referenceImages.test.ts` |
| Change the colour readout or the colour input | `utils/colorMetrics.ts` (luminance, contrast, CIELAB, CIEDE2000, the nearest swatch, the totality rules), `utils/colorPair.ts`, `features/color/colorInput.ts` (the parsers and the translucent rule), `features/color/ColorField.tsx`, `features/color/ContrastReadout.tsx`, `features/color/ColorPanel.tsx` |
| Change the persisted preferences | `core/settings/appSettings.ts` (the schema, the defaults, `normalizeAppSettings`), `core/settings/settingsStore.ts` (read, apply, watch, persist), `core/settings/settingsGateway.ts`, `core/settings/tauriSettingsGateway.ts`, `src-tauri/src/settings_io.rs` (the two commands) |
| Add or change a side panel | `core/shell/panelRegistry.ts` (the shared contract: a panel registers itself), `core/shell/slots.ts` (the slots), `core/panels/panelRegistry.ts` (the panel manager's adapter: the side slot, the known ids), `core/panels/panelLayout.ts` (the layout rules), `core/panels/panelLayoutSection.ts` (the settings section), `state/panelStore.ts` (the live layout), `components/panels/PanelStack.tsx` (the stack that renders the registry), `components/panels/Panel.tsx` (the chrome), `components/panels/panelChrome.ts` (hidden/folded state), `components/layout/AppMenuBar.tsx` (the Panels menu) |
| Change what the settings file carries | `core/settings/appSettings.ts` (`settingsDocument`, `serializeSettingsDocument`, `parseSettingsDocument`), `core/settings/settingsSection.ts` (the section contract), `core/settings/settingsStore.ts` (the `sections` option) |
| Change the workspace (the window's arrangement) | `core/workspace/workspaceSettings.ts` (the schema, the defaults, the tolerant reader), `core/workspace/workspaceProfiles.ts` (the presets and the profile a layout matches), `core/workspace/workspaceSettingsSection.ts` (the settings section), `state/workspaceStore.ts` (the live workspace), `app/WorkspaceProvider.tsx` (the provider, the theme and the scale on the root element), `hooks/useWorkspace.ts`, `components/layout/AppMenuBar.tsx` (the Workspace menu), `src/styles/theme.css` (the tokens and the light scheme), `src/app/app.css` (the shell rows) |
| Change the autosave machinery | `core/autosave/autosaveService.ts` (the invariants), `core/autosave/recovery.ts` (where a copy goes). **Not enabled** - the policy is the owner's; see `docs/qa/T06-IMPLEMENTATION-REPORT.md` |
| Change the bucket fill | `core/fill/fillOptions.ts` (the options and their bounds), `core/fill/fillScan.ts` (the scan: the gap closing, the distance field, the growth, the soft edge), `core/fill/floodFill.ts` (the contiguous scan), `core/engine/DrawingEngine.ts` (`beginFill`/`finishFill`/`cancelFill`, the setters), `core/rendering/types.ts` (`readCompositeImage` and the layer subset), `features/options/toolOptionSchema.ts` (the fill group), `src/test/fillScan.test.ts`, `src/test/bucketFill.test.ts` |
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
| `brushSizeStep` | `core/brushes/defaults.ts` | grep the symbol |
| `brushFieldBounds`, `UNIMPLEMENTED_BRUSH_PROPERTIES` | `core/brushes/brushProperties.ts` | grep the symbol |
| `parseNumericInput`, `clampNumber`, `stepValue`, `stepSize`, `StepMode` | `core/brushes/numericInput.ts` | grep the symbol |
| `buildPreviewStroke`, `renderBrushPreview`, `previewFit`, `PREVIEW_CSS_WIDTH` | `core/rendering/brushPreview.ts` | grep the symbol |
| `BRUSH_NUMBER_FIELDS`, `BRUSH_FLAG_FIELDS`, `BRUSH_COLOR_FIELDS`, `readBrushSettings` | `core/brushes/defaults.ts` | grep the symbol |
| `BrushPreset`, `normalizeBrushPresets`, `uniquePresetName`, `normalizePresetName`, `duplicatePreset`, `importPreset`, `mergeBundledPresets`, `isBundledPreset` | `core/brushes/presets.ts` | grep the symbol |
| `BUNDLED_PRESETS`, `BUNDLED_PRESET_IDS` | `core/brushes/bundledPresets.ts` | grep the symbol |
| `PresetSort`, `filterPresets`, `sortPresets`, `groupPresets`, `nextSelectionId`, `runPresetAction`, `PresetLibraryPort`, `isRecentlyUsed` | `core/brushes/presetBrowser.ts` | grep the symbol |
| `serializePresetLibrary`, `parsePresetLibrary`, `MAX_PRESET_LIBRARY_BYTES`, `MAX_PRESET_LIBRARY_ENTRIES` | `core/brushes/presetTransfer.ts` | grep the symbol |
| `PresetLibraryFiles`, `PresetLibraryOutcome` | `core/brushes/presetLibraryFiles.ts` | grep the symbol |
| `BrushPresetPanel`, `PresetRow`, `BrushTipPreview` | `features/brushes/BrushPresetPanel.tsx`, `features/brushes/PresetRow.tsx`, `features/brushes/BrushTipPreview.tsx` | grep the symbol |
| `createStrokeRecord`, `cloneStroke`, `StrokeBuilder` | `core/brushes/strokeBuilder.ts` | 46, 71, 86 |
| `StrokeBuilder.addSample`/`finish` | `core/brushes/strokeBuilder.ts` | grep the symbol |
| `StrokeStabilizer`, `STABILIZER_MODES`, `SMOOTH_MAX_TAU`, `PULL_MAX_TAU`, `SPEED_WINDOW`, `tauAlpha` | `core/brushes/stabilizer.ts` | grep the symbol |
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
| `GridSettings`, `DEFAULT_GRID_SETTINGS`, `nearestGridLine`, `gridLinesBetween`, `snapDocumentPoint`, `snapTolerance` | `core/document/grid.ts` | grep the symbol |
| `SymmetryMode`, `SymmetrySettings`, `symmetryTransforms`, `createSymmetryCopies`, `symmetryAxes`, `isOnSymmetryCenter` | `core/document/symmetry.ts` | grep the symbol |
| `RulerSettings`, `rulerStep`, `rulerMinorStep`, `rulerTicks`, `rulerAxisAt`, `formatRulerLabel` | `core/rendering/rulers.ts` | grep the symbol |
| `createGroupCommand` | `core/commands/groupCommand.ts` | grep the symbol |
| `MIN_SCALE_FACTOR`, `ROTATION_SNAP_DEGREES`, `scaleFactorFor`, `rotationAngleFor`, `snapRotationAngle`, `createScaleTransform`, `createRotateTransform`, `selectionFrame` | `core/document/selectionTransform.ts` | grep the symbol |
| `SelectionHandleId`, `selectionHandles`, `findSelectionHandle`, `HANDLE_CURSORS` | `core/document/selectionHandles.ts` | grep the symbol |
| `StrokeStore` (ordered element list) | `core/document/strokeStore.ts` | 24 |
| `floodFill`, `MAX_FILL_SCAN_PIXELS` | `core/fill/floodFill.ts` | 56, 47 |
| `scanFill` (the scan pipeline) | `core/fill/fillScan.ts` | grep the symbol |
| `FillReferenceMode`, `fillReferenceLayers`, the option normalizers | `core/fill/fillOptions.ts` | grep the symbol |
| `createGradientRecord`, `MIN_GRADIENT_LENGTH` | `core/gradient/gradientRecord.ts` | 41, 16 |
| `GradientHandleId`, `gradientHandles`, `findGradientHandle`, `moveGradientHandle`, `gradientGeometryHit`, `GRADIENT_HANDLE_CURSORS` | `core/gradient/gradientHandles.ts` | grep the symbol |
| `createGradientEditCommand`, `GradientEditHost` | `core/commands/gradientEditCommand.ts` | grep the symbol |
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
| `ShapeKind`, `ShapeOptions`, `normalizeShapeOptions` | `core/tools/shapeGeometry.ts` | 22, 42, 86 |
| `shapeOutline`, `outlineExtent` | `core/tools/shapeGeometry.ts` | 120, 143 |
| `rotateAboutCentre`, `polygonOutline`, `starOutline` (private) | `core/tools/shapeGeometry.ts` | 305, 349, 378 |
| `getShapeOptions`, `setShapeSides`/`setShapeInnerRatio`/`setShapeRotation` | `core/engine/DrawingEngine.ts` | 992, 1004 / 1022 / 1039 |
| `TOOL_DEFINITIONS`, `findToolByShortcut` | `core/tools/toolDefinitions.ts` | 107, 123 |
| `EditorActions` | `state/editorStore.ts` | 24 |
| `CanvasViewRegistry`, `CanvasView`, `ViewSummary`, `summarizeView`, `viewOrientation` | `core/engine/canvasViews.ts` | grep the symbol |
| `openSecondaryView`, `closeSecondaryView`, `attachSecondaryView`, `detachSecondaryView`, `setSecondaryViewSize`, `focusView`, `fitView`, `actualSizeView` | `core/engine/DrawingEngine.ts` | grep the symbol |
| `addDisplayTarget`, `removeDisplayTarget`, `setDisplayTargetViewport`, `setDisplayTargetSize` | `core/rendering/types.ts`, `core/rendering/Canvas2DRenderer.ts` | grep the symbol |
| `SecondaryViewPanel` | `features/view/SecondaryViewPanel.tsx` | grep the symbol |
| `createDocument` | `core/document/document.ts` | 183 |
| `renderDocumentPng` | `core/export/pngExport.ts` | 57 |
| `ProjectFiles` | `core/project/projectFiles.ts` | 43 |
| `DocumentSessionRegistry`, `DocumentSession`, `DocumentSessionSummary`, `samePath`, `tabCloseDecision` | `core/documents/sessionRegistry.ts` | grep the symbol |
| `DocumentWorkspace` | `core/documents/documentWorkspace.ts` | grep the symbol |
| `RecentFilesStore`, `createRecentFilesSection`, `normalizeRecentFiles`, `recentFilesWith` | `core/documents/recentFiles.ts` | grep the symbol |
| `DocumentTabs` | `features/tabs/DocumentTabs.tsx` | grep the symbol |
| `useDocumentSessions`, `useActiveEngine`, `useRecentFiles` | `hooks/useDocumentSessions.ts`, `hooks/useEditor.ts`, `hooks/useRecentFiles.ts` | grep the symbol |
| `hsvToRgb`, `rgbToHsv`, `hexToHsv`, `normalizeHue` | `utils/color.ts` | 103, 149, 188, 88 |
| `asRecord` (an untrusted value as a record) | `utils/record.ts` | 12 |
| `AppSettings`, `DEFAULT_APP_SETTINGS`, `normalizeAppSettings`, `parseAppSettings`, `serializeAppSettings` | `core/settings/appSettings.ts` | grep the symbol |
| `SettingsStore` (read, apply, watch, persist) | `core/settings/settingsStore.ts` | grep the symbol |
| `WorkspaceSettings`, `DEFAULT_WORKSPACE_SETTINGS`, `normalizeWorkspaceSettings`, `parseWorkspaceSettings`, `workspaceSettingsDocument`, `workspaceSettingsEqual`, `normalizeUiScale` | `core/workspace/workspaceSettings.ts` | grep the symbol |
| `WORKSPACE_PROFILES`, `findWorkspaceProfile`, `profilePanelLayout`, `profileWorkspaceSettings`, `resolveWorkspaceProfile` | `core/workspace/workspaceProfiles.ts` | grep the symbol |
| `createWorkspaceSettingsSection`, `WORKSPACE_SETTINGS_KEY` | `core/workspace/workspaceSettingsSection.ts` | grep the symbol |
| `createWorkspaceStore`, `WorkspaceActions` | `state/workspaceStore.ts` | grep the symbol |
| `useWorkspaceSettings`, `useWorkspaceActions` | `hooks/useWorkspace.ts` | grep the symbol |
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
| `ToolOptionsPanel` | `features/options/ToolOptionsPanel.tsx` | grep the symbol |
| `ColorWheel`, `ColorPanel` | `features/color/ColorWheel.tsx`, `features/color/ColorPanel.tsx` | 69, 12 |
| `ReferenceImage`, `ReferenceState`, `ReferenceOverlay`, `ReferenceSource` | `core/reference/types.ts` | grep the symbol |
| `referenceRect`, `referenceContains`, `referenceSourcePoint`, `referenceScale`, `moveReference`, `scaleReference`, `setReferenceScale`, `fitReference`, `centerReference` | `core/reference/geometry.ts` | grep the symbol |
| `decodeReferenceImage`, `ReferenceDecodeError`, `MAX_REFERENCE_PIXELS`, `MAX_TOTAL_REFERENCE_PIXELS` | `core/reference/decode.ts` | grep the symbol |
| `ReferenceImageStore` (the state, the decoded copies, the sampling) | `core/reference/store.ts` | grep the symbol |
| `ReferencePanel` | `features/reference/ReferencePanel.tsx` | grep the symbol |
| `useReferenceState`, `useReferenceStore` | `hooks/useReferences.ts` | grep the symbol |
| `formatZoomPercent`, `zoomPercentText`, `parseZoomPercent`, `describeViewTransform`, `VIEW_ROTATION_DEGREES` | `features/view/viewNavigation.ts` | grep the symbol |
| `ZoomField`, `ViewControls` | `features/view/ZoomField.tsx`, `features/view/ViewControls.tsx` | grep the symbol |
| `usePanModifier` (the space bar pans) | `hooks/usePanModifier.ts` | grep the symbol |
| `panelDefinitions`, `sidePanelDefinitions`, `findPanelDefinition`, `isPanelId`, `defaultVisiblePanelIds` | `core/panels/panelRegistry.ts` | grep the symbol |
| `PanelLayoutState`, `normalizePanelLayoutState`, `setPanelVisibility`, `togglePanelVisibility`, `setPanelCollapsed`, `showAllPanels`, `hideAllPanels`, `resetPanelLayout`, `shouldMountPanel` | `core/panels/panelLayout.ts` | grep the symbol |
| `createPanelLayoutSection`, `PANEL_LAYOUT_KEY` | `core/panels/panelLayoutSection.ts` | grep the symbol |
| `createPanelStore`, `PanelActions` | `state/panelStore.ts` | grep the symbol |
| `PanelStack`, `PanelChromeContext` | `components/panels/PanelStack.tsx`, `components/panels/panelChrome.ts` | grep the symbol |
| `nextMenuIndex`, `firstMenuIndex`, `lastMenuIndex` | `utils/menuNavigation.ts` | grep the symbol |
| `navigatorLayout`, `documentToNavigator`, `navigatorToDocument`, `viewportCorners`, `navigatorCorners`, `navigatorGrab`, `navigatorTargetCenter`, `pointInPolygon` | `features/navigator/navigatorGeometry.ts` | grep the symbol |
| `NavigatorPanel` | `features/navigator/NavigatorPanel.tsx` | grep the symbol |
| `renderOverview` | `core/rendering/types.ts`, `core/rendering/Canvas2DRenderer.ts` | grep the symbol |
| `getOverview`, `centerViewportOn`, `centerViewport` | `core/engine/DrawingEngine.ts` | grep the symbol |

## 6. Docs → section

| Doc | Read |
| --- | --- |
| `docs/SESSION-BRIEF.md` | Whole file once (≈600 lines) for state, workflow, next slice |
| `docs/ROADMAP.md` | L171-197 ("Next slice"); phase checkboxes only when deciding scope |
| `docs/HANDOFF.md` | §7 toolchain, §8 verification recipes, §9 next move; skip the rest |
| `docs/ARCHITECTURE.md` | `## Rendering pipeline` (141), `### Why a stroke buffer` (274), `### Eraser strokes` (457), `### Shape tools` (594), `#### The polygon and the star` (628), `### Bucket` (685), `### Gradients` (750), `### Selection` (792), `## Undo / redo` (994), `## Testing` (1197) |
| `docs/PROJECT_FORMAT.md` | `### elements[]` (215), `### brush` (323), `## Validation` (335), `## Versioning` (393) |
| `docs/RELEASE-READINESS.md` | The release-readiness workstream: icons, licence notices, clean-room attestation, and the open owner decisions |
| `docs/MULTI-DOCUMENT-TABS.md` | The open documents: the tab strip, the session registry (one engine per document), the close rules, the recent files, and what is deliberately not there |
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
| Grid and snapping | `grid.test.ts` (the pure geometry: the nearest line, the lines between two coordinates, the tolerance, the target choice), `gridSnapping.test.ts` (the engine seam, the viewport, the renderer overlay) |
| The drawing aids (rulers, guides, symmetry) | `drawingAids.test.ts` (the symmetry geometry, the copies, the single undo step, the centre drag, the ruler geometry, the guide a ruler hands out, the renderer's overlays and the export exclusion) |
| Brush settings / capture | `brushSettings.test.ts`, `strokeBuilder.test.ts` |
| Brush controls and the live preview | `brushControls.test.ts` (the number box's rules, the keyboard steps, the bounds the engine honours, the properties it does not, and the preview's agreement with the rasterizer), `brushOrigin.test.ts` (the preset the brush came from, and the reset) |
| Brush presets | `brushPresets.test.ts` (the name rules, save/apply/rename/duplicate/delete, the settings round trip, the next stroke's brush, and no brush field dropped) |
| The brush browser | `presetBrowser.test.ts` (the built-in brushes and their protection, the search, the order, the favourites, the selection, the actions, the library file, the malformed file, the duplicate names, the import and the reload), `tests/visual/preset-browser.spec.ts` (the browser in a real browser: the built-in brushes, applying one, the search, the deletion confirmation, the protection of a built-in brush and the keyboard) |
| Colour model / wheel | `color.test.ts` (conversions, the whole-cube round trip), `colorWheel.test.ts` (disc geometry, what the wheel shows) |
| Colour contrast and difference | `colorMetrics.test.ts` (WCAG luminance and contrast, sRGB to CIELAB, CIEDE2000 against the published verification table, the nearest swatch, the unknown and translucent states, totality), `colorPair.test.ts` (comparing two colours), `tests/visual/color-compare.spec.ts` (the readout in a real browser) |
| Colour input formats | `colorInput.test.ts` (8-digit hex, `hsl()`, `oklch()`, the gamut clamp, the round trip, garbage and translucent input) |
| Settings persistence | `settings.test.ts` (the round trip, the defaults, the malformed and future-versioned file, the clamping, the no-dirty contract, a failed write) |
| The workspace (the window's arrangement) | `workspaceSettings.test.ts` (the schema and its tolerant reader, the clamping, the profiles and the layout they imply, the derived profile, the store, the settings section, the restart, the broken file, and the separation from the drawing) |
| Autosave | `autosave.test.ts` (the dirty-state invariants, the recovery path, the races with a user save) |
| Brush spacing / stabilizer | `strokeBuilder.test.ts`, `drawingEngine.test.ts`, `projectFormat.test.ts`, `projectLifecycle.test.ts` |
| The stroke stabilizer | `stabilizer.test.ts` (the modes, the time constant, the tremor rejection, the corner, the endpoint, the catch-up, the measured lag and the frame-rate independence) |
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
| The open documents (the tabs) | `documentSessions.test.ts` (the registry, one engine per document, the independent history, selection and viewport, the close decision, the workspace's open/save/close, the duplicate path and the recent list) |
| Bucket fill | `floodFill.test.ts`, `fillCommand.test.ts`, `fillScan.test.ts` (the region, the growth, the soft edge and the gap closing), `bucketFill.test.ts` (the engine seam: the reference modes, the hidden layer, the cancel and the no-op) |
| Gradients | `gradient.test.ts`, `gradientEditing.test.ts` (the handle geometry, the selection, the live preview, the cancel, the single undo step, the nudge and the overlay) |
| Layer blend modes | `blendModes.test.ts` (the formulas and their boundaries), `canvas2dRenderer.test.ts` (the canvas operation mapping, exact pixels, alpha, preview and export) |
| Selection math | `strokeSelection.test.ts` |
| Scale / rotate a selection | `selectionTransform.test.ts` (the scale and rotation about a centre, the clamps, the 15-degree snap, the frame after a transform), `selectionHandles.test.ts` (the corner and rotation handles, the grab radius, the hit-test), `drawingEngine.test.ts` (the gestures, the undo step, the reopen) |
| Commands | `commandStack.test.ts`, `strokeCommand.test.ts`, `documentCommand.test.ts` |
| Document/layers | `document.test.ts` |
| Viewport/input | `viewport.test.ts`, `pointer.test.ts`, `path.test.ts` |
| View navigation | `viewNavigation.test.ts` (the zoom field's parse and clamp, the zoom bounds, the screen-to-document mapping under a rotation and a mirror, the pan modifier, the view-only dirty state and the reset) |
| The second view of the canvas | `secondaryView.test.ts` (the view registry, the shared document identity, the history coherence, the dirty state, the viewport independence, and the renderer's shared display targets) |
| Export | `pngExport.test.ts` |
| Misc | `base64`, `color`, `frameScheduler`, `fileMessages` |
| Colour wheel (HSV) | `color.test.ts` (conversions, boundaries), `colorWheel.test.ts` (disc geometry, which colour the wheel shows) |
| Navigator | `navigator.test.ts` (the layout and the mapping between navigator, canvas and document pixels, the grab and jump rules, the engine's centring intents and the overview cache) |
| Reference images | `referenceImages.test.ts` (the workspace-space transform, the decode - a malformed file, a file that is too large, an enormous image downscaled while it decodes - the store and its one decoded copy, a failed import, the session budget, the sampled pixel through the placement, the picker's foreground and background sampling, the cursor feedback, and that a reference never reaches the export) |
| Panel manager | `panelLayout.test.ts` (the registry, the layout rules, the store, the mounting policy, the settings section and the round trip through the settings file), `menuNavigation.test.ts` (the menu's keyboard rules) |

## 9. Keep this file useful

- Add a row here when you add, rename or move a file. Do not add prose.
- Line anchors are hints, not contracts. If `rg` disagrees, fix the anchor.
- This is an index, not a second architecture document. The authority is
  `docs/SESSION-BRIEF.md`, `docs/ROADMAP.md` and the code itself.
