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
