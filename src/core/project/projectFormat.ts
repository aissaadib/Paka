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

import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE, normalizeBrush } from "../brushes/defaults";
import {
  DEFAULT_DOCUMENT_BACKGROUND,
  isValidDocumentSize,
  MAX_DOCUMENT_SIZE,
  MIN_DOCUMENT_SIZE,
} from "../document/document";
import type {
  DrawingDocument,
  FillPatchRecord,
  GradientRecord,
  GradientStop,
  Layer,
  LayerElement,
  LayerId,
  StrokeRecord,
  StrokeSource,
} from "../document/types";
import { isFillPatch, isGradient } from "../document/types";
import { MAX_FILL_SCAN_PIXELS } from "../fill/floodFill";
import type { BrushSettings } from "../../types/brush";
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
 * Bump when the shape of the file changes in a way older readers cannot read.
 */
export const PROJECT_VERSION = 6;
export const PROJECT_FILE_EXTENSION = "paka";
/** Upper bound on the stroke sample points a file may contain (x/y/pressure/time each). */
export const MAX_PROJECT_SAMPLES = 5_000_000;
/** Upper bound on the total fill-mask pixels a file may contain. */
export const MAX_PROJECT_FILL_PIXELS = MAX_FILL_SCAN_PIXELS;
/** Upper bound on colour stops in one gradient. */
export const MAX_PROJECT_GRADIENT_STOPS = 64;

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
  };
  /** Bottom-first, matching the in-memory document order. */
  readonly layers: readonly SerializedLayer[];
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

function readProject(text: string, maxSamples: number, maxFillPixels: number): ParsedProject {
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
  if (version > PROJECT_VERSION) {
    fail(
      `This project was created by a newer version of Paka (file version ${version}, ` +
        `this build reads up to ${PROJECT_VERSION}).`,
    );
  }
  if (version < 1) {
    fail(`Unsupported project file version ${version}.`);
  }

  const warnings: string[] = [];
  const rawDocument = asRecord(root.document, "The project document");

  const width = Math.round(readAnyNumber(rawDocument.width, "The document width"));
  const height = Math.round(readAnyNumber(rawDocument.height, "The document height"));
  if (!isValidDocumentSize(width, height)) {
    fail(
      `The document size ${width}x${height} is outside the supported range ` +
        `(${MIN_DOCUMENT_SIZE}-${MAX_DOCUMENT_SIZE} px).`,
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
    if (blendMode !== "normal") {
      fail(`${label} uses the unsupported blend mode "${blendMode}".`);
    }

    layers.push({ id, name: layerName, visible, opacity, blendMode: "normal" });

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

  const document: DrawingDocument = {
    id: documentId,
    name,
    width,
    height,
    background,
    layers,
    activeLayerId,
  };

  return { document, elements, strokes, warnings };
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
