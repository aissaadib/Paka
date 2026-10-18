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
- **Status bar** reporting document size, zoom, history depth, the live cursor
  position in document coordinates, the current file name and file messages.
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

- Only the **brush** and **pan** tools exist. No eraser, selection, fill or
  transform.
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
- **Only one project version exists** (`version: 1`). Unknown versions, wrong
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
