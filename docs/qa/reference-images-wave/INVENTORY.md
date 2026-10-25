# Reference images — inventory of the existing groundwork

- Worktree: `D:/Dev/Paka-overnight-worktrees/integration`
- Branch: `integration/reference-images-wave`
- Base: `cf476dc` (release-candidate documentation commit; contains tested source `b7953df`)
- Audit date: 2026-10-23
- Project format at audit time: **v13**

This inventory records what actually exists in the checked-out tree, not what a
branch name or a stale index suggests. Every path below was opened in this
worktree.

---

## 1. Summary

The reference-image feature exists as **four pure core modules and one test
file**. Nothing imports them. There is no engine seam, no renderer pass, no
panel, no tool, no persistence and no export coverage.

`AGENTS.md` is stale for this branch: it documents `paintReferences`,
`setReferenceSource`, `syncReferenceOverlay`, `features/reference/ReferencePanel.tsx`,
`drawingAids.test.ts`, `fillScan.test.ts` and `bucketFill.test.ts`. None of
those symbols or files exist here (`rg` returns 0 matches for the three
symbols; the files are absent from `git ls-files`).

## 2. Capability matrix

| Capability | State | Evidence |
| --- | --- | --- |
| Image format detection (png/jpeg/gif/webp/bmp/avif) | implemented, verified | `src/core/reference/decode.ts` `detectImageFormat`; `src/test/referenceImages.test.ts` "recognises the image formats…" |
| Byte limit (32 MB) and pixel limits (24 MP each / 64 MP session) | implemented, verified | `decode.ts` `MAX_REFERENCE_BYTES`, `MAX_REFERENCE_PIXELS`, `MAX_TOTAL_REFERENCE_PIXELS`; decoder tests |
| Safe decode through `createImageBitmap` | implemented, verified | `decode.ts` `decodeReferenceImage`, `browserDecodeEnvironment`; decoder tests |
| Decode failure taxonomy (`not-an-image`, `too-large`, `unsupported`, `malformed`) | implemented, verified | `decode.ts` `ReferenceDecodeError`; decoder tests |
| Reference identity and placement model | implemented, verified | `src/core/reference/types.ts` `ReferenceImage`; model tests |
| Position / size / opacity math | implemented, verified | `src/core/reference/geometry.ts`; geometry tests |
| Aspect-ratio-preserving scale | implemented, verified | `geometry.ts` `scaleReference`; "keeps its aspect ratio…" |
| Paper clipping and visible-rect math | implemented, verified | `geometry.ts` `referenceVisibleRect`, `referenceScreenRect`; clipping tests |
| Source-pixel sampling (for a future colour picker) | implemented, verified | `geometry.ts` `referenceSourcePoint`; test |
| Session store: list/add/remove/replace/update/reorder/behind/over/budget | implemented, verified | `src/core/reference/store.ts` `ReferenceImageStore`; store tests |
| **Rotation** | **missing** | `ReferenceImage` has no `rotation`; geometry has no rotated rect, hit-test or corner set |
| **Encoded bytes retained for save** | **missing** | `DecodedReference` holds only `width`/`height`/`source`; the store keeps no bytes |
| **Engine ownership (import, select, mutate, history)** | **unwired** | no reference symbol in `DrawingEngine.ts`; no `references` field in `EditorSnapshot` |
| **Document integration** | **missing** | `DrawingDocument` has `guides` but no `references`; the model test even asserts the absence |
| **Renderer paint pass** | **unwired** | `Canvas2DRenderer.render()` paints overlays → document → overlays; no reference call anywhere |
| **Renderer selection chrome** | **missing** | no handle or frame geometry for references |
| **Pointer gestures (move/resize/rotate/cancel)** | **missing** | no reference tool in `core/tools/`; `ToolId` has no `reference` |
| **Undo/redo** | **missing** | no reference command; `createDocumentCommand` is the natural host once references are document state |
| **Panel / import entry point** | **missing** | no `features/reference/`; no panel id |
| **Persistence and migration** | **missing** | `PROJECT_VERSION = 13`; `SerializedProject` has `document.guides` only |
| **Export isolation** | **missing (nothing to isolate)** | `composeDocumentImage()` calls `paintDocument(ctx)`; no reference path exists, so there is no test proving references stay out |
| **Browser interaction coverage** | **missing** | no `tests/visual/reference*` |

