# Transform handles, preview and commit - QA report

> **Artifact type:** the report for the Agent 17 transform slice. The code is
> on `feat/agent17-transform-handles`; this file is the evidence behind it,
> not a project document.

| Field | Value |
| --- | --- |
| Feature | Transform handles, the transient preview and the commit/cancel of a transform |
| Branch | `feat/agent17-transform-handles` |
| Base commit | `74023e9` - *"Merge pull request #9 from aissaadib/integration/swarm-wave-2"* |
| Feature commit | `6906308` - *"feat(select): give the transform a real bounding box with side handles"* |
| Repair commit | `d7d68e6` - *"fix: resolve a conflicted merge that left two format versions and a doubled test"* |
| Worktree | `C:\Users\aissa\AppData\Local\Temp\opencode\agent17-transform-handles` (isolated) |
| Shared branch | **Not modified.** The shared checkout had another agent's uncommitted work in it, so the slice was done in its own worktree. |
| Files changed | 5 source files, 4 test files, 6 documentation files, 3 evidence images |
| Report date | 2026-10-22 |

---

## 1. What was already there, and what was missing

The transform slice `feat/ff26-transform` had shipped four **corner** handles
and a **rotation** handle, a uniform scale about the frame's centre, a 15
degree rotation snap and a live preview that is written over the copies of the
selected strokes' samples. The engine, the pure geometry module and the
history command all existed.

What it did **not** have, and what this slice adds:

| Gap | Now |
| --- | --- |
| No side handles: the frame could only be scaled as a whole | Four **side handles** stretch one axis |
| No way to choose the anchor: the scale was always about the centre | `Alt` anchors a corner at the **opposite corner** and a side at the **centre** |
| No aspect-ratio lock on a one-axis change | `Shift` locks the aspect ratio |
| The pointer did not say what a press would do | A resize cursor over a handle, the **move arrow** over the frame |
| The hovered handle was invisible | The handle under the pointer is **highlighted** |
| A dragged handle ignored the grid and the guides | A dragged handle **snaps** with the same magnet the drawing tools use |

## 2. The design decisions

### 2.1 The side handles sit **outside** the frame

This is the decision that shaped everything else. A side handle *on* the
frame's edge would sit **inside** the frame, and the frame is where a press
**moves** the content. The two gestures would compete, and the loser would be
the move: a thin selection - a single horizontal stroke, whose painted frame
is a few pixels tall - could not be moved by its middle at all, because the
handle above it would take the press.

That is not a hypothetical: the first implementation put the handles on the
edges and the engine's own test *"refuses undo and redo while a selection drag
is in flight"* failed, because its press at the centre of the frame was taken
by the north handle.

The handles are therefore outside the frame, further out than the grab radius
(`EDGE_HANDLE_OFFSET_PX = 12` screen pixels against a radius of 10), so a
press inside the frame can never reach one. The rotation handle already sat
outside the frame; the side handles now follow the same rule.

### 2.2 The anchor, and which modifier chooses it

The **anchor** is the point that does not move. It is read **when the gesture
starts**, from the modifier the press was made with, and it is fixed for the
whole gesture - an anchor that changed under the pointer would move the
content.

| Handle | Default anchor | `Alt` |
| --- | --- | --- |
| corner | the frame's **centre** (the shipped rule, unchanged) | the **opposite corner** |
| side | the **opposite edge** | the frame's **centre** (the frame grows on both sides) |

`Shift` is the other modifier and it is read **live**: holding it during a side
drag locks the aspect ratio, and pressing it after the drag has begun locks it
from that point on. It only changes the axis that is *not* being dragged, so
it cannot move the content out from under the pointer.

### 2.3 One map for both scales

A scale is written as an **anchor and a factor per axis**
(`HandleScale`, `core/document/selectionTransform.ts`):

```
x' = anchorX + (x - anchorX) * factorX
```

The uniform scale is the case where both factors are equal and the anchor is
the centre; the one-axis stretch is the case where one factor is 1. One map
covers both, so the preview, the commit and the undo all run the same code.

### 2.4 A side handle is measured against the **content**, not the paint

This was the one real bug the review found, and it is worth recording.

