/**
 * Symmetry: the model and the display.
 *
 * The rules the rest of the feature leans on are all DOM-free, so they are
 * tested here directly: which axes are in force, where an axis stands, the
 * rule that a point on the axis is its own mirror, and the rule that the
 * mirror is about the *axis* rather than about the document's middle.
 *
 * The overlay is tested through a recording canvas: an overlay is display only,
 * so what matters is that it draws the axes and draws nothing else - it never
 * writes a pixel into a surface and never reaches an export.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SYMMETRY_MODE,
  DEFAULT_SYMMETRY_SETTINGS,
  SYMMETRY_MODES,
  activeSymmetryAxes,
  centeredSymmetrySettings,
  isOnAxis,
  isSymmetryMode,
  mirrorMovesAny,
  mirrorMovesPoint,
  mirrorPoint,
  normalizeSymmetryMode,
  normalizeSymmetrySettings,
  symmetryMirrors,
  symmetrySettingsEqual,
  type SymmetryMirror,
  type SymmetrySettings,
} from "../core/document/symmetry";
import {
  SYMMETRY_AXIS_COLOR,
  SYMMETRY_OVERLAY_ID,
  paintSymmetryAxes,
  resetSymmetryOverlaySettings,
  setSymmetryOverlaySettings,
  symmetryOverlay,
} from "../core/rendering/symmetryAxesOverlay";
import { findOverlay, listOverlays } from "../core/shell/overlayRegistry";
import type { Viewport } from "../types/viewport";
import { RecordingCanvas } from "./support/recordingCanvas";

/** A symmetry with the given overrides on top of the defaults. */
function settings(overrides: Partial<SymmetrySettings> = {}): SymmetrySettings {
  return { ...DEFAULT_SYMMETRY_SETTINGS, ...overrides };
}

/**
 * What the registry held the moment the overlay module was evaluated.
 *
 * The overlay registers itself when its module is evaluated, which is the
 * contract the shell relies on. The state is captured here, at module scope,
 * so the assertion below cannot be disturbed by another suite emptying the
 * registry.
 */
const registeredAtImport = findOverlay(SYMMETRY_OVERLAY_ID);

beforeEach(() => {
  resetSymmetryOverlaySettings();
});

describe("the symmetry model", () => {
  it("starts off, so nothing changes until it is asked for", () => {
    expect(DEFAULT_SYMMETRY_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_SYMMETRY_SETTINGS.mode).toBe(DEFAULT_SYMMETRY_MODE);
    expect(DEFAULT_SYMMETRY_MODE).toBe("vertical");
  });

  it("knows exactly three modes", () => {
    expect(SYMMETRY_MODES).toEqual(["vertical", "horizontal", "both"]);
    expect(isSymmetryMode("vertical")).toBe(true);
    expect(isSymmetryMode("horizontal")).toBe(true);
    expect(isSymmetryMode("both")).toBe(true);
    expect(isSymmetryMode("radial")).toBe(false);
    expect(isSymmetryMode("")).toBe(false);
    expect(isSymmetryMode(7)).toBe(false);
  });

  it("falls back to the default mode for a mode it does not know", () => {
    expect(normalizeSymmetryMode("horizontal")).toBe("horizontal");
    expect(normalizeSymmetryMode("radial")).toBe(DEFAULT_SYMMETRY_MODE);
    expect(normalizeSymmetryMode(undefined)).toBe(DEFAULT_SYMMETRY_MODE);
  });

  it("reads an untrusted settings value field by field", () => {
    const read = normalizeSymmetrySettings({
      enabled: true,
      mode: "both",
      verticalAxis: 120,
      horizontalAxis: 240,
    });
    expect(read).toEqual({
      enabled: true,
      mode: "both",
      verticalAxis: 120,
      horizontalAxis: 240,
    });
  });

  it("falls back per field when a settings value is malformed", () => {
    const read = normalizeSymmetrySettings({
      enabled: "yes",
      mode: "diagonal",
      verticalAxis: Number.NaN,
      horizontalAxis: 240.6,
    });
    expect(read.enabled).toBe(false);
    expect(read.mode).toBe(DEFAULT_SYMMETRY_MODE);
    expect(read.verticalAxis).toBe(DEFAULT_SYMMETRY_SETTINGS.verticalAxis);
    // A position is a whole document pixel: a registration mark with a soft
    // edge is not a mark.
    expect(read.horizontalAxis).toBe(241);
  });

  it("falls back to the defaults for a settings value that is not an object", () => {
    expect(normalizeSymmetrySettings(null)).toEqual(DEFAULT_SYMMETRY_SETTINGS);
    expect(normalizeSymmetrySettings([1, 2])).toEqual(DEFAULT_SYMMETRY_SETTINGS);
    expect(normalizeSymmetrySettings("vertical")).toEqual(DEFAULT_SYMMETRY_SETTINGS);
  });

  it("compares two settings", () => {
    expect(symmetrySettingsEqual(settings(), settings())).toBe(true);
    expect(symmetrySettingsEqual(settings(), settings({ enabled: true }))).toBe(false);
    expect(symmetrySettingsEqual(settings(), settings({ mode: "both" }))).toBe(false);
    expect(
      symmetrySettingsEqual(settings(), settings({ verticalAxis: 10 })),
    ).toBe(false);
    expect(
      symmetrySettingsEqual(settings(), settings({ horizontalAxis: 10 })),
    ).toBe(false);
  });
});

