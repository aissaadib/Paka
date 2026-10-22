/**
 * Document raster-budget guardrails.
 *
 * These tests pin the calculable memory policy, not an implementation detail:
 * a document may use at most 16,777,216 pixels, and the peak surface cost of
 * such a document (three 2x RGBA surfaces plus one scan buffer) stays inside a
 * 1 GiB budget. Nothing here allocates a real canvas.
 */

import { describe, expect, it } from "vitest";
import {
  BUDGETED_FULL_RES_SURFACES,
  BUDGETED_RASTER_SCALE,
  BUDGETED_SCAN_BYTES_PER_PIXEL,
  DOCUMENT_RASTER_BUDGET_BYTES,
  MAX_DOCUMENT_PIXELS,
  MAX_DOCUMENT_SIZE,
  MIN_DOCUMENT_SIZE,
  PEAK_BYTES_PER_DOCUMENT_PIXEL,
  PEAK_DOCUMENT_RASTER_BYTES,
  RETAINED_SCRATCH_BYTES_PER_DOCUMENT_PIXEL,
  createDocument,
  documentPixelCount,
  estimateDocumentRasterBytes,
  estimatePeakDocumentRasterBytes,
  isWithinDocumentRasterBudget,
  isValidDocumentSize,
} from "../core/document/document";

describe("document raster budget", () => {
  it("pins the 1 GiB budget to the peak surface model", () => {
    expect(DOCUMENT_RASTER_BUDGET_BYTES).toBe(1024 * 1024 * 1024);
    expect(BUDGETED_RASTER_SCALE).toBe(2);
    // Layer surface + stroke buffer + one of {erase snapshot, preview scratch}.
    expect(BUDGETED_FULL_RES_SURFACES).toBe(3);
    expect(BUDGETED_SCAN_BYTES_PER_PIXEL).toBe(15);
    expect(PEAK_BYTES_PER_DOCUMENT_PIXEL).toBe(3 * 4 * 2 * 2 + 15);
    expect(MAX_DOCUMENT_PIXELS).toBe(16_777_216);

    // The cap is below what the budget alone would allow, so the peak fits.
    expect(MAX_DOCUMENT_PIXELS).toBeLessThan(
      DOCUMENT_RASTER_BUDGET_BYTES / PEAK_BYTES_PER_DOCUMENT_PIXEL,
    );
    expect(PEAK_DOCUMENT_RASTER_BYTES).toBe(1_056_964_608);
    expect(PEAK_DOCUMENT_RASTER_BYTES).toBeLessThanOrEqual(DOCUMENT_RASTER_BUDGET_BYTES);
  });

  it("accounts for the grouped live-preview scratch in the peak", () => {
    // Three 2x surfaces at the cap: 768 MiB.
    expect(estimateDocumentRasterBytes(4096, 4096)).toBe(768 * 1024 * 1024);
    // Plus the transient scan buffer: 1008 MiB, still inside the 1 GiB budget.
    expect(estimatePeakDocumentRasterBytes(4096, 4096)).toBe(1008 * 1024 * 1024);
    expect(estimatePeakDocumentRasterBytes(4096, 4096)).toBeLessThanOrEqual(
      DOCUMENT_RASTER_BUDGET_BYTES,
    );

    // The grouped-preview scratch and the erase snapshot are mutually
    // exclusive: an eraser never builds a group. If both were resident at
    // once the peak would be 79 bytes/px and would leave the budget - which
    // is why the renderer has to release the idle preview scratch.
    expect(RETAINED_SCRATCH_BYTES_PER_DOCUMENT_PIXEL).toBe(79);
    expect(
      RETAINED_SCRATCH_BYTES_PER_DOCUMENT_PIXEL * MAX_DOCUMENT_PIXELS,
    ).toBeGreaterThan(DOCUMENT_RASTER_BUDGET_BYTES);
    expect(PEAK_BYTES_PER_DOCUMENT_PIXEL).toBeLessThan(
      RETAINED_SCRATCH_BYTES_PER_DOCUMENT_PIXEL,
    );

    // The rejected 8192x8192 case has four times the area, so four times the peak.
    expect(estimatePeakDocumentRasterBytes(8192, 8192)).toBe(4 * 1008 * 1024 * 1024);
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
    expect(estimatePeakDocumentRasterBytes(Number.NaN, 1024)).toBe(Number.POSITIVE_INFINITY);
    // The peak is the surface model plus the scan buffer.
    expect(estimatePeakDocumentRasterBytes(1024, 1024)).toBe(
      estimateDocumentRasterBytes(1024, 1024) + 15 * 1024 * 1024,
    );
  });
});
