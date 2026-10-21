/**
 * Settings persistence tests.
 *
 * The settings file is the first thing Paka writes that is not a drawing, so
 * the properties being pinned down are the ones a user would notice and the
 * ones a file on disk can break:
 *
 *  - the preferences survive a restart;
 *  - a missing, corrupt or future-versioned file starts the app with the
 *    defaults and no error;
 *  - an out-of-range value is clamped, not rejected;
 *  - changing a preference never dirties the drawing and never adds a
 *    history step - the contract the brush settings have always had;
 *  - a file that cannot be written is a minor inconvenience, not a failure
 *    the user has to act on.
 *
 * Everything runs in Node: the store is framework-free, and the engine accepts
 * a null renderer, so no canvas is needed.
 */

import { describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { DEFAULT_APP_SETTINGS, SETTINGS_VERSION } from "../core/settings/appSettings";
import { SettingsStore } from "../core/settings/settingsStore";
import { MemorySettingsGateway } from "./support/memorySettingsGateway";

/** A scheduler the test drives by hand, so no test waits in real time. */
class ManualTimers {
  private next = 1;
  private readonly pending = new Map<number, () => void>();

  readonly schedule = (callback: () => void): unknown => {
    const id = this.next++;
    this.pending.set(id, callback);
    return id;
  };

  readonly cancel = (handle: unknown): void => {
    this.pending.delete(handle as number);
  };

  /** Runs everything that is waiting, in order. */
  runAll(): void {
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const callback of callbacks) {
      callback();
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

/** Lets every pending microtask finish. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createEngine(): DrawingEngine {
  return new DrawingEngine({ document: createDocument({ name: "Test", width: 200, height: 120 }) });
}

interface Harness {
  readonly engine: DrawingEngine;
  readonly gateway: MemorySettingsGateway;
  readonly timers: ManualTimers;
  readonly store: SettingsStore;
}

function createHarness(gateway: MemorySettingsGateway = new MemorySettingsGateway()): Harness {
  const engine = createEngine();
  const timers = new ManualTimers();
  const store = new SettingsStore({
    engine,
    gateway,
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  return { engine, gateway, timers, store };
}

describe("the settings file", () => {
  it("starts with the defaults when there is no file", async () => {
    const { store, engine } = createHarness();

    await store.load();

    expect(engine.getState().brush).toEqual(DEFAULT_APP_SETTINGS.brush);
    expect(engine.getState().toolId).toBe(DEFAULT_APP_SETTINGS.toolId);
    expect(store.lastError).toBeNull();
  });

  it("starts with the defaults when the file is corrupt", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = "{ this is not json";
    const { store, engine } = createHarness(gateway);

    await store.load();

    expect(engine.getState().brush).toEqual(DEFAULT_APP_SETTINGS.brush);
    expect(engine.getState().fillTolerance).toBe(DEFAULT_APP_SETTINGS.fillTolerance);
    expect(store.lastError).toBeNull();
  });

  it("ignores a file written by a newer version", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({ version: SETTINGS_VERSION + 98, fillTolerance: 200 });
    const { store, engine } = createHarness(gateway);

    await store.load();

    expect(engine.getState().fillTolerance).toBe(DEFAULT_APP_SETTINGS.fillTolerance);
  });

  it("clamps out-of-range values instead of rejecting them", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({
      version: SETTINGS_VERSION,
      fillTolerance: 9999,
      shapeSides: 900,
      shapeInnerRatio: -3,
      shapeRotation: 9000,
      brush: { size: 99999, opacity: 5, hardness: -1 },
    });
    const { store, engine } = createHarness(gateway);

    await store.load();

    const state = engine.getState();
    expect(state.fillTolerance).toBe(255);
    expect(state.shapeSides).toBe(24);
    expect(state.shapeInnerRatio).toBe(0.05);
    expect(state.shapeRotation).toBe(360);
    expect(state.brush.size).toBe(512);
    expect(state.brush.opacity).toBe(1);
    expect(state.brush.hardness).toBe(0);
  });

  it("keeps the fields that are there and defaults the ones that are not", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({
      version: SETTINGS_VERSION,
      toolId: "eraser",
      fillTolerance: 77,
      brush: { size: 42, color: "#ff8800" },
    });
    const { store, engine } = createHarness(gateway);

    await store.load();

    const state = engine.getState();
    expect(state.toolId).toBe("eraser");
    expect(state.fillTolerance).toBe(77);
    expect(state.brush.size).toBe(42);
    expect(state.brush.color).toBe("#ff8800");
    // Everything the file did not mention keeps its default.
    expect(state.brush.opacity).toBe(DEFAULT_APP_SETTINGS.brush.opacity);
    expect(state.gradientType).toBe(DEFAULT_APP_SETTINGS.gradientType);
  });

  it("falls back to the default for a malformed field", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({
      version: SETTINGS_VERSION,
      toolId: "not-a-tool",
      shapeFill: "yes",
      fillTolerance: "lots",
      brush: { size: "big" },
    });
    const { store, engine } = createHarness(gateway);

    await store.load();

    const state = engine.getState();
    expect(state.toolId).toBe(DEFAULT_APP_SETTINGS.toolId);
    expect(state.shapeFill).toBe(DEFAULT_APP_SETTINGS.shapeFill);
    expect(state.fillTolerance).toBe(DEFAULT_APP_SETTINGS.fillTolerance);
    expect(state.brush.size).toBe(DEFAULT_APP_SETTINGS.brush.size);
  });

  it("keeps the editor usable when the read fails", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.readFailure = "the settings could not be read";
    const { store, engine } = createHarness(gateway);

    await store.load();

    expect(engine.getState().brush).toEqual(DEFAULT_APP_SETTINGS.brush);
    expect(store.lastError).toBe("the settings could not be read");
  });
});

describe("the preferences survive a restart", () => {
  it("writes the changed preferences and reads them back", async () => {
    const gateway = new MemorySettingsGateway();

    const first = createHarness(gateway);
    await first.store.load();
    first.engine.setBrush({ size: 42, color: "#123456" });
    first.engine.setTool("eraser");
    first.engine.setShapeFill(true);
    first.engine.setShapeSides(7);
    first.engine.setShapeInnerRatio(0.25);
    first.engine.setShapeRotation(45);
    first.engine.setFillTolerance(77);
    first.engine.setGradientType("radial");
    first.engine.setGradientEndColor("#abcdef");
    first.timers.runAll();
    await settle();

    expect(gateway.writes).toHaveLength(1);

    // A restart: a new engine, a new store, the same file.
    const second = createHarness(gateway);
    await second.store.load();

    const state = second.engine.getState();
    expect(state.brush.size).toBe(42);
    expect(state.brush.color).toBe("#123456");
    expect(state.toolId).toBe("eraser");
    expect(state.shapeFill).toBe(true);
    expect(state.shapeSides).toBe(7);
    expect(state.shapeInnerRatio).toBe(0.25);
    expect(state.shapeRotation).toBe(45);
    expect(state.fillTolerance).toBe(77);
    expect(state.gradientType).toBe("radial");
    expect(state.gradientEndColor).toBe("#abcdef");
  });
});

describe("settings are not document state", () => {
  it("does not dirty the document or add a history step", async () => {
    const { store, engine } = createHarness();
    await store.load();

    engine.setBrush({ size: 99 });
    engine.setTool("bucket");
    engine.setFillTolerance(12);

    const state = engine.getState();
    expect(state.file.dirty).toBe(false);
    expect(state.history.depth).toBe(0);
  });

  it("does not dirty the document or add a history step when applying the file", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({
      version: SETTINGS_VERSION,
      toolId: "gradient",
      fillTolerance: 30,
      brush: { size: 64 },
    });
    const { store, engine } = createHarness(gateway);

    await store.load();

    const state = engine.getState();
    expect(state.file.dirty).toBe(false);
    expect(state.history.depth).toBe(0);
    expect(state.toolId).toBe("gradient");
  });
});

describe("writing the settings", () => {
  it("writes nothing when nothing changed", async () => {
    const { store, timers, gateway } = createHarness();

    await store.load();
    timers.runAll();
    await settle();

    expect(gateway.writes).toHaveLength(0);
  });

  it("coalesces a burst of changes into one write", async () => {
    const { store, engine, timers, gateway } = createHarness();
    await store.load();

    for (let size = 10; size <= 20; size++) {
      engine.setBrush({ size });
    }
    expect(timers.pendingCount).toBe(1);

    timers.runAll();
    await settle();

    expect(gateway.writes).toHaveLength(1);
    expect(JSON.parse(gateway.writes[0]).brush.size).toBe(20);
  });

  it("does not write the file again when the value comes back", async () => {
    const { store, engine, timers, gateway } = createHarness();
    await store.load();

    engine.setBrush({ size: 30 });
    timers.runAll();
    await settle();
    engine.setBrush({ size: DEFAULT_APP_SETTINGS.brush.size });
    timers.runAll();
    await settle();

    // The second change is a change, so it is written: the file has to hold
    // the value the editor has now.
    expect(gateway.writes).toHaveLength(2);
    expect(JSON.parse(gateway.writes[1]).brush.size).toBe(DEFAULT_APP_SETTINGS.brush.size);
  });

  it("keeps the editor usable when the write fails", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.writeFailure = "the disk is full";
    const { store, engine, timers } = createHarness(gateway);
    await store.load();

    engine.setBrush({ size: 55 });
    timers.runAll();
    await settle();

    expect(store.lastError).toBe("the disk is full");
    // The preference is in the editor even though the file could not be written.
    expect(engine.getState().brush.size).toBe(55);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("writes again after a failure, when the next change comes", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.writeFailure = "the disk is full";
    const { store, engine, timers } = createHarness(gateway);
    await store.load();

    engine.setBrush({ size: 55 });
    timers.runAll();
    await settle();
    expect(gateway.writes).toHaveLength(0);

    gateway.writeFailure = null;
    engine.setBrush({ size: 56 });
    timers.runAll();
    await settle();

    expect(gateway.writes).toHaveLength(1);
    expect(JSON.parse(gateway.writes[0]).brush.size).toBe(56);
  });

  it("does not write the file when the drawing changes", async () => {
    const { store, engine, timers, gateway } = createHarness();
    await store.load();

    engine.newDocument({ name: "Another", width: 100, height: 100 });
    timers.runAll();
    await settle();

    expect(gateway.writes).toHaveLength(0);
  });

  it("never writes twice at the same time", async () => {
    const gateway = new MemorySettingsGateway();
    const { store, engine, timers } = createHarness(gateway);
    await store.load();

    gateway.holdWrites();
    engine.setBrush({ size: 10 });
    timers.runAll();
    await settle();

    // A change while the first write is still in flight.
    engine.setBrush({ size: 20 });
    timers.runAll();
    await settle();

    expect(gateway.maxConcurrent).toBe(1);

    gateway.release();
    await settle();

    // Both changes are on disk, one after the other.
    expect(gateway.writes).toHaveLength(2);
    expect(JSON.parse(gateway.writes[1]).brush.size).toBe(20);
  });

  it("writes a pending change when the store is torn down", async () => {
    const { store, engine, timers, gateway } = createHarness();
    await store.load();

    engine.setBrush({ size: 33 });
    // The change is waiting for the debounce.
    expect(timers.pendingCount).toBe(1);

    store.destroy();
    await settle();

    expect(gateway.writes).toHaveLength(1);
    expect(JSON.parse(gateway.writes[0]).brush.size).toBe(33);
  });
});
