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

/**
 * How far a transformed sample may move and still count as "did not move".
 *
 * Coordinates are document pixels, so a tenth of a pixel is far below anything
 * a brush can paint; it only absorbs the rounding of a reflection about a
 * half-pixel centre.
 */
const TRANSFORM_EPSILON = 1e-6;

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

/**
 * A coordinate map for a transform that is neither a translation nor an
 * insertion (flip today, rotation later).
 *
 * The map is only ever run from the stored **originals**, so it does not need an
 * inverse: revert restores the copies. A map must still be deterministic, which
 * is what makes redo reproduce the same pixels every time.
 */
export interface StrokeTransform {
  /** History label, e.g. `"Flip Horizontal"`. */
  readonly label: string;
  mapX(x: number, y: number): number;
  mapY(x: number, y: number): number;
}

/** Writes `transform(original)` into a stroke's sample arrays, in place. */
export function transformStrokeSamples(
  stroke: StrokeRecord,
  original: StrokeSamples,
  transform: StrokeTransform,
): void {
  const count = original.xs.length;
  stroke.xs.length = count;
  stroke.ys.length = count;
  for (let index = 0; index < count; index += 1) {
    const x = original.xs[index];
    const y = original.ys[index];
    stroke.xs[index] = transform.mapX(x, y);
    stroke.ys[index] = transform.mapY(x, y);
  }
}

/**
 * True when `transform` would move at least one sample of the given strokes.
 *
 * Used to refuse a transform that is a no-op - a horizontal flip of a perfectly
 * symmetric stroke, or of a single dab, maps every point onto itself. Recording
 * that would put a history entry on the stack whose undo changes nothing, which
 * reads to the user as a broken undo button. The check runs on the *original*
 * copies, so it answers for the command that would be pushed.
 */
export function transformChangesSamples(
  entries: readonly MoveEntry[],
  transform: StrokeTransform,
): boolean {
  for (const entry of entries) {
    const { xs, ys } = entry.original;
    for (let index = 0; index < xs.length; index += 1) {
      // A tolerance, not strict equality: a reflection about a half-pixel centre
      // can leave a mathematically-identical point a few ulps away, and that is
      // still a no-op the user did not ask for.
      if (
        Math.abs(transform.mapX(xs[index], ys[index]) - xs[index]) > TRANSFORM_EPSILON ||
        Math.abs(transform.mapY(xs[index], ys[index]) - ys[index]) > TRANSFORM_EPSILON
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Applies a coordinate map to strokes; `push`ed after the live edit. */
export function createTransformStrokesCommand(
  entries: readonly MoveEntry[],
  transform: StrokeTransform,
  host: StrokeCommandHost,
): Command {
  const strokes = entries.map((entry) => entry.stroke);
  return {
    id: createId("cmd"),
    label: transform.label,
    apply(): void {
      for (const entry of entries) {
        transformStrokeSamples(entry.stroke, entry.original, transform);
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

/**
 * A move that coalesces while the user keeps nudging the same selection.
 *
 * A run of arrow presses is one history step, exactly like a slider drag: each
 * push merges into the top entry by **summing the offsets** over the original
 * copies taken before the first nudge. Summing - rather than chaining deltas -
 * is what keeps `apply` exact after an undo, when the strokes are back at their
 * originals and the whole run has to be re-applied in one go.
 */
export interface NudgeCommand extends Command {
  /** Total offset applied since the run began, in document pixels. */
  readonly offset: { readonly x: number; readonly y: number };
}

export function createNudgeStrokesCommand(
  entries: readonly MoveEntry[],
  dx: number,
  dy: number,
  host: StrokeCommandHost,
  mergeKey: string,
): NudgeCommand {
  const strokes = entries.map((entry) => entry.stroke);
  const offset = { x: dx, y: dy };
  return {
    id: createId("cmd"),
    label: "Nudge",
    mergeKey,
    offset,
    apply(): void {
      for (const entry of entries) {
        offsetStrokeSamples(entry.stroke, entry.original, offset.x, offset.y);
      }
      refreshLayers(host, strokes);
    },
    revert(): void {
      for (const entry of entries) {
        writeStrokeSamples(entry.stroke, entry.original);
      }
      refreshLayers(host, strokes);
    },
    mergeWith(next: Command): Command {
      const nextOffset = (next as Partial<NudgeCommand>).offset;
      if (!nextOffset) {
        return this;
      }
      return createNudgeStrokesCommand(
        entries,
        offset.x + nextOffset.x,
        offset.y + nextOffset.y,
        host,
        mergeKey,
      );
    },
  };
}

/** A stroke to duplicate and the copy that will be inserted above it. */
export interface DuplicateEntry {
  readonly source: StrokeRecord;
  /** Position of the source in its layer. */
  readonly index: number;
  /** The copy; created once so redo re-inserts the same stroke, not a new one. */
  readonly clone: StrokeRecord;
}

/** A stroke and the index it will be inserted at. */
export interface StrokeInsertion {
  readonly stroke: StrokeRecord;
  readonly index: number;
}

/**
 * Insert positions for a set of duplicates: each copy goes directly **above**
 * its source, preserving the sources' relative order.
 *
 * The running `shift` accounts for the copies already inserted below, so a run
 * of consecutive sources ends up as `source, copy, source, copy` rather than
 * reversing their order. Recomputed from the captured source indices on every
 * apply, so undo/redo reproduces the same stack.
 */
export function planDuplicateInsertions(
  entries: readonly DuplicateEntry[],
): readonly StrokeInsertion[] {
  let shift = 0;
  return [...entries]
    .sort((a, b) => a.index - b.index)
    .map((entry) => {
      const index = entry.index + 1 + shift;
      shift += 1;
      return { stroke: entry.clone, index };
    });
}

/** Inserts stroke copies as one undo step, directly above their sources. */
export function createDuplicateStrokesCommand(
  entries: readonly DuplicateEntry[],
  host: StrokeCommandHost,
): Command {
  const insertions = planDuplicateInsertions(entries);
  const clones = insertions.map((insertion) => insertion.stroke);
  return {
    id: createId("cmd"),
    label: "Duplicate",
    apply(): void {
      for (const insertion of insertions) {
        host.insert(insertion.stroke, insertion.index);
      }
      refreshLayers(host, clones);
    },
    revert(): void {
      for (const clone of clones) {
        host.remove(clone);
      }
      refreshLayers(host, clones);
    },
  };
}
