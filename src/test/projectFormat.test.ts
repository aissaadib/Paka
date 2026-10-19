/**
 * Project format tests.
 *
 * These cover the two things that matter about a file format: that a saved
 * drawing comes back *exactly* (metadata, layer order, ids, stroke samples) and
 * that anything that could corrupt a drawing is refused with a message instead
 * of being half-loaded.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import { addLayer, createDocument, updateLayer } from "../core/document/document";
import { isFillPatch } from "../core/document/types";
import type { FillPatchRecord, LayerElement, StrokeRecord, StrokeSource } from "../core/document/types";import {
  PROJECT_FORMAT_ID,
  PROJECT_VERSION,
  parseProject,
  serializeProject,
} from "../core/project/projectFormat";
import { createId, resetIdCounters } from "../utils/id";
import { bytesToBase64 } from "../utils/base64";

function strokeFor(layerId: string, overrides: Partial<StrokeRecord> = {}): StrokeRecord {
  return {
    id: createId("stroke"),
    layerId,
    brush: { ...DEFAULT_BRUSH, size: 12, color: "#123456", pressureOpacity: 0.5 },
    xs: [1, 2.5, 3],
    ys: [4, 5.5, 6],
    pressures: [0.25, 0.5, 1],
    times: [0, 16, 40],
    startTime: 1000,
    ...overrides,
  };
}

function storeOf(entries: ReadonlyArray<readonly [string, LayerElement[]]>): StrokeSource {
  const map = new Map(entries);
  return {
    listStrokes: (layerId) =>
      (map.get(layerId) ?? []).filter(
        (element): element is StrokeRecord => !isFillPatch(element),
      ),
    listElements: (layerId) => map.get(layerId) ?? [],
  };
}

/** A small committed fill with a non-trivial mask, used to pin the file shape. */
function fillFor(
  layerId: string,
  mask: Uint8Array = new Uint8Array([255, 0, 0, 255, 255, 0]),
  overrides: Partial<FillPatchRecord> = {},
): FillPatchRecord {
  return {
    id: createId("fill"),
    layerId,
    kind: "fill",
    color: "#123456",
    x: 2,
    y: 3,
    width: 3,
    height: 2,
    mask,
    ...overrides,
  };
}

/** Two layers, strokes on both, the top one hidden and semi-transparent. */
function sampleProject() {
  const base = createDocument({ name: "Study", width: 640, height: 480, background: "#f4f1ea" });
  const document = (() => {
    const withLayer = addLayer(base);
    return updateLayer(withLayer, withLayer.layers[1].id, {
      name: "Ink",
      opacity: 0.4,
      visible: false,
    });
  })();

  const [bottom, top] = document.layers;
  const bottomStrokes = [strokeFor(bottom.id)];
  const topStrokes = [strokeFor(top.id), strokeFor(top.id, { startTime: 2000 })];

  return {
    document,
    bottom,
    top,
    bottomStrokes,
    topStrokes,
    text: serializeProject(
      document,
      storeOf([
        [bottom.id, bottomStrokes],
        [top.id, topStrokes],
      ]),
    ),
  };
}

