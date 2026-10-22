# Paka

A desktop raster drawing application: a Tauri 2 shell around a small, modular
drawing engine written in React + TypeScript, with HTML Canvas 2D as the current
raster backend.

This is the **foundation** of the app, not a finished product. You can draw
pressure-sensitive strokes, tune brush size, hardness, sampling, stabilization,
grain texture and the stamp (dab) brush, flood-fill regions,
paint linear and radial gradients, pan and zoom, manage layers with working
undo/redo for strokes, fills and gradients, and **save, reopen and export your
work as a project file or a PNG**. Several things are explicitly missing; see
[Known limitations](#known-limitations).

## What works

- **Drawing** with a mouse, pen or touch. Pointer Events, pressure-sensitive
  width and opacity, round joins and caps. Each stroke is composited as one
  shape at its own opacity, so a semi-transparent stroke never darkens where its
  segments overlap. A press outside the paper (the grey margin) is ignored
  instead of recording an invisible stroke.
- **Eraser** (`E`): the same brush footprint, but the stroke *removes* coverage
  from the active layer rather than painting colour. Size, opacity and pressure
  use the brush controls, it is one undo step ("Erase"), and a saved file
  reopens with the erasure intact. A cancelled eraser stroke leaves the layer
  exactly as it was.
- **Shape tools** (`L` line, `R` rectangle, `O` ellipse, `P` polygon, `S` star):
  drag from one point
  to another and the shape follows the pointer, previewed in the stroke buffer
  without touching the layer. Releasing commits it as **one** stroke, so it is
  one undo step and re-rasterizes identically on undo, reopen and export.
  `Shift` constrains (45-degree lines, squares, circles) and `Alt` draws from
  the centre. Rectangle, ellipse, polygon and star offer a **Fill shape** switch
  in the
  toolbar: with it on the interior takes the brush colour and the outline is
  still traced on top, so the edge lands exactly where an unfilled shape's edge
  would. The switch describes the *next* shape - each shape keeps the setting it
  was drawn with - and a line is never filled, since it bounds no interior.
  Shapes draw with the current brush, so size, colour and opacity
  come from the brush controls; a press outside the paper records nothing, and a
  click that never moved leaves nothing behind.
- **Polygon and star** (`P`, `S`): a **polygon** is a regular *n*-gon (3-24
  sides, default 5) inscribed in the **ellipse** of the dragged box, with a
  vertex at the top; a **star** is the classic *2p*-vertex outline (3-24
  points, default 5) - a tip and a valley alternating, not a self-crossing
  pentagram - inscribed in the **same ellipse**, so a star's tips are a
  polygon's tips, and whose **inner radius** (5-100 %, default 50 %) sets how
  deep the valleys reach. Both take a **rotation** (0-360°, default 0°) about
  the centre of the dragged box - a rigid turn, so the shape keeps its size -
  because a shape is drawn, not transformed. `Shift` squares the
  box, which is what makes either shape regular. The three options are **Sides**
  (labelled **Points** for the star), **Inner radius** (the star only) and
  **Rotation**; they describe the *next* shape, so changing one is not an edit
  and a shape keeps the values that were active when it was drawn. The shape's
  own box is not the dragged box: the polygon's own box **equals** the dragged
  box when the side count is a multiple of four, is **narrower in one axis**
  when the side count is two more than a multiple of four, and is **smaller in
  both axes** when the side count is odd; and a rotated shape swings off the
  ellipse, so its box can be **larger** than the dragged box in one axis - and
  smaller in the other.
- **Bucket fill** (`F`): click a region to flood-fill it with the current colour.
  The scan reads the **merged visible composite** - paper plus all visible layers
  - so line art on another layer bounds the fill, while the committed pixels go
  to the **active layer**. The toolbar's **Tolerance** slider (0-255, max
  per-channel difference) widens what counts as the same region; fully
  transparent pixels always match each other. The result is a bounded,
  pixel-exact patch with a binary coverage mask, not a traced contour, so it is
  identical after undo/redo and save/reopen. One successful fill is one undo
  step; cancelling the press (lost capture, tool switch, `pointercancel`)
  removes the preview and records nothing. A document over 16,777,216 pixels
  refuses the scan with a status-bar message instead of freezing.