describe("the axes a symmetry has in force", () => {
  it("has none at all while the symmetry is off", () => {
    expect(activeSymmetryAxes(settings())).toEqual([]);
    expect(activeSymmetryAxes(settings({ mode: "both" }))).toEqual([]);
  });

  it("has one vertical axis in the vertical mode", () => {
    const axes = activeSymmetryAxes(settings({ enabled: true, verticalAxis: 120 }));
    expect(axes).toEqual([{ kind: "vertical", position: 120 }]);
  });

  it("has one horizontal axis in the horizontal mode", () => {
    const axes = activeSymmetryAxes(settings({ enabled: true, mode: "horizontal", horizontalAxis: 240 }));
    expect(axes).toEqual([{ kind: "horizontal", position: 240 }]);
  });

  it("has both axes in the both mode", () => {
    const axes = activeSymmetryAxes(
      settings({ enabled: true, mode: "both", verticalAxis: 120, horizontalAxis: 240 }),
    );
    expect(axes).toEqual([
      { kind: "vertical", position: 120 },
      { kind: "horizontal", position: 240 },
    ]);
  });

  it("keeps an axis as a line and a position, never a point", () => {
    const [axis] = activeSymmetryAxes(settings({ enabled: true, verticalAxis: 120 }));
    expect(Object.keys(axis).sort()).toEqual(["kind", "position"]);
  });

  it("places a fresh symmetry at the middle of the document - and only there", () => {
    const placed = centeredSymmetrySettings(800, 600);
    expect(placed.enabled).toBe(false);
    expect(placed.verticalAxis).toBe(400);
    expect(placed.horizontalAxis).toBe(300);
    expect(centeredSymmetrySettings(800, 600, "both").mode).toBe("both");
  });
});