describe("serializeProject", () => {
  it("writes a versioned payload with exactly the documented fields", () => {
    const { text } = sampleProject();
    const payload = JSON.parse(text) as Record<string, unknown>;

    expect(payload.format).toBe(PROJECT_FORMAT_ID);
    expect(payload.version).toBe(PROJECT_VERSION);
    expect(Object.keys(payload).sort()).toEqual(["document", "format", "layers", "version"]);

    const document = payload.document as Record<string, unknown>;
    expect(Object.keys(document).sort()).toEqual([
      "activeLayerId",
      "background",
      "height",
      "id",
      "name",
      "width",
    ]);

    const [layer] = payload.layers as Record<string, unknown>[];
    expect(Object.keys(layer).sort()).toEqual([
      "blendMode",
      "elements",
      "id",
      "name",
      "opacity",
      "visible",
    ]);

    const [stroke] = layer.elements as Record<string, unknown>[];
    expect(Object.keys(stroke).sort()).toEqual([
      "brush",
      "id",
      "kind",
      "pressures",
      "startTime",
      "times",
      "xs",
      "ys",
    ]);
  });

  it("is deterministic", () => {
    const { document, bottom, top, bottomStrokes, topStrokes } = sampleProject();
    const store = storeOf([
      [bottom.id, bottomStrokes],
      [top.id, topStrokes],
    ]);

    expect(serializeProject(document, store)).toBe(serializeProject(document, store));
  });

  it("writes the erase flag only for eraser strokes", () => {
    const document = createDocument({ width: 64, height: 64 });
    const layerId = document.layers[0].id;
    const paint = strokeFor(layerId);
    const erase = strokeFor(layerId, { erase: true });

    const payload = JSON.parse(
      serializeProject(document, storeOf([[layerId, [paint, erase]]])),
    ) as { layers: { elements: Record<string, unknown>[] }[] };

    // A brush stroke stays exactly as version 2 wrote it before erasers existed,
    // so brush-only drawings diff cleanly against older saves.
    expect("erase" in payload.layers[0].elements[0]).toBe(false);
    expect(payload.layers[0].elements[1].erase).toBe(true);
  });

  it("writes the fill flag only for filled shapes", () => {
    const document = createDocument({ width: 64, height: 64 });
    const layerId = document.layers[0].id;
    const outline = strokeFor(layerId);
    const filled = strokeFor(layerId, { fill: true });

    const payload = JSON.parse(
      serializeProject(document, storeOf([[layerId, [outline, filled]]])),
    ) as { layers: { elements: Record<string, unknown>[] }[] };

    // An outline stroke keeps the version-2 shape, so unfilled drawings diff
    // cleanly against older saves.
    expect("fill" in payload.layers[0].elements[0]).toBe(false);
    expect(payload.layers[0].elements[1].fill).toBe(true);
  });

  it("writes a fill patch as colour, box and base64 mask only", () => {
    const document = createDocument({ width: 64, height: 64 });
    const layerId = document.layers[0].id;
    const mask = new Uint8Array([255, 0, 0, 255, 255, 0]);
    const patch = fillFor(layerId, mask);

    const payload = JSON.parse(
      serializeProject(document, storeOf([[layerId, [patch]]])),
    ) as { layers: { elements: Record<string, unknown>[] }[] };

    const element = payload.layers[0].elements[0];
    expect(Object.keys(element).sort()).toEqual([
      "color",
      "height",
      "id",
      "kind",
      "mask",
      "width",
      "x",
      "y",
    ]);
    expect(element).toMatchObject({
      kind: "fill",
      id: patch.id,
      color: "#123456",
      x: 2,
      y: 3,
      width: 3,
      height: 2,
      mask: bytesToBase64(mask),
    });
  });
});

