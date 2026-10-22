/**
 * Stand-ins for the DOM members the input binder uses.
 *
 * The binder owns the pointer lifecycle - capture, cancel, lost capture, the
 * window losing focus - and none of that needs a browser: it needs listeners,
 * a bounding rectangle and the pointer capture API. These fakes provide
 * exactly those, so the lifecycle can be driven in plain Node.
 */

/** A listener registered on a fake target. */
export type FakeListener = (event: never) => void;

/** The members of `EventTarget` the binder uses. */
export class FakeEventTarget {
  readonly listeners = new Map<string, Set<FakeListener>>();

  addEventListener(type: string, listener: FakeListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: FakeListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** Delivers an event to every listener registered for the type. */
  dispatch(type: string, event: unknown = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      (listener as (value: unknown) => void)(event);
    }
  }

  /** How many listeners are registered for the type. */
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

/** A stand-in for the drawing surface's element. */
export class FakePointerTarget extends FakeEventTarget {
  /** The surface's rectangle in client coordinates. */
  rect = { left: 0, top: 0, width: 800, height: 600 };
  /** The pointers the surface currently holds the capture for. */
  readonly captured = new Set<number>();
  /** How often the surface was asked for its rectangle. */
  rectReads = 0;

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    this.rectReads += 1;
    return this.rect;
  }

  setPointerCapture(pointerId: number): void {
    this.captured.add(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.captured.delete(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.captured.has(pointerId);
  }
}

/** A stand-in for the document, with the visibility the binder asks about. */
export class FakeDocument extends FakeEventTarget {
  visibilityState: "visible" | "hidden" = "visible";
}

export interface FakePointerEventInit {
  readonly pointerId?: number;
  readonly pointerType?: string;
  readonly isPrimary?: boolean;
  readonly button?: number;
  readonly buttons?: number;
  readonly clientX?: number;
  readonly clientY?: number;
  readonly pressure?: number;
  readonly tiltX?: number;
  readonly tiltY?: number;
  readonly timeStamp?: number;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  /**
   * The sub-frame samples the browser coalesced into this move.
   *
   * The browser's list ends with the move itself, so the fake builds the same
   * list: the coalesced samples first, the move last.
   */
  readonly coalesced?: readonly FakePointerEventInit[];
}

/** A pointer event shaped like the DOM one, without a browser. */
export function createPointerEvent(init: FakePointerEventInit = {}): PointerEvent {
  const event = {
    pointerId: init.pointerId ?? 1,
    pointerType: init.pointerType ?? "mouse",
    isPrimary: init.isPrimary ?? true,
    button: init.button ?? 0,
    buttons: init.buttons ?? 1,
    clientX: init.clientX ?? 100,
    clientY: init.clientY ?? 50,
    pressure: init.pressure ?? 0.5,
    tiltX: init.tiltX ?? 0,
    tiltY: init.tiltY ?? 0,
    timeStamp: init.timeStamp ?? 1000,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    getCoalescedEvents(): readonly PointerEvent[] {
      const earlier = (init.coalesced ?? []).map((entry) => createPointerEvent(entry));
      return [...earlier, event as unknown as PointerEvent];
    },
  };
  return event as unknown as PointerEvent;
}
