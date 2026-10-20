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
| All 26 test files | Use the test map in §8 |
| `README.md` end to end | Feature prose duplicates SESSION-BRIEF; open only for user-facing wording |
| `docs/HANDOFF.md` and `docs/SESSION-BRIEF.md` both, end to end | Read SESSION-BRIEF first; HANDOFF only §7/§8 when you need toolchain or verification detail |
| `docs/ARCHITECTURE.md` end to end (976 lines) | Read the named section in §6 |

## 3. File sizes (source only)

**Large (>250 lines) - never read whole:**

| Lines | File | What is in it |
| --- | --- | --- |
| 2075 | `src/core/engine/DrawingEngine.ts` | snapshot, gestures, history, layers, selection |
| 2095 | `src/test/drawingEngine.test.ts` | engine behaviour (grep `it(`) |
| 1342 | `src/test/canvas2dRenderer.test.ts` | renderer behaviour (grep `it(`) |
| 1050 | `src/test/projectFormat.test.ts` | format round-trips/rejections |
| 961 | `src/core/rendering/Canvas2DRenderer.ts` | buffers, compositing, feather scratch, rebuilds |
| 724 | `src/core/project/projectFormat.ts` | serialize/parse/validate |
| 355 | `src/core/commands/strokeEditCommand.ts` | move/delete/nudge/flip/duplicate |

**Medium (100-250) - read targeted windows:** `AppMenuBar`, `icons`,
`document.ts`, `recordingCanvas.ts`, `canvasInputBinder`, `useKeyboardShortcuts`,
`floodFill`, `document/types.ts`, `canvas2dStroke`, `stampCoverage`,
`shapeGeometry`, `strokeBuilder`, `strokeSelection`, `commandStack`,
`types.ts` (tools),
feature controls in `features/`, `ProjectFiles`, `project_io.rs`.

**Small (<100) - safe to read whole:** defaults, fillPatch, gradientRecord,
pngExport, viewport, frameScheduler, pointer, documentCommand, fill/gradient
commands, tool definitions, `editorStore.ts`, Rust `lib.rs`/`main.rs`/
`native_environment.rs`, `scripts/generate-app-icon.mjs`,
`scripts/generate-third-party-notices.mjs`.

## 4. Task → read only this

| Task | Open, in order |
| --- | --- |
| Add or change a tool gesture | `core/tools/<tool>.ts` (≈90 lines), `core/tools/types.ts` (Tool/ToolContext), then the matching `begin*/finish*/cancel*` block in `DrawingEngine.ts` (§5) |
| Register a tool / shortcut | `core/tools/toolDefinitions.ts` (L11-102), `core/tools/toolRegistry.ts`, `types/tool.ts`, `hooks/useKeyboardShortcuts.ts`, `components/toolbar/ToolRail.tsx` |
| Change stroke rasterization | `core/rendering/canvas2dStroke.ts` (207), `Canvas2DRenderer.ts` `rasterizeStrokeToBuffer`/`compositeStrokeBuffer`/`applyErase` |
| Change the stamp (dab) engine | `core/rendering/stampCoverage.ts` (`stampDabs`, `StampDabCursor`, `stampDabCoverage`, `StampCoverage`, `MAX_STAMP_COVERAGE_WORK`), `Canvas2DRenderer.ts` `extendStampStroke`/`rasterizeStampStroke`/`writeStampCoverage`, `types/brush.ts`, `BrushControls.tsx`, `projectFormat.ts` `readBrush` (v9) |
| Change brush hardness / soft edge | `canvas2dStroke.ts` `strokeFeatherRadius` (L32-48), `Canvas2DRenderer.ts` `paintStrokeCoverage`/`featherStroke` (L767/L870), `features/brushes/BrushControls.tsx`, `projectFormat.ts` `readBrush` (L675) |
| Change texture / grain | `canvas2dStroke.ts` `textureCoverage`/`TEXTURE_TILE_SIZE` (L52-65), `Canvas2DRenderer.ts` `applyStrokeTexture`/`textureTile` (L805/L831), `types/brush.ts`, `BrushControls.tsx`, format v7 |
| Change brush sampling (spacing/stabilizer) | `core/brushes/strokeBuilder.ts` (`addSample` L114, `STABILIZER_MAX_LAG` L39, `finish` L193), `DrawingEngine.ts` `finishStroke` (L1254), `types/brush.ts`, `BrushControls.tsx`, tests in `strokeBuilder.test.ts`/`drawingEngine.test.ts` |
| Add a brush field | `types/brush.ts`, `core/brushes/defaults.ts`, `features/brushes/BrushControls.tsx`, `projectFormat.ts` `readBrush`/serialize, `engine.setBrush`. A sampling-only field may be additive; one that changes how stored samples render needs a version bump |
| Add a layer element kind | `document/types.ts`, `document/strokeStore.ts`, renderer rasterize + rebuild path, a command, `projectFormat.ts`, `PROJECT_FORMAT.md` |
| Undo/redo behaviour | `core/commands/commandStack.ts`, the command in `core/commands/`, `engine.executeDocumentCommand`/`recordHistoryChange` |
| Persistence / format version | `projectFormat.ts` (`PROJECT_VERSION` L77, `serializeProject` L384, `parseProject` L456, `readBrush` L670), `PROJECT_FORMAT.md` (§§ `brush`, `Versioning`) |
| File open/save orchestration | `core/project/projectFiles.ts`, `projectGateway.ts`, `tauriGateway.ts`, `features/project/useFileCommands.ts` |
| Layer operation | `core/document/document.ts`, `core/commands/documentCommand.ts`, `DrawingEngine.ts` L655-760, `features/layers/LayersPanel.tsx` |
| Selection / transform | `core/document/strokeSelection.ts`, `core/tools/selectTool.ts`, `DrawingEngine.ts` L1291-1780, `strokeEditCommand.ts` |
| Add a UI control | matching `features/**/…Controls.tsx`, `state/editorStore.ts` (`EditorActions`), the engine setter and `EditorSnapshot` field |
| Export | `core/export/pngExport.ts`, `DrawingEngine.renderDocumentImage` (L627) |
| Native I/O | `src-tauri/src/project_io.rs` (230), `lib.rs`, `core/project/tauriGateway.ts` |
| Decide what to build next | `docs/SESSION-BRIEF.md` §9 and `docs/ROADMAP.md` §Next slice only |
| Release readiness, licensing or provenance | `docs/RELEASE-READINESS.md`, `docs/g1/reuse-decision.md`, `docs/g1/provenance-record.json`, `THIRD_PARTY_NOTICES.md` |

