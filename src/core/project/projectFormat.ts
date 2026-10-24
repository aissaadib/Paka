/**
 * The Paka project format.
 *
 * A project file is a versioned JSON document. It stores **metadata plus the
 * content that produced the pixels**, never a flattened image:
 *
 * ```
 * { format, version, document: {...}, layers: [ { ...layer, elements: [...] } ] }
 * ```
 *
 * Why records and not pixel buffers: in this engine the ordered element list
 * *is* the authoritative record (pixels are a cache rasterized from it). Saving
 * strokes, fill patches and gradients keeps every layer editable after a reload
 * - individual elements stay undoable, nothing is resampled, and file size does
 * not depend on the display resolution the drawing happened to be made at.
 * Storing a flattened PNG would destroy exactly that.
 *
 * The parser is deliberately strict about anything that could corrupt a
 * drawing (dimensions, layer ids, stroke sample arrays) and forgiving about
 * cosmetics (a missing document name), reporting the latter as warnings. A
 * rejected file never touches the open document.
 */

import {
  DEFAULT_BRUSH,
  DEFAULT_PRESSURE_CURVE,
  MAX_BRUSH_SIZE,
  MAX_STAMP_SPACING,
  MIN_BRUSH_SIZE,
  MIN_STAMP_SPACING,
  normalizeBrush,
} from "../brushes/defaults";
import { normalizePressureCurve } from "../brushes/pressureCurve";
import {
  DEFAULT_DOCUMENT_BACKGROUND,
  DOCUMENT_SIZE_LIMIT_DESCRIPTION,
  isValidDocumentSize,
} from "../document/document";
import type {
  DrawingDocument,
  FillPatchRecord,
  GradientRecord,
  GradientStop,
  Guide,
  GuideAxis,
  Layer,
  LayerElement,
  LayerId,
  StrokeRecord,
  StrokeSource,
} from "../document/types";
import { isLayerBlendMode } from "../document/blendModes";
import { isGroup, paintableLayers } from "../document/layerGroups";
import { isFillPatch, isGradient } from "../document/types";
import { MAX_FILL_SCAN_PIXELS } from "../fill/floodFill";
import { isBrushTipShape } from "../rendering/brushTip";
import {
  MAX_REFERENCE_BYTES,
  MAX_TOTAL_REFERENCE_PIXELS,
} from "../reference/decode";
import type { ReferenceImage } from "../reference/types";
import { normalizeReferenceRotation } from "../reference/geometry";
import type { BrushSettings, BrushTipShape } from "../../types/brush";
import { base64ToBytes, bytesToBase64 } from "../../utils/base64";
import { hexToRgb } from "../../utils/color";
import { reserveId } from "../../utils/id";

export const PROJECT_FORMAT_ID = "paka-project";
/**
 * Version 1: metadata plus brush strokes.
 * Version 2: strokes may carry `erase: true` (an eraser stroke subtracts
 * coverage). A version-1 reader would paint such a stroke instead of removing
 * it - the drawing would come out different, not merely incomplete - so the
 * version was bumped. Version-1 files still open, and are written back as 2.
 * Version 3: strokes may carry `fill: true` (a shape's samples are the outline
 * of a region to fill). A version-2 reader would trace that outline as a line
 * and leave the interior empty - again a different drawing - so the version was
 * bumped. Version-1 and -2 files still open; their shapes have no flag, so they
 * are traced exactly as before.
 * Version 4: a layer holds an ordered `elements` list of strokes **and**
 * serialized bucket-fill raster patches. A version-3 reader would ignore the
 * new content entirely (or fail to find `strokes`), so the version was bumped;
 * version-1 to -3 files still open, their `strokes` array read as a list of
 * stroke elements in the same order.
 * Version 5: elements may be gradients (geometry plus colour stops). A
 * version-4 reader rejects the unknown `gradient` kind, so the version was
 * bumped; version-1 to -4 files still open unchanged.
 * Version 6: a stroke's `brush` carries `hardness`. A version-5 reader would
 * ignore the field and render a soft stroke with a hard edge - a different
 * picture - so the version was bumped; version-1 to -5 files still open, their
 * strokes defaulting to a hardness of `1` (the hard edge every earlier version
 * could produce). Within version 6, `stabilizer` is additive: it changes the
 * samples captured at draw time, and stored samples already reproduce the
 * picture, so an older version-6 file without the field reads as `0`.
 *
 * Version 7: a stroke's `brush` carries `texture`, the deterministic grain
 * strength. A version-6 reader ignores it and draws a textured stroke plain, so
 * the field is required and the version was bumped. Version-1 to -6 files open
 * unchanged with `texture = 0`.
 * Version 8: a layer's `blendMode` may be `multiply` or `screen`, not only
 * `normal`. A version-7 reader rejects the unknown mode, so the version was
 * bumped; version-1 to -7 files still open unchanged.
 * Version 9: a stroke's `brush` carries `stamp`, `stampSpacing` and
 * `stampHardness`. A version-8 reader ignores them and draws the segment
 * path, so a stamped stroke would come out as a different picture - the
 * version was bumped and the fields are required. Version-1 to -8 files still
 * open unchanged, with the stamp off, which is exactly the segment path they
 * were written by.
 * Version 10: a stroke's `brush` carries `stampTexture`, the strength of the
 * per-dab directional texture. It changes how a stamped stroke's samples are
 * rasterized, so a version-9 reader would draw the same stroke as a plain
 * chain of dabs - a different picture - and the version was bumped with the
 * field required. Version-1 to -9 files still open unchanged, with the
 * texture off, which is exactly the coverage they were written by.
 *
 * Version 11: a layer's `blendMode` may also be `overlay`, `soft-light`,
 * `hard-light`, `color-dodge`, `darken`, `lighten`, `difference` or
 * `exclusion`. A version-10 reader rejects those values, so the version was
 * bumped; version-1 to -10 files still open unchanged.
 *
 * Version 12: a stroke's `brush` carries `pressureCurve`, the piecewise-linear
 * mapping from raw device pressure to the pressure the brush uses. It changes
 * how stored samples are rasterized, so a version-11 reader would draw a bent
 * response linearly - a different picture - and the version was bumped with the
 * field required. Version-1 to -11 files open unchanged with the identity curve,
 * which is exactly the linear response they were written by.
 *
 * Version 13: two changes, each of which a version-12 reader cannot ignore.
 *
 * First, a stroke's `brush` carries `tip`, the shape a stamped dab is
 * masked with. It changes how a stamped stroke's samples are rasterized, so a
 * version-12 reader ignores it and draws the same dabs as plain discs - a
 * different picture - and the version was bumped. Version-1 to -12 files open
 * unchanged with the `round` tip, which is exactly the coverage they were
 * written by.
 *
 * Second, a layer may be a **group** - a container that holds other
 * layers and paints nothing itself. A layer entry gained a `kind` field
 * ("layer" or "group") and a group entry carries a `children` list. A
 * version-12 reader knows neither: it would read a group as a paintable layer
 * with no content, and every layer inside the group would be lost from the
 * picture - a different drawing, not merely an incomplete one - so the
 * version was bumped. Version-1 to -12 files open unchanged: they have no
 * `kind` and no `children`, and every one of their layers is a paintable
 * layer, exactly as they were written.
 *
 * Since version 9, `document.guides` is **additive**: the composition guides
 * are display-only, so a reader that does not know the field ignores it and
 * draws the very same picture - the same situation as `stabilizer` within
 * version 6. That is why the version was not bumped for them. A file without
 * the field opens with no guides at all.
 *
 * Version 14 adds `document.references`: the reference images, each with its
 * placement and its original encoded bytes. Unlike the guides, the field is
 * **not** additive: a reader that ignores it would drop the artist's
 * references the next time the project was saved. A file that claims an older
 * version and carries references is therefore refused, exactly as a group in a
 * pre-13 file is, and an older build refuses a v14 file through the version
 * gate instead of silently losing the images.
 *
 * Bump when the shape of the file changes in a way older readers cannot read.
 */
