/**
 * A renderer that answers the composite reads and nothing else.
 *
 * The engine asks its renderer what is under the pointer - the colour picker
 * samples a pixel, the bucket scans an image - so a test that drives one of
 * those tools needs a renderer that answers. This one does, and does nothing
 * else: it draws nothing, so the engine stays off Canvas 2D and the test runs
 * in plain Node.
 */

import type { DrawingRenderer, Rgb } from "../../core/rendering/types";

export interface StubRendererOptions {
  /** The colour a single-pixel read returns. `null` when there is none. */
  readonly pixel?: Rgb | null;
  /** The image a full read returns. `null` when there is none. */
  readonly image?: ImageData | null;
}

/** A renderer that answers the composite reads and does nothing else. */
export function createStubRenderer(options: StubRendererOptions = {}): DrawingRenderer {
  return {
    kind: "canvas2d",
    setDocument: () => {},
    setViewport: () => {},
    setDisplaySize: () => {},
    setRasterScale: () => {},
    invalidateLayer: () => {},
    beginStroke: () => {},
    extendStroke: () => {},
    replaceStroke: () => {},
    endStroke: () => {},
    cancelStroke: () => {},
    setSelection: () => {},
    setSelectedGuide: () => {},
    setGrid: () => {},
    composeDocumentImage: () => {
      throw new Error("composeDocumentImage is not used in these tests.");
    },
    readCompositePixel: () => options.pixel ?? null,
    readCompositeImage: () => options.image ?? null,
    render: () => {},
    requestRender: () => {},
    destroy: () => {},
  };
}

/** An opaque image of one colour, for the bucket's scan. */
export function flatImage(width: number, height: number, color: Rgb): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = color.r;
    data[offset + 1] = color.g;
    data[offset + 2] = color.b;
    data[offset + 3] = 255;
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}
