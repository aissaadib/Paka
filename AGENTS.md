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
| 2703 | `src/core/engine/DrawingEngine.ts` | snapshot, gestures, history, layers, selection |
| 2953 | `src/test/drawingEngine.test.ts` | engine behaviour (grep `it(`) |
| 3451 | `src/test/canvas2dRenderer.test.ts` | renderer behaviour (grep `it(`) |
| 1417 | `src/test/projectFormat.test.ts` | format round-trips/rejections |
| 1562 | `src/core/rendering/Canvas2DRenderer.ts` | buffers, compositing, feather scratch, rebuilds |
| 865 | `src/core/project/projectFormat.ts` | serialize/parse/validate |
| 355 | `src/core/commands/strokeEditCommand.ts` | move/delete/nudge/flip/duplicate |

**Medium (100-250) - read targeted windows:** `AppMenuBar`, `icons`,
`document.ts`, `recordingCanvas.ts`, `canvasInputBinder`, `useKeyboardShortcuts`,
`floodFill`, `document/types.ts`, `document/guides.ts`,
`document/selectionTransform.ts` (the scale/rotate geometry),
`document/selectionHandles.ts` (the transform handles),
`canvas2dStroke`, `stampCoverage`,
`strokeBuilder`, `strokeSelection`, `commandStack`,
`types.ts` (tools), `guidesTool.ts` (138),
`features/color/wheelGeometry.ts` (102),
feature controls in `features/`, `ProjectFiles`, `project_io.rs`.

**Between 250 and 400 - read targeted windows:** `core/tools/shapeGeometry.ts`
(395: the line, the rectangle, the ellipse, the polygon, the star, the rigid
rotation, the shape options and their clamps).

**Over 400 - read targeted windows:** `src/test/shapeGeometry.test.ts` (559: the
shape geometry).

**Small (<100) - safe to read whole:** defaults, fillPatch, gradientRecord,
pngExport, viewport, frameScheduler, pointer, documentCommand, fill/gradient
commands, tool definitions, `editorStore.ts`, `features/color/wheelState.ts`,
Rust `lib.rs`/`main.rs`/`native_environment.rs`,
`scripts/generate-app-icon.mjs`,
`scripts/generate-third-party-notices.mjs`.

## 4. Task → read only this

