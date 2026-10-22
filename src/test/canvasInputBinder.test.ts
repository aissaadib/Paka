/**
 * The pointer lifecycle at the DOM boundary.
 *
 * The binder owns what the browser does to a gesture: the capture, the
 * cancel, the lost capture, and the window that stops delivering events
 * because it lost the focus. None of that was covered before, and every one of
 * those paths can leave a gesture in flight - a preview stuck on the canvas, a
 * stroke that keeps growing after the user came back, a history entry that
 * never arrives.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CanvasInputBinder,
  type CanvasInputHandlers,
} from "../core/input/canvasInputBinder";
import type { PointerSample } from "../types/pointer";
import {
  FakeDocument,
  FakeEventTarget,
  FakePointerTarget,
  createPointerEvent,
} from "./support/fakePointerTarget";

/**
 * A binder wired to a fake surface, a fake window and a fake document.
 *
 * The window and the document are installed as globals because that is where
 * the binder looks for them; a browser has exactly one of each.
 */
function createBinder() {
  const target = new FakePointerTarget();
  const fakeWindow = new FakeEventTarget();
  const fakeDocument = new FakeDocument();
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);

  const samples: PointerSample[] = [];
  const presence: boolean[] = [];
  const handlers: CanvasInputHandlers = {
    getViewport: () => ({ zoom: 2, offsetX: 0, offsetY: 0 }),
    onPointerSamples: (batch) => {
      samples.push(...batch);
    },
    onWheel: () => {},
    onPointerPresence: (inside) => {
      presence.push(inside);
    },
  };

  const binder = new CanvasInputBinder(target as unknown as HTMLElement, handlers);
  binder.attach();

  const phases = (): string[] => samples.map((sample) => sample.phase);

  return { target, fakeWindow, fakeDocument, binder, samples, presence, phases };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the pointer capture", () => {
  it("takes the capture on press and gives it back on release", () => {
    const { target, binder, phases } = createBinder();

    target.dispatch("pointerdown", createPointerEvent({ pointerId: 7 }));
    expect(target.hasPointerCapture(7)).toBe(true);

    target.dispatch("pointerup", createPointerEvent({ pointerId: 7 }));
    expect(target.hasPointerCapture(7)).toBe(false);
    expect(phases()).toEqual(["down", "up"]);
    binder.detach();
  });

  it("gives the capture back when the gesture is cancelled", () => {
    const { target, binder, phases } = createBinder();

    target.dispatch("pointerdown", createPointerEvent({ pointerId: 7 }));
    target.dispatch("pointercancel", createPointerEvent({ pointerId: 7 }));

    // A cancelled gesture must not leave the surface holding the pointer: the
    // next press would find a capture it does not own.
    expect(target.hasPointerCapture(7)).toBe(false);
    expect(phases()).toEqual(["down", "cancel"]);
    binder.detach();
  });

  it("ends the gesture when the capture is lost", () => {
    const { target, binder, phases } = createBinder();

    target.dispatch("pointerdown", createPointerEvent({ pointerId: 7 }));
    target.dispatch("lostpointercapture", createPointerEvent({ pointerId: 7 }));

    expect(phases()).toEqual(["down", "cancel"]);
    binder.detach();
  });
});

