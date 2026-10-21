/**
 * Composition guides: the pure geometry.
 *
 * The guide model is deliberately small, so most of the rules that decide where
 * a guide lands and which one a press grabs live in one DOM-free module
 * (`core/document/guides`) and can be tested here without a canvas.
 */

import { describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import {
  GUIDE_GRAB_RADIUS_PX,
  addGuideToDocument,
  findGuide,
  findGuideAt,
  guideAxisFromDrag,
  guideDistance,
  guideGrabRadius,
  guidesEqual,
  isDuplicateGuide,
  removeGuideFromDocument,
  roundGuidePosition,
  setGuidePosition,
} from "../core/document/guides";
import type { Guide } from "../core/document/types";

function guide(overrides: Partial<Guide> = {}): Guide {
  return { id: "guide-1", axis: "vertical", position: 400, ...overrides };
}

describe("the guide model", () => {
  it("starts with no guides at all", () => {
    const document = createDocument({ width: 400, height: 300 });
    expect(document.guides).toEqual([]);
  });

  it("stores an id, an axis and one position - never a point", () => {
    const stored = guide();
    expect(Object.keys(stored).sort()).toEqual(["axis", "id", "position"]);
    expect(stored.axis).toBe("vertical");
    expect(Number.isFinite(stored.position)).toBe(true);
  });

  it("takes the x of a vertical guide and the y of a horizontal one", () => {
    // The axis plus one number is the whole geometry: a vertical guide's y is
    // meaningless, so it is not stored.
    expect(guideDistance(guide({ axis: "vertical", position: 400 }), 405, 999)).toBe(5);
    expect(guideDistance(guide({ axis: "horizontal", position: 400 }), 999, 396)).toBe(4);
  });
});

describe("the axis heuristic", () => {
  it("follows the dominant direction of the drag", () => {
    expect(guideAxisFromDrag(40, 10)).toBe("vertical");
    expect(guideAxisFromDrag(10, 40)).toBe("horizontal");
    expect(guideAxisFromDrag(-40, 10)).toBe("vertical");
    expect(guideAxisFromDrag(10, -40)).toBe("horizontal");
  });

  it("never leaves the user without a guide", () => {
    // A perfectly diagonal drag is a horizontal guide, not "no guide".
    expect(guideAxisFromDrag(30, 30)).toBe("horizontal");
    expect(guideAxisFromDrag(0, 0)).toBe("horizontal");
  });
});

describe("the position rounding", () => {
  it("snaps a position to a whole document pixel", () => {
    expect(roundGuidePosition(120.4)).toBe(120);
    expect(roundGuidePosition(120.5)).toBe(121);
    expect(roundGuidePosition(120.6)).toBe(121);
    expect(roundGuidePosition(-0.4)).toBe(0);
  });
});

describe("the grab radius", () => {
  it("is a screen-space radius, so it shrinks with the zoom", () => {
    expect(guideGrabRadius(1)).toBe(GUIDE_GRAB_RADIUS_PX);
    expect(guideGrabRadius(0.25)).toBe(32);
    expect(guideGrabRadius(4)).toBe(2);
    expect(guideGrabRadius(64)).toBe(0.125);
  });

  it("grabs a guide within 8 CSS pixels at any zoom", () => {
    const guides = [guide()];
    // 7 CSS pixels away at 1x.
    expect(findGuideAt(guides, 407, 10, 1)?.id).toBe("guide-1");
    // 20 CSS pixels away at 1x: out of reach.
    expect(findGuideAt(guides, 420, 10, 1)).toBeNull();
    // The same 20 CSS pixels at 0.25x is 80 document pixels, but the radius is
    // 32 document pixels there, so it is still out of reach.
    expect(findGuideAt(guides, 480, 10, 0.25)).toBeNull();
    // 30 CSS pixels away at 0.25x is 120 document pixels - out of reach too.
    expect(findGuideAt(guides, 520, 10, 0.25)).toBeNull();
    // 7 CSS pixels away at 0.25x is 28 document pixels, inside the 32.
    expect(findGuideAt(guides, 428, 10, 0.25)?.id).toBe("guide-1");
  });

  it("takes the nearest guide and breaks a tie in favour of the vertical one", () => {
    const guides = [
      guide({ id: "guide-far", position: 405 }),
      guide({ id: "guide-near", position: 402 }),
      guide({ id: "guide-horizontal", axis: "horizontal", position: 403 }),
    ];
    // The horizontal guide is 0 away, the vertical one 1 away: the horizontal
    // one is nearer.
    expect(findGuideAt(guides, 403, 403, 1)?.id).toBe("guide-horizontal");
    // Exactly on both: the vertical guide wins, so the outcome never depends
    // on the order the guides are listed in.
    const tie = [guide({ id: "guide-vertical" }), guide({ id: "guide-horizontal", axis: "horizontal" })];
    expect(findGuideAt(tie, 400, 400, 1)?.id).toBe("guide-vertical");
  });

  it("ignores a guide whose axis does not match the press", () => {
    const horizontal = [guide({ axis: "horizontal", position: 400 })];
    // The press is 0 away in x but 100 away in y.
    expect(findGuideAt(horizontal, 400, 500, 1)).toBeNull();
  });
});

describe("the duplicate rule", () => {
  it("reports a guide that already sits at the same axis position", () => {
    const guides = [guide({ id: "guide-1", axis: "vertical", position: 400 })];
    expect(isDuplicateGuide(guides, "vertical", 400)).toBe(true);
    expect(isDuplicateGuide(guides, "vertical", 401)).toBe(false);
    // The other axis is a different place.
    expect(isDuplicateGuide(guides, "horizontal", 400)).toBe(false);
  });

  it("ignores the guide that is being moved", () => {
    const guides = [guide({ id: "guide-1", axis: "vertical", position: 400 })];
    expect(isDuplicateGuide(guides, "vertical", 400, "guide-1")).toBe(false);
  });
});

describe("the pure document operations", () => {
  it("adds a guide without touching the layers", () => {
    const document = createDocument({ width: 400, height: 300 });
    const next = addGuideToDocument(document, guide());
    expect(next.guides).toHaveLength(1);
    expect(document.guides).toHaveLength(0);
    expect(next.layers).toBe(document.layers);
  });

  it("moves a guide along its own axis", () => {
    const document = addGuideToDocument(createDocument({ width: 400, height: 300 }), guide());
    const moved = setGuidePosition(document, "guide-1", 250);
    expect(moved.guides[0].position).toBe(250);
    expect(moved.guides[0].axis).toBe("vertical");
    expect(document.guides[0].position).toBe(400);
  });

  it("leaves the document alone for an unknown guide", () => {
    const document = createDocument({ width: 400, height: 300 });
    expect(setGuidePosition(document, "guide-none", 10)).toBe(document);
    expect(removeGuideFromDocument(document, "guide-none")).toBe(document);
  });

  it("removes a guide", () => {
    const document = addGuideToDocument(createDocument({ width: 400, height: 300 }), guide());
    const next = removeGuideFromDocument(document, "guide-1");
    expect(next.guides).toHaveLength(0);
    expect(document.guides).toHaveLength(1);
  });

  it("finds a guide by id", () => {
    const document = addGuideToDocument(createDocument({ width: 400, height: 300 }), guide());
    expect(findGuide(document.guides, "guide-1")?.position).toBe(400);
    expect(findGuide(document.guides, "guide-2")).toBeUndefined();
  });
});

describe("the guide-list comparison", () => {
  it("compares two lists by their content, not by their identity", () => {
    const one = [guide({ id: "guide-1", axis: "vertical", position: 100 })];

    // The same list, and an equal list built from scratch: both are the same
    // set of guides.
    expect(guidesEqual(one, one)).toBe(true);
    expect(guidesEqual(one, [guide({ id: "guide-1", axis: "vertical", position: 100 })])).toBe(
      true,
    );
    expect(guidesEqual([], [])).toBe(true);
  });

  it("sees a changed id, axis, position or length as a change", () => {
    const one = [guide({ id: "guide-1", axis: "vertical", position: 100 })];

    expect(guidesEqual(one, [])).toBe(false);
    expect(guidesEqual(one, [guide({ id: "guide-2", axis: "vertical", position: 100 })])).toBe(
      false,
    );
    expect(guidesEqual(one, [guide({ id: "guide-1", axis: "horizontal", position: 100 })])).toBe(
      false,
    );
    expect(guidesEqual(one, [guide({ id: "guide-1", axis: "vertical", position: 101 })])).toBe(
      false,
    );
    expect(
      guidesEqual(one, [
        guide({ id: "guide-1", axis: "vertical", position: 100 }),
        guide({ id: "guide-2", axis: "vertical", position: 200 }),
      ]),
    ).toBe(false);
  });
});
