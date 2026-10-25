/**
 * Pointer ownership.
 *
 * The rule under test: **exactly one gesture may own the pointer at a time**.
 * A gesture takes the pointer at its press and gives it up when it finishes,
 * when the platform cancels it or when the capture is lost; meanwhile no
 * other gesture reads the pointer.
 *
 * The model is pure, so it is tested directly. The binder is tested through a
 * fake drawing surface, because the DOM is the only thing the binder adds on
 * top of the model.
 */

import { describe, expect, it } from "vitest";
import {
  PAINT_GESTURE,
  PAN_GESTURE,
  SECONDARY_GESTURE,
  canTakeOwnership,
  emptyOwnership,
  gestureForButton,
  isDragInFlight,
  ownerGesture,
  ownershipHeldBy,
  ownershipOwner,
  reduceOwnership,
  routePointerEvent,
  transitionOwnership,
  type PointerOwnership,
} from "../core/input/ownership";
import { CanvasInputBinder } from "../core/input/canvasInputBinder";
import { GuidesTool } from "../core/tools/guidesTool";
import { GUIDES_TOOL } from "../core/tools/toolDefinitions";
import type { ToolContext } from "../core/tools/types";
import type { PointerSample } from "../types/pointer";

function owned(
  pointerId = 1,
  gesture: string = PAINT_GESTURE,
): PointerOwnership {
  return reduceOwnership(emptyOwnership(), { type: "take", pointerId, gesture });
}

