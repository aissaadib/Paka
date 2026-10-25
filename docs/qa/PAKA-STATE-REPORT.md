# Paka: state report

**App:** Paka 0.1.0 (Tauri + React + TypeScript, Windows x64)
**Branch:** `integration/editable-shapes-wave`
**Commit:** `abfeedb` — "feat(brushes): draw the brush icons as vector art"
**Date:** 25 October 2026
**Worktree:** `D:/dev/Paka-overnight-worktrees/integration`

This report describes the application as it stands after the vector-icon wave:
what the app does, the brush library and its icon system in detail, the tests
that prove them, and the measurements taken from the packaged application. It
is a snapshot, not a specification: the code is the authority, and `README.md`
§What works is the user-facing list.

---

## 1. What this wave changed

The wave, in order, all on the integration branch:

| Commit | Change |
| --- | --- |
| `197b9ea` | The six built-in brushes get icons drawn in TypeScript, as 16×16 pixel grids. |
| `01c3e6a` | Every brush gets an icon: the 81 translated Krita presets and any user brush draw one from their settings. |
| `d80760a` | The library becomes a grid of square thumbnails, with no captions. |
| `3e6a328` | The tile the keyboard is on is scrolled into the grid's view. |
| `784e7bd` | The group heading stays at the top of the scrolling grid. |
| `826a90b` | The group heading sticks flush to the list's edge, not 2 px below it. |
| `abfeedb` | The pixel grids are replaced by vector art: 48-unit SVG paths, nine kinds, nine palettes, a mark drawn from the brush's settings. |

The reason for the last one: at 40 CSS pixels on a 2× display a 16×16 pixel grid
is a handful of squares per fill, and it reads as blocky. The art is now curves
and round joins, so it is sharp at any size and any display density.

---

## 2. The app at this commit

Paka is a desktop raster drawing application: a Tauri shell around a React
front end and a Canvas 2D renderer, with the document model, the history and
the file format in TypeScript. What the app does today, by area:

- **Drawing** with a mouse, a pen or touch, pressure-sensitive. A stroke is
  rasterized into a scratch buffer and composited onto the active layer, so a
  long stroke does not re-render the document.
- **Brushes** with size (1–512 px), opacity, hardness (soft edge), texture
  (grain), spacing, a stroke stabilizer, a pressure curve, a stamped-dab mode
  with per-dab directional texture, and five tip shapes. Presets: six built-in
  brushes and the 81 translated Krita 4 presets, saved in the settings file and
  exportable as a brush library file.
- **Eraser** — the same footprint, but the stroke removes coverage.
- **Shape tools** — line, rectangle, ellipse, regular polygon (3–24 sides) and
  star (3–24 points, inner ratio, rotation), drawn as editable outlines.
- **Bucket fill** with gap closing, a distance field, growth and a soft edge.
- **Gradients** — linear and radial, with a stop editor and editable geometry
  (the handles can be dragged after the fact).
- **Selection and transform** — a marquee selects whole strokes, which can be
  moved, scaled, rotated (15° snap), flipped, duplicated and deleted, with
  corner and rotation handles.
- **Layers** — add, duplicate, delete, rename, reorder, visibility, opacity,
  the separable blend modes, and layer groups.
- **References** — images placed in the workspace for tracing, never exported.
- **Colour** — an HSV wheel, primary and secondary chips, a colour picker that
  samples the composite, a WCAG contrast and colour-difference readout, and
  input in hex, `hsl()` and `oklch()`.
- **Drawing aids** — grid and snapping, rulers, axis guides, and symmetry
  (vertical, horizontal, or both).
- **Navigation** — wheel zoom, pan modifier, rotate and mirror the view, a zoom
  field, a navigator panel, and a second view of the same document.
- **Documents** — a new-document dialog with validated sizes, tabs with one
  engine per document, open/save/save-as, recent files, and PNG export.
- **Undo/redo** for strokes, fills, gradients, selections and layer operations.
- **Shell** — a panel dock with a panel manager and workspace profiles, a
  command palette, a canvas context menu, a tool options strip, persisted
  preferences, and a settings file with per-section validation.

