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
 * A **section** is the fourth thing the store carries: state that belongs in
 * the file but not in the engine, such as the panel layout or the shell's
 * preferences. The store owns the file, so a section's owner hands its state
 * to the store rather than writing the file itself, and the store writes it
 * back whenever it changes.
 *
 * The store is framework-free, so the whole "read, apply, change, persist"
 * cycle can be exercised in Node.
 */

import type { DrawingEngine } from "../engine/DrawingEngine";
import {
  DEFAULT_APP_SETTINGS,
  SETTINGS_VERSION,
  isFutureSettingsDocument,
  normalizeAppSettings,
  parseSettingsDocument,
  serializeSettingsDocument,
  settingsDocument,
  settingsEqual,
  type AppSettings,
} from "./appSettings";
import type { SettingsGateway } from "./settingsGateway";
import type { SettingsDocument, SettingsSection } from "./settingsSection";

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
  /**
   * Sections of the file that the engine does not own.
   *
   * The store owns the file, so shell state - the panel layout, for
   * instance - cannot write to it directly. A section is the hand-off: the
   * store reads the section out of the file, gives it to its owner, and
   * writes the owner's state back whenever it changes.
   */
  readonly sections?: readonly SettingsSection<unknown>[];
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

/**
 * Whether two plain values say the same thing.
 *
 * The comparison ignores the order of an object's keys: the document that was
 * found on disk and the document that would be written now say the same thing
 * when they hold the same values, whatever order the keys are in.
 */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((entry, index) => jsonEqual(entry, b[index]));
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (!jsonEqual(left[key], right[key])) {
      return false;
    }
  }
  return true;
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
  private readonly sections: readonly SettingsSection<unknown>[];
  private readonly debounceMs: number;
  private readonly schedule: (callback: () => void, delayMs: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  private settings: AppSettings = DEFAULT_APP_SETTINGS;
  /**
   * The document as the store last knew it.
   *
   * The store owns the file, so it has to be able to write back the keys it
   * does not understand: a section another builder owns is not this build's
   * to drop. A file from a newer version is the exception - it is ignored
   * wholesale, so nothing of it is written back.
   *
   * The document is also what the file is compared against, so a change that
   * says nothing new is not written again.
   */
  private document: SettingsDocument = {};
  private loaded = false;
  private applying = false;
  private destroyed = false;
  private pending: unknown = null;
  private writing = false;
  private queued = false;
  private stopWatching: (() => void) | null = null;
  private stopWatchingSections: (() => void) | null = null;
  private readError: string | null = null;
  private writeError: string | null = null;

  constructor(options: SettingsStoreOptions) {
    this.engine = options.engine;
    this.gateway = options.gateway;
    this.sections = options.sections ?? [];
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
   * The sections of the file are handed to their owners the same way.
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

    const document = parseSettingsDocument(text);
    const settings = normalizeAppSettings(document);
    // A file from a newer version is ignored wholesale, so none of it - not
    // even the keys this build does not know - is written back.
    this.document = isFutureSettingsDocument(document) ? {} : document;

    this.applying = true;
    try {
      applyToEngine(this.engine, settings);
      this.applySections(this.document);
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
    if (this.stopWatchingSections !== null) {
      this.stopWatchingSections();
      this.stopWatchingSections = null;
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
        const document = this.buildDocument();
        if (jsonEqual(document, this.document)) {
          // The file already holds this state, so there is nothing to write.
          continue;
        }
        try {
          await this.gateway.write(serializeSettingsDocument(document));
          this.writeError = null;
          this.document = document;
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

  /**
   * The file as it would be written now.
   *
   * The engine's own fields are written over the document that was found on
   * disk, and every section writes its owner's state into it. The keys
   * nobody claims are left exactly as they were found.
   *
   * The engine's fields are written last: they are the file's core, and a
   * section that claimed one of their keys does not take it over.
   */
  private buildDocument(): SettingsDocument {
    const engine = settingsDocument(this.settings);
    const document: SettingsDocument = { ...this.document, ...engine };
    for (const section of this.sections) {
      section.write(document, section.current());
    }
    return { ...document, ...engine };
  }

  /** Hands the document's sections to their owners. */
  private applySections(document: SettingsDocument): void {
    for (const section of this.sections) {
      try {
        section.apply(section.read(document));
      } catch (error) {
        // A section that cannot make sense of its value is its own problem:
        // the rest of the file still loads, and the editor still starts.
        this.readError = describe(error);
      }
    }
  }

  private watch(): void {
    if (this.stopWatching === null) {
      this.stopWatching = this.engine.subscribe(() => this.onEditorChanged());
    }
    if (this.stopWatchingSections === null && this.sections.length > 0) {
      const stops = this.sections.map((section) =>
        section.subscribe(() => this.onSectionChanged()),
      );
      this.stopWatchingSections = () => {
        for (const stop of stops) {
          stop();
        }
      };
    }
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

  /** A section changed: the file has to be written again. */
  private onSectionChanged(): void {
    if (!this.loaded || this.applying) {
      return;
    }
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
