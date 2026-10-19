# Paka project format (`.paka`)

A project file is **UTF-8 JSON text with a versioned envelope**. It stores the
document's metadata and the stroke data that produced its pixels - not a
flattened image.

Implementation: `src/core/project/projectFormat.ts` (format + parser),
`src/core/project/projectFiles.ts` (open/save/export workflow),
`src-tauri/src/project_io.rs` (the actual disk access).

## Why strokes and not pixels

In this engine the stroke list *is* the authoritative record; layer pixels are a
cache rasterized from it (see `docs/ARCHITECTURE.md`). Saving the strokes keeps
every layer editable after a reload:

- individual strokes stay undoable/redoable, one history step per stroke;
- nothing is resampled, so reopening never degrades a drawing;
- file size is independent of the display resolution and of `rasterScale`;
- a future brush model can re-render existing strokes with a new look.

Saving a flattened PNG (or per-layer PNG buffers) would trade all of that away
for a smaller file. That trade is the reason a v2 binary container is on the
roadmap rather than a v1 flattening.

What is deliberately **not** in the file is editor state: the undo history, the
zoom/pan viewport, the current tool and brush, and the current selection. A
project stores the *drawing*, so reopening restores the strokes and their layers
rather than the editing session that produced them. (Selection is derived from
strokes at run time anyway - see
[ARCHITECTURE.md](ARCHITECTURE.md#selection-and-transform) - so it needs no field
and the format version is unchanged.)

**The trade-off is real:** JSON number arrays are verbose. A stroke sample costs
roughly 40-60 bytes of text on disk (four numbers plus separators), so a heavy
drawing can reach tens of megabytes. A compressed or binary container is the
natural v2; the parser is structured so a new *encoding* can be added without
changing the model.

## Envelope

```json
{
  "format": "paka-project",
  "version": 2,
  "document": {
    "id": "doc-1",
    "name": "Still life",
    "width": 1600,
    "height": 1200,
    "background": "#ffffff",
    "activeLayerId": "layer-2"
  },
  "layers": [
    {
      "id": "layer-1",
      "name": "Background",
      "visible": true,
      "opacity": 1,
      "blendMode": "normal",
      "strokes": [
        {
          "id": "stroke-3",
          "brush": {
            "size": 6,
            "opacity": 1,
            "color": "#16181c",
            "pressureSize": 0.6,
            "pressureOpacity": 0,
            "minSizeRatio": 0.12,
            "spacing": 0.12
          },
          "startTime": 1730000000000,
          "xs": [100, 104.5, 109],
          "ys": [200, 205.25, 210],
          "pressures": [0.62, 0.7, 0.55],
          "times": [0, 8.3, 16.9]
        },
        {
          "id": "stroke-4",
          "erase": true,
          "brush": {
            "size": 24,
            "opacity": 1,
            "color": "#16181c",
            "pressureSize": 0,
            "pressureOpacity": 0,
            "minSizeRatio": 0.12,
            "spacing": 0.12
          },
          "startTime": 1730000004000,
          "xs": [104, 108],
          "ys": [206, 240],
          "pressures": [0.5, 0.5],
          "times": [0, 9.1]
        }
      ]
    }
  ]
}
```

The second stroke is an eraser stroke: its `erase` flag makes it subtract coverage
from the pixels painted before it instead of adding colour.

### `format`, `version`

`format` must be exactly `"paka-project"`. `version` is the integer schema
version described under [Versioning](#versioning).

### `document`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Document id, unique within the file. |
| `name` | string | The drawing's own label. Independent of the file name. |
| `width`, `height` | number | Document size in document pixels; must be 8-8192. |
| `background` | string | CSS colour of the paper, drawn below every layer. |
| `activeLayerId` | string \| null | Layer selected when the file was written. |

### `layers[]`

Bottom-most layer first, matching both the in-memory document order and the
compositing order. A file must contain at least one layer.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Layer id; must be unique within the file. |
| `name` | string | Shown in the layers panel. |
| `visible` | boolean | Hidden layers are skipped by the compositor and by PNG export. |
| `opacity` | number | 0-1, applied to the whole layer. |
| `blendMode` | string | `"normal"` only today. |
| `strokes` | array | Strokes of this layer, in painting order. |

A stroke's layer is implied by the layer that contains it; there is no
`layerId` field inside a stroke, which makes it impossible for a stroke to
disagree with its own layer.

### `strokes[]`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stroke id. |
| `brush` | object | The brush used, captured per stroke so later brush changes do not alter it. |
| `erase` | boolean? | `true` only for eraser strokes, which subtract coverage from the layer instead of painting. Absent means paint. |
| `startTime` | number | Timestamp of the first sample, for diagnostics; not used for rendering. |
| `xs`, `ys` | number[] | Document-space centre of each sample. |
| `pressures` | number[] | 0-1 per sample. |
| `times` | number[] | Milliseconds from `startTime`, per sample. |

The four sample arrays are parallel and must all have the same length. Samples
are stored as the pointer produced them (already smoothed by `StrokeBuilder`);
the file contains no interpolation state, so re-rasterizing from the file
reproduces the stroke exactly.

Strokes are applied in array order: a paint stroke composites its coverage at
the brush's opacity, an eraser stroke subtracts its coverage at the same
opacity. The order is therefore part of the drawing, and a reader must not
reorder or drop strokes.

An eraser stroke's `brush.color` is written but ignored - erasing has no colour.
Keeping the field means one brush shape describes both tools, and a stroke stays
re-renderable if the brush model changes.

A shape drawn with the line, rectangle or ellipse tool is an **ordinary stroke**:
its outline is stored in `xs`/`ys` as a short polyline - two points for a line,
four corners plus the repeated first point for a rectangle, and a closed run of
short segments for an ellipse - with `pressures` all `1`, so a shape has the
brush's constant full width. There is no `kind` or geometry field, which is why
adding shape tools changed neither the format nor the version: a reader that
already knows strokes reproduces shapes, and undo, reopen and export treat them
exactly like any other stroke.

### `brush`

| Field | Range | Meaning |
| --- | --- | --- |
| `size` | 1-512 | Diameter in document pixels at full pressure. |
| `opacity` | 0-1 | Alpha for the whole stroke, applied once when it composites. |
| `color` | non-empty string | CSS colour. |
| `pressureSize` | 0-1 | How strongly pressure narrows each segment of the stroke. |
| `pressureOpacity` | 0-1 | How strongly the stroke's **mean** pressure fades it (opacity is per stroke, not per sample). |
| `minSizeRatio` | 0.02-1 | Floor for the pressure-narrowed diameter. |
| `spacing` | 0.02-2 | Sample spacing as a fraction of the diameter (used when smoothing). |

## Validation policy

`parseProject(text)` never throws. It returns
`{ ok: true, project, warnings }` or `{ ok: false, error }`, where `error` is a
sentence intended for the user.

**Strict - the file is refused** when a value could change what the drawing
looks like:

- contents that are not JSON, or a `format` that is not `paka-project`;
- a missing, non-integer, older-than-1 or newer-than-supported `version`;
- document dimensions outside 8-8192, or non-finite numbers anywhere;
- a missing/empty layer list, a duplicate layer id, a missing id;
- `opacity` outside 0-1, non-boolean `visible`, an unknown `blendMode`;
- a non-boolean `erase` flag on a stroke;
- sample arrays that are not arrays, disagree in length, or contain non-finite
  values;
- brush fields outside their ranges;
- more than `MAX_PROJECT_SAMPLES` (5,000,000) sample points.

**Lenient - repaired with a warning** when only cosmetics are affected:

- a missing/blank document name → `"Untitled"`;
- an unusable `background` → white;
- a missing/blank layer name → `"Layer N"`;
- an `activeLayerId` that is not in the file → the bottom layer is selected;
- a missing/non-numeric `startTime` → `0`;
- a missing `erase` flag → the stroke paints (which is what every version-1
  stroke does).

Warnings are surfaced after opening, not hidden: `FileOutcome.opened` carries
them and the status bar shows them.

Two further guarantees:

- **Ids are reserved.** Layer, document and stroke ids read from a file advance
  the id counters, so layers created after opening a project cannot collide with
  ids that came from the file.
- **A rejected file changes nothing.** Open parses and validates *before* the
  engine is touched, so a corrupt or unsupported file leaves the current drawing
  exactly as it was, unsaved marker included.

## Versioning

`version` is an integer starting at 1.

| Version | Reading it | Writing it |
| --- | --- | --- |
| 1 | Metadata, layers and brush strokes. | - |
| 2 | Adds `erase` on strokes. Reads version-1 files unchanged. | The current version; what this build always writes. |

- **Additive, ignorable fields may be added within a version** (a reader that
  does not know them ignores them). Extra fields are ignored by design, which is
  what makes the format easy to extend.
- **Anything a reader cannot ignore - a removed field, a changed meaning, a new
  required field - requires a version bump.** A v1 reader then refuses the file
  with "created by a newer version of Paka" instead of mis-reading it.
- **Downgrades are not supported.** A file written by a newer version is never
  opened by an older one; there is no lossy migration path.
- **`erase` is why version 2 exists.** It is not an ignorable extra: a version-1
  reader that skipped it would *paint* an eraser stroke, producing a visibly
  different drawing. Refusing the file is the honest outcome, so the version was
  bumped the moment the field could appear.

`PROJECT_VERSION` in `projectFormat.ts` is the single source of truth for the
version a build writes and the highest it reads.

## File operations

| Action | Shortcut | Behaviour |
| --- | --- | --- |
| File → New Document… | - | Confirms first if there is unsaved work. Resets path, dirty flag and history. |
| File → Open… | `Ctrl+O` | Native open dialog, `.paka`/`.json`. Parses before replacing anything. |
| File → Save | `Ctrl+S` | Writes to the known path, or falls back to Save As the first time. |
| File → Save As… | `Ctrl+Shift+S` | Native save dialog; appends `.paka` if the name has no extension. |
| File → Export PNG… | - | Saves the composite as a PNG; the editable document is untouched. |

Guarantees:

- **Writes are atomic.** Rust writes a sibling temporary file, flushes it to the
  device (`sync_all`), then renames it over the target. An interrupted save
  leaves either the old file or the new one, never a partial file, and never
  leaves a temporary behind.
- **The unsaved marker only clears after a successful write.** A failed write
  keeps the document dirty and keeps the old path, so retrying is a normal save.
- **The unsaved marker is a revision comparison**, not a snapshot. Undoing back
  to the last saved state does *not* clear it (the revision counter is
  monotonic). The window title shows `•` and the status bar shows the document
  name plus an `unsaved` marker.
- **Discarding work is always confirmed.** New, Open and window close (title bar
  or Alt+F4) all offer Cancel / Save first / Discard when the drawing is dirty;
  "Save first" only continues when the write actually happened.
- **The WebView has no filesystem access.** Three scoped Rust commands do the
  I/O - `read_text_file`, `write_text_file_atomic`, `write_binary_file_atomic` -
  each of which validates the path, restricts the file extension
  (`.paka`/`.json` for projects, `.png` for images) and caps how much it will
  read (256 MiB). Paths come from native dialogs the user interacted with
  (`tauri-plugin-dialog`); `tauri-plugin-fs` is deliberately not installed.

## PNG export

Export composites the document - paper plus visible layers - into a fresh canvas
at exactly `document.width × document.height`, encodes it with the platform's
own PNG encoder (`canvas.toBlob`), and writes the bytes. It never touches the
document, its layers, its strokes or the display canvas, and it does not clear
the unsaved marker: exporting is not saving.

Hidden layers and layers at 0 opacity are excluded, matching what is on screen.
The output has no border, no zoom and no surrounding UI.

## Known gaps

- **No compression.** Text JSON, so files are large for heavy drawings.
- **A single file must hold everything.** There are no external links or
  incremental saves; saving rewrites the whole file.
- **The format has one blend mode**, so `blendMode` carries no information yet.
- **No autosave and no recovery file.** An unclean exit loses unsaved work; the
  close guard is the only protection.
- **Metadata is minimal**: no author, no timestamps, no thumbnails, no colour
  profile. The envelope is versioned so those can be added additively.