- **Gradient** (`G`): drag across the canvas to paint a **linear** gradient from
  the current brush colour to the toolbar's **To** colour. The **Radial** switch
  makes the press point the centre and the drag length the outer radius. The
  stop editor adds, moves, recolours and removes middle stops with a live
  preview; the endpoints stay the two colours above. Brush opacity is applied
  once to the whole gradient. The preview is real layer
  content at its place in the painting order; releasing records one undo step,
  while cancelling (lost capture, tool switch, `pointercancel`) removes it and
  records nothing. A click without a drag leaves nothing behind. A gradient is
  stored as geometry plus colour stops - never as a pixel snapshot - so undo,
  redo and save/reopen rebuild exactly the same content.
- **Selection and transform** (`M`): drag a marquee to select the strokes of the
  active layer it meets, or click a stroke to select just that one and click
  empty paper to clear. The selection is shown as a dashed frame around the
  strokes plus a blue trace over each of them. Dragging from inside the frame
  moves every selected stroke as one gesture; releasing records **one** undo
  step, and `Esc` cancels a drag mid-flight. The frame also carries **four
  corner handles** and a **rotation handle** above its top edge: drag a corner
  handle to **scale** the selection uniformly about the centre of the frame (the
  corner keeps its direction from the centre, so dragging away from the centre
  grows the selection and towards it shrinks it, and the size is clamped so a
  selection can never collapse or invert), and drag the rotation handle to
  **rotate** it about the same centre. The rotation **snaps to 15 degrees**
  while the pointer is held down; hold `Shift` to turn the snap **off** and
  rotate freely. Both are measured **from where you pressed**, so grabbing a
  handle slightly off its centre does not jump the content. The handles take
  precedence over the move: a press on a corner is a scale, not a drag, and
  they appear only for a real selection - never on a marquee's rubber band.
  The arrow keys nudge the selection
  by 1 px (`Shift`: 10 px) and a continuous run of nudges is one step (reselecting
  starts a new one), `Ctrl+D` duplicates
  it in place and selects the copies, `Ctrl+Shift+H`/`Ctrl+Shift+V` flips it
  about its own centre, and `Delete`/`Backspace` removes it - each as one step,
  restorable with undo (deleted strokes come back in their original painting
  order). A transform that would move nothing - flipping a single dab, or
  scaling one - records
  nothing, and neither undo nor redo runs while a drag is in flight. A scale or
  a rotation moves the strokes' **samples** and nothing else: the brush, the
  colour, the opacity and the pressure are untouched, so a scaled stroke is
  still the same stroke and a saved file reopens exactly as it looks. The move,
  duplicate, nudge, flip and delete actions also live in the **Selection**
  menu, together with three **fixed-step** transforms for precision without
  dragging: **Scale by 150 %**, **Rotate 15 degrees clockwise** and **Rotate 15
  degrees counter-clockwise**. They pivot on the same centre as the handles and
  are one undo step each; the scale multiplies the geometry by 1.5, so using it
  twice gives 2.25, and undo is the exact way back. Selecting is not an
  edit: it adds no history step and never marks the document dirty.
- **Colour picker** (`I`): samples the composited canvas - paper plus visible
  layers at their opacity - at the pointer and makes it the brush colour, so it
  picks the colour actually on screen rather than the colour a stroke was
  authored with. It samples on click (no drag), stays selected afterwards, and
  is not an edit: it adds no history step and never marks the document dirty.
