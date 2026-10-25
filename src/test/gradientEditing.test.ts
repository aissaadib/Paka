/**
 * Gradient editing: the handles, the command, and the file.
 *
 * A gradient is geometry plus stops, so editing it is a matter of moving
 * points: the two end points of its axis and the middle stops along it. These
 * tests pin the rules that make that editing safe:
 *
 *  - the handles sit on the gradient's own points, and only the nearest one
 *    within the grab radius is grabbed;
 *  - moving a handle changes the geometry or the ramp and nothing else: the
 *    colours, the opacity and the rest of the ramp stay where they were;
 *  - a ramp stays **strictly ascending**, because that is what the file
 *    format requires - a model that produced anything else would write a file
 *    the reader refuses;
 *  - an edit is **one** history step, and undo puts the very same record
 *    back;
 *  - the picture a reopened file describes is exactly the picture the edited
 *    gradient drew: the same geometry, the same stops, the same alpha, in the
 *    layer and in the export.
 *
 * The suite runs in plain Node, so Canvas 2D is faked with the recording
 * canvas, exactly as the renderer suite does.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createGradientEditCommand,
  type GradientEditHost,
} from "../core/commands/gradientEditCommand";
import { createDocument } from "../core/document/document";
import type { GradientRecord, LayerElement } from "../core/document/types";
import { isGradient, isStroke } from "../core/document/types";
import {
  GRADIENT_HANDLE_CURSORS,
  findGradientHandle,
  gradientGeometryEqual,
  gradientGeometryHit,
  gradientHandles,
  moveGradientHandle,
  type GradientHandleId,
} from "../core/gradient/gradientHandles";
import {
  gradientMiddleStops,
  gradientRecordEqual,
  gradientRecordProblem,
  isValidGradientRecord,
} from "../core/gradient/gradientRecord";
import { parseProject, serializeProject } from "../core/project/projectFormat";
import { Canvas2DRenderer } from "../core/rendering/Canvas2DRenderer";
import { FrameScheduler } from "../core/rendering/frameScheduler";
import type { StrokeSource } from "../core/rendering/types";
import {
  installRecordingDocument,
  RecordingCanvas,
  type RecordingDocument,
} from "./support/recordingCanvas";

/** A linear gradient with two middle stops on a horizontal axis. */
function createGradient(overrides: Partial<GradientRecord> = {}): GradientRecord {
  return {
    id: "gradient-1",
    layerId: "layer-a",
    kind: "gradient",
    type: "linear",
    x1: 10,
    y1: 20,
    x2: 90,
    y2: 20,
    stops: [
      { offset: 0, color: "#112233" },
      { offset: 0.25, color: "#ff0000" },
      { offset: 0.75, color: "#00ff00" },
      { offset: 1, color: "#ddeeff" },
    ],
    opacity: 1,
    ...overrides,
  };
}

function createHost() {
  const elements: LayerElement[] = [];
  const refreshed: string[] = [];
  const host: GradientEditHost = {
    replace(element) {
      const index = elements.findIndex((entry) => entry.id === element.id);
      if (index === -1) {
        elements.push(element);
        return;
      }
      elements[index] = element;
    },
    refresh(layerId) {
      refreshed.push(layerId);
    },
  };
  return { host, elements, refreshed };
}

function storeOf(entries: ReadonlyArray<readonly [string, LayerElement[]]>): StrokeSource {
  const map = new Map(entries);
  return {
    listStrokes: (layerId) => (map.get(layerId) ?? []).filter(isStroke),
    listElements: (layerId) => map.get(layerId) ?? [],
  };
}

// ---------------------------------------------------------------- pure geometry

