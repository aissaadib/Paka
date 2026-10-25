/**
 * Native shapes in the project file.
 *
 * Version 15 adds `kind: "shape"`: the primitive and its parameters, not baked
 * samples. These tests pin down the rules a format must not get wrong:
 *
 *  - a saved shape comes back with its identity, geometry and appearance;
 *  - a version-13 and a version-14 file still open unchanged, and a version-14
 *    baked shape is read as the stroke it is, never converted;
 *  - a file that claims an older version while carrying a shape is refused;
 *  - a malformed shape is refused rather than silently dropped;
 *  - an older build refuses a version-15 file through the version gate.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import { createDocument } from "../core/document/document";
import type {
  BoxShapeGeometry,
  DrawingDocument,
  LayerElement,
  LineShapeGeometry,
  ShapeGeometry,
  ShapeRecord,
  StrokeRecord,
  StrokeSource,
} from "../core/document/types";
import { isShape, isStroke } from "../core/document/types";
import {
  PROJECT_VERSION,
  parseProject,
  serializeProject,
} from "../core/project/projectFormat";

const BRUSH = {
  ...DEFAULT_BRUSH,
  size: 7,
  opacity: 0.6,
  color: "#3366cc",
  hardness: 0.4,
  texture: 0.3,
  tip: "chisel" as const,
};

function box(overrides: Partial<BoxShapeGeometry> = {}): BoxShapeGeometry {
  return {
    shape: "rectangle",
    x: 12,
    y: 24,
    width: 120,
    height: 60,
    rotation: 0,
    sides: 5,
    innerRatio: 0.5,
    ...overrides,
  };
}

function line(): LineShapeGeometry {
  return { shape: "line", x1: 10, y1: 20, x2: 110, y2: 70 };
}

function shape(
  geometry: ShapeGeometry,
  overrides: Partial<ShapeRecord> = {},
): ShapeRecord {
  return {
    id: "shape-1",
    layerId: "layer-1",
    kind: "shape",
    geometry,
    brush: BRUSH,
    fill: false,
    ...overrides,
  };
}

function stroke(): StrokeRecord {
  return {
    id: "stroke-1",
    layerId: "layer-1",
    brush: BRUSH,
    xs: [10, 20, 30],
    ys: [10, 20, 10],
    pressures: [1, 1, 1],
    times: [0, 10, 20],
    startTime: 0,
  };
}

function documentWith(elements: readonly LayerElement[]): {
  document: DrawingDocument;
  store: StrokeSource;
} {
  const document = createDocument({ name: "Shapes", width: 400, height: 300 });
  const layerId = document.activeLayerId as string;
  const store: StrokeSource = {
    listStrokes: (id) => (id === layerId ? elements.filter(isStroke) : []),
    listElements: (id) => (id === layerId ? elements : []),
  };
  return { document, store };
}

function payloadOf(elements: readonly LayerElement[]): Record<string, unknown> {
  return JSON.parse(textOf(elements)) as Record<string, unknown>;
}

/** The project text for a document whose only layer holds `elements`. */
function textOf(elements: readonly LayerElement[]): string {
  const { document, store } = documentWith(elements);
  return serializeProject(document, store);
}

/** The serialized elements of the document's only layer. */
function elementsOf(payload: Record<string, unknown>): Record<string, unknown>[] {
  const layers = payload.layers as Record<string, unknown>[];
  return layers[0].elements as Record<string, unknown>[];
}

/** Replaces the first element and returns the payload as text. */
function withElement(
  payload: Record<string, unknown>,
  element: Record<string, unknown>,
): string {
  elementsOf(payload)[0] = element;
  return JSON.stringify(payload);
}

function firstShape(payload: Record<string, unknown>): Record<string, unknown> {
  return elementsOf(payload)[0];
}

describe("native shapes in the project file", () => {
  it("is version 15", () => {
    expect(PROJECT_VERSION).toBe(15);
    expect(payloadOf([shape(box())]).version).toBe(15);
  });

  it("round-trips every primitive with its geometry and appearance", () => {
    const shapes: ShapeRecord[] = [
      shape(line(), { id: "shape-line" }),
      shape(box(), { id: "shape-rectangle" }),
      shape(box({ shape: "ellipse", rotation: 30 }), { id: "shape-ellipse" }),
      shape(box({ shape: "polygon", sides: 7, rotation: 15 }), { id: "shape-polygon" }),
      shape(box({ shape: "star", sides: 6, innerRatio: 0.25, rotation: 90 }), {
        id: "shape-star",
        fill: true,
      }),
    ];
    const text = textOf(shapes);

    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.elements).toHaveLength(shapes.length);
    const layerId = parsed.project.document.activeLayerId;
    expect(
      parsed.project.elements.map((element) => {
        expect(element.layerId).toBe(layerId);
        const { layerId: _layerId, ...rest } = element;
        return rest;
      }),
    ).toEqual(
      shapes.map((element) => {
        const { layerId: _layerId, ...rest } = element;
        return rest;
      }),
    );
    expect(parsed.project.strokes).toEqual([]);
    // Nothing was repaired on the way through.
    expect(parsed.project.warnings).toEqual([]);
  });

  it("keeps the shapes in painting order among the other elements", () => {
    const elements: LayerElement[] = [
      shape(line(), { id: "shape-a" }),
      stroke(),
      shape(box(), { id: "shape-b", fill: true }),
    ];
    const text = textOf(elements);

    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.elements.map((element) => element.id)).toEqual([
      "shape-a",
      "stroke-1",
      "shape-b",
    ]);
  });

  it("writes only the record's own fields, never transient UI", () => {
    const payload = payloadOf([shape(box(), { fill: true })]);
    const element = firstShape(payload);
    expect(Object.keys(element).sort()).toEqual([
      "brush",
      "fill",
      "geometry",
      "id",
      "kind",
    ]);
    const text = JSON.stringify(payload);
    for (const transient of ["selected", "preview", "hover", "handle", "frame"]) {
      expect(text).not.toContain(transient);
    }
  });

  it("forces the stamp off, even when the brush had it on", () => {
    const stamped = shape(box(), { brush: { ...BRUSH, stamp: true } });
    const parsed = parseProject(textOf([stamped]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const reopened = parsed.project.elements[0];
    expect(isShape(reopened)).toBe(true);
    expect(isShape(reopened) ? reopened.brush.stamp : null).toBe(false);
  });
});

