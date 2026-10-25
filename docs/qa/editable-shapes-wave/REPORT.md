# Editable shapes — implementation report

**Branch:** `integration/editable-shapes-wave`
**Started from:** `e393b53` (the verified reference-image wave); the audit is
`8d0d626`
**Final code commit:** `3431936`; the packaged smoke and its evidence are
`36ba617`; this report is the last commit
**Verdict:** the workflow is implemented and verified end to end. Typecheck, the
unit suite, the visual suite, the production build, the packaged Windows build
and a packaged-window smoke test all pass on the final code commit.

---

## 1. What shipped

An artist can now draw a line, rectangle, ellipse, polygon or star and keep it
as an editable object for the rest of the drawing's life:

| Capability | State |
| --- | --- |
| Create all five primitives with the live preview, Shift constrain and Alt draw-from-centre | implemented, unchanged from the old tool |
| The committed object is a **native shape**: the primitive, its geometry and its brush, never samples | implemented (format v15) |
| Reselect a shape by clicking it | implemented (Shape edit tool) |
| Move, resize from a corner, rotate from the handle | implemented |
| Delete, deselect, cancel a gesture | implemented |
| Edit rectangle/ellipse width and height, rotation, polygon sides, star points and inner radius | implemented |
| Edit fill, colour, stroke width and opacity | implemented |
| One history entry per creation, per gesture and per slider run; exact undo/redo | implemented |
| Save and reopen preserve the shape's identity and geometry | implemented and proven at the pixel level |
| Layers, groups, visibility, opacity, z-order, reorder, duplicate | unchanged; shapes travel the existing paths |
| Symmetry copies are native shapes, inserted after the original, one history step | implemented |
| The selection overlay never reaches a PNG export; references stay out too | implemented and proven at the pixel level |
| A version-13/14 file of baked shapes opens unchanged and is never converted | implemented and proven in the packaged app |

The **Shape edit** tool (`V`) sits in the existing *Select & transform* rail
group. The stroke marquee selection stays stroke-only: it is a different
selection model, and changing it was not part of this wave (see §8).

## 2. Commits

| SHA | What |
| --- | --- |
| `e393b53` | starting point: the verified reference-image wave |
| `8d0d626` | `docs(qa): inventory the editable-shape pipeline` — the audit, committed before any code |
| `d4bbe40` | `feat(shapes): add the native shape record, geometry and v15 format` |
| `bc6cfba` | `feat(shapes): commit, select, transform and edit shapes in the engine` |
| `28a3cd6` | `test(shapes): cover records, format, editing, rendering and options` |
| `d786470` | `docs(format): document version 15 and native shapes` |
| `99cb74c` | `test(visual): pin the shape scenes' exported pixels` |
| `3431936` | `fix(shapes): let Escape discard an unreleased shape press` |
| `36ba617` | `test(packaged): smoke the editable-shape workflow in the packaged app` |
| this commit | `docs(qa): report the editable-shapes wave` |

Every commit was pushed to `integration/editable-shapes-wave` only. `main` was
not touched, `origin/main` was not merged, and no other worktree was modified.

## 3. The design, in one page

**A shape is its primitive, not its pixels.** `ShapeRecord` is a new
layer-element kind:

```ts
{ id, layerId, kind: "shape", geometry: ShapeGeometry, brush: BrushSettings, fill: boolean }
```

`geometry` is a discriminated union: a line keeps its two endpoints, and a box
shape keeps `x, y, width, height, rotation, sides, innerRatio`. The `shape`
field is the identity. A rectangle and a hand-drawn closed loop are no longer
the same record, and nothing ever guesses a primitive back out of samples.

**One derivation feeds preview, commit, reopen and export.** The refactor split
`shapeGeometry.ts` into `shapeSpecFromDrag(kind, drag, options)` (a drag plus
the options → a spec) and `shapeGeometryOutline(geometry)` (a spec → the
outline). The old `shapeOutline` delegates to them. The tool previews the same
outline the engine commits, the renderer rebuilds and the export rasterizes, so
there is no second geometry path to drift.

