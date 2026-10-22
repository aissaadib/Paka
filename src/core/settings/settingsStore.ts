/**
 * The settings store: reads the preferences at startup, applies them to the
 * editor, and writes them back when the user changes one.
 *
 * Three rules shape it:
 *
 *  1. **Settings are not document state.** Applying them goes through the
 *     engine's editor-state setters, which is why a restored preference costs
 *     no history entry, no revision bump and no dirty flag - the same
 *     contract the brush settings have always had.
 *  2. **The editor is the authority.** The store keeps the preferences it last
 *     saw; when the engine publishes, the store compares what the engine now
 *     holds with what it has, and only a real difference is written.
 *  3. **A settings file that cannot be read or written is not the user's
 *     problem to solve.** A failed read falls back to the defaults, and a
 *     failed write is recorded and forgotten. Neither stops the editor, and
 *     neither is raised as an error in the UI.
 *
 * The store is framework-free, so the whole "read, apply, change, persist"
 * cycle can be exercised in Node.
 */

import type { DrawingEngine } from "../engine/DrawingEngine";
import {
  DEFAULT_APP_SETTINGS,
  SETTINGS_VERSION,
  parseAppSettings,
  serializeAppSettings,
  settingsEqual,
  type AppSettings,
} from "./appSettings";
import type { SettingsGateway } from "./settingsGateway";

/**
 * How long a change waits before the file is written.
 *
 * The brush sliders are a continuous gesture, so every value they produce is a
 * change; a short debounce turns a drag into one write without making the
 * preference feel lost if the app is closed right after it.
 */
const DEFAULT_DEBOUNCE_MS = 300;

export interface SettingsStoreOptions {
  readonly engine: DrawingEngine;
  readonly gateway: SettingsGateway;
  /** How long a change waits before the file is written. */
  readonly debounceMs?: number;
  /** Injected timer functions, so the tests need not wait in real time. */
  readonly schedule?: (callback: () => void, delayMs: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}

/** Writes the preferences into the editor. Editor state only: no history, no dirty. */
function applyToEngine(engine: DrawingEngine, settings: AppSettings): void {
  // The colours are restored, not picked: the recent-colours list is session
  // state, so it starts empty rather than holding the colours the last
  // session ended with.
  engine.setBrush(settings.brush, { record: false });
  engine.setSecondaryColor(settings.secondaryColor, { record: false });
  engine.setPalette(settings.palette);
  engine.setPresets(settings.presets);
  engine.setTool(settings.toolId);
  engine.setShapeFill(settings.shapeFill);
  engine.setShapeSides(settings.shapeSides);
  engine.setShapeInnerRatio(settings.shapeInnerRatio);
  engine.setShapeRotation(settings.shapeRotation);
  engine.setFillTolerance(settings.fillTolerance);
  engine.setGradientType(settings.gradientType);
  engine.setGradientEndColor(settings.gradientEndColor);
  engine.setGridVisible(settings.gridVisible);
  engine.setGridSpacing(settings.gridSpacing);
  engine.setGridSnapping(settings.gridSnapping);
}

/** Reads the preferences the editor currently holds. */
function readFromEngine(engine: DrawingEngine): AppSettings {
  const snapshot = engine.getState();
  return {
    version: SETTINGS_VERSION,
    brush: snapshot.brush,
    secondaryColor: snapshot.secondaryColor,
    palette: snapshot.palette,
    presets: snapshot.presets,
    toolId: snapshot.toolId,
    shapeFill: snapshot.shapeFill,
    shapeSides: snapshot.shapeSides,
    shapeInnerRatio: snapshot.shapeInnerRatio,
    shapeRotation: snapshot.shapeRotation,
    fillTolerance: snapshot.fillTolerance,
    gradientType: snapshot.gradientType,
    gradientEndColor: snapshot.gradientEndColor,
    gridVisible: snapshot.gridVisible,
    gridSpacing: snapshot.gridSpacing,
    gridSnapping: snapshot.gridSnapping,
  };
}

export class SettingsStore {
  private readonly engine: DrawingEngine;
  private readonly gateway: SettingsGateway;
  private readonly debounceMs: number;
  private readonly schedule: (callback: () => void, delayMs: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  private settings: AppSettings = DEFAULT_APP_SETTINGS;
  private loaded = false;
  private applying = false;
  private destroyed = false;
  private pending: unknown = null;
  private writing = false;
  private queued = false;
  private stopWatching: (() => void) | null = null;
  private readError: string | null = null;
  private writeError: string | null = null;

  constructor(options: SettingsStoreOptions) {
    this.engine = options.engine;
    this.gateway = options.gateway;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.schedule =
      options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as never));
  }

  /** The preferences the store last saw. */
  get current(): AppSettings {
    return this.settings;
  }

  /** The last read or write failure, or `null`. Recorded, never raised. */
  get lastError(): string | null {
    return this.readError ?? this.writeError;
  }

  /**
   * Reads the settings, applies them to the editor, and starts watching for
   * changes.
   *
   * A file that is missing, malformed or from a newer version yields the
   * defaults; none of them is an error, and none of them stops the editor.
   */
  async load(): Promise<AppSettings> {
    let text: string | null = null;
    try {
      text = await this.gateway.read();
    } catch (error) {
      this.readError = describe(error);
    }

    if (this.destroyed) {
      // The store was torn down while the file was being read - React's
      // development double-mount does exactly this. Applying the settings now
      // would write them over a store that is already gone.
      return this.settings;
    }

    const settings = parseAppSettings(text);
    this.applying = true;
    try {
      applyToEngine(this.engine, settings);
    } finally {
      this.applying = false;
    }

    // The editor is the authority, so the store keeps what the editor holds
    // rather than what it asked for.
    this.settings = readFromEngine(this.engine);
    this.loaded = true;
    this.watch();
    return this.settings;
  }

  /** Stops watching, and writes anything still pending. */
  destroy(): void {
    this.destroyed = true;
    if (this.stopWatching !== null) {
      this.stopWatching();
      this.stopWatching = null;
    }
    if (this.pending !== null) {
      this.cancel(this.pending);
      this.pending = null;
      void this.flush();
    }
  }

  /** Writes the current settings now, without waiting for the debounce. */
  async flush(): Promise<void> {
    if (this.writing) {
      // One write at a time. The change that arrived during the write is
      // written by the loop below, so nothing is lost.
      this.queued = true;
      return;
    }
    this.writing = true;
    try {
      do {
        this.queued = false;
        const contents = serializeAppSettings(this.settings);
        try {
          await this.gateway.write(contents);
          this.writeError = null;
        } catch (error) {
          this.writeError = describe(error);
          // A settings file that cannot be written is a minor inconvenience,
          // not a failure the user has to act on: the editor carries on with
          // the preference in memory, and the next change tries again.
        }
      } while (this.queued);
    } finally {
      this.writing = false;
    }
  }

  private watch(): void {
    if (this.stopWatching !== null) {
      return;
    }
    this.stopWatching = this.engine.subscribe(() => this.onEditorChanged());
  }

  private onEditorChanged(): void {
    if (!this.loaded || this.applying) {
      return;
    }
    const next = readFromEngine(this.engine);
    if (settingsEqual(next, this.settings)) {
      return;
    }
    this.settings = next;
    this.scheduleWrite();
  }

  private scheduleWrite(): void {
    if (this.pending !== null) {
      this.cancel(this.pending);
      this.pending = null;
    }
    this.pending = this.schedule(() => {
      this.pending = null;
      void this.flush();
    }, this.debounceMs);
  }
}