describe("the mirrored point", () => {
  const vertical = [{ kind: "vertical", position: 100 }] as const;
  const horizontal = [{ kind: "horizontal", position: 100 }] as const;

  it("reflects across the vertical axis and leaves the other coordinate alone", () => {
    expect(mirrorPoint({ x: 40, y: 70 }, vertical)).toEqual({ x: 160, y: 70 });
    expect(mirrorPoint({ x: 160, y: 70 }, vertical)).toEqual({ x: 40, y: 70 });
  });

  it("reflects across the horizontal axis and leaves the other coordinate alone", () => {
    expect(mirrorPoint({ x: 70, y: 40 }, horizontal)).toEqual({ x: 70, y: 160 });
    expect(mirrorPoint({ x: 70, y: 160 }, horizontal)).toEqual({ x: 70, y: 40 });
  });

  it("turns a point about both axes when both are in force", () => {
    const both: SymmetryMirror = [
      { kind: "vertical", position: 100 },
      { kind: "horizontal", position: 100 },
    ];
    expect(mirrorPoint({ x: 40, y: 40 }, both)).toEqual({ x: 160, y: 160 });
  });

  it("mirrors about the axis, not about the middle of the document", () => {
    // The axis stands at x = 100. A point at x = 50 lands at x = 150 - about
    // the axis. Mirroring about the middle of an 800-wide document would have
    // put it at x = 750, and mirroring about a 1000-wide document's middle
    // would have put it at x = 950. The document's size is not in the model at
    // all, so it cannot be the rule.
    expect(mirrorPoint({ x: 50, y: 10 }, vertical)).toEqual({ x: 150, y: 10 });
  });

  it("follows the axis wherever it is moved to", () => {
    const moved = [{ kind: "vertical", position: 320 }] as const;
    expect(mirrorPoint({ x: 300, y: 10 }, moved)).toEqual({ x: 340, y: 10 });
  });

  it("makes a point on the axis its own mirror", () => {
    expect(isOnAxis({ kind: "vertical", position: 100 }, { x: 100, y: 70 })).toBe(true);
    expect(isOnAxis({ kind: "vertical", position: 100 }, { x: 101, y: 70 })).toBe(false);
    expect(isOnAxis({ kind: "horizontal", position: 100 }, { x: 70, y: 100 })).toBe(true);
    expect(isOnAxis({ kind: "horizontal", position: 100 }, { x: 70, y: 99 })).toBe(false);
  });

  it("says a mirror that moves nothing moves nothing", () => {
    const onAxis = { x: 100, y: 70 };
    expect(mirrorPoint(onAxis, vertical)).toEqual(onAxis);
    expect(mirrorMovesPoint(onAxis, vertical)).toBe(false);
    expect(mirrorMovesPoint({ x: 40, y: 70 }, vertical)).toBe(true);
  });

  it("judges a run of points as a whole, so only a stroke *along* the axis is still", () => {
    // A stroke that lies along the axis maps onto itself: copying it would
    // draw the same ink twice.
    expect(
      mirrorMovesAny([{ x: 100, y: 10 }, { x: 100, y: 90 }], vertical),
    ).toBe(false);
    // A stroke that merely crosses the axis still moves, so it is copied.
    expect(
      mirrorMovesAny([{ x: 100, y: 10 }, { x: 140, y: 90 }], vertical),
    ).toBe(true);
    expect(mirrorMovesAny([], vertical)).toBe(false);
  });
});

describe("the mirrors a stroke would be copied through", () => {
  it("makes none at all while the symmetry is off", () => {
    expect(symmetryMirrors(settings())).toEqual([]);
    expect(symmetryMirrors(settings({ mode: "both" }))).toEqual([]);
  });

  it("makes one mirror in a single-axis mode", () => {
    expect(symmetryMirrors(settings({ enabled: true, verticalAxis: 120 }))).toEqual([
      [{ kind: "vertical", position: 120 }],
    ]);
    expect(
      symmetryMirrors(settings({ enabled: true, mode: "horizontal", horizontalAxis: 240 })),
    ).toEqual([[{ kind: "horizontal", position: 240 }]]);
  });

  it("makes three mirrors in the both mode: the two flips and the half turn", () => {
    expect(
      symmetryMirrors(
        settings({ enabled: true, mode: "both", verticalAxis: 120, horizontalAxis: 240 }),
      ),
    ).toEqual([
      [{ kind: "vertical", position: 120 }],
      [{ kind: "horizontal", position: 240 }],
      [
        { kind: "vertical", position: 120 },
        { kind: "horizontal", position: 240 },
      ],
    ]);
  });
});