The brush library is one panel among these; sections 3 and 4 describe it and
its icons in detail.

---

## 3. The library as the user meets it

### 3.1 The grid

The panel (`features/brushes/BrushPresetPanel.tsx`) lists the library as a
grid of square thumbnails:

- `repeat(auto-fill, minmax(56px, 1fr))` with a 6 px gap, so the number of
  columns follows the panel's width. In the packaged app at its default window
  size the panel shows **3 columns of 58.125 px squares**.
- Every tile is a square (`aspect-ratio: 1`) containing one 46 px icon.
- **No captions.** The brush's name is the tile button's `aria-label` and its
  `title`; nothing is drawn under the picture. A built-in brush's label ends
  with `(built-in brush)`.
- The tile in effect is filled and outlined; the tile the keyboard is on gets a
  2 px ring, drawn as a `box-shadow` so it reads over the current tile.
- Two corner notes, both drawn only when they mean something:
  - a **star** at the top right, on hover or focus, and always once the brush
    is starred;
  - an **edited dot** at the bottom right when the live brush has drifted from
    the preset it came from.

### 3.2 The two groups

The library is one list split into two groups, in this order:

1. **YOUR BRUSHES** — the 81 translated Krita presets and any brush the user
   saved or imported;
2. **BUILT-IN** — the six curated brushes.

Each group has its own sticky heading. The heading sticks at the top of the
scrolling list while its own group is on screen (`top: -2px`, over the list's
2 px padding), so a tile is never shown without the group it belongs to. It
leaves with its group, which is why a heading can be half clipped for the
instant its group's last row passes the top.

The groups are computed by `groupPresets` in `core/brushes/presetBrowser.ts`,
which filters, sorts, then splits on `isBundledPreset`.

### 3.3 Search, order and the star filter

The filter row holds:

- a **search box** (`aria-label="Search brushes"`) matching names
  case-insensitively;
- an **order** selector (`aria-label="Order the brushes"`) with three options:
  `Name`, `Recently used`, `Favorites`;
- a **star filter** (`aria-label="Show only the starred brushes"`).

### 3.4 The keyboard

The list itself is focusable and owns the arrow keys
(`aria-label="Brush presets"`):

- **Right / Left** move one tile;
- **Down / Up** move one row.

The row step is read from the rendered grid: `gridColumnCount` parses
`getComputedStyle(list).gridTemplateColumns` and counts its tracks, so the step
follows the panel's width instead of a hard-coded column count. The selection
is kept inside the visible list: `nextSelectionId(visible, currentId, step)`
clamps at both ends, and an effect scrolls the selected tile into view.

### 3.5 Actions

Under the grid:

- a name box (`aria-label="Brush name"`, placeholder `Name this brush`);
- **Save**, **Rename**, **Duplicate**, **Delete** — Delete asks first, in an
  `alertdialog` named "Delete the brush";
- messages in a `role="status"` line (for example `Imported 81 brushes.` and
  `The Krita 4 brushes are already in the library.`).

The header holds **Krita 4** (the one-click import of the translated set),
**Import** and **Export** (the brush library file), all through the project
gateway.

### 3.6 Accessibility

- The icon is `role="presentation"`, `aria-hidden="true"`,
  `focusable="false"`: it is decoration, and the button's accessible name
  carries the meaning.
- The star is a real `<button>` with `aria-pressed` and a label that flips
  between `Star <name>` and `Unstar <name>`.
- The edited dot is `aria-hidden` and titled
  `The brush has changed since this preset was applied`.

---

## 4. The icon system

### 4.1 The model

An icon is data, not an image file. The repository ships no brush art; every
picture is TypeScript, so it can be read, diffed and tested like any other
constant.

```
BrushIcon      { id, label, palette, paths }
BrushIconPath  { d, fill?, stroke?, strokeWidth?, opacity?, transform? }
```

- `BRUSH_ICON_SIZE = 48` — every coordinate is in a 48-unit square viewBox.
- The renderer (`BrushIcon.tsx`) draws one `<path>` per entry, in list order,
  with `stroke-linecap="round"` and `stroke-linejoin="round"`.
