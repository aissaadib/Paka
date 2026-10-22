/**
 * Menu keyboard navigation tests.
 *
 * The React layer has no automated tests, so the rule the menu depends on is
 * a plain function: the arrow keys walk the items, skip the disabled ones and
 * wrap around, so the keyboard can always reach an item.
 */

import { describe, expect, it } from "vitest";
import {
  firstMenuIndex,
  lastMenuIndex,
  nextMenuIndex,
} from "../utils/menuNavigation";

describe("menu navigation", () => {
  it("moves to the next enabled item", () => {
    const enabled = [true, true, true];

    expect(nextMenuIndex(enabled, 0, 1)).toBe(1);
    expect(nextMenuIndex(enabled, 1, 1)).toBe(2);
  });

  it("skips the disabled items", () => {
    const enabled = [true, false, false, true];

    expect(nextMenuIndex(enabled, 0, 1)).toBe(3);
    expect(nextMenuIndex(enabled, 3, 1)).toBe(0);
  });

  it("wraps around", () => {
    const enabled = [true, true];

    expect(nextMenuIndex(enabled, 1, 1)).toBe(0);
    expect(nextMenuIndex(enabled, 0, -1)).toBe(1);
  });

  it("starts at the first item when nothing is focused yet", () => {
    const enabled = [false, true];

    expect(nextMenuIndex(enabled, -1, 1)).toBe(1);
  });

  it("has nowhere to go when every item is disabled", () => {
    expect(nextMenuIndex([false, false], 0, 1)).toBe(-1);
    expect(nextMenuIndex([], 0, 1)).toBe(-1);
    expect(firstMenuIndex([false, false])).toBe(-1);
    expect(lastMenuIndex([false, false])).toBe(-1);
  });

  it("finds the first and the last enabled item", () => {
    const enabled = [false, true, false, true];

    expect(firstMenuIndex(enabled)).toBe(1);
    expect(lastMenuIndex(enabled)).toBe(3);
  });
});
