/**
 * The transform handles.
 *
 * These pin where the handles sit and what a press grabs. The handles are the
 * affordance of a scale and a rotation, so their geometry has to be exact:
 * the corners are the frame's corners, the side handles sit just outside the
 * frame's sides, the rotation handle is on the ray straight up from the
 * frame's centre, and a press grabs the *nearest* handle within the grab
 * radius and nothing else.
 */

import { describe, expect, it } from "vitest";
import {
  cornerOf,
  edgeAxis,
  edgeOf,
  EDGE_HANDLE_OFFSET_PX,
  findSelectionHandle,
  handleKind,
  HANDLE_CURSORS,
  HANDLE_GRAB_RADIUS_PX,
  MOVE_CURSOR,
  selectionHandles,
  type SelectionHandles,
} from "../core/document/selectionHandles";
import type { Bounds } from "../types/geometry";

const FRAME: Bounds = { x: 10, y: 20, width: 100, height: 40 };
/** The rotation handle sits this far above the frame, in document units. */
const OFFSET = 24;
/** The side handles sit this far outside the frame, in document units. */
const EDGE_OFFSET = EDGE_HANDLE_OFFSET_PX;

function handles(): SelectionHandles {
  const layout = selectionHandles(FRAME, OFFSET, EDGE_OFFSET);
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

  it("puts a side handle just outside each side of the frame", () => {
    // The side handles are outside the frame on purpose: a handle on the edge
    // would sit inside the frame, where a press moves the content, and a thin
    // selection could not be moved by its middle at all.
    expect(handles().edges).toEqual([
      { x: 60, y: 20 - EDGE_OFFSET },
      { x: 110 + EDGE_OFFSET, y: 40 },
      { x: 60, y: 60 + EDGE_OFFSET },
      { x: 10 - EDGE_OFFSET, y: 40 },
    ]);
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

  it("names the edge a side handle stands for", () => {
    const layout = handles();
    expect(edgeOf(layout, "scale-n")).toEqual({ x: 60, y: 20 - EDGE_OFFSET });
    expect(edgeOf(layout, "scale-e")).toEqual({ x: 110 + EDGE_OFFSET, y: 40 });
    expect(edgeOf(layout, "scale-s")).toEqual({ x: 60, y: 60 + EDGE_OFFSET });
    expect(edgeOf(layout, "scale-w")).toEqual({ x: 10 - EDGE_OFFSET, y: 40 });
    expect(edgeOf(layout, "scale-nw")).toBeNull();
  });

  it("says what each handle does", () => {
    expect(handleKind("scale-nw")).toBe("corner");
    expect(handleKind("scale-e")).toBe("edge");
    expect(handleKind("rotate")).toBe("rotate");
  });

  it("names the axis and the end a side handle pulls", () => {
    expect(edgeAxis("scale-n")).toEqual({ axis: "y", side: "start" });
    expect(edgeAxis("scale-e")).toEqual({ axis: "x", side: "end" });
    expect(edgeAxis("scale-s")).toEqual({ axis: "y", side: "end" });
    expect(edgeAxis("scale-w")).toEqual({ axis: "x", side: "start" });
    expect(edgeAxis("scale-nw")).toBeNull();
    expect(edgeAxis("rotate")).toBeNull();
  });
});

describe("grabbing a handle", () => {
  it("grabs the corner under the pointer", () => {
    const layout = handles();
    expect(findSelectionHandle(layout, 10, 20, 5)).toBe("scale-nw");
    expect(findSelectionHandle(layout, 110, 60, 5)).toBe("scale-se");
  });

  it("grabs the side handle under the pointer", () => {
    const layout = handles();
    expect(findSelectionHandle(layout, 110 + EDGE_OFFSET, 40, 5)).toBe("scale-e");
    expect(findSelectionHandle(layout, 60, 20 - EDGE_OFFSET, 5)).toBe("scale-n");
  });

  it("does not grab a side handle from inside the frame", () => {
    // The middle of a thin selection is where a press moves the content, so
    // the side handle above it must not take the press - not even with the
    // full grab radius.
    const layout = handles();
    expect(findSelectionHandle(layout, 60, 20, 5)).toBeNull();
    expect(findSelectionHandle(layout, 60, 20, HANDLE_GRAB_RADIUS_PX)).toBeNull();
  });

  it("keeps the side handles further out than the grab radius", () => {
    // Otherwise a press just inside the frame would grab the handle above it
    // instead of moving the content.
    expect(EDGE_HANDLE_OFFSET_PX).toBeGreaterThan(HANDLE_GRAB_RADIUS_PX);
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

describe("the cursors", () => {
  it("says which way a corner will drag", () => {
    expect(HANDLE_CURSORS["scale-nw"]).toBe("nwse-resize");
    expect(HANDLE_CURSORS["scale-se"]).toBe("nwse-resize");
    expect(HANDLE_CURSORS["scale-ne"]).toBe("nesw-resize");
  });

  it("says which way a side will drag", () => {
    expect(HANDLE_CURSORS["scale-n"]).toBe("ns-resize");
    expect(HANDLE_CURSORS["scale-s"]).toBe("ns-resize");
    expect(HANDLE_CURSORS["scale-e"]).toBe("ew-resize");
    expect(HANDLE_CURSORS["scale-w"]).toBe("ew-resize");
  });

  it("offers a grab cursor for the rotation handle", () => {
    expect(HANDLE_CURSORS.rotate).toBe("grab");
  });

  it("offers a move cursor over the selection's own frame", () => {
    expect(MOVE_CURSOR).toBe("move");
  });
});
