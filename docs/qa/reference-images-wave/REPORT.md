# Reference images — implementation report

**Branch:** `integration/reference-images-wave`
**Started from:** `cf476dc` (the verified release candidate), audit committed as `6125712`
**Final commit:** the commit that adds this file (see `git log --oneline`; the
code is `71fafdc`, plus the test commit `d5c53b1`)
**Verdict:** the workflow is implemented and verified end to end. Unit tests,
the visual suite, the production build, the packaged Windows build and a
packaged-window smoke test all pass on the final commit.

---

## 1. What shipped

An artist can now import a picture as a reference, place it, and keep it beside
the drawing without it ever becoming part of the artwork:

| Capability | State |
| --- | --- |
| Import (PNG, JPEG, GIF, WebP, BMP, AVIF) through the panel's file input | implemented |
| A reference is visibly distinct from a layer: its own panel, its own tool, its own frame | implemented |
| Select, hide, show, remove, rename | implemented |
| Move, proportional resize from a corner, rotate from the handle, rotate from a slider | implemented |
| Opacity, behind-the-artwork toggle | implemented |
| Cancel a drag with `Esc`; one undo step per gesture; one per slider run | implemented |
| Save and reopen with the picture embedded in the project file | implemented (format v14) |
| References never reach a PNG export; their handles never enter a layer | implemented and proven at the pixel level |
| One coherent history entry per edit, shared with strokes and layers | implemented |

The panel is the **References** tab in the right dock (order 15, between Layers
and Navigator), and the **Reference** tool sits in the *Assist* group with the
guides (`Y`).

## 2. Commits

| SHA | What |
| --- | --- |
| `cf476dc` | starting point: the verified release candidate |
| `6125712` | `docs(qa): inventory the reference-image groundwork` — the audit, committed before any code |
| `ab4014d` | `feat(reference): a complete reference-image workflow` — model, format v14, engine, tool, renderer, panel, tests, harness scene, docs |
| `9ca1141` | `fix(reference): show no chrome or handle for a hidden reference` — a defect found by the packaged smoke |
| `71fafdc` | `test(qa): drive the reference workflow in the packaged application` — the smoke script and its evidence |
| `d5c53b1` | `test(reference): keep a new document free of the old references` |
| this commit | `docs(qa): report the reference-image wave` |

Every commit was pushed to `integration/reference-images-wave`. `main` was not
touched, `origin/main` was not merged, and no other worktree was modified.

## 3. The design, in one page

**References are document metadata, not artwork.** `DrawingDocument.references`
sits beside `guides`. That one decision buys undo, redo, dirty-state, save and
reopen from the existing `createDocumentCommand` path instead of a parallel
system, and it makes "the references belong to the drawing" true by
construction.

**Decoded pictures are session state.** A `ReferenceImage` stores placement and
the **original encoded bytes**; the decoded `ImageBitmap` lives in a store keyed
by id (`core/reference/store.ts`). The document is the authority for *which*
references exist; `sync()` reconciles the store on every document change, and
`decodeMissingReferenceSources()` rebuilds a picture after an undo of a removal
or a reopen. A reference whose picture has not decoded yet is simply not
painted; it is never an error.

**Geometry is pure and rotation-aware.** `core/reference/geometry.ts` holds the
rectangle, the centre, the corners, the hit-test, the source-pixel mapping, the
resize-from-corner and the clamp rules. A hit-test rotates the point back by
`-rotation` before comparing, so a turned reference is grabbable where it is
drawn rather than where its bounding box is. Handles are screen-space (8 CSS px
grab radius, rotation handle 26 CSS px above the top edge), so they are equally
easy to grab at any zoom.

**One tool owns the pointer.** The Reference tool has three gestures chosen by
what the press grabs: a handle resizes or rotates, a visible reference selects
and moves, empty canvas clears. The brush never has to guess whether a press is
a paint or a grab. The engine owns the preview and the history: a gesture
mutates the document directly (that is how the renderer shows it), the release
commits **one** document command, and a cancel restores the press-time document
and records nothing.

**Export isolation is structural.** `paintDocument(ctx, preview,
includeReferences)` paints `behind` references after the paper fill and the rest
after the layers — but only `render()` passes `true`. `composeDocumentImage()`
never does, so the export path has no reference to forget. The selection frame
and handles are painted in the overlay pass, after the document, so they cannot
enter a layer surface either.

## 4. Project format: version 14

`PROJECT_VERSION` moved from 13 to 14. This is the smallest change that is
honest:

- `document.references` is a new **required-from-14** array. Each entry carries
  `id`, `name`, `x`, `y`, `width`, `height`, `naturalWidth`, `naturalHeight`,
  `rotation`, `opacity`, `blendMode`, `behind`, `visible`, `mimeType` and
  `data` (the original encoded bytes, base64).
- A **version-13 file** has no field and opens with `references: []`, exactly as
  it was written.