| Task | Open, in order |
| --- | --- |
| Add or change a tool gesture | `core/tools/<tool>.ts` (≈90 lines), `core/tools/types.ts` (Tool/ToolContext), then the matching `begin*/finish*/cancel*` block in `DrawingEngine.ts` (§5) |
| Change the composition guides | `core/document/guides.ts` (the axis heuristic, the rounding, the grab radius, the hit-test, the duplicate rule), `core/document/types.ts` (`Guide`), `core/tools/guidesTool.ts`, the guide block in `DrawingEngine.ts`, `paintGuides` in `Canvas2DRenderer.ts` |
| Change a shape's geometry (polygon, star) | `core/tools/shapeGeometry.ts` (`ShapeOptions` L42, `normalizeShapeOptions` L86, `shapeOutline` L120, `rotateAboutCentre` L305, `polygonOutline` L349, `starOutline` L378), `core/tools/shapeTool.ts` (the press-time capture), `core/tools/types.ts` (`ToolContext.getShapeOptions`), `DrawingEngine.ts` (`getShapeOptions` L992, `setShapeSides`/`setShapeInnerRatio`/`setShapeRotation` L1004-1053), `state/editorStore.ts`, `features/shapes/ShapeControls.tsx`, `src/test/shapeGeometry.test.ts` |
| Register a tool / shortcut | `core/tools/toolDefinitions.ts` (L11-134), `core/tools/toolRegistry.ts`, `types/tool.ts`, `hooks/useKeyboardShortcuts.ts`, `components/toolbar/ToolRail.tsx` |
| Change stroke rasterization | `core/rendering/canvas2dStroke.ts` (207), `Canvas2DRenderer.ts` `rasterizeStrokeToBuffer`/`compositeStrokeBuffer`/`applyErase` |
| Change the stamp (dab) engine | `core/rendering/stampCoverage.ts` (`stampDabs`, `StampDabCursor`, `stampDabCoverage`, `StampCoverage`, `MAX_STAMP_COVERAGE_WORK`), `Canvas2DRenderer.ts` `extendStampStroke`/`rasterizeStampStroke`/`writeStampCoverage`, `types/brush.ts`, `BrushControls.tsx`, `projectFormat.ts` `readBrush` (v9) |
| Change brush hardness / soft edge | `canvas2dStroke.ts` `strokeFeatherRadius` (L32-48), `Canvas2DRenderer.ts` `paintStrokeCoverage`/`featherStroke` (L1263/L1389), `features/brushes/BrushControls.tsx`, `projectFormat.ts` `readBrush` (L797) |
| Change texture / grain | `canvas2dStroke.ts` `textureCoverage`/`TEXTURE_TILE_SIZE` (L52-65), `Canvas2DRenderer.ts` `applyStrokeTexture`/`textureTile` (L1324/L1350), `types/brush.ts`, `BrushControls.tsx`, format v7 |
| Change brush sampling (spacing/stabilizer) | `core/brushes/strokeBuilder.ts` (`addSample` L114, `STABILIZER_MAX_LAG` L39, `finish` L193), `DrawingEngine.ts` `finishStroke` (L1607), `types/brush.ts`, `BrushControls.tsx`, tests in `strokeBuilder.test.ts`/`drawingEngine.test.ts` |
| Add a brush field | `types/brush.ts`, `core/brushes/defaults.ts`, `features/brushes/BrushControls.tsx`, `projectFormat.ts` `readBrush`/serialize, `engine.setBrush`. A sampling-only field may be additive; one that changes how stored samples render needs a version bump |
| Add a layer element kind | `document/types.ts`, `document/strokeStore.ts`, renderer rasterize + rebuild path, a command, `projectFormat.ts`, `PROJECT_FORMAT.md` |
| Undo/redo behaviour | `core/commands/commandStack.ts`, the command in `core/commands/`, `engine.executeDocumentCommand`/`recordHistoryChange` |
| Persistence / format version | `projectFormat.ts` (`PROJECT_VERSION` L108, `serializeProject` L443, `parseProject` L520, `readBrush` L797), `PROJECT_FORMAT.md` (§§ `brush`, `Versioning`) |
| File open/save orchestration | `core/project/projectFiles.ts`, `projectGateway.ts`, `tauriGateway.ts`, `features/project/useFileCommands.ts` |
| Layer operation | `core/document/document.ts`, `core/commands/documentCommand.ts`, `DrawingEngine.ts` L755-868, `features/layers/LayersPanel.tsx` |
| Selection / transform | `core/document/strokeSelection.ts`, `core/document/selectionTransform.ts` (the pure scale/rotate geometry), `core/document/selectionHandles.ts` (the corner and rotation handles), `core/tools/selectTool.ts`, `DrawingEngine.ts` L1665-1989, `strokeEditCommand.ts` |
| Add a UI control | matching `features/**/…Controls.tsx`, `state/editorStore.ts` (`EditorActions`), the engine setter and `EditorSnapshot` field |
| Change the colour model or the wheel | `utils/color.ts` (`hsvToRgb`/`rgbToHsv`/`hexToHsv`), `features/color/wheelGeometry.ts` (disc geometry, `resolveWheelHsv`), `features/color/wheelState.ts` (what the wheel shows), `features/color/ColorWheel.tsx`, `features/color/ColorPanel.tsx`, `features/color/color.css` |
| Export | `core/export/pngExport.ts`, `DrawingEngine.renderDocumentImage` (L755) |
| Native I/O | `src-tauri/src/project_io.rs` (230), `lib.rs`, `core/project/tauriGateway.ts` |
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
| `MIN_SCALE_FACTOR`, `ROTATION_SNAP_DEGREES`, `scaleFactorFor`, `rotationAngleFor`, `snapRotationAngle`, `createScaleTransform`, `createRotateTransform`, `selectionFrame` | `core/document/selectionTransform.ts` | grep the symbol |
| `SelectionHandleId`, `selectionHandles`, `findSelectionHandle`, `HANDLE_CURSORS` | `core/document/selectionHandles.ts` | grep the symbol |
| `StrokeStore` (ordered element list) | `core/document/strokeStore.ts` | 24 |
| `floodFill`, `MAX_FILL_SCAN_PIXELS` | `core/fill/floodFill.ts` | 56, 47 |
| `createGradientRecord`, `MIN_GRADIENT_LENGTH` | `core/gradient/gradientRecord.ts` | 41, 16 |
| `PROJECT_VERSION`, `serializeProject`, `parseProject` | `core/project/projectFormat.ts` | 108, 443, 520 |
| `readBrush` (format validation) | `core/project/projectFormat.ts` | ~675 |
| `stampDabs`, `StampDabCursor` (dab plan) | `core/rendering/stampCoverage.ts` | 106, 150 |
| `stampDabCoverage` (per-dab profile) | `core/rendering/stampCoverage.ts` | 218 |
| `StampCoverage` (coverage union, tiles) | `core/rendering/stampCoverage.ts` | 246 |
| `MAX_STAMP_COVERAGE_WORK`, `MIN_STAMP_SPACING_PX` | `core/rendering/stampCoverage.ts` | 39, 32 |
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
| `createDocument` | `core/document/document.ts` | 183 |
| `renderDocumentPng` | `core/export/pngExport.ts` | 57 |
| `ProjectFiles` | `core/project/projectFiles.ts` | 43 |
| `hsvToRgb`, `rgbToHsv`, `hexToHsv`, `normalizeHue` | `utils/color.ts` | 103, 149, 188, 88 |
| `wheelPointToHsv`, `hsvToWheelPoint`, `resolveWheelHsv` | `features/color/wheelGeometry.ts` | 47, 66, 92 |
| `createWheelState`, `reduceWheelState` | `features/color/wheelState.ts` | 41, 53 |
| `ColorWheel`, `ColorPanel` | `features/color/ColorWheel.tsx`, `features/color/ColorPanel.tsx` | 69, 12 |

