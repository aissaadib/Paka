# Paka project format (`.paka`)

A project file is **UTF-8 JSON text with a versioned envelope**. It stores the
document's metadata and the ordered element data that produced its pixels -
brush strokes, serialized bucket-fill patches and gradient geometry - not a
flattened image.

Implementation: `src/core/project/projectFormat.ts` (format + parser),
`src/core/project/projectFiles.ts` (open/save/export workflow),
`src-tauri/src/project_io.rs` (the actual disk access).

## Why records and not a flattened image

In this engine the ordered element list *is* the authoritative record; layer
pixels are a cache rasterized from it (see `docs/ARCHITECTURE.md`). Saving the
elements keeps every layer editable after a reload:

- individual elements stay undoable/redoable, one history step per stroke, fill
  patch or gradient;
- nothing is resampled, so reopening never degrades a drawing;
- file size is independent of the display resolution and of `rasterScale`;
- a future brush model can re-render existing strokes with a new look.

A fill is stored as the pixels it committed - colour, bounding box and a
coverage mask - rather than as the seed point and tolerance that found them.
That is what makes a reopened project show exactly the same pixels: the file
does not depend on what the composite happens to look like later, and reading it
never re-runs flood fill.

A gradient takes the opposite approach because its pixels are a function, not a
region: the file stores the type, endpoints, colour stops and opacity, and the
renderer rebuilds it deterministically. No gradient pixel snapshot exists.

Saving a flattened PNG (or per-layer PNG buffers) would trade all of that away
for a smaller file. That trade is the reason a compressed or binary container is
on the roadmap rather than flattening.

