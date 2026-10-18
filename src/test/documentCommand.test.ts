/**
 * Document command tests.
 *
 * These exercise layer operations as history entries against a fake host, so
 * the apply/revert contract - including the stroke data that travels with a
 * deleted or duplicated layer - is pinned down without a canvas or a renderer.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import { createStrokeRecord } from "../core/brushes/strokeBuilder";
import {
  createDocumentCommand,
  type DocumentCommandHost,
} from "../core/commands/documentCommand";
import {
  addLayer,
  createDocument,
  removeLayer,
  updateLayer,
} from "../core/document/document";
import type { DrawingDocument, LayerId, StrokeRecord } from "../core/document/types";

function makeStroke(layerId: LayerId, x: number): StrokeRecord {
  const stroke = createStrokeRecord(layerId, DEFAULT_BRUSH);
  stroke.xs.push(x);
  stroke.ys.push(0);
  stroke.pressures.push(1);
  stroke.times.push(0);
  return stroke;
}

/**
 * In-memory stand-in for the engine: a document variable plus a stroke map.
 * `applyDocument` only swaps the document, exactly like the engine's publisher.
 */
function createHost(initial: DrawingDocument) {
  let document = initial;
  const strokes = new Map<LayerId, StrokeRecord[]>();

  const host: DocumentCommandHost = {
    getDocument: () => document,
    applyDocument: (next) => {
      document = next;
    },
    clearLayerStrokes: (layerId) => {
      strokes.delete(layerId);
    },
    restoreLayerStrokes: (layerId, list) => {
      strokes.set(layerId, [...list]);
    },
  };

  return {
    host,
    getDocument: () => document,
    list: (layerId: LayerId): readonly StrokeRecord[] => strokes.get(layerId) ?? [],
  };
}

describe("createDocumentCommand", () => {
  it("swaps the document forward on apply and back on revert", () => {
    const before = createDocument({ name: "Test", width: 100, height: 80 });
    const after = updateLayer(before, before.layers[0].id, { name: "Ink" });
    const harness = createHost(before);

    const command = createDocumentCommand({ label: "Rename Layer", before, after }, harness.host);

    command.apply();
    expect(harness.getDocument().layers[0].name).toBe("Ink");

    command.revert();
    expect(harness.getDocument()).toBe(before);
  });

  it("restores a deleted layer's strokes when the command is reverted", () => {
    let before = createDocument({ name: "Test", width: 100, height: 80 });
    before = addLayer(before);
    const removedLayerId = before.layers[1].id;
    const kept = makeStroke(before.layers[0].id, 1);
    const doomed = [makeStroke(removedLayerId, 10), makeStroke(removedLayerId, 20)];

    const harness = createHost(before);
    harness.host.restoreLayerStrokes(kept.layerId, [kept]);
    harness.host.restoreLayerStrokes(removedLayerId, doomed);

    const after = removeLayer(before, removedLayerId);
    const command = createDocumentCommand(
      {
        label: "Delete Layer",
        before,
        after,
        removedStrokes: { layerId: removedLayerId, strokes: doomed },
      },
      harness.host,
    );

    command.apply();
    expect(harness.getDocument().layers).toHaveLength(1);
    expect(harness.list(removedLayerId)).toHaveLength(0);
    // An unrelated layer is untouched.
    expect(harness.list(kept.layerId)).toHaveLength(1);

    command.revert();
    expect(harness.getDocument().layers.map((layer) => layer.id)).toContain(removedLayerId);
    expect(harness.list(removedLayerId).map((stroke) => stroke.xs[0])).toEqual([10, 20]);
  });

  it("removes a duplicated layer's copied strokes when reverted", () => {
    let before = createDocument({ name: "Test", width: 100, height: 80 });
    before = updateLayer(before, before.layers[0].id, { name: "Layer 1" });

    const harness = createHost(before);
    const copyId = "layer-copy";
    const copied = makeStroke(copyId, 5);
    const after: DrawingDocument = {
      ...before,
      layers: [...before.layers, { ...before.layers[0], id: copyId, name: "Layer 1 copy" }],
      activeLayerId: copyId,
    };

    const command = createDocumentCommand(
      {
        label: "Duplicate Layer",
        before,
        after,
        addedStrokes: { layerId: copyId, strokes: [copied] },
      },
      harness.host,
    );

    command.apply();
    expect(harness.getDocument().layers).toHaveLength(2);
    expect(harness.list(copyId)).toHaveLength(1);

    command.revert();
    expect(harness.getDocument().layers).toHaveLength(1);
    expect(harness.list(copyId)).toHaveLength(0);
  });

  it("only offers a merge key for changes that move no strokes", () => {
    const before = createDocument({ name: "Test", width: 100, height: 80 });
    const after = updateLayer(before, before.layers[0].id, { opacity: 0.5 });
    const harness = createHost(before);

    const plain = createDocumentCommand(
      { label: "Layer Opacity", before, after, mergeKey: "layer-opacity:layer-1" },
      harness.host,
    );
    expect(plain.mergeKey).toBe("layer-opacity:layer-1");
    expect(plain.mergeWith).toBeTypeOf("function");

    const withTransfer = createDocumentCommand(
      {
        label: "Delete Layer",
        before,
        after,
        mergeKey: "layer-opacity:layer-1",
        removedStrokes: { layerId: before.layers[0].id, strokes: [] },
      },
      harness.host,
    );
    expect(withTransfer.mergeKey).toBeUndefined();
    expect(withTransfer.mergeWith).toBeUndefined();
  });

  it("merges two opacity changes into one span from the earliest revert", () => {
    const start = createDocument({ name: "Test", width: 100, height: 80 });
    const layerId = start.layers[0].id;
    const half = updateLayer(start, layerId, { opacity: 0.5 });
    const quarter = updateLayer(start, layerId, { opacity: 0.25 });
    const harness = createHost(start);

    const first = createDocumentCommand(
      { label: "Layer Opacity", before: start, after: half, mergeKey: `layer-opacity:${layerId}` },
      harness.host,
    );
    const second = createDocumentCommand(
      { label: "Layer Opacity", before: half, after: quarter, mergeKey: `layer-opacity:${layerId}` },
      harness.host,
    );

    const merged = first.mergeWith?.(second);
    expect(merged).toBeDefined();

    merged?.apply();
    expect(harness.getDocument().layers[0].opacity).toBe(0.25);

    // Undo goes all the way back to the value before the drag started.
    merged?.revert();
    expect(harness.getDocument()).toBe(start);
    expect(harness.getDocument().layers[0].opacity).toBe(1);
  });
});
