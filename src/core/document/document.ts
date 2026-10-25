/**
 * Pure document operations.
 *
 * Every function returns a new `DrawingDocument`, so React can compare
 * identities and the engine can publish snapshots without cloning pixel data.
 * None of these functions touch rendering or the DOM.
 */

import { createId } from "../../utils/id";
import { clamp } from "../../utils/math";
import {
  allLayerNames,
  findLayer,
  findParent,
  flattenLayers,
  isGroup,
  paintableLayers,
  replaceLayerNode,
  uniqueNameAmong,
} from "./layerGroups";
import type { DrawingDocument, Layer, LayerId, LayerPatch } from "./types";

export const MIN_DOCUMENT_SIZE = 8;
export const MAX_DOCUMENT_SIZE = 8192;
export const DEFAULT_DOCUMENT_BACKGROUND = "#ffffff";

/**
 * Bounded raster-surface budget for one document.
 *
 * Canvas backing stores are RGBA, so one document-resolution surface costs
 * `width * height * 4` bytes at raster scale 1 and four times that at the
 * app's maximum display scale of 2. The peak for a **one-layer** document is
 * therefore:
 *
 * - **Two** full-resolution 2x surfaces that are always resident: the layer
 *   surface and the live stroke buffer.
 * - **At most one** further full-resolution 2x surface: the erase snapshot
 *   (alive only while an eraser is in flight) *or* the grouped live-preview
 *   scratch (used only for a non-erasing preview on a layer whose opacity is
 *   below 1 or whose blend mode is not `normal`). They are mutually exclusive
 *   by construction: an eraser previews by mutating its own layer surface, so
 *   the renderer passes no preview for it and never builds the group scratch
 *   while the erase snapshot exists.
 * - **One** transient scan buffer: a bucket scan (composite + `ImageData` +
 *   visited bitmap + mask) costs about 10 bytes per document pixel (~170 MB at
 *   the cap); the PNG export composite is 4 bytes per document pixel at 1x, so
 *   the scan allowance covers it.
 *
 * That is `3 * 4 * 2^2 + 10 = 58` bytes per document pixel of peak surface,
 * i.e. 973,078,528 bytes (928 MiB) at the cap below, inside the 1 GiB budget.
 * The cap of 16,777,216 document pixels (4096x4096) keeps a single 2x surface
 * at 256 MiB, instead of the roughly 1.07 GB an 8192x8192 document would need
 * for one surface.
 *
 * The one-surface rule is a **requirement of the renderer**, not a hope: the
 * grouped-preview scratch must be released when no preview is active, or a
 * preview followed by an eraser keeps both it and the erase snapshot alive and
 * the peak becomes `4 * 4 * 2^2 + 10 = 74` bytes per document pixel
 * (1,241,213,984 bytes, 1.16 GiB) - over the 1 GiB budget below.
 *
 * Every additional layer adds one more full-resolution surface: the model
 * covers a one-layer document plus its working buffers, not an unbounded layer
 * stack. The display canvas is sized by the viewport, not the document, and
 * the soft-edge feather scratch is sized by the stroke's own bounding box, so
 * neither is counted here.
 *
 * This is a guard on calculable backing-store pixels, not a promise about
 * browser, GPU or compositor overhead. The per-side 8192 ceiling stays for
 * file-format compatibility; the total pixel budget is the stricter limit.
 */
export const RASTER_SURFACE_BYTES_PER_PIXEL = 4;
export const BUDGETED_RASTER_SCALE = 2;
/** Layer surface + stroke buffer + one of {erase snapshot, preview scratch}. */
export const BUDGETED_FULL_RES_SURFACES = 3;
/** A bucket scan's composite + ImageData + visited bitmap + mask. */
export const BUDGETED_SCAN_BYTES_PER_PIXEL = 10;
export const DOCUMENT_RASTER_BUDGET_BYTES = 1024 * 1024 * 1024;
/** Peak bytes per document pixel: three 2x surfaces plus one scan buffer. */
export const PEAK_BYTES_PER_DOCUMENT_PIXEL =
  BUDGETED_FULL_RES_SURFACES *
    RASTER_SURFACE_BYTES_PER_PIXEL *
    BUDGETED_RASTER_SCALE *
    BUDGETED_RASTER_SCALE +
  BUDGETED_SCAN_BYTES_PER_PIXEL;