describe("parseProject round trip", () => {
  it("restores document metadata, layer order, ids and strokes", () => {
    const { document, bottom, top, bottomStrokes, topStrokes, text } = sampleProject();

    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(parsed.project.warnings).toEqual([]);
    expect(parsed.project.document).toEqual(document);
    expect(parsed.project.document.layers.map((layer) => layer.id)).toEqual([bottom.id, top.id]);
    expect(parsed.project.document.layers[1]).toMatchObject({
      name: "Ink",
      opacity: 0.4,
      visible: false,
      blendMode: "normal",
    });

    // Strokes come back in document order, each tagged with its layer.
    expect(parsed.project.strokes).toEqual([...bottomStrokes, ...topStrokes]);
    expect(parsed.project.strokes.map((stroke) => stroke.layerId)).toEqual([
      bottom.id,
      top.id,
      top.id,
    ]);
    // Numeric sample data survives exactly - pressure ramps stay intact.
    expect(parsed.project.strokes[2].pressures).toEqual([0.25, 0.5, 1]);
    expect(parsed.project.strokes[2].startTime).toBe(2000);
  });

  it("round-trips a document with no strokes", () => {
    const document = createDocument({ width: 64, height: 64 });
    const parsed = parseProject(serializeProject(document, storeOf([])));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.document).toEqual(document);
    expect(parsed.project.strokes).toEqual([]);
  });

  it("restores eraser strokes as erasers, not as paint", () => {
    const document = createDocument({ width: 64, height: 64 });
    const layerId = document.layers[0].id;
    const paint = strokeFor(layerId);
    const erase = strokeFor(layerId, { erase: true, startTime: 500 });
    const parsed = parseProject(serializeProject(document, storeOf([[layerId, [paint, erase]]])));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    // Painting order is preserved, and the flag survives the round trip.
    expect(parsed.project.strokes).toEqual([paint, erase]);
    expect(parsed.project.strokes[1].erase).toBe(true);
    expect("erase" in parsed.project.strokes[0]).toBe(false);
  });

  it("restores filled shapes as fills, not as outlines", () => {
    const document = createDocument({ width: 64, height: 64 });
    const layerId = document.layers[0].id;
    const outline = strokeFor(layerId);
    const filled = strokeFor(layerId, { fill: true, startTime: 500 });
    const parsed = parseProject(
      serializeProject(document, storeOf([[layerId, [outline, filled]]])),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    // Painting order is preserved, and the flag survives the round trip.
    expect(parsed.project.strokes).toEqual([outline, filled]);
    expect(parsed.project.strokes[1].fill).toBe(true);
    expect("fill" in parsed.project.strokes[0]).toBe(false);
  });

  it("round-trips fill pixels, boxes and painting order exactly", () => {
    const document = createDocument({ width: 64, height: 64 });
    const layerId = document.layers[0].id;
    const before = strokeFor(layerId);
    const mask = new Uint8Array([255, 0, 0, 255, 255, 0]);
    const fill = fillFor(layerId, mask);
    const after = strokeFor(layerId, { startTime: 999 });

    const parsed = parseProject(
      serializeProject(document, storeOf([[layerId, [before, fill, after]]])),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    // The authoritative list keeps drawing order across kinds.
    expect(parsed.project.elements.map((element) => element.id)).toEqual([
      before.id,
      fill.id,
      after.id,
    ]);
    // The stroke-only view used by selection never sees the patch.
    expect(parsed.project.strokes).toEqual([before, after]);

    const restored = parsed.project.elements[1];
    expect(isFillPatch(restored)).toBe(true);
    if (!isFillPatch(restored)) {
      return;
    }
    expect(restored).toMatchObject({
      id: fill.id,
      layerId,
      color: "#123456",
      x: 2,
      y: 3,
      width: 3,
      height: 2,
    });
    expect([...restored.mask]).toEqual([...mask]);
    // A fresh array, not a view into the payload.
    expect(restored.mask).not.toBe(mask);
  });

  it("opens version 2 files, whose shapes were all outlines", () => {
    const document = createDocument({ width: 64, height: 64 });
    const layerId = document.layers[0].id;
    const shape = strokeFor(layerId);
    const text = asLegacyVersion(
      serializeProject(document, storeOf([[layerId, [shape]]])),
      2,
    );

    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.strokes[0].fill).toBeUndefined();
    expect(parsed.project.elements).toEqual(parsed.project.strokes);
  });

  it("opens version 1 files, whose strokes all painted", () => {
    const { document, bottom, top, bottomStrokes, topStrokes } = sampleProject();
    const text = asLegacyVersion(
      serializeProject(
        document,
        storeOf([
          [bottom.id, bottomStrokes],
          [top.id, topStrokes],
        ]),
      ),
      1,
    );

    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.strokes).toEqual([...bottomStrokes, ...topStrokes]);
    expect(parsed.project.strokes.every((stroke) => stroke.erase === undefined)).toBe(true);
  });

  it("opens version 3 files and keeps their filled-shape flags", () => {
    const document = createDocument({ width: 64, height: 64 });
    const layerId = document.layers[0].id;
    const outline = strokeFor(layerId);
    const filled = strokeFor(layerId, { fill: true });
    const text = asLegacyVersion(
      serializeProject(document, storeOf([[layerId, [outline, filled]]])),
      3,
    );

    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.strokes).toEqual([outline, filled]);
    expect(parsed.project.strokes[1].fill).toBe(true);
  });

  it("accepts a byte order mark", () => {
    const { text } = sampleProject();
    expect(parseProject(`\uFEFF${text}`).ok).toBe(true);
  });

  it("keeps generated ids clear of the ids that came from the file", () => {
    // A file created in a session that had already produced 40 layer ids.
    resetIdCounters();
    for (let index = 0; index < 40; index += 1) {
      createId("layer");
    }
    const farDocument = createDocument({ width: 20, height: 20 });
    const loadedId = farDocument.layers[0].id;
    const text = serializeProject(farDocument, storeOf([]));

    // Opened in a fresh session, where the counters start at zero again.
    resetIdCounters();
    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.document.layers[0].id).toBe(loadedId);

    const next = createId("layer");
    const digits = (id: string): number => Number.parseInt(id.slice("layer-".length), 36);
    expect(next).not.toBe(loadedId);
    expect(digits(next)).toBe(digits(loadedId) + 1);
  });
});