- A file that **claims a version below 14 and carries a non-empty reference
  list** is refused: the claim is inconsistent with the contents. An *empty*
  list under an older version is tolerated, because a newer serializer writes
  the field unconditionally.
- An **older build** refuses v14 through the existing version gate
  ("created by a newer version of Paka") instead of opening the file and
  silently dropping the tracing setup.
- **Limits**, enforced by the reader: 32 MB of encoded bytes and 24 megapixels
  per reference, 32 references and 64 megapixels of reference pixels per
  project. The base64 text is bounded **before** it is decoded, so a hostile
  string cannot make the reader allocate what it claims.
- Malformed input is refused with a message, not a crash: missing picture,
  unknown MIME type, invalid base64, duplicate id, unknown blend mode.

Why the bump was unavoidable: the field carries the pictures themselves, so it
is a required new shape rather than an ignorable extra, and a v13 reader would
open the file with every reference missing.

`docs/PROJECT_FORMAT.md` gained the `references[]` section, the version-14
rationale, the export-isolation note and a known gap (pictures are stored
verbatim, so importing the same file twice stores it twice).

## 5. Verification

Run on the final code commit, in this order:

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm test` | **98 files, 2449 tests passed** |
| `pnpm test:visual` | **83 tests passed** (22 scenes, plus the shell/panel/rail specs) |
| `pnpm build` | clean; `dist/assets/index-NpFh9J14.js` 579.80 kB (172.34 kB gzip), CSS 46.34 kB |
| `pnpm tauri build` | clean; `paka.exe` and both bundles produced |

Reference-specific suites:

| File | Tests | What it pins |
| --- | --- | --- |
| `src/test/referenceManipulation.test.ts` | 36 | import, centred placement, oversized fit, refused decode, undo/redo, selection, move/resize/rotate gestures, cancel, one-step-per-run sliders, hide/show/remove/rename, hidden handle refusal, a new document dropping the list, save → reopen from embedded bytes, a v13 file |
| `src/test/referenceRendering.test.ts` | 13 | paint order around the layers, the paper clip, rotation about the centre, opacity and blend mode, hidden and undecoded pictures, the selection frame, hidden chrome, export isolation |
| `src/test/referenceFormat.test.ts` | 17 | the v14 round trip, the byte/pixel/count ceilings, the malformed entries, the mis-versioned file |
| `src/test/referenceImages.test.ts` | 48 | the decode taxonomy, the store's one-copy-per-id and budget, the sampling and the geometry (pre-existing, extended) |

Existing suites were updated where the workflow changes shared state: the tool
list and rail, the action routing (`Esc`, `Delete`), the panel catalogue (5 dock
tabs), and the recording renderer stub.

### 5.1 Export isolation, proven by pixels

Two independent proofs:

1. **Structural, in Node.** `referenceRendering.test.ts` renders a document
   with and without references (behind, over, rotated, hidden) and asserts the
   `composeDocumentImage()` trace is identical — no reference draw, no selection
   chrome.
2. **In a real browser.** The visual harness gained a `references` scene (one
   reference behind the artwork, one rotated over it) and a
   `referencesNotExported` verdict. The harness exports the same document with
   and without the references and compares the two exports pixel by pixel; the
   verdict is `true` only when the difference is **zero**. The display golden
   (`references-display-win32.png`) and the export golden
   (`references-win32.png`) are two different pictures — the reference is
   visible on one and absent from the other.

### 5.2 Save and reopen, proven without the original file

`referenceManipulation.test.ts` imports a picture, rotates and fades it,
serializes the project, parses it, loads it into a **fresh engine** and checks
that:

- the placement, rotation, opacity and name come back;
- the decoder is called exactly once, with the **bytes from the project** — the
  original file is never consulted;
- the decoded picture reaches the renderer once it is ready;
- saving the reopened project writes the same reference again.

A separate test opens a version-13 payload with no `references` field and
confirms the document opens with no references and no hit-test target.

## 6. Packaged Windows build and smoke test

`pnpm tauri build` produced (Windows x64, unsigned):

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| `src-tauri/target/release/paka.exe` | 3,593,728 | `AC4637822C11410D4993CF505E3F44B190E82FB2CDABDB4E0BF0436E6704122C` |
| `.../bundle/msi/Paka_0.1.0_x64_en-US.msi` | 2,048,000 | `C0D8D3F851563B8CF6157E6FAFA7947692BD2AAB515C1026AA513DA5362B8F37` |
| `.../bundle/nsis/Paka_0.1.0_x64-setup.exe` | 1,470,972 | `BF8D6F45298DD182590E607EFF8A47E1A3674B9D035815E1543768264EA9C88E` |

The linker still warns `ld.exe: .rsrc merge failure: multiple non-default
manifests` (pre-existing, non-fatal).

The executable embeds the production bundle `index-NpFh9J14.js` (verified by
searching the binary), which is the bundle built from the code of `71fafdc`.
The commits after the packaged build touch only tests and documentation, so the
smoke below ran against the code this report describes.

**Method.** `paka.exe` was started with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"` and
driven with Playwright `chromium.connectOverCDP`. The page reported WebView2
`Edg/155.0.4283.60`. `scripts/packaged-reference-step.mjs` performed the
workflow and compared the **canvas screenshots byte for byte** between steps.
Log: `docs/qa/reference-images-wave/packaged/packaged-reference-smoke.json`.

