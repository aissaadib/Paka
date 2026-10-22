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
  | "nudgeLeft"
  | "nudgeRight"
  | "nudgeUp"
  | "nudgeDown"
  | "escape"
  | "delete"
  | "brushSizeDown"
  | "brushSizeUp"
  | "brushSizeFineDown"
  | "brushSizeFineUp"
  | `tool:${ToolId}`;

export interface ActionDefinition {
  readonly id: ActionId;
  readonly label: string;
  readonly shortcuts: readonly ShortcutSpec[];
  /** False when the action cannot run in the current state; it then claims no key. */
  readonly when?: (context: ActionContext) => boolean;
  readonly run: (context: ActionContext) => void;
}