## 5. Symbol → file (grep the symbol)

| Symbol | File | ≈Line |
| --- | --- | --- |
| `EditorSnapshot`, `DocumentFileState` | `core/engine/DrawingEngine.ts` | 111, 163 |
| `DrawingEngine` (class) | `core/engine/DrawingEngine.ts` | 314 |
| `handlePointerSample` (gesture router) | `core/engine/DrawingEngine.ts` | 1922 |
| `beginStroke` / `extendStroke` / `finishStroke` / `cancelStroke` | `core/engine/DrawingEngine.ts` | 922 / 950 / 1254 / 1272 |
| Shape lifecycle | `core/engine/DrawingEngine.ts` | 971-1045 |
| Fill lifecycle | `core/engine/DrawingEngine.ts` | 1056-1153 |
| Gradient lifecycle | `core/engine/DrawingEngine.ts` | 1169-1251 |
| Selection lifecycle | `core/engine/DrawingEngine.ts` | 1490-1650 |
| `setBrush`, editor setters | `core/engine/DrawingEngine.ts` | 774-850 |
| `buildSnapshot` | `core/engine/DrawingEngine.ts` | 2045 |
| `BrushSettings` | `types/brush.ts` | 11 |
| `DEFAULT_BRUSH`, `normalizeBrush`, `brushSettingsEqual` | `core/brushes/defaults.ts` | 15, 28, 50 |
| `createStrokeRecord`, `cloneStroke`, `StrokeBuilder` | `core/brushes/strokeBuilder.ts` | 46, 71, 86 |
| `STABILIZER_MAX_LAG`, `StrokeBuilder.addSample`/`finish` | `core/brushes/strokeBuilder.ts` | 39, 114, 193 |
| `rasterizeStroke`, `strokeOpacity`, `strokeDiameter`, `stampDot` | `core/rendering/canvas2dStroke.ts` | 121, 67, 52, 87 |
| `SOFT_EDGE_RADIUS_RATIO`, `strokeFeatherRadius` | `core/rendering/canvas2dStroke.ts` | 32, 43 |
| `paintStrokeCoverage`, `featherStroke`, `compositeStrokeBuffer` | `core/rendering/Canvas2DRenderer.ts` | 767, 870, 742 |
| `applyStrokeTexture`, `textureTile` | `core/rendering/Canvas2DRenderer.ts` | 805, 831 |
| `TEXTURE_TILE_SIZE`, `textureCoverage` | `core/rendering/canvas2dStroke.ts` | 52, 65 |
| `Canvas2DRenderer` (class) | `core/rendering/Canvas2DRenderer.ts` | 85 |
| `StrokeRecord`, `FillPatchRecord`, `GradientRecord`, `LayerElement` | `core/document/types.ts` | 76, 126, 161, 176 |
| `StrokeStore` (ordered element list) | `core/document/strokeStore.ts` | 24 |
| `floodFill`, `MAX_FILL_SCAN_PIXELS` | `core/fill/floodFill.ts` | 56, 47 |
| `createGradientRecord`, `MIN_GRADIENT_LENGTH` | `core/gradient/gradientRecord.ts` | 41, 16 |
| `PROJECT_VERSION`, `serializeProject`, `parseProject` | `core/project/projectFormat.ts` | 84, 384, 456 |
| `readBrush` (format validation) | `core/project/projectFormat.ts` | ~675 |
| `stampDabs`, `StampDabCursor` (dab plan) | `core/rendering/stampCoverage.ts` | 106, 150 |
| `stampDabCoverage` (per-dab profile) | `core/rendering/stampCoverage.ts` | 218 |
| `StampCoverage` (coverage union, tiles) | `core/rendering/stampCoverage.ts` | 246 |
| `MAX_STAMP_COVERAGE_WORK`, `MIN_STAMP_SPACING_PX` | `core/rendering/stampCoverage.ts` | 39, 32 |
| `extendStampStroke`, `rasterizeStampStroke`, `writeStampCoverage` | `core/rendering/Canvas2DRenderer.ts` | 945, 985, 1020 |
| `Command`, `CommandStack` | `core/commands/types.ts`, `commandStack.ts` | 10, 27 |
| `createMoveStrokesCommand` etc. | `core/commands/strokeEditCommand.ts` | 100+ |
| `Tool`, `ToolContext` | `core/tools/types.ts` | 121, 17 |
| `TOOL_DEFINITIONS`, `findToolByShortcut` | `core/tools/toolDefinitions.ts` | 84, 97 |
| `EditorActions` | `state/editorStore.ts` | 24 |
| `createDocument` | `core/document/document.ts` | 47 |
| `renderDocumentPng` | `core/export/pngExport.ts` | 57 |
| `ProjectFiles` | `core/project/projectFiles.ts` | 43 |