| Check | Result |
| --- | --- |
| Dock tabs | `Color, Brushes, References, Navigator, Shortcuts` |
| Import a real PNG through the panel's file input | 1 row, `reference-fixture.png`, `over artwork · 0°`, no error message |
| Import marks the document unsaved and enters history | yes |
| Import hands the tool over | active tool `Reference` |
| Drag from the middle of the paper | canvas pixels changed |
| One `Ctrl+Z` | canvas **byte-identical** to the imported picture |
| `Ctrl+Shift+Z` | canvas **byte-identical** to the moved picture |
| Hide the reference | canvas **byte-identical** to the empty artwork |
| Show it again | canvas **byte-identical** to the moved picture |
| Rotation slider to 30° | readout `30°`, canvas changed |
| Remove, then undo, then reselect | canvas **byte-identical** to the pre-removal picture |
| Status bar at the end | `unsaved`, `history 4`, `zoom 49%` |
| Console/page errors | none |

The window screenshot is `packaged/paka-window.png`.

### 6.1 What the packaged smoke does not cover

The native open/save/export dialogs are Win32 windows the DevTools protocol
cannot address. This smoke therefore **never presses `Ctrl+S`/`Ctrl+O` and never
opens a modal dialog**, so it cannot leave one on the desktop. Save/reopen and
export isolation in the packaged binary are covered by the suites in §5.1 and
§5.2 instead — the same serializer, reader, engine and renderer the packaged
build links.

Also not covered here: installing the MSI/NSIS bundles and uninstalling them.

## 7. Defect found and fixed during the wave

**A hidden selected reference left its chrome behind.** Hiding a reference kept
its frame, four corner handles and rotation handle floating over the artwork,
and `findReferenceHandleAt` still grabbed them, so a press could resize a
picture the user could not see. Fixed in `9ca1141`: `paintReferenceSelection`
returns early for an invisible reference and the engine's handle hit-test
returns `null`. Two tests pin it (renderer trace, engine seam), and the packaged
smoke's `hideMatchesEmptyArtwork` check is the pixel proof.

## 8. Implemented vs deferred

**Implemented** — everything in §1, plus:

- `Esc` cancels a reference drag (before the general selection clear) and
  `Delete` removes the selected reference, routed through the shared action
  registry.
- Import switches to the Reference tool and selects the new reference.
- The panel's controls coalesce a slider run into one history step, and a
  selection change breaks the run — the same rule as the layer opacity.
- The session store enforces the decode budget on add and releases pixels on
  remove, undo and document replacement.
- The document's reference list survives `loadProject`, a new document and a
  document replacement without leaking decoded pixels.

**Deliberately not in scope** (unchanged from the inventory): text and vector
tools, pixel-mask selection, canvas resize/crop, multi-document tabs, secondary
views, clipping/adjustment layers, a new design system, general performance
work, unrelated fixes.

**Deferred within the feature:**

- Dragging a reference between two documents is not possible (there is one
  document per window in this build).
- No colour-pick-from-reference button in the panel, although
  `referenceSourcePoint` exists and is tested; the existing picker samples the
  composite.
- No thumbnail in the panel row: the row shows the name, the side and the
  rotation.
- No lock flag; a reference is always draggable while the Reference tool is
  active.

## 9. Limitations and open owner decisions

- **Reference pictures are stored verbatim.** A 12 MB photograph adds about
  16 MB of base64 to every save, and importing the same file twice stores it
  twice. Deduplication or a re-encode step would be a format decision, not a
  bug fix.
- **The project text read cap is 256 MB** (`project_io.rs`). A project with
  many large references can approach it; the per-project reference ceiling
  (64 MP) is the guard that matters in practice.
- **The build is unsigned.** Windows SmartScreen will warn on first run.
- **The native save/open/export dialogs remain outside automated reach**, as in
  the previous wave. If the owner wants them automated, the honest route is a
  test-only file gateway, not synthetic keystrokes.

## 10. Reproduce

```powershell
cd D:\Dev\Paka-overnight-worktrees\integration
pnpm typecheck
pnpm test
pnpm test:visual
pnpm build
pnpm tauri build

# packaged smoke (the caller owns the process)
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
Start-Process src-tauri/target/release/paka.exe
node scripts/packaged-reference-step.mjs docs/qa/reference-images-wave/packaged
Stop-Process -Name paka
```

The fixture PNG is generated by the packaged WebView itself and written to
`docs/qa/reference-images-wave/packaged/reference-fixture.png`, so the smoke
never depends on a checked-in binary.