The stretch was first measured against the selection's **painted** frame - the
samples' bounds widened by half each stroke's brush diameter. But the
transform only maps the **samples**, and the padding is not scaled (a
transform never changes a stroke's brush). So the padding was scaled as a
side effect, and the frame the user *sees* did not do what the rule said: the
visible opposite edge slid, and the visible dragged edge lagged the pointer -
by half the travel for a selection that is thin in the axis being dragged.

The fix is to measure the stretch against the **content's** own bounds - the
samples', without the padding. The padding is a constant offset on both
sides, so:

- a content edge that stays put keeps its **painted** edge still, and
- a content edge that follows the pointer takes its **painted** edge with it.

Measured in the real app (Chromium, the live display canvas): dragging the
east side handle 60 screen pixels to the right moved the right edge of the
painted stroke by exactly **60** pixels and the left edge by **0**.

A selection with no extent on an axis - a single horizontal stroke, stretched
from above - has nothing to stretch there, and the drag now leaves it alone
instead of sliding the content.

### 2.5 The snapping is the existing one

A dragged handle uses `snapDocumentPoint` - the same call, the same targets
and the same screen-space magnet radius as a drawing sample. There is no
second, transform-only snapping rule. A transform pointer is not refused
outside the paper, though: a handle is often dragged past the edge of the
document and the content follows it there.

## 3. Automated verification

Run in `C:\Users\aissa\AppData\Local\Temp\opencode\agent17-transform-handles`:

| Command | Result |
| --- | --- |
| `pnpm test` | **1086 tests in 48 files, all pass** |
| `pnpm typecheck` | clean |
| `pnpm build` | succeeds |
| `pnpm test:visual` | **30 tests, all pass** (including the `transformed-selection` golden and the Selection-menu spec) |

The new tests, by area:

| Area | File | What it pins |
| --- | --- | --- |
| The stretch geometry | `src/test/selectionTransform.test.ts` | the dragged edge follows the pointer and the opposite edge does not move; the centre anchor grows both sides; the proportional modifier keeps the aspect ratio; a side is never squashed to nothing or mirrored; the opposite corner |
| The handles | `src/test/selectionHandles.test.ts` | the side handles sit outside the frame; a press inside the frame never grabs one; the side handles are further out than the grab radius; the cursors; the hit test |
| The engine | `src/test/drawingEngine.test.ts` | the side stretch commits as **one** undo step and undo/redo are exact; the **visible** frame's opposite edge stays and its dragged edge follows the pointer; a selection with no extent on an axis is left alone; `Shift` keeps the proportions; `Alt` anchors a corner at the opposite corner and a side at the centre; a cancel, a tool switch and `Esc` restore the samples **exactly**; the move and resize cursors; the hovered handle; a dragged handle snaps onto the grid |
| The renderer | `src/test/canvas2dRenderer.test.ts` | the side handles are painted; the hovered handle is filled with the accent colour; **none** of it reaches the export |

The base commit did not compile: the merge of `integration/swarm-wave-2` into
`main` kept **both** sides of two conflicts - a duplicated
`export const PROJECT_VERSION` and a doubled `it(...)` header. `d7d68e6`
resolves it in favour of the newer side (version 12, the pressure-curve
format). The same fix was made independently in the shared checkout.

## 4. Browser verification (the real app, Chromium through Playwright)

The running app (`pnpm dev`, port 7431) was driven with synthetic pointer
events on the live display canvas, with `requestAnimationFrame` overridden by
timers (the harness tab is hidden, so the browser suspends it).

| Check | Result |
| --- | --- |
| A stroke is drawn | `history 1`, `● unsaved` |
| It is selected | `1 selected` |
| The **east side handle** is found by the cursor | the cursor reads `ew-resize` at CSS (574, 267) - 12 px outside the frame's right edge |
| The **interior** of the frame | the cursor reads `move` - a press there moves the content |
| The side handle is dragged 60 px right | the right edge of the **painted** stroke moved by exactly 60 px and its left edge by **0** |
| The release | `history 2` - **one** undo step for the whole drag |
| The handle after the stretch | found again, 60 px further right - the handles follow the frame |
| `Ctrl+Z` after the stretch | `history 1` and the canvas **byte-identical** to the state before the stretch (0 changed pixels) |
| `Esc` **during** a drag | the canvas is **byte-identical** to the state before the drag (0 changed pixels) and `history` is unchanged |

Images (the display canvas, cropped to the paper):

- `docs/qa/evidence/agent17-01-selection-handles.png` - the selection with its
  four corner handles, four side handles and the rotation handle.
- `docs/qa/evidence/agent17-02-side-stretch.png` - the same selection after
  the side stretch: the left edge stayed put, and the east handle is
  highlighted because the pointer is on it.
- `docs/qa/evidence/agent17-03-mid-drag.png` - the drag in flight, before the
  release.

## 5. What was **not** verified

- The **packaged Tauri window** was not exercised: the checks above are the
  browser app, driven through the same engine and the same DOM binder.
- The **project format** is unchanged by this slice, and the transform is
  still baked into the samples, so a save/reopen is covered by the existing
  format tests rather than by a new one.
- A **shear** and a **perspective** transform are still not implemented; the
  map in `selectionTransform.ts` would carry them, but the perspective needs a
  stored transform and is out of scope.
