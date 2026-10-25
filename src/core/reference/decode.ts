/**
 * Decoding an imported image.
 *
 * The webview is handed **bytes**, not a path and not a file handle: the
 * native side reads the file the artist picked and sends the bytes over the
 * existing gateway, and this module turns those bytes into something the
 * renderer can draw. The webview therefore gains no filesystem access of its
 * own - it never learns where the file lives, and it never opens one.
 *
 * Three things can go wrong, and each has its own answer:
 *
 *  - the file is not an image at all (`not-an-image`): the bytes are checked
 *    against the known image signatures *before* they reach the decoder, so a
 *    text file or a PDF is refused with a message instead of being handed to
 *    the browser to fail in its own way;
 *  - the file is enormous (`too-large`): the bytes are refused above
 *    {@link MAX_REFERENCE_BYTES}, and the decoded picture is refused above
 *    {@link MAX_REFERENCE_PIXELS}, so the memory one reference may hold is
 *    bounded;
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
 * reference may hold. 24 megapixels is 96 MB - a large photograph, which is
 * more than a tracing reference needs and already generous.
 */
export const MAX_REFERENCE_PIXELS = 24 * 1024 * 1024;

/**
 * The largest total of decoded reference pixels, in pixels.
 *
 * The cap is on the sum, not on each image: a session may hold several
 * references, and they share one budget.
 */
export const MAX_TOTAL_REFERENCE_PIXELS = 64 * 1024 * 1024;

/** The image formats a reference may be imported from. */
export type ReferenceImageFormat = "png" | "jpeg" | "gif" | "webp" | "bmp" | "avif";

/** What the editor knows about one importable image format. */
export interface ReferenceImageFormatInfo {
  readonly format: ReferenceImageFormat;
  /** The MIME type the bytes are handed to the decoder with. */
  readonly mimeType: string;
  /** The file extensions the open dialog offers, without the dot. */
  readonly extensions: readonly string[];
}

/** Every importable format, in the order the open dialog lists them. */
export const REFERENCE_IMAGE_FORMATS: readonly ReferenceImageFormatInfo[] = [
  { format: "png", mimeType: "image/png", extensions: ["png"] },
  { format: "jpeg", mimeType: "image/jpeg", extensions: ["jpg", "jpeg"] },
  { format: "gif", mimeType: "image/gif", extensions: ["gif"] },
  { format: "webp", mimeType: "image/webp", extensions: ["webp"] },
  { format: "bmp", mimeType: "image/bmp", extensions: ["bmp"] },
  { format: "avif", mimeType: "image/avif", extensions: ["avif"] },
];

const MIME_TYPES: Readonly<Record<ReferenceImageFormat, string>> = Object.freeze({
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
});

/** The MIME type of a format. */
export function referenceMimeType(format: ReferenceImageFormat): string {
  return MIME_TYPES[format];
}

/**
 * The file extensions the open dialog offers, without the dot.
 *
 * The dialog is the native side's business, but the list belongs with the
 * formats it accepts: a filter that offered a format the decoder refuses
 * would let the artist pick a file that is then rejected.
 */
export function referenceImageExtensions(): readonly string[] {
  return REFERENCE_IMAGE_FORMATS.flatMap((info) => info.extensions);
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) {
    return false;
  }
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[offset + index] !== signature[index]) {
      return false;
    }
  }
  return true;
}

