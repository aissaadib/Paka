/**
 * Pure document operations.
 *
 * Every function returns a new `DrawingDocument`, so React can compare
 * identities and the engine can publish snapshots without cloning pixel data.
 * None of these functions touch rendering or the DOM.
 */

import { createId } from "../../utils/id";
import { clamp } from "../../utils/math";
import type { DrawingDocument, Layer, LayerId, LayerPatch } from "./types";

export const MIN_DOCUMENT_SIZE = 8;
export const MAX_DOCUMENT_SIZE = 8192;
export const DEFAULT_DOCUMENT_BACKGROUND = "#ffffff";

export interface CreateDocumentOptions {
  readonly name?: string;
  readonly width: number;
  readonly height: number;
  readonly background?: string;
  readonly firstLayerName?: string;
}

export function createLayer(name: string): Layer {
  return {
    id: createId("layer"),
    name,
    visible: true,
    opacity: 1,
    blendMode: "normal",
  };
}

/** True when `width`/`height` are usable document dimensions. */
export function isValidDocumentSize(width: number, height: number): boolean {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= MIN_DOCUMENT_SIZE &&
    width <= MAX_DOCUMENT_SIZE &&
    height >= MIN_DOCUMENT_SIZE &&
    height <= MAX_DOCUMENT_SIZE
  );
}

export function createDocument(options: CreateDocumentOptions): DrawingDocument {
  const width = Math.round(options.width);
  const height = Math.round(options.height);
  if (!isValidDocumentSize(width, height)) {
    throw new RangeError(
      `Document size ${width}x${height} is outside the supported range ` +
        `${MIN_DOCUMENT_SIZE}-${MAX_DOCUMENT_SIZE} px.`,
    );
  }

  const firstLayer = createLayer(options.firstLayerName ?? "Layer 1");
  return {
    id: createId("doc"),
    name: options.name ?? "Untitled",
    width,
    height,
    background: options.background ?? DEFAULT_DOCUMENT_BACKGROUND,
    layers: [firstLayer],
    activeLayerId: firstLayer.id,
  };
}

/** Generates a layer name that is not already used in the document. */
export function nextLayerName(document: DrawingDocument): string {
  const used = new Set(document.layers.map((layer) => layer.name));
  for (let index = document.layers.length + 1; ; index += 1) {
    const candidate = `Layer ${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

/** Suffixes `base` with a number until it is unique in the document. */
export function uniqueLayerName(document: DrawingDocument, base: string): string {
  const used = new Set(document.layers.map((layer) => layer.name));
  if (!used.has(base)) {
    return base;
  }
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

export function getLayer(document: DrawingDocument, layerId: LayerId): Layer | undefined {
  return document.layers.find((layer) => layer.id === layerId);
}

export function getActiveLayer(document: DrawingDocument): Layer | undefined {
  if (document.activeLayerId === null) {
    return undefined;
  }
  return getLayer(document, document.activeLayerId);
}

/** Adds a layer on top of the stack and makes it active. */
export function addLayer(document: DrawingDocument, name?: string): DrawingDocument {
  const layer = createLayer(name ?? nextLayerName(document));
  return {
    ...document,
    layers: [...document.layers, layer],
    activeLayerId: layer.id,
  };
}

/**
 * Removes a layer. The last remaining layer is never removed, because the
 * drawing pipeline always needs a destination.
 */
export function removeLayer(document: DrawingDocument, layerId: LayerId): DrawingDocument {
  if (document.layers.length <= 1) {
    return document;
  }
  const index = document.layers.findIndex((layer) => layer.id === layerId);
  if (index === -1) {
    return document;
  }

  const layers = document.layers.filter((layer) => layer.id !== layerId);
  const wasActive = document.activeLayerId === layerId;
  const nextActive = wasActive
    ? (layers[Math.min(index, layers.length - 1)]?.id ?? null)
    : document.activeLayerId;

  return { ...document, layers, activeLayerId: nextActive };
}

export function updateLayer(
  document: DrawingDocument,
  layerId: LayerId,
  patch: LayerPatch,
): DrawingDocument {
  let changed = false;
  const layers = document.layers.map((layer) => {
    if (layer.id !== layerId) {
      return layer;
    }
    const next: Layer = {
      ...layer,
      ...patch,
      opacity: patch.opacity === undefined ? layer.opacity : clamp(patch.opacity, 0, 1),
    };
    changed =
      next.name !== layer.name ||
      next.visible !== layer.visible ||
      next.opacity !== layer.opacity ||
      next.blendMode !== layer.blendMode;
    return next;
  });

  return changed ? { ...document, layers } : document;
}

/**
 * Moves a layer by `delta` positions in the stack.
 * Positive `delta` moves it towards the top of the stack.
 */
export function moveLayer(
  document: DrawingDocument,
  layerId: LayerId,
  delta: number,
): DrawingDocument {
  const index = document.layers.findIndex((layer) => layer.id === layerId);
  if (index === -1) {
    return document;
  }
  const target = clamp(index + delta, 0, document.layers.length - 1);
  if (target === index) {
    return document;
  }

  const layers = [...document.layers];
  const [moved] = layers.splice(index, 1);
  if (!moved) {
    return document;
  }
  layers.splice(target, 0, moved);
  return { ...document, layers };
}

export function setActiveLayer(document: DrawingDocument, layerId: LayerId): DrawingDocument {
  if (document.activeLayerId === layerId || !getLayer(document, layerId)) {
    return document;
  }
  return { ...document, activeLayerId: layerId };
}

/**
 * Inserts a copy of `layerId` directly above it and makes the copy active.
 *
 * Only layer *metadata* is duplicated here. Strokes live in the `StrokeStore`,
 * not the document, so the caller (a document command) is responsible for
 * cloning and moving the pixel-producing data.
 */
export function duplicateLayer(document: DrawingDocument, layerId: LayerId): DrawingDocument {
  const index = document.layers.findIndex((layer) => layer.id === layerId);
  const source = index === -1 ? undefined : document.layers[index];
  if (!source) {
    return document;
  }

  const copy: Layer = {
    ...source,
    id: createId("layer"),
    name: uniqueLayerName(document, `${source.name} copy`),
  };
  const layers = [...document.layers];
  layers.splice(index + 1, 0, copy);
  return { ...document, layers, activeLayerId: copy.id };
}
