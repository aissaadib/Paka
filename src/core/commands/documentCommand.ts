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
import { updateLayer } from "../document/document";
import {
  addGroup,
  dissolveGroup,
  findLayer,
  groupLayers,
  isGroup,
  moveLayerIntoGroup,
  moveLayerOutOfGroup,
  moveLayerToParent,
} from "../document/layerGroups";
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
  /**
   * Elements this command deletes; restored on revert (layer deletion).
   *
   * A group deletion carries one transfer per paintable layer in the removed
   * subtree, so undo restores every child's content - not only the container's,
   * which never had any.
   */
  readonly removedElements?: readonly ElementTransfer[];
  /** Elements this command creates; removed on revert (layer duplication). */
  readonly addedElements?: readonly ElementTransfer[];
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
   *
   * The layer-group commands set it too: grouping, renaming, moving and
   * dissolving a group never remove a layer, so the layer the user is drawing
   * on stays the active one, before and after the undo.
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
    !findLayer(target.layers, active)
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
    for (const transfer of spec.removedElements ?? []) {
      host.clearLayerElements(transfer.layerId);
    }
    for (const transfer of spec.addedElements ?? []) {
      host.restoreLayerElements(transfer.layerId, transfer.elements);
    }
    host.applyDocument(resolveActiveLayer(spec.after, host.getDocument(), spec));
  };

  const revert = (): void => {
    for (const transfer of spec.addedElements ?? []) {
      host.clearLayerElements(transfer.layerId);
    }
    for (const transfer of spec.removedElements ?? []) {
      host.restoreLayerElements(transfer.layerId, transfer.elements);
    }
    host.applyDocument(resolveActiveLayer(spec.before, host.getDocument(), spec));
  };

  // Metadata-only changes are safe to coalesce; anything that moves content is
  // never merged, because combining two element transfers is ambiguous.
  const hasTransfer =
    (spec.removedElements?.length ?? 0) > 0 || (spec.addedElements?.length ?? 0) > 0;
  const mergeKey =
    spec.mergeKey !== undefined && !hasTransfer ? spec.mergeKey : undefined;

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

// ---------------------------------------------------------------- layer groups

/**
 * Why a layer-group change was refused.
 *
 * - `gesture`: a stroke, fill, gradient or selection gesture owns content
 *   that is not in history yet. A layer change could remove the layer the
 *   preview is painted into, so the release would commit into a layer that is
 *   no longer part of the document. The safe answer is to change nothing.
 * - `invalid`: the request itself cannot be carried out - an unknown layer, a
 *   group that does not exist, layers that are not siblings, a move that would
 *   make a group its own ancestor.
 */
export type LayerGroupRefusal = "gesture" | "invalid";

/** What the engine knows about the state a layer-group change happens in. */
export interface LayerGroupCommandOptions {
  /**
   * True while a stroke, fill, gradient or selection gesture is in flight.
   *
   * The engine owns that state, so it passes it in: a layer change is refused
   * while a gesture is in flight, exactly as it is for every other layer
   * operation.
   */
  readonly gestureInFlight?: boolean;
}

/** The result of asking for a layer-group change. */
export type LayerGroupCommandOutcome =
  | {
      readonly ok: true;
      /** The command: one undoable step. */
      readonly command: Command;
      /** The document the command applies. */
      readonly after: DrawingDocument;
    }
  | { readonly ok: false; readonly reason: LayerGroupRefusal };

/** Where a layer is moved to. */
export type GroupMoveTarget =
  /** Into the given group, at the top of it. */
  | { readonly kind: "into"; readonly groupId: LayerId }
  /** Out of the group that holds it, into the group above that one. */
  | { readonly kind: "out" };

/**
 * Creates an empty group at an explicit place in the tree.
 *
 * Unlike `createGroupLayersCommand`, this does not need two layers to group:
 * it is the "new folder" action. The caller places it (the panel puts it
 * directly above the active node, at the same level), and then moves layers
 * into it. The group starts empty and owns no content.
 */
export type LayerGroupCreateOutcome =
  | {
      readonly ok: true;
      readonly command: Command;
      readonly after: DrawingDocument;
      /** The new group, so the panel can focus it and start renaming. */
      readonly groupId: LayerId;
    }
  | { readonly ok: false; readonly reason: LayerGroupRefusal };

export function createAddGroupCommand(
  document: DrawingDocument,
  placement: {
    readonly name?: string;
    readonly parentId?: LayerId | null;
    readonly index?: number;
  },
  host: DocumentCommandHost,
  options: LayerGroupCommandOptions = {},
): LayerGroupCreateOutcome {
  if (options.gestureInFlight) {
    return { ok: false, reason: "gesture" };
  }
  const added = addGroup(document, placement);
  if (!added) {
    return { ok: false, reason: "invalid" };
  }
  return {
    ok: true,
    after: added.document,
    groupId: added.group.id,
    command: createDocumentCommand(
      {
        label: "New Group",
        before: document,
        after: added.document,
        preserveActiveLayer: true,
      },
      host,
    ),
  };
}