export const PROJECT_VERSION = 14;
export const PROJECT_FILE_EXTENSION = "paka";
/** Upper bound on the stroke sample points a file may contain (x/y/pressure/time each). */
export const MAX_PROJECT_SAMPLES = 5_000_000;
/** Upper bound on the total fill-mask pixels a file may contain. */
export const MAX_PROJECT_FILL_PIXELS = MAX_FILL_SCAN_PIXELS;
/** Upper bound on colour stops in one gradient. */
export const MAX_PROJECT_GRADIENT_STOPS = 64;
/**
 * Upper bound on the composition guides a file may carry.
 *
 * A guide is a handful of bytes, but the array is unbounded input, so the
 * ceiling is the same kind of guard the sample and fill-pixel ceilings are.
 */
export const MAX_PROJECT_GUIDES = 10_000;

/**
 * Upper bound on the references a file may carry.
 *
 * A reference is a picture, not a handful of bytes, so the count is small and
 * the *pixels* are bounded too: {@link MAX_PROJECT_REFERENCE_PIXELS} is the
 * same session budget the decoder enforces, and the encoded bytes of one
 * reference are bounded by the decoder's own byte limit.
 */
export const MAX_PROJECT_REFERENCES = 32;
/** Upper bound on the decoded pixels of every reference in one file. */
export const MAX_PROJECT_REFERENCE_PIXELS = MAX_TOTAL_REFERENCE_PIXELS;

export interface SerializedStroke {
  readonly kind: "stroke";
  readonly id: string;
  readonly brush: BrushSettings;
  readonly startTime: number;
  /** Present and true only for eraser strokes; absent means a brush stroke. */
  readonly erase?: boolean;
  /** Present and true only for filled shapes; absent means a traced outline. */
  readonly fill?: boolean;
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  readonly pressures: readonly number[];
  readonly times: readonly number[];
}

/** A bucket fill: opaque colour plus a base64 coverage mask, tightly cropped. */
export interface SerializedFillPatch {
  readonly kind: "fill";
  readonly id: string;
  readonly color: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** `width * height` coverage bytes, standard base64. */
  readonly mask: string;
}

export type SerializedElement = SerializedStroke | SerializedFillPatch | SerializedGradient;

/** A gradient: geometry plus colour stops, not a pixel snapshot. */
export interface SerializedGradient {
  readonly kind: "gradient";
  readonly id: string;
  readonly type: "linear" | "radial";
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly stops: readonly GradientStop[];
  readonly opacity: number;
}

export interface SerializedLayer {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly blendMode: string;
  /**
   * `"layer"` for a paintable layer, `"group"` for a container of layers.
   *
   * Required in version 13. A version-12 file has no `kind`: every one of
   * its layers is a paintable layer.
   */
  readonly kind: SerializedLayerKind;
  /**
   * Painting order: strokes, fills and gradients interleave exactly as made.
   *
   * Present on a paintable layer, absent on a group: a group owns no content
   * of its own.
   */
  readonly elements?: readonly SerializedElement[];
  /**
   * The layers a group holds, bottom-first.
   *
   * Present on a group, absent on a paintable layer. A group owns no content
   * of its own: the layers it holds carry the content.
   */
  readonly children?: readonly SerializedLayer[];
}

/** The kinds a layer entry may have. */
export type SerializedLayerKind = "layer" | "group";

