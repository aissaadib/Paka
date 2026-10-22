/**
 * The reference image store.
 *
 * The store owns the references and the one decoded copy of each of them. It
 * is deliberately **outside** the document model: nothing here is serialized,
 * nothing here reaches a layer surface, and nothing here can make a document
 * dirty. Adding, moving, scaling or removing a reference is a change to what
 * the artist sees, not to what they drew.
 *
 * Two rules shape the memory:
 *
 *  - **one decoded copy per reference.** The pixels are decoded once, into a
 *    canvas, and that canvas is what the renderer draws and what the picker
 *    samples. Scaling a reference never decodes anything again - the canvas is
 *    drawn at a different size - so dragging a size slider costs no memory.
 *  - **a budget for the whole session.** The references share one pixel
 *    budget, so a session cannot fill the memory with a dozen huge images. An
 *    import that would exceed it is refused with a message.
 */

import { createId } from "../../utils/id";
import type { Rgb } from "../../utils/color";
import {
  centerReference,
  fitReference,
  MIN_REFERENCE_SIZE,
  moveReference,
  referenceContains,
  referenceSourcePoint,
  scaleReference,
  setReferenceOpacity,
  setReferencePosition,
  setReferenceScale,
  setReferenceSize,
  type WorkspacePoint,
} from "./geometry";
import {
  decodeReferenceImage,
  MAX_TOTAL_REFERENCE_PIXELS,
  type DecodedReference,
} from "./decode";
import type { ReferenceImage, ReferenceSource, ReferenceState } from "./types";

/** A file the artist chose to import. */
export interface ReferenceInput {
  /** The bytes to decode. */
  readonly blob: Blob;
  /** The name to show in the panel. */
  readonly name: string;
}

/** How a new reference is placed when it arrives. */
export interface ReferenceStoreOptions {
  /** Decodes an imported file; replaced in tests. */
  readonly decode?: (file: Blob) => Promise<DecodedReference>;
  /** Generates reference ids; replaced in tests. */
  readonly createId?: () => string;
}

/** The margin between a new reference and the edge of the workspace. */
const PLACEMENT_MARGIN = 16;
/**
 * The share of the workspace a new reference may take.
 *
 * A reference is a *reference*: it is meant to sit beside the artwork, not to
 * cover it, so a new one arrives small enough to leave the paper alone.
 */
const PLACEMENT_SHARE = 0.6;

export class ReferenceImageStore implements ReferenceSource {
  private state: ReferenceState = {
    references: [],
    selectedId: null,
    busy: false,
    notice: null,
  };

  /** The decoded pixels, one entry per reference. */
  private readonly decoded = new Map<string, DecodedReference>();

  private readonly listeners = new Set<() => void>();

  private readonly decode: (file: Blob) => Promise<DecodedReference>;

  private readonly nextId: () => string;

  /** The workspace the references are placed in, in workspace pixels. */
  private viewportSize = { width: 0, height: 0 };

  /** The decoded pixels currently held, for the session budget. */
  private decodedPixels = 0;

  constructor(options: ReferenceStoreOptions = {}) {
    this.decode = options.decode ?? ((file) => decodeReferenceImage(file));
    this.nextId = options.createId ?? (() => createId("reference"));
  }

  // ------------------------------------------------------------- the state

  getState = (): ReferenceState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get references(): readonly ReferenceImage[] {
    return this.state.references;
  }

  get selectedId(): string | null {
    return this.state.selectedId;
  }

  sourceFor(id: string): CanvasImageSource | null {
    return this.decoded.get(id)?.canvas ?? null;
  }

  setViewportSize(width: number, height: number): void {
    if (width === this.viewportSize.width && height === this.viewportSize.height) {
      return;
    }
    this.viewportSize = { width, height };
  }

  // ----------------------------------------------------------- the reading

  /**
   * The topmost visible reference under a workspace point.
   *
   * The last reference in the list is drawn on top, so the list is searched
   * from the back. A hidden reference is skipped: it is not on the canvas, so
   * a press under it belongs to whatever is underneath.
   */
  hitTest(x: number, y: number): ReferenceImage | null {
    const references = this.state.references;
    for (let index = references.length - 1; index >= 0; index -= 1) {
      const reference = references[index];
      if (!reference.visible) {
        continue;
      }
      if (referenceContains(reference, x, y)) {
        return reference;
      }
    }
    return null;
  }

