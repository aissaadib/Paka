/**
 * The painted bounds of a layer's content.
 *
 * The union of what the layer's elements can ink: the strokes' own frames,
 * the fill patches' rectangles and the gradients' extents.
 *
 * It answers two questions. "Does the layer hold anything?" - a layer with no
 * bounds is empty - and "where is it?" - which is what a preview of the layer
 * is cropped to. A preview of the whole document would show a single small
 * mark as one pixel, which tells the artist nothing.
 *
 * Pure on purpose: the brush knowledge stays with the caller, because the
 * radius of a stroke's brush is a rendering fact, and this module is part of
 * the document model.
 */

import type { Bounds } from "../../types/geometry";
import type { LayerElement, StrokeRecord } from "./types";
import { isFillPatch, isGradient } from "./types";

/** How much of the content's own size is added around a cropped preview. */
export const PREVIEW_PADDING_RATIO = 0.08;

/**
 * The union of the bounds of `elements`, or `null` when there are none.
 *
 * @param strokeRadius the radius of a stroke's brush in document pixels
 */
export function contentBounds(
  elements: readonly LayerElement[],
  strokeRadius: (stroke: StrokeRecord) => number,
): Bounds | null {
  let result: Bounds | null = null;
  for (const element of elements) {
    const bounds = elementBounds(element, strokeRadius);
    if (bounds === null) {
      continue;
    }
    result = result === null ? bounds : unionBounds(result, bounds);
  }
  return result;
}

/** The bounds of one element, or `null` when it cannot ink anything. */
function elementBounds(
  element: LayerElement,
  strokeRadius: (stroke: StrokeRecord) => number,
): Bounds | null {
  if (isFillPatch(element)) {
    return { x: element.x, y: element.y, width: element.width, height: element.height };
  }
  if (isGradient(element)) {
    if (element.type === "radial") {
      const radius = Math.hypot(element.x2 - element.x1, element.y2 - element.y1);
      return {
        x: element.x1 - radius,
        y: element.y1 - radius,
        width: radius * 2,
        height: radius * 2,
      };
    }
    return {
      x: Math.min(element.x1, element.x2),
      y: Math.min(element.y1, element.y2),
      width: Math.abs(element.x2 - element.x1),
      height: Math.abs(element.y2 - element.y1),
    };
  }
  return strokeBounds(element, strokeRadius(element));
}

/** The frame a stroke's samples and brush can ink. */
function strokeBounds(stroke: StrokeRecord, radius: number): Bounds | null {
  if (stroke.xs.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < stroke.xs.length; index += 1) {
    const x = stroke.xs[index] ?? 0;
    const y = stroke.ys[index] ?? 0;
    if (x < minX) {
      minX = x;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }
  }
  return {
    x: minX - radius,
    y: minY - radius,
    width: maxX - minX + radius * 2,
    height: maxY - minY + radius * 2,
  };
}

/** The smallest rectangle that holds both. */
export function unionBounds(a: Bounds, b: Bounds): Bounds {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * The rectangle a preview of `bounds` shows, with a little room around it.
 *
 * The room keeps a mark from sitting flush against the edge of the preview,
 * and it is a ratio of the content's own size, so a small mark and a large
 * one are both framed the same way.
 */
export function previewBounds(bounds: Bounds): Bounds {
  const padding = Math.max(bounds.width, bounds.height) * PREVIEW_PADDING_RATIO;
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}