- `BRUSH_ICON_CSS_SIZE = 46` — the size in the grid.
- A typical icon is 10–15 paths: 3 frame + 1 mark + 6–11 handle-and-subject.

### 4.2 The shared frame

Every icon starts with the same three paths, so the set reads as one family:

1. a rounded rectangle, 2.5 → 45.5 with a 9-unit radius, filled with the
   kind's tile colour and stroked with `BORDER` (`#10161f`) at 1.5;
2. an ellipse at (15, 9), 12 × 7, white at 16 % — the sheen;
3. an ellipse at (26, 46), 21 × 6, black at 12 % — the shade.

The sheen and the shade give depth without a gradient, which keeps the icon a
flat list of fills and strokes.

### 4.3 The nine kinds and their palettes

Each kind owns a palette: a tile, a light handle, a metal collar and a working
end, plus the kind's dark accent. **No two kinds share a tile hue** — that is
deliberate, because pen, round and airbrush were all near-identical blues in
the first draft and a row of Krita `Basic-*` brushes read as one repeated tile.

| Kind | Tile | Subject | Label |
| --- | --- | --- | --- |
| `pen` | `#3f86c9` blue | a fine steel nib, slit down the middle | A pen nib |
| `soft` | `#b184d6` violet | a round head with the halo it paints | A soft round brush |
| `marker` | `#ef8f2c` orange | a flat, angled chisel tip with a lit facet | A chisel marker |
| `airbrush` | `#35a8c4` cyan | the gun, its nozzle and a cone of mist | An airbrush |
| `charcoal` | `#9b9b97` grey | a rough, faceted point | A charcoal stick |
| `stamps` | `#cf5c6a` rose | a wooden handle, a collar and an inked pad | A stamp |
| `round` | `#5c9e4a` green | a wide, flat head | A round brush |
| `bristle` | `#b8753a` brown | a collar and five splayed strands | A bristle brush |
| `felt` | `#b85fa0` magenta | a flat, soft pad with a lit face | A felt pad |

Every kind shares the same handle and collar (`grip`): a rounded handle with a
highlight, a trapezoid ferrule, and a light facet on the ferrule. That is what
makes the family cohere. Below the ferrule each kind draws its own working end —
a nib, a head, a chisel, a pad — and that end plus the palette is what tells the
kinds apart. The stamp is the one kind whose working end has three parts: a
short handle, a collar and the inked pad.

The whole subject is drawn upright and then leaned into the family's pose with
`SUBJECT_TRANSFORM = "rotate(38 24 24)"`. The rotation is applied to the
subject paths only — the frame and the mark stay level.

### 4.4 Which kind a brush is

`brushGlyphId(brush)` reads the kind from the settings, in this order. The
order is a decision, not a fallback chain:

| Test | Kind | Why |
| --- | --- | --- |
| `stamp && tip === "chisel"` | `marker` | a stamped chisel is a chisel |
| `stamp && tip === "bristle"` | `bristle` | a stamped bundle is a bundle |
| `stamp && tip === "felt"` | `felt` | a stamped pad is a pad |
| `stamp && tip === "blot"` | `charcoal` | a ragged stamp is a ragged mark |
| `stamp` (round tip) | `stamps` | a round stamped dab |
| `texture >= 0.5` | `charcoal` | grain outranks softness: a grainy edge is the more visible property |
| `hardness <= 0.12` | `airbrush` | the softest edge is a spray |
| `hardness < 0.75` | `soft` | a soft edge |
| `hardness >= 0.75 && size >= 24` | `round` | a wide hard round |
| otherwise | `pen` | a fine hard round |

The tip is only read when the brush is stamped, because a stamped brush is the
only case the engine reads the tip in: a plain round brush with a chisel tip
paints round, so it must not draw a chisel.

**The six built-in brushes are the exception**, through `BUILT_IN_KINDS`:

| Preset id | Subject |
| --- | --- |
| `builtin-pen` | `pen` |
| `builtin-soft` | `soft` |
| `builtin-marker` | `marker` |
| `builtin-airbrush` | `airbrush` |
| `builtin-charcoal` | `charcoal` |
| `builtin-stamps` | `stamps` |

