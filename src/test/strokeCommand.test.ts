import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import { createStrokeRecord } from "../core/brushes/strokeBuilder";
import { CommandStack } from "../core/commands/commandStack";
import {
  createStrokeCommand,
  createStrokeCommandHost,
} from "../core/commands/strokeCommand";
import { StrokeStore } from "../core/document/strokeStore";
import type { StrokeRecord } from "../core/document/types";

function createStroke(x: number): StrokeRecord {
  const record = createStrokeRecord("layer-1", DEFAULT_BRUSH);
  record.xs.push(x, x + 10);
  record.ys.push(0, 0);
  record.pressures.push(1, 1);
  record.times.push(0, 10);
  return record;
}

describe("stroke command", () => {
  it("removes the stroke on undo and restores it on redo", () => {
    const store = new StrokeStore();
    const refresh = vi.fn();
    const host = createStrokeCommandHost(store, refresh);
    const stack = new CommandStack();

    const stroke = createStroke(0);
    store.insert(stroke);
    stack.push(createStrokeCommand(stroke, 0, host));

    expect(store.count("layer-1")).toBe(1);

    expect(stack.undo()).toBe(true);
    expect(store.count("layer-1")).toBe(0);
    expect(refresh).toHaveBeenCalledWith("layer-1");

    expect(stack.redo()).toBe(true);
    expect(store.list("layer-1")).toEqual([stroke]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("restores the stroke at its original index", () => {
    const store = new StrokeStore();
    const host = createStrokeCommandHost(store, () => {});

    const first = createStroke(0);
    const middle = createStroke(100);
    const last = createStroke(200);
    store.insert(first);
    store.insert(middle);
    store.insert(last);

    const command = createStrokeCommand(middle, 1, host);
    command.revert();
    expect(store.list("layer-1").map((entry) => entry.xs[0])).toEqual([0, 200]);

    command.apply();
    expect(store.list("layer-1").map((entry) => entry.xs[0])).toEqual([0, 100, 200]);
  });

  it("is a no-op to remove a stroke that is not present", () => {
    const store = new StrokeStore();
    const refresh = vi.fn();
    const stroke = createStroke(0);
    const command = createStrokeCommand(stroke, 0, createStrokeCommandHost(store, refresh));

    command.revert();
    expect(store.count("layer-1")).toBe(0);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("labels itself for the history menu", () => {
    const store = new StrokeStore();
    const command = createStrokeCommand(createStroke(0), 0, createStrokeCommandHost(store, () => {}));
    expect(command.label).toBe("Stroke");
    expect(command.id).toMatch(/^cmd-/);
  });
});
