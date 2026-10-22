# UI reference redesign — the shell, the options bar and the dock

Branch: `feat/ui-reference-redesign`, cut from the verified consolidation tip
`b63fb74`. Nothing in this work touches the engine, the renderer, the project
format or the tests' drawing invariants; the only product behaviour that moved
is where a control is drawn.

## 1. What was measured first

The starting point was not "the UI could look better". It was a measured
layout failure. `scripts/ui-screenshots.mjs` loads the real application in the
bundled Chromium at a fixed set of window sizes and records the page overflow,
the height of every panel and every control that cannot be reached. Run on
`b63fb74`, it reported:

| Window | Page overflow | Toolbar height | Layers body | Other panels |
| --- | --- | --- | --- | --- |
| 1440x900 | 0 px | 182 px | **48 px** | colour 167, brushes 104, navigator 60, shortcuts 287 |
| 1366x768 | 0 px | 182 px | **39 px** | colour 134, brushes 83, navigator 48, shortcuts 230 |
| 1024x768 | 0 px | 210 px | **37 px** | colour 127, brushes 79, navigator 45, shortcuts 218 |
| 960x600 | **66 px** | 210 px | **24 px** | colour 85, brushes 53, navigator 30, shortcuts 146 |
| 700x640 | **54 px** | 238 px | **25 px** | colour 88, brushes 55, navigator 31, shortcuts 151 |

So: the toolbar wrapped to three or four rows and grew to 238 px; five panels
were stacked in a 216 px column and the content-sized ones (the 287 px shortcut
list) left the layers list at its header; and at the configured minimum window
the page itself scrolled, taking the status bar with it. The "before" pictures
are in `before/`; the raw numbers are in `before/layout.json`.

## 2. Reference evidence

Two drawing applications were installed on this machine and driven for the
comparison. Their screenshots were captured from the running windows and are
**not committed** (they are third-party UI); they live in the capture folder
and the observations below are what they showed.

| Reference | What the screenshot actually showed | Why it works | Where it is applied in Paka |
| --- | --- | --- | --- |
| FireAlpaca 2.x (installed, `FireAlpaca (64bit)` 1298x908) | Narrow single-column icon rail on the left; one compact row of tool options at the top; stacked dockers on the right with **collapsible headers** (Color, Palette, Brush Preview, Brush, Brush Size) and the layer docker below | The canvas is the largest surface; a dock is a stack of small, titled, collapsible units, not a wall of controls | Side column: one tabbed dock (colour, brushes, navigator, shortcuts) above the layers list (`PanelDock`, `Workspace.tsx`) |
| Krita 5.x (installed, canvas captured) | Toolbox is a single ~40 px column; tool options are **one row** that changes with the tool; right-hand dockers are **tabbed** (Tool Options / Advanced Colour Selector) with Layers in its own docker; brush presets have thumbnails and a search field | A persistent one-row context bar keeps the canvas still while the tool changes; tabbing secondary dockers keeps their panels a constant, usable height | `ToolOptionsBar` (38 px, fixed) + `DocumentBar` (34 px, fixed); the colour/brush/navigator/shortcut dock |

Two things were deliberately **not** copied: neither app's source is used
(FireAlpaca is closed source; Krita is GPL and no code, asset or stylesheet
was taken), and no third-party screenshot is committed.

## 3. The change

### 3.1 One context row, then a stable document row

`src/components/layout/ToolBar.tsx` now mounts two rows:

- **`ToolOptionsBar`** (`src/features/options/ToolOptionsBar.tsx`) — the active
  tool's icon, name and shortcut, the brush preview and preset picker, the
  three primary brush values (size, opacity, hardness), the tool's own options
  from the existing per-tool registry, and a right-hand **Brush settings**
  trigger. The row is 38 px whichever tool is active; its middle region
  scrolls sideways, while the trigger stays pinned to the right, so advanced
  settings cannot scroll out of reach.
- **the document bar** (`.toolbar`, 34 px) — undo/redo, zoom, grid and the
  colour controls. These never move when the tool changes, so they stay
  findable by position.

The options bar renders the **same registry** as before (`core/shell/toolOptions`
+ `features/options/toolOptionSchema`); it is a new arrangement of the existing
contract, not a second options model. The old inline renderer
(`ToolOptionsPanel.tsx`) is deleted, so there is one bar, not two.

### 3.2 A real primary/advanced split, enforced by the property model

Every brush field already came from one table
(`core/brushes/brushProperties.ts`). The table now declares a `tier`:

- `primary` — size, opacity, hardness (in the bar);
- `advanced` — sampling, stabilizer, texture, the stamp switch and its own
  three fields, and the two pressure switches (in the **Brush settings**
  panel).

`primaryBrushProperties` / `advancedBrushProperties` partition the visible
fields, and `src/test/brushTiers.test.ts` proves it: every field has exactly
one tier, the two lists together equal `brushPropertiesFor` with no duplicate,
the stamp's own fields appear only while the stamp is on, no offered field is
one the engine ignores, and every field in both tiers writes a real brush
field. That is the guarantee that moving a control into a panel did not drop
it.