describe("gradient handles", () => {
  it("puts the end handles on the gradient's own points", () => {
    const handles = gradientHandles(createGradient());
    expect(handles.start).toEqual({ x: 10, y: 20 });
    expect(handles.end).toEqual({ x: 90, y: 20 });
  });

  it("puts a middle stop's handle on the axis at its own offset", () => {
    const handles = gradientHandles(createGradient());
    expect(handles.stops).toHaveLength(2);
    // The axis runs from x=10 to x=90, so 0.25 of it is x=30 and 0.75 is x=70.
    expect(handles.stops[0]).toEqual({ x: 30, y: 20 });
    expect(handles.stops[1]).toEqual({ x: 70, y: 20 });
  });

  it("gives a two-stop gradient no stop handles", () => {
    const handles = gradientHandles(
      createGradient({
        stops: [
          { offset: 0, color: "#112233" },
          { offset: 1, color: "#ddeeff" },
        ],
      }),
    );
    expect(handles.stops).toEqual([]);
  });

  it("grabs the nearest handle within the radius and none outside it", () => {
    const handles = gradientHandles(createGradient());
    expect(findGradientHandle(handles, 11, 21, 5)).toBe("start");
    expect(findGradientHandle(handles, 89, 21, 5)).toBe("end");
    expect(findGradientHandle(handles, 50, 60, 5)).toBeNull();
  });

  it("grabs a middle stop's handle", () => {
    const handles = gradientHandles(createGradient());
    expect(findGradientHandle(handles, 30, 22, 5)).toBe("stop:1");
    expect(findGradientHandle(handles, 70, 18, 5)).toBe("stop:2");
  });

  it("moves only the handle that was grabbed", () => {
    const gradient = createGradient();
    const moved = moveGradientHandle(gradient, "start", 0, 40);
    expect(moved).toMatchObject({ x1: 0, y1: 40, x2: 90, y2: 20 });
    // The ramp's offsets are untouched: only the geometry moves.
    expect(moved.stops).toEqual(gradient.stops);
    expect(moved.opacity).toBe(gradient.opacity);
    // A move that changes nothing returns the same record.
    expect(moveGradientHandle(gradient, "start", 10, 20)).toBe(gradient);
    expect(moveGradientHandle(gradient, "end", 90, 20)).toBe(gradient);
  });

  it("slides a middle stop along the axis", () => {
    const moved = moveGradientHandle(createGradient(), "stop:1", 50, 20);
    // The pointer is half way along the axis, so the stop is at 0.5.
    expect(moved.stops[1]).toEqual({ offset: 0.5, color: "#ff0000" });
    // Nothing else about the ramp or the geometry moves.
    expect(moved.stops[0]).toEqual({ offset: 0, color: "#112233" });
    expect(moved.stops[2]).toEqual({ offset: 0.75, color: "#00ff00" });
    expect(moved.x1).toBe(10);
    expect(moved.x2).toBe(90);
  });

  it("holds a middle stop between its neighbours", () => {
    // The stop at 0.25 is dragged onto the stop at 0.75 and stops just short of
    // it: the ramp's offsets have to stay strictly ascending.
    const moved = moveGradientHandle(createGradient(), "stop:1", 70, 20);
    expect(moved.stops[1].offset).toBeLessThan(0.75);
    expect(moved.stops[1].offset).toBeGreaterThan(0.5);
    expect(moved.stops[1].color).toBe("#ff0000");
  });

  it("refuses a stop that has no room between its neighbours", () => {
    const crowded = createGradient({
      stops: [
        { offset: 0, color: "#112233" },
        { offset: 0.5 - 1e-9, color: "#ff0000" },
        { offset: 0.5, color: "#00ff00" },
        { offset: 0.5 + 1e-9, color: "#00ffff" },
        { offset: 1, color: "#ddeeff" },
      ],
    });
    // The stop in the middle of the crowd has no offset left that would keep
    // the ramp ascending, so the move is refused rather than repaired into
    // something else.
    expect(moveGradientHandle(crowded, "stop:2", 50, 20)).toBe(crowded);
  });

  it("keeps a radial radius handle off the centre", () => {
    const radial = createGradient({
      type: "radial",
      x1: 10,
      y1: 10,
      x2: 20,
      y2: 10,
      stops: [
        { offset: 0, color: "#112233" },
        { offset: 1, color: "#ddeeff" },
      ],
    });
    const moved = moveGradientHandle(radial, "end", 10, 10);
    // The pointer is on the centre: the radius keeps its direction and its
    // minimum length, so the gradient still draws something.
    expect(Math.hypot(moved.x2 - moved.x1, moved.y2 - moved.y1)).toBeGreaterThan(0);
    expect(moved.y2).toBeCloseTo(moved.y1, 6);
  });

  it("hits the axis of a linear gradient and the circle of a radial one", () => {
    const linear = createGradient();
    expect(gradientGeometryHit(linear, 50, 20, 2)).toBe(true);
    expect(gradientGeometryHit(linear, 50, 50, 2)).toBe(false);

    const radial = createGradient({
      type: "radial",
      x1: 10,
      y1: 10,
      x2: 90,
      y2: 10,
      stops: [
        { offset: 0, color: "#112233" },
        { offset: 1, color: "#ddeeff" },
      ],
    });
    // The circle of radius 80 around the centre.
    expect(gradientGeometryHit(radial, 90, 10, 2)).toBe(true);
    expect(gradientGeometryHit(radial, 50, 10, 2)).toBe(false);
    // The centre is an end handle of its own, so it is a target too.
    expect(gradientGeometryHit(radial, 10, 10, 2)).toBe(true);
  });

  it("compares two gradients by their geometry alone", () => {
    const gradient = createGradient();
    expect(gradientGeometryEqual(gradient, createGradient())).toBe(true);
    expect(
      gradientGeometryEqual(
        gradient,
        createGradient({ stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }] }),
      ),
    ).toBe(true);
    expect(gradientGeometryEqual(gradient, createGradient({ x2: 91 }))).toBe(false);
  });

  it("gives each kind of handle a cursor of its own", () => {
    expect(GRADIENT_HANDLE_CURSORS.point.length).toBeGreaterThan(0);
    expect(GRADIENT_HANDLE_CURSORS.stop.length).toBeGreaterThan(0);
    expect(GRADIENT_HANDLE_CURSORS.point).not.toBe(GRADIENT_HANDLE_CURSORS.stop);
  });
});

