/**
 * The reference image store.
 *
 * The store owns the references and the one decoded copy of each of them. It
 * is deliberately **outside** the document model: nothing here is serialized,
 * nothing here reaches a layer surface, and nothing here can make a document
 * dirty. Adding, moving, scaling or removing a reference is a change to what
 * the artist sees, not to what they drew.
 *
 * The list is the **drawing order**. The first entry is drawn first, so it is
 * the bottom-most reference, and the last entry is drawn last, so it is the
 * top-most one. A reference that sits behind the artwork is drawn before the
 * artwork and one that sits over it after, but within each of those two groups
 * the order is the list order: the artist decides which reference covers
 * which by moving it in the list.
 *
 * Two rules shape the memory:
 *
 *  - **one decoded copy per reference.** The pixels are decoded once and kept
 *    here; the renderer draws that copy and never sees the bytes. Scaling a
 *    reference decodes nothing again - the picture is drawn at a different
 *    size - so dragging a size control costs no memory.
 *  - **a budget for the whole session.** The references share one pixel
 *    budget, so a session cannot fill the memory with a dozen huge images. An
 *    import that would exceed it is refused, and the store is left as it was.
 */

import { createId } from "../../utils/id";
import {
  MAX_TOTAL_REFERENCE_PIXELS,
  type DecodedReference,
} from "./decode";
import type { ReferenceImage, ReferenceImagePatch } from "./types";

/** How a new reference is described to {@link createReferenceImage}. */
export interface ReferenceImageOptions {
  /** The file name the image was imported from. */
  readonly name: string;
  /** Width of the decoded image, in its own pixels. */
  readonly naturalWidth: number;
  /** Height of the decoded image, in its own pixels. */
  readonly naturalHeight: number;
  /** The id to give the reference; generated when it is not given. */
  readonly id?: string;
  /** Left edge, in document pixels. Defaults to the paper's origin. */
  readonly x?: number;
  /** Top edge, in document pixels. Defaults to the paper's origin. */
  readonly y?: number;
  /** Displayed width, in document pixels. Defaults to the natural width. */
  readonly width?: number;
  /** Displayed height, in document pixels. Defaults to the natural height. */
  readonly height?: number;
  /** How opaque the reference is drawn, `0..1`. Defaults to fully opaque. */
  readonly opacity?: number;
  /** The blend mode the reference is composited with. Defaults to `normal`. */
  readonly blendMode?: ReferenceImage["blendMode"];
  /** Whether the reference sits behind the artwork. Defaults to `false`. */
  readonly behind?: boolean;
  /** Whether the reference is drawn. Defaults to `true`. */
  readonly visible?: boolean;
}

/**
 * Builds a reference image record.
 *
 * The defaults place the image on the paper at its natural size: one image
 * pixel is one document pixel. Nothing here looks at the window, so the
 * placement is the same on every machine.
 */
export function createReferenceImage(
  options: ReferenceImageOptions,
  nextId: () => string = () => createId("reference"),
): ReferenceImage {
  const naturalWidth = Math.max(0, options.naturalWidth);
  const naturalHeight = Math.max(0, options.naturalHeight);
  return {
    id: options.id ?? nextId(),
    name: options.name,
    x: options.x ?? 0,
    y: options.y ?? 0,
    width: options.width ?? naturalWidth,
    height: options.height ?? naturalHeight,
    naturalWidth,
    naturalHeight,
    opacity: options.opacity ?? 1,
    blendMode: options.blendMode ?? "normal",
    behind: options.behind ?? false,
    visible: options.visible ?? true,
  };
}

/** Why a reference could not be added. */
export type ReferenceStoreFailure = "budget" | "duplicate" | "missing";

/** The outcome of adding a reference. */
export type ReferenceStoreOutcome =
  | { readonly ok: true; readonly reference: ReferenceImage }
  | { readonly ok: false; readonly reason: ReferenceStoreFailure; readonly message: string };

/** How the store is set up. */
export interface ReferenceStoreOptions {
  /** Generates reference ids; replaced in tests. */
  readonly createId?: () => string;
}

export class ReferenceImageStore {
  /** The references, in drawing order: the first is the bottom-most. */
  private items: readonly ReferenceImage[] = [];

  /** The decoded pixels, one entry per reference. */
  private readonly decoded = new Map<string, DecodedReference>();

  /** The decoded pixels currently held, for the session budget. */
  private decodedPixels = 0;

  private readonly nextId: () => string;

  constructor(options: ReferenceStoreOptions = {}) {
    this.nextId = options.createId ?? (() => createId("reference"));
  }

  /** The references, in drawing order. */
  list(): readonly ReferenceImage[] {
    return this.items;
  }

  /** How many references the store holds. */
  count(): number {
    return this.items.length;
  }

  /** One reference by id, or `null`. */
  find(id: string): ReferenceImage | null {
    return this.items.find((reference) => reference.id === id) ?? null;
  }

  /** The position of a reference in the drawing order, or `-1`. */
  indexOf(id: string): number {
    return this.items.findIndex((reference) => reference.id === id);
  }

  /** The decoded pixels of one reference, or `null` when it has none. */
  sourceFor(id: string): CanvasImageSource | null {
    return this.decoded.get(id)?.source ?? null;
  }

  /** The decoded pixels of one reference, or `null` when it has none. */
  decodedFor(id: string): DecodedReference | null {
    return this.decoded.get(id) ?? null;
  }

  /** The decoded pixels the store holds, in pixels. */
  decodedPixelCount(): number {
    return this.decodedPixels;
  }

