/**
 * Gradient records.
 *
 * A gradient is document content described by geometry and colour stops, not by
 * the pixels it happened to produce. Creating and editing the record here keeps
 * the engine free of canvas details and makes the project writer and renderer
 * consume the same self-describing value.
 */

import { hexToRgb, rgbToHex } from "../../utils/color";
import { createId } from "../../utils/id";
import { clamp } from "../../utils/math";
import type { GradientRecord, GradientStop, LayerId } from "../document/types";

/** Below this distance (document pixels) a drag has no meaningful direction. */
export const MIN_GRADIENT_LENGTH = 1;

/** The end colour a new gradient starts with; the toolbar can change it. */
export const DEFAULT_GRADIENT_END_COLOR = "#ffffff";

/**
 * Most middle stops the editor writes.
 *
 * The format allows 64 stops in total, so two are reserved for the endpoints.
 * Persistence already accepts that many; this bound belongs to the editor, not
 * the file.
 */
export const MAX_GRADIENT_MID_STOPS = 62;

export interface GradientGeometry {
  readonly type: "linear" | "radial";
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/**
 * Normalizes a brush colour to the `#rrggbb` form the file format requires.
 * Brush colours come from the hex colour controls, but keeping this record's
 * invariant here means an invalid caller cannot create a gradient the parser
 * would later reject.
 */
function normalizeStopColor(color: string, fallback: string): string {
  const rgb = hexToRgb(color);
  return rgb ? rgbToHex(rgb) : fallback;
}

/**
 * Normalizes the middle stops of a gradient.
 *
 * Middle stops are everything strictly between the endpoints: offset `0` is the
 * start colour and offset `1` the end colour, so a stop at either edge is
 * dropped rather than allowed to fight the endpoint. Invalid colours and
 * non-finite offsets are dropped, offsets are clamped, sorted and deduplicated,
 * and the list is capped at `MAX_GRADIENT_MID_STOPS`.
 */
export function normalizeGradientMidStops(
  stops: readonly GradientStop[],
): readonly GradientStop[] {
  if (!Array.isArray(stops)) {
    return [];
  }
  const points: GradientStop[] = [];
  for (const stop of stops) {
    if (points.length >= MAX_GRADIENT_MID_STOPS) {
      break;
    }
    if (typeof stop !== "object" || stop === null) {
      continue;
    }
    if (typeof stop.offset !== "number" || !Number.isFinite(stop.offset)) {
      continue;
    }
    if (typeof stop.color !== "string") {
      continue;
    }
    const offset = clamp(stop.offset, 0, 1);
    if (offset <= 0 || offset >= 1) {
      continue;
    }
    const color = normalizeStopColor(stop.color, "");
    if (!color) {
      continue;
    }
    points.push({ offset, color });
  }

  points.sort((a, b) => a.offset - b.offset);
  const deduped: GradientStop[] = [];
  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (previous && point.offset - previous.offset < 1e-6) {
      continue;
    }
    deduped.push(point);
    if (deduped.length >= MAX_GRADIENT_MID_STOPS) {
      break;
    }
  }
  return deduped;
}

/** True when two middle-stop lists describe the same stops. */
export function gradientStopsEqual(
  a: readonly GradientStop[],
  b: readonly GradientStop[],
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index].offset !== b[index].offset || a[index].color !== b[index].color) {
      return false;
    }
  }
  return true;
}

/**
 * Builds the gradient a drag creates.
 *
 * `midStops` are the stops strictly between the start and end colours; the
 * caller keeps the two endpoint colours as separate options. The result is
 * always sorted and strictly ascending, which is what the file reader requires.
 */
export function createGradientRecord(
  layerId: LayerId,
  geometry: GradientGeometry,
  startColor: string,
  endColor: string,
  opacity: number,
  midStops: readonly GradientStop[] = [],
): GradientRecord {
  return {
    id: createId("gradient"),
    layerId,
    kind: "gradient",
    type: geometry.type,
    x1: geometry.x1,
    y1: geometry.y1,
    x2: geometry.x2,
    y2: geometry.y2,
    stops: [
      { offset: 0, color: normalizeStopColor(startColor, "#000000") },
      ...normalizeGradientMidStops(midStops).map(
        (stop): GradientStop => ({ offset: stop.offset, color: stop.color }),
      ),
      { offset: 1, color: normalizeStopColor(endColor, DEFAULT_GRADIENT_END_COLOR) },
    ],
    opacity: clamp(opacity, 0, 1),
  };
}

/** Moves the free end of an in-progress gradient without touching its stops. */
export function moveGradientEnd(
  gradient: GradientRecord,
  x2: number,
  y2: number,
): GradientRecord {
  if (gradient.x2 === x2 && gradient.y2 === y2) {
    return gradient;
  }
  return { ...gradient, x2, y2 };
}

/** The drag length that defines a linear axis or a radial radius. */
export function gradientLength(gradient: GradientGeometry): number {
  return Math.hypot(gradient.x2 - gradient.x1, gradient.y2 - gradient.y1);
}

/** True when a gradient is too short to produce a visible direction. */
export function gradientIsDegenerate(gradient: GradientGeometry): boolean {
  return gradientLength(gradient) < MIN_GRADIENT_LENGTH;
}

/** Deep copy for layer duplication, with fresh identity and independent stops. */
export function cloneGradient(
  gradient: GradientRecord,
  layerId: LayerId = gradient.layerId,
): GradientRecord {
  return {
    ...gradient,
    id: createId("gradient"),
    layerId,
    stops: gradient.stops.map((stop): GradientStop => ({ ...stop })),
  };
}