  /**
   * The colour of the reference pixel under a workspace point.
   *
   * The point is mapped through the reference's *placement*, so a reference
   * that is scaled or moved is sampled at the pixel the artist is pointing at
   * and not at the pixel that happens to share the same coordinates in the
   * original image.
   *
   * The colour is the reference's own pixel, not a blend with the artwork
   * underneath: an artist sampling a reference wants the colour of the
   * reference, not the colour of a 40 %-opacity overlay on top of a stroke.
   */
  sampleAt(x: number, y: number): Rgb | null {
    const reference = this.hitTest(x, y);
    if (!reference) {
      return null;
    }
    const point = referenceSourcePoint(reference, x, y);
    if (!point) {
      return null;
    }
    const decoded = this.decoded.get(reference.id);
    if (!decoded) {
      return null;
    }
    try {
      const data = decoded.context.getImageData(point.x, point.y, 1, 1).data;
      return { r: data[0], g: data[1], b: data[2] };
    } catch {
      // A canvas that cannot be read (a tainted one) yields no colour rather
      // than an exception in the middle of a pointer press.
      return null;
    }
  }

  // ---------------------------------------------------------- the changing

  /**
   * Imports an image as a reference.
   *
   * Returns whether the reference was added. A file that cannot be decoded, or
   * one that would not fit the session's pixel budget, is refused with a
   * message the panel shows; the store is left as it was.
   */
  async add(input: ReferenceInput): Promise<boolean> {
    this.update({ busy: true, notice: null });
    let decoded: DecodedReference;
    try {
      decoded = await this.decode(input.blob);
    } catch (error) {
      this.update({
        busy: false,
        notice: describeDecodeFailure(error, input.name),
      });
      return false;
    }

    const pixels = decoded.width * decoded.height;
    if (this.decodedPixels + pixels > MAX_TOTAL_REFERENCE_PIXELS) {
      this.update({
        busy: false,
        notice: `There is not enough memory left for another reference. Remove one before adding "${input.name}".`,
      });
      return false;
    }

    const reference = this.createReference(input.name, decoded);
    this.decoded.set(reference.id, decoded);
    this.decodedPixels += pixels;
    this.update({
      references: [...this.state.references, reference],
      selectedId: reference.id,
      busy: false,
      notice: null,
    });
    return true;
  }

  /** Removes a reference and releases its pixels. */
  remove(id: string): void {
    const reference = this.state.references.find((candidate) => candidate.id === id);
    if (!reference) {
      return;
    }
    const decoded = this.decoded.get(id);
    if (decoded) {
      this.decodedPixels -= decoded.width * decoded.height;
      this.decoded.delete(id);
    }
    this.update({
      references: this.state.references.filter((candidate) => candidate.id !== id),
      selectedId: this.state.selectedId === id ? null : this.state.selectedId,
    });
  }

  /** Removes every reference. */
  clear(): void {
    if (this.state.references.length === 0) {
      return;
    }
    this.decoded.clear();
    this.decodedPixels = 0;
    this.update({ references: [], selectedId: null });
  }

  /** Shows or hides a reference. A hidden reference is not sampled either. */
  setVisible(id: string, visible: boolean): void {
    this.replace(id, (reference) => ({ ...reference, visible }));
  }

  /** Selects a reference, or clears the selection with `null`. */
  select(id: string | null): void {
    if (id !== null && !this.state.references.some((reference) => reference.id === id)) {
      return;
    }
    if (this.state.selectedId === id) {
      return;
    }
    this.update({ selectedId: id });
  }

  /** Moves a reference by a workspace delta. */
  move(id: string, dx: number, dy: number): void {
    this.replace(id, (reference) => moveReference(reference, dx, dy));
  }

  /** Moves a reference to an absolute workspace position. */
  setPosition(id: string, x: number, y: number): void {
    this.replace(id, (reference) => setReferencePosition(reference, x, y));
  }

  /**
   * Scales a reference about an anchor.
   *
   * The anchor defaults to the centre of the reference, which is what a size
   * control means; a corner handle would pass the corner it grabbed.
   */
  scale(id: string, factor: number, anchor?: WorkspacePoint): void {
    this.replace(id, (reference) =>
      scaleReference(
        reference,
        factor,
        anchor ?? {
          x: reference.x + reference.width / 2,
          y: reference.y + reference.height / 2,
        },
      ),
    );
  }

  /** Sets the displayed size of a reference. */
  setSize(id: string, width: number, height: number): void {
    this.replace(id, (reference) => setReferenceSize(reference, width, height));
  }

  /**
   * Sets how large a reference is drawn relative to its own pixels.
   *
   * The reference grows about its centre, so a size slider does not move the
   * image away from where the artist put it.
   */
  setScale(id: string, scale: number): void {
    this.replace(id, (reference) => setReferenceScale(reference, scale));
  }