/**
 * The peak if the grouped-preview scratch is retained after a preview and an
 * eraser then runs: four 2x surfaces plus the scan buffer. It exceeds the
 * 1 GiB budget, which is why the renderer has to release that scratch when no
 * preview is active.
 */
export const RETAINED_SCRATCH_BYTES_PER_DOCUMENT_PIXEL =
  (BUDGETED_FULL_RES_SURFACES + 1) *
    RASTER_SURFACE_BYTES_PER_PIXEL *
    BUDGETED_RASTER_SCALE *
    BUDGETED_RASTER_SCALE +
  BUDGETED_SCAN_BYTES_PER_PIXEL;
/**
 * The policy cap: 4096x4096 document pixels. It is deliberately below
 * `DOCUMENT_RASTER_BUDGET_BYTES / PEAK_BYTES_PER_DOCUMENT_PIXEL`
 * (18,512,476), so the worst-case peak stays inside the 1 GiB budget.
 */
export const MAX_DOCUMENT_PIXELS = 16_777_216;
/** Worst-case peak surface bytes at `MAX_DOCUMENT_PIXELS`. */
export const PEAK_DOCUMENT_RASTER_BYTES = MAX_DOCUMENT_PIXELS * PEAK_BYTES_PER_DOCUMENT_PIXEL;

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
    kind: "layer",
    children: [],
  };
}

/** Rounded document pixel count used by the raster budget. */
export function documentPixelCount(width: number, height: number): number {
  return Math.round(width) * Math.round(height);
}

/**
 * Byte estimate for `surfaces` full-resolution RGBA buffers at `rasterScale`.
 * Defaults to the budget model above; tests can lower either value without
 * allocating anything.
 */
export function estimateDocumentRasterBytes(
  width: number,
  height: number,
  surfaces: number = BUDGETED_FULL_RES_SURFACES,
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

/**
 * Worst-case peak surface bytes for a one-layer document: the resident
 * surfaces, one transient full-resolution surface (the erase snapshot *or* the
 * grouped live-preview scratch - never both) and a transient scan buffer.
 */
export function estimatePeakDocumentRasterBytes(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return Number.POSITIVE_INFINITY;
  }
  return (
    estimateDocumentRasterBytes(width, height) +
    documentPixelCount(width, height) * BUDGETED_SCAN_BYTES_PER_PIXEL
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
    guides: [],
    references: [],
  };
}

