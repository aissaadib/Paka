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
  setActiveLayer,
  updateLayer,
} from "../core/document/document";
import { groupLayers } from "../core/document/layerGroups";
import type { DrawingDocument, LayerElement, LayerId, StrokeRecord } from "../core/document/types";

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
  const elements = new Map<LayerId, LayerElement[]>();

  const host: DocumentCommandHost = {
    getDocument: () => document,
    applyDocument: (next) => {
      document = next;
    },
    clearLayerElements: (layerId) => {
      elements.delete(layerId);
    },
    restoreLayerElements: (layerId, list) => {
      elements.set(layerId, [...list]);
    },
  };

  return {
    host,
    getDocument: () => document,
    list: (layerId: LayerId): readonly LayerElement[] => elements.get(layerId) ?? [],
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
    harness.host.restoreLayerElements(kept.layerId, [kept]);
    harness.host.restoreLayerElements(removedLayerId, doomed);

    const after = removeLayer(before, removedLayerId);
    const command = createDocumentCommand(
      {
        label: "Delete Layer",
        before,
        after,
        removedElements: { layerId: removedLayerId, elements: doomed },
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
    expect(harness.list(removedLayerId).map((element) => ("xs" in element ? element.xs[0] : -1))).toEqual([10, 20]);
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
        addedElements: { layerId: copyId, elements: [copied] },
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
        removedElements: { layerId: before.layers[0].id, elements: [] },
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

  it("keeps an active layer that sits inside a group", () => {
    const start = addLayer(createDocument({ name: "Test", width: 100, height: 80 }));
    const [bottom, top] = start.layers;
    const grouped = groupLayers(start, [bottom?.id ?? "", top?.id ?? ""]);
    const inner = grouped.layers[0]?.children[0];
    const active = setActiveLayer(grouped, inner?.id ?? "");
    const harness = createHost(active);

    const renamed = updateLayer(active, inner?.id ?? "", { name: "Ink" });
    const command = createDocumentCommand(
      { label: "Rename Layer", before: active, after: renamed, preserveActiveLayer: true },
      harness.host,
    );

    command.apply();
    // The active layer is inside a group, so it is not in the root list - it
    // still has to be kept.
    expect(harness.getDocument().activeLayerId).toBe(inner?.id);

    command.revert();
    expect(harness.getDocument().activeLayerId).toBe(inner?.id);
  });
});