Preset management (name, save, rename, duplicate, delete) moved behind a
**Manage** popover next to the inline preset select; both share one piece of
state, so they cannot disagree about the selected preset. Gradient stops moved
into a **Stops** popover of the same bar; the inline half (radial, end colour)
stays beside the tool.

### 3.3 A tabbed dock with a layers list that has a body

`src/components/panels/PanelDock.tsx` shows the composition's right-slot panels
as tabs, except the layers panel, which keeps its own share of the column:

- membership, order and visibility still come from the workspace composition,
  so the Panels menu and the settings file are unchanged;
- all docked panels stay mounted; an inactive tab is `hidden`, so a brush
  browser search or a navigator position survives a switch;
- the dock takes 55% and the layers list 45%, each with a minimum; the column
  scrolls only when even the minima cannot fit (a window shorter than 560 px);
- the tab strip follows the WAI-ARIA tabs pattern: arrow keys, Home/End, one
  tab stop, `aria-selected`, labelled panels.

Panel bodies now show a thin scrollbar when their content is taller than the
dock, and the colour disc shrinks (148 → 124 → 104 px) before its sliders and
hex field are pushed out of the panel.

## 4. Result, measured with the same script on the final commit

| Window | Page overflow | Options bar | Document bar | Dock / layers |
| --- | --- | --- | --- | --- |
| 1440x900 | 0 px | 38 px | 34 px | 397 / **348 px** |
| 1366x768 | 0 px | 38 px | 34 px | 324 / **289 px** |
| 1180x800 | 0 px | 38 px | 34 px | 342 / **303 px** |
| 1024x768 | 0 px | 38 px | 34 px | 324 / **289 px** |
| 960x600 | 0 px | 38 px | 34 px | 232 / **213 px** |
| 900x700 | 0 px | 38 px | 34 px | 287 / **258 px** |
| 820x700 | 0 px | 38 px | 34 px | 287 / **258 px** |
| 700x640 | 0 px | 38 px | 34 px | 254 / **231 px** |

Unreachable controls: 0 at every size (in the "before" pass 26–35 controls sat
outside the window, most of them in the wrapping toolbar). The top chrome is
100 px (30 + 38 + 34) at every width, down from 182–238 px.

Pictures: `after/<size>.png` for all eight sizes, plus
`evidence/brush-settings-1440x900.png`, `evidence/brushes-tab-1440x900.png`,
`evidence/gradient-stops-1440x900.png` and `evidence/narrow-700x640.png`.

## 5. Verification

Run on the final commit of the branch:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm exec vitest run` | **90 files, 2276 tests passed** (was 2270/89 at `b63fb74`; the six new tests are the tier partition) |
| `pnpm exec playwright test` | **58 passed** — the 45 pixel scenes, the browser specs, and the new `shell-layout.spec.ts` (8 sizes + tabs + keyboard + tool switching + advanced panel + preset panel) |
| `pnpm build` | built; `index-JuqfAQOI.js` 501.67 kB (gzip 152.07 kB), CSS 36.87 kB (gzip 6.42 kB) |

`shell-layout.spec.ts` is the guard for this work: at each of the eight sizes
it asserts no page scroll, a status bar inside the window, a layers body over
60 px with at least one row, an active dock body over 60 px, no zero-size
control, no control that is outside the window with no scroll container able
to reveal it, and no panel box below the window. It also drives tool switching
(bar content and constant height), the dock tabs (including keyboard), the
brush settings panel (the advanced field's value survives close/reopen; the
stamp toggle reveals its dependent fields) and the preset management panel
(Escape closes it and returns focus to its trigger).

The packaged Windows build and its smoke test are reported separately in
section 7.

## 6. What is deliberately unchanged, and what is still missing

Unchanged on purpose: the tool rail (already grouped, with an active state,
tooltips and shortcut badges, and covered by `tool-rail.spec.ts`), the command
palette/canvas menu, the secondary view, reference images, symmetry and layer
groups — those are the deferred slices recorded in
`docs/qa/CONSOLIDATION-LEDGER.md`, and porting them from the broken
`origin/main` tree was out of scope. Engine behaviour, the project format and
the export path are untouched; the ruler/guide overlays remain display-only
and are excluded from exports by the existing pipeline.

Still missing, honestly:

- **No drag-to-resize of the side column.** The dock/layers split is fixed
  (55/45) with minimums. The old panel manager's per-panel fold/collapse state
  is still not wired to the live composition; switching tabs is the collapse
  mechanism. Panel *visibility* works through the composition (Panels menu).
- **The colour readout can sit below the fold** in a short dock. It is
  reachable by scrolling, and the scrollbar is visible, but at 1440x900 the
  "Compare colours" block is clipped after its header. Moving it behind a
  disclosure was rejected because the browser spec asserts its values on
  screen.
- **The options bar scrolls its middle region** below roughly 1000 px of width.
  The pinned right-hand Brush settings trigger means nothing is unreachable,
  but the last slider can require a sideways scroll at 700 px.
- **No new visual goldens** for the shell: the new spec is behavioural. Pinning
  the chrome's pixels would have made every spacing change a golden update, and
  the shell is still moving.
- The left rail's "new document" button and the document bar's colour swatches
  were left as they were; they are not part of this slice.

## 7. Packaged build

_(Filled in after the Windows package was built and driven; see the appendix
below.)_