interface RawStroke {
  kind: "stroke";
  id: string;
  brush: unknown;
  startTime: number;
  erase?: unknown;
  fill?: unknown;
  xs: unknown[];
  ys: unknown[];
  pressures: unknown[];
  times: unknown[];
}

interface RawLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  elements: RawStroke[];
}

interface RawProject {
  format: string;
  version: number;
  document: {
    id: string;
    name: string;
    width: number;
    height: number;
    background: string;
    activeLayerId: string | null;
  };
  layers: RawLayer[];
}

function rawProject(): RawProject {
  const document = createDocument({ width: 100, height: 80 });
  const layerId = document.layers[0].id;
  return {
    format: PROJECT_FORMAT_ID,
    version: PROJECT_VERSION,
    document: {
      id: document.id,
      name: "Test",
      width: 100,
      height: 80,
      background: "#ffffff",
      activeLayerId: layerId,
    },
    layers: [
      {
        id: layerId,
        name: "Layer 1",
        visible: true,
        opacity: 1,
        blendMode: "normal",
        elements: [
          {
            kind: "stroke",
            id: "stroke-1",
            brush: { ...DEFAULT_BRUSH },
            startTime: 0,
            xs: [1, 2],
            ys: [3, 4],
            pressures: [1, 1],
            times: [0, 16],
          },
        ],
      },
    ],
  };
}

/** Rewrites a version-4 payload into the older `strokes`-only shape. */
function asLegacyVersion(text: string, version: number): string {
  const payload = JSON.parse(text) as {
    version: number;
    layers: Array<{ elements: RawStroke[]; strokes?: Array<Omit<RawStroke, "kind">> }>;
  };
  payload.version = version;
  for (const layer of payload.layers) {
    layer.strokes = layer.elements.map(({ kind: _kind, ...stroke }) => stroke);
    delete (layer as { elements?: RawStroke[] }).elements;
  }
  return JSON.stringify(payload);
}

/** Serializes a mutated payload, so each case differs from a valid file by one thing. */
function mutate(change: (project: RawProject) => void): string {
  const project = rawProject();
  change(project);
  return JSON.stringify(project);
}

/** Asserts the file is refused and returns the message for inspection. */
function rejectionOf(text: string): string {
  const parsed = parseProject(text);
  expect(parsed.ok, "expected the file to be refused").toBe(false);
  return parsed.ok ? "" : parsed.error;
}

