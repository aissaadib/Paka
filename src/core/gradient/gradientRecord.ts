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

/** Builds the two-stop gradient a drag creates. */
export function createGradientRecord(
  layerId: LayerId,
  geometry: GradientGeometry,
  startColor: string,
  endColor: string,
  opacity: number,
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
