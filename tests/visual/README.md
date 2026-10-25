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

`blend-modes.spec.ts` is a pixel test rather than a screenshot: it asks the
bundled Chromium for each layer mode's composite result and compares it with the
reference formulas. It covers every mode the layer menu offers, plus partial
source alpha and a transparent source.
| `fill-patch` | a bucket-fill patch, with a stroke over it |
| `gradient` | a linear gradient, with a stroke over it |
| `multi-layer` | a three-layer stack, one of them hidden |
| `group-opacity` | a **group at 50 % opacity** with two overlapping children: the fade is the group's, not each child's |
| `group-hidden` | a **hidden group**: its whole subtree is absent from the export |
| `group-blend` | a **group with `multiply` and 50 % opacity** over a yellow layer |
| `soft-erase-rim` | a painted stroke with a **soft eraser** across it |
| `polygon` | a **filled** five-sided polygon, inscribed in the dragged box's ellipse |
| `star` | a **filled** five-point star, with the inner radius at 50 % |
| `guides` | a document with **composition guides**: a vertical and a horizontal one |
| `grid` | a document with the **grid overlay** on, at a 40 px spacing and a 2x zoom |
| `transformed-selection` | a **scaled and rotated** stroke: the picture a transformed selection draws |
| `contrast-readout` | the palette's inks on the white paper the contrast readout measures |

`polygon` and `star` are the shape tools' pictures. A shape is an ordinary
stroke whose samples trace the outline, so a scene states the outline as the
stroke's samples - the points here are the ones `shapeOutline` produces for the
default options, and the golden pins the picture they draw. The `fill` flag on a
scene stroke is the same flag the shape tools write: the closed outline is
filled with the brush colour before the outline is traced on top. The star
scene is the one that matters: the rasterizer fills with the **non-zero** rule,
so it fills the star only because the outline is a simple loop.

`group-opacity`, `group-hidden` and `group-blend` are the **layer groups**. A
scene layer may be a `group` with `children`, and the harness builds the
document's real tree rather than flattening it. The goldens pin the group's
picture; `layer-groups-render.spec.ts` additionally samples the exported pixels
so the two behaviours a group must have are checked arithmetically, not only by
a regression image: a 50 % group fades its **composite** (the upper child does
not show the lower one through it), and a group's blend mode applies to that
composite rather than to each child.

`soft-erase-rim` is the scene that catches the audited **region-rounding**
defect: the composited region floored instead of ceiled clips the erase's
padded edge, and the live erase and the rebuilt erase then disagree.

`guides` is the scene that pins the **composition guides**. The guides are
display-only, so the scene has **two** goldens: `guides-<platform>.png` is the
export (which contains no guide at all) and `guides-display-<platform>.png` is
the display (which contains the two guide lines). The harness also asserts the
two properties the format depends on: the guides change the display and do
**not** change the export. A scene that declares no guide is captured from the
export only, exactly as before.

`grid` is the scene that pins the **grid overlay**. The grid is display-only
like the guides, so the scene has **two** goldens as well: `grid-<platform>.png`
is the export (which contains no grid line at all) and `grid-display-<platform>.png`
is the display, captured at a **2x zoom** so the lattice is seen at another
scale - the spacing is in document pixels, so the lines move with the document
and not with the screen. The harness asserts the two properties the grid
depends on: the grid changes the display and does **not** change the export.

`transformed-selection` is the scene that pins a **transformed selection**. A
stroke may declare a `transform` - a uniform scale and a rotation about a
stated centre - and the harness applies it with the **product's own** maps
(`core/document/selectionTransform.ts`), so the golden is the picture the
editor's scale and rotate actually draw, not a hand-written approximation.
Those maps are geometry, not rasterization, which is why that one module is
allowed past the renderer boundary; the harness still never imports a
rasterization internal.

`contrast-readout` is the scene behind the colour panel's contrast readout:
the palette's inks drawn on the white paper the readout measures them
against. The harness drives the **renderer**, not the UI, so the scene pins
the colours the readout reports on - the swatches and the paper they are
measured against - rather than the readout's own text. The readout itself is
a React component and is verified by hand in the running app.

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
- **The React layer.** The harness drives the renderer, not the UI. A panel
  gets browser coverage only where a dedicated spec drives it:
  `layer-groups.spec.ts` does that for the Layers panel's group workflow. Other
  controls are still verified by hand in the running app.
- **Text.** Deliberately, until the font policy is settled.
