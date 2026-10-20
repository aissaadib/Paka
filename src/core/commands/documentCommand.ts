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
import type { DrawingDocument, LayerElement, LayerId } from "../document/types";
import type { Command } from "./types";

/**
 * The engine side of a document command: read the current document, publish a
 * new one, and move layer content in and out of the store.
 */
export interface DocumentCommandHost {
  /** The document as it stands right now. */
  getDocument(): DrawingDocument;
  /** Publishes `next`: renderer sync, surface retention and a UI snapshot. */
  applyDocument(next: DrawingDocument): void;
  /** Removes every element of a layer. */
  clearLayerElements(layerId: LayerId): void;
  /** Replaces a layer's elements (idempotent: clears first, then inserts). */
  restoreLayerElements(layerId: LayerId, elements: readonly LayerElement[]): void;
}

/** A layer's content carried across a command boundary. */
export interface ElementTransfer {
  readonly layerId: LayerId;
  readonly elements: readonly LayerElement[];
}

export interface DocumentCommandSpec {
  readonly label: string;
  /** Document before the change; `revert()` restores exactly this. */
  readonly before: DrawingDocument;
  /** Document after the change; `apply()` restores exactly this. */
  readonly after: DrawingDocument;
  /** Elements this command deletes; restored on revert (layer deletion). */
  readonly removedElements?: ElementTransfer;
  /** Elements this command creates; removed on revert (layer duplication). */
  readonly addedElements?: ElementTransfer;
  /**
   * Opt-in history coalescing key. Commands sharing a key collapse into one
   * entry, which is how a slider drag becomes a single undo step. Keys are only
   * used for metadata-only changes (no element transfers).
   */
  readonly mergeKey?: string;
  /**
   * Keeps whichever layer is active right now when `before`/`after` is applied,
   * provided that layer still exists in the target document. Metadata commands
   * (rename, visibility, opacity, blend mode, reorder) set this so undo cannot
   * jump back to a layer that was active when the edit was made; that stale
   * active layer would also drop the user's current selection. Structural
   * commands (add/delete/duplicate) leave it off: they own which layer becomes
   * active.
   */
  readonly preserveActiveLayer?: boolean;
}

/**
 * Maps a command to the spec it was built from, so a merge can read the other
 * command's end state without widening the `Command` interface for everyone.
 */
const SPECS = new WeakMap<Command, DocumentCommandSpec>();

/**
 * Returns `target`, optionally with the active layer carried over from the
 * document as it is now. The current layer wins only while it still exists in
 * `target`; a structural undo that removes it falls back to the target's own
 * active layer so the document is never left pointing at a missing layer.
 */
function resolveActiveLayer(
  target: DrawingDocument,
  current: DrawingDocument,
  spec: DocumentCommandSpec,
): DrawingDocument {
  if (!spec.preserveActiveLayer) {
    return target;
  }
  const active = current.activeLayerId;
  if (
    active === null ||
    active === target.activeLayerId ||
    !target.layers.some((layer) => layer.id === active)
  ) {
    return target;
  }
  return { ...target, activeLayerId: active };
}

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
    if (spec.removedElements) {
      host.clearLayerElements(spec.removedElements.layerId);
    }
    if (spec.addedElements) {
      host.restoreLayerElements(spec.addedElements.layerId, spec.addedElements.elements);
    }
    host.applyDocument(resolveActiveLayer(spec.after, host.getDocument(), spec));
  };

  const revert = (): void => {
    if (spec.addedElements) {
      host.clearLayerElements(spec.addedElements.layerId);
    }
    if (spec.removedElements) {
      host.restoreLayerElements(spec.removedElements.layerId, spec.removedElements.elements);
    }
    host.applyDocument(resolveActiveLayer(spec.before, host.getDocument(), spec));
  };

  // Metadata-only changes are safe to coalesce; anything that moves content is
  // never merged, because combining two element transfers is ambiguous.
  const mergeKey =
    spec.mergeKey !== undefined && !spec.removedElements && !spec.addedElements
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
      preserveActiveLayer: current.preserveActiveLayer,
    },
    host,
  );
}
