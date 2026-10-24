/**
 * Reference images: the geometry, the engine seam and the gestures.
 *
 * The suite runs in plain Node. Decoding is the one browser capability the
 * import path needs, so the engine takes a decoder as an option and these tests
 * hand it a fake one: the bytes never have to be a real picture for the
 * placement, the history and the gestures to be asserted.
 *
 * What is covered here is the *workflow*: import, select, move, resize, rotate,
 * hide, remove, opacity, cancel, undo and redo - one coherent history step per
 * user action, and no step at all for a gesture that changed nothing.
 */

import { describe, expect, it, vi } from "vitest";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { parseProject } from "../core/project/projectFormat";
import type { DrawingRenderer } from "../core/rendering/types";
import { findToolByShortcut, TOOL_DEFINITIONS } from "../core/tools/toolDefinitions";
import { toolShowsBrushControls } from "../core/shell/toolOptions";
import { ReferenceDecodeError, type DecodedReference } from "../core/reference/decode";
import {
  MIN_REFERENCE_SIZE,
  applyReferencePatch,
  findReferenceHandle,
  normalizeReferenceRotation,
  referenceCorners,
  referenceEqual,
  referenceHandles,
  resizeReferenceFromCorner,
  rotatePointAbout,
} from "../core/reference/geometry";
import type { ReferenceImage } from "../core/reference/types";
import type { PointerSample } from "../types/pointer";

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function createSample(overrides: Partial<PointerSample> = {}): PointerSample {
  return {
    phase: "move",
    pointerId: 1,
    kind: "mouse",
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

function reference(overrides: Partial<ReferenceImage> = {}): ReferenceImage {
  return {
    id: "reference-1",
    name: "sketch.png",
    x: 100,
    y: 50,
    width: 200,
    height: 100,
    naturalWidth: 400,
    naturalHeight: 200,
    rotation: 0,
    opacity: 1,
    blendMode: "normal",
    behind: false,
    visible: true,
    ...overrides,
  };
}

/** A decoder that answers with a fixed picture and remembers the bytes. */
function fakeDecoder(width = 400, height = 200) {
  const calls: Uint8Array[] = [];
  const decode = vi.fn(async (bytes: Uint8Array): Promise<DecodedReference> => {
    calls.push(bytes);
    return { width, height, source: {} as unknown as CanvasImageSource };
  });
  return { decode, calls };
}

function createEngine(
  options: {
    readonly width?: number;
    readonly height?: number;
    readonly decodeReference?: (bytes: Uint8Array) => Promise<DecodedReference>;
  } = {},
) {
  const decode = options.decodeReference ?? fakeDecoder().decode;
  const engine = new DrawingEngine({
    document: createDocument({
      name: "References",
      width: options.width ?? 800,
      height: options.height ?? 600,
    }),
    decodeReference: decode,
  });
  return engine;
}

/** An engine with one imported 400x200 reference centred on an 800x600 paper. */
async function engineWithReference() {
  const engine = createEngine();
  const result = await engine.importReference({ name: "sketch.png", bytes: PNG_SIGNATURE });
  if (!result.ok) {
    throw new Error(`the fixture import failed: ${result.message}`);
  }
  return { engine, id: result.reference.id };
}

/**
 * A renderer that only records the decoded pictures the engine hands it.
 *
 * The save/reopen test needs to know *when* a picture has decoded, and the
 * engine's cache is deliberately private: what the renderer is given is the
 * observable seam.
 */
function recordingRenderer() {
  const sourceMaps: ReadonlyMap<string, CanvasImageSource>[] = [];
  const renderer: DrawingRenderer = {
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
    setReferenceSources: (sources) => {
      sourceMaps.push(new Map(sources));
    },
    setSelectedReference: () => {},
    composeDocumentImage: () => {
      throw new Error("composeDocumentImage is not used in these tests.");
    },
    readCompositePixel: () => null,
    readCompositeImage: () => null,
    render: () => {},
    requestRender: () => {},
    destroy: () => {},
  };
  return { renderer, sourceMaps };
}

describe("the reference geometry", () => {
  it("turns a point about a centre, clockwise on screen", () => {
    // The document's y axis points down, so +90 degrees takes the top point to
    // the right: that is clockwise as the user sees it.
    const turned = rotatePointAbout({ x: 0, y: -10 }, { x: 0, y: 0 }, 90);
    expect(turned.x).toBeCloseTo(10, 9);
    expect(turned.y).toBeCloseTo(0, 9);
  });

  it("wraps an angle into one turn", () => {
    expect(normalizeReferenceRotation(0)).toBe(0);
    expect(normalizeReferenceRotation(90)).toBe(90);
    expect(normalizeReferenceRotation(360)).toBe(0);
    expect(normalizeReferenceRotation(-90)).toBe(270);
    expect(normalizeReferenceRotation(450)).toBe(90);
    expect(normalizeReferenceRotation(Number.NaN)).toBe(0);
  });

  it("keeps the corners and the centre fixed while it turns", () => {
    const upright = reference();
    const turned = reference({ rotation: 90 });
    const centre = { x: 200, y: 100 };

    const before = referenceCorners(upright);
    const after = referenceCorners(turned);
    // Every corner keeps its distance from the centre; only its direction
    // changes. That is what "rotation about the centre" means.
    for (let index = 0; index < before.length; index += 1) {
      const a = before[index];
      const b = after[index];
      expect(Math.hypot(a.x - centre.x, a.y - centre.y)).toBeCloseTo(
        Math.hypot(b.x - centre.x, b.y - centre.y),
        9,
      );
    }
    // A quarter turn swaps the rectangle's own width and height on screen.
    expect(Math.max(...after.map((p) => p.x)) - Math.min(...after.map((p) => p.x))).toBeCloseTo(
      100,
      9,
    );
    expect(Math.max(...after.map((p) => p.y)) - Math.min(...after.map((p) => p.y))).toBeCloseTo(
      200,
      9,
    );
  });

  it("puts the rotation handle beyond the top edge, and carries it with the picture", () => {
    const upright = referenceHandles(reference(), { zoom: 1, offsetX: 0, offsetY: 0 });
    // Top edge midpoint is (200, 50); the handle sits 26 CSS px above it.
    expect(upright.rotation).toEqual({ x: 200, y: 24 });

    const turned = referenceHandles(
      reference({ rotation: 90 }),
      { zoom: 1, offsetX: 0, offsetY: 0 },
    );
    // The top edge has turned to the right side: its midpoint is (250, 100)
    // and the outward normal points right, so the handle is at 250 + 26.
    expect(turned.rotation.x).toBeCloseTo(276, 9);
    expect(turned.rotation.y).toBeCloseTo(100, 9);
  });

  it("keeps the handle's grab radius in screen pixels at every zoom", () => {
    const atOne = reference({ rotation: 0 });
    // At 100 % the north-west corner is (100, 50).
    expect(findReferenceHandle(atOne, { zoom: 1, offsetX: 0, offsetY: 0 }, 100, 50)).toBe("nw");
    // At 4x the same corner is still a 8-CSS-px grab, i.e. 2 document px.
    expect(findReferenceHandle(atOne, { zoom: 4, offsetX: 0, offsetY: 0 }, 102, 50)).toBe("nw");
    expect(findReferenceHandle(atOne, { zoom: 4, offsetX: 0, offsetY: 0 }, 106, 50)).toBeNull();
  });

  it("resizes from a corner, keeping the opposite corner and the aspect ratio", () => {
    const resized = resizeReferenceFromCorner(reference(), "se", 500, 250);
    // The north-west corner is the anchor: it does not move.
    expect(resized.x).toBe(100);
    expect(resized.y).toBe(50);
    // The pointer was 400 px right of the anchor and 200 px below it: exactly
    // the original 2:1 ratio, so the picture simply follows.
    expect(resized.width).toBeCloseTo(400, 9);
    expect(resized.height).toBeCloseTo(200, 9);
  });

  it("derives the other side from the aspect ratio when the drag is not diagonal", () => {
    // A wide drag: the width wins and the height follows, so the picture never
    // distorts.
    const resized = resizeReferenceFromCorner(reference(), "se", 500, 120);
    expect(resized.width).toBeCloseTo(400, 9);
    expect(resized.height).toBeCloseTo(200, 9);
    expect(resized.width / resized.height).toBeCloseTo(2, 9);
  });

  it("resizes along the picture's own edges when it is turned", () => {
    const turned = reference({ rotation: 90 });
    // A quarter turn puts the south-east corner at (150, 200). Dragging it to
    // (50, 400) extends the picture along its *own* width and height, which now
    // point down and left on screen.
    const resized = resizeReferenceFromCorner(turned, "se", 50, 400);
    expect(resized.rotation).toBe(90);
    // The anchor (north-west, now top-right at (250, 0)) stays put.
    const anchorBefore = referenceCorners(turned)[0];
    const anchorAfter = referenceCorners(resized)[0];
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 9);
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 9);
    expect(resized.width).toBeCloseTo(400, 9);
    expect(resized.height).toBeCloseTo(200, 9);
  });

  it("never shrinks a reference below the grab size", () => {
    const resized = resizeReferenceFromCorner(reference(), "se", 100.5, 50.5);
    expect(Math.max(resized.width, resized.height)).toBeGreaterThanOrEqual(MIN_REFERENCE_SIZE);
  });

  it("clamps a patch, so a slider and a gesture agree", () => {
    const patched = applyReferencePatch(reference(), { opacity: 4, rotation: -30, width: 1 });
    expect(patched.opacity).toBe(1);
    expect(patched.rotation).toBe(330);
    expect(patched.width).toBe(MIN_REFERENCE_SIZE);
  });

  it("tells two references apart only when something that draws changed", () => {
    expect(referenceEqual(reference(), reference())).toBe(true);
    expect(referenceEqual(reference(), reference({ rotation: 1 }))).toBe(false);
    expect(referenceEqual(reference(), reference({ opacity: 0.5 }))).toBe(false);
    expect(referenceEqual(reference(), reference({ behind: true }))).toBe(false);
  });
});

