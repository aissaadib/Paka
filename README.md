# Paka

A desktop raster drawing application: a Tauri 2 shell around a small, modular
drawing engine written in React + TypeScript, with HTML Canvas 2D as the current
raster backend.

This is the **foundation** of the app, not a finished product. You can draw
pressure-sensitive strokes, change brush size and colour, pan and zoom, manage
layers with working undo/redo for strokes, and **save, reopen and export your
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
- **Shape tools** (`L` line, `R` rectangle, `O` ellipse): drag from one point
  to another and the shape follows the pointer, previewed in the stroke buffer
  without touching the layer. Releasing commits it as **one** stroke, so it is
  one undo step and re-rasterizes identically on undo, reopen and export.
  `Shift` constrains (45-degree lines, squares, circles) and `Alt` draws from
  the centre. Shapes draw with the current brush, so size, colour and opacity
  come from the brush controls; a press outside the paper records nothing, and a
  click that never moved leaves nothing behind.
- **Selection and transform** (`M`): drag a marquee to select the strokes of the
  active layer it meets, or click a stroke to select just that one and click
  empty paper to clear. The selection is shown as a dashed frame around the
  strokes plus a blue trace over each of them. Dragging from inside the frame
  moves every selected stroke as one gesture; releasing records **one** undo
  step, and `Esc` cancels a drag mid-flight. `Delete`/`Backspace` removes the
  selected strokes as one step, restorable with undo in their original painting
  order. Selecting is not an edit: it adds no history step and never marks the
  document dirty.
- **Colour picker** (`I`): samples the composited canvas - paper plus visible
  layers at their opacity - at the pointer and makes it the brush colour, so it
  picks the colour actually on screen rather than the colour a stroke was
  authored with. It samples on click (no drag), stays selected afterwards, and
  is not an edit: it adds no history step and never marks the document dirty.
- **Brush controls**: size (1-512 px, in document pixels), opacity, colour
  (picker plus an 8-swatch palette), and toggles for pressure-driven size and
  pressure-driven opacity.
- **Navigation**: wheel scrolls, `Shift+Wheel` scrolls horizontally,
  `Ctrl`/`Alt+Wheel` zooms around the cursor, `Pan` tool or middle-mouse drag
  moves the canvas. Zoom buttons, actual size and fit-to-window.
- **Layers**: add, duplicate, delete, rename (double-click), reorder,
  visibility, opacity and selection. Layer pixels composite bottom-first over
  the paper colour.
- **Undo/redo** for strokes *and* layer operations: add, duplicate, delete
  (including the deleted layer's stroke data), rename, reorder, visibility and
  opacity. Available from the toolbar, the Edit menu and `Ctrl+Z` /
  `Ctrl+Shift+Z` (`Ctrl+J` duplicates the active layer). Dragging a slider is
  one step, not one per tick. History is capped at 200 commands.
- **New document** dialog with size validation (8-8192 px per side).
- **Projects**: `File → New/Open/Save/Save As` (`Ctrl+O`, `Ctrl+S`,
  `Ctrl+Shift+S`) writing a versioned `.paka` file that stores document
  metadata and **stroke data**, so reopening a file restores an editable
  drawing rather than a flattened picture. Native open/save dialogs, an unsaved
  changes indicator in the title and status bar, a discard warning before new,
  open or close, and atomic writes that never leave a half-written file.
- **PNG export** (`File → Export PNG…`) of the full composite at document size,
  including layer visibility and opacity, without touching the editable
  document.
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
    document/   document + layer metadata, stroke store
    brushes/    brush defaults, stroke sample processing
    tools/      tool registry and per-tool behaviour
    commands/   command stack and the stroke command
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
[docs/ROADMAP.md](docs/ROADMAP.md).

## Known limitations

- Only the **brush**, **eraser**, **select**, **line**, **rectangle**,
  **ellipse**, **colour picker** and **pan** tools exist. No fill or gradient.
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
- **Transform means translation.** Scaling, rotating, flipping and per-stroke
  nudging are not implemented, and there is no copy/paste of a selection.
- Shape tools draw the **outline** of a line, rectangle or ellipse as a stroke
  of the current brush; they do not fill it, and because the stroke rasterizer
  uses round joins a rectangle's corners are very slightly rounded. A shape is
  stored as ordinary stroke samples, so it has no separate geometry to edit
  afterwards and it ignores pen pressure (constant width).
- Every layer *edit* is one undo step, but layer **selection** is not: it
  changes no pixels and is deliberately not treated as an edit.
- Only the **`normal`** blend mode is implemented.
- Opacity is applied **per stroke, not per dab**: a stroke gets one alpha, from
  the brush opacity and the stroke's mean pressure. Pressure tapers width within
  a stroke but not opacity - per-dab opacity without build-up needs per-pixel
  max blending, which Canvas 2D does not expose.
- Strokes are rasterized per segment on the CPU. It holds up at the sizes
  tested; it is the first thing to move behind the renderer interface if it does
  not.
- **A project file stores stroke samples, not pixels.** That keeps drawings
  editable, but the JSON grows with the number of points: a long, heavily
  sampled drawing can produce a file tens of megabytes in size. A compressed or
  binary container is the natural v2 (the format is versioned, and the parser
  refuses versions it does not know).
- **The current project version is `2`** (`version: 1` files, which have no
  eraser strokes, still open and are written back as 2). Unknown versions, wrong
  formats and unreadable files are rejected with a message instead of being
  partially loaded.
- Undo history is **not** part of the file. Reopening a project rebuilds one
  undoable step per stored stroke, so the drawing stays editable, but there is
  no redo of edits made before the save.
- There is **no autosave or crash recovery**: unsaved work is lost if the app or
  the machine goes down.
- `Ctrl+N` is not bound; use `File → New Document…`.
- The React layer has **no automated tests**; it is verified manually in the
  running app. The format, file-service and export orchestration have Vitest
  coverage, and the Rust file I/O has `#[cfg(test)]` tests in `project_io.rs`.