export interface SerializedProject {
  readonly format: string;
  readonly version: number;
  readonly document: {
    readonly id: string;
    readonly name: string;
    readonly width: number;
    readonly height: number;
    readonly background: string;
    readonly activeLayerId: LayerId | null;
    /**
     * The composition guides.
     *
     * Additive within version 9: the guides are display-only, so a reader that
     * does not know the field ignores it and draws the same picture. That is
     * why the version was not bumped.
     */
    readonly guides: readonly SerializedGuide[];
    /**
     * The reference images, in drawing order.
     *
     * Required from version 14 on: a file without the field (or claiming an
     * older version) carries no references, and one that claims an older
     * version while carrying them is refused.
     */
    readonly references: readonly SerializedReference[];
  };
  /** Bottom-first, matching the in-memory document order. */
  readonly layers: readonly SerializedLayer[];
}

/** A composition guide: an axis and a position in document pixels. */
export interface SerializedGuide {
  readonly id: string;
  readonly axis: GuideAxis;
  readonly position: number;
}

/**
 * A reference image: its placement and the file it came from.
 *
 * `data` is the original encoded file, base64, exactly as imported. It is not
 * a path: the project is portable, so it reopens on another machine or after
 * the original file moved. `naturalWidth`/`naturalHeight` are the decoded
 * picture's own size, which is what the placement is relative to.
 */
export interface SerializedReference {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly rotation: number;
  readonly opacity: number;
  readonly blendMode: ReferenceImage["blendMode"];
  readonly behind: boolean;
  readonly visible: boolean;
  readonly mimeType: string;
  readonly data: string;
}

export interface ParsedProject {
  /** Layer metadata with pixel-independent fields only; content is separate. */
  readonly document: DrawingDocument;
  /**
   * Every element of every layer, in document order, each tagged with its
   * layer. This is the authoritative list a reopened document is built from.
   */
  readonly elements: readonly LayerElement[];
  /**
   * A filtered stroke view, kept for callers that only care about paths
   * (selection, transforms and diagnostics). It never includes a fill patch or
   * a gradient.
   */
  readonly strokes: readonly StrokeRecord[];
  /** Non-fatal repairs made while reading (missing names, bad background). */
  readonly warnings: readonly string[];
}

export type ProjectParseResult =
  | { readonly ok: true; readonly project: ParsedProject }
  | { readonly ok: false; readonly error: string };

export interface ParseProjectOptions {
  /** Sample ceiling; overridable so the guard itself can be tested cheaply. */
  readonly maxSamples?: number;
  /** Fill-mask pixel ceiling; overridable so the guard itself can be tested cheaply. */
  readonly maxFillPixels?: number;
  /**
   * Highest file version this reader accepts. Defaults to `PROJECT_VERSION`.
   *
   * Only tests set this: it stands in for an older build when proving that a
   * bumped file is refused by the version gate instead of being mis-read.
   */
  readonly maxVersion?: number;
}

/** Thrown internally so validation reads as a sequence of assertions. */
class ProjectFormatError extends Error {}

function fail(message: string): never {
  throw new ProjectFormatError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(`${label} must be an object.`);
  }
  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    fail(`${label} must be a string.`);
  }
  return value;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    fail(`${label} must be true or false.`);
  }
  return value;
}

function readNumber(value: unknown, label: string, min: number, max: number): number {
  const number = readAnyNumber(value, label);
  if (number < min || number > max) {
    fail(`${label} must be between ${min} and ${max}.`);
  }
  return number;
}

function readAnyNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${label} must be a finite number.`);
  }
  return value;
}

function readStrokesOf(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array.`);
  }
  return value;
}

/** Version 4's ordered content list; older files use the same shape for strokes. */
function readElementList(value: unknown, label: string): unknown[] {
  return readStrokesOf(value, label);
}

function readStroke(
  raw: Record<string, unknown>,
  label: string,
  layerId: LayerId,
  sampleCount: number,
  maxSamples: number,
  version: number,
): StrokeRecord {
  const xs = readSampleArray(raw.xs, `${label} x`, sampleCount, maxSamples);
  const ys = readSampleArray(raw.ys, `${label} y`, sampleCount, maxSamples);
  const pressures = readSampleArray(raw.pressures, `${label} pressure`, sampleCount, maxSamples);
  const times = readSampleArray(raw.times, `${label} time`, sampleCount, maxSamples);

  if (ys.length !== xs.length || pressures.length !== xs.length || times.length !== xs.length) {
    fail(
      `${label} has mismatched sample arrays (${xs.length}/${ys.length}/${pressures.length}/${times.length}).`,
    );
  }

  const erase = raw.erase === undefined ? false : readBoolean(raw.erase, `${label} erase flag`);
  const fill = raw.fill === undefined ? false : readBoolean(raw.fill, `${label} fill flag`);

  return {
    id: readId(raw.id, "stroke"),
    layerId,
    brush: readBrush(raw.brush, label, version),
    // Only eraser strokes carry the flag: `erase: false` and "no flag" mean the
    // same thing, and old files have no flag at all.
    ...(erase ? { erase: true as const } : {}),
    // Same for the fill flag, which version-1 and -2 files never carry.
    ...(fill ? { fill: true as const } : {}),
    xs,
    ys,
    pressures,
    times,
    startTime:
      typeof raw.startTime === "number" && Number.isFinite(raw.startTime) ? raw.startTime : 0,
  };
}

