import { describe, expect, it, vi } from "vitest";
import { CommandStack } from "../core/commands/commandStack";
import type { Command } from "../core/commands/types";

function createCommand(label: string, log: string[], id = label): Command {
  return {
    id,
    label,
    apply: () => log.push(`apply:${label}`),
    revert: () => log.push(`revert:${label}`),
  };
}

describe("CommandStack", () => {
  it("starts empty", () => {
    const stack = new CommandStack();
    expect(stack.getState()).toEqual({
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
      depth: 0,
    });
  });

  it("applies a command through execute and records it", () => {
    const log: string[] = [];
    const stack = new CommandStack();
    stack.execute(createCommand("stroke", log));

    expect(log).toEqual(["apply:stroke"]);
    expect(stack.getState().canUndo).toBe(true);
    expect(stack.getState().undoLabel).toBe("stroke");
    expect(stack.getState().depth).toBe(1);
  });

  it("records an already-applied command through push", () => {
    const log: string[] = [];
    const stack = new CommandStack();
    stack.push(createCommand("stroke", log));
    expect(log).toEqual([]);
  });

  it("undoes and redoes in order", () => {
    const log: string[] = [];
    const stack = new CommandStack();
    stack.push(createCommand("first", log));
    stack.push(createCommand("second", log));

    expect(stack.undo()).toBe(true);
    expect(stack.getState().undoLabel).toBe("first");
    expect(stack.getState().redoLabel).toBe("second");

    expect(stack.redo()).toBe(true);
    expect(log).toEqual(["revert:second", "apply:second"]);
    expect(stack.getState().canRedo).toBe(false);
  });

  it("returns false when there is nothing to undo or redo", () => {
    const stack = new CommandStack();
    expect(stack.undo()).toBe(false);
    expect(stack.redo()).toBe(false);
  });

  it("drops the redo stack when a new command is pushed", () => {
    const log: string[] = [];
    const stack = new CommandStack();
    stack.push(createCommand("first", log));
    stack.undo();
    expect(stack.getState().canRedo).toBe(true);

    stack.push(createCommand("second", log));
    expect(stack.getState().canRedo).toBe(false);
    expect(stack.getState().depth).toBe(1);
  });

  it("never re-enters itself while applying or reverting", () => {
    const stack: CommandStack = new CommandStack();
    const nested: Command = {
      id: "nested",
      label: "nested",
      apply: () => {
        stack.push(createCommand("inner", []));
      },
      revert: () => {
        stack.push(createCommand("inner-revert", []));
      },
    };

    stack.execute(nested);
    expect(stack.getState().depth).toBe(1);

    stack.undo();
    expect(stack.getState().depth).toBe(0);
    expect(stack.getState().canRedo).toBe(true);
  });

  it("trims the oldest commands beyond the limit", () => {
    const stack = new CommandStack({ limit: 2 });
    stack.push(createCommand("a", []));
    stack.push(createCommand("b", []));
    stack.push(createCommand("c", []));

    expect(stack.getState().depth).toBe(2);
    expect(stack.getState().undoLabel).toBe("c");
    stack.undo();
    stack.undo();
    expect(stack.undo()).toBe(false);
  });

  it("clears history and notifies listeners on change", () => {
    const stack = new CommandStack();
    const listener = vi.fn();
    const unsubscribe = stack.subscribe(listener);

    stack.push(createCommand("a", []));
    expect(listener).toHaveBeenCalledTimes(1);

    stack.clear();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(stack.getState().depth).toBe(0);

    unsubscribe();
    stack.push(createCommand("b", []));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps a stable state object between changes", () => {
    const stack = new CommandStack();
    const before = stack.getState();
    expect(stack.getState()).toBe(before);
    stack.push(createCommand("a", []));
    expect(stack.getState()).not.toBe(before);
  });
});
