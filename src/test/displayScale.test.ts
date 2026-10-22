/**
 * The device pixel ratio.
 *
 * The ratio decides how big the drawing surface's backing store is and how
 * finely the layers are rasterized. Reading it is trivial; **noticing that
 * it changed** is not, because a window that moves to a display with a
 * different ratio does not have to resize, and a ratio change fires no
 * `resize` event.
 */

import { describe, expect, it } from "vitest";
import {
  resolveDevicePixelRatio,
  watchDevicePixelRatio,
  type MediaQueryListLike,
} from "../core/rendering/displayScale";

/** A media query list the test can fire. */
class FakeMediaQueryList implements MediaQueryListLike {
  matches = true;
  private readonly listeners = new Set<(event: unknown) => void>();

  constructor(readonly query: string) {}

  addEventListener(_type: "change", listener: (event: unknown) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "change", listener: (event: unknown) => void): void {
    this.listeners.delete(listener);
  }

  /** The browser saying "this query no longer matches". */
  fire(): void {
    for (const listener of [...this.listeners]) {
      listener({});
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

function createMedia() {
  const lists: FakeMediaQueryList[] = [];
  let ratio = 1;
  const matchMedia = (query: string): MediaQueryListLike => {
    const list = new FakeMediaQueryList(query);
    lists.push(list);
    return list;
  };
  const readRatio = (): number => ratio;
  /** The display changed: the old query stops matching and says so. */
  const changeTo = (next: number): void => {
    ratio = next;
    for (const list of [...lists]) {
      list.fire();
    }
  };
  return { lists, matchMedia, readRatio, changeTo };
}

describe("resolveDevicePixelRatio", () => {
  it("keeps a usable ratio", () => {
    expect(resolveDevicePixelRatio(1)).toBe(1);
    expect(resolveDevicePixelRatio(1.5)).toBe(1.5);
    expect(resolveDevicePixelRatio(2)).toBe(2);
  });

  it("falls back to 1 for a ratio that cannot size a surface", () => {
    expect(resolveDevicePixelRatio(0)).toBe(1);
    expect(resolveDevicePixelRatio(-2)).toBe(1);
    expect(resolveDevicePixelRatio(Number.NaN)).toBe(1);
    expect(resolveDevicePixelRatio(Number.POSITIVE_INFINITY)).toBe(1);
    expect(resolveDevicePixelRatio(undefined)).toBe(1);
    expect(resolveDevicePixelRatio("2")).toBe(1);
  });
});

describe("watchDevicePixelRatio", () => {
  it("watches the ratio it was created for", () => {
    const media = createMedia();
    watchDevicePixelRatio({
      onChange: () => {},
      matchMedia: media.matchMedia,
      readRatio: media.readRatio,
    });

    expect(media.lists).toHaveLength(1);
    expect(media.lists[0].query).toBe("(resolution: 1dppx)");
  });

  it("reports a change and re-arms at the new ratio", () => {
    const media = createMedia();
    const seen: number[] = [];
    watchDevicePixelRatio({
      onChange: (ratio) => seen.push(ratio),
      matchMedia: media.matchMedia,
      readRatio: media.readRatio,
    });

    media.changeTo(2);
    expect(seen).toEqual([2]);
    // The old query can never match again, so the watcher asks for a new one.
    expect(media.lists).toHaveLength(2);
    expect(media.lists[1].query).toBe("(resolution: 2dppx)");
    expect(media.lists[0].listenerCount).toBe(0);

    media.changeTo(1.5);
    expect(seen).toEqual([2, 1.5]);
    expect(media.lists).toHaveLength(3);
    expect(media.lists[2].query).toBe("(resolution: 1.5dppx)");
  });

  it("stops watching when it is told to", () => {
    const media = createMedia();
    const seen: number[] = [];
    const stop = watchDevicePixelRatio({
      onChange: (ratio) => seen.push(ratio),
      matchMedia: media.matchMedia,
      readRatio: media.readRatio,
    });

    stop();
    media.changeTo(2);

    expect(seen).toEqual([]);
    expect(media.lists[0].listenerCount).toBe(0);
  });

  it("survives a browser with no media queries", () => {
    const seen: number[] = [];
    const stop = watchDevicePixelRatio({
      onChange: (ratio) => seen.push(ratio),
      matchMedia: () => {
        throw new Error("no media queries here");
      },
      readRatio: () => 1,
    });

    expect(seen).toEqual([]);
    expect(() => stop()).not.toThrow();
  });
});