describe("importing a reference", () => {
  it("adds it to the document, centred, as one history step", async () => {
    const engine = createEngine();
    const result = await engine.importReference({ name: "sketch.png", bytes: PNG_SIGNATURE });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const state = engine.getState();
    expect(state.document.references).toHaveLength(1);
    const [added] = state.document.references;
    // 400x200 on an 800x600 paper: centred at its natural size.
    expect(added).toMatchObject({ x: 200, y: 200, width: 400, height: 200 });
    // The file's own bytes travel with the document, so a project reopens the
    // same picture without the original file.
    expect(added.source?.mimeType).toBe("image/png");
    expect(added.source?.base64.length).toBeGreaterThan(0);
    // The import selects what it added and is one undoable step.
    expect(state.selectedReferenceId).toBe(added.id);
    expect(state.history.depth).toBe(1);
    expect(state.history.undoLabel).toBe("Add Reference");
    expect(state.file.dirty).toBe(true);
  });

  it("fits a picture that is larger than the paper", async () => {
    const engine = createEngine({
      width: 400,
      height: 300,
      decodeReference: fakeDecoder(4000, 2000).decode,
    });
    const result = await engine.importReference({ name: "big.png", bytes: PNG_SIGNATURE });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.reference.width).toBeLessThanOrEqual(400 - 48);
    expect(result.reference.width / result.reference.height).toBeCloseTo(2, 6);
    // Centred on the paper.
    expect(result.reference.x + result.reference.width / 2).toBeCloseTo(200, 6);
    expect(result.reference.y + result.reference.height / 2).toBeCloseTo(150, 6);
  });

  it("refuses a file the decoder rejects, without touching the document", async () => {
    const decode = vi.fn(async () => {
      throw new ReferenceDecodeError("not-an-image", "That file is not an image.");
    });
    const engine = createEngine({ decodeReference: decode });

    const result = await engine.importReference({ name: "notes.txt", bytes: new Uint8Array([1]) });

    expect(result).toEqual({
      ok: false,
      reason: "not-an-image",
      message: "That file is not an image.",
    });
    const state = engine.getState();
    expect(state.document.references).toHaveLength(0);
    expect(state.history.depth).toBe(0);
    expect(state.file.dirty).toBe(false);
  });

  it("is undoable and redoable, picture and all", async () => {
    const { engine, id } = await engineWithReference();

    expect(engine.undo()).toBe(true);
    expect(engine.getState().document.references).toHaveLength(0);
    expect(engine.getState().selectedReferenceId).toBeNull();

    expect(engine.redo()).toBe(true);
    expect(engine.getState().document.references.map((item) => item.id)).toEqual([id]);
  });

  it("is dropped, picture and all, when a new document replaces the drawing", async () => {
    const { engine, id } = await engineWithReference();

    engine.newDocument({ name: "Fresh", width: 400, height: 300 });

    expect(engine.references()).toEqual([]);
    expect(engine.findReference(id)).toBeNull();
    expect(engine.getState().selectedReferenceId).toBeNull();
    expect(engine.getState().history.depth).toBe(0);

    // The new document accepts its own references, centred on its own paper.
    const next = await engine.importReference({ name: "next.png", bytes: PNG_SIGNATURE });
    expect(next.ok).toBe(true);
    if (!next.ok) {
      return;
    }
    expect(next.reference.id).not.toBe(id);
    expect(next.reference.x).toBe((400 - next.reference.width) / 2);
  });
});

