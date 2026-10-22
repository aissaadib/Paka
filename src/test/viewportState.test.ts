/**
 * Viewport state tests.
 *
 * The remembered viewport is the document point at the centre of the canvas,
 * not a pair of screen offsets, so it means the same thing after a resize.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEWPORT_STATE,
  normalizeViewportState,
  viewportFromState,
  viewportStateEqual,
  viewportStateFrom,
} from "../core/shell/viewportState";
import { docToScreen } from "../core/rendering/viewport";

const canvas = { width: 800, height: 600 };
const documentSize = { width: 400, height: 300 };

describe("viewport state", () => {
  it("remembers the document point at the centre of the canvas", () => {
    const viewport = { zoom: 2, offsetX: 40, offsetY: -20 };
    const state = viewportStateFrom(viewport, canvas);
    const centre = docToScreen(viewport, state.centerX, state.centerY);
    expect(centre.x).toBeCloseTo(canvas.width / 2, 10);
    expect(centre.y).toBeCloseTo(canvas.height / 2, 10);
  });

  it("puts the remembered centre back at the middle of the canvas", () => {
    const state = { zoom: 2, centerX: 100, centerY: 50, mode: "free" as const };
    const viewport = viewportFromState(state, canvas, documentSize);
    const centre = docToScreen(viewport, state.centerX, state.centerY);
    expect(centre.x).toBeCloseTo(canvas.width / 2, 10);
    expect(centre.y).toBeCloseTo(canvas.height / 2, 10);
    expect(viewport.zoom).toBe(2);
  });

  it("keeps the whole document visible in fit mode", () => {
    const viewport = viewportFromState(
      { zoom: 1, centerX: 0, centerY: 0, mode: "fit" },
      canvas,
      documentSize,
    );
    const topLeft = docToScreen(viewport, 0, 0);
    const bottomRight = docToScreen(viewport, documentSize.width, documentSize.height);
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(canvas.width);
    expect(bottomRight.y).toBeLessThanOrEqual(canvas.height);
  });

  it("defaults to fit mode", () => {
    expect(DEFAULT_VIEWPORT_STATE.mode).toBe("fit");
  });
});

describe("reading an untrusted viewport state", () => {
  it("falls back to the defaults for anything that is not a state", () => {
    for (const value of [null, undefined, 3, "state", []]) {
      expect(normalizeViewportState(value)).toEqual(DEFAULT_VIEWPORT_STATE);
    }
  });

  it("keeps the fields it can read and defaults the rest", () => {
    const state = normalizeViewportState({ zoom: 4, centerX: 12 });
    expect(state.zoom).toBe(4);
    expect(state.centerX).toBe(12);
    expect(state.centerY).toBe(DEFAULT_VIEWPORT_STATE.centerY);
    expect(state.mode).toBe("fit");
  });

  it("clamps the zoom into the renderer's range", () => {
    expect(normalizeViewportState({ zoom: 1000 }).zoom).toBe(64);
    expect(normalizeViewportState({ zoom: 0.0001 }).zoom).toBe(0.02);
    expect(normalizeViewportState({ zoom: -3 }).zoom).toBe(0.02);
  });

  it("reads free mode and rejects anything else", () => {
    expect(normalizeViewportState({ mode: "free" }).mode).toBe("free");
    expect(normalizeViewportState({ mode: "weird" }).mode).toBe("fit");
  });
});

describe("comparing viewport states", () => {
  it("sees the same state as equal", () => {
    expect(
      viewportStateEqual(DEFAULT_VIEWPORT_STATE, { ...DEFAULT_VIEWPORT_STATE }),
    ).toBe(true);
  });

  it("sees a different zoom as a different state", () => {
    expect(
      viewportStateEqual(DEFAULT_VIEWPORT_STATE, {
        ...DEFAULT_VIEWPORT_STATE,
        zoom: 2,
      }),
    ).toBe(false);
  });

  it("sees a different mode as a different state", () => {
    expect(
      viewportStateEqual(DEFAULT_VIEWPORT_STATE, {
        ...DEFAULT_VIEWPORT_STATE,
        mode: "free",
      }),
    ).toBe(false);
  });
});
