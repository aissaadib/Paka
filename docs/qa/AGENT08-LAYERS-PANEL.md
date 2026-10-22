# Agent 08 - the layers panel: what was built and what was verified

**Branch**: `feat/agent08-layer-panel`
**Scope**: the layers panel UI only. The layer model, the layer commands and the
project format are untouched; the only engine additions are two **reads** (a
layer's content bounds and a layer's preview) and an optional renderer method.

## What the panel does now

| Area | Before | Now |
| --- | --- | --- |
| Which layer is active | a tinted row | a tinted row **and** an accent bar |
| Which row has the keyboard | nothing | a dotted outline, distinct from the active layer |
| A hidden layer | a crossed-out eye | the eye **and** a dimmed name |
| Reordering | two header buttons | two header buttons, **a drag** with a visible insertion marker, and `Ctrl+Up`/`Ctrl+Down` |
| The keyboard | the rows were reachable by `Tab` only | `Up`/`Down` move the focus, `Home`/`End` jump, `F2` renames, `Ctrl+Up`/`Ctrl+Down` reorder, `Delete` removes |
| Deleting | one click | one click, **and a confirmation when the layer holds content** |
| Opacity | the panel's slider for the active layer | the slider **and** a per-row quick editor |
| A layer's content | a name | a name **and a small preview**, cropped to the layer's content |
| Density | rows of 26 px | rows of 26 px, a fixed density with a reserved preview slot |
| The empty list | an empty box | a sentence that says what to do |

**Not shown, deliberately**: group, clip, lock and alpha-lock controls. The
layer model has no semantics for them, and a control that does nothing is worse
than no control.

## The three defects the verification found

1. **The insertion marker moved the rows.** The marker was an ordinary list
   item, so it added a gap and the rows below it moved down. The row under the
   pointer moved with it, the pointer ended up in the *other half* of that row,
   and the layer landed one place away from the marker the artist was looking
   at. Fixed by making the marker a two-pixel line with negative margins: it
   takes no room, so the rows stay exactly where they were.
2. **The drop used the last `dragover`, not the drop.** The browser throttles
   `dragover`, so the marker - and the layer that landed with it - could be a
   move behind the pointer. Fixed by reading the slot from the **drop** event's
   own coordinates.
3. **The number input in the panel's opacity slider showed `1` for 100 %.** The
   slider works in `0..1` and prints a percentage, but the number box shows
   the raw value. The row's quick editor works in percent (`0..100`), so the
   two now agree on what the artist reads. (Found by reading the panel's
   screenshot, not by a test.)

## Verification

### Automated (Vitest) - all pass

`pnpm test` on the branch: **1093 tests in 52 files, all pass** (the branch
starts from the repaired wave-2 merge, `0168c52`).

New coverage:

- `src/test/layerOrdering.test.ts` (10 tests) - the drop slot in the list
  without the dragged row, the move delta, the marker's index, the focus walk
  (no wrap-around) and the midpoint rule.
- `src/test/layerDeletion.test.ts` (5 tests) - a layer with content is
  confirmed, an empty one is not, and the prompt names the layer and the
  content.
- `src/test/layerBounds.test.ts` (10 tests) - the painted bounds of a stroke, a
  fill, a linear gradient and a radial gradient, their union, and the crop a
  preview uses.
- `src/test/layerPanel.test.ts` (10 tests) - the panel's contract with the
  engine: the reorder lands the layer where the marker said, the drag is one
  undo step, a drop that changes nothing records nothing, the active layer
  survives a reorder, selecting a layer is not an edit, the visibility toggle
  and the quick opacity edit are one step each, and a deleted layer's content
  comes back on undo.

`pnpm typecheck` is clean.

### Automated (a real browser) - all pass

`tests/visual/layers-panel.spec.ts` drives the running application in the
bundled Chromium: **12 tests, all pass**.

- the panel lists the layers and marks the active one;
- hiding a layer marks the row and leaves one undo step;
- `F2` renames the focused layer and leaves one undo step;
- the arrow keys move the focus **without** changing the active layer;
- `Ctrl+Down` reorders the focused layer and leaves one undo step;
- the quick opacity edit changes one layer in one step;
- the layer's preview shows what the layer holds (read from the panel's own
  canvas);
- deleting a layer that holds content asks first, and cancelling keeps it;
- deleting an empty layer asks nothing;
- a drag shows the insertion marker and lands the layer where it was;
- a drag onto the upper half of a row lands the layer above it;
- a cancelled drag changes nothing.

### Not verified

- **The packaged Tauri window.** The panel was driven in the browser
  (Chromium through Playwright), not in the packaged build.
- **A HiDPI display.** The preview is drawn at the device pixel ratio, but it
  was only read back at DPR 1.
- **A screen reader.** The rows carry `aria-current`, the visibility button
  carries a pressed state and the confirmation is an `alertdialog`, but no
  assistive technology was run against it.

## The trade-offs

- **The preview never re-rasterizes.** The renderer draws it from the layer's
  own surface and returns nothing when that surface is stale, so the panel can
  never stall the input it is supposed to stay out of the way of. The price is
  a preview that appears a frame later, and a hidden layer that was never
  composited has no preview at all.
- **The panel polls for the preview.** The renderer rasterizes a layer on its
  own frame, so the panel looks again - a bounded number of frames - to see it.
  The wait stops as soon as every visible layer has a preview.
- **The preview is the layer's own pixels**, not the composite, and it is
  cropped to the layer's content. A layer's opacity and blend mode are *not*
  applied to it: it shows what the layer holds, not how it looks in the
  document.