function readFillPatch(
  raw: Record<string, unknown>,
  label: string,
  layerId: LayerId,
  documentWidth: number,
  documentHeight: number,
  fillPixelsSoFar: number,
  maxFillPixels: number,
): FillPatchRecord {
  const id = readId(raw.id, "fill");
  const color = readString(raw.color, `${label} colour`);
  if (color.trim() === "") {
    fail(`${label} colour is empty.`);
  }

  const x = readInteger(raw.x, `${label} x`, 0, documentWidth - 1);
  const y = readInteger(raw.y, `${label} y`, 0, documentHeight - 1);
  const width = readInteger(raw.width, `${label} width`, 1, documentWidth - x);
  const height = readInteger(raw.height, `${label} height`, 1, documentHeight - y);
  const pixels = width * height;

  if (fillPixelsSoFar + pixels > maxFillPixels) {
    fail(`This project contains more than ${maxFillPixels} fill pixels and cannot be opened.`);
  }

  const encoded = readString(raw.mask, `${label} mask`);
  const mask = base64ToBytes(encoded);
  if (mask === null) {
    fail(`${label} mask is not valid base64.`);
  }
  if (mask.length !== pixels) {
    fail(
      `${label} mask is ${mask.length} bytes but its ${width}x${height} box needs ${pixels}.`,
    );
  }

  return { id, layerId, kind: "fill", color, x, y, width, height, mask };
}

function readGradient(
  raw: Record<string, unknown>,
  label: string,
  layerId: LayerId,
  documentWidth: number,
  documentHeight: number,
): GradientRecord {
  const id = readId(raw.id, "gradient");
  const type = readString(raw.type, `${label} gradient type`);
  if (type !== "linear" && type !== "radial") {
    fail(`${label} gradient type must be "linear" or "radial".`);
  }

  const rawStops = readStrokesOf(raw.stops, `${label} gradient stops`);
  if (rawStops.length < 2) {
    fail(`${label} gradient needs at least two colour stops.`);
  }
  if (rawStops.length > MAX_PROJECT_GRADIENT_STOPS) {
    fail(
      `${label} gradient has more than ${MAX_PROJECT_GRADIENT_STOPS} colour stops.`,
    );
  }

  const stops: GradientStop[] = [];
  let previousOffset = -1;
  rawStops.forEach((rawStop, index) => {
    const stopLabel = `${label} gradient stop ${index + 1}`;
    const stop = asRecord(rawStop, stopLabel);
    const offset = readNumber(stop.offset, `${stopLabel} offset`, 0, 1);
    if (offset <= previousOffset) {
      fail(`${stopLabel} offsets must be strictly ascending.`);
    }
    previousOffset = offset;
    const color = readString(stop.color, `${stopLabel} colour`);
    if (!hexToRgb(color)) {
      fail(`${stopLabel} colour must be a hex colour.`);
    }
    stops.push({ offset, color });
  });

  return {
    id,
    layerId,
    kind: "gradient",
    type,
    x1: readNumber(raw.x1, `${label} gradient x1`, 0, documentWidth),
    y1: readNumber(raw.y1, `${label} gradient y1`, 0, documentHeight),
    x2: readNumber(raw.x2, `${label} gradient x2`, 0, documentWidth),
    y2: readNumber(raw.y2, `${label} gradient y2`, 0, documentHeight),
    stops,
    opacity: readNumber(raw.opacity, `${label} gradient opacity`, 0, 1),
  };
}

function readInteger(value: unknown, label: string, min: number, max: number): number {
  const number = readAnyNumber(value, label);
  if (!Number.isInteger(number) || number < min || number > max) {
    fail(`${label} must be a whole number between ${min} and ${max}.`);
  }
  return number;
}

/** Serializes document metadata and ordered layer content into the project text. */
export function serializeProject(document: DrawingDocument, strokes: StrokeSource): string {
  const payload: SerializedProject = {
    format: PROJECT_FORMAT_ID,
    version: PROJECT_VERSION,
    document: {
      id: document.id,
      name: document.name,
      width: document.width,
      height: document.height,
      background: document.background,
      activeLayerId: document.activeLayerId,
      guides: document.guides.map((guide) => ({
        id: guide.id,
        axis: guide.axis,
        position: guide.position,
      })),
      references: document.references.map(serializeReference),
    },
    layers: document.layers.map((layer) => serializeLayer(layer, strokes)),
  };

  return JSON.stringify(payload);
}

/**
 * Serializes one node of the layer tree.
 *
 * A **group** is written as a container: its `children` carry the layers it
 * holds, and it carries no elements of its own. A paintable layer is written
 * with its elements and no children.
 */
function serializeLayer(layer: Layer, strokes: StrokeSource): SerializedLayer {
  if (isGroup(layer)) {
    return {
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      kind: "group",
      children: layer.children.map((child) => serializeLayer(child, strokes)),
    };
  }
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    kind: "layer",
    elements: strokes.listElements(layer.id).map(serializeElement),
  };
}

/**
 * Writes one reference: its placement and the file's original bytes.
 *
 * The bytes are written even when they are empty, so the reader can refuse a
 * reference that lost its picture instead of opening a placement with nothing
 * to draw. Only the engine creates document references, and it always keeps
 * the bytes it imported.
 */
function serializeReference(reference: ReferenceImage): SerializedReference {
  return {
    id: reference.id,
    name: reference.name,
    x: reference.x,
    y: reference.y,
    width: reference.width,
    height: reference.height,
    naturalWidth: reference.naturalWidth,
    naturalHeight: reference.naturalHeight,
    rotation: reference.rotation,
    opacity: reference.opacity,
    blendMode: reference.blendMode,
    behind: reference.behind,
    visible: reference.visible,
    mimeType: reference.source?.mimeType ?? "",
    data: reference.source?.base64 ?? "",
  };
}

