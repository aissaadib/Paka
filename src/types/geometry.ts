/**
 * Geometry primitives shared across the editor.
 *
 * These types are intentionally coordinate-space agnostic: the same `Point`
 * type is used for document coordinates and canvas-local screen coordinates.
 * Callers must know which space they are working in, and conversion between
 * the two always goes through `core/rendering/viewport.ts`.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Axis-aligned rectangle described by its origin and size. */
export interface Bounds extends Point, Size {}