describe("a window that is not focused", () => {
  it("ends the gesture when the window loses the focus", () => {
    const { target, fakeWindow, binder, phases, samples } = createBinder();

    fakeWindow.dispatch("blur");
    // Nothing was in flight, so nothing is reported.
    expect(phases()).toEqual([]);

    target.dispatch(
      "pointerdown",
      createPointerEvent({ pointerId: 3, clientX: 40, clientY: 20 }),
    );
    fakeWindow.dispatch("blur");

    // The gesture ends as a cancel, at the position the pointer last had.
    expect(phases()).toEqual(["down", "cancel"]);
    expect(samples[1].pointerId).toBe(3);
    expect(samples[1].screenX).toBe(40);
    expect(samples[1].screenY).toBe(20);
    binder.detach();
  });

  it("ends the gesture when the tab is hidden", () => {
    const { target, fakeDocument, binder, phases } = createBinder();

    target.dispatch("pointerdown", createPointerEvent({ pointerId: 3 }));
    fakeDocument.visibilityState = "hidden";
    fakeDocument.dispatch("visibilitychange");

    expect(phases()).toEqual(["down", "cancel"]);
    binder.detach();
  });

  it("keeps the gesture when the tab is still visible", () => {
    const { target, fakeDocument, binder, phases } = createBinder();

    target.dispatch("pointerdown", createPointerEvent({ pointerId: 3 }));
    fakeDocument.dispatch("visibilitychange");

    expect(phases()).toEqual(["down"]);
    binder.detach();
  });

  it("does not end a gesture twice", () => {
    const { target, fakeWindow, binder, phases } = createBinder();

    target.dispatch("pointerdown", createPointerEvent({ pointerId: 3 }));
    fakeWindow.dispatch("blur");
    fakeWindow.dispatch("blur");
    // The pointer is no longer tracked, so the release that ends the window's
    // story cannot commit anything a second time.
    target.dispatch("pointerup", createPointerEvent({ pointerId: 3 }));

    expect(phases()).toEqual(["down", "cancel"]);
    binder.detach();
  });

  it("stops listening once the binder is detached", () => {
    const { target, fakeWindow, binder, phases } = createBinder();

    binder.detach();
    target.dispatch("pointerdown", createPointerEvent({ pointerId: 3 }));
    fakeWindow.dispatch("blur");

    expect(phases()).toEqual([]);
    expect(fakeWindow.count("blur")).toBe(0);
  });
});

describe("a pointer the binder does not own", () => {
  it("ignores a release for a pointer it never tracked", () => {
    const { target, binder, phases } = createBinder();

    // A release with no press behind it: another device, or a synthetic
    // event. It must not end a gesture the binder owns.
    target.dispatch("pointerup", createPointerEvent({ pointerId: 9 }));
    expect(phases()).toEqual([]);

    target.dispatch("pointerdown", createPointerEvent({ pointerId: 1 }));
    target.dispatch("pointerup", createPointerEvent({ pointerId: 9 }));
    expect(phases()).toEqual(["down"]);

    target.dispatch("pointerup", createPointerEvent({ pointerId: 1 }));
    expect(phases()).toEqual(["down", "up"]);
    binder.detach();
  });

  it("ignores a cancel for a pointer it never tracked", () => {
    const { target, binder, phases } = createBinder();

    target.dispatch("pointercancel", createPointerEvent({ pointerId: 9 }));
    expect(phases()).toEqual([]);
    binder.detach();
  });

  it("ignores a second pointer while one is tracked", () => {
    const { target, binder, phases } = createBinder();

    target.dispatch("pointerdown", createPointerEvent({ pointerId: 1 }));
    target.dispatch("pointerdown", createPointerEvent({ pointerId: 2 }));
    target.dispatch("pointermove", createPointerEvent({ pointerId: 2 }));

    expect(phases()).toEqual(["down"]);
    binder.detach();
  });
});

describe("a move event", () => {
  it("hands the whole coalesced batch over as one event", () => {
    const { target, binder, samples } = createBinder();

    target.dispatch(
      "pointermove",
      createPointerEvent({
        clientX: 13,
        clientY: 13,
        coalesced: [
          { clientX: 10, clientY: 10 },
          { clientX: 11, clientY: 11 },
          { clientX: 12, clientY: 12 },
        ],
      }),
    );

    // Every coalesced sample is a position the pointer really passed through,
    // so a stroke must not lose one of them.
    expect(samples).toHaveLength(4);
    expect(samples.map((sample) => sample.screenX)).toEqual([10, 11, 12, 13]);
    binder.detach();
  });

  it("maps the samples through the viewport", () => {
    const { target, binder, samples } = createBinder();

    // The surface starts at (0, 0) and the viewport is 2x with no offset, so
    // a client x of 40 is 20 document pixels.
    target.dispatch("pointermove", createPointerEvent({ clientX: 40, clientY: 60 }));
    expect(samples[0].docX).toBe(20);
    expect(samples[0].docY).toBe(30);
    binder.detach();
  });
});
