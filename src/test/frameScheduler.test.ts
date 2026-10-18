import { describe, expect, it, vi } from "vitest";
import { FrameScheduler } from "../core/rendering/frameScheduler";

interface FakeFrames {
  readonly options: {
    requestFrame: (callback: () => void) => number;
    cancelFrame: (handle: number) => void;
  };
  readonly pendingCount: number;
  flush(): void;
}

function createFakeFrames(): FakeFrames {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();

  return {
    options: {
      requestFrame: (callback) => {
        const handle = nextHandle;
        nextHandle += 1;
        pending.set(handle, callback);
        return handle;
      },
      cancelFrame: (handle) => {
        pending.delete(handle);
      },
    },
    get pendingCount() {
      return pending.size;
    },
    flush() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) {
        callback();
      }
    },
  };
}

describe("FrameScheduler", () => {
  it("coalesces multiple requests into a single frame", () => {
    const frames = createFakeFrames();
    const scheduler = new FrameScheduler(frames.options);
    const callback = vi.fn();

    scheduler.schedule(callback);
    scheduler.schedule(callback);
    scheduler.schedule(callback);

    expect(frames.pendingCount).toBe(1);
    expect(scheduler.pending).toBe(true);

    frames.flush();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(scheduler.pending).toBe(false);
  });

  it("schedules again after a frame has run", () => {
    const frames = createFakeFrames();
    const scheduler = new FrameScheduler(frames.options);
    const callback = vi.fn();

    scheduler.schedule(callback);
    frames.flush();
    scheduler.schedule(callback);
    frames.flush();

    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending frame", () => {
    const frames = createFakeFrames();
    const scheduler = new FrameScheduler(frames.options);
    const callback = vi.fn();

    scheduler.schedule(callback);
    scheduler.cancel();

    expect(scheduler.pending).toBe(false);
    expect(frames.pendingCount).toBe(0);
    frames.flush();
    expect(callback).not.toHaveBeenCalled();
  });

  it("ignores cancel when nothing is pending", () => {
    const frames = createFakeFrames();
    const scheduler = new FrameScheduler(frames.options);
    expect(() => scheduler.cancel()).not.toThrow();
    expect(scheduler.pending).toBe(false);
  });
});