describe("the symmetry overlay", () => {
  /** A recording canvas, standing in for the display canvas. */
  function canvas() {
    return new RecordingCanvas();
  }

  /** Paints the overlay onto a recording canvas and returns the calls. */
  function paint(
    display: RecordingCanvas,
    scale = 2,
    viewport: Viewport = { zoom: 1, offsetX: 0, offsetY: 0 },
  ) {
    paintSymmetryAxes({
      ctx: display.getContext(),
      viewport,
      documentWidth: 800,
      documentHeight: 600,
      scale,
    });
    return display.calls;
  }

  it("registers itself in the shell's overlay registry when its module is evaluated", () => {
    expect(registeredAtImport).toBeDefined();
    expect(registeredAtImport?.id).toBe(SYMMETRY_OVERLAY_ID);
    // Over the artwork, so the ink never hides the axis.
    expect(registeredAtImport?.layer).toBe("over");
    expect(typeof registeredAtImport?.paint).toBe("function");
    expect(symmetryOverlay.id).toBe(SYMMETRY_OVERLAY_ID);
  });

  it("is a display overlay: the registry knows nothing else about it", () => {
    // The registry carries the overlay's *definition* - an id, a layer, an
    // order and a paint - and no document, no layer and no pixels. That is
    // what makes it display only.
    expect(Object.keys(symmetryOverlay).sort()).toEqual(["id", "layer", "order", "paint"]);
    expect(listOverlays().map((entry) => entry.id)).toContain(SYMMETRY_OVERLAY_ID);
  });

  it("draws nothing at all while the symmetry is off", () => {
    const display = canvas();
    expect(paint(display)).toEqual([]);
  });

  it("draws the vertical axis where it stands", () => {
    const display = canvas();
    setSymmetryOverlaySettings(settings({ enabled: true, verticalAxis: 120 }));
    const calls = paint(display);
    const moves = calls.filter((call) => call.name === "moveTo");
    const lines = calls.filter((call) => call.name === "lineTo");
    expect(moves).toHaveLength(1);
    expect(moves[0].args[0]).toBe(120);
    expect(lines).toHaveLength(1);
    expect(lines[0].args[0]).toBe(120);
  });

  it("draws the horizontal axis where it stands", () => {
    const display = canvas();
    setSymmetryOverlaySettings(settings({ enabled: true, mode: "horizontal", horizontalAxis: 240 }));
    const calls = paint(display);
    const moves = calls.filter((call) => call.name === "moveTo");
    const lines = calls.filter((call) => call.name === "lineTo");
    expect(moves[0].args[1]).toBe(240);
    expect(lines[0].args[1]).toBe(240);
  });

  it("spans the visible area, so the axis stays visible while the paper is panned", () => {
    const display = canvas();
    display.width = 1600;
    display.height = 1200;
    setSymmetryOverlaySettings(settings({ enabled: true, verticalAxis: 120 }));
    // Zoom 1, so the canvas covers 1600/2 = 800 document pixels across, and
    // the paper is panned 100 document pixels to the left.
    const calls = paint(display, 2, { zoom: 1, offsetX: 100, offsetY: 50 });
    const moves = calls.filter((call) => call.name === "moveTo");
    const lines = calls.filter((call) => call.name === "lineTo");
    expect(moves[0].args[1]).toBe(-50);
    expect(lines[0].args[1]).toBe(-50 + 1200 / 2);
  });

  it("falls back to the paper when the canvas has no size yet", () => {
    const display = canvas();
    setSymmetryOverlaySettings(settings({ enabled: true, verticalAxis: 120 }));
    const calls = paint(display);
    const moves = calls.filter((call) => call.name === "moveTo");
    const lines = calls.filter((call) => call.name === "lineTo");
    expect(moves[0].args[1]).toBe(0);
    expect(lines[0].args[1]).toBe(600);
  });

  it("draws both axes in the both mode", () => {
    const display = canvas();
    setSymmetryOverlaySettings(
      settings({ enabled: true, mode: "both", verticalAxis: 120, horizontalAxis: 240 }),
    );
    const calls = paint(display);
    expect(calls.filter((call) => call.name === "moveTo")).toHaveLength(2);
    expect(calls.filter((call) => call.name === "stroke")).toHaveLength(1);
  });

  it("draws a hairline one device pixel wide, whatever the zoom", () => {
    const display = canvas();
    setSymmetryOverlaySettings(settings({ enabled: true, verticalAxis: 120 }));
    const strokes = paint(display, 2).filter((call) => call.name === "stroke");
    expect(strokes).toHaveLength(1);
    expect(strokes[0].lineWidth).toBe(0.5);
  });

  it("draws in its own colour and a dashed line, so it is not a guide", () => {
    const display = canvas();
    setSymmetryOverlaySettings(settings({ enabled: true, verticalAxis: 120 }));
    const strokes = paint(display).filter((call) => call.name === "stroke");
    expect(strokes[0].strokeStyle).toBe(SYMMETRY_AXIS_COLOR);
    expect(strokes[0].lineDash.length).toBeGreaterThan(0);
  });

  it("never writes a pixel: it strokes a line and nothing else", () => {
    const display = canvas();
    setSymmetryOverlaySettings(settings({ enabled: true, mode: "both" }));
    const calls = paint(display);
    const writing = calls.filter((call) =>
      ["fillRect", "putImageData", "drawImage", "fill", "strokeRect"].includes(call.name),
    );
    expect(writing).toEqual([]);
  });
});