function serializeElement(element: LayerElement): SerializedElement {
  if (isFillPatch(element)) {
    return {
      kind: "fill",
      id: element.id,
      color: element.color,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      mask: bytesToBase64(element.mask),
    };
  }
  if (isGradient(element)) {
    return {
      kind: "gradient",
      id: element.id,
      type: element.type,
      x1: element.x1,
      y1: element.y1,
      x2: element.x2,
      y2: element.y2,
      stops: element.stops.map((stop) => ({ offset: stop.offset, color: stop.color })),
      opacity: element.opacity,
    };
  }
  return {
    kind: "stroke",
    id: element.id,
    brush: element.brush,
    startTime: element.startTime,
    // Only eraser strokes carry the flag, so brush-only drawings stay
    // byte-identical to what earlier versions wrote.
    ...(element.erase === true ? { erase: true as const } : {}),
    // Likewise the fill flag: absent on every stroke that traces its outline.
    ...(element.fill === true ? { fill: true as const } : {}),
    xs: element.xs,
    ys: element.ys,
    pressures: element.pressures,
    times: element.times,
  };
}

/**
 * Reads project text. Never throws: a malformed or unsupported file comes back
 * as `{ ok: false }` with a message meant for the user.
 */
export function parseProject(text: string, options: ParseProjectOptions = {}): ProjectParseResult {
  try {
    return {
      ok: true,
      project: readProject(
        text,
        options.maxSamples ?? MAX_PROJECT_SAMPLES,
        options.maxFillPixels ?? MAX_PROJECT_FILL_PIXELS,
        options.maxVersion ?? PROJECT_VERSION,
      ),
    };
  } catch (error) {
    if (error instanceof ProjectFormatError) {
      return { ok: false, error: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `The project file could not be read: ${message}` };
  }
}

function readProject(
  text: string,
  maxSamples: number,
  maxFillPixels: number,
  maxVersion: number,
): ParsedProject {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return fail("This is not a Paka project file (the contents are not valid JSON).");
  }

  const root = asRecord(raw, "The project file");
  if (root.format !== PROJECT_FORMAT_ID) {
    fail(`This is not a Paka project file (expected format "${PROJECT_FORMAT_ID}").`);
  }

  if (typeof root.version !== "number" || !Number.isInteger(root.version)) {
    fail("The project file is missing a version number.");
  }
  const version = root.version;
  if (version > maxVersion) {
    fail(
      `This project was created by a newer version of Paka (file version ${version}, ` +
        `this build reads up to ${maxVersion}).`,
    );
  }
  if (version < 1) {
    fail(`Unsupported project file version ${version}.`);
  }

  const warnings: string[] = [];
  const rawDocument = asRecord(root.document, "The project document");

  const width = Math.round(readAnyNumber(rawDocument.width, "The document width"));
  const height = Math.round(readAnyNumber(rawDocument.height, "The document height"));
  // This is the allocation gate: reject unsafe dimensions before reading any
  // layer content or letting the engine replace the open document.
  if (!isValidDocumentSize(width, height)) {
    fail(
      `The document size ${width}x${height} is outside the supported range ` +
        `(${DOCUMENT_SIZE_LIMIT_DESCRIPTION}).`,
    );
  }

  let name = "Untitled";
  if (typeof rawDocument.name === "string" && rawDocument.name.trim() !== "") {
    name = rawDocument.name;
  } else {
    warnings.push("The document had no name; it was opened as \"Untitled\".");
  }

  let background = DEFAULT_DOCUMENT_BACKGROUND;
  if (typeof rawDocument.background === "string" && rawDocument.background.trim() !== "") {
    background = rawDocument.background;
  } else if (rawDocument.background !== undefined) {
    warnings.push("The paper colour was invalid and was reset to white.");
  }

  const documentId = readId(rawDocument.id, "doc");

  if (!Array.isArray(root.layers)) {
    fail("The project file has no layer list.");
  }
  if (root.layers.length === 0) {
    fail("The project file contains no layers.");
  }

  const layers: Layer[] = [];
  const elements: LayerElement[] = [];
  const strokes: StrokeRecord[] = [];
  const state: LayerReadState = {
    seenLayerIds: new Set<string>(),
    elements,
    strokes,
    warnings,
    sampleCount: 0,
    fillPixelCount: 0,
    layerCount: 0,
    groupCount: 0,
  };

  const tree = readLayerTree(
    root.layers,
    "Layer",
    version,
    width,
    height,
    state,
    maxSamples,
    maxFillPixels,
  );
  layers.push(...tree);

  const activeLayerId = resolveActiveLayer(rawDocument.activeLayerId, state.seenLayerIds, layers, warnings);
  const guides = readGuides(rawDocument.guides, warnings);
  const references = readReferences(rawDocument.references, version, warnings);

  const document: DrawingDocument = {
    id: documentId,
    name,
    width,
    height,
    background,
    layers,
    activeLayerId,
    guides,
    references,
  };

  return { document, elements, strokes, warnings };
}

/**
 * The state one read shares across the whole layer tree.
 *
 * The ids, the elements and the counters are global to the file: two layers
 * anywhere in the tree may not share an id, and the elements of every layer
 * come back in one list, in document order.
 */
interface LayerReadState {
  readonly seenLayerIds: Set<string>;
  readonly elements: LayerElement[];
  readonly strokes: StrokeRecord[];
  readonly warnings: string[];
  sampleCount: number;
  fillPixelCount: number;
  /** How many paintable layers the file holds; names the ones without a name. */
  layerCount: number;
  /** How many groups the file holds; names the ones without a name. */
  groupCount: number;
}

/**
 * Reads a list of layer nodes, at the root of the document or inside a group.
 *
 * The list is the tree: a group's children are read exactly like the root
 * list, so a group may hold groups.
 */