  /** The decoded pixels the session can still hold, in pixels. */
  remainingPixelBudget(): number {
    return Math.max(0, MAX_TOTAL_REFERENCE_PIXELS - this.decodedPixels);
  }

  /**
   * Builds a reference and adds it on top of the others.
   *
   * The store owns the ids, so two references can never share one.
   */
  create(
    options: Omit<ReferenceImageOptions, "id">,
    decoded?: DecodedReference,
  ): ReferenceStoreOutcome {
    const reference = createReferenceImage({ ...options, id: this.nextId() });
    return this.add(reference, decoded);
  }

  /**
   * Adds a reference on top of the others.
   *
   * The decoded picture is optional: a reference may be placed before its
   * bytes have arrived. When it is given, the session's pixel budget is
   * checked first and the store is left untouched if the picture does not
   * fit.
   */
  add(reference: ReferenceImage, decoded?: DecodedReference): ReferenceStoreOutcome {
    return this.insert(reference, this.items.length, decoded);
  }

  /**
   * Inserts a reference at a position in the drawing order.
   *
   * The position is clamped to the list, so an insert can never lose a
   * reference.
   */
  insert(
    reference: ReferenceImage,
    index: number,
    decoded?: DecodedReference,
  ): ReferenceStoreOutcome {
    if (this.indexOf(reference.id) !== -1) {
      return {
        ok: false,
        reason: "duplicate",
        message: `A reference with the id "${reference.id}" already exists.`,
      };
    }
    const pixels = decoded ? decoded.width * decoded.height : 0;
    if (pixels > this.remainingPixelBudget()) {
      return {
        ok: false,
        reason: "budget",
        message: `There is not enough memory left for another reference. Remove one before adding "${reference.name}".`,
      };
    }
    const at = Math.max(0, Math.min(Math.trunc(index), this.items.length));
    const items = [...this.items];
    items.splice(at, 0, reference);
    this.items = items;
    if (decoded) {
      this.decoded.set(reference.id, decoded);
      this.decodedPixels += pixels;
    }
    return { ok: true, reference };
  }

  /**
   * Gives a reference its decoded picture, once the bytes have been decoded.
   *
   * The session's pixel budget is checked first, and the store is left
   * untouched when the picture does not fit.
   */
  attachDecoded(id: string, decoded: DecodedReference): ReferenceStoreOutcome {
    const reference = this.find(id);
    if (!reference) {
      return {
        ok: false,
        reason: "missing",
        message: "There is no such reference.",
      };
    }
    const pixels = decoded.width * decoded.height;
    const held = this.decoded.get(id);
    const heldPixels = held ? held.width * held.height : 0;
    if (pixels - heldPixels > this.remainingPixelBudget()) {
      return {
        ok: false,
        reason: "budget",
        message: `There is not enough memory left for another reference. Remove one before adding "${reference.name}".`,
      };
    }
    this.decoded.set(id, decoded);
    this.decodedPixels += pixels - heldPixels;
    return { ok: true, reference };
  }

  /**
   * Removes a reference and releases its pixels.
   *
   * The removed reference is returned, so a caller can undo the removal; the
   * pixels are released, because the picture is gone with it.
   */
  remove(id: string): ReferenceImage | null {
    const index = this.indexOf(id);
    if (index === -1) {
      return null;
    }
    const items = [...this.items];
    const [removed] = items.splice(index, 1);
    this.items = items;
    const decoded = this.decoded.get(id);
    if (decoded) {
      this.decodedPixels -= decoded.width * decoded.height;
      this.decoded.delete(id);
    }
    return removed ?? null;
  }

  /**
   * Replaces a reference with a new version of the same id.
   *
   * The position in the drawing order is kept: changing a reference's size or
   * opacity must not move it in front of the others.
   */
  replace(reference: ReferenceImage): boolean {
    const index = this.indexOf(reference.id);
    if (index === -1) {
      return false;
    }
    const items = [...this.items];
    items[index] = reference;
    this.items = items;
    return true;
  }

  /** Applies a patch to a reference, keeping its position. */
  update(id: string, patch: ReferenceImagePatch): boolean {
    const reference = this.find(id);
    if (!reference) {
      return false;
    }
    return this.replace({ ...reference, ...patch });
  }

  /**
   * Moves a reference to another position in the drawing order.
   *
   * The position is clamped to the list, and a reference that is already
   * there is left alone. The order is the drawing order, so moving a
   * reference up brings it in front of the ones above it.
   */
  reorder(id: string, index: number): boolean {
    const from = this.indexOf(id);
    if (from === -1) {
      return false;
    }
    const to = Math.max(0, Math.min(Math.trunc(index), this.items.length - 1));
    if (to === from) {
      return false;
    }
    const items = [...this.items];
    const [moved] = items.splice(from, 1);
    if (!moved) {
      return false;
    }
    items.splice(to, 0, moved);
    this.items = items;
    return true;
  }

  /**
   * The references that are drawn behind the artwork, in drawing order.
   *
   * The list order is kept: the first of them is drawn first, so it is the
   * one furthest behind.
   */
  behind(): readonly ReferenceImage[] {
    return this.items.filter((reference) => reference.behind);
  }

  /**
   * The references that are drawn over the artwork, in drawing order.
   *
   * The last of them is the top-most reference.
   */
  over(): readonly ReferenceImage[] {
    return this.items.filter((reference) => !reference.behind);
  }

  /** Removes every reference and releases every pixel. */
  clear(): void {
    this.items = [];
    this.decoded.clear();
    this.decodedPixels = 0;
  }
}
