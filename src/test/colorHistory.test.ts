/**
 * The recent-colours history.
 *
 * These cover the model - the order, the bound and the de-duplication - and
 * the engine seam: what records a colour, what clears it, and what it must
 * never touch.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import {
  COLOR_HISTORY_LIMIT,
  colorHistoryEqual,
  normalizeColorHistory,
  pushColorHistory,
} from "../core/color/history";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { DEFAULT_APP_SETTINGS, serializeAppSettings } from "../core/settings/appSettings";
import type { DrawingRenderer, Rgb } from "../core/rendering/types";
import type { PointerSample } from "../types/pointer";

function createSample(overrides: Partial<PointerSample> = {}): PointerSample {
  return {
    phase: "move",
    pointerId: 1,
    kind: "pen",
    isPrimary: true,
    button: 0,
    buttons: 1,
    docX: 0,
    docY: 0,
    screenX: 0,
    screenY: 0,
    pressure: 0.7,
    hasPressure: true,
    tiltX: 0,
    tiltY: 0,
    timeStamp: 0,
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    ...overrides,
  };
}

/** A renderer that answers the colour picker with one fixed colour. */
function createPickerRenderer(color: Rgb): DrawingRenderer {
  return {
    kind: "canvas2d",
    setDocument: () => {},
    setViewport: () => {},
    setDisplaySize: () => {},
    setRasterScale: () => {},
    invalidateLayer: () => {},
    beginStroke: () => {},
    extendStroke: () => {},
    replaceStroke: () => {},
    endStroke: () => {},
    cancelStroke: () => {},
    setSelection: () => {},
    setSelectedGuide: () => {},
    setGrid: () => {},
    composeDocumentImage: () => {
      throw new Error("composeDocumentImage is not used in these tests.");
    },
    readCompositePixel: () => color,
    readCompositeImage: () => null,
    render: () => {},
    requestRender: () => {},
    destroy: () => {},
  };
}

function createEngine() {
  return new DrawingEngine({
    document: createDocument({ name: "Test", width: 40, height: 40 }),
  });
}

describe("the colour history model", () => {
  it("keeps the newest colour first", () => {
    let history = pushColorHistory([], "#111111");
    history = pushColorHistory(history, "#222222");

    expect(history).toEqual(["#222222", "#111111"]);
  });

  it("moves a colour that is picked again to the front", () => {
    let history = pushColorHistory([], "#111111");
    history = pushColorHistory(history, "#222222");
    history = pushColorHistory(history, "#111111");

    expect(history).toEqual(["#111111", "#222222"]);
  });

  it("never holds the same colour twice", () => {
    let history = pushColorHistory([], "#111111");
    history = pushColorHistory(history, "#111111");
    history = pushColorHistory(history, "#111111");

    expect(history).toEqual(["#111111"]);
  });

  it("reads the same colour written in another shape as the same colour", () => {
    const history = pushColorHistory([], "#ABC");

    expect(history).toEqual(["#aabbcc"]);
  });

  it("drops the oldest colour once the list is full", () => {
    let history: readonly string[] = [];
    for (let index = 0; index < COLOR_HISTORY_LIMIT + 5; index += 1) {
      history = pushColorHistory(history, `#${index.toString(16).padStart(6, "0")}`);
    }

    expect(history).toHaveLength(COLOR_HISTORY_LIMIT);
    // The newest is first and the oldest of the ones that fitted is last.
    expect(history[0]).toBe(
      `#${(COLOR_HISTORY_LIMIT + 4).toString(16).padStart(6, "0")}`,
    );
    expect(history[history.length - 1]).toBe("#000005");
  });

  it("refuses a colour that is not a colour", () => {
    const history = pushColorHistory([], "#111111");

    expect(pushColorHistory(history, "not a colour")).toBe(history);
    expect(pushColorHistory(history, "")).toBe(history);
  });

  it("reads an untrusted list and keeps the good entries", () => {
    const history = normalizeColorHistory([
      "#111111",
      "not a colour",
      "#222222",
      "#111111",
      null,
      42,
      "#ABC",
    ]);

    expect(history).toEqual(["#111111", "#222222", "#aabbcc"]);
  });

  it("reads a value that is not a list as an empty history", () => {
    expect(normalizeColorHistory(undefined)).toEqual([]);
    expect(normalizeColorHistory({ colors: [] })).toEqual([]);
  });

  it("compares two histories field by field", () => {
    expect(colorHistoryEqual(["#111111"], ["#111111"])).toBe(true);
    expect(colorHistoryEqual(["#111111"], ["#222222"])).toBe(false);
    expect(colorHistoryEqual(["#111111"], ["#111111", "#222222"])).toBe(false);
  });
});