function readLayerTree(
  rawLayers: unknown,
  label: string,
  version: number,
  documentWidth: number,
  documentHeight: number,
  state: LayerReadState,
  maxSamples: number,
  maxFillPixels: number,
): Layer[] {
  if (!Array.isArray(rawLayers)) {
    fail(`${label} list must be an array.`);
  }
  const layers: Layer[] = [];
  rawLayers.forEach((rawLayer, index) => {
    layers.push(
      readLayer(
        rawLayer,
        `${label} ${index + 1}`,
        version,
        documentWidth,
        documentHeight,
        state,
        maxSamples,
        maxFillPixels,
      ),
    );
  });
  return layers;
}

/**
 * Reads the `kind` of a layer entry.
 *
 * Version 13 introduced groups, so the field is required from that version
 * on. A file that claims an older version and carries a group is refused: it
 * cannot be read as it stands, and reading it as a flat list of paintable
 * layers would draw a different picture.
 */
function readLayerKind(value: unknown, label: string, version: number): SerializedLayerKind {
  if (version < 13) {
    if (value === undefined || value === "layer") {
      return "layer";
    }
    fail(`${label} is a "${String(value)}", which requires file version 13.`);
  }
  if (value === undefined) {
    fail(`${label} has no kind; a layer must say whether it is a layer or a group.`);
  }
  const kind = readString(value, `${label} kind`);
  if (kind !== "layer" && kind !== "group") {
    fail(`${label} has the unknown kind "${kind}".`);
  }
  return kind;
}

/** Reads one node of the layer tree: a paintable layer or a group. */
function readLayer(
  raw: unknown,
  label: string,
  version: number,
  documentWidth: number,
  documentHeight: number,
  state: LayerReadState,
  maxSamples: number,
  maxFillPixels: number,
): Layer {
  const record = asRecord(raw, label);

  const kind = readLayerKind(record.kind, label, version);
  if (version < 13 && record.children !== undefined) {
    fail(`${label} holds other layers, which requires file version 13.`);
  }

  const id = readId(record.id, kind === "group" ? "group" : "layer");
  if (state.seenLayerIds.has(id)) {
    fail(`Two layers in this project share the id "${id}".`);
  }
  state.seenLayerIds.add(id);

  if (kind === "group") {
    state.groupCount += 1;
  } else {
    state.layerCount += 1;
  }

  let layerName = kind === "group" ? `Group ${state.groupCount}` : `Layer ${state.layerCount}`;
  if (typeof record.name === "string" && record.name.trim() !== "") {
    layerName = record.name;
  } else {
    state.warnings.push(`${label} had no name and was renamed.`);
  }

  const opacity = readNumber(record.opacity, `${label} opacity`, 0, 1);
  const visible = readBoolean(record.visible, `${label} visibility`);
  const blendMode = readString(record.blendMode, `${label} blend mode`);
  if (!isLayerBlendMode(blendMode)) {
    fail(`${label} uses the unsupported blend mode "${blendMode}".`);
  }

  if (kind === "group") {
    // A group owns no content of its own: the layers it holds carry it.
    if (record.elements !== undefined) {
      fail(`${label} is a group and cannot carry elements of its own.`);
    }
    if (record.children === undefined) {
      fail(`${label} does not list the layers it holds.`);
    }
    const children = readLayerTree(
      record.children,
      `${label}, layer`,
      version,
      documentWidth,
      documentHeight,
      state,
      maxSamples,
      maxFillPixels,
    );
    return { id, name: layerName, visible, opacity, blendMode, kind: "group", children };
  }

  if (record.children !== undefined) {
    fail(`${label} is a paintable layer and cannot hold other layers.`);
  }

  // Version 4 uses one ordered `elements` list. Older files have a `strokes`
  // array only, which is exactly a list of stroke elements in the same order.
  const rawElements =
    version >= 4
      ? readElementList(record.elements, `${label} elements`)
      : readElementList(record.strokes, `${label} strokes`);

  for (const [elementIndex, rawElement] of rawElements.entries()) {
    const elementLabel = `${label}, element ${elementIndex + 1}`;
    const element = asRecord(rawElement, elementLabel);

    if (version >= 4) {
      const elementKind = readString(element.kind, `${elementLabel} kind`);
      if (elementKind === "fill") {
        const patch = readFillPatch(
          element,
          elementLabel,
          id,
          documentWidth,
          documentHeight,
          state.fillPixelCount,
          maxFillPixels,
        );
        state.fillPixelCount += patch.width * patch.height;
        state.elements.push(patch);
        continue;
      }
      if (elementKind === "gradient") {
        if (version < 5) {
          fail(`${elementLabel} uses a gradient, which requires file version 5.`);
        }
        state.elements.push(
          readGradient(element, elementLabel, id, documentWidth, documentHeight),
        );
        continue;
      }
      if (elementKind !== "stroke") {
        fail(`${elementLabel} has the unknown kind "${elementKind}".`);
      }
    }

    const stroke = readStroke(
      element,
      elementLabel,
      id,
      state.sampleCount,
      maxSamples,
      version,
    );
    state.sampleCount += stroke.xs.length;
    state.elements.push(stroke);
    state.strokes.push(stroke);
  }

  return { id, name: layerName, visible, opacity, blendMode, kind: "layer", children: [] };
}

/**
 * Reads the composition guides.
 *
 * Reading is forgiving: a file without the field opens with no guides at all
 * (that is every file written before version 9 carried them), and a guide that
 * is broken in some way is dropped with a warning rather than making the whole
 * file unopenable. A guide is a decorative overlay; refusing a drawing over
 * one would be the wrong trade.
 *
 * The count ceiling is the exception: a file with an enormous guide array is
 * refused outright, like the sample and fill-pixel ceilings.
 */
