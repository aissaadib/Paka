/**
 * The quick brush-size gesture.
 *
 * The gesture is a view gesture: it changes the size of the *next* stroke
 * and never a stroke that has already been made. It is also not an edit -
 * there is no history step behind it and nothing to undo - so the whole of
 * its contract is "a size to write to the brush", and that is what these
 * tests pin down.
 */

import { describe, expect, it } from "vitest";
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from "../core/brushes/defaults";
import {
  BRUSH_SIZE_GESTURE_DEADZONE,
  BRUSH_SIZE_GESTURE_SCALE,
  brushSizeFromDrag,
  createBrushSizeGestureState,
  isBrushSizeGestureActive,
  isBrushSizeGestureModifier,
  reduceBrushSizeGesture,
  shouldStartBrushSizeGesture,
  toolUsesBrushSize,
  type BrushSizeGestureContext,
  type BrushSizeGestureEvent,
  type BrushSizeGestureState,
} from "../core/brushes/brushSizeGesture";
import type { PointerModifiers, PointerSample } from "../types/pointer";

function modifiers(overrides: Partial<PointerModifiers> = {}): PointerModifiers {
  return { shift: false, alt: false, ctrl: false, meta: false, ...overrides };
}

function sample(overrides: Partial<PointerSample> = {}): PointerSample {
  return {
    phase: "down",
    pointerId: 1,
    kind: "mouse",
    isPrimary: true,
    button: 0,
    buttons: 1,
    docX: 100,
    docY: 100,
    screenX: 100,
    screenY: 200,
    pressure: 0.5,
    hasPressure: false,
    tiltX: 0,
    tiltY: 0,
    timeStamp: 0,
    modifiers: modifiers({ ctrl: true, alt: true }),
    ...overrides,
  };
}

const context: BrushSizeGestureContext = { toolId: "brush", blocked: false };

function press(size = 6, overrides: Partial<PointerSample> = {}): BrushSizeGestureEvent {
  return { kind: "press", sample: sample(overrides), size, context };
}

function move(screenY: number): BrushSizeGestureEvent {
  return { kind: "move", sample: sample({ phase: "move", button: -1, screenY }) };
}

/** Plays a list of events and returns the state after each of them. */
function play(
  events: readonly BrushSizeGestureEvent[],
  start: BrushSizeGestureState = createBrushSizeGestureState(6),
): { states: BrushSizeGestureState[]; sizes: (number | null)[] } {
  const states: BrushSizeGestureState[] = [];
  const sizes: (number | null)[] = [];
  let state = start;
  for (const event of events) {
    const outcome = reduceBrushSizeGesture(state, event);
    state = outcome.state;
    states.push(state);
    sizes.push(outcome.size);
  }
  return { states, sizes };
}

describe("the modifier that asks for the quick resize", () => {
  it("is Ctrl and Alt together", () => {
    expect(isBrushSizeGestureModifier(modifiers({ ctrl: true, alt: true }))).toBe(true);
  });

  it("is not a single modifier on its own", () => {
    expect(isBrushSizeGestureModifier(modifiers({ ctrl: true }))).toBe(false);
    expect(isBrushSizeGestureModifier(modifiers({ alt: true }))).toBe(false);
    expect(isBrushSizeGestureModifier(modifiers({ meta: true, alt: true }))).toBe(false);
    expect(isBrushSizeGestureModifier(modifiers())).toBe(false);
  });
});

describe("when a press starts the quick resize", () => {
  it("takes a paint button with the modifier held on the brush", () => {
    expect(shouldStartBrushSizeGesture(sample(), context)).toBe(true);
  });

  it("takes the eraser too, because it paints with the same brush", () => {
    expect(toolUsesBrushSize("eraser")).toBe(true);
    expect(shouldStartBrushSizeGesture(sample(), { toolId: "eraser", blocked: false })).toBe(true);
  });

  it("leaves the tools that do not paint with a brush alone", () => {
    expect(toolUsesBrushSize("rectangle")).toBe(false);
    expect(shouldStartBrushSizeGesture(sample(), { toolId: "rectangle", blocked: false })).toBe(false);
    expect(shouldStartBrushSizeGesture(sample(), { toolId: "select", blocked: false })).toBe(false);
  });

  it("ignores a press that is not a press", () => {
    expect(shouldStartBrushSizeGesture(sample({ phase: "move" }), context)).toBe(false);
  });

  it("ignores a button that does not paint", () => {
    expect(shouldStartBrushSizeGesture(sample({ button: 1, buttons: 4 }), context)).toBe(false);
  });

  it("gives way to a surface that owns the interaction", () => {
    expect(shouldStartBrushSizeGesture(sample(), { toolId: "brush", blocked: true })).toBe(false);
  });

  it("ignores a press without the modifier", () => {
    const withoutModifier = sample({ modifiers: modifiers() });
    expect(shouldStartBrushSizeGesture(withoutModifier, context)).toBe(false);
  });
});