- **Composition guides** (`U`): a dedicated **Guides** tool places a vertical or
  horizontal guide by dragging on empty canvas, and moves an existing guide by
  dragging it. The axis follows the dominant direction of the drag, and the
  guide sits at the **press** point, so it marks where the drag started. The
  drag has to travel **3 screen pixels** before its direction decides the
  axis, so **a shorter drag creates no guide at all** (it is a click, and a
  click on empty canvas just clears the selection). A click selects a guide,
  `Delete` removes it and `Esc` cancels a drag in flight; the status bar
  reports the selected guide and its position. Every change is one undo step.
  A guide is part of the document, but it is **display-only**: it is drawn over
  the artwork and never reaches a PNG export, so an exported picture is
  exactly the artwork.
- **Grid and snapping**: a **Grid** switch draws a lattice over the paper, a
  **Snap** switch makes the drawing follow the guides and the grid lines, and a
  **Spacing** control sets the distance between the lines in **document
  pixels**, so the grid means the same thing at every zoom. The snap is a
  *magnet*: a point within **6 screen pixels** of a guide or a grid line lands
  exactly on it, and a point that is nowhere near one keeps its position. The
  two switches are independent - the grid can be hidden while the snapping
  stays on - and both have shortcuts (`Ctrl+'` and `Ctrl+Shift+'`). The grid
  and the snapping are **view state**: they change no pixels, add no history
  step, never mark the document dirty and never reach an export, and they are
  remembered in the per-user settings file. There are no rulers yet.
- **HSV colour wheel**: a **Colour** panel beside the layers. The disc picks a
  hue (the angle) and a saturation (the distance from the centre), the value
  slider picks the brightness, and the three sliders name the same numbers and
  are keyboard-operable. It writes the same brush colour the picker, the
  toolbar's colour input and the swatches write, so the wheel follows a colour
  picked off the canvas - and choosing a colour is not an edit: it adds no
  history step and never marks the document dirty.
- **Primary and secondary colours**: the toolbar keeps two colour chips. The
  left button paints with the primary and the right button with the secondary;
  the swap button exchanges them, and right-clicking a palette swatch assigns
  it to the secondary chip. The colour is resolved when the gesture starts and
  stored on the stroke, shape, fill or gradient, so swapping later never
  repaints existing work. It is editor state, not a project field.
- **Contrast and colour-difference readout**: under the wheel, the **WCAG 2.2
  contrast ratio** between the brush colour and the document's paper (with a
  plain-language band, from "excellent" to "low"), and the palette swatch
  **perceptually closest** to the ink, with its CIEDE2000 distance. The ratio
  is a lightness comparison and the distance a perceptual one, so the readout
  shows both and promises neither for the other. It is a reading, not a
  control: no history step, no dirty flag, and it follows a colour chosen
  anywhere - the wheel, the toolbar's colour input, a swatch or the canvas
  picker.
- **Preferences survive a restart**: the brush, the active tool, the shape
  options, the fill tolerance and the gradient settings are stored in a
  per-user settings file in the operating system's configuration folder and
  restored at startup. The file holds preferences only - never a drawing - and
  changing one is not an edit, so it adds no history step and never marks the
  document unsaved.
- **Brush controls**: size (1-512 px, in document pixels), opacity, **hardness**
  (0-100 %, where 100 % is the crisp edge and lower values soften the stroke's
  outer edge), **sampling** (2-200 % of the brush diameter: how densely fast
  movements are interpolated), **stabilizer** (0-100 %: smooths the captured
  pointer path; the line lags while moving and settles on the release point),
  **texture** (0-100 %: deterministic grain over the finished coverage), a
  **stamp** switch with its own **stamp spacing** (2-100 % of the brush size:
  how far apart the dabs sit), **stamp hardness** (the falloff of a single
  dab), **stamp texture** (0-100 %: the strength of the bristle lanes) and a
  **tip** (round, ellipse or square, with a roundness and an angle),
  colour (primary and secondary pickers, an 8-swatch palette and the colour
  wheel), and toggles for pressure-driven size and pressure-driven opacity. Once
  either pressure toggle is on, a **Pressure curve** editor shapes how raw pen
  pressure maps to the response. Every brush setting is
  captured by each stroke, so changing one later never rewrites existing work;
  hardness and texture apply to the brush, the eraser and shapes, while sampling,
  stabilizer and the stamp apply to the brush and eraser (a shape's geometry
  comes from the drag, not the freehand path).
