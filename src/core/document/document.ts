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

/**
 * Bounded raster-surface budget for one document.
 *
 * Canvas backing stores are RGBA, so one document-resolution surface costs
 * `width * height * 4` bytes at raster scale 1 and four times that at the
 * app's maximum display scale of 2. The renderer can hold several of those at
 * once: one surface per layer, the live stroke buffer, a full-resolution erase
 * snapshot while an eraser is down, and a temporary 1x composite for export or
 * a bucket scan.
 *
 * The model below covers a one-layer document plus those working buffers (one
 * budgeted surface is spare headroom for the 1x composite); every additional
 * layer adds one more full-resolution surface. Budgeting four 2x RGBA surfaces
 * against 1 GiB gives
 * `floor(1 GiB / (4 bytes * 2^2 * 4 surfaces)) = 16,777,216` document pixels
 * (4096x4096). That keeps one 2x surface at 256 MiB instead of the roughly
 * 1.07 GB an 8192x8192 document would need for a single surface.
 *
 * This is a guard on calculable backing-store pixels, not a promise about
 * browser, GPU or compositor overhead. The per-side 8192 ceiling stays for
 * file-format compatibility; the total pixel budget is the stricter limit.
 */
export const RASTER_SURFACE_BYTES_PER_PIXEL = 4;
export const BUDGETED_RASTER_SCALE = 2;
export const BUDGETED_RASTER_SURFACES = 4;
export const DOCUMENT_RASTER_BUDGET_BYTES = 1024 * 1024 * 1024;
export const MAX_DOCUMENT_PIXELS = Math.floor(
  DOCUMENT_RASTER_BUDGET_BYTES /
    (RASTER_SURFACE_BYTES_PER_PIXEL *
      BUDGETED_RASTER_SCALE *
      BUDGETED_RASTER_SCALE *
      BUDGETED_RASTER_SURFACES),
);

export const DOCUMENT_SIZE_LIMIT_DESCRIPTION =
  `${MIN_DOCUMENT_SIZE}-${MAX_DOCUMENT_SIZE} px per side and at most ` +
  `${MAX_DOCUMENT_PIXELS.toLocaleString("en-US")} px in total`;

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

/** Rounded document pixel count used by the raster budget. */
export function documentPixelCount(width: number, height: number): number {
  return Math.round(width) * Math.round(height);
}

/**
 * Worst-case byte estimate for `surfaces` full-resolution RGBA buffers at
 * `rasterScale`. Defaults to the budget model above; tests can lower either
 * value without allocating anything.
 */
export function estimateDocumentRasterBytes(
  width: number,
  height: number,
  surfaces: number = BUDGETED_RASTER_SURFACES,
  rasterScale: number = BUDGETED_RASTER_SCALE,
): number {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return Number.POSITIVE_INFINITY;
  }
  return (
    documentPixelCount(width, height) *
    RASTER_SURFACE_BYTES_PER_PIXEL *
    Math.max(1, rasterScale) *
    Math.max(1, rasterScale) *
    Math.max(1, surfaces)
  );
}

/** True when the rounded dimensions fit the document raster budget. */
export function isWithinDocumentRasterBudget(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return false;
  }
  const pixels = documentPixelCount(width, height);
  return Number.isFinite(pixels) && pixels > 0 && pixels <= MAX_DOCUMENT_PIXELS;
}

/** True when `width`/`height` are usable document dimensions. */
export function isValidDocumentSize(width: number, height: number): boolean {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= MIN_DOCUMENT_SIZE &&
    width <= MAX_DOCUMENT_SIZE &&
    height >= MIN_DOCUMENT_SIZE &&
    height <= MAX_DOCUMENT_SIZE &&
    isWithinDocumentRasterBudget(width, height)
  );
}

export function createDocument(options: CreateDocumentOptions): DrawingDocument {
  const width = Math.round(options.width);
  const height = Math.round(options.height);
  if (!isValidDocumentSize(width, height)) {
    throw new RangeError(
      `Document size ${width}x${height} is outside the supported range ` +
        `(${DOCUMENT_SIZE_LIMIT_DESCRIPTION}).`,
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
