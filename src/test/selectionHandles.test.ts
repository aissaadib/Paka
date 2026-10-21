/**
 * The transform handles.
 *
 * These pin where the handles sit and what a press grabs. The handles are the
 * affordance of a scale and a rotation, so their geometry has to be exact:
 * the corners are the frame's corners, the rotation handle is on the ray
 * straight up from the frame's centre, and a press grabs the *nearest* handle
 * within the grab radius and nothing else.
 */

import { describe, expect, it } from "vitest";
import {
  cornerOf,
  findSelectionHandle,
  HANDLE_GRAB_RADIUS_PX,
  selectionHandles,
  type SelectionHandles,
} from "../core/document/selectionHandles";
import type { Bounds } from "../types/geometry";

const FRAME: Bounds = { x: 10, y: 20, width: 100, height: 40 };
/** The rotation handle sits this far above the frame, in document units. */
const OFFSET = 24;

function handles(): SelectionHandles {
  const layout = selectionHandles(FRAME, OFFSET);
  if (!layout) {
    throw new Error("the frame has handles");
  }
  return layout;
}

describe("the handle layout", () => {
  it("puts a corner on each corner of the frame", () => {
    expect(handles().corners).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 60 },
      { x: 10, y: 60 },
    ]);
  });

  it("puts the rotation handle above the frame, on the centre's ray", () => {
    expect(handles().rotate).toEqual({ x: 60, y: 20 - OFFSET });
  });

  it("has no handles for a frame with no area", () => {
    expect(selectionHandles({ x: 5, y: 5, width: 0, height: 0 }, OFFSET)).toBeNull();
  });

  it("has handles for a frame that is only wide", () => {
    const layout = selectionHandles({ x: 5, y: 5, width: 10, height: 0 }, OFFSET);
    expect(layout).not.toBeNull();
    expect(layout?.corners).toHaveLength(4);
  });

  it("names the corner a scale handle stands for", () => {
    const layout = handles();
    expect(cornerOf(layout, "scale-nw")).toEqual({ x: 10, y: 20 });
    expect(cornerOf(layout, "scale-ne")).toEqual({ x: 110, y: 20 });
    expect(cornerOf(layout, "scale-se")).toEqual({ x: 110, y: 60 });
    expect(cornerOf(layout, "scale-sw")).toEqual({ x: 10, y: 60 });
    expect(cornerOf(layout, "rotate")).toBeNull();
  });
});

describe("grabbing a handle", () => {
  it("grabs the corner under the pointer", () => {
    const layout = handles();
    expect(findSelectionHandle(layout, 10, 20, 5)).toBe("scale-nw");
    expect(findSelectionHandle(layout, 110, 60, 5)).toBe("scale-se");
  });

  it("grabs the rotation handle", () => {
    expect(findSelectionHandle(handles(), 60, 20 - OFFSET, 5)).toBe("rotate");
  });

  it("grabs nothing outside the radius", () => {
    const layout = handles();
    // A hair away from the corner is still a miss.
    expect(findSelectionHandle(layout, 11, 21, 0.5)).toBeNull();
    expect(findSelectionHandle(layout, 200, 200, 5)).toBeNull();
  });

  it("grabs a corner the pointer is exactly on", () => {
    expect(findSelectionHandle(handles(), 10, 20, 0)).toBe("scale-nw");
  });

  it("takes the nearest handle when two are close", () => {
    const layout = handles();
    // Just inside the north-west corner, but nearer the north-east one.
    expect(findSelectionHandle(layout, 20, 20, 100)).toBe("scale-nw");
    expect(findSelectionHandle(layout, 100, 20, 100)).toBe("scale-ne");
  });

  it("uses a radius in document units, so the caller decides the zoom", () => {
    const layout = handles();
    // Ten screen pixels at half zoom is five document pixels.
    expect(findSelectionHandle(layout, 14, 20, HANDLE_GRAB_RADIUS_PX / 2)).toBe("scale-nw");
    expect(findSelectionHandle(layout, 16, 20, HANDLE_GRAB_RADIUS_PX / 2)).toBeNull();
  });
});