What is deliberately **not** in the file is editor state: the undo history, the
zoom/pan viewport, the current tool, brush, shape-fill, bucket-tolerance and
gradient-option settings, and the current selection. A project stores the
*drawing*, so reopening restores the elements and their layers rather than the
editing session that produced them. (The current brush selection is session
state; each stroke stores its own full brush, including `hardness` and the
sampling settings `spacing` and `stabilizer`. Selection is
derived from strokes at run
time anyway - see
[ARCHITECTURE.md](ARCHITECTURE.md#selection-and-transform) - so it needs no
field; the fill setting is stored per stroke, not per document, so the shapes
that were filled stay filled without a session-level flag; a bucket tolerance
describes the *next* fill and gradient options describe the *next* drag, while a
committed element carries its own pixels or geometry.)

**The trade-off is real:** JSON number arrays are verbose. A stroke sample costs
roughly 40-60 bytes of text on disk (four numbers plus separators), so a heavy
drawing can reach tens of megabytes. A fill mask costs about 1.33 bytes per
pixel after base64 (4/3 of one coverage byte), and a full-canvas fill can
therefore be several megabytes by itself. A gradient costs only a handful of
numbers and stops, so its file cost is negligible. A compressed or binary
container is
the natural next container; the parser is structured so a new *encoding* can be
added without changing the model.

## Envelope

```json
{
  "format": "paka-project",
  "version": 9,
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
      "elements": [
        {
          "kind": "stroke",
          "id": "stroke-3",
          "brush": {
            "size": 6,
            "opacity": 1,
            "color": "#16181c",
            "hardness": 1,
            "pressureSize": 0.6,
            "pressureOpacity": 0,
            "minSizeRatio": 0.12,
            "spacing": 0.12,
            "stabilizer": 0,
            "texture": 0,
            "stamp": false,
            "stampSpacing": 0.1,
            "stampHardness": 1,
            "stampTexture": 0,
            "pressureCurve": [
              { "x": 0, "y": 0 },
              { "x": 1, "y": 1 }
            ],
            "taper": {
              "enabled": false,
              "startLength": 0,
              "startStrength": 0,
              "endLength": 0,
              "endStrength": 0
            }
          },
          "startTime": 1730000000000,
          "xs": [100, 104.5, 109],
          "ys": [200, 205.25, 210],
          "pressures": [0.62, 0.7, 0.55],
          "times": [0, 8.3, 16.9]
        },
        {
          "kind": "stroke",
          "id": "stroke-4",
          "erase": true,
          "brush": {
            "size": 24,
            "opacity": 1,
            "color": "#16181c",
            "hardness": 1,
            "pressureSize": 0,
            "pressureOpacity": 0,
            "minSizeRatio": 0.12,
            "spacing": 0.12,
            "stabilizer": 0,
            "texture": 0,
            "stamp": false,
            "stampSpacing": 0.1,
            "stampHardness": 1,
            "stampTexture": 0,
            "pressureCurve": [
              { "x": 0, "y": 0 },
              { "x": 1, "y": 1 }
            ],
            "taper": {
              "enabled": false,
              "startLength": 0,
              "startStrength": 0,
              "endLength": 0,
              "endStrength": 0
            }
          },
          "startTime": 1730000004000,
          "xs": [104, 108],
          "ys": [206, 240],
          "pressures": [0.5, 0.5],
          "times": [0, 9.1]
        },
        {
          "kind": "stroke",
          "id": "stroke-5",
          "fill": true,
          "brush": {
            "size": 6,
            "opacity": 1,
            "color": "#16181c",
            "hardness": 1,
            "pressureSize": 0.6,
            "pressureOpacity": 0,
            "minSizeRatio": 0.12,
            "spacing": 0.12,
            "stabilizer": 0,
            "texture": 0,
            "stamp": false,
            "stampSpacing": 0.1,
            "stampHardness": 1,
            "stampTexture": 0,
            "pressureCurve": [
              { "x": 0, "y": 0 },
              { "x": 1, "y": 1 }
            ],
            "taper": {
              "enabled": false,
              "startLength": 0,
              "startStrength": 0,
              "endLength": 0,
              "endStrength": 0
            }
          },
          "startTime": 1730000012000,
          "xs": [300, 500, 500, 300, 300],
          "ys": [400, 400, 600, 600, 400],
          "pressures": [1, 1, 1, 1, 1],
          "times": [0, 60, 120, 180, 240]
        },
        {
          "kind": "fill",
          "id": "fill-6",
          "color": "#e5484d",
          "x": 304,
          "y": 404,
          "width": 4,
          "height": 3,
          "mask": "////////////////"
        },
        {
          "kind": "gradient",
          "id": "gradient-7",
          "type": "linear",
          "x1": 0,
          "y1": 600,
          "x2": 1600,
          "y2": 600,
          "stops": [
            { "offset": 0, "color": "#16181c" },
            { "offset": 1, "color": "#f4f1ea" }
          ],
          "opacity": 0.5
        }
      ]
    }
  ]
}
```

The second stroke is an eraser stroke: its `erase` flag makes it subtract coverage
from the pixels painted before it instead of adding colour. The third is a filled
rectangle: its `fill` flag makes a reader fill the area its samples bound before
tracing them, so the interior is solid rather than empty. The fourth element is a
bucket fill: it paints its opaque colour through the 4x3 coverage mask at
`(304, 404)` and is ordered after the strokes, so it covers them. The gradient is
a half-opacity linear ramp across the document, ordered after everything else, so
it paints over them on that layer.

### `format`, `version`

`format` must be exactly `"paka-project"`. `version` is the integer schema
version described under [Versioning](#versioning).

### `document`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Document id, unique within the file. |
| `name` | string | The drawing's own label. Independent of the file name. |
| `width`, `height` | number | Document size in document pixels; must be 8-8192 per side and at most 16,777,216 px in total. |
| `background` | string | CSS colour of the paper, drawn below every layer. |
| `activeLayerId` | string \| null | Layer selected when the file was written. |
| `guides` | array | The composition guides. **Additive**: a file without the field opens with no guides. |

#### `guides[]`

A guide is a marker on one axis, in document pixels.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Guide id; must be unique within the file. |
| `axis` | string | `"vertical"` (the guide stands at an x) or `"horizontal"` (at a y). |
| `position` | number | The position along the guide's axis, in document pixels. Rounded to a whole pixel when read. |

The guides are **display-only**: they are painted over the artwork on the
display canvas and never reach a layer surface or a PNG export. A reader that
does not know the field therefore draws the very same picture, which is why the
field is additive and the file version did not move.

Reading is forgiving, like the rest of the format: a file with no `guides`
field opens with no guides, a `guides` field that is not a list is ignored with
a warning, and a guide with an unknown axis, a non-finite position, a missing
id or a duplicate id is dropped with a warning rather than making the file
unopenable - a decorative overlay must never cost the user their drawing. A
file with more than 10,000 guides is **refused**, like the sample and
fill-pixel ceilings.

### `layers[]`

Bottom-most layer first, matching both the in-memory document order and the
compositing order. A file must contain at least one layer.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Layer id; must be unique within the file. |
| `name` | string | Shown in the layers panel. |
| `visible` | boolean | Hidden layers are skipped by the compositor and by PNG export. |
| `opacity` | number | 0-1, applied to the whole layer. |
| `blendMode` | string | `"normal"`, `"multiply"`, `"screen"`, `"overlay"`, `"soft-light"`, `"hard-light"`, `"color-dodge"`, `"darken"`, `"lighten"`, `"difference"` or `"exclusion"`; applied to the whole layer against the paper and the layers below it. |
| `elements` | array | Strokes, fill patches and gradients of this layer, in painting order. |

A layer's content is one ordered `elements` list. Each element has a `kind`
discriminator: `"stroke"`, `"fill"` or `"gradient"`. A reader rejects an unknown
kind rather than silently dropping content, and versions 1-3 store the same
ordered list under `strokes` with no `kind` (every entry there is a stroke).

An element's layer is implied by the layer that contains it; there is no
`layerId` field inside an element, which makes it impossible for content to
disagree with its own layer.

### `elements[]`

The `kind` field decides the element shape. Painting order is array order:
strokes, fills and gradients interleave exactly as the user made them, and a
reader must not reorder or drop elements.

#### Strokes

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `"stroke"` | Element discriminator. Required in version 4. |
| `id` | string | Stroke id. |
| `brush` | object | The brush used, including `hardness`, `spacing` and `stabilizer`, captured per stroke so later brush changes do not alter it. |
| `erase` | boolean? | `true` only for eraser strokes, which subtract coverage from the layer instead of painting. Absent means paint. |
| `fill` | boolean? | `true` only for filled shapes, whose samples bound the area to fill rather than a path to trace. Absent means trace. |
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
reorder or drop elements.

An eraser stroke's `brush.color` is written but ignored - erasing has no colour.
Keeping the field means one brush shape describes both tools, and a stroke stays
re-renderable if the brush model changes.

A shape drawn with the line, rectangle, ellipse, polygon or star tool is an
**ordinary stroke**:
its outline is stored in `xs`/`ys` as a short polyline - two points for a line,
four corners plus the repeated first point for a rectangle, a closed run of
short segments for an ellipse, and the outline's own vertices for a polygon or
a star - with `pressures` all `1`, so a shape has the
brush's constant full width. There is no geometry field, which is why
adding shape tools needed no new element kind: a reader that already knows
strokes reproduces shapes, and undo, reopen and export treat them exactly like
any other stroke.

A rectangle, ellipse, polygon or star committed with the fill setting on adds
one boolean,
`fill: true`, to that same stroke: the samples still trace the outline, and a
reader fills the polygon they bound before tracing it. It is a stroke-level flag
rather than a document- or layer-level one, so a single layer can mix filled
shapes, outlines and brush strokes in painting order, and the fill re-rasterizes
from the file with no extra state. `fill` is why version 3 exists: a version-2
reader would trace a filled shape's outline and leave the interior empty - a
visibly different drawing - so it must refuse the file rather than mis-read it
(see [Versioning](#versioning)).

#### Fills

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `"fill"` | Element discriminator. Required in version 4. |
| `id` | string | Fill-patch id. |
| `color` | string | Non-empty CSS colour. The patch paints this colour. |
| `x`, `y` | number | Bounding-box origin in document pixels (`0 <= x < width`, same for `y`). |
| `width`, `height` | number | Bounding-box size in pixels; must fit inside the document. |
| `mask` | string | Standard base64 of exactly `width * height` coverage bytes. |

Byte `i` of the decoded mask is the coverage of pixel
`(x + i % width, y + floor(i / width))`. `0` leaves the layer alone and `255`
paints the colour at full coverage; the current engine writes only those two
values (a binary mask), so a region's anti-aliased boundary is either selected
or not - no invented feathering. The mask is cropped to the filled pixels'
bounding box, so a small fill on a large canvas stores only its own pixels.

A fill's pixels are the result, not a seed and tolerance. Reopening or redoing
replays the mask; it does not re-scan the composite. That is what makes a
committed fill identical after save/reopen and undo/redo even if the artwork
under it changes later. A fill element is opaque in the file's model (its
`color` has no alpha field), and its patch is painted in element order like a
stroke.

The parser accepts any byte value in the mask (the renderer uses it as alpha)
but the engine only creates `0`/`255`. This leaves room for a future
anti-aliased patch without another format version, while a binary mask remains
the current guarantee.

#### Gradients

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `"gradient"` | Element discriminator. Required in version 5. |
| `id` | string | Gradient id. |
| `type` | `"linear"` \| `"radial"` | Interpolation shape. |
| `x1`, `y1` | number | Axis start (linear) or centre (radial), within the document. |
| `x2`, `y2` | number | Axis end (linear) or radius endpoint (radial), within the document. |
| `stops` | array | 2-64 `{ offset, color }` objects in strictly ascending `offset` order. |
| `opacity` | 0-1 | Alpha for the whole gradient, applied once when it paints. |

A linear gradient interpolates along the segment from `(x1, y1)` to `(x2, y2)`.
A radial gradient centres on `(x1, y1)` and uses the distance to `(x2, y2)` as
its outer radius (the inner radius is always `0`). Stop `offset` is `0..1` along
that axis, and its `color` is a `#rrggbb` or `#rgb` hex string. The gradient
tool writes the brush colour at `0`, the toolbar end colour at `1`, and any
middle stops the stop editor added between them. The schema already allowed
2-64 stops, so the editor needed no version bump; an older reader in the same
version range paints every stop it is given.

A gradient element paints over its entire layer, in element order. There is no
bounding box because the colour function covers the whole surface; an opaque
gradient therefore covers earlier elements on the same layer. Reopening or redoing
re-creates it from geometry and stops - there is no pixel snapshot in the file.

### `brush`

| Field | Range | Meaning |
| --- | --- | --- |
| `size` | 1-512 | Diameter in document pixels at full pressure. |
| `opacity` | 0-1 | Alpha for the whole stroke, applied once when it composites. |
| `color` | non-empty string | CSS colour. The colour wheel, the toolbar's colour input, the swatches and the canvas picker all write this same field, so picking a colour never changes the format. |
| `hardness` | 0-1 | Edge falloff: `1` is the hard edge, lower values feather the finished silhouette. Required in version 6; version-1 to -5 files have no field and read as `1`. |
| `pressureSize` | 0-1 | How strongly pressure narrows each segment of the stroke. |
| `pressureOpacity` | 0-1 | How strongly the stroke's **mean** pressure fades it (opacity is per stroke, not per sample). |
| `pressureCurve` | 2-32 points | Piecewise-linear map from raw device pressure (`x`) to the response the brush uses (`y`), both in 0-1. Stored samples keep raw pressure, so the map is applied once at rasterization and is identical in live drawing, layer rebuilds, undo/redo, reopen and export. Required in version 12; version-1 to -11 files read as the identity curve, which is the linear response they were written by. |
| `minSizeRatio` | 0.02-1 | Floor for the pressure-narrowed diameter. |
| `spacing` | 0.02-2 (UI 2-200 %) | Sample spacing as a fraction of the diameter: lower values interpolate fast moves more densely. It changes the captured samples, not the brush width. |
| `stabilizer` | 0-1 | Pointer smoothing strength applied before samples are captured. Additive within version 6: a missing field reads as `0` (the raw path). |
| `texture` | 0-1 | Strength of the deterministic, document-anchored grain applied once to the finished stroke coverage. `0` is the plain coverage. Required in version 7; version-1 to -6 files have no field and read as `0`. |
| `stamp` | boolean | Whether the stroke is rasterized as a chain of round dabs instead of round-capped segments. `false` is the legacy segment path. Required in version 9; version-1 to -8 files have no field and read as `false`. |
| `stampSpacing` | 0.02-1 (UI 2-100 %) | Distance between dab centres as a fraction of the brush's nominal size. Required in version 9; version-1 to -8 files have no field and read as the default. |
| `stampHardness` | 0-1 | Radial falloff of one dab: `1` is a crisp dab edge, lower values widen the falloff towards the dab's centre. Required in version 9; version-1 to -8 files have no field and read as the default. |
| `stampTexture` | 0-1 | Strength of the **per-dab directional texture**: the bristle lanes that run along the stroke. `0` is the plain round dab, byte for byte. Only a stamped stroke is affected. Required in version 10; version-1 to -9 files have no field and read as `0`. |
| `taper` | object | The **width ramp** at the start and the end of the stroke: `enabled` (a boolean), `startLength` and `endLength` (0-2, the ramp's length as a fraction of the brush's nominal size) and `startStrength` and `endStrength` (0-1, how much narrower the stroke is at the very tip; `1` is a point). The taper narrows the stroke's **width** after the pressure response, so it can go below the brush's minimum size. It is off by default, and a stroke with no path (a tap) is drawn at its full width. Required in version 13; version-1 to -12 files have no field and read as the taper off, which is exactly the coverage they were written by. |

## Validation policy

`parseProject(text)` never throws. It returns
`{ ok: true, project, warnings }` or `{ ok: false, error }`, where `error` is a
sentence intended for the user.

**Strict - the file is refused** when a value could change what the drawing
looks like:

- contents that are not JSON, or a `format` that is not `paka-project`;
- a missing, non-integer, older-than-1 or newer-than-supported `version`;
- document dimensions outside 8-8192 per side, more than 16,777,216 pixels in
  total, or non-finite numbers anywhere;
- a missing/empty layer list, a duplicate layer id, a missing id;
- `opacity` outside 0-1, non-boolean `visible`, an unknown `blendMode`;
- a version-4+ element whose `kind` is missing or not `"stroke"`, `"fill"` or
  `"gradient"`, or a gradient in a version-4 file;
- a non-boolean `erase` flag on a stroke;
- a non-boolean `fill` flag on a stroke;
- sample arrays that are not arrays, disagree in length, or contain non-finite
  values;
- brush fields outside their ranges, including a version-6 `hardness` that is
  missing or outside `0..1` (older versions have no field and default to `1`),
  a `stabilizer` present but outside `0..1`, a version-7 `texture` that is
  missing or outside `0..1`, and a version-9 `stamp` that is not a boolean or a
  `stampSpacing`/`stampHardness` that is missing or outside its range;
- more than `MAX_PROJECT_SAMPLES` (5,000,000) sample points;
- a fill's `color` that is missing or empty;
- fill `x`/`y` outside the document, or non-integer/oversized `width`/`height`
  whose box leaves the document;
- a fill `mask` that is not valid standard base64, or whose decoded length is
  not exactly `width * height`;
- more than `MAX_PROJECT_FILL_PIXELS` (16,777,216) fill-mask pixels across the
  whole file, which bounds both parsing memory and the mask work;
- a gradient with an unknown `type`, fewer than two or more than
  `MAX_PROJECT_GRADIENT_STOPS` (64) stops, a non-hex stop colour, offsets outside
  `0..1` or not strictly ascending, endpoints outside the document, or opacity
  outside `0..1`;
- more than `MAX_PROJECT_GUIDES` (10,000) composition guides.

**Lenient - repaired with a warning** when only cosmetics are affected:

- a missing/blank document name → `"Untitled"`;
- an unusable `background` → white;
- a missing/blank layer name → `"Layer N"`;
- an `activeLayerId` that is not in the file → the bottom layer is selected;
- a missing/non-numeric `startTime` → `0`;
- a missing `erase` flag → the stroke paints (which is what every version-1
  stroke does);
- a missing `fill` flag → the stroke traces its outline (which is what every
  version-1 and -2 shape does);
- a missing `stabilizer` → `0`. This is an additive field within version 6: the
  stored samples already describe the smoothed path, so old version-6 files and
  all earlier versions render exactly as they did;
- a missing `texture` in a version-1 to -6 file → `0`. Version 7 requires it
  because a version-6 reader would ignore a textured stroke and draw it plain;
- a missing `stamp` in a version-1 to -8 file → `false`, and missing
  `stampSpacing`/`stampHardness` → their defaults. The stamp did not exist
  before version 9, and the stamp off is exactly the segment path those files
  were written by;
- a missing `stampTexture` in a version-1 to -9 file → `0`. The per-dab
  texture did not exist before version 10, and the texture off is exactly the
  coverage those files were written by;
- a missing `taper` in a version-1 to -12 file → the taper off. The taper did
  not exist before version 13, and the taper off is exactly the coverage those
  files were written by;
- a missing `guides` field → no guides. This is an additive field within
  version 9: the guides are display-only, so a file without them opens exactly
  as it always did;
- a `guides` field that is not a list → ignored;
- a guide with an unknown `axis`, a non-finite `position`, a missing id or a
  duplicate id → that guide is dropped. A decorative overlay must never make a
  drawing unopenable;
- a guide `position` that is not a whole pixel → rounded to the nearest one.

A version-12 `pressureCurve` is repaired **without a warning**: a missing field, a
non-list, fewer than two usable points, non-finite coordinates or a duplicate
pressure becomes the identity curve. The stroke's samples are untouched and the
field is a response map, so the fallback opens the file at exactly the linear
profile a version-11 file had instead of refusing the drawing.

Warnings are surfaced after opening, not hidden: `FileOutcome.opened` carries
them and the status bar shows them.

Two further guarantees:

- **Ids are reserved.** Layer, document, stroke, fill, gradient and guide ids
  read from a file advance the id counters, so layers, elements or guides
  created after opening a project cannot collide with ids that came from the
  file.
- **A rejected file changes nothing.** Open parses and validates *before* the
  engine is touched, so a corrupt or unsupported file leaves the current drawing
  exactly as it was, unsaved marker included.

## Versioning

`version` is an integer starting at 1.

| Version | Reading it | Writing it |
| --- | --- | --- |
| 1 | Metadata, layers and brush strokes. | - |
| 2 | Adds `erase` on strokes. Reads version-1 files unchanged. | - |
| 3 | Adds `fill` on strokes. Reads version-1 and -2 files unchanged (their shapes all trace their outline). | - |
| 4 | Reads `layers[].elements` with `kind: "stroke"` and `kind: "fill"`; reads version-1 to -3 files through their `strokes` array. | - |
| 5 | Adds `kind: "gradient"` to elements; reads version-1 to -4 files unchanged. | - |
| 6 | Requires `hardness` on every stroke brush; reads version-1 to -5 files unchanged and defaults their strokes to a hard edge (`1`). | Writes the additive `stabilizer` field too. |
| 7 | Requires `texture` on every stroke brush; reads version-1 to -6 files unchanged and defaults their strokes to `0` (the plain coverage). | Writes the required `texture` field. |
| 8 | Allows `blendMode` `"multiply"` and `"screen"` in addition to `"normal"`; reads version-1 to -7 files unchanged. | - |
| 9 | Requires `stamp`, `stampSpacing` and `stampHardness` on every stroke brush; reads version-1 to -8 files unchanged and defaults their strokes to the segment path (`stamp` off). | - |
| 10 | Requires `stampTexture` on every stroke brush; reads version-1 to -9 files unchanged and defaults their strokes to the plain dabs (`stampTexture` off). | - |
| 11 | Allows `blendMode` `"overlay"`, `"soft-light"`, `"hard-light"`, `"color-dodge"`, `"darken"`, `"lighten"`, `"difference"` and `"exclusion"` in addition to the version-8 modes; reads version-1 to -10 files unchanged. | - |
| 12 | Requires `pressureCurve` on every stroke brush; reads version-1 to -11 files unchanged and defaults their strokes to the identity curve (the linear response they were written by). | - |
| 13 | Requires `taper` on every stroke brush; reads version-1 to -12 files unchanged and defaults their strokes to the taper off (the coverage they were written by). | The current version; what this build always writes. |

- **Additive, ignorable fields may be added within a version** (a reader that
  does not know them ignores them). Extra fields are ignored by design, which is
  what makes the format easy to extend.
- **The document pixel limit is a safety limit, not a schema change.** A file
  whose `document.width * document.height` exceeds 16,777,216 is refused by the
  reader because rasterizing its surfaces would be unsafe, not because an older
  reader would draw the picture differently, so the format version is unchanged
  and files inside the limit are read exactly as before.
- **`stabilizer` is the first field added under that rule.** It shapes the
  samples at draw time, and those samples are already stored, so a version-6
  reader that skips the field still renders the identical picture. Missing reads
  as `0`; when present it must still be a number in `0..1`.
- **`document.guides` is additive within version 9 and later.** The composition
  guides are display-only: they are painted over the artwork and never reach a
  layer surface or a PNG export. A reader that skips the field draws the
  identical picture, so the field needed no version bump - the same situation as
  `stabilizer` within version 6. A file without the field opens with no guides;
  a file with them round-trips exactly.
- **`texture` required version 7.** It changes how stored samples are
  rasterized, so a version-6 reader that ignored it would draw a textured stroke
  plain. That is the same reason `hardness` required version 6; neither field
  could be added additively.
- **`stamp` required version 9.** It changes how the stored samples are
  rasterized - a chain of dabs instead of round-capped segments - so a
  version-8 reader that ignored it would draw a stamped stroke as a plain one,
  which is a different picture. Version-1 to -8 files read with the stamp off,
  which is exactly the path they were written by.
- **`stampTexture` required version 10**, for the same reason. It changes how a
  stamped stroke's samples are rasterized - the dabs carry bristle lanes
  instead of being plain discs - so a version-9 reader that ignored it would
  draw the same stroke as a plain chain of dabs, which is a different picture.
  Version-1 to -9 files read with the texture off, which is exactly the
  coverage they were written by.
- **`pressureCurve` required version 12.** It changes how stored samples are
  rasterized - a bent response widens or narrows parts of the stroke - so a
  version-11 reader that ignored it would draw the linear profile instead, which
  is a different picture. Version-1 to -11 files read with the identity curve,
  which is exactly the linear response they were written by.
- **`taper` required version 13.** It changes how stored samples are rasterized -
  the ends of the stroke are narrower than the brush - so a version-12 reader
  that ignored it would draw the same samples at their full width, which is a
  different picture. Version-1 to -12 files read with the taper off, which is
  exactly the coverage they were written by.
- **Anything a reader cannot ignore - a removed field, a changed meaning, a new
  required field - requires a version bump.** A v1 reader then refuses the file
  with "created by a newer version of Paka" instead of mis-reading it.
- **Downgrades are not supported.** A file written by a newer version is never
  opened by an older one; there is no lossy migration path.
- **`erase` is why version 2 exists.** It is not an ignorable extra: a version-1
  reader that skipped it would *paint* an eraser stroke, producing a visibly
  different drawing. Refusing the file is the honest outcome, so the version was
  bumped the moment the field could appear.
- **`fill` is why version 3 exists**, for the same reason: a version-2 reader
  would trace a filled shape's outline and leave its interior empty. The flag
  itself is additive (an outline-only drawing is byte-identical to version 2's
  output), but *ignoring* it changes the picture, which is what forces the bump.
- **Ordered elements are why version 4 exists.** A version-3 reader looks for
  `layers[].strokes`; it cannot read a fill, and a fill interleaved with strokes
  cannot be expressed as the old array without losing painting order. Moving to
  `layers[].elements` is therefore a required new shape, so the version was
  bumped and version-1 to -3 files are read through their `strokes` array as
  stroke-only element lists.
- **Gradients are why version 5 exists.** A version-4 reader rejects an unknown
  element kind, so it would refuse the file rather than mis-read it, but the
  schema still gained a required new element shape. Version-1 to -4 files contain
  no gradient and open unchanged.
- **Hardness is why version 6 exists.** It is not an ignorable extra: a
  version-5 reader would skip the field, draw every stroke with a hard edge, and
  produce a visibly different picture for any soft stroke. Every version-6 brush
  must therefore carry `hardness` in `0..1`; version-1 to -5 files predate the
  field and are read with `hardness = 1`, which is exactly what those files could
  have produced.
- **Blend modes are why version 8 exists.** A layer's `blendMode` may now be
  `multiply` or `screen` as well as `normal`. A version-7 reader validates the
  value and rejects anything but `normal`, so it refuses a version-8 file
  instead of silently compositing it normally - a visibly different picture.
  Version-1 to -7 files always carry `normal` and open unchanged; the field was
  already required, so there is no missing-value default.
- **Version 11 extends the same closed set.** The added modes are standard
  separable W3C blend functions (overlay, soft-light, hard-light, color-dodge,
  darken, lighten, difference, exclusion), each mapped one-to-one to the Canvas
  2D operation of the same name. A version-10 reader rejects those strings, so
  the version was bumped rather than allowing a file to be silently composited
  with the wrong mode. Version-1 to -10 files still open unchanged.
- **Stroke flags are still written only when set.** A stroke that paints and
  traces carries no `erase` or `fill` field; the only new mandatory stroke field
  in version 4 is `kind: "stroke"`, which distinguishes it from the other element
  kinds in the shared list. Version-3 files have no `kind` on their `strokes`
  entries and are read as strokes.

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

- **No compression.** Text JSON, so files are large for heavy drawings. Fill
  masks are base64, about 1.33 bytes per covered bounding-box pixel.
- **A fill mask is bounded but not compressed.** A full-canvas fill on a large
  document is a multi-megabyte base64 string; the parse ceiling is 16,777,216
  mask pixels per file.
- **A single file must hold everything.** There are no external links or
  incremental saves; saving rewrites the whole file.
- **No non-separable blend modes**: the layer menu offers the separable modes
  (`normal`, `multiply`, `screen`, `overlay`, `soft-light`, `hard-light`,
  `color-dodge`, `darken`, `lighten`, `difference`, `exclusion`). Hue,
  saturation, color and luminosity are not exposed, and there are no
  group/clipping contexts or alpha inheritance.
- **No autosave and no recovery file.** An unclean exit loses unsaved work; the
  close guard is the only protection.
- **Metadata is minimal**: no author, no timestamps, no thumbnails, no colour
  profile. The envelope is versioned so those can be added additively.
