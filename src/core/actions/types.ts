/**
 * Action metadata.
 *
 * An action is a user intent with a label, one or more keyboard chords and a
 * handler. The registry is deliberately narrow: it maps a chord to an intent
 * and calls the editor's existing explicit methods. It does not wrap document
 * mutations, own history, or provide an extension point.
 */

import type { DrawingEngine } from "../engine/DrawingEngine";
import type { EditorActions } from "../../state/editorStore";
import type { ToolId } from "../../types/tool";

/** File operations are callbacks owned by the workspace, not editor actions. */
export interface FileActionHandlers {
  readonly save?: () => void;
  readonly saveAs?: () => void;
  readonly open?: () => void;
}

/** Everything an action may use. The current state is read from the engine. */
export interface ActionContext {
  readonly engine: DrawingEngine;
  readonly actions: EditorActions;
  readonly file: FileActionHandlers;
  /** True when the matched chord required Shift (used by the nudge actions). */
  readonly shift: boolean;
}

/**
 * A keyboard chord.
 *
 * `key` is the logical key the shortcut is written with (`"b"`, `"["`,
 * `"arrowleft"`). `code` is the physical `KeyboardEvent.code`, used as the
 * fallback on layouts that do not produce the Latin key.
 */
export interface ShortcutSpec {
  readonly key: string;
  readonly code: string;
  /** The platform's primary modifier: Ctrl elsewhere, Cmd on macOS. */
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

export type ActionId =
  | "undo"
  | "redo"
  | "save"
  | "saveAs"
  | "open"
  | "duplicateLayer"
  | "duplicateSelection"
  | "flipHorizontal"
  | "flipVertical"
  | "zoomIn"
  | "zoomOut"
  | "zoomActual"
  | "zoomFit"
  | "toggleGrid"
  | "toggleGridSnapping"
  | "toggleRulers"
  | "nudgeLeft"
  | "nudgeRight"
  | "nudgeUp"
  | "nudgeDown"
  | "escape"
  | "delete"
  | "brushSizeDown"
  | "brushSizeUp"
  | `tool:${ToolId}`;

export interface ActionDefinition {
  readonly id: ActionId;
  readonly label: string;
  readonly shortcuts: readonly ShortcutSpec[];
  /** False when the action cannot run in the current state; it then claims no key. */
  readonly when?: (context: ActionContext) => boolean;
  readonly run: (context: ActionContext) => void;
}

/**
 * The user's own chords, keyed by action id.
 *
 * A user chord **replaces** the action's built-in chords: the user asked for
 * this key, so the command no longer answers to the key Paka shipped with.
 * An action that is not listed keeps its built-in chords, and an empty map is
 * the built-in behaviour.
 *
 * The chords are a preference, not an edit: changing one adds no history step,
 * dirties nothing and never reaches a project file.
 */
export type ShortcutOverrides = Readonly<Record<string, ShortcutSpec>>;
