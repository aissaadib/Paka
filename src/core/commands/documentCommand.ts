/**
 * Document commands: layer operations as reversible history entries.
 *
 * A command stores the two document states around the change and, when a layer
 * is created or destroyed, the stroke data that moves with it. Documents are
 * pure metadata (an ordered list of layer descriptors), so keeping two of them
 * costs a couple of small objects - never a bitmap snapshot. Strokes are the
 * one heavier thing a layer operation can touch, and only layer deletion and
 * duplication transfer them.
 *
 * The engine owns the document and the stroke store; this module owns the
 * apply/revert logic and knows nothing about rendering, React or files. That is
 * the same split the stroke command uses, so both kinds of step live in one
 * stack and undo behaves uniformly.
 */

import { createId } from "../../utils/id";
import type { DrawingDocument, LayerId, StrokeRecord } from "../document/types";
import type { Command } from "./types";

/**
 * The engine side of a document command: read the current document, publish a
 * new one, and move stroke data in and out of the store.
 */
export interface DocumentCommandHost {
  /** The document as it stands right now. */
  getDocument(): DrawingDocument;
  /** Publishes `next`: renderer sync, surface retention and a UI snapshot. */
  applyDocument(next: DrawingDocument): void;
  /** Removes every stroke of a layer. */
  clearLayerStrokes(layerId: LayerId): void;
  /** Replaces a layer's strokes (idempotent: clears first, then inserts). */
  restoreLayerStrokes(layerId: LayerId, strokes: readonly StrokeRecord[]): void;
}

/** A layer's stroke data carried across a command boundary. */
export interface StrokeTransfer {
  readonly layerId: LayerId;
  readonly strokes: readonly StrokeRecord[];
}

export interface DocumentCommandSpec {
  readonly label: string;
  /** Document before the change; `revert()` restores exactly this. */
  readonly before: DrawingDocument;
  /** Document after the change; `apply()` restores exactly this. */
  readonly after: DrawingDocument;
  /** Strokes this command deletes; restored on revert (layer deletion). */
  readonly removedStrokes?: StrokeTransfer;
  /** Strokes this command creates; removed on revert (layer duplication). */
  readonly addedStrokes?: StrokeTransfer;
  /**
   * Opt-in history coalescing key. Commands sharing a key collapse into one
   * entry, which is how a slider drag becomes a single undo step. Keys are only
   * used for metadata-only changes (no stroke transfers).
   */
  readonly mergeKey?: string;
}

/**
 * Maps a command to the spec it was built from, so a merge can read the other
 * command's end state without widening the `Command` interface for everyone.
 */
const SPECS = new WeakMap<Command, DocumentCommandSpec>();

/**
 * Builds a reversible layer operation. Commands are created *already applied*
 * or *about to be applied*: `apply()` is what the stack runs for redo, and
 * `revert()` is what it runs for undo.
 */
export function createDocumentCommand(
  spec: DocumentCommandSpec,
  host: DocumentCommandHost,
): Command {
  const apply = (): void => {
    if (spec.removedStrokes) {
      host.clearLayerStrokes(spec.removedStrokes.layerId);
    }
    if (spec.addedStrokes) {
      host.restoreLayerStrokes(spec.addedStrokes.layerId, spec.addedStrokes.strokes);
    }
    host.applyDocument(spec.after);
  };

  const revert = (): void => {
    if (spec.addedStrokes) {
      host.clearLayerStrokes(spec.addedStrokes.layerId);
    }
    if (spec.removedStrokes) {
      host.restoreLayerStrokes(spec.removedStrokes.layerId, spec.removedStrokes.strokes);
    }
    host.applyDocument(spec.before);
  };

  // Metadata-only changes are safe to coalesce; anything that moves strokes is
  // never merged, because combining two stroke transfers is ambiguous.
  const mergeKey =
    spec.mergeKey !== undefined && !spec.removedStrokes && !spec.addedStrokes
      ? spec.mergeKey
      : undefined;

  const command: Command =
    mergeKey === undefined
      ? { id: createId("cmd"), label: spec.label, apply, revert }
      : {
          id: createId("cmd"),
          label: spec.label,
          mergeKey,
          mergeWith: (next) => mergeInto(spec, next, host),
          apply,
          revert,
        };

  SPECS.set(command, spec);
  return command;
}

/**
 * Extends `current` through to `next`'s end state, keeping `current`'s earliest
 * revert point. The merged command is therefore a single step that undoes the
 * whole span.
 *
 * Merge keys are issued only for metadata-only commands (see
 * `createDocumentCommand`), so the other command always carries a plain
 * document swap and nothing else has to be combined. The `host.getDocument()`
 * fallback keeps the end state correct if that invariant is ever broken.
 */
function mergeInto(current: DocumentCommandSpec, next: Command, host: DocumentCommandHost): Command {
  const nextSpec = SPECS.get(next);
  return createDocumentCommand(
    {
      label: current.label,
      before: current.before,
      after: nextSpec ? nextSpec.after : host.getDocument(),
      mergeKey: current.mergeKey,
    },
    host,
  );
}
