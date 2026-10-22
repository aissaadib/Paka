/**
 * The pointer hot path.
 *
 * A move event can carry several coalesced samples: the browser's way of
 * reporting the sub-frame path of a fast gesture. The stroke has to see every
 * one of them, but the *cursor* only has to be published once - the
 * intermediate positions belong to the same physical move, and every report
 * costs a DOM write in the brush outline and in the status bar.
 *
 * The numbers below are counts, not timings: a count is exact and does not
 * depend on the machine. The timing at the end is printed, never asserted.
 */

import { describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import type { PointerSample } from "../types/pointer";

/** How many coalesced samples a fast pen reports per move event. */
const SAMPLES_PER_EVENT = 8;
/** How many move events a second of fast drawing produces. */
const EVENTS = 2_000;

function createSample(x: number, phase: PointerSample["phase"] = "move"): PointerSample {
  return {
    phase,
    pointerId: 1,
    kind: "pen",
    isPrimary: true,
    button: 0,
    buttons: 1,
    docX: x,
    docY: x,
    screenX: x,
    screenY: x,
    pressure: 0.7,
    hasPressure: true,
    tiltX: 0,
    tiltY: 0,
    timeStamp: x,
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
  };
}

function createEngine(): DrawingEngine {
  return new DrawingEngine({
    document: createDocument({ name: "Test", width: 400, height: 300 }),
  });
}

describe("the cursor report", () => {
  it("publishes one report per move event, whatever the batch holds", () => {
    const engine = createEngine();
    let reports = 0;
    engine.subscribeCursor(() => {
      reports += 1;
    });

    for (let event = 0; event < EVENTS; event += 1) {
      const batch: PointerSample[] = [];
      for (let index = 0; index < SAMPLES_PER_EVENT; index += 1) {
        batch.push(createSample(event * SAMPLES_PER_EVENT + index));
      }
      engine.handlePointerSamples(batch);
    }

    // One per event, not one per sample: the intermediate positions belong to
    // the same physical move.
    expect(reports).toBe(EVENTS);
  });

  it("still hands every sample of the batch to the tool", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    let reports = 0;
    engine.subscribeCursor(() => {
      reports += 1;
    });

    engine.handlePointerSample(createSample(0, "down"));
    for (let event = 0; event < 4; event += 1) {
      const batch: PointerSample[] = [];
      for (let index = 0; index < SAMPLES_PER_EVENT; index += 1) {
        batch.push(createSample(event * SAMPLES_PER_EVENT + index + 1));
      }
      engine.handlePointerSamples(batch);
    }
    engine.handlePointerSample(createSample(100, "up"));

    const strokes = engine.listStrokes(layerId);
    expect(strokes).toHaveLength(1);
    // Every sample of every batch is on the path: the press, 32 coalesced
    // samples and the release.
    for (let x = 1; x <= 32; x += 1) {
      expect(strokes[0].xs).toContain(x);
    }
    expect(reports).toBe(6);
  });

  it("measures the two paths against each other", () => {
    const engine = createEngine();
    let reports = 0;
    engine.subscribeCursor(() => {
      reports += 1;
    });

    const samples: PointerSample[] = [];
    for (let index = 0; index < EVENTS * SAMPLES_PER_EVENT; index += 1) {
      samples.push(createSample(index));
    }

    // The old path: one call, and therefore one cursor report, per sample.
    const perSample = performance.now();
    for (const sample of samples) {
      engine.handlePointerSample(sample);
    }
    const perSampleMs = performance.now() - perSample;
    const perSampleReports = reports;

    // The new path: one call, and one cursor report, per event.
    reports = 0;
    const perEvent = performance.now();
    for (let event = 0; event < EVENTS; event += 1) {
      const batch = samples.slice(
        event * SAMPLES_PER_EVENT,
        (event + 1) * SAMPLES_PER_EVENT,
      );
      engine.handlePointerSamples(batch);
    }
    const perEventMs = performance.now() - perEvent;

    // The counts are the point; the timings are printed for information.
    expect(perSampleReports).toBe(EVENTS * SAMPLES_PER_EVENT);
    expect(reports).toBe(EVENTS);

    console.log(
      [
        `pointer hot path (Node, no browser, no DOM): ${samples.length} samples`,
        `  one call per sample: ${perSampleReports} cursor reports, ${perSampleMs.toFixed(1)} ms`,
        `  one call per event:  ${reports} cursor reports, ${perEventMs.toFixed(1)} ms`,
        `  each report costs the consumers a DOM write in the brush outline`,
        `  and two in the status bar`,
      ].join("\n"),
    );
  });
});