- **Stamp (dab) brush**: with the stamp switched on, a stroke is drawn as a
  chain of round dabs placed along its path instead of as continuous segments.
  The dabs overlap and their coverage is combined with a maximum, so a stroke
  never darkens where it crosses itself, and each dab carries its own hardness
  curve - a true falloff inside the dab rather than a blur of the finished
  silhouette. Live drawing, undo/redo, reopening a file and exporting a PNG all
  produce the same dabs.
- **Per-dab directional texture**: with the stamp texture switched on, each dab
  is crossed by bristle lanes that run **along** the path, so a stroke reads as
  a bundle of streaks rather than a line of dots, and the lanes rotate with the
  stroke. The texture is multiplied into a dab's coverage *before* the dabs are
  combined, so it can only take ink away and a stroke still never darkens where
  it crosses itself. The lanes are laid out against the brush's centre line, so
  the picture does not change when a stroke is drawn backwards, and against the
  brush's nominal size, so the pattern is the same in document pixels at every
  zoom. The texture has a **profile** (a bundle of irregular **bristles** or a
  regular ribbed brush of **ridges**), a **density** (how many lanes there are
  across the brush) and a **contrast** (how crisp their edges are). All three
  are procedural: no picture is involved, and the default profile is the one
  every earlier stroke was drawn with.
- **Brush tips**: a stamped stroke can be drawn with a **tipped** dab instead of
  a round disc - an **ellipse** or a **rectangle** - with a **roundness** (how
  wide the tip is across its length) and an **angle**. The tip either follows
  the stroke, the way a flat or chisel brush does, or stays at a fixed angle.
  The brush's size is the tip's long axis, so a narrow tip paints a narrower
  mark than the size suggests. The tip is a mask rather than a picture: it is a
  name and two numbers, so the project file stays small and the parser can
  check it. The default tip is the round disc, so every stroke drawn before the
  tip existed is unchanged, and the tip changes the mark's shape, never where
  the dabs are placed.
- **Navigation**: wheel scrolls, `Shift+Wheel` scrolls horizontally,
  `Ctrl`/`Alt+Wheel` zooms around the cursor, `Pan` tool or middle-mouse drag
  moves the canvas. Zoom buttons, actual size and fit-to-window.
- **Layers**: add, duplicate, delete, rename (double-click), reorder,
  visibility, opacity, blend mode (`Normal`, `Multiply`, `Screen`, `Overlay`,
  `Soft light`, `Hard light`, `Color dodge`, `Darken`, `Lighten`, `Difference`,
  `Exclusion`) and selection. Layer pixels composite bottom-first over the paper
  colour; a blend
  mode combines the whole layer with everything below it, including the paper.
  A layer cannot be changed while a stroke, fill, gradient or selection drag is
  in flight, so a release can never commit into a layer that was removed
  mid-drag.
