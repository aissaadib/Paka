/**
 * Command stack.
 *
 * `push` records a command whose effect is already visible (the common case
 * for painting: the stroke is rasterized as it is drawn), while `execute`
 * applies first. Undo/redo never re-enters the stack.
 */

import type { Command, CommandStackState } from "./types";
import type { Listener } from "../../utils/store";

export const DEFAULT_HISTORY_LIMIT = 200;

export interface CommandStackOptions {
  /** Maximum number of undoable commands; older entries are dropped. */
  readonly limit?: number;
}

const EMPTY_STATE: CommandStackState = {
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
  depth: 0,
};

export class CommandStack {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly limit: number;
  private busy = false;
  private state: CommandStackState = EMPTY_STATE;

  constructor(options: CommandStackOptions = {}) {
    this.limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_HISTORY_LIMIT));
  }

  getState(): CommandStackState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Records a command that has already been applied. */
  push(command: Command): void {
    if (this.busy) {
      return;
    }
    // Consecutive commands that declare the same merge key and know how to
    // combine collapse into the existing top entry. This is what keeps a
    // slider drag (many tiny changes) to a single undo step.
    if (this.mergeIntoTop(command)) {
      return;
    }
    this.undoStack.push(command);
    this.redoStack.length = 0;
    if (this.undoStack.length > this.limit) {
      this.undoStack.splice(0, this.undoStack.length - this.limit);
    }
    this.publish();
  }

  /** Applies a command and records it. */
  execute(command: Command): void {
    if (this.busy) {
      return;
    }
    // The apply itself runs under the re-entrancy guard: a command must not be
    // able to record further commands while it is being applied.
    this.run(command.apply);
    this.push(command);
  }

  undo(): boolean {
    if (this.busy) {
      return false;
    }
    const command = this.undoStack.pop();
    if (!command) {
      return false;
    }
    this.run(command.revert);
    this.redoStack.push(command);
    this.publish();
    return true;
  }

  redo(): boolean {
    if (this.busy) {
      return false;
    }
    const command = this.redoStack.pop();
    if (!command) {
      return false;
    }
    this.run(command.apply);
    this.undoStack.push(command);
    this.publish();
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.publish();
  }

  private run(mutate: () => void): void {
    this.busy = true;
    try {
      mutate();
    } finally {
      this.busy = false;
    }
  }

  /**
   * Merges `command` into the top of the undo stack when both opt in with the
   * same key. Records nothing new: the command's effect is already applied, so
   * replacing the top entry is enough - a later undo reverts the whole span.
   */
  private mergeIntoTop(command: Command): boolean {
    const top = this.undoStack[this.undoStack.length - 1];
    if (
      top === undefined ||
      command.mergeKey === undefined ||
      top.mergeKey !== command.mergeKey ||
      typeof top.mergeWith !== "function"
    ) {
      return false;
    }
    this.undoStack[this.undoStack.length - 1] = top.mergeWith(command);
    this.redoStack.length = 0;
    this.publish();
    return true;
  }

  private publish(): void {
    const undoTop = this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1] : undefined;
    const redoTop = this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1] : undefined;

    this.state = {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: undoTop ? undoTop.label : null,
      redoLabel: redoTop ? redoTop.label : null,
      depth: this.undoStack.length,
    };

    for (const listener of this.listeners) {
      listener();
    }
  }
}