describe("reading a native shape", () => {
  const cases: readonly [string, (element: Record<string, unknown>) => void][] = [
    [
      "an unknown primitive",
      (element) => {
        (element.geometry as Record<string, unknown>).shape = "triangle";
      },
    ],
    [
      "a negative width",
      (element) => {
        (element.geometry as Record<string, unknown>).width = -1;
      },
    ],
    [
      "a missing height",
      (element) => {
        delete (element.geometry as Record<string, unknown>).height;
      },
    ],
    [
      "a rotation outside 0..360",
      (element) => {
        (element.geometry as Record<string, unknown>).rotation = 361;
      },
    ],
    [
      "too few sides",
      (element) => {
        (element.geometry as Record<string, unknown>).sides = 2;
      },
    ],
    [
      "a fractional side count",
      (element) => {
        (element.geometry as Record<string, unknown>).sides = 5.5;
      },
    ],
    [
      "an inner ratio below the minimum",
      (element) => {
        (element.geometry as Record<string, unknown>).innerRatio = 0.01;
      },
    ],
    [
      "a missing brush",
      (element) => {
        delete element.brush;
      },
    ],
    [
      "a non-boolean fill",
      (element) => {
        element.fill = "yes";
      },
    ],
    [
      "a missing id",
      (element) => {
        delete element.id;
      },
    ],
  ];

  for (const [what, corrupt] of cases) {
    it(`refuses ${what}`, () => {
      const payload = payloadOf([shape(box({ shape: "polygon" }))]);
      const element = firstShape(payload);
      corrupt(element);
      const parsed = parseProject(withElement(payload, element));
      expect(parsed.ok).toBe(false);
    });
  }

  it("refuses a line with a non-finite endpoint", () => {
    const payload = payloadOf([shape(line())]);
    const element = firstShape(payload);
    (element.geometry as Record<string, unknown>).x1 = "ten";
    expect(parseProject(withElement(payload, element)).ok).toBe(false);
  });

  it("refuses a shape in a file that claims version 14", () => {
    const payload = payloadOf([shape(box())]);
    payload.version = 14;
    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("requires file version 15");
  });
});

describe("older files", () => {
  function legacyPayload(version: number): Record<string, unknown> {
    const payload = payloadOf([stroke()]);
    payload.version = version;
    if (version < 14) {
      delete (payload.document as Record<string, unknown>).references;
    }
    return payload;
  }

  for (const version of [13, 14]) {
    it(`opens a version-${version} file unchanged`, () => {
      const parsed = parseProject(JSON.stringify(legacyPayload(version)));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        return;
      }
      expect(parsed.project.elements).toHaveLength(1);
      const element = parsed.project.elements[0];
      expect(isStroke(element)).toBe(true);
      expect(isShape(element)).toBe(false);
    });
  }

  it("reads a version-14 baked shape as the stroke it is, never as a native shape", () => {
    // A version-14 rectangle was committed as samples: four corners plus the
    // repeated first point. Reopening it must keep every sample.
    const baked: StrokeRecord = {
      ...stroke(),
      xs: [10, 110, 110, 10, 10],
      ys: [20, 20, 70, 70, 20],
      pressures: [1, 1, 1, 1, 1],
      times: [0, 0, 0, 0, 0],
    };
    const payload = payloadOf([baked]);
    payload.version = 14;

    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const element = parsed.project.elements[0];
    expect(isShape(element)).toBe(false);
    expect(isStroke(element)).toBe(true);
    if (!isStroke(element)) {
      return;
    }
    expect(element.xs).toEqual([10, 110, 110, 10, 10]);
    expect(element.ys).toEqual([20, 20, 70, 70, 20]);
  });

  it("is refused by a build that only reads version 14", () => {
    const text = textOf([shape(box())]);
    const parsed = parseProject(text, { maxVersion: 14 });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("newer version of Paka");
  });
});