## 6. Docs → section

| Doc | Read |
| --- | --- |
| `docs/SESSION-BRIEF.md` | Whole file once (≈600 lines) for state, workflow, next slice |
| `docs/ROADMAP.md` | L171-197 ("Next slice"); phase checkboxes only when deciding scope |
| `docs/HANDOFF.md` | §7 toolchain, §8 verification recipes, §9 next move; skip the rest |
| `docs/ARCHITECTURE.md` | `## Rendering pipeline` (141), `### Why a stroke buffer` (274), `### Eraser strokes` (457), `### Shape tools` (594), `#### The polygon and the star` (628), `### Bucket` (685), `### Gradients` (750), `### Selection` (792), `## Undo / redo` (994), `## Testing` (1197) |
| `docs/PROJECT_FORMAT.md` | `### elements[]` (215), `### brush` (323), `## Validation` (335), `## Versioning` (393) |
| `docs/RELEASE-READINESS.md` | The release-readiness workstream: icons, licence notices, clean-room attestation, and the open owner decisions |
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
| Brush settings / capture | `brushSettings.test.ts`, `strokeBuilder.test.ts` |
| Colour model / wheel | `color.test.ts` (conversions, the whole-cube round trip), `colorWheel.test.ts` (disc geometry, what the wheel shows) |
| Brush spacing / stabilizer | `strokeBuilder.test.ts`, `drawingEngine.test.ts`, `projectFormat.test.ts`, `projectLifecycle.test.ts` |
| Brush texture / grain | `canvas2dStroke.test.ts` (`textureCoverage`), `canvas2dRenderer.test.ts` (pattern pass), `projectFormat.test.ts`, `drawingEngine.test.ts`, `projectLifecycle.test.ts` |
| Stamp (dab) engine | `stampCoverage.test.ts` (dab plan, union, budget), `canvas2dRenderer.test.ts` (stamped pixels, parity), `projectFormat.test.ts` (v9), `drawingEngine.test.ts`, `projectLifecycle.test.ts` |
| Brush hardness / soft edge | `canvas2dStroke.test.ts`, `canvas2dRenderer.test.ts`, `projectFormat.test.ts` |
| Stroke raster | `canvas2dStroke.test.ts` |
| Shape geometry (line, rectangle, ellipse, polygon, star) | `shapeGeometry.test.ts` (the vertex counts, the inscribed ellipse, the clamps, the rotation, the closed polyline, the star's simple outline) |
| Renderer / layers / compositing | `canvas2dRenderer.test.ts` (grep `it(`) |
| Engine gestures, history, selection | `drawingEngine.test.ts` (grep `it(`) |
| Format | `projectFormat.test.ts` |
| Save/open lifecycle | `projectLifecycle.test.ts`, `projectFiles.test.ts` |
| Bucket fill | `floodFill.test.ts`, `fillCommand.test.ts` |
| Gradients | `gradient.test.ts` |
| Selection math | `strokeSelection.test.ts` |
| Scale / rotate a selection | `selectionTransform.test.ts` (the scale and rotation about a centre, the clamps, the 15-degree snap, the frame after a transform), `selectionHandles.test.ts` (the corner and rotation handles, the grab radius, the hit-test), `drawingEngine.test.ts` (the gestures, the undo step, the reopen) |
| Commands | `commandStack.test.ts`, `strokeCommand.test.ts`, `documentCommand.test.ts` |
| Document/layers | `document.test.ts` |
| Viewport/input | `viewport.test.ts`, `pointer.test.ts`, `path.test.ts` |
| Export | `pngExport.test.ts` |
| Misc | `base64`, `color`, `frameScheduler`, `fileMessages` |
| Colour wheel (HSV) | `color.test.ts` (conversions, boundaries), `colorWheel.test.ts` (disc geometry, which colour the wheel shows) |

## 9. Keep this file useful

- Add a row here when you add, rename or move a file. Do not add prose.
- Line anchors are hints, not contracts. If `rg` disagrees, fix the anchor.
- This is an index, not a second architecture document. The authority is
  `docs/SESSION-BRIEF.md`, `docs/ROADMAP.md` and the code itself.
