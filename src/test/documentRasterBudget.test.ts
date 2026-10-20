/**
 * Document raster-budget guardrails.
 *
 * These tests pin the calculable memory policy, not an implementation detail:
 * a document may use at most 16,777,216 pixels, which is four 2x RGBA surfaces
 * inside a 1 GiB budget. Nothing here allocates a real canvas.
 */

import { describe, expect, it } from "vitest";
import {
  BUDGETED_RASTER_SCALE,
  BUDGETED_RASTER_SURFACES,
  DOCUMENT_RASTER_BUDGET_BYTES,
  MAX_DOCUMENT_PIXELS,
  MAX_DOCUMENT_SIZE,
  MIN_DOCUMENT_SIZE,
  createDocument,
  documentPixelCount,
  estimateDocumentRasterBytes,
  isWithinDocumentRasterBudget,
  isValidDocumentSize,
} from "../core/document/document";

describe("document raster budget", () => {
  it("pins a 1 GiB budget to four 2x RGBA surfaces", () => {
    expect(DOCUMENT_RASTER_BUDGET_BYTES).toBe(1024 * 1024 * 1024);
    expect(BUDGETED_RASTER_SCALE).toBe(2);
    expect(BUDGETED_RASTER_SURFACES).toBe(4);
    expect(MAX_DOCUMENT_PIXELS).toBe(16_777_216);

    // At the limit, four 2x surfaces use the whole budget exactly.
    expect(estimateDocumentRasterBytes(4096, 4096)).toBe(DOCUMENT_RASTER_BUDGET_BYTES);
    // The rejected 8192x8192 case would need four times that.
    expect(estimateDocumentRasterBytes(8192, 8192)).toBe(4 * DOCUMENT_RASTER_BUDGET_BYTES);
  });

  it("accepts a document exactly at the pixel limit", () => {
    expect(isWithinDocumentRasterBudget(4096, 4096)).toBe(true);
    expect(isValidDocumentSize(4096, 4096)).toBe(true);

    const document = createDocument({ name: "At limit", width: 4096, height: 4096 });
    expect(document.width).toBe(4096);
    expect(document.height).toBe(4096);
  });

  it("accepts below-limit and narrow aspect ratios", () => {
    expect(isValidDocumentSize(4095, 4096)).toBe(true);
    expect(isValidDocumentSize(8192, 1024)).toBe(true);
    // 8192 is the per-side ceiling and 2048 is the largest width that keeps
    // the 8192-wide document inside the total pixel budget.
    expect(documentPixelCount(8192, 2048)).toBe(MAX_DOCUMENT_PIXELS);
    expect(isValidDocumentSize(8192, 2048)).toBe(true);
    expect(isValidDocumentSize(8192, 2049)).toBe(false);
  });

  it("rejects a document one pixel over the budget", () => {
    expect(isWithinDocumentRasterBudget(4097, 4096)).toBe(false);
    expect(isValidDocumentSize(4097, 4096)).toBe(false);
    expect(() => createDocument({ name: "Over", width: 4097, height: 4096 })).toThrow(
      RangeError,
    );
    expect(() => createDocument({ name: "Over", width: 4097, height: 4096 })).toThrow(
      /at most 16,777,216 px in total/,
    );
  });

  it("rejects the 8192x8192 allocation instead of reserving a 1.07 GB surface", () => {
    expect(isValidDocumentSize(MAX_DOCUMENT_SIZE, MAX_DOCUMENT_SIZE)).toBe(false);
    expect(() =>
      createDocument({ name: "Huge", width: MAX_DOCUMENT_SIZE, height: MAX_DOCUMENT_SIZE }),
    ).toThrow(/outside the supported range/);
  });

  it("keeps the per-side range and rejects malformed dimensions", () => {
    expect(isValidDocumentSize(MIN_DOCUMENT_SIZE, MIN_DOCUMENT_SIZE)).toBe(true);
    expect(isValidDocumentSize(MIN_DOCUMENT_SIZE - 1, 64)).toBe(false);
    expect(isValidDocumentSize(MAX_DOCUMENT_SIZE + 1, 64)).toBe(false);
    expect(isValidDocumentSize(0, 64)).toBe(false);
    expect(isValidDocumentSize(-4096, -4096)).toBe(false);
    expect(isValidDocumentSize(Number.NaN, 64)).toBe(false);
    expect(isValidDocumentSize(Number.POSITIVE_INFINITY, 64)).toBe(false);
    expect(isValidDocumentSize(Number.NEGATIVE_INFINITY, 64)).toBe(false);
    expect(isValidDocumentSize("800" as unknown as number, 600)).toBe(false);
    expect(isWithinDocumentRasterBudget(Number.NaN, 4096)).toBe(false);
    expect(isWithinDocumentRasterBudget(Infinity, Infinity)).toBe(false);
  });

  it("checks the rounded size that createDocument actually uses", () => {
    expect(isValidDocumentSize(4096.4, 4096.4)).toBe(true);
    const rounded = createDocument({ name: "Rounded", width: 4096.4, height: 4096.4 });
    expect([rounded.width, rounded.height]).toEqual([4096, 4096]);

    expect(isValidDocumentSize(4096.6, 4096.6)).toBe(false);
    expect(() =>
      createDocument({ name: "Rounded over", width: 4096.6, height: 4096.6 }),
    ).toThrow(RangeError);
  });

  it("estimates byte counts for other surface/scale combinations", () => {
    // One 1x RGBA surface for a 1024x1024 document.
    expect(estimateDocumentRasterBytes(1024, 1024, 1, 1)).toBe(4 * 1024 * 1024);
    // The same document with two 2x surfaces.
    expect(estimateDocumentRasterBytes(1024, 1024, 2, 2)).toBe(32 * 1024 * 1024);
    expect(estimateDocumentRasterBytes(Number.NaN, 1024)).toBe(Number.POSITIVE_INFINITY);
  });
});
