/**
 * Coalescing frame scheduler.
 *
 * Multiple render requests within one frame collapse into a single callback,
 * which is how the engine keeps drawing updates off React's render path while
 * still batching work to animation frames. The frame request functions are
 * injectable so the coalescing behaviour is unit testable without a DOM.
 */

export interface FrameSchedulerOptions {
  readonly requestFrame?: (callback: () => void) => number;
  readonly cancelFrame?: (handle: number) => void;
}

export class FrameScheduler {
  private readonly requestFrame: (callback: () => void) => number;
  private readonly cancelFrame: (handle: number) => void;
  private handle: number | null = null;

  constructor(options: FrameSchedulerOptions = {}) {
    this.requestFrame =
      options.requestFrame ?? ((callback) => globalThis.requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((handle) => globalThis.cancelAnimationFrame(handle));
  }

  get pending(): boolean {
    return this.handle !== null;
  }

  /**
   * Requests a frame. When one is already pending the callback is dropped:
   * scheduling is only ever used for renders that read the latest state.
   */
  schedule(callback: () => void): void {
    if (this.handle !== null) {
      return;
    }
    this.handle = this.requestFrame(() => {
      this.handle = null;
      callback();
    });
  }

  cancel(): void {
    if (this.handle === null) {
      return;
    }
    this.cancelFrame(this.handle);
    this.handle = null;
  }
}
