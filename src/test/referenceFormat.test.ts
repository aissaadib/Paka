/**
 * Reference images in the project file.
 *
 * Version 14 adds `document.references`: the placement *and* the encoded bytes
 * of every reference. The rules these tests pin down are the ones a file format
 * must not get wrong:
 *
 *  - a saved reference comes back exactly, bytes included;
 *  - a version-13 file (no references) still opens;
 *  - a file that claims an older version while carrying references is refused,
 *    because an older build would drop them on the next save;
 *  - a malformed reference is refused rather than silently dropped;
 *  - an older build refuses the newer file through the version gate.
 */

import { describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import type { DrawingDocument, StrokeSource } from "../core/document/types";
import type { ReferenceImage } from "../core/reference/types";
import {
  MAX_PROJECT_REFERENCES,
  PROJECT_VERSION,
  parseProject,
  serializeProject,
} from "../core/project/projectFormat";
import { bytesToBase64 } from "../utils/base64";

const STORE: StrokeSource = {
  listStrokes: () => [],
  listElements: () => [],
};

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function reference(overrides: Partial<ReferenceImage> = {}): ReferenceImage {
  return {
    id: "reference-1",
    name: "sketch.png",
    x: 120.5,
    y: 40,
    width: 300,
    height: 150,
    naturalWidth: 600,
    naturalHeight: 300,
    rotation: 30,
    opacity: 0.75,
    blendMode: "multiply",
    behind: true,
    visible: true,
    source: { mimeType: "image/png", base64: bytesToBase64(PNG_BYTES) },
    ...overrides,
  };
}

function documentWith(references: readonly ReferenceImage[]): DrawingDocument {
  return { ...createDocument({ name: "Refs", width: 800, height: 600 }), references };
}

/** The serialized payload of a document, as a mutable object. */
function payloadOf(document: DrawingDocument): Record<string, unknown> {
  return JSON.parse(serializeProject(document, STORE)) as Record<string, unknown>;
}

function documentOf(payload: Record<string, unknown>): Record<string, unknown> {
  return payload.document as Record<string, unknown>;
}

describe("references in the project file", () => {
  it("is version 15", () => {
    expect(PROJECT_VERSION).toBe(15);
    expect(payloadOf(documentWith([])).version).toBe(15);
  });

  it("round-trips a reference, bytes and all", () => {
    const original = reference();
    const text = serializeProject(documentWith([original]), STORE);

    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const [restored] = parsed.project.document.references;
    expect(restored).toEqual(original);
    // The encoded file is the source of truth for the picture: the project
    // does not depend on the original file still being on disk.
    expect(restored?.source?.base64).toBe(bytesToBase64(PNG_BYTES));
    expect(restored?.source?.mimeType).toBe("image/png");
  });

  it("keeps the order, so the drawing order survives a save", () => {
    const text = serializeProject(
      documentWith([
        reference({ id: "reference-1", name: "back.png", behind: true }),
        reference({ id: "reference-2", name: "front.png", behind: false }),
      ]),
      STORE,
    );

    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.document.references.map((item) => item.name)).toEqual([
      "back.png",
      "front.png",
    ]);
  });

  it("opens a version-13 file with no references", () => {
    const payload = payloadOf(documentWith([]));
    payload.version = 13;
    delete documentOf(payload).references;

    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.document.references).toEqual([]);
  });

  it("opens a version-13 file that carries an empty reference list", () => {
    // A newer serializer writes the field even when there is nothing in it.
    // That is not content, so it is not a version lie.
    const payload = payloadOf(documentWith([]));
    payload.version = 13;

    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(true);
  });

  it("refuses an older file that carries references", () => {
    const payload = payloadOf(documentWith([reference()]));
    payload.version = 13;

    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("version 14");
  });

  it("refuses a newer file through the version gate", () => {
    // This is what an older build does with a v14 file: it says so instead of
    // reading it and losing the references.
    const text = serializeProject(documentWith([reference()]), STORE);
    const parsed = parseProject(text, { maxVersion: 13 });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error.toLowerCase()).toContain("version");
  });

  it("refuses a reference with no picture", () => {
    const payload = payloadOf(documentWith([reference({ source: undefined })]));
    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("kind of image");
  });

  it("refuses a reference whose bytes are not base64", () => {
    const payload = payloadOf(documentWith([reference()]));
    const references = documentOf(payload).references as Record<string, unknown>[];
    references[0].data = "not base64 !!!";
    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("base64");
  });

  it("refuses a reference with an unknown blend mode", () => {
    const payload = payloadOf(documentWith([reference()]));
    const references = documentOf(payload).references as Record<string, unknown>[];
    references[0].blendMode = "dodge";
    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(false);
  });

  it("refuses a reference that is not on the paper's plane", () => {
    const payload = payloadOf(documentWith([reference()]));
    const references = documentOf(payload).references as Record<string, unknown>[];
    references[0].x = Number.NaN;
    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(false);
  });

  it("refuses two references with the same id", () => {
    const payload = payloadOf(
      documentWith([reference({ id: "same" }), reference({ id: "same", name: "two.png" })]),
    );
    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("repeats");
  });

  it("refuses more references than the ceiling", () => {
    const many = Array.from({ length: MAX_PROJECT_REFERENCES + 1 }, (_, index) =>
      reference({ id: `reference-${index}` }),
    );
    const parsed = parseProject(serializeProject(documentWith(many), STORE));
    expect(parsed.ok).toBe(false);
  });

  it("refuses references that together exceed the session pixel budget", () => {
    // 10000 x 10000 is 100 megapixels: one picture over the 64 MP session cap.
    const huge = reference({ naturalWidth: 10_000, naturalHeight: 10_000 });
    const parsed = parseProject(serializeProject(documentWith([huge]), STORE));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("megapixels");
  });

  it("normalizes a rotation written out of one turn", () => {
    const payload = payloadOf(documentWith([reference()]));
    const references = documentOf(payload).references as Record<string, unknown>[];
    references[0].rotation = 390;
    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.document.references[0]?.rotation).toBe(30);
  });

  it("repairs a missing name instead of refusing the file", () => {
    const payload = payloadOf(documentWith([reference()]));
    const references = documentOf(payload).references as Record<string, unknown>[];
    references[0].name = "   ";
    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.document.references[0]?.name).toBe("Reference 1");
    expect(parsed.project.warnings.join(" ")).toContain("no name");
  });

  it("keeps references out of the layer tree and the element list", () => {
    const text = serializeProject(documentWith([reference()]), STORE);
    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    // A reference is document metadata: no element, no stroke, no extra layer.
    expect(parsed.project.elements).toHaveLength(0);
    expect(parsed.project.document.layers).toHaveLength(1);
  });
});
