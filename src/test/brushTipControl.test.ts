/**
 * The brush tip's control tests.
 *
 * The tip's mask is tested in `brushTip.test.ts`; this file is about the
 * *control* over it:
 *
 * - the list offers the tip's five shapes and nothing else, and a shape this
 *   build does not know is refused rather than drawn as the nearest thing;
 * - the write reaches the brush's own field through `setBrush`, so choosing a
 *   tip is editor state: no history step, nothing dirty;
 * - the control is registered through the shared per-tool registry, so the
 *   options bar draws it with the same control every other select uses;
 * - the preview beside the control is the tip's own mask;
 * - the tip only reaches a stamped stroke: a brush that does not stamp draws
 *   the plain segment stroke whatever the tip is.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import {
  BRUSH_TIP_CHOICES,
  BRUSH_TIP_OPTION_ID,
  brushTipOption,
  brushTipPreview,
  registerBrushTipOptions,
} from "../core/brushes/brushTipOptions";
import { createDocument } from "../core/document/document";
import { isStroke, type LayerElement, type LayerId, type StrokeRecord } from "../core/document/types";
import { DrawingEngine, type EditorSnapshot } from "../core/engine/DrawingEngine";
import { optionControl } from "../core/options/optionControl";
import { optionPreviewFor } from "../core/options/optionPreviews";
import { BRUSH_TIP_SHAPES } from "../core/rendering/brushTip";
import { Canvas2DRenderer } from "../core/rendering/Canvas2DRenderer";
import { FrameScheduler } from "../core/rendering/frameScheduler";
import type { StrokeSource } from "../core/rendering/types";
import { visibleToolOptions } from "../core/shell/toolOptions";
import type { EditorActions } from "../state/editorStore";
import type { BrushSettings } from "../types/brush";
import { OptionControl } from "../features/options/OptionControl";
import {
  installRecordingDocument,
  RecordingCanvas,
  type RecordingDocument,
} from "./support/recordingCanvas";

/** An engine with a brush of the test's own making. */
function createEngine(brush: Partial<BrushSettings> = {}): DrawingEngine {
  return new DrawingEngine({ brush: { ...DEFAULT_BRUSH, ...brush } });
}

/** The snapshot the control reads. */
function snapshotOf(engine: DrawingEngine): EditorSnapshot {
  return engine.getState();
}

/** The actions the control writes through, without a React tree. */
function actionsFor(engine: DrawingEngine): EditorActions {
  return {
    setBrush: (patch: Partial<BrushSettings>) => engine.setBrush(patch),
  } as unknown as EditorActions;
}

describe("the tip's list of shapes", () => {
  it("offers exactly the tip's shapes, and nothing else", () => {
    expect(BRUSH_TIP_CHOICES.map((choice) => choice.value)).toEqual([...BRUSH_TIP_SHAPES]);
    for (const choice of BRUSH_TIP_CHOICES) {
      expect(choice.label.length).toBeGreaterThan(0);
    }
    // The control offers the same list, so the two cannot drift apart.
    expect(brushTipOption.choices).toBe(BRUSH_TIP_CHOICES);
  });

  it("reads the brush's own tip, and repairs one it does not know", () => {
    const engine = createEngine({ tip: "blot" });
    expect(brushTipOption.read(snapshotOf(engine))).toBe("blot");

    const broken = {
      ...snapshotOf(engine),
      brush: { ...engine.getState().brush, tip: "nib" as never },
    };
    expect(brushTipOption.read(broken)).toBe("round");
  });
});