## 6. Docs → section

| Doc | Read |
| --- | --- |
| `docs/SESSION-BRIEF.md` | Whole file once (370 lines) for state, workflow, next slice |
| `docs/ROADMAP.md` | L171-197 ("Next slice"); phase checkboxes only when deciding scope |
| `docs/HANDOFF.md` | §7 toolchain, §8 verification recipes, §9 next move; skip the rest |
| `docs/ARCHITECTURE.md` | `## Rendering pipeline` (141), `### Why a stroke buffer` (186), `### Eraser strokes` (223), `### Shape tools` (309), `### Bucket` (360), `### Gradients` (424), `### Selection` (465), `## Undo / redo` (606), `## Testing` (749) |
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
| Brush settings / capture | `brushSettings.test.ts`, `strokeBuilder.test.ts` |
| Brush spacing / stabilizer | `strokeBuilder.test.ts`, `drawingEngine.test.ts`, `projectFormat.test.ts`, `projectLifecycle.test.ts` |
| Brush texture / grain | `canvas2dStroke.test.ts` (`textureCoverage`), `canvas2dRenderer.test.ts` (pattern pass), `projectFormat.test.ts`, `drawingEngine.test.ts`, `projectLifecycle.test.ts` |
| Stamp (dab) engine | `stampCoverage.test.ts` (dab plan, union, budget), `canvas2dRenderer.test.ts` (stamped pixels, parity), `projectFormat.test.ts` (v9), `drawingEngine.test.ts`, `projectLifecycle.test.ts` |
| Brush hardness / soft edge | `canvas2dStroke.test.ts`, `canvas2dRenderer.test.ts`, `projectFormat.test.ts` |
| Stroke raster | `canvas2dStroke.test.ts` |
| Renderer / layers / compositing | `canvas2dRenderer.test.ts` (grep `it(`) |
| Engine gestures, history, selection | `drawingEngine.test.ts` (grep `it(`) |
| Format | `projectFormat.test.ts` |
| Save/open lifecycle | `projectLifecycle.test.ts`, `projectFiles.test.ts` |
| Bucket fill | `floodFill.test.ts`, `fillCommand.test.ts` |
| Gradients | `gradient.test.ts` |
| Selection math | `strokeSelection.test.ts` |
| Commands | `commandStack.test.ts`, `strokeCommand.test.ts`, `documentCommand.test.ts` |
| Document/layers | `document.test.ts` |
| Viewport/input | `viewport.test.ts`, `pointer.test.ts`, `path.test.ts` |
| Export | `pngExport.test.ts` |
| Misc | `base64`, `color`, `frameScheduler`, `fileMessages` |

## 9. Keep this file useful

- Add a row here when you add, rename or move a file. Do not add prose.
- Line anchors are hints, not contracts. If `rg` disagrees, fix the anchor.
- This is an index, not a second architecture document. The authority is
  `docs/SESSION-BRIEF.md`, `docs/ROADMAP.md` and the code itself.
