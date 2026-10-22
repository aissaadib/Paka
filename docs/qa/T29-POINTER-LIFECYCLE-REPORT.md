# T29 — Pointer lifecycle, high-DPI and viewport robustness

**Branch:** `feat/agent29-pointer`
**Base:** `74023e9` (the integration tip of swarm wave 2) plus `99c0bf0`, a
repair of a bad merge in the base (see §6).

## 1. What was broken, and how it was reproduced

### 1.1 A window that loses the focus leaves the gesture in flight

**Scenario.** Press the mouse on the canvas, drag, press `Alt+Tab` (or switch
to another application), then come back and release — or do not release at
all.

**Cause.** A window that is not focused is not given a `pointerup`: the
browser stops delivering pointer events to it, and a release that happened in
the background is never seen. Nothing in the app watched for that, so the
gesture stayed in flight:

- the preview stayed on the canvas;
- a stroke kept growing with the next pointer move;
- a shape, a gradient, a fill or a selection was committed by a *release the
  user never made*, at a position the user never released at;
- the tool believed a drag was still running, so the next gesture started
  from a wrong state.

**Reproduced in the browser app**, on the base build and on the fixed build,
with the same script (a rectangle drag that loses the focus half way
through):

| | base build | fixed build |
| --- | --- | --- |
| history after the blur | 0 | 0 |
| history after the late release | **1** (the shape was committed) | **0** |

The other tools, on the fixed build:

| gesture | history after the blur | history after the late release |
| --- | --- | --- |
| rectangle (shape) | 0 (preview discarded) | 0 |
| brush | **1** (its pixels are real, so it is committed once) | 1 |
| gradient | 0 (preview discarded) | 0 |
| marquee over a selection | the committed selection is untouched | the committed selection is untouched |

**Fix.** `CanvasInputBinder` watches `window`'s `blur` and `document`'s
`visibilitychange` and ends the tracked gesture with the tool's own cancel —
exactly what a lost capture already did. The brush commits on a cancel
(its pixels are real once they are rasterized), so a stroke interrupted this
way is committed **once**; everything else is discarded and records nothing.

### 1.2 A device pixel ratio change that comes without a resize is ignored

**Scenario.** Move the window from a 1× display to a 2× display, without
resizing the window.

**Cause.** The CSSOM View specification fires no `resize` event for a ratio
change, and a window does not have to change size when it moves to another
display. The ratio decides the display surface's backing store (the CSS size
times the ratio) and the layers' raster scale, so both stayed at the old
value: the drawing stayed soft, and the artwork was rasterized for the old
grid, until the window was resized by hand.

**Reproduced in the browser app** (the ratio was driven with a temporary
`matchMedia` shim in `index.html`, which was removed afterwards):

| | base build | fixed build |
| --- | --- | --- |
| canvas CSS box | 744 × 406.45 | 744 × 406.45 |
| ratio | 1.25 | 1.25 |
| backing store before | 930 × 583 | 930 × 583 |
| ratio after the change | 2 | 2 |
| backing store after | **930 × 583** (stale) | **1488 × 933** |

**Fix.** `core/rendering/displayScale.ts` watches a
`(resolution: Xdppx)` media query — the only signal that fires — and re-arms
itself at the new ratio after every change, because a media query is pinned
to the ratio it was created for. The engine applies the ratio in one place
(`applyDisplayMetrics`), so the backing store and the raster scale always
move together.

### 1.3 A release for a pointer the binder never tracked

**Scenario.** A `pointerup` arrives for a pointer id the binder never
pressed (another device, or a synthetic event).

**Cause.** The binder forwarded it, so it reached the active tool and ended
the tracked gesture at a place the user never released at.

**Fix.** Such a release is ignored. A `pointercancel` for an untracked
pointer is ignored for the same reason, and a cancelled gesture gives the
pointer capture back.

### 1.4 A gesture that was in flight when the engine was detached

**Cause.** `detach()` aborted the stroke, the fill and the gradient, but not
the **selection** gesture: a selection move in flight left the strokes
moved, with no history entry, and the middle-button pan kept its flag, so
the next pointer move panned instead of drawing.

**Fix.** `detach()` gives the selection gesture and the pan back. The
regression test was checked by mutation: removing the
`cancelSelectionGesture()` call makes it fail.

## 2. The hot path that was measured

