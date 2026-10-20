/**
 * Per-layer raster surfaces.
 *
 * Each layer owns a canvas at document resolution (times a raster scale used
 * for HiDPI crispness). Surfaces are created lazily, marked dirty when their
 * pixels no longer match their stroke list, and re-rasterized on demand.
 */

import type { LayerId } from "../document/types";

export interface LayerSurface {
  readonly layerId: LayerId;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** True when the pixels must be regenerated from the stroke list. */
  dirty: boolean;
}

export class LayerSurfaceStore {
  private readonly surfaces = new Map<LayerId, LayerSurface>();
  private docWidth = 0;
  private docHeight = 0;
  private scale = 1;

  constructor(scale = 1) {
    this.scale = scale > 0 ? scale : 1;
  }

  get rasterScale(): number {
    return this.scale;
  }

  get count(): number {
    return this.surfaces.size;
  }

  /**
   * Sets the document size and/or raster scale. Existing surfaces are dropped
   * (their pixels are reconstructed from the stroke store on next raster).
   */
  setDocumentSize(width: number, height: number, scale: number = this.scale): void {
    const nextScale = scale > 0 ? scale : 1;
    if (this.docWidth === width && this.docHeight === height && this.scale === nextScale) {
      return;
    }
    this.docWidth = width;
    this.docHeight = height;
    this.scale = nextScale;
    this.surfaces.clear();
  }

  ensure(layerId: LayerId): LayerSurface {
    const existing = this.surfaces.get(layerId);
    if (existing) {
      return existing;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(this.docWidth * this.scale));
    canvas.height = Math.max(1, Math.round(this.docHeight * this.scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error(`Canvas 2D context unavailable for layer "${layerId}".`);
    }

    const surface: LayerSurface = { layerId, canvas, ctx, dirty: true };
    this.surfaces.set(layerId, surface);
    return surface;
  }

  get(layerId: LayerId): LayerSurface | undefined {
    return this.surfaces.get(layerId);
  }

  markDirty(layerId: LayerId): void {
    const surface = this.surfaces.get(layerId);
    if (surface) {
      surface.dirty = true;
    }
  }

  /** Drops surfaces whose layers no longer exist. */
  retain(layerIds: readonly LayerId[]): void {
    if (this.surfaces.size === 0) {
      return;
    }
    const keep = new Set(layerIds);
    for (const layerId of [...this.surfaces.keys()]) {
      if (!keep.has(layerId)) {
        this.surfaces.delete(layerId);
      }
    }
  }

  /** Makes the surface transform map document coordinates to surface pixels. */
  prepare(surface: LayerSurface): void {
    const { ctx } = surface;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    // A soft stroke blurs its own scratch buffer, never the surface, but the
    // filter is part of the context state - reset it so no layer can ever be
    // composited through a filter left behind by another path.
    ctx.filter = "none";
  }

  clear(surface: LayerSurface): void {
    const { ctx, canvas } = surface;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  dispose(): void {
    this.surfaces.clear();
  }
}