describe("parseProject rejections", () => {
  it("refuses text that is not JSON at all", () => {
    expect(rejectionOf("this is not json")).toContain("not valid JSON");
    expect(rejectionOf("")).toContain("not valid JSON");
  });

  it("refuses JSON that is not a Paka project", () => {
    expect(rejectionOf("{}")).toContain(PROJECT_FORMAT_ID);
    expect(rejectionOf("[]")).toContain("must be an object");
    expect(rejectionOf("null")).toContain("must be an object");
    expect(
      rejectionOf(mutate((project) => (project.format = "some-other-drawing-app"))),
    ).toContain("not a Paka project file");
  });

  it("refuses a missing, non-numeric or future version", () => {
    expect(rejectionOf(mutate((project) => delete (project as { version?: number }).version))).toContain(
      "version number",
    );
    expect(rejectionOf(mutate((project) => ((project.version as unknown) = "1")))).toContain(
      "version number",
    );
    expect(
      rejectionOf(mutate((project) => (project.version = PROJECT_VERSION + 1))),
    ).toContain("newer version of Paka");
    expect(rejectionOf(mutate((project) => (project.version = 0)))).toContain("Unsupported");
  });

  it("refuses document sizes outside the supported range", () => {
    expect(rejectionOf(mutate((project) => (project.document.width = 4)))).toContain(
      "outside the supported range",
    );
    expect(rejectionOf(mutate((project) => (project.document.height = 90000)))).toContain(
      "8-8192",
    );
    expect(
      rejectionOf(mutate((project) => ((project.document.width as unknown) = "800"))),
    ).toContain("finite number");
  });

  it("refuses a layer list that is missing, empty or duplicated", () => {
    expect(rejectionOf(mutate((project) => delete (project as { layers?: RawLayer[] }).layers))).toContain(
      "no layer list",
    );
    expect(rejectionOf(mutate((project) => (project.layers = [])))).toContain("no layers");

    const duplicated = mutate((project) => {
      project.layers.push({ ...project.layers[0], elements: [] });
    });
    expect(rejectionOf(duplicated)).toContain("share the id");
  });

  it("refuses a layer without an id, an out-of-range opacity or an unknown blend mode", () => {
    expect(rejectionOf(mutate((project) => (project.layers[0].id = "  ")))).toContain(
      "missing its identifier",
    );
    expect(rejectionOf(mutate((project) => (project.layers[0].opacity = 1.5)))).toContain(
      "opacity",
    );
    expect(rejectionOf(mutate((project) => (project.layers[0].visible = "yes" as unknown as boolean)))).toContain(
      "visibility",
    );
    expect(rejectionOf(mutate((project) => (project.layers[0].blendMode = "multiply")))).toContain(
      "unsupported blend mode",
    );
  });

  it("refuses stroke sample arrays that disagree or contain non-numbers", () => {
    expect(
      rejectionOf(mutate((project) => (project.layers[0].elements[0].ys = [1, 2, 3]))),
    ).toContain("mismatched sample arrays");

    expect(
      rejectionOf(mutate((project) => (project.layers[0].elements[0].xs = [1, null]))),
    ).toContain("x sample 2 is not a finite number");

    expect(
      rejectionOf(mutate((project) => (project.layers[0].elements[0].times = [0, "16" as unknown as number]))),
    ).toContain("time sample 2 is not a finite number");

    expect(
      rejectionOf(mutate((project) => (project.layers[0].elements[0].pressures = "0.5" as unknown as number[]))),
    ).toContain("must be an array");
  });

  it("refuses a stroke without an id or with a broken brush", () => {
    expect(
      rejectionOf(mutate((project) => (project.layers[0].elements[0].id = ""))),
    ).toContain("missing its identifier");

    expect(
      rejectionOf(
        mutate((project) => {
          project.layers[0].elements[0].brush = { ...DEFAULT_BRUSH, size: 0 };
        }),
      ),
    ).toContain("brush size");

    expect(
      rejectionOf(mutate((project) => (project.layers[0].elements[0].brush = undefined))),
    ).toContain("must be an object");
  });

  it("refuses an erase flag that is not a boolean", () => {
    expect(
      rejectionOf(mutate((project) => (project.layers[0].elements[0].erase = "yes"))),
    ).toContain("erase flag");
    expect(
      rejectionOf(mutate((project) => (project.layers[0].elements[0].erase = 1))),
    ).toContain("erase flag");
  });

  it("refuses a fill flag that is not a boolean", () => {
    expect(
      rejectionOf(mutate((project) => (project.layers[0].elements[0].fill = "yes"))),
    ).toContain("fill flag");
    expect(
      rejectionOf(mutate((project) => (project.layers[0].elements[0].fill = 0))),
    ).toContain("fill flag");
  });

  it("refuses a fill patch with a broken box or mask", () => {
    const validFill = (): Record<string, unknown> => ({
      kind: "fill",
      id: "fill-1",
      color: "#ff0000",
      x: 2,
      y: 2,
      width: 3,
      height: 2,
      mask: bytesToBase64(new Uint8Array(6).fill(255)),
    });
    const withFill = (change: (fill: Record<string, unknown>) => void): string =>
      mutate((project) => {
        const fill = validFill();
        change(fill);
        project.layers[0].elements.push(fill as unknown as RawStroke);
      });

    expect(parseProject(withFill(() => {})).ok).toBe(true);

    expect(rejectionOf(withFill((fill) => (fill.mask = "not base64!")))).toContain(
      "not valid base64",
    );
    expect(
      rejectionOf(withFill((fill) => (fill.mask = bytesToBase64(new Uint8Array(5))))),
    ).toContain("needs 6");
    expect(rejectionOf(withFill((fill) => (fill.x = 100)))).toContain("between 0 and 99");
    expect(rejectionOf(withFill((fill) => (fill.y = 80)))).toContain("between 0 and 79");
    expect(rejectionOf(withFill((fill) => (fill.width = 0)))).toContain("between 1 and 98");
    expect(rejectionOf(withFill((fill) => (fill.width = 2.5)))).toContain("whole number");
    expect(rejectionOf(withFill((fill) => (fill.color = " ")))).toContain("colour is empty");
    expect(rejectionOf(withFill((fill) => delete fill.id))).toContain("missing its identifier");
  });

  it("refuses an unknown element kind but accepts strokes in a version 4 file", () => {
    expect(
      rejectionOf(
        mutate((project) => {
          project.layers[0].elements[0].kind = "spline" as unknown as "stroke";
        }),
      ),
    ).toContain('unknown kind "spline"');

    expect(
      rejectionOf(mutate((project) => delete (project.layers[0].elements[0] as { kind?: string }).kind)),
    ).toContain("kind must be a string");
  });

  it("refuses a project with more fill pixels than the ceiling", () => {
    const text = mutate((project) => {
      project.layers[0].elements.push({
        kind: "fill",
        id: "fill-1",
        color: "#ff0000",
        x: 0,
        y: 0,
        width: 3,
        height: 2,
        mask: bytesToBase64(new Uint8Array(6).fill(255)),
      } as unknown as RawStroke);
    });

    expect(parseProject(text, { maxFillPixels: 6 }).ok).toBe(true);
    expect(parseProject(text, { maxFillPixels: 5 }).ok).toBe(false);
    const parsed = parseProject(text, { maxFillPixels: 5 });
    expect(parsed.ok ? "" : parsed.error).toContain("more than 5 fill pixels");
  });

  it("refuses a project with more samples than the ceiling", () => {
    const text = mutate((project) => {
      project.layers[0].elements[0].xs = [1, 2, 3, 4];
      project.layers[0].elements[0].ys = [1, 2, 3, 4];
      project.layers[0].elements[0].pressures = [1, 1, 1, 1];
      project.layers[0].elements[0].times = [0, 1, 2, 3];
    });

    expect(parseProject(text, { maxSamples: 4 }).ok).toBe(true);
    expect(parseProject(text, { maxSamples: 3 }).ok).toBe(false);
    const parsed = parseProject(text, { maxSamples: 3 });
    expect(parsed.ok ? "" : parsed.error).toContain("more than 3 stroke samples");
  });

  it("survives hostile but well-formed JSON without throwing", () => {
    for (const text of ['{"format":"paka-project","version":1,"layers":{}}', "12345", "true"]) {
      expect(() => parseProject(text), text).not.toThrow();
      expect(parseProject(text).ok, text).toBe(false);
    }
  });
});

describe("parseProject repairs", () => {
  it("names an unnamed document and layer instead of failing", () => {
    const text = mutate((project) => {
      (project.document as { name?: string }).name = "   ";
      (project.layers[0] as { name?: string }).name = "";
    });

    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.document.name).toBe("Untitled");
    expect(parsed.project.document.layers[0].name).toBe("Layer 1");
    expect(parsed.project.warnings).toHaveLength(2);
    expect(parsed.project.warnings.join(" ")).toContain("no name");
  });

  it("falls back to white when the paper colour is unusable", () => {
    const parsed = parseProject(mutate((project) => (project.document.background = "")));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.document.background).toBe("#ffffff");
    expect(parsed.project.warnings.join(" ")).toContain("paper colour");
  });

  it("selects the bottom layer when the recorded active layer is gone", () => {
    const parsed = parseProject(mutate((project) => (project.document.activeLayerId = "layer-gone")));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.document.activeLayerId).toBe(parsed.project.document.layers[0].id);
    expect(parsed.project.warnings.join(" ")).toContain("active layer");
  });
});