**The renderer reuses the stroke rasterizer.** `strokeFromShape(shape)` expands
a native shape to a derived `StrokeRecord` of the same outline and the same
brush, and the existing `rasterizeStrokeToBuffer` / `compositeStrokeBuffer`
draw it. Appearance is preserved exactly — fill, colour, width, opacity,
hardness, texture and tip are the shape's own brush — and legacy strokes keep
their old records and therefore their old pixels. No appearance rule changed.

**Creation commits geometry on release.** The press builds the temporary
preview stroke as before. On release the engine discards the preview, inserts a
`ShapeRecord` at the painting index and records one command; the preview was
never composited, so no stray pixels or history remain. A cancel, a tool switch,
a lost capture or `Esc` discards the preview and records nothing.

**One tool owns the shape pointer.** The Shape edit tool chooses its gesture by
what the press hits: a handle resizes or rotates, a shape selects and moves,
empty canvas clears. The hit-test is on the active paintable layer, topmost
first, with a grab tolerance of `max(brush.size / 2, screen radius)`. A gesture
previews by replacing the record in the store (that is how the renderer shows
it), and the release records one edit command; a cancel restores the press-time
record with no history.

**The overlay is display-only.** The frame, accent outline and handles reuse
`RendererSelection`; they are painted in the overlay pass and are never part of
a layer surface, the document model or the project file.

## 4. Project format: version 15

`PROJECT_VERSION` moved from 14 to 15. The audit proved a bump was required: a
native shape is a new element kind, and a v14 reader cannot represent it. The
alternative — writing a shape as a baked stroke — throws away the identity this
wave exists to preserve.

- `layers[].elements[]` gains `{ kind: "shape", id, geometry, brush, fill }`.
- `geometry.shape` is `"line" | "rectangle" | "ellipse" | "polygon" | "star"`.
  A line carries `x1, y1, x2, y2` (endpoints, so reversing the drag cannot
  reverse a reopened line). A box shape carries `x, y, width, height, rotation`
  and, for polygon/star, `sides` and `innerRatio`.
- `brush` is read by the existing `readBrush`, so every brush field is
  validated exactly as for a stroke; `stamp` is forced off, because a shape is
  an outline and not a chain of dabs.
- `fill` is the existing appearance flag, moved onto the shape record. A
  missing `fill` reads as `false`.
- **Validation:** finite coordinates, non-negative width/height, `sides` an
  integer in the supported range, `innerRatio` in the supported range, a known
  primitive name, a known `kind`. Malformed shapes fail the file with a message.
- **Version rules:** `kind: "shape"` is accepted from version 15 on. A file that
  claims an older version and carries a shape is refused as inconsistent. A
  version-13/14 file has no shapes and opens unchanged; its baked shapes stay
  `StrokeRecord`s and are never converted. An older build refuses a v15 file
  through the existing "created by a newer version" gate instead of silently
  dropping the shapes.
- **Nothing transient is serialized:** no selection, handles, hover or preview.
  The packaged smoke checks the saved JSON for those words.

`docs/PROJECT_FORMAT.md` gained the `Shapes` schema (per-kind geometry),
the validation rules, the versioning rows for 14 and 15, and the rationale for
why a native shape cannot be an additive field.

## 5. Verification

Run on the final code commit `3431936`, in this order:

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | exit 0, clean |
| `pnpm test` | exit 0 — **103 files, 2562 tests passed** |
| `pnpm test:visual` | exit 0 — **87 passed** (51.9 s) |
| `pnpm build` | exit 0; one warning: a chunk over 500 kB |
| `pnpm tauri build` | exit 0; `paka.exe` and both bundles produced |

The Tauri build keeps the pre-existing linker warning
`ld.exe: .rsrc merge failure: multiple non-default manifests` (non-fatal).