/**
 * Puts layers into a new group.
 *
 * The layers must be siblings, and there must be at least two of them; the
 * group takes the place of the topmost of them and keeps their order. Their
 * content is not touched: a group owns no content of its own, so the pixels
 * stay on the same layers.
 */
export function createGroupLayersCommand(
  document: DrawingDocument,
  layerIds: readonly LayerId[],
  host: DocumentCommandHost,
  options: LayerGroupCommandOptions = {},
): LayerGroupCommandOutcome {
  if (options.gestureInFlight) {
    return { ok: false, reason: "gesture" };
  }
  const after = groupLayers(document, layerIds);
  if (after === document) {
    return { ok: false, reason: "invalid" };
  }
  return {
    ok: true,
    after,
    command: createDocumentCommand(
      { label: "Group Layers", before: document, after, preserveActiveLayer: true },
      host,
    ),
  };
}

/**
 * Renames a group.
 *
 * A rename is a metadata change: it never touches the pixels, and undoing it
 * keeps the active layer, so the user stays on the layer they are looking at.
 */
export function createRenameGroupCommand(
  document: DrawingDocument,
  groupId: LayerId,
  name: string,
  host: DocumentCommandHost,
  options: LayerGroupCommandOptions = {},
): LayerGroupCommandOutcome {
  if (options.gestureInFlight) {
    return { ok: false, reason: "gesture" };
  }
  const trimmed = name.trim();
  const group = findLayer(document.layers, groupId);
  if (trimmed === "" || !group || !isGroup(group)) {
    return { ok: false, reason: "invalid" };
  }
  const after = updateLayer(document, groupId, { name: trimmed });
  if (after === document) {
    return { ok: false, reason: "invalid" };
  }
  return {
    ok: true,
    after,
    command: createDocumentCommand(
      { label: "Rename Group", before: document, after, preserveActiveLayer: true },
      host,
    ),
  };
}

/**
 * Moves a layer into a group, or out of the group that holds it.
 *
 * The move is refused when it would break the tree: a group may not be moved
 * into itself, nor into one of its own descendants - a child cannot be its
 * own ancestor.
 */
export function createMoveGroupMemberCommand(
  document: DrawingDocument,
  layerId: LayerId,
  target: GroupMoveTarget,
  host: DocumentCommandHost,
  options: LayerGroupCommandOptions = {},
): LayerGroupCommandOutcome {
  if (options.gestureInFlight) {
    return { ok: false, reason: "gesture" };
  }
  const after =
    target.kind === "into"
      ? moveLayerIntoGroup(document, layerId, target.groupId)
      : moveLayerOutOfGroup(document, layerId);
  if (after === document) {
    return { ok: false, reason: "invalid" };
  }
  return {
    ok: true,
    after,
    command: createDocumentCommand(
      { label: "Move Layer", before: document, after, preserveActiveLayer: true },
      host,
    ),
  };
}

/**
 * Moves a layer to an explicit parent and index.
 *
 * This is the drag-and-drop form of `createMoveGroupMemberCommand`: a single
 * command lands the node exactly where the drop marker said, even when the
 * destination is a different group. The tree rules (a destination must be a
 * group, a group may not enter its own subtree) are enforced by the pure
 * operation, so an invalid drop changes nothing and creates no history entry.
 */
export function createMoveLayerToParentCommand(
  document: DrawingDocument,
  layerId: LayerId,
  parentId: LayerId | null,
  index: number,
  host: DocumentCommandHost,
  options: LayerGroupCommandOptions = {},
): LayerGroupCommandOutcome {
  if (options.gestureInFlight) {
    return { ok: false, reason: "gesture" };
  }
  const after = moveLayerToParent(document, layerId, parentId, index);
  if (after === document) {
    return { ok: false, reason: "invalid" };
  }
  return {
    ok: true,
    after,
    command: createDocumentCommand(
      { label: "Move Layer", before: document, after, preserveActiveLayer: true },
      host,
    ),
  };
}

/**
 * Dissolves a group: its children take its place, in the same order.
 *
 * The children's pixels are untouched - a group owns no content of its own -
 * so the command moves no element data at all: it is a change of the tree
 * alone, and undoing it puts the tree back exactly as it was.
 */
export function createDissolveGroupCommand(
  document: DrawingDocument,
  groupId: LayerId,
  host: DocumentCommandHost,
  options: LayerGroupCommandOptions = {},
): LayerGroupCommandOutcome {
  if (options.gestureInFlight) {
    return { ok: false, reason: "gesture" };
  }
  const group = findLayer(document.layers, groupId);
  if (!group || !isGroup(group)) {
    return { ok: false, reason: "invalid" };
  }
  const after = dissolveGroup(document, groupId);
  if (after === document) {
    return { ok: false, reason: "invalid" };
  }
  return {
    ok: true,
    after,
    command: createDocumentCommand(
      { label: "Ungroup Layers", before: document, after, preserveActiveLayer: true },
      host,
    ),
  };
}
