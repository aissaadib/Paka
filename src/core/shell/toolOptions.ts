/**
 * Tool options: the contract for the controls a tool shows in the options bar.
 *
 * A tool's options are not React components. They are descriptions - "a
 * slider over `shapeSides`, written through `setShapeSides`" - and the
 * options bar turns a description into a control. That separation is what lets
 * a tool add an option without the options bar knowing about it, and what lets
 * the whole table be checked without a browser.
 *
 * The options themselves are registered per tool, so a feature that adds an
 * option to a tool it does not own can do so in its own module.
 */

import type { EditorSnapshot } from "../engine/DrawingEngine";
import type { EditorActions } from "../../state/editorStore";
import type { ToolId } from "../../types/tool";

/** A label, or a function of the snapshot when the label follows the tool. */
export type ToolOptionLabel = string | ((snapshot: EditorSnapshot) => string);

interface ToolOptionBase {
  /** Stable id, unique within one tool's option list. */
  readonly id: string;
  readonly label: ToolOptionLabel;
  readonly title?: string;
  /** Extra visibility rule on top of the tool's own association. */
  readonly visible?: (snapshot: EditorSnapshot) => boolean;
  /** The group heading the option sits under, when the options bar groups them. */
  readonly group?: string;
}

/** A continuous value. */
export interface SliderToolOption extends ToolOptionBase {
  readonly kind: "slider";
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly scale?: "linear" | "log";
  readonly format?: (value: number) => string;
  readonly read: (snapshot: EditorSnapshot) => number;
  readonly write: (actions: EditorActions, value: number) => void;
}

/** A whole number, typed into a field rather than dragged. */
export interface NumberToolOption extends ToolOptionBase {
  readonly kind: "number";
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly integer?: boolean;
  readonly format?: (value: number) => string;
  readonly read: (snapshot: EditorSnapshot) => number;
  readonly write: (actions: EditorActions, value: number) => void;
}

/** A flag. */
export interface ToggleToolOption extends ToolOptionBase {
  readonly kind: "toggle";
  readonly read: (snapshot: EditorSnapshot) => boolean;
  readonly write: (actions: EditorActions, value: boolean) => void;
}

/** One of a fixed set of values. */
export interface SelectToolOption extends ToolOptionBase {
  readonly kind: "select";
  readonly choices: readonly { readonly value: string; readonly label: string }[];
  readonly read: (snapshot: EditorSnapshot) => string;
  readonly write: (actions: EditorActions, value: string) => void;
}

/** A colour. */
export interface ColorToolOption extends ToolOptionBase {
  readonly kind: "color";
  readonly read: (snapshot: EditorSnapshot) => string;
  readonly write: (actions: EditorActions, value: string) => void;
}

/** A row of other options, shown together. */
export interface GroupToolOption extends ToolOptionBase {
  readonly kind: "group";
  readonly children: readonly ToolOption[];
}

/** Every kind of tool option. */
export type ToolOption =
  | SliderToolOption
  | NumberToolOption
  | ToggleToolOption
  | SelectToolOption
  | ColorToolOption
  | GroupToolOption;

/**
 * The name of a kind of tool option.
 *
 * The kinds are a closed list, so a consumer can enumerate them: the options
 * bar's renderer checks itself against this list, and a kind added here
 * without a control to draw it is a compile error rather than a blank space.
 *
 * This list is the *only* list of kinds. The dispatch that turns a kind into
 * the control that draws it lives in `core/options/optionControl.ts`, and it
 * is exhaustive against this list: a kind added here without a builder there
 * is a compile error in that one file, and the options bar - which draws the
 * control, not the kind - is not touched.
 */
export type ToolOptionKind =
  | "slider"
  | "number"
  | "toggle"
  | "select"
  | "color"
  | "group";

/** Every kind of tool option, in the order the contract lists them. */
export const TOOL_OPTION_KINDS: readonly ToolOptionKind[] = Object.freeze([
  "slider",
  "number",
  "toggle",
  "select",
  "color",
  "group",
]);