The reason is the Marker: it is a plain hard 14 px brush with no stamp, so its
settings alone draw a pen. The six are part of the app — their names are in the
toolbar and their pictures are how the library is read — so they keep the
subject their name promises. Everything else about their icon (the palette, the
mark) still comes from the settings.

Distribution across the 81 translated Krita presets, as measured:

| Kind | Presets |
| --- | --- |
| `charcoal` | 33 |
| `marker` | 15 |
| `round` | 10 |
| `bristle` | 10 |
| `soft` | 5 |
| `pen` | 4 |
| `airbrush` | 2 |
| `stamps` | 2 |
| `felt` | 0 |

Eight kinds occur; `felt` is reachable only from a user brush with a felt tip.
The lumpiness is the Krita set's own: the translated brushes are mostly
textured and stamped, so most of them are drawn as charcoal points or chisels.
Their names differ (Stamp Hearts, Texture Noise, Dry Bristles) but the engine
has no per-preset art and no name-based lookup, so the icon says the kind, not
the picture.

### 4.5 The mark

Under the subject, every icon draws the mark the brush leaves. It is the one
part of the icon that is entirely the brush's own:

- **Colour** — the brush's ink, moved away from the tile it sits on: lifted
  45 % towards white on a dark tile, dropped 35 % towards black on a light one.
  If that is still too close (`colourDistance < 60`) the other direction is
  used, so a mark is never invisible.
- **Length** — six steps by brush width: `9` (≤ 6 px), `12` (≤ 20), `15`
  (≤ 40), `18` (≤ 80), `21` (≤ 150), `24` (above).
- **Width** — `2.5` (≤ 8 px), `3` (≤ 40), `4` (above).
- **Opacity** — `0.25 + 0.5 × brush.opacity`, clamped to 0.1–0.75.
- **Shape** — `dots` when the brush is stamped and
  `stampSpacing >= 0.4`; otherwise `taper` when `pressureSize >= 0.5`;
  otherwise `band`.

The mark is centred on `MARK_CENTRE = 24` at `MARK_Y = 41.2`, and it is drawn
before the subject, so the subject covers its middle and it reads as a stroke
running under the brush.

---

## 5. Files

| File | Lines | What it holds |
| --- | --- | --- |
| `src/features/brushes/brushIcons.ts` | 577 | The model, `BRUSH_PALETTES`, `BRUSH_ICON_LABELS`, `frame`, `grip`, the nine subjects, `brushIconSubject`, `composeBrushIcon` |
| `src/features/brushes/brushIconFromBrush.ts` | 263 | `brushGlyphId`, `brushIconPalette`, `brushMark` and its colour, `brushIconFromBrush`, `BUILT_IN_KINDS`, `brushIconForPreset`, `brushIconLabel` |
| `src/features/brushes/BrushIcon.tsx` | 53 | The SVG renderer, `BRUSH_ICON_CSS_SIZE` |
| `src/features/brushes/PresetRow.tsx` | 105 | One tile: the pick button, the star, the edited dot, `data-built-in` |
| `src/features/brushes/BrushPresetPanel.tsx` | 589 | The browser: filters, grid, keyboard, scroll-into-view, actions |
| `src/features/brushes/brushPresets.css` | 269 | The grid, the tiles, the sticky headings, the corner notes |
| `src/test/brushIcons.test.ts` | 298 | 18 unit tests over the model and the mark |
| `tests/visual/brush-icons.spec.ts` | 129 | 4 browser tests over the library |

Unchanged by this wave but load-bearing: `core/brushes/presets.ts` (the preset
model), `core/brushes/bundledPresets.ts` (the six), `core/brushes/kritaDefaults.ts`
(the 81), `core/brushes/presetBrowser.ts` (filter, sort, groups, selection),
`core/settings/appSettings.ts` (the `presets` field).

`AGENTS.md` was updated in the same commit: the brush-icon rows now name the
vector symbols and the test map describes what the tests actually check.

---

## 6. Verification

### 6.1 The suites