// --------------------------------------------------------------------- the model

describe("the gradient record", () => {
  it("reads the middle stops out of the ramp", () => {
    expect(gradientMiddleStops(createGradient())).toEqual([
      { offset: 0.25, color: "#ff0000" },
      { offset: 0.75, color: "#00ff00" },
    ]);
    expect(
      gradientMiddleStops(
        createGradient({
          stops: [
            { offset: 0, color: "#112233" },
            { offset: 1, color: "#ddeeff" },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("compares two gradients by everything they carry", () => {
    const gradient = createGradient();
    expect(gradientRecordEqual(gradient, createGradient())).toBe(true);
    expect(gradientRecordEqual(gradient, createGradient({ type: "radial" }))).toBe(false);
    expect(gradientRecordEqual(gradient, createGradient({ x2: 91 }))).toBe(false);
    expect(gradientRecordEqual(gradient, createGradient({ opacity: 0.5 }))).toBe(false);
    expect(
      gradientRecordEqual(
        gradient,
        createGradient({
          stops: [
            { offset: 0, color: "#112233" },
            { offset: 0.3, color: "#ff0000" },
            { offset: 0.75, color: "#00ff00" },
            { offset: 1, color: "#ddeeff" },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("rejects a gradient the file could not read instead of repairing it", () => {
    expect(
      gradientRecordProblem(
        createGradient({
          stops: [],
        }),
      ),
    ).toMatch(/at least two/);
    expect(
      gradientRecordProblem(
        createGradient({
          stops: [
            { offset: 0, color: "#112233" },
            { offset: 1.5, color: "#ddeeff" },
          ],
        }),
      ),
    ).toMatch(/inside the ramp/);
    expect(
      gradientRecordProblem(
        createGradient({
          stops: [
            { offset: 0.5, color: "#112233" },
            { offset: 0.5, color: "#ddeeff" },
          ],
        }),
      ),
    ).toMatch(/strictly ascending/);
    expect(
      gradientRecordProblem(
        createGradient({
          stops: [
            { offset: 0, color: "not-a-colour" },
            { offset: 1, color: "#ddeeff" },
          ],
        }),
      ),
    ).toMatch(/hex colour/);
    expect(isValidGradientRecord(createGradient())).toBe(true);
    expect(isValidGradientRecord(createGradient({ opacity: 2 }))).toBe(false);
  });
});

// ------------------------------------------------------------------- the command

describe("createGradientEditCommand", () => {
  it("swaps the record on apply and puts the original back on revert", () => {
    const { host, elements, refreshed } = createHost();
    const original = createGradient();
    const next = moveGradientHandle(original, "end", 60, 60);
    elements.push(original);

    const command = createGradientEditCommand(original, next, host);
    command.apply();
    expect(elements[0]).toBe(next);
    expect(refreshed).toEqual(["layer-a"]);

    command.revert();
    expect(elements[0]).toBe(original);
    expect(refreshed).toEqual(["layer-a", "layer-a"]);
  });

  it("carries the very record the editor previewed", () => {
    const { host } = createHost();
    const original = createGradient();
    const previewed = moveGradientHandle(original, "stop:1", 50, 20);
    const command = createGradientEditCommand(original, previewed, host);
    // The preview and the committed record are the same object, so the picture
    // the user watched is the picture the history step restores.
    expect(command.next).toBe(previewed);
    expect(command.original).toBe(original);
  });

  it("merges a run of edits into one step that spans the whole run", () => {
    const { host, elements } = createHost();
    const original = createGradient();
    elements.push(original);

    const first = createGradientEditCommand(
      original,
      moveGradientHandle(original, "stop:1", 40, 20),
      host,
      "run",
    );
    const second = createGradientEditCommand(
      moveGradientHandle(original, "stop:1", 40, 20),
      moveGradientHandle(original, "stop:1", 50, 20),
      host,
      "run",
    );
    const merged = first.mergeWith?.(second);
    expect(merged).toBeDefined();

    merged?.apply();
    const mergedRecord = elements[0] as GradientRecord;
    expect(mergedRecord.stops[1].offset).toBe(0.5);
    merged?.revert();
    // The merged step goes back to where the run started.
    expect(elements[0]).toBe(original);
  });

  it("refuses a record the file could not read", () => {
    const { host } = createHost();
    const broken = createGradient({
      stops: [
        { offset: 0, color: "#112233" },
        { offset: 1.5, color: "#ddeeff" },
      ],
    });
    expect(() => createGradientEditCommand(createGradient(), broken, host)).toThrow(
      /inside the ramp/,
    );
  });
});

// ---------------------------------------------------------------------- the file

describe("an edited gradient in the project file", () => {
  it("keeps the edited gradient through a save and reopen", () => {
    const document = createDocument({ name: "Test", width: 100, height: 80 });
    const layerId = document.layers[0].id;
    const edited = moveGradientHandle(createGradient({ layerId }), "stop:1", 50, 20);

    const text = serializeProject(document, storeOf([[layerId, [edited]]]));
    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    // The reopened gradient is the edited one, field for field.
    expect(parsed.project.elements[0]).toEqual(edited);
  });

  it("never produces a gradient the file reader would refuse", () => {
    const document = createDocument({ name: "Test", width: 100, height: 80 });
    const layerId = document.layers[0].id;
    const gradient = createGradient({ layerId });
    const handles: GradientHandleId[] = ["start", "end", "stop:1", "stop:2"];
    const points: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [50, 20],
      [50, 50],
      [10, 20],
      [90, 20],
      [100, 80],
    ];

    for (const handle of handles) {
      for (const [x, y] of points) {
        const moved = moveGradientHandle(gradient, handle, x, y);
        expect(gradientRecordProblem(moved)).toBeNull();
        const text = serializeProject(document, storeOf([[layerId, [moved]]]));
        expect(parseProject(text).ok).toBe(true);
      }
    }
  });

  it("refuses a file whose gradient is malformed rather than repairing it", () => {
    const document = createDocument({ name: "Test", width: 100, height: 80 });
    const layerId = document.layers[0].id;
    const text = serializeProject(
      document,
      storeOf([[layerId, [createGradient({ layerId })]]]),
    );
    const payload = JSON.parse(text) as {
      layers: Array<{ elements: Array<{ stops: Array<{ offset: number }> }> }>;
    };
    payload.layers[0].elements[0].stops[2].offset = 1.5;

    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(false);
  });
});

// ------------------------------------------------------------------ the picture

describe("the picture an edited gradient draws", () => {
  let recording: RecordingDocument;

  beforeEach(() => {
    recording = installRecordingDocument();
  });

  afterEach(() => {
    recording.restore();
  });

  function createHarness() {
    const firstAllocation = recording.allocated.length;
    const display = new RecordingCanvas();
    const elements = new Map<string, LayerElement[]>();
    const strokeSource: StrokeSource = {
      listStrokes: (layerId) => (elements.get(layerId) ?? []).filter(isStroke),
      listElements: (layerId) => elements.get(layerId) ?? [],
    };
    const renderer = new Canvas2DRenderer({
      canvas: display.asElement(),
      strokeSource,
      scheduler: new FrameScheduler({ requestFrame: () => 1, cancelFrame: () => {} }),
    });
    return {
      renderer,
      elements,
      layerSurfaces: () => recording.allocated.slice(firstAllocation + 1),
      composeDocument: () => renderer.composeDocumentImage() as unknown as RecordingCanvas,
    };
  }

  interface GradientPaint {
    readonly kind: string;
    /** The geometry the ramp was created with: its two end points. */
    readonly geometry: readonly number[];
    readonly stops: readonly { offset: number; color: string }[];
    readonly alpha: number;
    /** The rectangle the gradient was painted over: the whole layer. */
    readonly rect: readonly number[];
  }

  /** Renders a gradient on its own layer and reports how it was painted. */
  function paintOf(gradient: GradientRecord): GradientPaint {
    const harness = createHarness();
    const document = createDocument({ name: "Test", width: 100, height: 80 });
    const layerId = document.layers[0].id;
    harness.elements.set(layerId, [{ ...gradient, layerId }]);

    harness.renderer.setDocument(document);
    harness.renderer.setDisplaySize(200, 160, 1);
    harness.renderer.render();

    const surface = harness.layerSurfaces()[0];
    const paint = surface.named("fillRect")[0];
    const fill = paint.fillStyle as unknown as {
      kind: string;
      args: number[];
      stops: { offset: number; color: string }[];
    };
    return {
      kind: fill.kind,
      geometry: fill.args,
      stops: fill.stops,
      alpha: paint.alpha,
      rect: paint.args as number[],
    };
  }

  /** The export's own draw calls, with the canvas identities flattened. */
  function exportCalls(gradient: GradientRecord): unknown[] {
    const harness = createHarness();
    const document = createDocument({ name: "Test", width: 100, height: 80 });
    const layerId = document.layers[0].id;
    harness.elements.set(layerId, [{ ...gradient, layerId }]);

    harness.renderer.setDocument(document);
    harness.renderer.setDisplaySize(200, 160, 1);
    harness.renderer.render();

    return harness.composeDocument().calls.map((call) => ({
      name: call.name,
      args: call.args.map((arg) => (typeof arg === "number" ? arg : typeof arg)),
    }));
  }

  it("draws the reopened gradient exactly as the edited one", () => {
    const document = createDocument({ name: "Test", width: 100, height: 80 });
    const layerId = document.layers[0].id;
    const edited = moveGradientHandle(createGradient({ layerId }), "stop:1", 50, 20);

    const text = serializeProject(document, storeOf([[layerId, [edited]]]));
    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const reopened = parsed.project.elements[0];
    expect(isGradient(reopened)).toBe(true);
    if (!isGradient(reopened)) {
      return;
    }

    // The layer paints the same geometry, the same stops and the same alpha.
    expect(paintOf(reopened)).toEqual(paintOf(edited));
    // And so does the export.
    expect(exportCalls(reopened)).toEqual(exportCalls(edited));
  });

  it("draws the moved ramp, not the one that was committed", () => {
    const edited = moveGradientHandle(createGradient(), "stop:1", 50, 20);
    const paint = paintOf(edited);
    expect(paint.kind).toBe("linear");
    expect(paint.geometry).toEqual([10, 20, 90, 20]);
    expect(paint.stops).toEqual([
      { offset: 0, color: "#112233" },
      { offset: 0.5, color: "#ff0000" },
      { offset: 0.75, color: "#00ff00" },
      { offset: 1, color: "#ddeeff" },
    ]);
  });
});
