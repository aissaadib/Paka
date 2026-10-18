import { describe, expect, it } from "vitest";
import {
  FALLBACK_PRESSURE_DEFAULT,
  FALLBACK_PRESSURE_PEN,
  createPointerSample,
  resolvePressure,
  toPointerKind,
  toStrokeSample,
  type PointerEventLike,
} from "../core/input/pointer";

const viewport = { zoom: 2, offsetX: 100, offsetY: 50 };
const origin = { left: 20, top: 10 };

function createEvent(overrides: Partial<PointerEventLike> = {}): PointerEventLike {
  return {
    pointerId: 1,
    pointerType: "pen",
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: 200,
    clientY: 150,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    timeStamp: 1000,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  };
}

describe("pointer kinds", () => {
  it("maps device types", () => {
    expect(toPointerKind("mouse")).toBe("mouse");
    expect(toPointerKind("pen")).toBe("pen");
    expect(toPointerKind("touch")).toBe("touch");
    expect(toPointerKind("gamepad")).toBe("unknown");
  });
});

describe("pressure policy", () => {
  it("uses real pen pressure", () => {
    expect(resolvePressure(0.35, "pen")).toEqual({ pressure: 0.35, hasPressure: true });
  });

  it("clamps reported pen pressure", () => {
    expect(resolvePressure(1.7, "pen")).toEqual({ pressure: 1, hasPressure: true });
  });

  it("falls back for a pen that reports no pressure", () => {
    expect(resolvePressure(0, "pen")).toEqual({
      pressure: FALLBACK_PRESSURE_PEN,
      hasPressure: false,
    });
  });

  it("uses full pressure for devices without pressure support", () => {
    // A mouse reports 0.5 while pressed; honoring that would silently halve
    // every stroke, so the fallback is a constant full-pressure value.
    expect(resolvePressure(0.5, "mouse")).toEqual({
      pressure: FALLBACK_PRESSURE_DEFAULT,
      hasPressure: false,
    });
    expect(resolvePressure(0, "touch")).toEqual({
      pressure: FALLBACK_PRESSURE_DEFAULT,
      hasPressure: false,
    });
  });
});

describe("createPointerSample", () => {
  it("converts client coordinates to canvas-local and document coordinates", () => {
    const sample = createPointerSample({ event: createEvent(), origin, viewport, phase: "down" });
    expect(sample.screenX).toBe(180);
    expect(sample.screenY).toBe(140);
    expect(sample.docX).toBeCloseTo((180 - 100) / 2, 9);
    expect(sample.docY).toBeCloseTo((140 - 50) / 2, 9);
  });

  it("maps the same event differently at another zoom", () => {
    const zoomedOut = createPointerSample({
      event: createEvent(),
      origin,
      viewport: { zoom: 0.5, offsetX: 0, offsetY: 0 },
      phase: "move",
    });
    expect(zoomedOut.docX).toBe(360);
    expect(zoomedOut.docY).toBe(280);
  });

  it("carries device metadata, modifiers and phase", () => {
    const sample = createPointerSample({
      event: createEvent({ shiftKey: true, tiltX: 12, tiltY: -8, pointerId: 7 }),
      origin,
      viewport,
      phase: "move",
    });
    expect(sample.phase).toBe("move");
    expect(sample.pointerId).toBe(7);
    expect(sample.kind).toBe("pen");
    expect(sample.tiltX).toBe(12);
    expect(sample.tiltY).toBe(-8);
    expect(sample.modifiers.shift).toBe(true);
    expect(sample.timeStamp).toBe(1000);
  });

  it("produces a stroke sample in document space", () => {
    const sample = createPointerSample({ event: createEvent(), origin, viewport, phase: "move" });
    const strokeSample = toStrokeSample(sample);
    expect(strokeSample.x).toBe(sample.docX);
    expect(strokeSample.y).toBe(sample.docY);
    expect(strokeSample.pressure).toBe(sample.pressure);
    expect(strokeSample.time).toBe(sample.timeStamp);
  });
});
