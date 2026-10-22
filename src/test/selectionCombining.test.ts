/**
 * Selection combining and the marquee shape.
 *
 * A new marquee can replace the selection, add to it, subtract from it or
 * intersect with it. The rules are pure and closed, so they are pinned here
 * without a canvas: which modifier asks for which combine, and what each
 * combine does with duplicate or empty input.
 */

import { describe, expect, it } from "vitest";
import {
  combineSelectionIds,
  normalizeSelectionShape,
  selectionCombineFor,
} from "../core/document/selectionModes";

describe("selection combining", () => {
  it("maps the modifiers to a combine mode", () => {
    expect(selectionCombineFor({ shift: false, alt: false })).toBe("replace");
    expect(selectionCombineFor({ shift: true, alt: false })).toBe("add");
    expect(selectionCombineFor({ shift: false, alt: true })).toBe("subtract");
    expect(selectionCombineFor({ shift: true, alt: true })).toBe("intersect");
  });

  it("replaces the selection, and clears it when nothing matched", () => {
    expect(combineSelectionIds(null, ["a", "b"], "replace")).toEqual(["a", "b"]);
    expect(combineSelectionIds(["a"], ["b"], "replace")).toEqual(["b"]);
    expect(combineSelectionIds(["a"], [], "replace")).toBeNull();
  });

  it("adds without duplicating an id", () => {
    expect(combineSelectionIds(["a"], ["b"], "add")).toEqual(["a", "b"]);
    expect(combineSelectionIds(["a", "b"], ["b", "c"], "add")).toEqual(["a", "b", "c"]);
    // With nothing selected, adding is the same as replacing.
    expect(combineSelectionIds(null, ["a"], "add")).toEqual(["a"]);
    expect(combineSelectionIds(null, [], "add")).toBeNull();
  });

  it("subtracts only what was there", () => {
    expect(combineSelectionIds(["a", "b"], ["b"], "subtract")).toEqual(["a"]);
    expect(combineSelectionIds(["a", "b"], ["c"], "subtract")).toEqual(["a", "b"]);
    expect(combineSelectionIds(["a"], ["a"], "subtract")).toBeNull();
    expect(combineSelectionIds(null, ["a"], "subtract")).toBeNull();
  });

  it("intersects with what was there", () => {
    expect(combineSelectionIds(["a", "b"], ["b", "c"], "intersect")).toEqual(["b"]);
    expect(combineSelectionIds(["a"], ["b"], "intersect")).toBeNull();
    expect(combineSelectionIds(null, ["a"], "intersect")).toBeNull();
  });

  it("normalizes the marquee shape", () => {
    expect(normalizeSelectionShape("rect")).toBe("rect");
    expect(normalizeSelectionShape("lasso")).toBe("lasso");
    expect(normalizeSelectionShape("polygon")).toBe("rect");
    expect(normalizeSelectionShape(null)).toBe("rect");
  });
});