describe("the ownership model", () => {
  it("starts with a free pointer", () => {
    const ownership = emptyOwnership();
    expect(ownershipOwner(ownership)).toBeNull();
    expect(ownerGesture(ownership)).toBeNull();
    expect(isDragInFlight(ownership)).toBe(false);
  });

  it("a press takes the pointer", () => {
    const transition = transitionOwnership(emptyOwnership(), {
      type: "take",
      pointerId: 7,
      gesture: PAINT_GESTURE,
    });
    expect(transition.outcome).toBe("taken");
    expect(transition.ownership.owner).toEqual({ pointerId: 7, gesture: PAINT_GESTURE });
    expect(transition.ended).toBeNull();
    expect(isDragInFlight(transition.ownership)).toBe(true);
    expect(ownershipHeldBy(transition.ownership, 7)).toBe(true);
    expect(ownershipHeldBy(transition.ownership, 8)).toBe(false);
  });

  it("an owned pointer cannot be taken by a second gesture", () => {
    const painting = owned();
    const transition = transitionOwnership(painting, {
      type: "take",
      pointerId: 1,
      gesture: PAN_GESTURE,
    });
    expect(transition.outcome).toBe("refused");
    expect(transition.ownership).toBe(painting);
    expect(ownerGesture(transition.ownership)).toBe(PAINT_GESTURE);
  });

  it("a second pointer cannot take a pointer that is already owned", () => {
    const painting = owned(1);
    const transition = transitionOwnership(painting, {
      type: "take",
      pointerId: 2,
      gesture: PAINT_GESTURE,
    });
    expect(transition.outcome).toBe("refused");
    expect(transition.ownership).toBe(painting);
  });

  it("the owning gesture may take the pointer again without changing it", () => {
    const painting = owned();
    const transition = transitionOwnership(painting, {
      type: "take",
      pointerId: 1,
      gesture: PAINT_GESTURE,
    });
    expect(transition.outcome).toBe("held");
    expect(transition.ownership).toBe(painting);
  });

  it("a gesture without a name cannot take the pointer", () => {
    const transition = transitionOwnership(emptyOwnership(), {
      type: "take",
      pointerId: 1,
      gesture: "",
    });
    expect(transition.outcome).toBe("refused");
    expect(isDragInFlight(transition.ownership)).toBe(false);
    expect(canTakeOwnership(emptyOwnership(), 1, "")).toBe(false);
  });

  it("only the owner may give the pointer up", () => {
    const painting = owned();
    const refused = transitionOwnership(painting, {
      type: "release",
      pointerId: 2,
      gesture: PAINT_GESTURE,
    });
    expect(refused.outcome).toBe("refused");
    expect(refused.ownership).toBe(painting);

    const wrongGesture = transitionOwnership(painting, {
      type: "release",
      pointerId: 1,
      gesture: PAN_GESTURE,
    });
    expect(wrongGesture.outcome).toBe("refused");
    expect(wrongGesture.ownership).toBe(painting);
  });

  it("the owner releases the pointer and the gesture ends", () => {
    const painting = owned();
    const transition = transitionOwnership(painting, {
      type: "release",
      pointerId: 1,
      gesture: PAINT_GESTURE,
    });
    expect(transition.outcome).toBe("released");
    expect(transition.ended).toBe(PAINT_GESTURE);
    expect(isDragInFlight(transition.ownership)).toBe(false);
  });

  it("a release with nothing to release is ignored", () => {
    const transition = transitionOwnership(emptyOwnership(), {
      type: "release",
      pointerId: 1,
      gesture: PAINT_GESTURE,
    });
    expect(transition.outcome).toBe("ignored");
    expect(isDragInFlight(transition.ownership)).toBe(false);
  });

  it("a cancellation ends the owner and frees the pointer", () => {
    const painting = owned();
    const transition = transitionOwnership(painting, { type: "cancel", pointerId: 1 });
    expect(transition.outcome).toBe("ended");
    expect(transition.ended).toBe(PAINT_GESTURE);
    expect(isDragInFlight(transition.ownership)).toBe(false);
    expect(ownershipOwner(transition.ownership)).toBeNull();
  });

  it("a cancellation about another pointer leaves the owner alone", () => {
    const painting = owned(1);
    const transition = transitionOwnership(painting, { type: "cancel", pointerId: 2 });
    expect(transition.outcome).toBe("ignored");
    expect(transition.ownership).toBe(painting);
    expect(isDragInFlight(transition.ownership)).toBe(true);
  });

  it("a lost capture ends the owner cleanly", () => {
    const painting = owned();
    const transition = transitionOwnership(painting, { type: "capture-lost", pointerId: 1 });
    expect(transition.outcome).toBe("ended");
    expect(transition.ended).toBe(PAINT_GESTURE);
    expect(isDragInFlight(transition.ownership)).toBe(false);
  });

  it("a lost capture after the gesture finished does nothing", () => {
    const painting = owned();
    const released = reduceOwnership(painting, {
      type: "release",
      pointerId: 1,
      gesture: PAINT_GESTURE,
    });
    const transition = transitionOwnership(released, { type: "capture-lost", pointerId: 1 });
    expect(transition.outcome).toBe("ignored");
    expect(isDragInFlight(transition.ownership)).toBe(false);
  });

  it("never mutates the state it is given", () => {
    const painting = owned();
    const frozen = Object.freeze({
      owner: Object.freeze({ pointerId: 1, gesture: PAINT_GESTURE }),
    });
    const transition = transitionOwnership(frozen, { type: "cancel", pointerId: 1 });
    expect(frozen.owner).not.toBeNull();
    expect(transition.ownership.owner).toBeNull();
    expect(painting.owner).not.toBeNull();
  });

  it("names the gesture a button starts", () => {
    expect(gestureForButton(0)).toBe(PAINT_GESTURE);
    expect(gestureForButton(1)).toBe(PAN_GESTURE);
    expect(gestureForButton(2)).toBe(SECONDARY_GESTURE);
  });
});

describe("pointer routing", () => {
  it("a press with no owner starts a gesture", () => {
    const route = routePointerEvent(emptyOwnership(), {
      phase: "down",
      pointerId: 1,
      isPrimary: true,
      button: 0,
    });
    expect(route).toEqual({ kind: "start", gesture: PAINT_GESTURE });
  });

  it("the middle button starts a pan of its own", () => {
    const route = routePointerEvent(emptyOwnership(), {
      phase: "down",
      pointerId: 1,
      isPrimary: true,
      button: 1,
    });
    expect(route).toEqual({ kind: "start", gesture: PAN_GESTURE });
  });

  it("a press while a gesture owns the pointer is blocked", () => {
    const route = routePointerEvent(owned(), {
      phase: "down",
      pointerId: 2,
      isPrimary: false,
      button: 0,
    });
    expect(route).toEqual({ kind: "blocked" });
  });

  it("a move of the owning pointer belongs to the gesture", () => {
    const route = routePointerEvent(owned(4), {
      phase: "move",
      pointerId: 4,
      isPrimary: true,
      button: -1,
    });
    expect(route).toEqual({ kind: "owned" });
  });

  it("a move of another pointer is blocked while a gesture owns the pointer", () => {
    const route = routePointerEvent(owned(4), {
      phase: "move",
      pointerId: 5,
      isPrimary: false,
      button: -1,
    });
    expect(route).toEqual({ kind: "blocked" });
  });

  it("a move with no owner is a hover", () => {
    const route = routePointerEvent(emptyOwnership(), {
      phase: "move",
      pointerId: 1,
      isPrimary: true,
      button: -1,
    });
    expect(route).toEqual({ kind: "hover" });
  });

  it("a secondary pointer hovering is blocked", () => {
    const route = routePointerEvent(emptyOwnership(), {
      phase: "move",
      pointerId: 2,
      isPrimary: false,
      button: -1,
    });
    expect(route).toEqual({ kind: "blocked" });
  });

  it("a release with no owner belongs to no gesture", () => {
    const route = routePointerEvent(emptyOwnership(), {
      phase: "up",
      pointerId: 1,
      isPrimary: true,
      button: 0,
    });
    expect(route).toEqual({ kind: "blocked" });
  });
});

