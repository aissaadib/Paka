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
  legacyPressureMapping,
  normalizePressureMapping,
} from "../brushes/pressureMapping";
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
import { isFillPatch, isGradient } from "../document/types";
import { MAX_FILL_SCAN_PIXELS } from "../fill/floodFill";
import type { BrushSettings, PressureMapping } from "../../types/brush";
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
 * Version 13: a stroke's `brush` carries the pressure *mappings* - one per
 * property that answers pressure (size, opacity and flow), each with an
 * enabled flag and the response at no pressure and at full pressure. The
 * shape of the file changed, so the version was bumped and the fields are
 * required from 13. A version-12 file holds a single strength per property
 * instead, and is read as the mapping that strength stood for - which is
 * exactly the response the file was written by - so version-1 to -12 files
 * open unchanged.
 *
 * Since version 9, `document.guides` is **additive**: the composition guides
 * are display-only, so a reader that does not know the field ignores it and
 * draws the very same picture - the same situation as `stabilizer` within
 * version 6. That is why the version was not bumped for them. A file without
 * the field opens with no guides at all.
 *
 * Bump when the shape of the file changes in a way older readers cannot read.
 */
export const PROJECT_VERSION = 13;
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
  /** Painting order: strokes, fills and gradients interleave exactly as made. */
  readonly elements: readonly SerializedElement[];
}

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
    },
    layers: document.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      elements: strokes.listElements(layer.id).map(serializeElement),
    })),
  };

  return JSON.stringify(payload);
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
  const seenLayerIds = new Set<string>();
  let sampleCount = 0;
  let fillPixelCount = 0;

  root.layers.forEach((rawLayer, layerIndex) => {
    const label = `Layer ${layerIndex + 1}`;
    const record = asRecord(rawLayer, label);

    const id = readId(record.id, "layer");
    if (seenLayerIds.has(id)) {
      fail(`Two layers in this project share the id "${id}".`);
    }
    seenLayerIds.add(id);

    let layerName = `Layer ${layerIndex + 1}`;
    if (typeof record.name === "string" && record.name.trim() !== "") {
      layerName = record.name;
    } else {
      warnings.push(`${label} had no name and was renamed.`);
    }

    const opacity = readNumber(record.opacity, `${label} opacity`, 0, 1);
    const visible = readBoolean(record.visible, `${label} visibility`);
    const blendMode = readString(record.blendMode, `${label} blend mode`);
    if (!isLayerBlendMode(blendMode)) {
      fail(`${label} uses the unsupported blend mode "${blendMode}".`);
    }

    layers.push({ id, name: layerName, visible, opacity, blendMode });

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
        const kind = readString(element.kind, `${elementLabel} kind`);
        if (kind === "fill") {
          const patch = readFillPatch(
            element,
            elementLabel,
            id,
            width,
            height,
            fillPixelCount,
            maxFillPixels,
          );
          fillPixelCount += patch.width * patch.height;
          elements.push(patch);
          continue;
        }
        if (kind === "gradient") {
          if (version < 5) {
            fail(`${elementLabel} uses a gradient, which requires file version 5.`);
          }
          elements.push(readGradient(element, elementLabel, id, width, height));
          continue;
        }
        if (kind !== "stroke") {
          fail(`${elementLabel} has the unknown kind "${kind}".`);
        }
      }

      const stroke = readStroke(
        element,
        elementLabel,
        id,
        sampleCount,
        maxSamples,
        version,
      );
      sampleCount += stroke.xs.length;
      elements.push(stroke);
      strokes.push(stroke);
    }
  });

  const activeLayerId = resolveActiveLayer(rawDocument.activeLayerId, seenLayerIds, layers, warnings);
  const guides = readGuides(rawDocument.guides, warnings);

  const document: DrawingDocument = {
    id: documentId,
    name,
    width,
    height,
    background,
    layers,
    activeLayerId,
    guides,
  };

  return { document, elements, strokes, warnings };
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

/**
 * Reads one pressure mapping out of a stroke's brush.
 *
 * A file written before version 13 holds a single strength per property, and
 * the strength is read as the mapping it stood for. A file written from
 * version 13 holds the mapping itself: whether it is enabled, and the
 * response at no pressure and at full pressure.
 */
function readPressureMapping(value: unknown, label: string, version: number): PressureMapping {
  if (typeof value === "number") {
    return legacyPressureMapping(readNumber(value, label, 0, 1));
  }
  if (version < 13) {
    // Every file before version 13 held a strength, so a missing field is a
    // file that was edited by hand.
    fail(`${label} must be a number between 0 and 1.`);
  }
  if (value === undefined) {
    fail(`${label} is missing.`);
  }
  const record = asRecord(value, label);
  if (typeof record.enabled !== "boolean") {
    fail(`${label} must say whether it is enabled.`);
  }
  const min = readNumber(record.min, `${label} minimum response`, 0, 1);
  const max = readNumber(record.max, `${label} maximum response`, 0, 1);
  // The ends arrive in either order in a hand-edited file; the response is
  // always the rising line between them.
  return normalizePressureMapping({
    enabled: record.enabled,
    min,
    max,
  });
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
    // The pressure mappings replaced the per-property strengths in version 13.
    // A file written before that holds the strength, and the strength is read
    // as the mapping it stood for - which is the response the file was
    // written by, so the picture does not change.
    pressureSize: readPressureMapping(record.pressureSize, `${label} brush pressure size`, version),
    pressureOpacity: readPressureMapping(
      record.pressureOpacity,
      `${label} brush pressure opacity`,
      version,
    ),
    // The flow mapping is new in version 13: an earlier file has no flow, and
    // no flow is exactly the flat response those files were written by.
    pressureFlow:
      version >= 13
        ? readPressureMapping(record.pressureFlow, `${label} brush pressure flow`, version)
        : DEFAULT_BRUSH.pressureFlow,
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
  });
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
  const first = layers[0];
  return first ? first.id : null;
}