No gate reported a failure, and no test was skipped: the unit run reports
`103 passed (103)` files and `2562 passed (2562)` tests, and the visual run
reports `87 passed`. The unverified areas are the ones listed in §6.1.

Shape-specific suites:

| File | Tests | What it pins |
| --- | --- | --- |
| `src/test/shapeRecord.test.ts` | 39 | the record model, the transforms, the hit-test, equality and the brush patch |
| `src/test/shapeFormat.test.ts` | 21 | the v15 round trip, per-kind validation, a mis-versioned shape, v13/v14 files, the lenient `fill` |
| `src/test/shapeEditing.test.ts` | 31 | creation of all five kinds, the preview/commit outline, modifiers, a click that never moved and a press outside the paper, select/move/resize/rotate, parameter edits, cancel/lost capture/tool switch, `Esc`, one step per edit, undo/redo, layers, groups, a hidden layer, save/reopen |
| `src/test/shapeToolOptions.test.ts` | 12 | the fields each primitive shows and that every control writes the real record |
| `src/test/shapeRendering.test.ts` | 9 | the expansion, preview vs committed vs reopened vs export, the overlay, legacy strokes |

Existing suites were updated where the workflow touches shared state:
`drawingEngine.test.ts` (the shape block), `actions.test.ts` (Escape/Delete),
`toolRail.test.ts`, `brushSettings.test.ts`, `fillCommand.test.ts`,
`gradient.test.ts`, `gridSnapping.test.ts`, `projectFormat.test.ts`,
`referenceFormat.test.ts`, plus the visual harness and its scenes.

### 5.1 Preview, committed pixels and export agree

Three independent proofs:

1. **Unit.** `shapeRendering.test.ts` renders the same shape from the tool
   outline, the committed record, a reopened record and `composeDocumentImage()`
   and compares the surfaces; the overlay pass is traced and asserted absent
   from the export.
2. **Visual.** `tests/visual/shape-editing.spec.ts` has two verdicts: *every
   primitive exports the picture its geometry describes*, and *a rotated box is
   turned rigidly, not stretched into its bounding box*. The scenes
   `shape-primitives` and `shape-rotation` have committed win32 goldens.
3. **Packaged.** The smoke exports with a shape selected and a reference
   present, then exports the same document with the selection cleared. Both
   files are 1600 × 1200; the first contains 147,942 non-paper pixels, **zero**
   selection-accent pixels (`#2f7bff`) and **zero** reference (magenta fixture)
   pixels; the two exports are pixel-identical.

### 5.2 Save and reopen preserve identity and geometry

`shapeFormat.test.ts` serializes, parses and loads a project into a fresh
engine; the five primitives come back as the same `kind: "shape"` records with
their geometry, brush and fill. The packaged smoke adds the end-to-end proof:

- the saved file is version 15 and its element kinds are
  `shape, shape, shape, shape, shape` in the order `line, rectangle, ellipse,
  polygon, star`;
- the saved rectangle is at `(450, 140)`, `200 × 160`, rotated `45°`, filled,
  `#ff0000`, stroke 12, opacity 0.5, `stamp: false`;
- reopening restores the canvas **byte for byte**, reopens with `history 5`, is
  clean, and re-reads the same width, height, rotation, fill, colour, stroke and
  opacity from the reopened record.

### 5.3 Legacy files are not converted

The packaged smoke rewrites the saved project into a valid version-14 file with
one baked, filled stroke and opens it. It renders, it opens with `history 1`,
the file on disk is not rewritten, and with the Shape edit tool active the
options bar shows only its hint — no shape fields — so the baked stroke was not
turned into a native shape. A version-14 file with a shape element is refused
by `shapeFormat.test.ts`, and the same test covers version-13 input.

## 6. Packaged Windows build and smoke test

