/**
 * The Paka project format.
 *
 * A project file is a versioned JSON document. It stores **metadata plus the
 * stroke data that produced the pixels**, never a flattened image:
 *
 * ```
 * { format, version, document: {...}, layers: [ { ...layer, strokes: [...] } ] }
 * ```
 *
 * Why strokes and not pixel buffers: in this engine the stroke list *is* the
 * authoritative record (pixels are a cache rasterized from it). Saving strokes
 * keeps every layer editable after a reload - individual strokes stay
 * undoable, nothing is resampled, and file size does not depend on the display
 * resolution the drawing happened to be made at. Storing a flattened PNG would
 * destroy exactly that.
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
import type { DrawingDocument, Layer, LayerId, StrokeRecord, StrokeSource } from "../document/types";
import type { BrushSettings } from "../../types/brush";
import { reserveId } from "../../utils/id";

export const PROJECT_FORMAT_ID = "paka-project";
/**
 * Version 1: metadata plus brush strokes.
 * Version 2: strokes may carry `erase: true` (an eraser stroke subtracts
 * coverage). A version-1 reader would paint such a stroke instead of removing
 * it - the drawing would come out different, not merely incomplete - so the
 * version was bumped. Version-1 files still open, and are written back as 2.
 *
 * Bump when the shape of the file changes in a way older readers cannot read.
 */
export const PROJECT_VERSION = 2;
export const PROJECT_FILE_EXTENSION = "paka";
/** Upper bound on the stroke sample points a file may contain (x/y/pressure/time each). */
export const MAX_PROJECT_SAMPLES = 5_000_000;

export interface SerializedStroke {
  readonly id: string;
  readonly brush: BrushSettings;
  readonly startTime: number;
  /** Present and true only for eraser strokes; absent means a brush stroke. */
  readonly erase?: boolean;
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  readonly pressures: readonly number[];
  readonly times: readonly number[];
}

export interface SerializedLayer {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly blendMode: string;
  readonly strokes: readonly SerializedStroke[];
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
  /** Layer metadata with pixel-independent fields only; strokes are separate. */
  readonly document: DrawingDocument;
  /** Every stroke of every layer, in document order, each tagged with its layer. */
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

/** Serializes document metadata and stroke data into the project text. */
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
      strokes: strokes.listStrokes(layer.id).map((stroke) => ({
        id: stroke.id,
        brush: stroke.brush,
        startTime: stroke.startTime,
        // Only eraser strokes carry the flag, so brush-only drawings stay
        // byte-identical to what version 2 wrote before erasers existed.
        ...(stroke.erase === true ? { erase: true as const } : {}),
        xs: stroke.xs,
        ys: stroke.ys,
        pressures: stroke.pressures,
        times: stroke.times,
      })),
    })),
  };

  return JSON.stringify(payload);
}

/**
 * Reads project text. Never throws: a malformed or unsupported file comes back
 * as `{ ok: false }` with a message meant for the user.
 */
export function parseProject(text: string, options: ParseProjectOptions = {}): ProjectParseResult {
  try {
    return { ok: true, project: readProject(text, options.maxSamples ?? MAX_PROJECT_SAMPLES) };
  } catch (error) {
    if (error instanceof ProjectFormatError) {
      return { ok: false, error: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `The project file could not be read: ${message}` };
  }
}

function readProject(text: string, maxSamples: number): ParsedProject {
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
  if (root.version > PROJECT_VERSION) {
    fail(
      `This project was created by a newer version of Paka (file version ${root.version}, ` +
        `this build reads up to ${PROJECT_VERSION}).`,
    );
  }
  if (root.version < 1) {
    fail(`Unsupported project file version ${root.version}.`);
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
  const strokes: StrokeRecord[] = [];
  const seenLayerIds = new Set<string>();
  let sampleCount = 0;

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

    const layerStrokes = readStrokesOf(record.strokes, `${label} strokes`);
    for (const [strokeIndex, rawStroke] of layerStrokes.entries()) {
      const strokeLabel = `${label}, stroke ${strokeIndex + 1}`;
      const stroke = asRecord(rawStroke, strokeLabel);
      const xs = readSampleArray(stroke.xs, `${strokeLabel} x`, sampleCount, maxSamples);
      const ys = readSampleArray(stroke.ys, `${strokeLabel} y`, sampleCount, maxSamples);
      const pressures = readSampleArray(stroke.pressures, `${strokeLabel} pressure`, sampleCount, maxSamples);
      const times = readSampleArray(stroke.times, `${strokeLabel} time`, sampleCount, maxSamples);

      if (ys.length !== xs.length || pressures.length !== xs.length || times.length !== xs.length) {
        fail(`${strokeLabel} has mismatched sample arrays (${xs.length}/${ys.length}/${pressures.length}/${times.length}).`);
      }

      sampleCount += xs.length;

      const erase =
        stroke.erase === undefined ? false : readBoolean(stroke.erase, `${strokeLabel} erase flag`);

      strokes.push({
        id: readId(stroke.id, "stroke"),
        layerId: id,
        brush: readBrush(stroke.brush, strokeLabel),
        // Only eraser strokes carry the flag: `erase: false` and "no flag" mean
        // the same thing, and old files have no flag at all.
        ...(erase ? { erase: true as const } : {}),
        xs,
        ys,
        pressures,
        times,
        startTime:
          typeof stroke.startTime === "number" && Number.isFinite(stroke.startTime) ? stroke.startTime : 0,
      });
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

  return { document, strokes, warnings };
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

function readBrush(value: unknown, label: string): BrushSettings {
  const record = asRecord(value, `${label} brush`);
  const color = readString(record.color, `${label} brush colour`);
  if (color.trim() === "") {
    fail(`${label} brush colour is empty.`);
  }

  return normalizeBrush({
    size: readNumber(record.size, `${label} brush size`, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE),
    opacity: readNumber(record.opacity, `${label} brush opacity`, 0, 1),
    color,
    pressureSize: readNumber(record.pressureSize, `${label} brush pressure size`, 0, 1),
    pressureOpacity: readNumber(record.pressureOpacity, `${label} brush pressure opacity`, 0, 1),
    minSizeRatio: readNumber(record.minSizeRatio, `${label} brush minimum size ratio`, 0.02, 1),
    spacing: readNumber(record.spacing, `${label} brush spacing`, 0.02, 2),
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
