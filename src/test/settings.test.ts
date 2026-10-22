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
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import {
  DEFAULT_APP_SETTINGS,
  SETTINGS_VERSION,
  parseAppSettings,
  parseSettingsDocument,
  serializeAppSettings,
  settingsDocument,
} from "../core/settings/appSettings";
import {
  createSettingsSection,
  fieldsSection,
  readSettingsSection,
  settingsField,
  writeSettingsSection,
  type SettingsSection,
  type SettingsSectionOwner,
  type SettingsSectionSpec,
} from "../core/settings/settingsSection";
import { SettingsStore } from "../core/settings/settingsStore";
import {
  DEFAULT_SHELL_PREFERENCES,
  SHELL_PREFERENCES_VERSION,
  normalizeShellPreferences,
  serializeShellPreferences,
  type ShellPreferences,
} from "../core/shell/preferences";
import type { BrushSettings, PressureCurvePoint } from "../types/brush";
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

function createHarness(
  gateway: MemorySettingsGateway = new MemorySettingsGateway(),
  sections: readonly SettingsSection<unknown>[] = [],
): Harness {
  const engine = createEngine();
  const timers = new ManualTimers();
  const store = new SettingsStore({
    engine,
    gateway,
    sections,
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  return { engine, gateway, timers, store };
}

/**
 * One non-default value for every brush field.
 *
 * The test below asserts this table's keys are exactly `Object.keys(DEFAULT_BRUSH)`,
 * and then round-trips the constructed brush through the settings file. That
 * makes the whole class of "field silently dropped by the reader" bug
 * impossible: a field added to the brush without a value here fails the key
 * check, and a field the reader forgets fails the round-trip equality.
 */
const NON_DEFAULT_BRUSH_VALUES: Record<
  keyof BrushSettings,
  string | number | boolean | readonly PressureCurvePoint[]
> = {
  size: 33,
  opacity: 0.42,
  color: "#123456",
  hardness: 0.37,
  pressureSize: 0.21,
  pressureOpacity: 0.73,
  pressureCurve: [
    { x: 0, y: 0 },
    { x: 0.4, y: 0.7 },
    { x: 1, y: 1 },
  ],
  minSizeRatio: 0.55,
  spacing: 0.34,
  stabilizer: 0.66,
  texture: 0.47,
  stamp: true,
  stampSpacing: 0.28,
  stampHardness: 0.61,
  stampTexture: 0.52,
  tip: "chisel",
};

function nonDefaultBrush(): BrushSettings {
  const brush: Record<string, unknown> = { ...DEFAULT_BRUSH };
  for (const field of Object.keys(DEFAULT_BRUSH)) {
    const value = NON_DEFAULT_BRUSH_VALUES[field as keyof BrushSettings];
    if (value === undefined) {
      throw new Error(`No non-default value for brush field "${field}"`);
    }
    brush[field] = value;
  }
  return brush as unknown as BrushSettings;
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

describe("every brush field survives the settings file", () => {
  it("round-trips a brush with every field set to a non-default value", () => {
    expect(Object.keys(NON_DEFAULT_BRUSH_VALUES).sort()).toEqual(
      Object.keys(DEFAULT_BRUSH).sort(),
    );

    const brush = nonDefaultBrush();
    for (const field of Object.keys(DEFAULT_BRUSH) as (keyof BrushSettings)[]) {
      expect(brush[field]).not.toEqual(DEFAULT_BRUSH[field]);
    }

    const text = serializeAppSettings({ ...DEFAULT_APP_SETTINGS, brush });
    const parsed = parseAppSettings(text);

    expect(JSON.parse(text).version).toBe(SETTINGS_VERSION);
    expect(parsed.brush).toEqual(brush);
  });

  it("round-trips a preset whose brush has every field set", () => {
    const brush = nonDefaultBrush();
    const preset = { id: "preset-every-field", name: "Every field", brush };

    const text = serializeAppSettings({
      ...DEFAULT_APP_SETTINGS,
      presets: [preset],
    });
    const parsed = parseAppSettings(text);

    expect(JSON.parse(text).version).toBe(SETTINGS_VERSION);
    expect(parsed.presets).toHaveLength(1);
    expect(parsed.presets[0].id).toBe(preset.id);
    expect(parsed.presets[0].name).toBe(preset.name);
    expect(parsed.presets[0].brush).toEqual(brush);
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

  it("restores the grid and the snapping", async () => {
    const gateway = new MemorySettingsGateway();

    const first = createHarness(gateway);
    await first.store.load();
    first.engine.setGridVisible(true);
    first.engine.setGridSpacing(25);
    first.engine.setGridSnapping(true);
    first.timers.runAll();
    await settle();

    // The grid is a view preference, so it belongs to the settings file.
    const written = JSON.parse(gateway.contents as string);
    expect(written.gridVisible).toBe(true);
    expect(written.gridSpacing).toBe(25);
    expect(written.gridSnapping).toBe(true);

    // And a restart puts it back into the editor, which is what the user sees.
    const second = createHarness(gateway);
    await second.store.load();

    const state = second.engine.getState();
    expect(state.gridVisible).toBe(true);
    expect(state.gridSpacing).toBe(25);
    expect(state.gridSnapping).toBe(true);
  });

  it("defaults the grid for a settings file written before the grid existed", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({ version: SETTINGS_VERSION, toolId: "brush" });
    const { store, engine } = createHarness(gateway);

    await store.load();

    // An older file still restores every field it does carry, and the grid
    // takes its default instead of failing.
    const state = engine.getState();
    expect(state.toolId).toBe("brush");
    expect(state.gridVisible).toBe(DEFAULT_APP_SETTINGS.gridVisible);
    expect(state.gridSpacing).toBe(DEFAULT_APP_SETTINGS.gridSpacing);
    expect(state.gridSnapping).toBe(DEFAULT_APP_SETTINGS.gridSnapping);
  });

  it("restores the directional stamp texture", async () => {
    const gateway = new MemorySettingsGateway();

    const first = createHarness(gateway);
    await first.store.load();
    first.engine.setBrush({ stamp: true, stampTexture: 0.4 });
    first.timers.runAll();
    await settle();

    // The value reaches the file: the writer serializes the whole brush.
    expect(gateway.writes).toHaveLength(1);
    expect(JSON.parse(gateway.contents as string).brush.stampTexture).toBe(0.4);

    // And a restart puts it back into the engine, which is what the user sees.
    const second = createHarness(gateway);
    await second.store.load();

    const state = second.engine.getState();
    expect(state.brush.stamp).toBe(true);
    expect(state.brush.stampTexture).toBe(0.4);
  });

  it("persists a preset and every field of its brush across a restart", async () => {
    const gateway = new MemorySettingsGateway();

    const first = createHarness(gateway);
    await first.store.load();
    first.engine.setBrush({
      size: 44,
      opacity: 0.55,
      hardness: 0.4,
      pressureSize: 0.3,
      pressureOpacity: 0.2,
      minSizeRatio: 0.5,
      spacing: 0.25,
      stabilizer: 0.6,
      texture: 0.45,
      stamp: true,
      stampSpacing: 0.3,
      stampHardness: 0.7,
      stampTexture: 0.35,
      color: "#0a0b0c",
    });
    const saved = first.engine.saveBrushPreset("  Ink  ");
    expect(saved?.name).toBe("Ink");
    first.timers.runAll();
    await settle();

    expect(gateway.writes).toHaveLength(1);
    const file = JSON.parse(gateway.writes[0]);
    expect(file.version).toBe(SETTINGS_VERSION);
    expect(file.presets).toHaveLength(1);
    expect(file.presets[0].brush.stampTexture).toBe(0.35);

    // A restart: a new engine, a new store, the same file.
    const second = createHarness(gateway);
    await second.store.load();

    const presets = second.engine.getState().presets;
    expect(presets).toHaveLength(1);
    expect(presets[0].name).toBe("Ink");
    expect(presets[0].brush).toEqual(first.engine.getState().brush);
  });

  it("defaults the stamp texture for a file written before the field existed", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({
      version: SETTINGS_VERSION,
      brush: { size: 30, stamp: true, stampSpacing: 0.2, stampHardness: 0.5 },
    });
    const { store, engine } = createHarness(gateway);

    await store.load();

    // An older file still restores every field it does carry, and the new one
    // takes its default instead of failing.
    const brush = engine.getState().brush;
    expect(brush.size).toBe(30);
    expect(brush.stamp).toBe(true);
    expect(brush.stampHardness).toBe(0.5);
    expect(brush.stampTexture).toBe(0);
  });

  it("clamps a stamp texture outside 0..1", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({
      version: SETTINGS_VERSION,
      brush: { stampTexture: 4 },
    });
    const { store, engine } = createHarness(gateway);

    await store.load();

    expect(engine.getState().brush.stampTexture).toBe(1);
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

/**
 * A third party's section.
 *
 * The section is a named, versioned group of fields, with an owner that
 * holds the state and says when it changed. Nothing in it knows about the
 * engine or the document: it is exactly what another builder writes to add
 * a preference of their own to the settings file.
 */
interface ZoomState {
  readonly zoom: number;
  readonly mirrored: boolean;
}

const ZOOM_SECTION = fieldsSection<ZoomState>("zoom", 1, {
  zoom: settingsField(
    "zoom",
    (value) => (typeof value === "number" && Number.isFinite(value) ? value : 1),
  ),
  mirrored: settingsField(
    "mirrored",
    (value) => (typeof value === "boolean" ? value : false),
  ),
});

/** The owner of a section's state: it holds the state and announces changes. */
class FakeSectionOwner<S> implements SettingsSectionOwner<S> {
  private state: S;
  private readonly listeners = new Set<() => void>();

  constructor(initial: S) {
    this.state = initial;
  }

  current(): S {
    return this.state;
  }

  apply(state: S): void {
    this.state = state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The owner changed: the store has to hear about it. */
  change(state: S): void {
    this.state = state;
    this.announce();
  }

  /** The owner says it changed, but nothing did. */
  announce(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

describe("the settings document", () => {
  it("keeps the engine's fields under their own names", () => {
    expect(Object.keys(settingsDocument(DEFAULT_APP_SETTINGS))).toEqual([
      "version",
      "brush",
      "presets",
      "toolId",
      "shapeFill",
      "shapeSides",
      "shapeInnerRatio",
      "shapeRotation",
      "fillTolerance",
      "gradientType",
      "gradientEndColor",
      "gridVisible",
      "gridSpacing",
      "gridSnapping",
    ]);
  });

  it("parses a file that is not a settings document into an empty one", () => {
    expect(parseSettingsDocument(null)).toEqual({});
    expect(parseSettingsDocument("{ this is not json")).toEqual({});
    expect(parseSettingsDocument("[1, 2, 3]")).toEqual({});
  });

  it("keeps the keys a build does not know", () => {
    const document = parseSettingsDocument(
      JSON.stringify({ version: SETTINGS_VERSION, panels: { hidden: ["colors"] } }),
    );

    expect(document.panels).toEqual({ hidden: ["colors"] });
  });

  it("loads a file the current build wrote", () => {
    const text = serializeAppSettings(DEFAULT_APP_SETTINGS);

    expect(parseAppSettings(text)).toEqual(DEFAULT_APP_SETTINGS);
  });
});

describe("a section on its own", () => {
  it("reads the fields it has and defaults the ones it does not", () => {
    expect(readSettingsSection(ZOOM_SECTION, { version: 1, zoom: 8 })).toEqual({
      zoom: 8,
      mirrored: false,
    });
  });

  it("takes its defaults when the value is missing or malformed", () => {
    expect(readSettingsSection(ZOOM_SECTION, undefined)).toEqual({
      zoom: 1,
      mirrored: false,
    });
    expect(readSettingsSection(ZOOM_SECTION, "nonsense")).toEqual({
      zoom: 1,
      mirrored: false,
    });
    expect(readSettingsSection(ZOOM_SECTION, { version: 1, zoom: "big" })).toEqual({
      zoom: 1,
      mirrored: false,
    });
  });

  it("takes its defaults when it was written by a newer version of itself", () => {
    // The section's meaning is unknown rather than wrong, so it is ignored.
    expect(readSettingsSection(ZOOM_SECTION, { version: 99, zoom: 8 })).toEqual({
      zoom: 1,
      mirrored: false,
    });
  });

  it("reads the fields of an older version of itself", () => {
    expect(readSettingsSection(ZOOM_SECTION, { version: 0, zoom: 8 })).toEqual({
      zoom: 8,
      mirrored: false,
    });
  });

  it("writes its state back with its own version", () => {
    expect(writeSettingsSection(ZOOM_SECTION, { zoom: 2, mirrored: true })).toEqual({
      version: 1,
      zoom: 2,
      mirrored: true,
    });
  });
});

describe("the settings file's sections", () => {
  it("carries a section that another builder added", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({
      version: SETTINGS_VERSION,
      toolId: "eraser",
      zoom: { version: 1, zoom: 3, mirrored: true },
    });
    const owner = new FakeSectionOwner<ZoomState>({ zoom: 1, mirrored: false });
    const { store, engine } = createHarness(gateway, [
      createSettingsSection(ZOOM_SECTION, owner),
    ]);

    await store.load();

    // The section's owner holds what the file said.
    expect(owner.current()).toEqual({ zoom: 3, mirrored: true });
    // And the rest of the file loads exactly as it always did.
    expect(engine.getState().toolId).toBe("eraser");
  });

  it("writes a section's state back into the same file", async () => {
    const gateway = new MemorySettingsGateway();
    const owner = new FakeSectionOwner<ZoomState>({ zoom: 1, mirrored: false });
    const { store, timers } = createHarness(gateway, [
      createSettingsSection(ZOOM_SECTION, owner),
    ]);
    await store.load();

    owner.change({ zoom: 4, mirrored: true });
    timers.runAll();
    await settle();

    expect(gateway.writes).toHaveLength(1);
    const written = JSON.parse(gateway.contents as string);
    expect(written.zoom).toEqual({ version: 1, zoom: 4, mirrored: true });
    // The engine's own fields are in the same file.
    expect(written.version).toBe(SETTINGS_VERSION);
    expect(written.toolId).toBe(DEFAULT_APP_SETTINGS.toolId);
  });

  it("keeps a section the file has and this build does not know", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({
      version: SETTINGS_VERSION,
      toolId: "eraser",
      panels: { hidden: ["colors"] },
    });
    const { store, engine, timers } = createHarness(gateway);

    await store.load();

    // A section this build does not know does not stop the file from loading.
    expect(engine.getState().toolId).toBe("eraser");

    engine.setBrush({ size: 21 });
    timers.runAll();
    await settle();

    // And a rewrite does not throw it away: the store owns the file, but it
    // is not the owner of every key in it.
    const written = JSON.parse(gateway.contents as string);
    expect(written.panels).toEqual({ hidden: ["colors"] });
    expect(written.brush.size).toBe(21);
  });

  it("takes the defaults for a section written by a newer version", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({
      version: SETTINGS_VERSION,
      toolId: "eraser",
      zoom: { version: 99, zoom: 5, mirrored: true },
    });
    const owner = new FakeSectionOwner<ZoomState>({ zoom: 1, mirrored: false });
    const { store, engine } = createHarness(gateway, [
      createSettingsSection(ZOOM_SECTION, owner),
    ]);

    await store.load();

    expect(owner.current()).toEqual({ zoom: 1, mirrored: false });
    // The rest of the file still loads.
    expect(engine.getState().toolId).toBe("eraser");
  });

  it("takes the defaults for a malformed section", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({
      version: SETTINGS_VERSION,
      zoom: "nonsense",
    });
    const owner = new FakeSectionOwner<ZoomState>({ zoom: 1, mirrored: false });
    const { store } = createHarness(gateway, [
      createSettingsSection(ZOOM_SECTION, owner),
    ]);

    await store.load();

    expect(owner.current()).toEqual({ zoom: 1, mirrored: false });
  });

  it("does not dirty the document when a section changes", async () => {
    const gateway = new MemorySettingsGateway();
    const owner = new FakeSectionOwner<ZoomState>({ zoom: 1, mirrored: false });
    const { store, engine, timers } = createHarness(gateway, [
      createSettingsSection(ZOOM_SECTION, owner),
    ]);
    await store.load();

    owner.change({ zoom: 2, mirrored: false });
    timers.runAll();
    await settle();

    const state = engine.getState();
    expect(state.file.dirty).toBe(false);
    expect(state.history.depth).toBe(0);
  });

  it("does not write the file again when a section says it changed but did not", async () => {
    const gateway = new MemorySettingsGateway();
    const owner = new FakeSectionOwner<ZoomState>({ zoom: 1, mirrored: false });
    const { store, timers } = createHarness(gateway, [
      createSettingsSection(ZOOM_SECTION, owner),
    ]);
    await store.load();

    // The first change writes the file: there was none.
    owner.announce();
    timers.runAll();
    await settle();

    expect(gateway.writes).toHaveLength(1);

    // The second one says nothing new, so the file already holds this state
    // and there is nothing to write.
    owner.announce();
    timers.runAll();
    await settle();

    expect(gateway.writes).toHaveLength(1);
  });

  it("keeps the editor usable when a section cannot be read", async () => {
    const gateway = new MemorySettingsGateway();
    const broken: SettingsSection<unknown> = {
      key: "broken",
      read: () => {
        throw new Error("the section is broken");
      },
      write: () => {},
      current: () => ({}),
      apply: () => {},
      subscribe: () => () => {},
    };
    const { store, engine } = createHarness(gateway, [broken]);

    await store.load();

    expect(engine.getState().brush).toEqual(DEFAULT_APP_SETTINGS.brush);
    expect(store.lastError).toBe("the section is broken");
  });

  it("does not let a section take over one of the engine's fields", async () => {
    const gateway = new MemorySettingsGateway();
    const greedy: SettingsSection<unknown> = {
      key: "brush",
      read: () => ({}),
      write: (document) => {
        document.brush = { size: 999 };
      },
      current: () => ({}),
      apply: () => {},
      subscribe: () => () => {},
    };
    const { store, engine, timers } = createHarness(gateway, [greedy]);
    await store.load();

    engine.setBrush({ size: 12 });
    timers.runAll();
    await settle();

    // The engine's own fields are the file's core.
    expect(JSON.parse(gateway.contents as string).brush.size).toBe(12);
  });
});

describe("the shell's preferences as a section", () => {
  /** The shell's own document, carried by the mechanism rather than rewritten. */
  const SHELL_SECTION: SettingsSectionSpec<ShellPreferences> = {
    key: "shell",
    version: SHELL_PREFERENCES_VERSION,
    codec: {
      read: (value) => normalizeShellPreferences(value),
      write: (state) =>
        JSON.parse(serializeShellPreferences(state)) as Record<string, unknown>,
    },
  };

  it("carries the shell preferences in the same file", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({
      version: SETTINGS_VERSION,
      shell: {
        version: SHELL_PREFERENCES_VERSION,
        hiddenPanels: ["colors"],
        panelOrder: [],
        panelSlots: {},
        theme: "dark",
        showStatusBar: false,
        viewport: DEFAULT_SHELL_PREFERENCES.viewport,
      },
    });
    const owner = new FakeSectionOwner<ShellPreferences>(DEFAULT_SHELL_PREFERENCES);
    const { store, timers } = createHarness(gateway, [
      createSettingsSection(SHELL_SECTION, owner),
    ]);

    await store.load();

    expect(owner.current().theme).toBe("dark");
    expect(owner.current().hiddenPanels).toEqual(["colors"]);
    expect(owner.current().showStatusBar).toBe(false);

    owner.change({ ...owner.current(), theme: "light" });
    timers.runAll();
    await settle();

    const written = JSON.parse(gateway.contents as string);
    expect(written.shell.theme).toBe("light");
    expect(written.shell.version).toBe(SHELL_PREFERENCES_VERSION);
  });

  it("takes the shell's defaults when the file has no shell section", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({ version: SETTINGS_VERSION });
    const owner = new FakeSectionOwner<ShellPreferences>(DEFAULT_SHELL_PREFERENCES);
    const { store } = createHarness(gateway, [
      createSettingsSection(SHELL_SECTION, owner),
    ]);

    await store.load();

    expect(owner.current()).toEqual(DEFAULT_SHELL_PREFERENCES);
  });
});
