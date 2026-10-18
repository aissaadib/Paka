/**
 * PNG export tests.
 *
 * The composited canvas is produced by the renderer and is covered by the
 * renderer suite; here the concern is the encoding step either side of it: that
 * the canvas handed to the encoder is the document composite (not the display),
 * that failures are reported rather than turned into truncated files, and that
 * the real `canvas.toBlob` path is wired up correctly.
 */

import { describe, expect, it, vi } from "vitest";
import { encodeCanvasToPng, renderDocumentPng } from "../core/export/pngExport";
import { installRecordingDocument, PNG_SIGNATURE, RecordingCanvas } from "./support/recordingCanvas";

function withRecordingCanvas<T>(run: (canvas: RecordingCanvas) => T): T {
  const recording = installRecordingDocument();
  try {
    return run(new RecordingCanvas());
  } finally {
    recording.restore();
  }
}

describe("renderDocumentPng", () => {
  it("encodes the document composite and returns its bytes", async () => {
    const canvas = new RecordingCanvas();
    canvas.width = 640;
    canvas.height = 480;
    const source = { renderDocumentImage: vi.fn(() => canvas.asElement()) };
    const encode = vi.fn(async () => new Uint8Array([1, 2, 3]));

    const bytes = await renderDocumentPng(source, encode);

    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(source.renderDocumentImage).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledWith(canvas.asElement());
  });

  it("uses the browser encoder by default", async () => {
    await withRecordingCanvas(async (canvas) => {
      canvas.width = 32;
      canvas.height = 16;

      const bytes = await renderDocumentPng({ renderDocumentImage: () => canvas.asElement() });

      expect(bytes).toEqual(PNG_SIGNATURE);
      expect(canvas.blobTypes).toEqual(["image/png"]);
    });
  });

  it("refuses a document with no size", async () => {
    const canvas = new RecordingCanvas();
    const encode = vi.fn(async () => new Uint8Array([1]));

    await expect(
      renderDocumentPng({ renderDocumentImage: () => canvas.asElement() }, encode),
    ).rejects.toThrow(/no size/);
    expect(encode).not.toHaveBeenCalled();
  });

  it("refuses empty encoder output instead of writing a truncated file", async () => {
    const canvas = new RecordingCanvas();
    canvas.width = 10;
    canvas.height = 10;

    await expect(
      renderDocumentPng({ renderDocumentImage: () => canvas.asElement() }, async () => new Uint8Array()),
    ).rejects.toThrow(/no data/);
  });

  it("propagates an encoder failure", async () => {
    const canvas = new RecordingCanvas();
    canvas.width = 10;
    canvas.height = 10;

    await expect(
      renderDocumentPng({ renderDocumentImage: () => canvas.asElement() }, async () => {
        throw new Error("out of memory");
      }),
    ).rejects.toThrow("out of memory");
  });
});

describe("encodeCanvasToPng", () => {
  it("decodes the blob the platform returns", async () => {
    await withRecordingCanvas(async (canvas) => {
      canvas.blobBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

      await expect(encodeCanvasToPng(canvas.asElement())).resolves.toEqual(
        new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      );
    });
  });

  it("reports a platform that produces no blob", async () => {
    await withRecordingCanvas(async (canvas) => {
      canvas.blobBytes = null;

      await expect(encodeCanvasToPng(canvas.asElement())).rejects.toThrow(/could not be encoded/);
    });
  });

  it("reports an environment without canvas support", async () => {
    const bare = {} as HTMLCanvasElement;

    await expect(encodeCanvasToPng(bare)).rejects.toThrow(/not available/);
  });
});