A move event can carry several **coalesced** samples — the browser's way of
reporting the sub-frame path of a fast gesture. Every one of them is a
position the pointer really passed through, so every one of them has to
reach the tool. The *cursor* did not: it was published once per sample, and
each report costs a DOM write in the brush outline and two in the status
bar.

The event is now handed to the engine as one batch
(`CanvasInputHandlers.onPointerSamples`), and the cursor is published once,
for the newest sample.

Measured in Node, without a browser and without a DOM
(`src/test/pointerHotPath.test.ts`, 2,000 events × 8 coalesced samples =
16,000 samples):

| path | cursor reports | engine time |
| --- | --- | --- |
| one call per sample (before) | 16,000 | 6.2 ms |
| one call per event (after) | 2,000 | 1.7 ms |

The counts are exact and are asserted by the test; the timings are printed
for information and are **not** asserted. The DOM writes the reports cost
(the brush outline and the status bar) are not measured here — the browser
harness tab is hidden, so `requestAnimationFrame` is suspended and the
display canvas never repaints.

## 3. The automated suite

```
pnpm test       52 files, 1080 tests, all pass
pnpm typecheck  clean
pnpm build      succeeds
```

New tests:

| File | What it covers |
| --- | --- |
| `src/test/canvasInputBinder.test.ts` | The DOM boundary: the capture, the cancel, the lost capture, the window losing the focus, the hidden tab, a release for an untracked pointer, a second pointer, the coalesced batch, the viewport mapping. |
| `src/test/pointerLifecycle.test.ts` | The engine: one cursor report per event, every coalesced sample kept in the stroke, a cancelled gesture recording nothing, a cancelled brush stroke committed once, a cancelled stroke not growing afterwards, a selection given back on `detach()`. |
| `src/test/displayScale.test.ts` | The ratio resolver and the ratio watcher (the change, the re-arm, the stop, a browser with no media queries). |
| `src/test/pointerHotPath.test.ts` | The measured hot path (the counts are asserted; the timings are printed). |
| `src/test/support/fakePointerTarget.ts` | The stand-ins the binder test drives: a fake surface, a fake window, a fake document and pointer events. |

## 4. What was **not** verified

- **The pixels.** The browser harness tab is hidden, so `requestAnimationFrame`
  is suspended and the display canvas never repaints; the project's own notes
  say the pixels have to be checked through the visual-regression harness. The
  state-level checks (history depth, the unsaved marker, the selection count,
  the backing store's size) all worked.
- **The scale/rotate handle gesture.** Its handle could not be grabbed
  reliably through synthetic events (the corner press starts a marquee
  instead). Its cancel path is covered by the existing engine tests
  (`drawingEngine.test.ts`, "cancels a transform in flight and records
  nothing").
- **The packaged Tauri window.** Not run. The ratio watch uses
  `window.matchMedia`, which every WebView has, with a fallback to the
  legacy `addListener` API.
- **A real second monitor.** The ratio change was driven with a shim in the
  page, not by moving a window between displays.

## 5. The changes

| Path | Change |
| --- | --- |
| `src/core/input/canvasInputBinder.ts` | The blur/visibility watch, the untracked-release rule, the capture release on cancel, the coalesced batch. |
| `src/core/rendering/displayScale.ts` | **New.** The ratio resolver and the ratio watcher. |
| `src/core/engine/DrawingEngine.ts` | `handlePointerSamples` / `routePointerSample`, `applyDisplayMetrics`, the ratio watcher, `detach()` gives the selection and the pan back. |
| `src/features/canvas/CanvasStage.tsx` | The viewport is measured from the **canvas element**, so the display transform and the pointer mapping cannot drift apart. |

No project-format change: nothing about the drawing, the document or the
settings changed.

## 6. The base was broken

The integration tip `74023e9` carried **two** `export const PROJECT_VERSION`
lines in `src/core/project/projectFormat.ts` (12 and 11) and two copies of
the same assertions in `src/test/projectFormat.test.ts`, so the file did not
parse and **twelve test files could not even be transformed** — the suite
reported "640 passed" out of a suite that should have had 1,051.

`99c0bf0` removes the stray version-11 declarations. Version 12 is the one
the reader implements (it is the version that reads `pressureCurve` off a
brush). The same repair was already uncommitted in another agent's working
tree, so the two deletions merge cleanly.
