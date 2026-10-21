/** Tool identity and metadata for the tool rail. */

export type ToolId =
  | "brush"
  | "eraser"
  | "select"
  | "line"
  | "rectangle"
  | "ellipse"
  | "polygon"
  | "star"
  | "bucket"
  | "gradient"
  | "picker"
  | "pan";

export interface ToolDefinition {
  readonly id: ToolId;
  readonly label: string;
  /** Single-key shortcut, matched case-insensitively without modifiers. */
  readonly shortcut: string;
  /** Description used for accessible labels and tooltips. */
  readonly description: string;
  /**
   * True when this tool's shapes enclose an area that can be filled.
   *
   * It belongs here rather than on the runtime `Tool` because it describes the
   * geometry, not the gesture: the rectangle and ellipse outlines bound an
   * interior, a line does not. Both the engine (which stamps the flag onto a
   * committed shape) and the toolbar (which offers the fill toggle) read it from
   * the same place.
   */
  readonly fillable?: boolean;
}
