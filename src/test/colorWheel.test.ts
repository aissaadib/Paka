import { describe, expect, it } from "vitest";
import {
  hsvToWheelPoint,
  resolveWheelHsv,
  wheelPointToHsv,
} from "../features/color/wheelGeometry";

const SIZE = 148;
const CENTRE = SIZE / 2;

describe("colour wheel geometry", () => {
  it("reads the rim as full saturation and the centre as none", () => {
    expect(wheelPointToHsv(CENTRE, CENTRE, SIZE).s).toBe(0);
    expect(wheelPointToHsv(SIZE, CENTRE, SIZE).s).toBe(1);
    expect(wheelPointToHsv(CENTRE, 0, SIZE).s).toBe(1);
    expect(wheelPointToHsv(CENTRE, SIZE, SIZE).s).toBe(1);
    expect(wheelPointToHsv(0, CENTRE, SIZE).s).toBe(1);
  });

  it("reads the four cardinal points as the four hues around the ring", () => {
    // Hue 0 sits at 3 o'clock and the hue grows clockwise, matching the CSS
    // conic gradient the disc is painted with.
    expect(wheelPointToHsv(SIZE, CENTRE, SIZE).h).toBeCloseTo(0, 6);
    expect(wheelPointToHsv(CENTRE, SIZE, SIZE).h).toBeCloseTo(90, 6);
    expect(wheelPointToHsv(0, CENTRE, SIZE).h).toBeCloseTo(180, 6);
    expect(wheelPointToHsv(CENTRE, 0, SIZE).h).toBeCloseTo(270, 6);
  });

  it("keeps the hue at the centre, where there is no direction", () => {
    expect(wheelPointToHsv(CENTRE, CENTRE, SIZE)).toEqual({ h: 0, s: 0 });
  });

  it("clamps a point outside the disc to the rim", () => {
    const outside = wheelPointToHsv(SIZE * 2, CENTRE, SIZE);
    expect(outside.s).toBe(1);
    expect(outside.h).toBeCloseTo(0, 6);
  });

  it("places a hue and a saturation back on the disc", () => {
    const right = hsvToWheelPoint(0, 1, SIZE);
    expect(right.x).toBeCloseTo(SIZE, 6);
    expect(right.y).toBeCloseTo(CENTRE, 6);

    const bottom = hsvToWheelPoint(90, 1, SIZE);
    expect(bottom.x).toBeCloseTo(CENTRE, 6);
    expect(bottom.y).toBeCloseTo(SIZE, 6);

    const left = hsvToWheelPoint(180, 1, SIZE);
    expect(left.x).toBeCloseTo(0, 6);
    expect(left.y).toBeCloseTo(CENTRE, 6);

    const top = hsvToWheelPoint(270, 1, SIZE);
    expect(top.x).toBeCloseTo(CENTRE, 6);
    expect(top.y).toBeCloseTo(0, 6);

    const middle = hsvToWheelPoint(210, 0, SIZE);
    expect(middle.x).toBeCloseTo(CENTRE, 6);
    expect(middle.y).toBeCloseTo(CENTRE, 6);
  });

  it("places a half-saturated colour halfway out", () => {
    const point = hsvToWheelPoint(0, 0.5, SIZE);
    expect(point.x).toBeCloseTo(CENTRE + CENTRE / 2, 6);
    expect(point.y).toBeCloseTo(CENTRE, 6);
  });

  it("is the inverse of reading a point", () => {
    for (const hue of [0, 37, 90, 180, 270, 359]) {
      for (const saturation of [0.25, 0.5, 1]) {
        const point = hsvToWheelPoint(hue, saturation, SIZE);
        const read = wheelPointToHsv(point.x, point.y, SIZE);
        expect(read.h).toBeCloseTo(hue, 6);
        expect(read.s).toBeCloseTo(saturation, 6);
      }
    }
  });

  it("loses the hue at the centre, where there is no direction", () => {
    // The centre is the colour's own grey, so it carries no hue to read back.
    const point = hsvToWheelPoint(210, 0, SIZE);
    expect(wheelPointToHsv(point.x, point.y, SIZE)).toEqual({ h: 0, s: 0 });
  });

  it("reads a point back from a pointer position inside the disc", () => {
    // A pointer at a quarter of the way out and a third of the way round.
    const read = wheelPointToHsv(CENTRE + CENTRE / 4, CENTRE, SIZE);
    expect(read.s).toBeCloseTo(0.25, 6);
    expect(read.h).toBeCloseTo(0, 6);
  });

  it("reports nothing for a disc with no size", () => {
    expect(wheelPointToHsv(10, 10, 0)).toEqual({ h: 0, s: 0 });
    expect(wheelPointToHsv(10, 10, -5)).toEqual({ h: 0, s: 0 });
  });
});

describe("which colour the wheel shows", () => {
  const stored = { h: 220, s: 0.21, v: 0.11 };
  const requested = { h: 205, s: 0.21, v: 0.11 };

  it("shows the stored colour when nothing was requested", () => {
    expect(resolveWheelHsv(stored, null, null, "#16181c")).toBe(stored);
    expect(resolveWheelHsv(stored, null, "#16181c", "#16181c")).toBe(stored);
  });

  it("keeps what the user asked for while the brush holds the wheel's colour", () => {
    expect(resolveWheelHsv(stored, requested, "#161a1c", "#161a1c")).toBe(requested);
  });

  it("falls back to the stored colour when the colour changed elsewhere", () => {
    // The toolbar's colour input, a swatch or the canvas picker changed the
    // brush colour: the wheel must show the colour the brush now holds.
    expect(resolveWheelHsv(stored, requested, "#161a1c", "#ff0000")).toBe(stored);
  });

  it("falls back to the stored colour when the wheel has written nothing", () => {
    expect(resolveWheelHsv(stored, requested, null, "#16181c")).toBe(stored);
  });
});
