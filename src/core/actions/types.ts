/**
 * Action metadata.
 *
 * An action is a user intent with a label, a handler and - usually - one or
 * more keyboard chords. The registry is the single source of truth for the
 * commands the keyboard, the canvas menu and the command palette offer: it
 * maps a chord or a name to an intent and calls the editor's existing
 * explicit methods. It does not wrap document mutations, own history, or
 * provide an extension point.
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

/**
 * Shell commands that belong to the interface rather than to the document.
 *
 * They are separate from the file handlers because they are not about the
 * file: opening the command palette changes what is on screen and nothing
 * else.
 */
export interface UiActionHandlers {
  /** Opens the command palette. */
  readonly openCommandPalette?: () => void;
}

/** Everything an action may use. The current state is read from the engine. */
export interface ActionContext {
  readonly engine: DrawingEngine;
  readonly actions: EditorActions;
  readonly file: FileActionHandlers;
  /** Shell commands, such as opening the command palette. */
  readonly ui?: UiActionHandlers;
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
  | "viewRotate"
  | "viewMirror"
  | "viewReset"
  | "toggleGrid"
  | "toggleGridSnapping"
  | "toggleRulers"
  | "toggleSymmetry"
  | "nudgeLeft"
  | "nudgeRight"
  | "nudgeUp"
  | "nudgeDown"
  | "escape"
  | "delete"
  | "brushSizeDown"
  | "brushSizeUp"
  | "selectAll"
  | "deselect"
  | "scaleSelection"
  | "rotateSelectionClockwise"
  | "rotateSelectionCounterClockwise"
  | "addLayer"
  | "commandPalette"
  | "brushSizeFineDown"
  | "brushSizeFineUp"
  | `tool:${ToolId}`;

export interface ActionDefinition {
  readonly id: ActionId;
  readonly label: string;
  /**
   * The chords that invoke this action.
   *
   * Empty for a command-only action: "rotate 15 degrees clockwise" has no
   * natural key and is reached by name, from the canvas menu or the command
   * palette.
   */
  readonly shortcuts: readonly ShortcutSpec[];
  /**
   * True when the action is invoked by name only.
   *
   * A command-only action claims no key, so it can never shadow another
   * action's chord.
   */
  readonly commandOnly?: boolean;
  /** False when the action cannot run in the current state; it then claims no key. */
  readonly when?: (context: ActionContext) => boolean;
  /**
   * Why the action cannot run right now, or `null` when it can.
   *
   * The rule decides; the keyboard guard (`when`) is a separate concern. A
   * menu shows the reason next to the disabled row, so the user is told what
   * is missing rather than left with a greyed-out command.
   */
  readonly available?: (context: ActionContext) => string | null;
  /**
   * True when the action is a toggle that is currently on.
   *
   * A toggle's label therefore stays neutral ("Grid"), and the menu and the
   * palette show the state with a tick.
   */
  readonly checked?: (context: ActionContext) => boolean;
  readonly run: (context: ActionContext) => void;
}