describe("selecting a reference", () => {
  it("hits the top-most visible reference under the point", async () => {
    const { engine, id } = await engineWithReference();
    // Centre of the 400x200 picture at (200,200)-(600,400).
    expect(engine.findReferenceAt(400, 300)?.id).toBe(id);
    expect(engine.findReferenceAt(10, 10)).toBeNull();

    // A hidden reference is not on the canvas, so it cannot be hit.
    engine.setReferenceVisible(id, false);
    expect(engine.findReferenceAt(400, 300)).toBeNull();
  });

  it("is editor state: switching tools drops the frame", async () => {
    const { engine, id } = await engineWithReference();
    engine.setTool("reference");
    expect(engine.getState().selectedReferenceId).toBe(id);

    engine.setTool("brush");
    expect(engine.getState().selectedReferenceId).toBeNull();
  });

  it("does not steal a press while the brush is active", async () => {
    const { engine } = await engineWithReference();
    engine.setTool("brush");

    // A press over the picture is a paint stroke, not a reference grab.
    engine.handlePointerSample(createSample({ phase: "down", docX: 300, docY: 300 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 320, docY: 310 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 320, docY: 310 }));

    const state = engine.getState();
    expect(state.selectedReferenceId).toBeNull();
    const layerId = state.document.activeLayerId as string;
    expect(engine.listStrokes(layerId)).toHaveLength(1);
  });
});