describe("the tip's write", () => {
  it("reaches the brush's own field", () => {
    const setBrush = vi.fn();
    const actions = { setBrush } as unknown as EditorActions;
    brushTipOption.write(actions, "chisel");
    expect(setBrush).toHaveBeenCalledWith({ tip: "chisel" });
  });

  it("refuses a shape this build does not know", () => {
    const setBrush = vi.fn();
    const actions = { setBrush } as unknown as EditorActions;
    // Not drawn as the nearest thing: refused.
    brushTipOption.write(actions, "nib");
    brushTipOption.write(actions, "");
    brushTipOption.write(actions, "Round");
    brushTipOption.write(actions, " round");
    expect(setBrush).not.toHaveBeenCalled();
  });

  it("is editor state: no history step, nothing dirty", () => {
    const engine = createEngine();
    const before = snapshotOf(engine);
    brushTipOption.write(actionsFor(engine), "felt");
    const after = snapshotOf(engine);

    expect(after.brush.tip).toBe("felt");
    // An edit would have added a step and made the document dirty.
    expect(after.history.depth).toBe(before.history.depth);
    expect(after.history.canUndo).toBe(false);
    expect(after.file.dirty).toBe(false);
  });
});

describe("the tip's control in the options bar", () => {
  it("is registered for the brush tool", () => {
    const engine = createEngine({ stamp: true });
    const visible = visibleToolOptions("brush", snapshotOf(engine));
    const option = visible.find((entry) => entry.id === BRUSH_TIP_OPTION_ID);
    expect(option).toBeDefined();
    expect(option?.kind).toBe("select");
    expect(option?.kind === "select" ? option.choices.map((choice) => choice.value) : []).toEqual([
      ...BRUSH_TIP_SHAPES,
    ]);
  });

  it("shows the tip only when the brush stamps", () => {
    // A tip masks a dab, and a brush that does not stamp has no dabs.
    const plain = createEngine({ stamp: false });
    expect(visibleToolOptions("brush", snapshotOf(plain)).map((option) => option.id)).not.toContain(
      BRUSH_TIP_OPTION_ID,
    );

    const stamped = createEngine({ stamp: true });
    expect(visibleToolOptions("brush", snapshotOf(stamped)).map((option) => option.id)).toContain(
      BRUSH_TIP_OPTION_ID,
    );
  });

  it("registers the control once, however often it is registered", () => {
    registerBrushTipOptions();
    registerBrushTipOptions();
    const engine = createEngine({ stamp: true });
    const ids = visibleToolOptions("brush", snapshotOf(engine)).map((option) => option.id);
    expect(ids.filter((id) => id === BRUSH_TIP_OPTION_ID)).toHaveLength(1);
  });
});

describe("the tip's preview", () => {
  it("is the tip's own mask", () => {
    expect(brushTipPreview("chisel")).toEqual({
      kind: "brushTip",
      tip: "chisel",
      label: "Chisel brush tip",
    });
    expect(brushTipPreview("round")?.tip).toBe("round");
  });

  it("is refused for a shape this build does not know", () => {
    expect(brushTipPreview("nib")).toBeNull();
    expect(optionPreviewFor(BRUSH_TIP_OPTION_ID, "nib")).toBeNull();
  });

  it("belongs to the tip's control alone", () => {
    expect(optionPreviewFor(BRUSH_TIP_OPTION_ID, "blot")?.kind).toBe("brushTip");
    expect(optionPreviewFor("someOtherOption", "blot")).toBeNull();
  });

  it("rides on the control the options bar draws", () => {
    const engine = createEngine({ stamp: true, tip: "chisel" });
    const actions = actionsFor(engine);
    const control = optionControl(brushTipOption, snapshotOf(engine), actions);
    expect(control.kind).toBe("select");
    expect(control.kind === "select" ? control.preview : undefined).toMatchObject({
      kind: "brushTip",
      tip: "chisel",
    });
  });

  it("is drawn beside the select", () => {
    const engine = createEngine({ stamp: true, tip: "chisel" });
    const actions = actionsFor(engine);
    const markup = renderToStaticMarkup(
      createElement(OptionControl, {
        option: brushTipOption,
        snapshot: snapshotOf(engine),
        actions,
      }),
    );
    expect(markup).toContain("<select");
    expect(markup).toContain("<canvas");
    expect(markup).toContain("Chisel brush tip");
    // The select still offers the five shapes, and the swatch sits beside it.
    for (const choice of BRUSH_TIP_CHOICES) {
      expect(markup).toContain(choice.label);
    }
  });
});

