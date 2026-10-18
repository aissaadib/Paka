/**
 * File status message tests.
 *
 * The wording is user-facing and the byte formatting is easy to get subtly
 * wrong (1023 bytes is not "1.0 kB"), so both are checked directly.
 */

import { describe, expect, it } from "vitest";
import { describeOutcome, formatBytes } from "../features/project/fileMessages";

describe("formatBytes", () => {
  it("keeps whole bytes below a kilobyte", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(8)).toBe("8 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("switches to 1024-based units", () => {
    expect(formatBytes(1024)).toBe("1.0 kB");
    expect(formatBytes(1536)).toBe("1.5 kB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  it("never produces nonsense for a nonsense size", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });
});

describe("describeOutcome", () => {
  it("names the file that was written", () => {
    expect(describeOutcome({ status: "saved", path: "C:\\art\\cat.paka" })).toEqual({
      text: "Saved cat.paka",
      tone: "info",
    });
  });

  it("reports an opened project, including any repairs", () => {
    expect(describeOutcome({ status: "opened", path: "/art/cat.paka", warnings: [] })).toEqual({
      text: "Opened cat.paka",
      tone: "info",
    });

    expect(
      describeOutcome({ status: "opened", path: "/art/cat.paka", warnings: ["A layer had no name."] }),
    ).toEqual({
      text: "Opened cat.paka with 1 warning: A layer had no name.",
      tone: "info",
    });

    const two = describeOutcome({
      status: "opened",
      path: "/art/cat.paka",
      warnings: ["A layer had no name.", "The paper colour was reset."],
    });
    expect(two?.text).toContain("2 warnings:");
    expect(two?.text).toContain("The paper colour was reset.");
  });

  it("reports the size of an export", () => {
    expect(describeOutcome({ status: "exported", path: "/art/cat.png", bytes: 4096 })).toEqual({
      text: "Exported cat.png (4.0 kB)",
      tone: "info",
    });
  });

  it("says nothing when the user cancelled", () => {
    expect(describeOutcome({ status: "cancelled" })).toBeNull();
  });

  it("passes a failure through as an error", () => {
    expect(describeOutcome({ status: "error", message: "Disk is full." })).toEqual({
      text: "Disk is full.",
      tone: "error",
    });
  });
});
