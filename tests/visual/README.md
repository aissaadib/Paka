# The visual-regression harness

This harness renders Paka's own scenes in a **real browser** and checks two
things:

1. **The product's central invariant** — for every scene, the **live**
   drawing, the **rebuilt** layer and the **exported** composite must produce
   the same pixels.
2. **The rendered picture** — each scene has a committed golden PNG, so a
   change in what Paka draws is caught even when the three renderings still
   agree with each other.

## Why it exists

The repository's own pixel harness (`PixelCanvas` in
`src/test/canvas2dRenderer.test.ts`) is a *software* canvas: it has **no
antialiasing and no blur kernel**. It can disprove a placement, an extent or
a region bug, and it cannot prove a Chromium edge. The independence QA found
exactly that gap: a region-rounding defect changed **122 real pixels** in a
browser while the whole unit suite stayed green.

This harness is the browser-level half. It is the only place the invariant is
checked with a real antialiased and blurred edge.

## Running it

```bash
pnpm test:visual            # the suite; it starts its own dev server
pnpm test:visual:update     # rewrite the goldens (a deliberate act)
```

The first run needs the browser, once:

```bash
pnpm exec playwright install chromium
```

That is a **118 MiB** download into `%LOCALAPPDATA%\ms-playwright`. The
**bundled** Chromium is used rather than the machine's Chrome, so the browser
build is pinned by the lockfile and the goldens do not move when the host
updates its browser.

The harness runs its own dev server on **port 1422**, because the app's own
server holds 1420 with `strictPort`.

## The goldens

The goldens live in `tests/visual/visual.spec.ts-snapshots/` and are named
`<scene>-<platform>.png` — the platform suffix is part of the name, because
antialiasing differs between platforms.

**They were generated on Windows, Chromium 156.0.8078.4 (the Playwright
1.64.1 bundled build), at a device scale factor of 1.** A golden generated on
another platform may not match; that is a tolerance question, not a defect.

The comparison uses a **2 % pixel ratio** tolerance
(`maxDiffPixelRatio: 0.02`), the same value the audited reference
(fabric.js) uses for the same purpose. The exact-match alternative would fail
on any platform difference.

**Updating a golden is a reviewable act.** The change is a PNG diff, and it
must be read as "this is what Paka now draws".

## The corpus

`tests/visual/scenes/*.json` — **data, not scripts**. A scene describes a
document: its size, its background, its layers, and its elements. Adding a
capability to Paka means **adding a scene**, never changing the runner.

The corpus covers the current feature set, not only the brush:

| Scene | What it covers |
| --- | --- |
| `hard-brush` | a plain hard stroke |
| `soft-brush` | the feathered path (hardness below 1) |
| `grain-brush` | the deterministic grain pass |
| `stamped-brush` | the stamp (dab) engine |
| `layer-opacity` | a layer at partial opacity |
| `blend-multiply` | the `multiply` blend mode |
| `blend-screen` | the `screen` blend mode |
| `fill-patch` | a bucket-fill patch, with a stroke over it |
| `gradient` | a linear gradient, with a stroke over it |
| `multi-layer` | a three-layer stack, one of them hidden |
| `soft-erase-rim` | a painted stroke with a **soft eraser** across it |

`soft-erase-rim` is the scene that catches the audited **region-rounding**
defect: the composited region floored instead of ceiled clips the erase's
padded edge, and the live erase and the rebuilt erase then disagree.

## The rules the suite enforces on itself

| Rule | How it is enforced |
| --- | --- |
| The harness reaches the product only through its renderer boundary | a test asserts that every `/src/...` import in the harness is on an allow-list |
| The harness imports no rasterization internal | a test asserts that `stampCoverage`, `canvas2dStroke` and `strokeBuilder` appear nowhere in it |
| The corpus holds no text scene | a test asserts it, and the schema has no text element at all — font identity is still open (decision D-1) |
| The corpus is data | by construction: the runner discovers scene files and never names one |

## What it does not cover

- **The packaged Tauri app.** The harness proves the browser. The packaged
  window, its HiDPI behaviour and the native save/reopen path are separate
  items, and they are still unverified.
- **Real pen hardware.** All input here is synthetic.
- **The React layer.** The harness drives the renderer, not the UI, so a
  control's behaviour is still verified by hand in the running app.
- **Text.** Deliberately, until the font policy is settled.