- **Undo/redo** for strokes, fills, gradients *and* layer operations: add,
  duplicate, delete (including the deleted layer's strokes, fills and gradients),
  rename, reorder, visibility, opacity and blend mode. Available from the
  toolbar, the Edit
  menu and `Ctrl+Z` / `Ctrl+Shift+Z` (`Ctrl+J` duplicates the active layer).
  Dragging a slider is one step, not one per tick. History is capped at 200
  commands.
- **New document** dialog with size validation (8-8192 px per side, at most
  16,777,216 px in total, so a large document cannot ask for a multi-gigabyte
  raster surface).
- **Projects**: `File → New/Open/Save/Save As` (`Ctrl+O`, `Ctrl+S`,
  `Ctrl+Shift+S`) writing a versioned `.paka` file that stores document
  metadata and **ordered layer content** - stroke samples, fill patches and
  gradient geometry/stops - so reopening a file restores an editable drawing
  rather than a flattened picture, with fills landing on exactly the pixels that
  were committed. Native
  open/save dialogs, an unsaved changes indicator in the title and status bar, a
  discard warning before new, open or close, and atomic writes that never leave a
  half-written file.
- **PNG export** (`File → Export PNG…`) of the full composite at document size,
  including layer visibility, opacity and blend mode, without touching the
  editable document.
- **Status bar** reporting document size, zoom, history depth, how many strokes
  are selected, the live cursor position in document coordinates, the current
  file name and file messages.
- **HiDPI** rendering: layer surfaces are rasterized at up to 2x and the display
  canvas follows the device pixel ratio, while document geometry stays fixed.

## Stack

| Layer | Choice |
| --- | --- |
| Shell | Tauri 2 (native WebView; no Electron, no Qt) |
| UI | React 19 + TypeScript (strict) |
| Build | Vite |
| State | A single engine instance shared through React context; no state library |
| Raster | HTML Canvas 2D behind a `DrawingRenderer` interface |
| Native | Rust: environment probe, scoped project/PNG file I/O, dialog plugin |
| Tests | Vitest (Node environment) |

## Getting started

Requirements: **Node 20+**, **pnpm 9+** and a **Rust toolchain 1.85+**.

```bash
pnpm install
pnpm dev            # frontend only, http://localhost:1420
pnpm tauri dev      # the real desktop app
```

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server for the frontend (no native APIs) |
| `pnpm tauri dev` | Runs the Tauri desktop app against the dev server |
| `pnpm build` | Type-checks the whole project, then builds the frontend bundle |
| `pnpm typecheck` | `tsc --noEmit` over `src` |
| `pnpm test` | Vitest run |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm tauri build` | Production desktop bundle |

### Building on Windows without MSVC

The build works with Rust's `x86_64-pc-windows-gnu` target, which needs a
complete MinGW-w64 installation (rustup's bundled `dlltool` cannot link on its
own). This project was developed against **WinLibs POSIX/MSVCRT** installs of
`gcc`/`ld`/`dlltool`, selected through a machine-local `~/.cargo/config.toml`
that points the target linker at that installation.

Pin the **MSVCRT** flavour, not the UCRT one: the `windows-gnu` target is
MSVCRT-based and the UCRT flavour links but produces load-time failures.

## Project layout

```
src/
  app/          entry point, provider wiring, global styles
  components/   presentational shell (menu bar, toolbars, panels, icons)
  features/     feature UI (canvas, brushes, colour, layers, history, document,
                project: file commands, dialogs, title and close guard)
  hooks/        React bindings for the engine
  state/        the editor store and context holding the engine instance
  core/
    document/   document + layer metadata, ordered element store
    brushes/    brush defaults, stroke sample processing
    fill/       pure flood-fill scan and fill-patch records
    gradient/   gradient geometry, stops and record helpers
    tools/      tool registry and per-tool behaviour
    commands/   command stack, element commands, layer commands
    input/      pointer normalization and DOM binding
    rendering/  viewport math, frame scheduler, Canvas 2D renderer
    engine/     integration of all of the above
    project/    project file format, gateway port, file orchestration
    export/     full-document PNG export
  types/        shared value types
  utils/        generic helpers
src-tauri/      Rust shell: native environment probe and project/PNG I/O
docs/           architecture notes and the project file format
```

Module boundaries, coordinate spaces, the rendering and input pipelines, the
undo model and the path to a WebGL/WebGPU backend are documented in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The `.paka` file format, its
validation rules, the atomic write strategy and the PNG export contract are
documented in [docs/PROJECT_FORMAT.md](docs/PROJECT_FORMAT.md). Where the
project is heading, phase by phase, is tracked in
[docs/ROADMAP.md](docs/ROADMAP.md). A briefing for picking the work up in a fresh
session - settled decisions, verification recipes, the Windows toolchain caveats
and the next slice - is in [docs/HANDOFF.md](docs/HANDOFF.md). A condensed,
paste-ready version of the same briefing is in
[docs/SESSION-BRIEF.md](docs/SESSION-BRIEF.md).

## Known limitations

- Only the **brush**, **eraser**, **select**, **line**, **rectangle**,
  **ellipse**, **polygon**, **star**, **bucket**, **gradient**, **colour
  picker** and **guides** tools exist, plus
  pan. There is no text tool.
- **Guides are axis-only.** A guide is vertical or horizontal, a second guide on
  the same position is refused, the colour is fixed, and there is no position
  label. The guides *do* take part in the snapping (the **Snap** switch), but
  the snapping is a magnet with a 6 screen pixel radius, not a lock: a guide
  pulls a point that comes close to it and nothing else. There are no rulers.
- **Gradients are two-stop, linear or radial, and paint the whole layer.**
  There is no draggable stop editor, no angle snapping and no gradient with a
  transparent stop (opacity applies to the whole element). A gradient is
  content, not a mask or adjustment: it covers what is below it on its layer, so
  paint a gradient on its own layer to keep earlier artwork visible. Gradients
  are not selectable, so they can be undone but not moved, duplicated or
  flipped.
- **A bucket fill is a committed raster patch, not an editable region.** The
  mask is binary, so there is no feathering and no gap-closing; the slider only
  affects the next fill, and the fill is scanned at click time (no pre-commit
  region preview). Fills are not selectable, so they can be undone but not
  moved, duplicated or flipped. The scan samples the merged composite including
  the paper, and documents above 16,777,216 pixels refuse a fill with a notice.
- **Selection is stroke-level and has no boundary yet.** A marquee selects whole
  strokes (never part of one), only on the **active layer**, and the selection is
  dropped when you switch layers or switch away from the select tool. It is a
  convenience, not a mask: painting is **not** clipped to a selection, so a
  selection never constrains a brush stroke. The frame is the bounding box of the
  selected strokes rather than the region you dragged.
- **Dragging a selection re-rasterizes the whole layer on every pointer move**
  (the stroke list stays authoritative and the pixels are rebuilt from it, so the
  drag can never drift from the committed result). That is fine at the sizes
  tested and is the first thing to cache if a heavy layer makes dragging lag.
  A scale and a rotation cost the same.
- **A transform is baked on apply.** Scaling and rotating move the selected
  strokes' samples and commit them, so there is no non-destructive transform to
  edit later, and the **painted width is not scaled with the path**: a scaled
  stroke is the same stroke drawn along a different path, not a stroke drawn
  with a bigger brush. Perspective, shear, a non-uniform scale, per-stroke
  nudging and copy/paste across layers are not implemented.
- Shape tools draw the **outline** of a line, rectangle, ellipse, polygon or
  star as a stroke
  of the current brush, and the rectangle, ellipse, polygon and star can fill it
  (see the shape
  tools above). Because the stroke rasterizer
  uses round joins a rectangle's corners are very slightly rounded. A shape is
  stored as ordinary stroke samples, so it has no separate geometry to edit
  afterwards and it ignores pen pressure (constant width). A filled ellipse is
  filled from the same polyline its outline is traced with, so its interior is
  faceted to the same sub-pixel degree as its outline. A polygon and a star are
  stored the same way, so a committed one cannot be re-edited as a polygon or a
  star - it is an ordinary stroke afterwards.
- Every layer *edit* is one undo step, but layer **selection** is not: it
  changes no pixels and is deliberately not treated as an edit.
- The **separable** blend modes are implemented: `normal`, `multiply`, `screen`,
  `overlay`, `soft-light`, `hard-light`, `color-dodge`, `darken`, `lighten`,
  `difference` and `exclusion`. They are canvas compositing operations over the
  finished layer, so they combine with the paper and every lower layer; the
  non-separable hue/saturation/color/luminosity modes, group and clipping
  contexts, and alpha inheritance are not implemented.
- Opacity is applied **per stroke, not per dab**: a stroke gets one alpha, from
  the brush opacity and the stroke's mean pressure. Pressure tapers width within
  a stroke but not opacity - per-dab opacity without build-up needs per-pixel
  max blending, which Canvas 2D does not expose.
- **Hardness is a single-pass feather of the finished stroke, not a true
  hardness profile.** Lowering it blurs the stroke silhouette once, so the edge
  is a Gaussian falloff and extends slightly beyond the nominal diameter (the
  interior stays at full coverage and opacity is still applied once). The
  stamp engine's own **stamp hardness** is the per-dab profile, which is a true
  falloff inside each dab; the stroke-level feather still runs over the
  finished coverage, so a soft brush stays soft when the stamp is on.
- **Texture is one deterministic grain pass over the finished coverage, not a
  stamped or per-dab texture.** It darkens no more than the plain stroke, is
  anchored to document coordinates (so it survives zoom, undo/redo and export),
  and `0` leaves the hard/soft pixels unchanged. Directional and image-based
  textures are not implemented.
- **Sampling is sample density, not stamp spacing.** It only controls how many
  interpolated points a fast movement produces, so a lower value costs memory
  but does not change the brush's width or grain; the stamp's own **stamp
  spacing** is the distance between dabs. **Stabilizer is an exponential
  follow filter**: at high strength the line visibly lags the pointer and
  settles with one final segment on release; it has no look-ahead or rope-style
  catch-up, and shape tools ignore it.
- **The tip is procedural, not a picture.** There is no stamped bitmap, no
  scatter, no jitter and no per-dab opacity (a stroke still gets one alpha).
  The tip is an ellipse or a rectangle described by a ratio and an angle, and
  the per-dab texture is a procedural bristle pattern, not an image. A stamped
  stroke's cost grows with the square of the brush radius, so a very large
  brush with a fine dab spacing is expensive to re-rasterize; the planner stops
  after a fixed amount of work, so an extreme stroke is cut short rather than
  stalling the app.
- Strokes are rasterized per segment on the CPU. It holds up at the sizes
  tested; it is the first thing to move behind the renderer interface if it does
  not.
- **A project file stores stroke samples, fill masks and gradient geometry, not
  pixels.** That keeps drawings editable, but the JSON grows with the number of
  points and
  masked pixels: a long, heavily sampled drawing can produce a file tens of
  megabytes in size, and a large fill can add several megabytes. A compressed or
  binary container is the natural next container (the format is versioned, and
  the parser refuses versions it does not know).
- **The current project version is `14`** (`version: 1` to `13` files still
  open and are written back as 14; their strokes default to a hard edge, texture
  0, a missing stabilizer reads as 0 because it was added additively within
  version 6, the stamp is off because it did not exist before version 9, the
  per-dab texture is off because it did not exist before version 10, the tip is
  the round disc because it did not exist before version 13, and the texture's
  profile, density and contrast are the defaults because they did not exist
  before version 14).
  Unknown versions, wrong formats and unreadable files are rejected with a
  message instead of being partially loaded.
- Undo history is **not** part of the file. Reopening a project rebuilds one
  undoable step per stored element (stroke, fill patch or gradient), so the
  drawing stays editable, but there is no redo of edits made before the save.
- There is **no autosave or crash recovery**: unsaved work is lost if the app or
  the machine goes down. The machinery for a recovery copy exists and is
  tested, but the decisions that govern it - when to save, how a recovery is
  offered - are still open, so nothing is enabled.
- `Ctrl+N` is not bound; use `File → New Document…`.
- The React layer has **no automated tests**; it is verified manually in the
  running app. The format, file-service and export orchestration have Vitest
  coverage, and the Rust file I/O has `#[cfg(test)]` tests in `project_io.rs`.

## License

Paka is MIT-licensed — see [`LICENSE`](LICENSE), "Copyright (c) 2026
HumanHEART".

The notices for the third-party material that ships inside the installer are in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), and the verbatim licence
texts are in [`licenses/`](licenses/). Both are bundled with the installer, so
a recipient of the installer receives them.

Paka is built with [Tauri](https://tauri.app), which is licensed MIT OR
Apache-2.0. TAURI is a trademark of The Tauri Programme within the Commons
Conservancy. Paka's application icon is original artwork to this repository —
see [`src-tauri/icons/README.md`](src-tauri/icons/README.md).