function matchesAscii(bytes: Uint8Array, text: string, offset = 0): boolean {
  if (bytes.length < offset + text.length) {
    return false;
  }
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const BMP_SIGNATURE = [0x42, 0x4d] as const;

/**
 * The format of the image in `bytes`, or `null` when it is not an image.
 *
 * The check is by signature, not by file name: the name is the artist's, and a
 * picture called `sketch.txt` is still a picture. A file whose bytes are not
 * one of the known signatures is refused before it reaches the decoder.
 */
export function detectImageFormat(bytes: Uint8Array): ReferenceImageFormat | null {
  if (bytes.length === 0) {
    return null;
  }
  if (startsWith(bytes, PNG_SIGNATURE)) {
    return "png";
  }
  if (startsWith(bytes, JPEG_SIGNATURE)) {
    return "jpeg";
  }
  if (matchesAscii(bytes, "GIF8")) {
    return "gif";
  }
  if (matchesAscii(bytes, "RIFF") && matchesAscii(bytes, "WEBP", 8)) {
    return "webp";
  }
  if (startsWith(bytes, BMP_SIGNATURE)) {
    return "bmp";
  }
  if (matchesAscii(bytes, "ftyp", 4) && matchesAscii(bytes, "avif", 8)) {
    return "avif";
  }
  return null;
}

/** Why an import failed. */
export type ReferenceDecodeFailure = "not-an-image" | "too-large" | "unsupported" | "malformed";

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
 * One decoded reference: the pixels, and how large they are.
 *
 * The source is the drawable the renderer paints - an `ImageBitmap` in the
 * browser. It is deliberately not a canvas: a reference is drawn once per
 * frame at whatever size it is placed, and copying it into a canvas first
 * would cost a second full-size buffer for nothing.
 */
export interface DecodedReference {
  /** Width of the decoded image, in pixels. */
  readonly width: number;
  /** Height of the decoded image, in pixels. */
  readonly height: number;
  /** The pixels to draw. */
  readonly source: CanvasImageSource;
}

/** The browser calls the decoder needs. */
export interface ReferenceDecodeEnvironment {
  /** Decodes the bytes into a drawable picture. */
  readonly decodeImage: (bytes: Uint8Array, mimeType: string) => Promise<DecodedReference>;
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
    decodeImage: async (bytes, mimeType) => {
      if (typeof createImageBitmap !== "function" || typeof Blob !== "function") {
        throw new ReferenceDecodeError(
          "unsupported",
          "This environment cannot decode images, so a reference cannot be imported.",
        );
      }
      let bitmap: ImageBitmap;
      try {
        // The bytes are copied into a buffer of their own: the caller's
        // buffer may be a view onto a larger one, and a blob must hold
        // exactly these bytes.
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        bitmap = await createImageBitmap(new Blob([copy.buffer], { type: mimeType }));
      } catch {
        throw new ReferenceDecodeError(
          "malformed",
          "The file could not be decoded as an image.",
        );
      }
      if (
        !Number.isFinite(bitmap.width) ||
        !Number.isFinite(bitmap.height) ||
        bitmap.width <= 0 ||
        bitmap.height <= 0
      ) {
        throw new ReferenceDecodeError(
          "malformed",
          "The file could not be decoded as an image.",
        );
      }
      return { width: bitmap.width, height: bitmap.height, source: bitmap };
    },
  };
}

/**
 * Decodes the bytes of an imported file into a drawable picture.
 *
 * The order of the checks is the order of the cost: the size of the bytes is
 * known before anything is decoded, and the format is read from the first
 * bytes before the whole file is handed to the browser. A file that is not an
 * image is therefore refused without ever reaching the decoder, and a file
 * that is too large is refused without ever being decoded.
 */
export async function decodeReferenceImage(
  bytes: Uint8Array,
  environment: ReferenceDecodeEnvironment = browserDecodeEnvironment(),
): Promise<DecodedReference> {
  if (bytes.length === 0) {
    throw new ReferenceDecodeError("not-an-image", "The file is empty.");
  }
  if (bytes.length > MAX_REFERENCE_BYTES) {
    throw new ReferenceDecodeError(
      "too-large",
      `The file is larger than ${Math.round(MAX_REFERENCE_BYTES / (1024 * 1024))} MB, which is more than a reference needs.`,
    );
  }
  const format = detectImageFormat(bytes);
  if (!format) {
    throw new ReferenceDecodeError("not-an-image", "The file is not an image.");
  }

  let decoded: DecodedReference;
  try {
    decoded = await environment.decodeImage(bytes, referenceMimeType(format));
  } catch (error) {
    if (error instanceof ReferenceDecodeError) {
      throw error;
    }
    throw new ReferenceDecodeError(
      "malformed",
      "The file could not be decoded as an image.",
    );
  }

  if (
    !Number.isFinite(decoded.width) ||
    !Number.isFinite(decoded.height) ||
    decoded.width <= 0 ||
    decoded.height <= 0
  ) {
    throw new ReferenceDecodeError("malformed", "The file could not be decoded as an image.");
  }
  if (decoded.width * decoded.height > MAX_REFERENCE_PIXELS) {
    throw new ReferenceDecodeError(
      "too-large",
      "The image is too large to be used as a reference. Please use a smaller picture.",
    );
  }
  return decoded;
}
