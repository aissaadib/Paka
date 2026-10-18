/**
 * Undo/redo command infrastructure.
 *
 * Commands are small objects with `apply`/`revert`, never document snapshots.
 * A stroke command, for example, stores the stroke data and re-rasterizes only
 * the affected layer. Applying and reverting is idempotent, which is what makes
 * redo safe.
 */

export interface Command {
  readonly id: string;
  readonly label: string;
  /**
   * Optional identity for history coalescing. Consecutive commands pushed with
   * the same key collapse into a single entry (via {@link Command.mergeWith})
   * instead of producing one step per drag tick.
   */
  readonly mergeKey?: string;
  /**
   * Combines this command with the next command that shares its `mergeKey`.
   * The result must span from this command's earliest revert point to the
   * other command's latest apply point. Only called when both key and presence
   * match, so implementations may assume a compatible command.
   */
  mergeWith?(next: Command): Command;
  apply(): void;
  revert(): void;
}

export interface CommandStackState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  /** Number of commands available for undo. */
  readonly depth: number;
}
