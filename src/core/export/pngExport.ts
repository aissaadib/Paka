/**
 * PNG export.
 *
 * Two steps, deliberately separate:
 *
 *  1. the renderer composites paper + visible layers into a canvas at document
 *     pixel size (see `DrawingRenderer.composeDocumentImage`),
 *  2. this module turns that canvas into PNG bytes.
 *
 * The composited canvas is a throwaway: the editable document, its layers and
 * its stroke list are never touched, so exporting cannot alter the drawing.
 *
 * Encoding goes through `canvas.toBlob`, which is the platform's PNG encoder -
 * no third-party encoder is bundled. `PngEncoder` is a parameter rather than a
 * hard call so the byte-producing step can be substituted in a Node test,
 * where there is no real rasterizer.
 */

/** Anything that can produce a document-sized composite, i.e. `DrawingEngine`. */
export interface DocumentImageSource {
  renderDocumentImage(): HTMLCanvasElement;
}

export type PngEncoder = (canvas: HTMLCanvasElement) => Promise<Uint8Array>;

/** Encodes a canvas as PNG using the browser's own encoder. */
export const encodeCanvasToPng: PngEncoder = (canvas) => {
  if (typeof canvas.toBlob !== "function") {
    return Promise.reject(new Error("PNG encoding is not available in this environment."));
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("The image could not be encoded as PNG."));
        return;
      }
      blob.arrayBuffer().then(
        (buffer) => {
          resolve(new Uint8Array(buffer));
        },
        (error: unknown) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    }, "image/png");
  });
};

/**
 * Composites the document and encodes it as PNG bytes.
 *
 * Throws when the source has nothing to draw (no attached renderer) or when the
 * encoder returns nothing; the caller reports that instead of writing a
 * truncated file.
 */
export async function renderDocumentPng(
  source: DocumentImageSource,
  encode: PngEncoder = encodeCanvasToPng,
): Promise<Uint8Array> {
  const canvas = source.renderDocumentImage();
  if (canvas.width <= 0 || canvas.height <= 0) {
    throw new Error("The document has no size, so there is nothing to export.");
  }

  const bytes = await encode(canvas);
  if (bytes.length === 0) {
    throw new Error("PNG encoding produced no data.");
  }
  return bytes;
}
