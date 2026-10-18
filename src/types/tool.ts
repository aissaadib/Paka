/** Tool identity and metadata for the tool rail. */

export type ToolId = "brush" | "pan";

export interface ToolDefinition {
  readonly id: ToolId;
  readonly label: string;
  /** Single-key shortcut, matched case-insensitively without modifiers. */
  readonly shortcut: string;
  /** Description used for accessible labels and tooltips. */
  readonly description: string;
}