describe("the size a drag proposes", () => {
  it("leaves the size alone inside the deadzone", () => {
    expect(brushSizeFromDrag(6, 0)).toBe(6);
    expect(brushSizeFromDrag(6, BRUSH_SIZE_GESTURE_DEADZONE)).toBe(6);
    expect(brushSizeFromDrag(6, -BRUSH_SIZE_GESTURE_DEADZONE)).toBe(6);
  });

  it("grows when the pointer travels up and shrinks when it travels down", () => {
    expect(brushSizeFromDrag(6, -BRUSH_SIZE_GESTURE_SCALE)).toBe(16);
    expect(brushSizeFromDrag(6, BRUSH_SIZE_GESTURE_SCALE)).toBe(2);
  });

  it("is proportional, so the same travel is the same factor at any size", () => {
    // One e-fold of travel doubles the size: ln(2) * 100 px.
    const doubling = -BRUSH_SIZE_GESTURE_SCALE * Math.log(2);
    expect(brushSizeFromDrag(6, doubling)).toBe(12);
    expect(brushSizeFromDrag(60, doubling)).toBe(120);
  });

  it("clamps to the brush's range", () => {
    expect(brushSizeFromDrag(MAX_BRUSH_SIZE, -BRUSH_SIZE_GESTURE_SCALE)).toBe(MAX_BRUSH_SIZE);
    expect(brushSizeFromDrag(MIN_BRUSH_SIZE, BRUSH_SIZE_GESTURE_SCALE)).toBe(MIN_BRUSH_SIZE);
  });

  it("falls back to the clamped start size when the travel cannot be trusted", () => {
    expect(brushSizeFromDrag(6, Number.NaN)).toBe(6);
    expect(brushSizeFromDrag(6, Number.POSITIVE_INFINITY)).toBe(6);
    expect(brushSizeFromDrag(Number.NaN, -100)).toBe(MIN_BRUSH_SIZE);
  });
});

describe("the gesture's life", () => {
  it("starts idle, carrying the size the brush holds", () => {
    const state = createBrushSizeGestureState(6);
    expect(state.phase).toBe("idle");
    expect(state.size).toBe(6);
    expect(isBrushSizeGestureActive(state)).toBe(false);
  });

  it("arms on a qualifying press without changing the size", () => {
    const { states, sizes } = play([press(6)]);
    expect(states[0].phase).toBe("armed");
    expect(states[0].size).toBe(6);
    expect(states[0].startSize).toBe(6);
    expect(sizes[0]).toBeNull();
    expect(isBrushSizeGestureActive(states[0])).toBe(true);
  });

  it("stays idle when the press does not qualify", () => {
    const { states } = play([
      { kind: "press", sample: sample({ modifiers: modifiers() }), size: 6, context },
    ]);
    expect(states[0].phase).toBe("idle");
    expect(states[0].size).toBe(6);
  });

  it("keeps a hand that trembles inside the deadzone from resizing anything", () => {
    const { states, sizes } = play([press(6), move(200 + BRUSH_SIZE_GESTURE_DEADZONE)]);
    expect(states[1].phase).toBe("armed");
    expect(states[1].size).toBe(6);
    expect(sizes[1]).toBeNull();
  });

  it("starts the drag once the travel passes the deadzone", () => {
    const { states, sizes } = play([press(6), move(200 - BRUSH_SIZE_GESTURE_SCALE)]);
    expect(states[1].phase).toBe("dragging");
    expect(states[1].size).toBe(16);
    expect(sizes[1]).toBe(16);
  });

  it("measures the drag from the press, so the size cannot drift", () => {
    // Two moves of half the travel reach the same size as one move of the
    // whole travel: the drag is anchored to where the gesture started.
    const oneMove = play([press(6), move(200 - BRUSH_SIZE_GESTURE_SCALE)]);
    const twoMoves = play([press(6), move(200 - BRUSH_SIZE_GESTURE_SCALE / 2), move(200 - BRUSH_SIZE_GESTURE_SCALE)]);
    expect(twoMoves.states[2].size).toBe(oneMove.states[1].size);
  });

  it("ignores a press that arrives while a gesture is live", () => {
    const { states } = play([press(6), press(64)]);
    expect(states[1].phase).toBe("armed");
    expect(states[1].size).toBe(6);
  });

  it("ignores a move that arrives while no gesture is live", () => {
    const { states, sizes } = play([move(100)]);
    expect(states[0].phase).toBe("idle");
    expect(sizes[0]).toBeNull();
  });

  it("keeps the size the drag reached when the pointer is released", () => {
    const { states, sizes } = play([
      press(6),
      move(200 - BRUSH_SIZE_GESTURE_SCALE),
      { kind: "release" },
    ]);
    expect(states[1].size).toBe(16);
    expect(states[2].phase).toBe("idle");
    expect(states[2].size).toBe(16);
    expect(sizes[2]).toBeNull();
  });

  it("puts the size back where the gesture found it when Escape calls it off", () => {
    const { states, sizes } = play([
      press(6),
      move(200 - BRUSH_SIZE_GESTURE_SCALE),
      { kind: "cancel" },
    ]);
    expect(states[1].size).toBe(16);
    expect(states[2].phase).toBe("idle");
    expect(states[2].size).toBe(6);
    expect(sizes[2]).toBe(6);
  });

  it("puts the size back when the pointer capture is lost", () => {
    const { states, sizes } = play([
      press(6),
      move(200 - BRUSH_SIZE_GESTURE_SCALE),
      { kind: "capture-lost" },
    ]);
    expect(states[2].phase).toBe("idle");
    expect(states[2].size).toBe(6);
    expect(sizes[2]).toBe(6);
  });

  it("has nothing to restore when the gesture never moved", () => {
    const { sizes } = play([press(6), { kind: "cancel" }]);
    expect(sizes[1]).toBeNull();
  });

  it("keeps the size inside the brush's range", () => {
    const { states } = play([
      press(6),
      move(200 - 4000),
    ]);
    expect(states[1].size).toBe(MAX_BRUSH_SIZE);
  });

  it("produces a size and nothing else, because a setting is not an edit", () => {
    const outcome = reduceBrushSizeGesture(createBrushSizeGestureState(6), press(6));
    expect(Object.keys(outcome).sort()).toEqual(["size", "state"]);
    expect(Object.keys(outcome.state).sort()).toEqual([
      "originScreenX",
      "originScreenY",
      "phase",
      "size",
      "startSize",
    ]);
  });
});
