/**
 * A Canvas 2D stand-in for tests that must run in plain Node.
 *
 * `RecordingCanvas` logs every draw call together with the state
 * (`globalAlpha`, composite operation, `fillStyle`, `lineWidth`) that was live
 * when the call was made. That is enough to pin down compositing rules without a
 * real rasterizer: which canvas was painted, in what order, at what alpha, with
 * which transform.
 *
 * `installRecordingDocument` wires it up as `globalThis.document`, because both
 * the renderer and the PNG export create canvases with `document.createElement`.
 */

/** Context members the renderer, the stroke rasterizer and export actually call. */
export const RECORDED_METHODS = [
  "save",
  "restore",
  "setTransform",
  "transform",
  "clearRect",
  "fillRect",
  "drawImage",
  "beginPath",
  "moveTo",
  "lineTo",
  "arc",
  "closePath",
  "fill",
  "stroke",
  "strokeRect",
  "putImageData",
  "fillText",
] as const;

export interface DrawCall {
  readonly name: string;
  readonly args: readonly unknown[];
  /** `globalAlpha` at the moment of the call. */
  readonly alpha: number;
  readonly composite: string;
  readonly fillStyle: unknown;
  readonly strokeStyle: unknown;
  readonly lineWidth: number;
  /** `lineDash` at the moment of the call; `[]` when solid. */
  readonly lineDash: readonly number[];
  /** `filter` at the moment of the call; `"none"` when unfiltered. */
  readonly filter: string;
}

/** The 8-byte PNG file signature, used as stand-in encoder output. */
export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class RecordingCanvas {
  width = 0;
  height = 0;
  readonly calls: DrawCall[] = [];
  readonly ctx: CanvasRenderingContext2D;
  /** What `toBlob` hands back; `null` simulates an encoder failure. */
  blobBytes: Uint8Array | null = PNG_SIGNATURE;
  /** MIME types `toBlob` was asked for, in order. */
  readonly blobTypes: string[] = [];
  /** What `getImageData` returns; a transparent black pixel by default. */
  imageData: Uint8ClampedArray = new Uint8ClampedArray(4);
  /** Arguments of every `getImageData` call, in order. */
  readonly getImageDataCalls: [number, number, number, number][] = [];

  constructor() {
    const ctx = {
      canvas: this,
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
      lineDash: [] as number[],
      filter: "none",
    };

    const record =
      (name: string) =>
      (...args: unknown[]): void => {
        this.calls.push({
          name,
          args,
          alpha: ctx.globalAlpha,
          composite: ctx.globalCompositeOperation,
          fillStyle: ctx.fillStyle,
          strokeStyle: ctx.strokeStyle,
          lineWidth: ctx.lineWidth,
          lineDash: [...ctx.lineDash],
          filter: ctx.filter,
        });
      };

    for (const name of RECORDED_METHODS) {
      (ctx as unknown as Record<string, unknown>)[name] = record(name);
    }

    // `setLineDash` both records a call and updates state, so every later call
    // reports the dash it was drawn with - which is how a marquee rectangle is
    // told from the solid document border.
    (ctx as unknown as Record<string, unknown>).setLineDash = (
      segments: number[] = [],
    ): void => {
      ctx.lineDash = [...segments];
      record("setLineDash")(segments);
    };

    // Text measurement is a read, not a draw call: the ruler and the guide
    // labels ask for the width of a string to size the chip behind it. The
    // stand-in answers with a fixed advance per character, which is enough for
    // a test to tell one label from another.
    (ctx as unknown as Record<string, unknown>).measureText = (
      text: string,
    ): TextMetrics =>
      ({
        width: String(text).length * 6,
        actualBoundingBoxAscent: 8,
        actualBoundingBoxDescent: 2,
      }) as unknown as TextMetrics;

    // Pixel reads are not draw calls, so they are recorded separately: the
    // renderer's colour probe is asserted from the returned value and the
    // sampled rectangle rather than from the draw stream.
    (ctx as unknown as Record<string, unknown>).getImageData = (
      x: number,
      y: number,
      width: number,
      height: number,
    ): ImageData => {
      this.getImageDataCalls.push([x, y, width, height]);
      return {
        data: this.imageData,
        width,
        height,
        colorSpace: "srgb",
      } as unknown as ImageData;
    };
    // Gradients are objects with their own `addColorStop`; the surface keeps
    // the returned value as `fillStyle`, so tests can inspect the geometry and
    // stops that painted a rectangle.
    const gradient =
      (kind: "linear" | "radial") =>
      (...args: unknown[]): CanvasGradient => {
        const stops: { offset: number; color: string }[] = [];
        const object = {
          kind,
          args,
          stops,
          addColorStop(offset: number, color: string): void {
            stops.push({ offset, color });
          },
        };
        record(`create${kind === "linear" ? "Linear" : "Radial"}Gradient`)(...args);
        return object as unknown as CanvasGradient;
      };
    (ctx as unknown as Record<string, unknown>).createLinearGradient = gradient("linear");
    (ctx as unknown as Record<string, unknown>).createRadialGradient = gradient("radial");
    // The texture pass fills a scratch canvas with a repeating pattern under
    // `destination-in`; tests inspect the recorded pattern and its transform.
    (ctx as unknown as Record<string, unknown>).createPattern = (
      image: unknown,
      repetition: string,
    ): CanvasPattern => {
      const object = {
        kind: "pattern",
        image,
        repetition,
        transform: null as unknown,
        setTransform(transform: unknown): void {
          this.transform = transform;
        },
      };
      record("createPattern")(image, repetition);
      return object as unknown as CanvasPattern;
    };
    // Fill patches upload their own RGBA pixels before being drawn onto a
    // surface, so the test harness needs both halves of that path.
    (ctx as unknown as Record<string, unknown>).createImageData = (
      width: number,
      height: number,
    ): ImageData =>
      ({
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
        colorSpace: "srgb",
      }) as unknown as ImageData;
    this.ctx = ctx as unknown as CanvasRenderingContext2D;
  }

  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  toBlob(callback: (blob: Blob | null) => void, type?: string): void {
    const mime = type ?? "image/png";
    this.blobTypes.push(mime);
    if (this.blobBytes === null) {
      callback(null);
      return;
    }
    callback(new Blob([Uint8Array.from(this.blobBytes)], { type: mime }));
  }

  named(name: string): DrawCall[] {
    return this.calls.filter((call) => call.name === name);
  }

  /** Calls that painted another canvas: a layer surface or the stroke buffer. */
  get drawImages(): DrawCall[] {
    return this.named("drawImage");
  }

  /** Sources of the canvases this context painted, in call order. */
  get drawnSources(): unknown[] {
    return this.drawImages.map((call) => call.args[0]);
  }

  /** The recorded canvas as the DOM type the app expects. */
  asElement(): HTMLCanvasElement {
    return this as unknown as HTMLCanvasElement;
  }
}

export interface RecordingDocument {
  /** Every canvas created through `document.createElement`, in creation order. */
  readonly allocated: RecordingCanvas[];
  restore(): void;
}

/** Installs the recording canvas factory; `restore()` puts the global back. */
export function installRecordingDocument(): RecordingDocument {
  const saved = (globalThis as { document?: unknown }).document;
  const allocated: RecordingCanvas[] = [];

  (globalThis as { document?: unknown }).document = {
    createElement: (): RecordingCanvas => {
      const canvas = new RecordingCanvas();
      allocated.push(canvas);
      return canvas;
    },
  };

  return {
    allocated,
    restore(): void {
      (globalThis as { document?: unknown }).document = saved;
    },
  };
}
