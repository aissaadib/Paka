/**
 * The selection modes: the set operations and the modifier keys.
 *
 * These are the rules the marquee applies, tested without a canvas, a pointer
 * or a document: the selection is a set of stroke ids, and a mode is a set
 * operation on that set.
 */

import { describe, expect, it } from "vitest";
import {
  combineSelectionIds,
  DEFAULT_SELECTION_MODE,
  invertSelectionIds,
  isSelectionMode,
  resolveSelectionMode,
  SELECTION_MODE_LABELS,
  SELECTION_MODES,
} from "../core/document/selectionModes";

describe("the selection modes", () => {
  describe("the list of modes", () => {
    it("offers exactly the four modes a set of strokes can express", () => {
      expect(SELECTION_MODES).toEqual(["replace", "add", "subtract", "intersect"]);
    });

    it("offers no mode the geometry cannot represent", () => {
      // A feathered or expanded selection would need a region rather than a
      // set of whole strokes, so no such mode exists to be offered.
      expect(SELECTION_MODES).not.toContain("feather");
      expect(SELECTION_MODES).not.toContain("expand");
      expect(SELECTION_MODES).not.toContain("invert");
    });

    it("names every mode on the toolbar", () => {
      for (const mode of SELECTION_MODES) {
        expect(SELECTION_MODE_LABELS[mode]).toBeTruthy();
      }
    });

    it("recognises a mode and refuses anything else", () => {
      expect(isSelectionMode("add")).toBe(true);
      expect(isSelectionMode("intersect")).toBe(true);
      expect(isSelectionMode("feather")).toBe(false);
      expect(isSelectionMode(null)).toBe(false);
      expect(isSelectionMode(undefined)).toBe(false);
    });

    it("starts in replace", () => {
      expect(DEFAULT_SELECTION_MODE).toBe("replace");
    });
  });

  describe("the modifier keys", () => {
    const none = { shift: false, alt: false };

    it("keeps the toolbar's mode when no key is held", () => {
      expect(resolveSelectionMode("replace", none)).toBe("replace");
      expect(resolveSelectionMode("subtract", none)).toBe("subtract");
    });

    it("asks for add with shift", () => {
      expect(resolveSelectionMode("replace", { shift: true, alt: false })).toBe("add");
    });

    it("asks for subtract with alt", () => {
      expect(resolveSelectionMode("replace", { shift: false, alt: true })).toBe("subtract");
    });

    it("asks for intersect with both", () => {
      expect(resolveSelectionMode("replace", { shift: true, alt: true })).toBe("intersect");
    });

    it("overrides the toolbar's mode whatever it is", () => {
      // The two controls can never disagree: a held key asks for one mode and
      // the toolbar asks for another, and the key wins for that gesture.
      expect(resolveSelectionMode("intersect", { shift: true, alt: false })).toBe("add");
      expect(resolveSelectionMode("add", { shift: false, alt: true })).toBe("subtract");
      expect(resolveSelectionMode("add", { shift: true, alt: true })).toBe("intersect");
    });
  });

  describe("combining a marquee with the selection", () => {
    const current = ["a", "b"];
    const incoming = ["b", "c"];

    it("replace keeps only what the marquee met", () => {
      expect(combineSelectionIds("replace", current, incoming)).toEqual(["b", "c"]);
    });

    it("add joins the two", () => {
      expect(combineSelectionIds("add", current, incoming)).toEqual(["a", "b", "c"]);
    });

    it("subtract takes the marquee out", () => {
      expect(combineSelectionIds("subtract", current, incoming)).toEqual(["a"]);
    });

    it("intersect keeps only what is in both", () => {
      expect(combineSelectionIds("intersect", current, incoming)).toEqual(["b"]);
    });

    it("never repeats an id", () => {
      expect(combineSelectionIds("add", ["a", "a"], ["a", "b", "b"])).toEqual(["a", "b"]);
      expect(combineSelectionIds("replace", [], ["a", "a"])).toEqual(["a"]);
    });

    it("leaves the selection alone when the marquee met nothing", () => {
      expect(combineSelectionIds("add", current, [])).toEqual(["a", "b"]);
      expect(combineSelectionIds("subtract", current, [])).toEqual(["a", "b"]);
      // Replace is the exception: a marquee that met nothing *is* the new
      // selection, and an empty selection is no selection.
      expect(combineSelectionIds("replace", current, [])).toEqual([]);
      // So is intersect: nothing is in both.
      expect(combineSelectionIds("intersect", current, [])).toEqual([]);
    });

    it("clears the selection when subtract takes everything away", () => {
      expect(combineSelectionIds("subtract", ["a"], ["a"])).toEqual([]);
    });
  });

  describe("inverting", () => {
    it("is the complement within the layer", () => {
      expect(invertSelectionIds(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
    });

    it("turns nothing into everything", () => {
      expect(invertSelectionIds(["a", "b"], [])).toEqual(["a", "b"]);
    });

    it("turns everything into nothing", () => {
      expect(invertSelectionIds(["a", "b"], ["a", "b"])).toEqual([]);
    });
  });
});