/* --------------------------------------------------------------- the renderer */

let recording: RecordingDocument;

beforeEach(() => {
  recording = installRecordingDocument();
});

afterEach(() => {
  recording.restore();
});

/** The brush the renderer tests draw with. */
const RENDER_BRUSH: BrushSettings = {
  ...DEFAULT_BRUSH,
  size: 12,
  hardness: 1,
  pressureSize: 0,
  pressureOpacity: 0,
  stamp: false,
  stampSpacing: 0.25,
  stampHardness: 1,
  tip: "round",
};

/** Draws one stroke and returns the stroke buffer's draw stream. */
function drawStroke(brush: BrushSettings): RecordingCanvas {
  const firstAllocation = recording.allocated.length;
  const display = new RecordingCanvas();
  const elements = new Map<LayerId, LayerElement[]>();
  const strokeSource: StrokeSource = {
    listStrokes: (layerId) => (elements.get(layerId) ?? []).filter(isStroke),
    listElements: (layerId) => elements.get(layerId) ?? [],
  };
  const renderer = new Canvas2DRenderer({
    canvas: display.asElement(),
    strokeSource,
    rasterScale: 1,
    scheduler: new FrameScheduler({ requestFrame: () => 1, cancelFrame: () => {} }),
  });

  const document = createDocument({ width: 100, height: 100 });
  renderer.setDocument(document);
  renderer.setDisplaySize(100, 100, 1);

  const stroke: StrokeRecord = {
    id: "stroke-1",
    layerId: document.layers[0].id,
    brush,
    erase: false,
    xs: [10, 40, 70],
    ys: [50, 50, 50],
    pressures: [1, 1, 1],
    times: [0, 16, 32],
    startTime: 0,
  };
  renderer.beginStroke(stroke);
  renderer.extendStroke(stroke, 0);

  // The first canvas the renderer allocates is its stroke buffer.
  return recording.allocated[firstAllocation];
}

/** The draw stream, as a string two runs can be compared by. */
function drawSummary(buffer: RecordingCanvas): string {
  return buffer.calls
    .map((call) => `${call.name}:${JSON.stringify(call.args)}`)
    .join("|");
}

/** The coverage the stroke buffer was given, as bytes. */
function coverageBytes(buffer: RecordingCanvas): number[] {
  const uploads = buffer.named("putImageData");
  if (uploads.length === 0) {
    return [];
  }
  const image = uploads[uploads.length - 1].args[0] as ImageData;
  return Array.from(image.data);
}

describe("the tip in the renderer", () => {
  it("leaves the plain segment stroke alone, whatever the tip is", () => {
    // A brush that does not stamp has no dabs to mask, so the tip cannot
    // reach the stroke at all.
    const chisel = drawStroke({ ...RENDER_BRUSH, tip: "chisel" });
    const round = drawStroke({ ...RENDER_BRUSH, tip: "round" });
    expect(drawSummary(chisel)).toBe(drawSummary(round));
    // The segment path uploads no pixels, so there is nothing a tip could
    // have changed.
    expect(chisel.named("putImageData")).toHaveLength(0);
  });

  it("reaches the dabs of a stamped stroke", () => {
    const chisel = drawStroke({ ...RENDER_BRUSH, stamp: true, tip: "chisel" });
    const round = drawStroke({ ...RENDER_BRUSH, stamp: true, tip: "round" });
    const chiselBytes = coverageBytes(chisel);
    const roundBytes = coverageBytes(round);
    expect(chiselBytes.length).toBeGreaterThan(0);
    expect(roundBytes.length).toBeGreaterThan(0);
    // The chisel nib takes ink away, so the coverage is not the same picture.
    expect(chiselBytes).not.toEqual(roundBytes);
  });
});