| Command | Result |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm test` | **104 files, 2581 tests, all passed** (4.9 s) |
| `pnpm test:visual` | **91 tests, all passed** (59.2 s) |
| `pnpm tauri build` | succeeded; MSI 1.96 MiB, NSIS setup 1.41 MiB |

The icon suite checks the model rather than pixels:

- every preset in the library draws a picture, with a non-empty path per entry
  and no `NaN`;
- every coordinate is inside the 48-unit box;
- every colour is a hex colour or an `rgba()` the renderer can read, and every
  stroked path has a positive width;
- every icon is framed by the same first path, filled with its kind's tile;
- the six built-ins draw six different pictures and keep their curated
  subjects, while their mark still follows their settings;
- the same settings draw the same picture whatever the preset is called;
- the kind rules hold, including that a chisel tip on an unstamped brush is
  still a pen;
- every kind has its own subject and its own tile;
- the mark grows with the brush, fades with its opacity, tapers under pressure
  and turns into a row of dabs for a widely spaced stamp;
- the translated Krita set spans at least four kinds.

The browser suite checks what a user meets: square tiles, no captions, an
accessible name per tile, six distinct built-in pictures, the selected tile
scrolled into view, the sticky heading at the list's top, and a saved brush
drawn from its settings rather than a painted dot.

### 6.2 The packaged application

Measured over the DevTools protocol against the built `paka.exe`, Brushes panel
open, after importing the Krita set:

| Measure | Value |
| --- | --- |
| Tiles | 87 |
| Icons | 87 |
| Captions | 0 |
| Paths in the first icon | 14 |
| Tile box | 58.125 × 58.125 px |
| Grid | `58.125px 58.1375px 58.125px`, gap 6 px |
| Columns | 3 |

The window was left running the new build.

---

## 7. Known limitations and observations

1. **A fresh start shows no tile as "in effect".** The default brush is 6 px
   while the built-in Pen preset is 3 px, so `presetMatchingBrush` finds no
   match and no tile is marked current until the user applies one. Pre-existing,
   not introduced by this wave, not fixed.
2. **The Krita set is lumpy.** 33 of 81 presets are drawn as charcoal points and
   15 as chisels, because the engine has no per-preset art. Two presets that
   differ only in opacity or spacing draw nearly the same tile; their marks
   differ, but only slightly at 46 px.
3. **`felt` never occurs in the shipped library.** It is reachable only from a
   user brush with a felt tip.
4. **A group heading can be half clipped** for the instant its group's last row
   passes the top of the list. That is normal sticky behaviour, not a defect.
5. **The mark is the loudest element on light tiles.** A near-black ink on the
   grey charcoal tile at up to 0.75 opacity is a bold bar. It is capped in
   length (24 units) and opacity for that reason, but it is still the most
   contrasty thing on those tiles.
6. **The icons are decoration.** Nothing in the picture is announced; the tile's
   accessible name is the brush's name and origin. A screen-reader user gets no
   information about the kind of brush.
7. **The README is one wave behind on the brush tip.** Its limitations list still
   says the stamp engine has no brush tip ("a felt tip, a dry ink blot"), but
   the tip shipped: `BrushTipShape`, the stamp renderer and format v13 all read
   it, and the Krita presets set it. That line should be dropped or narrowed.

---

## 8. How to reproduce

```powershell
cd D:/dev/Paka-overnight-worktrees/integration

pnpm typecheck
pnpm test
pnpm test:visual

# The packaged app, with the DevTools protocol open:
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
Start-Process src-tauri/target/release/paka.exe
# then connect to http://127.0.0.1:9222 with Playwright's connectOverCDP
```

The icon art itself can be re-rendered without the app: `brushIconForPreset`
and `brushIconFromBrush` are pure functions, so a temporary Playwright spec can
write the paths into an SVG and screenshot them at any size.

---

## 9. Next

- The brush library's own backlog is empty for this wave; the next slice is
  chosen from `docs/SESSION-BRIEF.md` §9 and `docs/ROADMAP.md` §Next slice.
- If the icon set is revisited, the two candidates are per-preset subjects for
  the stamped Krita brushes (which would need art keyed by preset, against the
  current "settings only" rule) and a wider spread of the mark's colour on
  light tiles.
