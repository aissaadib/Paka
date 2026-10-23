# Krita 4 brush pack - implementation report

Date: 2026-10-23
Branch: `feat/krita-brushes` (cut from `feat/bigger-canvas-sizes` at `bbf1521`)
Status: implemented, tested and built; Notion publication blocked on login.

---

## 1. What shipped

A one-click **Krita 4** button in the **Brushes** side panel. It adds 69
translated Krita presets to the user's own brush library as editable presets
named `Krita - ...`. A second press adds nothing: only presets whose names are
not already in the library are imported.

Files:

| File | Purpose |
| --- | --- |
| `src/core/brushes/kritaDefaults.ts` | The 69 translated specs, the brush builder, `missingKritaPresets` and the provenance comment. |
| `src/features/brushes/BrushPresetPanel.tsx` | The `Krita 4` header button and its import handler. |
| `src/test/kritaPresets.test.ts` | 12 unit tests: count, names, bounds, the brush reader, the known presets, coverage, the import helper and the library-file round trip. |
| `tests/visual/krita-presets.spec.ts` | Browser coverage: one press imports 69, the names are searchable and applicable, the second press adds nothing. |
| `AGENTS.md` | The file map, the task row, the symbol table and the test map. |

No new dependency. No change to `PROJECT_VERSION`, the project format, the
settings schema or the document model.

---

## 2. Where the brushes come from

Source: `Krita_4_Default_Resources.bundle` from the Krita 4.4.8 source tree
(`krita/data/bundles/`), the same bundle that ships with Krita 4.

The bundle's `meta.xml` says:

```
<dc:author>Deevad with derivations of the brushes of Ramon Miranda, Razvanc,
Radian, Wolthera, Storm, Scottyp and other.</dc:author>
<meta:meta-userdefined meta:name="license" meta:value="CC-0"/>
```

Krita itself is GPLv3, but the default resource bundle declares **CC-0** for
its contents. This slice still takes the conservative path:

- only the preset **names** and **numeric settings** are used;
- **no** tip image (`.png`, `.gbr`, `.gih`, `.svg`), pattern or texture from
  Krita is copied or shipped;
- every brush is Paka's own rasterization of those numbers through fields Paka
  actually implements.

The module comment records this provenance in the source.

---

## 3. What was translated

The bundle holds 95 presets. 69 use an engine Paka can represent; 26 do not and
are skipped.

Included engines:

| Krita engine | Count | Paka representation |
| --- | --- | --- |
| `paintbrush` | 63 (non-eraser) | Smooth or stamped dabs, with hardness, texture and pressure |
| `roundmarker` | 1 | Smooth round stroke |
| `sketchbrush` | 2 | Smooth round stroke |
| `spraybrush` | 2 | Stamped brush |
| `hairybrush` | 1 | Stamped bristle brush |

Skipped engines and erasers (26):

| Reason | Count | Examples |
| --- | --- | --- |
| `colorsmudge` | 14 | Wet Bristles, Wet Circle, Blender Smear |
| `deformbrush` | 3 | Distort Grow / Move / Shrink |
| Erasers | 3 | Eraser Circle / Small / Soft |
| `duplicate` | 1 | Clone Tool |
| `curvebrush` | 1 | Sketching-3 Leaky |
| `gridbrush` | 1 | Blender Pixelize |
| `tangentnormal` | 1 | Texture Normal Map |
| `hatchingbrush` | 1 | Screentone Moire |
| `experimentbrush` | 1 | Shapes Fill |

Mapping rules:

- **Size**: the mask generator's diameter when it states one; otherwise the
  tip file's real pixel width/height multiplied by the brush scale, read from
  the PNG header, the GIMP `.gbr` header (including Krita's wrapper prefix) or
  the `.gih` text header. Clamped to 1-512.
- **Opacity**: `OpacityValue` (and the older `Krita/opacity` percentage), times
  `FlowValue` for `paintbrush`.
- **Hardness**: `vfade`/`hfade`, a `softness_curve`, or the image tip; mapped
  to 0.05-1.
- **Spacing**: the brush's spacing attribute, clamped 0.02-2. Stamped brushes
  use the same value as `stampSpacing` (clamped 0.02-1).
- **Stamp**: image-tip brushes, `spraybrush`, `hairybrush`.
- **Tip**: the mask type (`circle` vs `rect`) and, for image tips, the file
  name - `chisel`, `blot`, `bristle`; `round` for smooth auto brushes.
- **Texture**: the Krita pattern strength when a pattern is enabled; a light
  grain for grainy image tips.
- **Pressure**: `PressureSize` and `PressureOpacity` become 0.8 or 0 on Paka's
  identity curve; `minSizeRatio` is 0.12.

Paka has no per-sensor curves, no brush engines and no image tips, so the
strokes read like the Krita brushes, not identically. This is stated in the
module and in the report.

---

## 4. Verification

All commands were run in `D:\Dev\Paka-overnight-worktrees\integration`.

| Command | Result |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 95 files, 2382 tests passed |
| `pnpm test:visual` | 82 tests passed |
| `pnpm build` | exit 0; the existing "chunks larger than 500 kB" warning remains |

Targeted runs during development:

- `pnpm exec vitest run src/test/kritaPresets.test.ts` - 12 passed.
- `pnpm exec playwright test tests/visual/krita-presets.spec.ts` - 1 passed.

Nothing was skipped and no check is claimed without a run.

---

## 5. How to use it

1. Open the **Brushes** tab in the right-hand panel dock.
2. Press **Krita 4** in the panel header.
3. Search for a name (`Basic`, `Ink`, `Stamp`, `Pencil`, ...) or scroll the
   list.
4. Apply a brush as usual. It is a normal user preset: rename, duplicate,
   star, delete or export it like any other.
5. Pressing **Krita 4** again adds only the presets that are missing, so a
   deleted brush can be restored without creating duplicates.

---

## 6. Deliberate limits

- **No image tips.** Paka's `BrushTipShape` is a closed set (`round`, `felt`,
  `chisel`, `blot`, `bristle`). A photographed or painted Krita tip cannot be
  reproduced; the nearest shape is used.
- **No smudge/deform engines.** Those brushes change pixels by sampling
  neighbours; Paka's stamp engine only unions coverage.
- **No per-sensor response curves.** Pressure is a single linear strength per
  property, with the identity curve.
- **512 px cap.** Several Krita presets are wider (the soft airbrush is 600);
  they are clamped to Paka's `MAX_BRUSH_SIZE`.
- **Colour.** Every translated brush starts at Paka's ink `#16181c`; Krita
  presets do not carry a fixed colour.
- **Licence.** The pack is CC-0 per the bundle metadata, and no asset is
  copied. If the owner later wants to distribute original `.kpp` files or tip
  images, that needs a separate licence review (Krita is GPLv3; the bundle
  metadata alone would not settle a mixed-asset distribution).

---

## 7. Open item

The requested Notion page could not be created: the browser session is at
`https://app.notion.com/login`, no Notion MCP resources are configured and no
`NOTION` token is present in the environment. At the owner's direction the
full report was delivered as a text document instead:
`docs/qa/app-report/APP-REPORT.txt` (plain text, UTF-8) beside the Markdown
source `APP-REPORT.md`. Either can be pasted into a new page once the owner
signs in or supplies an integration token and a parent page.