function readGuides(value: unknown, warnings: string[]): Guide[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    warnings.push("The guides were not a list and were ignored.");
    return [];
  }
  if (value.length > MAX_PROJECT_GUIDES) {
    fail(`This project contains more than ${MAX_PROJECT_GUIDES} guides and cannot be opened.`);
  }

  const guides: Guide[] = [];
  const seenIds = new Set<string>();
  value.forEach((raw, index) => {
    const label = `Guide ${index + 1}`;
    if (!isRecord(raw)) {
      warnings.push(`${label} was not a guide and was ignored.`);
      return;
    }
    const axis = raw.axis;
    if (axis !== "vertical" && axis !== "horizontal") {
      warnings.push(`${label} had an unknown axis and was ignored.`);
      return;
    }
    const position = raw.position;
    if (typeof position !== "number" || !Number.isFinite(position)) {
      warnings.push(`${label} had an invalid position and was ignored.`);
      return;
    }
    const id = raw.id;
    if (typeof id !== "string" || id.trim() === "") {
      warnings.push(`${label} had no identifier and was ignored.`);
      return;
    }
    if (seenIds.has(id)) {
      warnings.push(`Two guides share the id "${id}"; the second was ignored.`);
      return;
    }
    seenIds.add(id);
    reserveId("guide", id);
    // A guide is a registration mark, so its position is a whole document
    // pixel: a fractional one would draw a soft edge at some zooms.
    guides.push({ id, axis, position: Math.round(position) });
  });

  return guides;
}

/**
 * Reads the reference images.
 *
 * A reference is a picture, so a malformed one is **refused**, not ignored: a
 * project that silently dropped a reference would look different from the one
 * the artist saved. The version gate is the same one groups use - a file that
 * claims an older version cannot carry references, because an older build
 * would have dropped them on the next save.
 */
function readReferences(
  value: unknown,
  version: number,
  warnings: string[],
): ReferenceImage[] {
  if (value === undefined) {
    return [];
  }
  if (version < 14) {
    // An older file that carries actual references is refused: an older build
    // would have dropped them on the next save. An empty list is not content -
    // a newer serializer writes it for a document without references - so it
    // is read as "none" rather than treated as a version lie.
    if (Array.isArray(value) && value.length === 0) {
      return [];
    }
    fail("This project carries reference images, which require file version 14.");
  }
  if (!Array.isArray(value)) {
    fail("The reference list must be an array.");
  }
  if (value.length > MAX_PROJECT_REFERENCES) {
    fail(
      `This project contains ${value.length} references, more than the ${MAX_PROJECT_REFERENCES} allowed.`,
    );
  }

  const references: ReferenceImage[] = [];
  const seenIds = new Set<string>();
  let decodedPixels = 0;

  value.forEach((raw, index) => {
    const label = `Reference ${index + 1}`;
    const record = asRecord(raw, label);
    const id = readId(record.id, "reference");
    if (seenIds.has(id)) {
      fail(`${label} repeats the id "${id}".`);
    }
    seenIds.add(id);

    let name = typeof record.name === "string" ? record.name.trim() : "";
    if (name === "") {
      name = `Reference ${index + 1}`;
      warnings.push(`${label} had no name; it was called "${name}".`);
    }

    const x = readAnyNumber(record.x, `${label} x`);
    const y = readAnyNumber(record.y, `${label} y`);
    const width = readNumber(record.width, `${label} width`, 1, Number.MAX_SAFE_INTEGER);
    const height = readNumber(record.height, `${label} height`, 1, Number.MAX_SAFE_INTEGER);
    const naturalWidth = Math.round(
      readNumber(record.naturalWidth, `${label} natural width`, 1, Number.MAX_SAFE_INTEGER),
    );
    const naturalHeight = Math.round(
      readNumber(record.naturalHeight, `${label} natural height`, 1, Number.MAX_SAFE_INTEGER),
    );
    const rotation = normalizeReferenceRotation(
      readAnyNumber(record.rotation, `${label} rotation`),
    );
    const opacity = readNumber(record.opacity, `${label} opacity`, 0, 1);
    const blendMode = readString(record.blendMode, `${label} blend mode`);
    if (!isLayerBlendMode(blendMode)) {
      fail(`${label} has an unknown blend mode "${blendMode}".`);
    }
    const behind = readBoolean(record.behind, `${label} behind flag`);
    const visible = readBoolean(record.visible, `${label} visible flag`);

    const mimeType = readString(record.mimeType, `${label} MIME type`);
    if (!mimeType.startsWith("image/")) {
      fail(`${label} does not say what kind of image it is.`);
    }
    const data = readString(record.data, `${label} image data`);
    if (data === "") {
      fail(`${label} carries no image data.`);
    }
    // The base64 text is bounded before it is decoded, so an enormous string
    // cannot make the reader allocate the bytes it encodes.
    if (data.length > Math.ceil(MAX_REFERENCE_BYTES / 3) * 4) {
      fail(`${label} is larger than the ${Math.round(MAX_REFERENCE_BYTES / (1024 * 1024))} MB limit.`);
    }
    const bytes = base64ToBytes(data);
    if (!bytes || bytes.length === 0) {
      fail(`${label} has image data that is not valid base64.`);
    }
    if (bytes.length > MAX_REFERENCE_BYTES) {
      fail(`${label} is larger than the ${Math.round(MAX_REFERENCE_BYTES / (1024 * 1024))} MB limit.`);
    }

    decodedPixels += naturalWidth * naturalHeight;
    if (decodedPixels > MAX_PROJECT_REFERENCE_PIXELS) {
      fail(
        `The references in this project need more than the ${Math.round(
          MAX_PROJECT_REFERENCE_PIXELS / (1024 * 1024),
        )} megapixels the editor allows in one session.`,
      );
    }

    references.push({
      id,
      name,
      x,
      y,
      width,
      height,
      naturalWidth,
      naturalHeight,
      rotation,
      opacity,
      blendMode,
      behind,
      visible,
      source: { mimeType, base64: data },
    });
  });

  return references;
}