## 3. Reusable pieces

- `ReferenceImageStore` already enforces the session pixel budget and keeps one
  decoded copy per reference. It is the right owner of decoded surfaces, but it
  currently owns neither the encoded bytes nor the document placement of record.
- `geometry.ts` is pure and already viewport-aware only in its derived screen
  rect. Rotation must be added there, not in React.
- `decode.ts` already refuses non-images before decoding and bounds memory
  before allocating. Import must call it, not re-implement it.
- `createDocumentCommand` (`src/core/commands/documentCommand.ts`) stores two
  document states and is already used for guide gestures. Once references are
  document metadata, a reference gesture gets one coherent history entry for
  free, with `preserveActiveLayer` and `mergeKey` support.
- `Canvas2DRenderer.paintDocument` already separates paper fill from the layer
  walk, which is exactly the seam needed for "behind" references.

## 4. Boundaries and invariants found in the code

### Rendering

- `render()` is the only display path. `composeDocumentImage()` is the export
  path and calls `paintDocument(ctx)` directly. Any reference paint must be
  reachable **only** from `render()`, so export isolation is structural rather
  than a flag someone can forget.
- The overlay registry (`src/core/shell/overlayRegistry.ts`) is module-global.
  Reference state is per-engine and per-document, so references must not use a
  registered overlay; the renderer needs a per-instance seam.
- The paper fill is opaque, so a "behind" reference must be painted after the
  paper fill and before the layer walk.

### Pointer ownership

- The engine routes every sample to exactly one active tool
  (`handlePointerSample`). A dedicated `reference` tool keeps ownership
  unambiguous: the brush never has to guess whether a press is a paint or a
  reference grab.
- Cancellation is a first-class path: `onPointerCancel`, `Esc` via the action
  registry, and `setTool` resetting the outgoing tool. A reference gesture must
  restore the pre-gesture document and create no history entry.

### History and dirty state

- `commitDocumentChange` → `createDocumentCommand` snapshots document identity.
  Reference mutations that go through it are undoable and dirty the document,
  which is correct because references are saved with the document.
- View-only state (selected reference id, in-flight gesture) must stay out of
  the document and out of the serializer.

### Persistence

- `parseProject` is strict and version-gated (`maxVersion` defaults to
  `PROJECT_VERSION`). Version 13 already uses the "field requires version N"
  pattern for groups (`readLayerKind`).
- `serializeProject(document, strokes)` writes only the document and the layer
  tree. A reference payload needs a deliberate place in that schema.
- The file gateway has no binary read; text is read with a 256 MB cap. Base64
  inside the JSON project is therefore the only path that needs no new native
  command.

## 5. Required design decisions (taken before implementation)

1. **References become document metadata**, next to `guides`. They are saved,
   so they are document state; keeping them in a side store would need a second
   history stack and a second serializer. They remain **not** layer elements and
   **not** rasterized content.
2. **Rotation is added to the model** (`rotation`, degrees clockwise about the
   centre) with rotated geometry in the pure module.
3. **Format v14** adds a top-level `document.references` array carrying the
   placement plus the original encoded bytes as base64. A v13 file opens with
   no references; a file that claims v13 but carries references is refused (the
   same rule groups already use); a v14 file is refused by older builds through
   the existing version gate. The bump is justified because silently ignoring
   the field would let an older build re-save the project and drop the user's
   references.
4. **Import uses the webview file input** (`<input type="file">` +
   `File.arrayBuffer()`), not a new native command. It works in the dev server,
   in the packaged app, and under Playwright `setInputFiles`, and it adds no
   dependency and no filesystem scope. The trade-off (the webview reads the
   file the user picked) is documented in the report.
5. **Export isolation is structural**: reference painting is reachable only
   from `render()`, never from `paintDocument`'s default path used by
   `composeDocumentImage()`. A pixel test proves it.

## 6. Deliberately not in scope

Text/vector tools, pixel-mask selection, canvas resize/crop, multi-document
tabs, secondary views, clipping/adjustment layers, a new design system, general
performance work, and unrelated fixes.
