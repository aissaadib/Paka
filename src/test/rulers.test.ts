/**
 * Rulers: the pure geometry and the overlay that paints them.
 *
 * The rules that decide what a ruler shows are DOM-free, so they are tested
 * here directly: the round tick spacing, the ticks' positions, the label a
 * tick carries, the pointer's position on a ruler and the marks a selection
 * leaves on the two strips.
 *
 * The overlay is tested through a recording context: it must paint the chrome
 * and nothing else, and it must leave the viewport alone, because a ruler
 * that moved the document would need a pointer offset to compensate.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RULER_INSETS,
  DEFAULT_RULER_SETTINGS,
  RULER_LEFT_SIZE_PX,
  RULER_MIN_GAP_PX,
  RULER_SIZE_PX,
  clipRulerSpan,
  formatRulerLabel,
  nearestRulerTick,
  rulerAxisAt,
  rulerCursorAt,
  rulerDocumentAt,
  rulerGeometry,
  rulerLayout,
  rulerMinorStep,
  rulerMinorTicks,
  rulerScreenAt,
  rulerSelectionMarks,
  rulerStep,
  rulerTicks,
} from "../core/rendering/rulers";
import {
  RULER_OVERLAY_ID,
  RULER_SELECTION_COLOR,
  getRulerOverlayState,
  paintRulers,
  resetRulerOverlayState,
  rulerOverlay,
  setRulerOverlayState,
} from "../core/rendering/rulerOverlay";
import {
  findOverlay,
  overlaysForLayer,
  registerOverlay,
  resetOverlayRegistry,
  type OverlayPaintContext,
} from "../core/shell/overlayRegistry";
import { docToScreen, screenToDoc } from "../core/rendering/viewport";
import { MAX_ZOOM, MIN_ZOOM } from "../core/rendering/viewport";
import type { Viewport } from "../types/viewport";

/** A zoom the tests walk through: the whole range the editor allows. */
const ZOOMS = [MIN_ZOOM, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 8, 16, 32, MAX_ZOOM];

/** A viewport at 1x with the paper's origin at the canvas's origin. */
const VIEWPORT: Viewport = { zoom: 1, offsetX: 0, offsetY: 0 };

/** Whether a step is one of 1, 2 or 5 times a power of ten. */
function isRoundStep(step: number): boolean {
  if (!Number.isFinite(step) || step <= 0) {
    return false;
  }
  const magnitude = 10 ** Math.floor(Math.log10(step));
  const factor = step / magnitude;
  return factor === 1 || factor === 2 || factor === 5;
}

/** One recorded drawing call. */
interface DrawCall {
  readonly op: string;
  readonly args: readonly unknown[];
  /** The fill colour in force when the call was made. */
  readonly fillStyle: string;
  /** The stroke colour in force when the call was made. */
  readonly strokeStyle: string;
}

/**
 * A recording canvas context.
 *
 * It records what was drawn and nothing else, which is enough to check that
 * the rulers paint their chrome and that they never touch the viewport.
 */
class RecordingContext {
  readonly calls: DrawCall[] = [];
  readonly canvas = { width: 1600, height: 900 };
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;
  font = "";
  textAlign = "left";
  textBaseline = "alphabetic";
  globalAlpha = 1;

  save(): void {
    this.record("save", []);
  }

  restore(): void {
    this.record("restore", []);
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.record("setTransform", [a, b, c, d, e, f]);
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.record("fillRect", [x, y, width, height]);
  }

  beginPath(): void {
    this.record("beginPath", []);
  }

  moveTo(x: number, y: number): void {
    this.record("moveTo", [x, y]);
  }

  lineTo(x: number, y: number): void {
    this.record("lineTo", [x, y]);
  }

  stroke(): void {
    this.record("stroke", []);
  }

  fillText(text: string, x: number, y: number): void {
    this.record("fillText", [text, x, y]);
  }

  measureText(text: string): { width: number } {
    return { width: text.length * 6 };
  }

  /** The calls of one kind. */
  ops(op: string): DrawCall[] {
    return this.calls.filter((call) => call.op === op);
  }