`pnpm tauri build` produced (Windows x64, unsigned), from the code of
`3431936`:

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| `src-tauri/target/release/paka.exe` | 3,597,312 | `C059FD985A51C41CE6D67BDCE9EE6F77B9F0EC5159D3B5AB936978FA467C577D` |
| `.../bundle/msi/Paka_0.1.0_x64_en-US.msi` | 2,052,096 | `AD3B864A30FF82AB1BD69DCECD1D79BE78F301C242C79EF334E869D6A5A987AA` |
| `.../bundle/nsis/Paka_0.1.0_x64-setup.exe` | 1,474,505 | `AC2FCA1E7102BD9A4685BBA39546B0CC36C12942B4D897A578236A332C993FBE` |

Earlier artifacts were preserved before each build, not overwritten:

| Build | Artifact | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `e393b53` baseline | `paka.exe` | 3,593,728 | `AC4637822C11410D4993CF505E3F44B190E82FB2CDABDB4E0BF0436E6704122C` |
| | `Paka_0.1.0_x64_en-US.msi` | 2,048,000 | `C0D8D3F851563B8CF6157E6FAFA7947692BD2AAB515C1026AA513DA5362B8F37` |
| | `Paka_0.1.0_x64-setup.exe` | 1,470,972 | `BF8D6F45298DD182590E607EFF8A47E1A3674B9D035815E1543768264EA9C88E` |
| `99cb74c` | `paka.exe` | 3,597,312 | `E7A216AA8ED206CE177478A5D051EB4D65039922A0496EC42764F305EFE71463` |
| | `Paka_0.1.0_x64_en-US.msi` | 2,052,096 | `BC352823B8A77860DF133EBE3AD314D0AF400F2C8E76F6D430A6092DB6154C0F` |
| | `Paka_0.1.0_x64-setup.exe` | 1,474,919 | `AB2B4516123CC8E93C8123D5BC7B4472BAD377E55D85EE05619340A74AAD338A` |

The baseline is at
`C:\Users\aissa\AppData\Local\Temp\opencode\paka-preserve-e393b53\` and the
`99cb74c` build at `…\paka-preserve-99cb74c\`. The final executable and the
`99cb74c` one have the same size but different hashes: `3431936` adds the
Escape fix.

**Method.** `paka.exe` was started with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"` and
driven with Playwright `chromium.connectOverCDP`.
`scripts/packaged-shapes-step.mjs` performs the workflow and writes the log and
the numbered captures into `docs/qa/editable-shapes-wave/packaged/`.

Two harness facts are worth recording:

- **The two native pickers are answered at the IPC fetch layer.** The window's
  `__TAURI_INTERNALS__.invoke` is non-writable and non-configurable, so it
  cannot be stubbed. The transport is a `fetch` to
  `http://ipc.localhost/<command>`; the script routes only
  `plugin:dialog|save` and `plugin:dialog|open` and answers them with a 200 and
  a `Tauri-Response: ok` header. Every other command — including the real
  `write_text_file_atomic`, `read_text_file` and the window commands — still
  runs in the packaged app and the Rust side. The serialization, the bytes and
  the files are real.
- **Captures are read from the canvas with `toDataURL`.** Taking an element
  screenshot makes the browser dispatch pointer events (including a
  pointer-leave), which cancels an in-flight shape gesture. The first version of
  this smoke therefore reported no preview and no commit; the fault was the
  harness, not the app. Reading the backing store inside the page leaves the
  input state alone, and the preview is now observed mid-drag.