  /** Sets how opaque a reference is drawn. */
  setOpacity(id: string, opacity: number): void {
    this.replace(id, (reference) => setReferenceOpacity(reference, opacity));
  }

  /** Fits a reference into the workspace, keeping its aspect ratio. */
  fitToView(id: string): void {
    const view = this.workspaceView();
    if (!view) {
      return;
    }
    this.replace(id, (reference) => fitReference(reference, view));
  }

  /** Restores a reference to its natural size, in place. */
  resetSize(id: string): void {
    this.replace(id, (reference) =>
      setReferenceSize(reference, reference.naturalWidth, reference.naturalHeight),
    );
  }

  /** Centres a reference in the workspace. */
  center(id: string): void {
    const view = this.workspaceView();
    if (!view) {
      return;
    }
    this.replace(id, (reference) => centerReference(reference, view));
  }

  /** Clears the message the last import left behind. */
  dismissNotice(): void {
    if (this.state.notice === null) {
      return;
    }
    this.update({ notice: null });
  }

  /** Releases every pixel the store holds. */
  dispose(): void {
    this.decoded.clear();
    this.decodedPixels = 0;
    this.listeners.clear();
  }

  // ------------------------------------------------------------- the inside

  /**
   * The workspace rectangle, or `null` when the size is not known yet.
   *
   * The canvas reports its size when it is laid out, which is before the
   * artist can add a reference; until then there is nothing to fit into, and
   * a placement that guessed a size would be wrong anyway.
   */
  private workspaceView(): { readonly width: number; readonly height: number } | null {
    if (this.viewportSize.width <= 0 || this.viewportSize.height <= 0) {
      return null;
    }
    return { width: this.viewportSize.width, height: this.viewportSize.height };
  }

  /**
   * Places a new reference.
   *
   * The image arrives at its natural size when that fits the workspace, and
   * is scaled down when it does not. It is placed in the top-left corner,
   * which is the part of the workspace least likely to hold the paper. When
   * the workspace has not reported its size yet, the image simply arrives at
   * its own size.
   */
  private createReference(name: string, decoded: DecodedReference): ReferenceImage {
    const view = this.workspaceView();
    const naturalWidth = Math.max(MIN_REFERENCE_SIZE, decoded.width);
    const naturalHeight = Math.max(MIN_REFERENCE_SIZE, decoded.height);
    if (!view) {
      return {
        id: this.nextId(),
        name,
        x: PLACEMENT_MARGIN,
        y: PLACEMENT_MARGIN,
        width: naturalWidth,
        height: naturalHeight,
        naturalWidth: decoded.width,
        naturalHeight: decoded.height,
        visible: true,
        opacity: 1,
      };
    }
    const maxWidth = Math.max(MIN_REFERENCE_SIZE, view.width * PLACEMENT_SHARE - PLACEMENT_MARGIN);
    const maxHeight = Math.max(
      MIN_REFERENCE_SIZE,
      view.height * PLACEMENT_SHARE - PLACEMENT_MARGIN,
    );
    const factor = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight);
    const width = Math.max(MIN_REFERENCE_SIZE, naturalWidth * factor);
    const height = Math.max(MIN_REFERENCE_SIZE, naturalHeight * factor);
    return {
      id: this.nextId(),
      name,
      x: PLACEMENT_MARGIN,
      y: PLACEMENT_MARGIN,
      width,
      height,
      naturalWidth: decoded.width,
      naturalHeight: decoded.height,
      visible: true,
      opacity: 1,
    };
  }

  /** Replaces one reference, keeping the list order. */
  private replace(id: string, change: (reference: ReferenceImage) => ReferenceImage): void {
    let changed = false;
    const references = this.state.references.map((reference) => {
      if (reference.id !== id) {
        return reference;
      }
      const next = change(reference);
      // The change functions build a new object every time, so the fields are
      // compared rather than the identity: a control that sets the value it
      // already holds must not wake the renderer up for nothing.
      changed =
        next.x !== reference.x ||
        next.y !== reference.y ||
        next.width !== reference.width ||
        next.height !== reference.height ||
        next.visible !== reference.visible ||
        next.opacity !== reference.opacity;
      return next;
    });
    if (!changed) {
      return;
    }
    this.update({ references });
  }

  /** Publishes a new state and tells the listeners. */
  private update(patch: Partial<ReferenceState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/** The message a failed import leaves behind. */
function describeDecodeFailure(error: unknown, name: string): string {
  if (error instanceof Error && error.message) {
    return `${name}: ${error.message}`;
  }
  return `"${name}" could not be imported as a reference image.`;
}