/** Generates a layer name that is not already used in the document. */
export function nextLayerName(document: DrawingDocument): string {
  const used = allLayerNames(document.layers);
  for (let index = flattenLayers(document.layers).length + 1; ; index += 1) {
    const candidate = `Layer ${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

/** Suffixes `base` with a number until it is unique in the document. */
export function uniqueLayerName(document: DrawingDocument, base: string): string {
  return uniqueNameAmong(allLayerNames(document.layers), base);
}

export function getLayer(document: DrawingDocument, layerId: LayerId): Layer | undefined {
  return findLayer(document.layers, layerId);
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
 *
 * A **group** is removed with everything it holds, and the document must
 * keep at least one *paintable* layer: a document whose only layers sit
 * inside the group that is being removed has no destination either, so the
 * removal is refused.
 */
export function removeLayer(document: DrawingDocument, layerId: LayerId): DrawingDocument {
  const node = findLayer(document.layers, layerId);
  if (!node) {
    return document;
  }

  const paintable = paintableLayers(document.layers);
  if (paintable.length - paintableLayers([node]).length < 1) {
    return document;
  }

  const parent = findParent(document.layers, layerId);
  const siblings = parent ? parent.children : document.layers;
  const index = siblings.findIndex((layer) => layer.id === layerId);
  if (index === -1) {
    return document;
  }
  const nextSiblings = siblings.filter((layer) => layer.id !== layerId);

  const layers = parent
    ? replaceLayerNode(document.layers, parent.id, (owner) => ({
        ...owner,
        children: nextSiblings,
      }))
    : nextSiblings;

  if (layers === document.layers) {
    return document;
  }

  // The active layer follows the removal: the neighbour of the removed layer
  // when the active layer was the removed one, and the first paintable layer
  // when the active layer was inside the removed group.
  const wasActive = document.activeLayerId === layerId;
  const neighbour = nextSiblings[Math.min(index, nextSiblings.length - 1)]?.id ?? null;
  const activeLayerId = wasActive
    ? isGroup(node)
      ? (paintableLayers(layers)[0]?.id ?? null)
      : neighbour
    : (findLayer(layers, document.activeLayerId ?? "")?.id ??
      paintableLayers(layers)[0]?.id ??
      null);

  return { ...document, layers, activeLayerId };
}

export function updateLayer(
  document: DrawingDocument,
  layerId: LayerId,
  patch: LayerPatch,
): DrawingDocument {
  const current = findLayer(document.layers, layerId);
  if (!current) {
    return document;
  }
  const next: Layer = {
    ...current,
    ...patch,
    opacity: patch.opacity === undefined ? current.opacity : clamp(patch.opacity, 0, 1),
  };
  const changed =
    next.name !== current.name ||
    next.visible !== current.visible ||
    next.opacity !== current.opacity ||
    next.blendMode !== current.blendMode;
  if (!changed) {
    return document;
  }

  const layers = replaceLayerNode(document.layers, layerId, () => next);
  if (layers === document.layers) {
    return document;
  }
  return { ...document, layers };
}

/**
 * Moves a layer by `delta` positions in the stack.
 * Positive `delta` moves it towards the top of the stack.
 *
 * A layer moves among its **siblings**: a layer inside a group moves inside
 * that group, and never jumps out of it.
 */
export function moveLayer(
  document: DrawingDocument,
  layerId: LayerId,
  delta: number,
): DrawingDocument {
  const parent = findParent(document.layers, layerId);
  const siblings = parent ? parent.children : document.layers;
  const index = siblings.findIndex((layer) => layer.id === layerId);
  if (index === -1) {
    return document;
  }
  const target = clamp(index + delta, 0, siblings.length - 1);
  if (target === index) {
    return document;
  }

  const layers = [...siblings];
  const [moved] = layers.splice(index, 1);
  if (!moved) {
    return document;
  }
  layers.splice(target, 0, moved);

  const next =
    parent === undefined
      ? layers
      : replaceLayerNode(document.layers, parent.id, (owner) => ({
          ...owner,
          children: layers,
        }));
  if (next === document.layers) {
    return document;
  }
  return { ...document, layers: next };
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
 *
 * A **group** is not duplicated: a copy of a group would be a copy of a whole
 * subtree, with new ids for every layer in it, and the content that belongs
 * to those layers has to be cloned with them. That is a bigger change than a
 * single layer copy, so the request is refused rather than half done.
 */
export function duplicateLayer(document: DrawingDocument, layerId: LayerId): DrawingDocument {
  const source = findLayer(document.layers, layerId);
  if (!source || isGroup(source)) {
    return document;
  }

  const parent = findParent(document.layers, layerId);
  const siblings = parent ? parent.children : document.layers;
  const index = siblings.findIndex((layer) => layer.id === layerId);
  if (index === -1) {
    return document;
  }

  const copy: Layer = {
    ...source,
    id: createId("layer"),
    name: uniqueLayerName(document, `${source.name} copy`),
  };
  const layers = [...siblings];
  layers.splice(index + 1, 0, copy);
  const next =
    parent === undefined
      ? layers
      : replaceLayerNode(document.layers, parent.id, (owner) => ({
          ...owner,
          children: layers,
        }));
  if (next === document.layers) {
    return document;
  }
  return { ...document, layers: next, activeLayerId: copy.id };
}