/** Keeps generated ids from colliding with ids that came out of a file. */
function readId(value: unknown, prefix: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`A ${prefix} in this project is missing its identifier.`);
  }
  reserveId(prefix, value);
  return value;
}

/** Reads one parallel sample array, refusing data past the point ceiling. */
function readSampleArray(value: unknown, label: string, pointsSoFar: number, maxSamples: number): number[] {
  if (!Array.isArray(value)) {
    fail(`${label} samples must be an array.`);
  }
  if (pointsSoFar + value.length > maxSamples) {
    fail(`This project contains more than ${maxSamples} stroke samples and cannot be opened.`);
  }
  const numbers: number[] = new Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      fail(`${label} sample ${index + 1} is not a finite number.`);
    }
    numbers[index] = entry;
  }
  return numbers;
}

function readBrush(value: unknown, label: string, version: number): BrushSettings {
  const record = asRecord(value, `${label} brush`);
  const color = readString(record.color, `${label} brush colour`);
  if (color.trim() === "") {
    fail(`${label} brush colour is empty.`);
  }

  return normalizeBrush({
    size: readNumber(record.size, `${label} brush size`, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE),
    opacity: readNumber(record.opacity, `${label} brush opacity`, 0, 1),
    color,
    // Hardness became a required brush field in version 6. Earlier files could
    // only produce a hard edge, so they default to 1 rather than being
    // mis-rendered as soft.
    hardness:
      version >= 6
        ? readNumber(record.hardness, `${label} brush hardness`, 0, 1)
        : 1,
    pressureSize: readNumber(record.pressureSize, `${label} brush pressure size`, 0, 1),
    pressureOpacity: readNumber(record.pressureOpacity, `${label} brush pressure opacity`, 0, 1),
    minSizeRatio: readNumber(record.minSizeRatio, `${label} brush minimum size ratio`, 0.02, 1),
    spacing: readNumber(record.spacing, `${label} brush spacing`, 0.02, 2),
    // Additive within version 6: files written before the field existed (and
    // every older version) behave exactly as their stored samples did.
    stabilizer:
      record.stabilizer === undefined
        ? 0
        : readNumber(record.stabilizer, `${label} brush stabilizer`, 0, 1),
    // Texture changes how stored samples are rasterized, so it became a
    // required field in version 7; earlier files had no texture.
    texture:
      version >= 7 ? readNumber(record.texture, `${label} brush texture`, 0, 1) : 0,
    // The stamp engine changes how stored samples are rasterized, so it became
    // a required field in version 9: a version-8 reader ignores these fields
    // and draws the segment path, which is a different picture for a stamped
    // stroke. Earlier files had no stamp at all, and the stamp off is exactly
    // the segment path they were written by.
    stamp: version >= 9 ? readBoolean(record.stamp, `${label} brush stamp`) : false,
    stampSpacing:
      version >= 9
        ? readNumber(
            record.stampSpacing,
            `${label} brush stamp spacing`,
            MIN_STAMP_SPACING,
            MAX_STAMP_SPACING,
          )
        : DEFAULT_BRUSH.stampSpacing,
    stampHardness:
      version >= 9
        ? readNumber(record.stampHardness, `${label} brush stamp hardness`, 0, 1)
        : DEFAULT_BRUSH.stampHardness,
    // The per-dab directional texture changes how a stamped stroke's samples
    // are rasterized, so it became a required field in version 10: a version-9
    // reader ignores it and draws the same dabs plain, which is a different
    // picture. Earlier files had no texture at all, and the texture off is
    // exactly the coverage they were written by.
    stampTexture:
      version >= 10 ? readNumber(record.stampTexture, `${label} brush stamp texture`, 0, 1) : 0,
    // The pressure curve changes how stored samples are rasterized, so it
    // became a required field in version 12: older files use the identity
    // curve, which is the linear response they were written by.
    pressureCurve:
      version >= 12 ? normalizePressureCurve(record.pressureCurve) : DEFAULT_PRESSURE_CURVE,
    // The tip changes how a stamped stroke's samples are rasterized, so it
    // became a field of version 13: a version-12 reader ignores it and draws
    // the same dabs as plain discs, which is a different picture. Earlier
    // files had no tip at all, and the round tip is exactly the coverage they
    // were written by.
    tip: version >= 13 ? readTip(record.tip, `${label} brush tip`) : DEFAULT_BRUSH.tip,
  });
}

/**
 * The tip of a stroke's brush.
 *
 * The tip is a closed set of shapes, so a shape this build does not know is
 * refused rather than drawn as the wrong thing - the same rule the layer
 * blend modes follow. A *missing* tip falls back to the round tip, the
 * coverage every earlier version was written by.
 */
function readTip(value: unknown, label: string): BrushTipShape {
  if (value === undefined || value === null) {
    return DEFAULT_BRUSH.tip;
  }
  const shape = readString(value, label);
  if (!isBrushTipShape(shape)) {
    fail(`${label} uses the unsupported brush tip "${shape}".`);
  }
  return shape;
}

function resolveActiveLayer(
  value: unknown,
  known: ReadonlySet<string>,
  layers: readonly Layer[],
  warnings: string[],
): LayerId | null {
  if (typeof value === "string" && known.has(value)) {
    return value;
  }
  if (value !== null && value !== undefined) {
    warnings.push("The active layer recorded in the project no longer exists; the bottom layer was selected.");
  }
  // The fallback has to be a layer that paints: a group owns no content, so
  // it cannot be the destination of a drawing.
  const first = paintableLayers(layers)[0];
  return first ? first.id : null;
}