| Check | Result |
| --- | --- |
| Fit zoom | `zoom 49%`, agrees with the computed fit |
| Fresh document | `history 0`, clean, the paper has zero non-white pixels |
| Five creations | each changed the canvas and added exactly one step (`history 1…5`) |
| In-flight preview | visible mid-drag (`02-preview-in-flight.png`), and the release after `Esc` committed nothing; `history` stayed 5 |
| Fields per primitive | rectangle/ellipse: Fill, Rotation, Width, Height, Color, Stroke, Opacity; polygon adds Sides; star adds Points and Inner radius; line: Color, Stroke, Opacity |
| Selecting | not an edit (`history 5`) |
| Move | one step (`history 6`), pixels changed, undo/redo restore exactly |
| Resize | one step (`history 7`), `270 × 160`, undo/redo exact |
| Rotate | one step (`history 8`), `30°`, undo/redo exact |
| Width field | one step (`history 9`), `200 × 160` (height kept) |
| Rotation field | one step (`history 10`), `45°` |
| Fill off | one step (`history 11`), undo restores the filled pixels and the checkbox |
| Colour | one step (`history 11`), `#ff0000` |
| Stroke | one step (`history 12`), `12` |
| Opacity | one step (`history 13`), `0.5` |
| Polygon sides | one step (`history 14`), `7` |
| Star inner radius | one step (`history 15`), `0.4` |
| Delete | one step (`history 16`); undo restores the shape and the fields (`history 15`) |
| Save | version 15, five `kind: "shape"` elements in creation order; no transient keys |
| Reopen | canvas **byte-identical**, `history 5`, clean, geometry and appearance re-read |
| Reference import | canvas changed, the reference is visible |
| Export | 1600 × 1200, 147,942 artwork pixels, 0 accent pixels, 0 reference pixels; the two exports are pixel-identical |
| Reference removal | one step (`history 7`), the artwork comes back exactly |
| Layer hide | one step (`history 8`), the paper has zero ink; undo restores the artwork |
| Legacy v14 | opens, renders, `history 1`, the file is untouched, no shape fields, hint shown |
| Console/page errors | none |

The window screenshot is `packaged/paka-window.png`; the full log is
`packaged/packaged-shapes-smoke.json`.

### 6.1 What the packaged smoke does not cover

- The two native dialogs are answered at the IPC layer, not clicked. The
  packaged serializer, the Rust commands and the bytes are exercised; the Win32
  picker UI is not.
- Installing and uninstalling the MSI/NSIS bundles is not exercised.
- A second window, a DPI change and a maximised/restored window are not part of
  this smoke.
- Lost pointer capture and a tool switch mid-gesture are covered by
  `shapeEditing.test.ts`; the DevTools protocol cannot revoke a capture the way
  a native pointer loss does.

## 7. Defects found and fixed during the wave

**Escape did not cancel an unreleased shape press.** The shape tools place
nothing until the release, so `Esc` should throw the preview away. It instead
fell through to the general selection clear while the preview stayed on the
canvas, and the still-captured pointer could revive it. Fixed in `3431936`: the
engine tracks the press, `cancelShapeCreation()` resets the tool, discards the
preview and reports whether it cancelled, and the `Esc` action only clears the
selection when no shape press was cancelled. Two tests pin it (the engine seam
and the action routing), and the packaged smoke observes the preview, presses
`Esc`, and proves the canvas returns to its pre-press pixels with no new
history.

No other product defect was found in this wave. The missing-preview observation
during the smoke was a harness artefact (§6).

## 8. Implemented vs deferred

**Implemented** — everything in §1, plus:

- The compact shape editor is registered through the existing tool-options
  contract; each field has a `visible` predicate per primitive, so a line never
  shows Width, and only a star shows Inner radius.
- Appearance edits patch named brush fields and re-apply `shapeBrush` (stamp
  forced off), so an edit can never turn a shape into a chain of dabs. The
  merge key names the patched fields: a slider run coalesces into one step,
  while changing a different field starts a new one.
- Symmetry copies are native shapes inserted after the original, in one step.
- `Esc` cancels an unreleased shape; `Delete` removes the selected shape;
  both go through the shared action registry.
- The hit-test tolerance is `max(brush.size / 2, screen grab radius)`, so a
  thin line is still grabbable when zoomed out.

**Deliberately not in scope** (unchanged from the inventory): text and vector
path tools, pixel-mask selection, canvas resize/crop, multi-document tabs,
secondary views, adjustment/clipping layers, a new design system, general
performance work, unrelated fixes.

**Deferred within the feature:**

