# Application icon — provenance and how to regenerate

These files are **Paka's own artwork**. They are not derived from, adapted
from, or traced from any third-party logo, and they replace the stock icon
set that `tauri init` writes (the TAURI mark) with an original mark.

The upstream TAURI mark is a trademark of The Tauri Programme within the
Commons Conservancy. The TAURI copyright licence (MIT OR Apache-2.0) grants
**no trademark rights**, and Tauri's trademark guidelines require a licence
from the trademark holder before the logo is used for a third-party product.
Shipping Paka under the TAURI logo therefore implied an endorsement that does
not exist. See `docs/RELEASE-READINESS.md` (item R1) and the `B-1` finding in
`reuse-decision.md`.

## What the mark is

A rounded dark plate carrying a **tapered chain of round dabs** along a cubic
Bézier, with three detached dabs trailing behind the stroke.

It is drawn the way Paka paints: a stroke is a sequence of overlapping round
dabs whose radii taper along the path — the same idea as the brush engine in
`src/core/rendering/stampCoverage.ts`. The geometry lives in the source, not
in an image: there is no source photograph, no traced outline and no
third-party asset anywhere in the pipeline.

Colours are the app's own tokens from `src/styles/theme.css`:

| Role | Token | Value |
| --- | --- | --- |
| Plate | `--bg-app` | `#17191c` |
| Hairline | `--border` | `#2a2e34` |
| Dabs | `--accent` | `#4c8ef7` |

## How to regenerate

From the repository root:

```bash
node scripts/generate-app-icon.mjs
pnpm tauri icon src-tauri/app-icon.svg
```

The first command rewrites `src-tauri/app-icon.svg` from the constants in
`scripts/generate-app-icon.mjs`. The second rasterises that SVG into every
platform icon in this directory.

`tauri icon` also writes an `ios/` directory and a `64x64.png`. Paka has no
iOS target, so `ios/` is deleted after generating; `64x64.png` is kept.

## Files

| File | Use |
| --- | --- |
| `icon.png` | 512×512 master; Linux desktop entry, macOS fallback |
| `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png` | Windows and Linux raster sizes |
| `icon.ico` | Windows executable and installer icon |
| `icon.icns` | macOS bundle icon |
| `Square*Logo.png`, `StoreLogo.png` | Microsoft Store / MSIX package logos |

`src-tauri/tauri.conf.json` lists the icons the bundle uses under
`bundle.icon`.
