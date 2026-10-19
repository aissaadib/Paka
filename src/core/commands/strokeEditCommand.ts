/**
 * Stroke edit commands: moving and deleting strokes without bitmap snapshots.
 *
 * Both are ordinary history commands: they change stroke *data*, never pixels,
 * so the layer is re-rasterized from its stroke list when they run. That is what
 * keeps a transform undoable and reproducible from a reopened file - the moved
 * strokes are still stroke samples, not a baked image.
 *
 * A command keeps the **original** sample coordinates and recomputes the edited
 * ones from them, so `apply` is idempotent and redo cannot accumulate
 * floating-point drift the way re-applying a delta (or an inverse matrix) would.
 */

import { createId } from "../../utils/id";
import type { StrokeRecord } from "../document/types";
import type { StrokeCommandHost } from "./strokeCommand";
import type { Command } from "./types";

/** A stroke's sample coordinates, copied so an edit can be reverted exactly. */
export interface StrokeSamples {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
}

export interface MoveEntry {
  readonly stroke: StrokeRecord;
  readonly original: StrokeSamples;
}

export interface DeleteEntry {
  readonly stroke: StrokeRecord;
  /** Position in its layer, so undo can put it back in painting order. */
  readonly index: number;
}

/** Copies a stroke's coordinates; the copy is what makes an edit revertible. */
export function copyStrokeSamples(stroke: StrokeRecord): StrokeSamples {
  return { xs: stroke.xs.slice(), ys: stroke.ys.slice() };
}

/**
 * Writes `original + (dx, dy)` into a stroke's sample arrays, in place.
 *
 * The single definition of what "moving a stroke" means: the live gesture and
 * the history command both go through it, so a preview and the committed result
 * cannot disagree. Arrays are filled rather than replaced so every holder of the
 * stroke (the store, a renderer highlight) sees the new coordinates.
 */
export function offsetStrokeSamples(
  stroke: StrokeRecord,
  original: StrokeSamples,
  dx: number,
  dy: number,
): void {
  const count = original.xs.length;
  stroke.xs.length = count;
  stroke.ys.length = count;
  for (let index = 0; index < count; index += 1) {
    stroke.xs[index] = original.xs[index] + dx;
    stroke.ys[index] = original.ys[index] + dy;
  }
}

/** Restores a stroke's coordinates from a copy. */
export function writeStrokeSamples(stroke: StrokeRecord, samples: StrokeSamples): void {
  const count = samples.xs.length;
  stroke.xs.length = count;
  stroke.ys.length = count;
  for (let index = 0; index < count; index += 1) {
    stroke.xs[index] = samples.xs[index];
    stroke.ys[index] = samples.ys[index];
  }
}

/** Re-rasterizes every distinct layer an edit touches, once each. */
function refreshLayers(host: StrokeCommandHost, strokes: readonly StrokeRecord[]): void {
  const seen = new Set<string>();
  for (const stroke of strokes) {
    if (seen.has(stroke.layerId)) {
      continue;
    }
    seen.add(stroke.layerId);
    host.refresh(stroke.layerId);
  }
}

/**
 * Moves strokes by a fixed offset. `push`ed, not executed: the live drag has
 * already placed the strokes, so recording the step is all that is left.
 */
export function createMoveStrokesCommand(
  entries: readonly MoveEntry[],
  dx: number,
  dy: number,
  host: StrokeCommandHost,
): Command {
  const strokes = entries.map((entry) => entry.stroke);
  return {
    id: createId("cmd"),
    label: "Move",
    apply(): void {
      for (const entry of entries) {
        offsetStrokeSamples(entry.stroke, entry.original, dx, dy);
      }
      refreshLayers(host, strokes);
    },
    revert(): void {
      for (const entry of entries) {
        writeStrokeSamples(entry.stroke, entry.original);
      }
      refreshLayers(host, strokes);
    },
  };
}

/** Removes strokes as one undo step, restoring their original order on undo. */
export function createDeleteStrokesCommand(
  entries: readonly DeleteEntry[],
  host: StrokeCommandHost,
): Command {
  // Ascending index order: re-inserting low indices first rebuilds the exact
  // original painting order in the layer.
  const ordered = [...entries].sort((a, b) => a.index - b.index);
  const strokes = ordered.map((entry) => entry.stroke);
  return {
    id: createId("cmd"),
    label: "Delete",
    apply(): void {
      for (const entry of ordered) {
        host.remove(entry.stroke);
      }
      refreshLayers(host, strokes);
    },
    revert(): void {
      for (const entry of ordered) {
        host.insert(entry.stroke, entry.index);
      }
      refreshLayers(host, strokes);
    },
  };
}