- The shape editor selects on the **active paintable layer only**, the same
  boundary as the existing select tool. Clicking a shape on another layer is not
  a cross-layer selection.
- The marquee/lasso selection remains stroke-only; a mixed selection of shapes
  and strokes is not a shape-editing selection. A shape-aware marquee would be a
  new selection model.
- No primitive-kind conversion (a star cannot become a rectangle): there is no
  deterministic rule for the parameters.
- A rotated box's handles work in its local frame; there is no separate skew or
  non-uniform scale along an arbitrary axis.
- Hardness, texture, tip and pressure curves are preserved verbatim but are not
  exposed in the compact editor, because they are not shape parameters. They
  remain editable through the brush panel for the next stroke, not the selected
  shape.

## 9. Limitations and open owner decisions

- **Rebuild cost.** A shape edit re-rasterizes the edited layer on each pointer
  move, exactly as the existing stroke transform does. Correctness first; a
  dedicated shape preview buffer is a performance decision, not a bug fix.
- **Unsigned build.** The executable and both installers are unsigned; Windows
  SmartScreen will warn on first run.
- **Format compatibility is one-way.** A v15 file is refused by v14 and older
  builds (by design). A user who needs to open the drawing in an older build
  must export a PNG or keep a v14 copy.
- **The legacy boundary is deliberate.** Baked shapes in v13/v14 files are
  ordinary strokes and stay that way; the shape editor does not offer to
  "upgrade" them. A conversion tool would need a rule for which strokes are
  shapes, which the audit explicitly rejected.
- **No shape library or presets.** The brush presets are unchanged; shapes are
  created from the tools' options, not saved as reusable objects.

## 10. Reproduce

```powershell
pnpm typecheck
pnpm test
pnpm test:visual
pnpm build
pnpm tauri build
```

Packaged smoke (the caller owns the process; the app must start from a fresh
state, and the two dialog commands are answered by the script):

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
$proc = Start-Process src-tauri\target\release\paka.exe -PassThru
# wait for http://127.0.0.1:9222/json/version
node scripts/packaged-shapes-step.mjs docs/qa/editable-shapes-wave/packaged
Stop-Process -Id $proc.Id -Force
```

The script exits non-zero if any check fails, and writes
`packaged-shapes-smoke.json` next to the captures. The Phase D logs from the run
quoted in §5 are `phase-d-test.log`, `phase-d-visual.log`, `phase-d-build.log`
and `phase-d-tauri.log` in the session's temporary directory.

## 11. Next backlog, prioritised

1. **A shape-aware marquee and lasso.** Today the shape editor handles one
   shape and the marquee handles strokes; a mixed selection is impossible. This
   is the largest remaining workflow gap, and it is a selection-model change,
   not a shape-model change.
2. **Cross-layer picking.** The editor selects on the active paintable layer
   only, like the existing select tool. A "pick the shape under the pointer on
   any visible layer" mode (or a layer-scoped Select All) would remove the
   "why can't I click it" moment.
3. **An opt-in conversion for legacy baked shapes.** v13/v14 files keep their
   strokes, deliberately. A previewed, explicit "convert this stroke to a
   rectangle/star" would need a rule for which strokes are shapes; it is an
   owner decision, not a bug fix.
4. **Shape presets or a small shape library.** A tuned star or a repeated
   callout is currently re-created by hand. Presets would reuse the existing
   brush-preset machinery.
5. **Multi-shape transforms.** Rotating or scaling several selected shapes as
   one group, once (1) exists.
6. **More appearance fields in the compact editor** (hardness, texture, tip),
   but only if artists ask: they are preserved verbatim today, and exposing
   them would widen a deliberately compact strip.
7. **A dedicated shape preview buffer or a dirty-rect rebuild**, if a large
   document shows lag while dragging a shape. Correctness came first.
8. **Text and path tools**, which are a separate wave.
9. **Signed installers and an installer/uninstaller smoke**, which are release
   engineering rather than feature work.