describe("manipulating a reference", () => {
  it("moves it with one drag and one history step", async () => {
    const { engine, id } = await engineWithReference();
    engine.setTool("reference");
    const depth = engine.getState().history.depth;

    engine.beginReferenceGesture(createSample({ docX: 300, docY: 300 }), null);
    engine.updateReferenceGesture(createSample({ docX: 340, docY: 320 }));
    engine.finishReferenceGesture();

    const moved = engine.findReference(id);
    expect(moved).toMatchObject({ x: 240, y: 220 });
    expect(engine.getState().history.depth).toBe(depth + 1);
    expect(engine.getState().history.undoLabel).toBe("Move Reference");

    engine.undo();
    expect(engine.findReference(id)).toMatchObject({ x: 200, y: 200 });
    engine.redo();
    expect(engine.findReference(id)).toMatchObject({ x: 240, y: 220 });
  });

  it("resizes from a corner, preserving the aspect ratio", async () => {
    const { engine, id } = await engineWithReference();
    engine.setTool("reference");

    const handle = engine.findReferenceHandleAt(600, 400);
    expect(handle).toBe("se");

    engine.beginReferenceGesture(createSample({ docX: 600, docY: 400 }), handle);
    engine.updateReferenceGesture(createSample({ docX: 700, docY: 450 }));
    engine.finishReferenceGesture();

    const resized = engine.findReference(id);
    expect(resized).toMatchObject({ x: 200, y: 200, width: 500, height: 250 });
    expect(engine.getState().history.undoLabel).toBe("Resize Reference");
  });

  it("turns it from the rotation handle", async () => {
    const { engine, id } = await engineWithReference();
    engine.setTool("reference");

    // Upright, 100 %: the rotation handle is 26 px above the top edge's middle.
    expect(engine.findReferenceHandleAt(400, 174)).toBe("rotate");

    engine.beginReferenceGesture(createSample({ docX: 400, docY: 174 }), "rotate");
    engine.updateReferenceGesture(createSample({ docX: 526, docY: 300 }));
    engine.finishReferenceGesture();

    const turned = engine.findReference(id);
    expect(turned?.rotation).toBeCloseTo(90, 6);
    // A rotation moves nothing else.
    expect(turned).toMatchObject({ x: 200, y: 200, width: 400, height: 200 });
    expect(engine.getState().history.undoLabel).toBe("Rotate Reference");
  });

  it("commits nothing for a drag that changed nothing", async () => {
    const { engine, id } = await engineWithReference();
    engine.setTool("reference");
    const depth = engine.getState().history.depth;

    engine.beginReferenceGesture(createSample({ docX: 300, docY: 300 }), null);
    engine.finishReferenceGesture();

    expect(engine.findReference(id)).toMatchObject({ x: 200, y: 200 });
    expect(engine.getState().history.depth).toBe(depth);
  });

  it("cancels a drag, restoring the press-time document and no history", async () => {
    const { engine, id } = await engineWithReference();
    engine.setTool("reference");
    const depth = engine.getState().history.depth;

    engine.beginReferenceGesture(createSample({ docX: 300, docY: 300 }), null);
    engine.updateReferenceGesture(createSample({ docX: 400, docY: 360 }));
    expect(engine.findReference(id)).toMatchObject({ x: 300, y: 260 });

    engine.cancelReferenceGesture();

    expect(engine.findReference(id)).toMatchObject({ x: 200, y: 200 });
    expect(engine.getState().history.depth).toBe(depth);
    expect(engine.getState().selectedReferenceId).toBeNull();
  });

  it("cancels through the pointer lifecycle as well", async () => {
    const { engine, id } = await engineWithReference();
    engine.setTool("reference");
    const depth = engine.getState().history.depth;

    engine.handlePointerSample(createSample({ phase: "down", docX: 300, docY: 300 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 350, docY: 330 }));
    engine.handlePointerSample(createSample({ phase: "cancel", docX: 350, docY: 330 }));

    expect(engine.findReference(id)).toMatchObject({ x: 200, y: 200 });
    expect(engine.getState().history.depth).toBe(depth);
  });

  it("hides, shows, removes and renames it, each as one step", async () => {
    const { engine, id } = await engineWithReference();
    const depth = engine.getState().history.depth;

    engine.setReferenceVisible(id, false);
    expect(engine.findReference(id)?.visible).toBe(false);
    expect(engine.getState().history.depth).toBe(depth + 1);

    engine.setReferenceVisible(id, true);
    expect(engine.findReference(id)?.visible).toBe(true);

    engine.renameReference(id, "  pose  ");
    expect(engine.findReference(id)?.name).toBe("pose");

    engine.removeReference(id);
    expect(engine.findReference(id)).toBeNull();
    expect(engine.getState().selectedReferenceId).toBeNull();

    engine.undo();
    expect(engine.findReference(id)?.name).toBe("pose");
    engine.undo();
    expect(engine.findReference(id)?.name).toBe("sketch.png");
  });

  it("puts it behind the artwork", async () => {
    const { engine, id } = await engineWithReference();
    engine.setReferenceBehind(id, true);
    expect(engine.findReference(id)?.behind).toBe(true);
    engine.undo();
    expect(engine.findReference(id)?.behind).toBe(false);
  });

  it("offers no handle while the selected reference is hidden", async () => {
    const { engine, id } = await engineWithReference();
    // The fixture's top-left corner, where a handle is grabbable when shown.
    const corner = { x: 200, y: 200 };
    expect(engine.findReferenceHandleAt(corner.x, corner.y)).not.toBeNull();

    engine.setReferenceVisible(id, false);

    // The frame and the hit-test agree: a hidden reference has no chrome, so a
    // press cannot grab a handle the user cannot see.
    expect(engine.findReferenceHandleAt(corner.x, corner.y)).toBeNull();
  });

  it("coalesces a slider run into one step", async () => {
    const { engine, id } = await engineWithReference();
    const depth = engine.getState().history.depth;

    engine.setReferenceOpacity(id, 0.8);
    engine.setReferenceOpacity(id, 0.6);
    engine.setReferenceOpacity(id, 0.4);

    expect(engine.findReference(id)?.opacity).toBe(0.4);
    expect(engine.getState().history.depth).toBe(depth + 1);

    engine.undo();
    expect(engine.findReference(id)?.opacity).toBe(1);
  });

  it("starts two separate edits of the same reference as two steps", async () => {
    const { engine, id } = await engineWithReference();
    const depth = engine.getState().history.depth;

    engine.setReferenceOpacity(id, 0.5);
    // Selecting breaks the merge run, so the next slider drag is its own step.
    engine.selectReference(id);
    engine.setReferenceOpacity(id, 0.2);

    expect(engine.getState().history.depth).toBe(depth + 2);
  });

  it("does nothing for a patch that changes nothing", async () => {
    const { engine, id } = await engineWithReference();
    const depth = engine.getState().history.depth;
    expect(engine.setReferenceOpacity(id, 1)).toBe(false);
    expect(engine.getState().history.depth).toBe(depth);
  });
});