/** A pointer event with the fields the binder reads. */
function pointerEvent(overrides: Record<string, unknown> = {}): PointerEvent {
  return {
    pointerId: 1,
    pointerType: "pen",
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: 40,
    clientY: 30,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    timeStamp: 1000,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  } as unknown as PointerEvent;
}

/**
 * A drawing surface without a DOM.
 *
 * It implements only what the binder touches, and it releases the capture the
 * way a browser does: `releasePointerCapture` fires `lostpointercapture`.
 */
class FakeCanvas {
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  readonly captured = new Set<number>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  getBoundingClientRect(): { left: number; top: number } {
    return { left: 0, top: 0 };
  }

  setPointerCapture(pointerId: number): void {
    this.captured.add(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.captured.has(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    if (!this.captured.delete(pointerId)) {
      return;
    }
    this.fire("lostpointercapture", pointerEvent({ pointerId }));
  }

  fire(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function createBinder(): {
  element: FakeCanvas;
  binder: CanvasInputBinder;
  samples: PointerSample[];
  presence: boolean[];
} {
  const element = new FakeCanvas();
  const samples: PointerSample[] = [];
  const presence: boolean[] = [];
  const binder = new CanvasInputBinder(element as unknown as HTMLElement, {
    getViewport: () => ({ zoom: 1, offsetX: 0, offsetY: 0 }),
    onPointerSample: (sample) => samples.push(sample),
    onWheel: () => {},
    onPointerPresence: (inside) => presence.push(inside),
  });
  binder.attach();
  return { element, binder, samples, presence };
}

describe("the canvas binder", () => {
  it("forwards the press, the moves and the release", () => {
    const { element, samples } = createBinder();
    element.fire("pointerdown", pointerEvent());
    element.fire("pointermove", pointerEvent({ clientX: 60 }));
    element.fire("pointerup", pointerEvent({ clientX: 60 }));
    expect(samples.map((sample) => sample.phase)).toEqual(["down", "move", "up"]);
    expect(samples[0].docX).toBe(40);
    expect(samples[1].docX).toBe(60);
  });

  it("takes the capture for the press and releases it on the release", () => {
    const { element } = createBinder();
    element.fire("pointerdown", pointerEvent());
    expect(element.hasPointerCapture(1)).toBe(true);
    element.fire("pointerup", pointerEvent());
    expect(element.hasPointerCapture(1)).toBe(false);
  });

  it("does not cancel a gesture whose capture was released on purpose", () => {
    const { element, samples } = createBinder();
    element.fire("pointerdown", pointerEvent());
    element.fire("pointerup", pointerEvent());
    // Releasing the capture fires `lostpointercapture`; the gesture is already
    // over, so it must not be cancelled a second time.
    expect(samples.map((sample) => sample.phase)).toEqual(["down", "up"]);
  });

  it("ignores a second pointer's press while a gesture owns the pointer", () => {
    const { element, samples } = createBinder();
    element.fire("pointerdown", pointerEvent({ pointerId: 1 }));
    element.fire("pointerdown", pointerEvent({ pointerId: 2, isPrimary: false }));
    expect(samples.map((sample) => sample.phase)).toEqual(["down"]);
    expect(element.hasPointerCapture(2)).toBe(false);
  });

  it("does not forward a second pointer's moves while a gesture owns the pointer", () => {
    const { element, samples } = createBinder();
    element.fire("pointerdown", pointerEvent({ pointerId: 1 }));
    element.fire("pointermove", pointerEvent({ pointerId: 2, isPrimary: false }));
    expect(samples.map((sample) => sample.phase)).toEqual(["down"]);
  });

  it("still forwards a hover move, so the cursor follows the pointer", () => {
    const { element, samples, presence } = createBinder();
    element.fire("pointermove", pointerEvent());
    expect(samples.map((sample) => sample.phase)).toEqual(["move"]);
    expect(presence).toEqual([true]);
  });

  it("ends the gesture cleanly when the platform cancels the pointer", () => {
    const { element, samples } = createBinder();
    element.fire("pointerdown", pointerEvent());
    element.fire("pointercancel", pointerEvent());
    expect(samples.map((sample) => sample.phase)).toEqual(["down", "cancel"]);
  });

  it("ends the gesture cleanly when the capture is lost", () => {
    const { element, samples } = createBinder();
    element.fire("pointerdown", pointerEvent());
    element.fire("lostpointercapture", pointerEvent());
    expect(samples.map((sample) => sample.phase)).toEqual(["down", "cancel"]);
  });

  it("lets the next press start a gesture after the previous one was cancelled", () => {
    const { element, samples } = createBinder();
    element.fire("pointerdown", pointerEvent({ pointerId: 1 }));
    element.fire("pointercancel", pointerEvent({ pointerId: 1 }));
    element.fire("pointerdown", pointerEvent({ pointerId: 2, isPrimary: false }));
    element.fire("pointerup", pointerEvent({ pointerId: 2, isPrimary: false }));
    expect(samples.map((sample) => sample.phase)).toEqual(["down", "cancel", "down", "up"]);
  });

  it("lets the next press start a gesture after the capture was lost", () => {
    const { element, samples } = createBinder();
    element.fire("pointerdown", pointerEvent({ pointerId: 1 }));
    element.fire("lostpointercapture", pointerEvent({ pointerId: 1 }));
    element.fire("pointerdown", pointerEvent({ pointerId: 2, isPrimary: false }));
    expect(samples.map((sample) => sample.phase)).toEqual(["down", "cancel", "down"]);
  });

  it("does not report the pointer as gone while a gesture owns it", () => {
    const { element, presence } = createBinder();
    element.fire("pointerdown", pointerEvent());
    element.fire("pointerleave", pointerEvent());
    expect(presence).toEqual([]);
    element.fire("pointerup", pointerEvent());
    element.fire("pointerleave", pointerEvent());
    expect(presence).toEqual([false]);
  });
});

describe("a cancelled gesture leaves no drag in flight", () => {
  it("tells the tool that its gesture is over, exactly once", () => {
    const axes: string[] = [];
    const context = {
      viewport: { zoom: 1, offsetX: 0, offsetY: 0 },
      findGuideAt: () => null,
      selectGuide: () => {},
      beginGuideCreate: () => {},
      beginGuideMove: () => {},
      moveGuideTo: () => {},
      setGuideAxis: (axis: string) => axes.push(axis),
      finishGuideGesture: () => {},
      cancelGuideGesture: () => {},
    } as unknown as ToolContext;

    const tool = new GuidesTool(GUIDES_TOOL);
    const element = new FakeCanvas();
    const binder = new CanvasInputBinder(element as unknown as HTMLElement, {
      getViewport: () => ({ zoom: 1, offsetX: 0, offsetY: 0 }),
      // The engine's router: the only place a sample reaches the tool.
      onPointerSample: (sample) => {
        if (sample.phase === "down") {
          tool.onPointerDown(context, sample);
        } else if (sample.phase === "move") {
          tool.onPointerMove(context, sample);
        } else if (sample.phase === "up") {
          tool.onPointerUp(context, sample);
        } else {
          tool.onPointerCancel(context);
        }
      },
      onWheel: () => {},
      onPointerPresence: () => {},
    });
    binder.attach();

    element.fire("pointerdown", pointerEvent({ clientX: 10, clientY: 10 }));
    element.fire("pointermove", pointerEvent({ clientX: 60, clientY: 10 }));
    expect(axes).toHaveLength(1);

    // The capture is lost: the gesture is cancelled.
    element.fire("lostpointercapture", pointerEvent({ clientX: 60, clientY: 10 }));

    // A move after the cancellation must not reach the tool's gesture: the
    // tool has to believe that no drag is running.
    element.fire("pointermove", pointerEvent({ clientX: 120, clientY: 10 }));
    expect(axes).toHaveLength(1);
  });
});
