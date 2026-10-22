/**
 * Decoding an imported image.
 *
 * The webview is handed a file, not a path: the browser decodes it, and this
 * module turns the decoded bitmap into **one** canvas that the store keeps.
 * That single copy is what the renderer draws and what the colour picker
 * samples, so an imported reference never leaves a second decoded bitmap
 * behind.
 *
 * Three things can go wrong, and each has its own answer:
 *
 *  - the file is not an image the browser understands (`malformed`): it is
 *    refused with a message rather than added as an empty reference;
 *  - the image is enormous (`too-large`): it is *downscaled while it is
 *    decoded*, so the memory it costs is bounded, and the artist still gets a
 *    reference they can trace from;
 *  - the environment has no image decoder at all (`unsupported`): the import
 *    fails cleanly instead of throwing something the panel cannot explain.
 *
 * The browser calls are behind {@link ReferenceDecodeEnvironment} so the rules
 * above can be exercised in Node, where there is no `createImageBitmap`.
 */

/** The largest file that is worth decoding, in bytes. */
export const MAX_REFERENCE_BYTES = 32 * 1024 * 1024;

/**
 * The largest decoded image, in pixels.
 *
 * A decoded bitmap costs four bytes per pixel, so this is the memory one
 * reference may hold. 24 megapixels is 96 MB - a large photograph, downscaled
 * to something a tracing reference never needs to exceed.
 */
export const MAX_REFERENCE_PIXELS = 24 * 1024 * 1024;

/**
 * The largest total of decoded reference pixels, in pixels.
 *
 * The cap is on the sum, not on each image: a session may hold several
 * references, and they share one budget.
 */
export const MAX_TOTAL_REFERENCE_PIXELS = 64 * 1024 * 1024;

/** Why an import failed. */
export type ReferenceDecodeFailure = "malformed" | "too-large" | "unsupported";

/** An import that could not be decoded. */
export class ReferenceDecodeError extends Error {
  readonly reason: ReferenceDecodeFailure;

  constructor(reason: ReferenceDecodeFailure, message: string) {
    super(message);
    this.name = "ReferenceDecodeError";
    this.reason = reason;
  }
}

/**
 * One decoded reference: the pixels, and the context that reads them.
 *
 * The canvas is the retained copy. The context is kept with it because the
 * colour picker reads single pixels from it and a fresh context per pick
 * would allocate on every press.
 */
export interface DecodedReference {
  /** Width of the decoded image, in pixels. */
  readonly width: number;
  /** Height of the decoded image, in pixels. */
  readonly height: number;
  /** The retained copy of the pixels. */
  readonly canvas: HTMLCanvasElement;
  /** The context the pixels are read through. */
  readonly context: CanvasRenderingContext2D;
}

/** The browser calls the decoder needs. */
export interface ReferenceDecodeEnvironment {
  /** Decodes a blob into a bitmap. */
  readonly createBitmap: (blob: Blob) => Promise<ImageBitmap>;
  /** Decodes a bitmap again at a smaller size. */
  readonly resizeBitmap: (
    bitmap: ImageBitmap,
    width: number,
    height: number,
  ) => Promise<ImageBitmap>;
  /** Creates a canvas of the given pixel size. */
  readonly createCanvas: (width: number, height: number) => HTMLCanvasElement;
}

/**
 * The environment of a browser that can decode images.
 *
 * `createImageBitmap` is looked up when the decoder runs rather than when the
 * module loads, so a page without it fails with a message instead of a
 * `ReferenceError` at import time.
 */
export function browserDecodeEnvironment(): ReferenceDecodeEnvironment {
  return {
    createBitmap: async (blob) => {
      if (typeof createImageBitmap !== "function") {
        throw new ReferenceDecodeError(
          "unsupported",
          "This browser cannot decode images, so a reference cannot be imported.",
        );
      }
      return createImageBitmap(blob);
    },
    resizeBitmap: async (bitmap, width, height) => {
      if (typeof createImageBitmap !== "function") {
        throw new ReferenceDecodeError(
          "unsupported",
          "This browser cannot decode images, so a reference cannot be imported.",
        );
      }
      return createImageBitmap(bitmap, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: "high",
      });
    },
    createCanvas: (width, height) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
  };
}

/** Closes a bitmap when it can be closed, ignoring a stand-in that cannot. */
function closeBitmap(bitmap: ImageBitmap | null): void {
  if (bitmap && typeof bitmap.close === "function") {
    bitmap.close();
  }
}

/**
 * Decodes an imported file into a single retained canvas.
 *
 * A file that is too large is downscaled **during** the decode rather than
 * after it, so the full-size bitmap never has to exist in memory for long.
 * The scale is chosen so the decoded image fits the pixel budget while
 * keeping its aspect ratio.
 */
export async function decodeReferenceImage(
  blob: Blob,
  environment: ReferenceDecodeEnvironment = browserDecodeEnvironment(),
): Promise<DecodedReference> {
  if (blob.size > MAX_REFERENCE_BYTES) {
    throw new ReferenceDecodeError(
      "too-large",
      `The file is larger than ${Math.round(MAX_REFERENCE_BYTES / (1024 * 1024))} MB, which is more than a reference needs.`,
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await environment.createBitmap(blob);
  } catch (error) {
    if (error instanceof ReferenceDecodeError) {
      throw error;
    }
    throw new ReferenceDecodeError(
      "malformed",
      "The file could not be decoded as an image.",
    );
  }

  let pixels: ImageBitmap = bitmap;
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new ReferenceDecodeError("malformed", "The file could not be decoded as an image.");
    }

    if (width * height > MAX_REFERENCE_PIXELS) {
      const factor = Math.sqrt(MAX_REFERENCE_PIXELS / (width * height));
      const targetWidth = Math.max(1, Math.floor(width * factor));
      const targetHeight = Math.max(1, Math.floor(height * factor));
      let resized: ImageBitmap;
      try {
        resized = await environment.resizeBitmap(bitmap, targetWidth, targetHeight);
      } catch (error) {
        if (error instanceof ReferenceDecodeError) {
          throw error;
        }
        throw new ReferenceDecodeError(
          "too-large",
          "The image is too large to be downscaled into a reference.",
        );
      }
      pixels = resized;
    }

    const canvas = environment.createCanvas(pixels.width, pixels.height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new ReferenceDecodeError(
        "unsupported",
        "This browser cannot read back the decoded image, so a reference cannot be imported.",
      );
    }
    context.drawImage(pixels, 0, 0);

    return { width: pixels.width, height: pixels.height, canvas, context };
  } finally {
    // The bitmaps are transient; the canvas is the copy that is kept.
    if (pixels !== bitmap) {
      closeBitmap(pixels);
    }
    closeBitmap(bitmap);
  }
}
