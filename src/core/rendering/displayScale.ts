/**
 * Device pixel ratio handling.
 *
 * The ratio is the number of device pixels per CSS pixel, so it decides both
 * how big the drawing surface's backing store has to be and how finely the
 * layer surfaces are rasterized.
 *
 * Reading it is easy; **noticing that it changed** is the hard part. The
 * CSSOM View specification does not fire a `resize` event for a ratio change,
 * and moving a window to a display with a different ratio does not have to
 * change the window's size. The one signal that does fire is a media query on
 * the ratio itself: `(resolution: 2dppx)` stops matching the moment the
 * ratio becomes 1.5, and the browser says so.
 *
 * The watcher re-arms itself after every change, because a media query is
 * pinned to the ratio it was created for: once the ratio has moved, the old
 * query can never match again.
 */

/**
 * The ratio to use, or `1` when the browser reports nothing usable.
 *
 * A ratio of zero, a negative number, `NaN` or `Infinity` would make the
 * backing store size meaningless, so it falls back to `1`.
 */
export function resolveDevicePixelRatio(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/**
 * The part of a `MediaQueryList` the watcher uses.
 *
 * Structural, so the watcher can be driven without a DOM.
 */
export interface MediaQueryListLike {
  readonly matches: boolean;
  addEventListener?(type: "change", listener: (event: unknown) => void): void;
  removeEventListener?(type: "change", listener: (event: unknown) => void): void;
  /** The pre-2019 API, kept for engines that still only offer it. */
  addListener?(listener: (event: unknown) => void): void;
  removeListener?(listener: (event: unknown) => void): void;
}

export interface WatchDevicePixelRatioOptions {
  /** Called with the new ratio whenever it changes. */
  readonly onChange: (ratio: number) => void;
  /** The media query factory; defaults to the global `matchMedia`. */
  readonly matchMedia?: (query: string) => MediaQueryListLike;
  /** Reads the current ratio; defaults to the global `devicePixelRatio`. */
  readonly readRatio?: () => number;
}

function defaultMatchMedia(query: string): MediaQueryListLike {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    throw new Error("matchMedia is not available.");
  }
  return window.matchMedia(query) as unknown as MediaQueryListLike;
}

function defaultReadRatio(): number {
  if (typeof window === "undefined") {
    return 1;
  }
  return resolveDevicePixelRatio(window.devicePixelRatio);
}

/**
 * Watches the device pixel ratio and reports every change.
 *
 * Returns a function that stops watching. The watcher is a no-op where the
 * browser has no `matchMedia`, so a caller never has to check for it.
 */
export function watchDevicePixelRatio(options: WatchDevicePixelRatioOptions): () => void {
  const { onChange } = options;
  const matchMedia = options.matchMedia ?? defaultMatchMedia;
  const readRatio = options.readRatio ?? defaultReadRatio;

  let stopped = false;
  let query: MediaQueryListLike | null = null;
  let listener: ((event: unknown) => void) | null = null;

  const detach = (): void => {
    if (query && listener) {
      if (query.removeEventListener) {
        query.removeEventListener("change", listener);
      } else if (query.removeListener) {
        query.removeListener(listener);
      }
    }
    query = null;
    listener = null;
  };

  const arm = (): void => {
    if (stopped) {
      return;
    }
    let list: MediaQueryListLike;
    try {
      list = matchMedia(`(resolution: ${readRatio()}dppx)`);
    } catch {
      // No media queries: the ratio can still be read, it just cannot be
      // watched. The caller keeps whatever ratio it last saw.
      return;
    }
    listener = () => {
      if (stopped) {
        return;
      }
      detach();
      const ratio = readRatio();
      // Re-arm at the new ratio first: the old query can never match again.
      arm();
      onChange(ratio);
    };
    query = list;
    if (list.addEventListener) {
      list.addEventListener("change", listener);
    } else if (list.addListener) {
      list.addListener(listener);
    }
  };

  arm();

  return () => {
    stopped = true;
    detach();
  };
}