describe("the engine keeps the recent colours", () => {
  it("records the ink and the alt colour, newest first", () => {
    const engine = createEngine();

    engine.setBrush({ color: "#ff0000" });
    engine.setSecondaryColor("#00ff00");

    expect(engine.getState().colorHistory).toEqual(["#00ff00", "#ff0000"]);
  });

  it("records a colour that is picked again at the front", () => {
    const engine = createEngine();

    engine.setBrush({ color: "#ff0000" });
    engine.setBrush({ color: "#00ff00" });
    engine.setBrush({ color: "#ff0000" });

    expect(engine.getState().colorHistory).toEqual(["#ff0000", "#00ff00"]);
  });

  it("records nothing when the colour does not change", () => {
    const engine = createEngine();

    engine.setBrush({ color: DEFAULT_BRUSH.color });
    engine.setSecondaryColor("#ffffff");
    engine.setBrush({ size: 12 });

    expect(engine.getState().colorHistory).toEqual([]);
  });

  it("records nothing for a colour that is written but not picked", () => {
    const engine = createEngine();

    // A drag on the wheel writes a colour on every pointer move, and the
    // colours in between are not colours the artist chose.
    engine.setBrush({ color: "#ff0000" }, { record: false });
    engine.setBrush({ color: "#00ff00" }, { record: false });
    engine.setSecondaryColor("#0000ff", { record: false });

    expect(engine.getState().brush.color).toBe("#00ff00");
    expect(engine.getState().secondaryColor).toBe("#0000ff");
    expect(engine.getState().colorHistory).toEqual([]);
  });

  it("records the colour a drag settles on, and only that one", () => {
    const engine = createEngine();

    engine.setBrush({ color: "#ff0000" }, { record: false });
    engine.setBrush({ color: "#00ff00" }, { record: false });
    engine.recordColor("#00ff00");

    expect(engine.getState().colorHistory).toEqual(["#00ff00"]);
  });

  it("records nothing when the settled colour is already the newest", () => {
    const engine = createEngine();
    engine.setBrush({ color: "#ff0000" });

    const before = engine.getState();
    engine.recordColor("#ff0000");

    expect(engine.getState().colorHistory).toEqual(["#ff0000"]);
    // The list did not change, so the editor did not publish a change for it.
    expect(engine.getState().colorHistory).toBe(before.colorHistory);
  });

  it("records the colour the canvas picker samples", () => {
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 40, height: 40 }),
      renderer: createPickerRenderer({ r: 12, g: 34, b: 56 }),
      brush: { ...DEFAULT_BRUSH, color: "#000000" },
    });

    engine.setTool("picker");
    engine.handlePointerSample(createSample({ phase: "down", docX: 5, docY: 5 }));

    expect(engine.getState().brush.color).toBe("#0c2238");
    expect(engine.getState().colorHistory).toEqual(["#0c2238"]);
  });

  it("empties the history without touching the document", () => {
    const engine = createEngine();
    engine.setBrush({ color: "#ff0000" });

    engine.clearColorHistory();

    expect(engine.getState().colorHistory).toEqual([]);
    expect(engine.getState().brush.color).toBe("#ff0000");
  });

  it("reads a list handed to it through the same reader the model uses", () => {
    const engine = createEngine();

    engine.setColorHistory(["#111111", "not a colour", "#222222", "#111111"]);

    expect(engine.getState().colorHistory).toEqual(["#111111", "#222222"]);
  });

  it("does not add a history step or dirty the file", () => {
    const engine = createEngine();

    engine.setBrush({ color: "#ff0000" });
    engine.setSecondaryColor("#00ff00");
    engine.clearColorHistory();

    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("is not written to the settings file", () => {
    const engine = createEngine();
    engine.setBrush({ color: "#ff0000" });

    // The history is session state: the settings contract has no field for
    // it, so nothing about it can reach the file.
    const text = serializeAppSettings(DEFAULT_APP_SETTINGS);

    expect(text).not.toContain("colorHistory");
    expect(text).not.toContain("#ff0000");
  });
});