  private record(op: string, args: readonly unknown[]): void {
    this.calls.push({ op, args, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle });
  }
}

/** The paint context the overlay is handed. */
function paintContext(
  context: RecordingContext,
  viewport: Viewport = VIEWPORT,
  documentWidth = 400,
  documentHeight = 300,
): OverlayPaintContext {
  return {
    ctx: context as unknown as CanvasRenderingContext2D,
    viewport,
    documentWidth,
    documentHeight,
    scale: 1,
  };
}

describe("the ruler settings", () => {
  it("start hidden, so a new capability changes no pixels until it is asked for", () => {
    expect(DEFAULT_RULER_SETTINGS).toEqual({ visible: false });
  });

  it("measure the strips in CSS pixels", () => {
    expect(DEFAULT_RULER_INSETS).toEqual({ top: RULER_SIZE_PX, left: RULER_LEFT_SIZE_PX });
  });
});

describe("the tick spacing", () => {
  it("is a round number at every zoom", () => {
    for (const zoom of ZOOMS) {
      expect(isRoundStep(rulerStep(zoom))).toBe(true);
    }
  });

  it("keeps the labelled ticks at least the minimum gap apart on screen", () => {
    for (const zoom of ZOOMS) {
      expect(rulerStep(zoom) * zoom).toBeGreaterThanOrEqual(RULER_MIN_GAP_PX - 1e-9);
    }
  });

  it("is the smallest round step that keeps the gap", () => {
    for (const zoom of ZOOMS) {
      const step = rulerStep(zoom);
      const raw = RULER_MIN_GAP_PX / zoom;
      expect(step).toBeGreaterThanOrEqual(raw - 1e-9);
      // Every smaller round step would put two labels too close together.
      for (const smaller of [step / 2, step / 2.5, step / 5, step / 10]) {
        if (isRoundStep(smaller)) {
          expect(smaller * zoom).toBeLessThan(RULER_MIN_GAP_PX);
        }
      }
    }
  });

  it("labels every 100 pixels at 100 %", () => {
    expect(rulerStep(1)).toBe(100);
  });

  it("labels every 500 pixels at 25 %", () => {
    expect(rulerStep(0.25)).toBe(500);
  });

  it("labels every pixel at the largest zoom", () => {
    expect(rulerStep(MAX_ZOOM)).toBe(1);
  });

  it("labels every 5000 pixels at the smallest zoom", () => {
    expect(rulerStep(MIN_ZOOM)).toBe(5000);
  });

  it("falls back to one for a zoom that is not a number", () => {
    expect(rulerStep(0)).toBe(1);
    expect(rulerStep(-2)).toBe(1);
    expect(rulerStep(Number.NaN)).toBe(1);
    expect(rulerStep(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("depends on the zoom and on nothing else", () => {
    expect(rulerStep(2)).toBe(rulerStep(2));
    expect(rulerStep(2)).not.toBe(rulerStep(3));
  });
});

describe("the unlabelled ticks", () => {
  it("divide a step of 100 into ten", () => {
    expect(rulerMinorStep(100)).toBe(10);
  });

  it("divide a step of 50 into ten", () => {
    expect(rulerMinorStep(50)).toBe(5);
  });

  it("divide a step of 20 into ten", () => {
    expect(rulerMinorStep(20)).toBe(2);
  });

  it("divide a step of 5 into five", () => {
    expect(rulerMinorStep(5)).toBe(1);
  });

  it("divide a step of 2 into two", () => {
    expect(rulerMinorStep(2)).toBe(1);
  });

  it("are absent for a step of one", () => {
    expect(rulerMinorStep(1)).toBe(0);
  });

  it("are absent for a step that is not a number", () => {
    expect(rulerMinorStep(0)).toBe(0);
    expect(rulerMinorStep(Number.NaN)).toBe(0);
  });

  it("leave out the ticks that carry a label", () => {
    expect(rulerMinorTicks(0, 100, 10, 100)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
  });

  it("keep the ticks on a negative axis", () => {
    expect(rulerMinorTicks(-100, 0, 10, 100)).toEqual([-90, -80, -70, -60, -50, -40, -30, -20, -10]);
  });
});

describe("the ticks", () => {
  it("are the multiples of the step inside the range", () => {
    expect(rulerTicks(0, 250, 100)).toEqual([0, 100, 200]);
  });

  it("take the bounds in either order", () => {
    expect(rulerTicks(250, 0, 100)).toEqual([0, 100, 200]);
  });

  it("keep a tick that sits exactly on a bound", () => {
    expect(rulerTicks(100, 300, 100)).toEqual([100, 200, 300]);
  });

  it("are empty for a step that is not a number", () => {
    expect(rulerTicks(0, 100, 0)).toEqual([]);
    expect(rulerTicks(0, 100, Number.NaN)).toEqual([]);
    expect(rulerTicks(Number.NaN, 100, 100)).toEqual([]);
  });

  it("never report a negative zero", () => {
    expect(Object.is(rulerTicks(-50, 50, 100)[0], -0)).toBe(false);
  });
});

describe("the labels", () => {
  it("are the coordinate in whole document pixels", () => {
    expect(formatRulerLabel(0)).toBe("0");
    expect(formatRulerLabel(120)).toBe("120");
    expect(formatRulerLabel(-50)).toBe("-50");
  });

  it("round a fractional coordinate", () => {
    expect(formatRulerLabel(120.4)).toBe("120");
    expect(formatRulerLabel(-0.2)).toBe("0");
  });

  it("fall back to zero for a value that is not a number", () => {
    expect(formatRulerLabel(Number.NaN)).toBe("0");
  });
});

describe("the ruler under the pointer", () => {
  it("is the top strip along the top edge", () => {
    expect(rulerAxisAt(100, 5)).toBe("horizontal");
    expect(rulerAxisAt(100, RULER_SIZE_PX - 1)).toBe("horizontal");
  });

  it("is the left strip along the left edge", () => {
    expect(rulerAxisAt(5, 100)).toBe("vertical");
    expect(rulerAxisAt(RULER_LEFT_SIZE_PX - 1, 100)).toBe("vertical");
  });

  it("gives the corner to the top strip", () => {
    expect(rulerAxisAt(2, 2)).toBe("horizontal");
  });

  it("is nothing over the artwork", () => {
    expect(rulerAxisAt(100, 100)).toBeNull();
    expect(rulerAxisAt(-1, 5)).toBeNull();
    expect(rulerAxisAt(5, -1)).toBeNull();
  });

  it("keeps the left strip running down the whole canvas", () => {
    expect(rulerAxisAt(5, RULER_SIZE_PX)).toBe("vertical");
    expect(rulerAxisAt(5, 900)).toBe("vertical");
  });
});

describe("the cursor on a ruler", () => {
  it("reads the document coordinate under the pointer", () => {
    expect(rulerDocumentAt(VIEWPORT, "horizontal", 250, 5)).toBe(250);
    expect(rulerDocumentAt(VIEWPORT, "vertical", 5, 250)).toBe(250);
  });

  it("reports the coordinate and the tick it would snap to", () => {
    const cursor = rulerCursorAt(VIEWPORT, "horizontal", 240, 5);
    expect(cursor.axis).toBe("horizontal");
    expect(cursor.value).toBe(240);
    expect(cursor.snapped).toBe(200);
  });

  it("follows the pan", () => {
    const panned: Viewport = { zoom: 1, offsetX: 100, offsetY: 0 };
    expect(rulerCursorAt(panned, "horizontal", 250, 5).value).toBe(150);
  });

  it("snaps to the nearest labelled tick", () => {
    expect(nearestRulerTick(240, 100)).toBe(200);
    expect(nearestRulerTick(260, 100)).toBe(300);
    expect(nearestRulerTick(250, 100)).toBe(300);
    expect(nearestRulerTick(-40, 100)).toBe(0);
  });
});

describe("the ruler layout", () => {
  it("puts the ticks where the viewport says they are", () => {
    const layout = rulerLayout(VIEWPORT, "horizontal", 800);
    expect(layout.major[0].value).toBe(100);
    expect(layout.major[0].screen).toBe(docToScreen(VIEWPORT, 100, 0).x);
    expect(layout.major[0].label).toBe("100");
  });

  it("starts after the corner, so the strips never overlap", () => {
    const horizontal = rulerLayout(VIEWPORT, "horizontal", 800);
    const vertical = rulerLayout(VIEWPORT, "vertical", 900);
    expect(horizontal.major.every((tick) => tick.screen >= RULER_LEFT_SIZE_PX)).toBe(true);
    expect(vertical.major.every((tick) => tick.screen >= RULER_SIZE_PX)).toBe(true);
  });

  it("is the same every time it is asked for", () => {
    expect(rulerLayout(VIEWPORT, "horizontal", 800)).toEqual(rulerLayout(VIEWPORT, "horizontal", 800));
  });

  it("changes with the zoom", () => {
    const zoomed = rulerLayout({ zoom: 4, offsetX: 0, offsetY: 0 }, "horizontal", 800);
    expect(zoomed.step).toBeLessThan(rulerLayout(VIEWPORT, "horizontal", 800).step);
  });

  it("follows the pan", () => {
    const panned: Viewport = { zoom: 1, offsetX: 100, offsetY: 0 };
    const layout = rulerLayout(panned, "horizontal", 800);
    // The paper moved a hundred pixels to the left, so the origin's tick is
    // now a hundred pixels along the strip.
    expect(layout.major[0].value).toBe(0);
    expect(layout.major[0].screen).toBe(docToScreen(panned, 0, 0).x);
  });

  it("maps a document coordinate back to the screen", () => {
    expect(rulerScreenAt(VIEWPORT, "horizontal", 100)).toBe(100);
    expect(rulerScreenAt(VIEWPORT, "vertical", 100)).toBe(100);
    expect(rulerScreenAt({ zoom: 2, offsetX: 10, offsetY: 20 }, "horizontal", 100)).toBe(
      docToScreen({ zoom: 2, offsetX: 10, offsetY: 20 }, 100, 0).x,
    );
  });

  it("has no ticks at all when the canvas is smaller than the strips", () => {
    const layout = rulerLayout(VIEWPORT, "horizontal", 10);
    expect(layout.major).toEqual([]);
    expect(layout.minor).toEqual([]);
  });

  it("has no ticks for a zoom that is not a number", () => {
    const layout = rulerLayout({ zoom: 0, offsetX: 0, offsetY: 0 }, "horizontal", 800);
    expect(layout.major).toEqual([]);
  });

  it("lays the two rulers out independently", () => {
    const geometry = rulerGeometry(VIEWPORT, 800, 600);
    expect(geometry.horizontal.axis).toBe("horizontal");
    expect(geometry.vertical.axis).toBe("vertical");
    expect(geometry.horizontal.range.from).toBe(RULER_LEFT_SIZE_PX);
    expect(geometry.vertical.range.from).toBe(RULER_SIZE_PX);
  });

  it("measures the screen, not the paper", () => {
    const range = rulerGeometry(VIEWPORT, 800, 600).horizontal.range;
    expect(range.to).toBe(screenToDoc(VIEWPORT, 800, 0).x);
  });
});

describe("the selection's marks", () => {
  it("are the selection's edges", () => {
    const marks = rulerSelectionMarks({ x: 10, y: 20, width: 100, height: 50 });
    expect(marks.horizontal).toEqual({ from: 10, to: 110 });
    expect(marks.vertical).toEqual({ from: 20, to: 70 });
  });

  it("are nothing without a selection", () => {
    expect(rulerSelectionMarks(null)).toEqual({ horizontal: null, vertical: null });
  });

  it("are clipped to what the ruler shows", () => {
    expect(clipRulerSpan({ from: 10, to: 110 }, { from: 50, to: 100 })).toEqual({ from: 50, to: 100 });
  });

  it("are dropped when the selection is out of sight", () => {
    expect(clipRulerSpan({ from: 200, to: 300 }, { from: 50, to: 100 })).toBeNull();
    expect(clipRulerSpan(null, { from: 50, to: 100 })).toBeNull();
  });
});

describe("the ruler overlay", () => {
  beforeEach(() => {
    resetOverlayRegistry();
    registerOverlay(rulerOverlay);
    resetRulerOverlayState();
  });

  it("registers itself above the artwork", () => {
    expect(findOverlay(RULER_OVERLAY_ID)).toBe(rulerOverlay);
    expect(overlaysForLayer("over")).toContain(rulerOverlay);
    expect(rulerOverlay.layer).toBe("over");
  });

  it("starts hidden", () => {
    expect(getRulerOverlayState().visible).toBe(false);
  });

  it("draws nothing while it is hidden", () => {
    const context = new RecordingContext();
    paintRulers(paintContext(context));
    expect(context.calls).toEqual([]);
  });

  it("paints the chrome and the numbers when it is shown", () => {
    setRulerOverlayState({ visible: true });
    const context = new RecordingContext();
    paintRulers(paintContext(context));
    expect(context.ops("fillRect").length).toBeGreaterThan(0);
    expect(context.ops("fillText").length).toBeGreaterThan(0);
    expect(context.ops("moveTo").length).toBeGreaterThan(0);
  });

  it("paints only drawing calls, so it cannot reach a layer surface", () => {
    setRulerOverlayState({ visible: true });
    const context = new RecordingContext();
    paintRulers(paintContext(context));
    const allowed = new Set([
      "save",
      "restore",
      "setTransform",
      "fillRect",
      "beginPath",
      "moveTo",
      "lineTo",
      "stroke",
      "fillText",
    ]);
    for (const call of context.calls) {
      expect(allowed.has(call.op)).toBe(true);
    }
  });

  it("leaves the viewport alone, so the document does not move", () => {
    setRulerOverlayState({ visible: true });
    const viewport: Viewport = { zoom: 1, offsetX: 40, offsetY: 60 };
    const before = { ...viewport };
    const context = new RecordingContext();
    paintRulers(paintContext(context, viewport));
    expect(viewport).toEqual(before);
  });

  it("does not measure the paper", () => {
    setRulerOverlayState({ visible: true });
    const small = new RecordingContext();
    const large = new RecordingContext();
    paintRulers(paintContext(small, VIEWPORT, 100, 100));
    paintRulers(paintContext(large, VIEWPORT, 5000, 5000));
    expect(large.calls).toEqual(small.calls);
  });

  it("paints the selection's marks", () => {
    setRulerOverlayState({ visible: true, selection: { x: 0, y: 0, width: 100, height: 50 } });
    const context = new RecordingContext();
    paintRulers(paintContext(context));
    const marks = context
      .ops("fillRect")
      .filter((call) => call.fillStyle === RULER_SELECTION_COLOR);
    expect(marks.length).toBeGreaterThan(0);
  });

  it("paints no marks without a selection", () => {
    setRulerOverlayState({ visible: true });
    const context = new RecordingContext();
    paintRulers(paintContext(context));
    const marks = context
      .ops("fillRect")
      .filter((call) => call.fillStyle === RULER_SELECTION_COLOR);
    expect(marks).toEqual([]);
  });

  it("marks the selection where the selection is", () => {
    setRulerOverlayState({ visible: true, selection: { x: 0, y: 0, width: 100, height: 50 } });
    const context = new RecordingContext();
    paintRulers(paintContext(context));
    const marks = context
      .ops("fillRect")
      .filter((call) => call.fillStyle === RULER_SELECTION_COLOR);
    // The horizontal band starts at the top strip's inner edge and reaches
    // the selection's right edge; the vertical band starts at the left
    // strip's inner edge and reaches the selection's bottom edge.
    expect(marks.map((call) => call.args)).toEqual([
      [RULER_LEFT_SIZE_PX, 0, 100 - RULER_LEFT_SIZE_PX, RULER_SIZE_PX],
      [0, RULER_SIZE_PX, RULER_LEFT_SIZE_PX, 50 - RULER_SIZE_PX],
    ]);
  });
});
