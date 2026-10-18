/**
 * Path helper tests.
 *
 * Native dialogs return OS paths, so these must cope with both separators:
 * the same helpers run on Windows and elsewhere.
 */

import { describe, expect, it } from "vitest";
import { ensureExtension, fileNameOf, fileStemOf, sanitizeFileName } from "../utils/path";

describe("fileNameOf", () => {
  it("reads the last segment of either separator style", () => {
    expect(fileNameOf("C:\\Users\\me\\Drawings\\cat.paka")).toBe("cat.paka");
    expect(fileNameOf("/home/me/drawings/cat.paka")).toBe("cat.paka");
    expect(fileNameOf("cat.paka")).toBe("cat.paka");
  });

  it("ignores trailing separators", () => {
    expect(fileNameOf("C:\\Users\\me\\")).toBe("me");
    expect(fileNameOf("/tmp///")).toBe("tmp");
  });

  it("keeps dotted names intact", () => {
    expect(fileNameOf("/tmp/2024.05.final.paka")).toBe("2024.05.final.paka");
  });
});

describe("fileStemOf", () => {
  it("drops the extension", () => {
    expect(fileStemOf("C:\\art\\cat.paka")).toBe("cat");
    expect(fileStemOf("/art/cat.png")).toBe("cat");
  });

  it("leaves names without an extension alone", () => {
    expect(fileStemOf("/art/drawing")).toBe("drawing");
  });

  it("does not treat a leading dot as an extension", () => {
    expect(fileStemOf("/art/.paka")).toBe(".paka");
  });
});

describe("ensureExtension", () => {
  it("appends the extension when it is missing", () => {
    expect(ensureExtension("C:\\art\\cat", "paka")).toBe("C:\\art\\cat.paka");
  });

  it("leaves a correct extension alone, whatever its case", () => {
    expect(ensureExtension("C:\\art\\cat.paka", "paka")).toBe("C:\\art\\cat.paka");
    expect(ensureExtension("C:\\art\\cat.PAKA", "paka")).toBe("C:\\art\\cat.PAKA");
  });

  it("appends rather than replacing a different extension", () => {
    expect(ensureExtension("C:\\art\\cat.2024", "paka")).toBe("C:\\art\\cat.2024.paka");
  });
});

describe("sanitizeFileName", () => {
  it("replaces characters a file name cannot contain", () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });

  it("falls back to a usable name", () => {
    expect(sanitizeFileName("   ")).toBe("Untitled");
    expect(sanitizeFileName("")).toBe("Untitled");
  });

  it("keeps ordinary names unchanged", () => {
    expect(sanitizeFileName("Still life 01")).toBe("Still life 01");
  });
});