/** Whether an untrusted value names a kind of tool option. */
export function isToolOptionKind(value: unknown): value is ToolOptionKind {
  return (
    typeof value === "string" && (TOOL_OPTION_KINDS as readonly string[]).includes(value)
  );
}

/** Resolves a label against the current snapshot. */
export function toolOptionLabel(option: ToolOption, snapshot: EditorSnapshot): string {
  return typeof option.label === "function" ? option.label(snapshot) : option.label;
}

const optionsByTool = new Map<ToolId, ToolOption[]>();

/**
 * Replaces a tool's options.
 *
 * The built-in options use this. A tool with no entry has no options of its
 * own: its controls are the brush group, the colour panel or nothing at all.
 */
export function registerToolOptions(toolId: ToolId, options: readonly ToolOption[]): void {
  optionsByTool.set(toolId, [...options]);
}

/**
 * Adds options to a tool without removing the ones already there.
 *
 * An option whose id is already registered for that tool is ignored, so
 * registering the same extension twice does not show the control twice.
 */
export function appendToolOptions(toolId: ToolId, options: readonly ToolOption[]): void {
  const existing = optionsByTool.get(toolId) ?? [];
  const known = new Set(existing.map((option) => option.id));
  const added = options.filter((option) => {
    if (known.has(option.id)) {
      return false;
    }
    known.add(option.id);
    return true;
  });
  optionsByTool.set(toolId, [...existing, ...added]);
}

/** Removes a tool's options. Returns whether there were any. */
export function unregisterToolOptions(toolId: ToolId): boolean {
  return optionsByTool.delete(toolId);
}

/** A tool's options, in order. */
export function toolOptionsFor(toolId: ToolId): readonly ToolOption[] {
  return optionsByTool.get(toolId) ?? [];
}

/**
 * The options a tool shows right now, after the per-field visibility rules.
 *
 * A group is kept when at least one of its children is visible, and a group
 * with no visible children is dropped.
 */
export function visibleToolOptions(
  toolId: ToolId,
  snapshot: EditorSnapshot,
): readonly ToolOption[] {
  const visible: ToolOption[] = [];
  for (const option of toolOptionsFor(toolId)) {
    if (option.kind === "group") {
      const children = option.children.filter(
        (child) => child.visible?.(snapshot) ?? true,
      );
      if (children.length > 0) {
        visible.push({ ...option, children });
      }
      continue;
    }
    if (option.visible?.(snapshot) ?? true) {
      visible.push(option);
    }
  }
  return visible;
}

/** One option by id, or `undefined`. */
export function findToolOption(
  toolId: ToolId,
  id: string,
): ToolOption | undefined {
  for (const option of toolOptionsFor(toolId)) {
    if (option.id === id) {
      return option;
    }
    if (option.kind === "group") {
      const child = option.children.find((entry) => entry.id === id);
      if (child) {
        return child;
      }
    }
  }
  return undefined;
}

/**
 * Empties the registry.
 *
 * Only for tests: the built-in options register themselves when their module
 * is evaluated.
 */
export function resetToolOptions(): void {
  optionsByTool.clear();
}

/**
 * Tools whose drawing reads the brush group.
 *
 * Colour always stays available through the colour panel. The brush group is
 * hidden for tools that do not paint with a brush: the selection marquee, the
 * picker, the composition guides and pan. The bucket keeps its own tolerance
 * option, and the gradient keeps the brush opacity that its record captures.
 */
export function toolShowsBrushControls(toolId: ToolId): boolean {
  switch (toolId) {
    case "brush":
    case "eraser":
    case "line":
    case "rectangle":
    case "ellipse":
    case "polygon":
    case "star":
    case "gradient":
      return true;
    case "select":
    case "bucket":
    case "picker":
    case "guides":
    case "reference":
    case "pan":
      return false;
  }
}