describe("the reference tool", () => {
  it("is registered with its own shortcut and shows no brush controls", () => {
    expect(TOOL_DEFINITIONS.some((definition) => definition.id === "reference")).toBe(true);
    expect(findToolByShortcut("Y")?.id).toBe("reference");
    expect(toolShowsBrushControls("reference")).toBe(false);
  });

  it("takes the press, moves and releases through the engine", async () => {
    const { engine, id } = await engineWithReference();
    engine.setTool("reference");

    engine.handlePointerSample(createSample({ phase: "down", docX: 300, docY: 300 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 330, docY: 310 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 330, docY: 310 }));

    expect(engine.findReference(id)).toMatchObject({ x: 230, y: 210 });
    expect(engine.getState().history.depth).toBe(2);
  });

  it("clears the selection on a press on empty canvas", async () => {
    const { engine } = await engineWithReference();
    engine.setTool("reference");
    expect(engine.getState().selectedReferenceId).not.toBeNull();

    engine.handlePointerSample(createSample({ phase: "down", docX: 10, docY: 10 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 10, docY: 10 }));

    expect(engine.getState().selectedReferenceId).toBeNull();
  });
});

describe("saving and reopening", () => {
  it("brings the reference, its placement and its picture back from the file", async () => {
    const { engine, id } = await engineWithReference();
    engine.setReferenceRotation(id, 45);
    engine.setReferenceOpacity(id, 0.6);

    const parsed = parseProject(engine.serialize());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const { renderer, sourceMaps } = recordingRenderer();
    const decoder = fakeDecoder(400, 200);
    const reopened = new DrawingEngine({ renderer, decodeReference: decoder.decode });
    reopened.loadProject(parsed.project, "C:/drawings/references.paka");

    expect(reopened.findReference(id)).toMatchObject({
      name: "sketch.png",
      x: 200,
      y: 200,
      width: 400,
      height: 200,
      rotation: 45,
      opacity: 0.6,
    });
    // The picture is decoded from the bytes in the project, not from the
    // original file: the file on disk is never consulted on reopen.
    expect(decoder.calls).toHaveLength(1);
    expect(Array.from(decoder.calls[0] ?? [])).toEqual(Array.from(PNG_SIGNATURE));

    // Decoding is asynchronous, so the renderer is handed the picture once it
    // is ready. Until then the reference exists but is simply not painted.
    await vi.waitFor(() => {
      expect(sourceMaps[sourceMaps.length - 1]?.has(id)).toBe(true);
    });

    // The reopened project saves back to the very same reference.
    const resaved = parseProject(reopened.serialize());
    expect(resaved.ok).toBe(true);
    if (!resaved.ok) {
      return;
    }
    expect(resaved.project.document.references).toHaveLength(1);
    expect(resaved.project.document.references[0]?.rotation).toBe(45);
  });

  it("opens a version-13 project with no references at all", () => {
    const { renderer } = recordingRenderer();
    // A document written by the previous build: the same payload without the
    // reference list, and version 13.
    const legacy = JSON.parse(createEngine().serialize()) as {
      version: number;
      document: Record<string, unknown>;
    };
    legacy.version = 13;
    delete legacy.document.references;

    const parsed = parseProject(JSON.stringify(legacy));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const engine = new DrawingEngine({ renderer, decodeReference: fakeDecoder().decode });
    engine.loadProject(parsed.project, null);
    expect(engine.getState().document.references).toEqual([]);
    expect(engine.findReferenceAt(400, 300)).toBeNull();
  });
});
