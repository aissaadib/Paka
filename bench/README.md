# The renderer benchmark

A reproducible, committed benchmark for the Canvas 2D renderer. It exists so a
performance claim can be checked against a before/after pair taken on the same
machine, with the same browser build and the same strokes.

```
node bench/run.mjs --label before
# ... change the renderer ...
node bench/run.mjs --label after
```

Each run starts the project's own Vite dev server, opens `bench/index.html` in
the Chromium that Playwright pins, runs every workload in the page, and writes
`bench/results/<label>.json`. Nothing is installed and no network is used.

## What it measures

| Column | Meaning |
| --- | --- |
| `median ms` | Main-thread time of one workload: the JavaScript and the canvas command submission a pointer handler would pay. This is the part that delays the next input event. |
| `min ms` / `max ms` | The spread across the repeats. A wide spread means the machine was busy; re-run rather than reading a single number. |
| `flush ms` | Wall time of `createImageBitmap(display)` after the workload. It forces the queued rasterization to finish, so it is a *relative* throughput signal. It includes the bitmap allocation and is never a claim about one frame. |
| retained heap | `usedJSHeapSize` after a forced collection, before and after 120 committed strokes. Requires `--expose-gc` (the driver passes it). |

## The workloads

| Workload | What it does |
| --- | --- |
| `stroke-hard-1024/2048/4096` | One 240-sample live stroke, a render every 4 samples, on three document sizes. The spread between the sizes isolates the work that scales with the document rather than with the stroke. |
| `stroke-soft-2048` | The same path with a 40 px soft brush, so the feathered scratch pass is included. |
| `stroke-textured-2048` | A 28 px textured brush: the grain tile is multiplied into the stroke's own silhouette. |
| `stroke-stamp-2048` | A stamped brush with a felt tip, textured dabs and tight spacing: the dab engine's own path. |
| `shape-replace-2048` | 120 `replaceStroke` calls, which is what a shape drag does on every pointer move. |
| `erase-2048` | A 160-sample eraser over committed ink. |
| `render-idle-2048` | 60 frames over a document with 40 committed strokes. |

## What it does not measure

- **Stylus input.** There is no pen in the harness; pressure is synthesised. Real
  pen dynamics (tilt, barrel rotation, hover) are unmeasured.
- **The packaged app.** This is Chromium on the dev server, not the Tauri
  webview. Headless Chromium may rasterize on the CPU, so absolute frame costs
  are not the app's; the *relative* before/after numbers are the point.
- **GPU time.** No WebGL/GPU timer is involved.
- **HiDPI.** The display canvas is 1 device pixel per CSS pixel.

## The recorded runs

`bench/results/` holds the measurements a performance claim was checked against.
They are recorded artifacts, not fixtures: a test never reads them.

| File | What it is |
| --- | --- |
| `before.json` | The pre-optimization baseline, recorded at `38d86d3`. |
| `pair-before-1.json`, `pair-before-2.json` | The same renderer as `before.json`, re-recorded back to back with the pair below so the comparison is not across two machine states. |
| `pair-after-1.json`, `pair-after-2.json` | The optimized renderer, recorded immediately after each `pair-before` run. |

The pairing is the point. Whole-run drift of 10-20 % is normal on a development
machine, so a single before/after pair can invent or hide a change. Each
`pair-before-N` was taken with `git checkout 38d86d3 -- src/core/rendering/Canvas2DRenderer.ts`
and each `pair-after-N` immediately after restoring the optimized file, so the
two halves of a pair describe the same machine state.

`docs/qa/PERFORMANCE-PASS.md` is the report that reads them: it records which
rows are measured, which are relative, and which are unmeasured.
