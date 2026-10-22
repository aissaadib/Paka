/**
 * The document session registry: the open documents, and which one is active.
 *
 * One session per open document, and **each session owns its own
 * `DrawingEngine`**. That is the whole trick behind the tabs: the document,
 * the strokes, the undo history, the selection and the viewport all live
 * inside the engine, so two sessions cannot share any of them by accident.
 * There is no "swap the document into the one engine and hope the history
 * follows" step, because there is only ever one engine per document.
 *
 * The registry never touches pixels. The canvas is bound to the *active*
 * session's engine, and switching sessions rebinds it; a background session
 * keeps its document, its history and its viewport, but has no renderer until
 * it is shown again.
 *
 * The preferences (the brush, the tool, the grid) are a different matter: they
 * belong to the application, not to a document, so they live in one place -
 * the *preferences engine* - and are mirrored into the active session. Two
 * tabs therefore always draw with the same brush, and the settings file still
 * describes the brush the user last chose.
 */

import type { DrawingEngine } from "../engine/DrawingEngine";
import type { ParsedProject } from "../project/projectFormat";
import { settingsEqual } from "../settings/appSettings";
import {
  applyPreferencesToEngine,
  readPreferencesFromEngine,
} from "../settings/settingsStore";
import { createId } from "../../utils/id";
import { fileNameOf } from "../../utils/path";
import type { Listener } from "../../utils/store";

/** One open document: its own engine, and therefore its own state. */
export interface DocumentSession {
  readonly id: string;
  readonly engine: DrawingEngine;
}

/**
 * What the tab strip shows about a session.
 *
 * A summary is a *view* of a session, not the session itself: it holds no
 * document data, so the tab strip can render a row of tabs without touching a
 * single stroke.
 */
export interface DocumentSessionSummary {
  readonly id: string;
  /** The file name, or the drawing's own name when it has no file yet. */
  readonly title: string;
  /** Where the document lives on disk, or `null` when it was never saved. */
  readonly path: string | null;
  /** True when the document has changes that are not on disk. */
  readonly dirty: boolean;
  /** True for the session the canvas is showing. */
  readonly active: boolean;
}

/** The tab strip's view of the registry. */
export interface DocumentSessionState {
  readonly activeId: string | null;
  readonly sessions: readonly DocumentSessionSummary[];
}

const EMPTY_STATE: DocumentSessionState = { activeId: null, sessions: [] };

export interface SessionRegistryOptions {
  /**
   * Creates the engine for a new session.
   *
   * The index is the session's position in the registry, so the first session
   * can be built differently from the rest - the first one inherits the
   * editor's initial document, for instance.
   */
  readonly createEngine: (index: number) => DrawingEngine;
  /**
   * The engine that holds the application preferences.
   *
   * It is never a document: it exists so the preferences have one stable home
   * while the active session changes underneath them.
   */
  readonly preferencesEngine: DrawingEngine;
}

/**
 * True when two paths name the same file.
 *
 * Windows and macOS paths are compared without regard to case, because their
 * file systems are: `C:\Art\Cat.paka` and `c:\art\cat.paka` are one file, and
 * two tabs on one file would mean two editors writing over each other. A
 * POSIX path is compared exactly, so two genuinely different files stay two
 * files.
 */
export function samePath(left: string, right: string): boolean {
  const a = normalizePath(left);
  const b = normalizePath(right);
  if (a === b) {
    return true;
  }
  return isWindowsStylePath(a) && isWindowsStylePath(b) && a.toLowerCase() === b.toLowerCase();
}

/** Trims trailing separators so two spellings of one path compare equal. */
function normalizePath(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

/** True when the path looks like a Windows path (a drive letter or backslashes). */
function isWindowsStylePath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.includes("\\");
}

function sameSummaries(
  left: readonly DocumentSessionSummary[],
  right: readonly DocumentSessionSummary[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((summary, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      summary.id === other.id &&
      summary.title === other.title &&
      summary.path === other.path &&
      summary.dirty === other.dirty &&
      summary.active === other.active
    );
  });
}

/**
 * What closing a tab would do.
 *
 * A tab whose document has unsaved changes is never closed silently: the user
 * is asked whether to save it, to discard it or to keep it. A clean tab is
 * simply closed.
 *
 * The rule is a function of the session alone, so it can be exercised without
 * a window, and the tab strip, the menu and the window close can all ask the
 * same question.
 */
export function tabCloseDecision(session: DocumentSession): "close" | "confirm" {
  return session.engine.getState().file.dirty ? "confirm" : "close";
}

/**
 * The open documents.
 *
 * The registry is framework-free, so the whole "open, switch, close, forget"
 * cycle can be exercised in Node.
 */
export class DocumentSessionRegistry {
  private readonly createEngine: (index: number) => DrawingEngine;
  private readonly preferencesEngine: DrawingEngine;
  private readonly sessions: DocumentSession[] = [];
  private readonly engineStops = new Map<string, () => void>();
  private readonly activeListeners = new Set<Listener>();
  private readonly stateListeners = new Set<Listener>();
  private activeId: string | null = null;
  private state: DocumentSessionState = EMPTY_STATE;
  private syncing = false;

  constructor(options: SessionRegistryOptions) {
    this.createEngine = options.createEngine;
    this.preferencesEngine = options.preferencesEngine;
    this.preferencesEngine.subscribe(() => this.pushPreferencesToActive());
  }

  /** The session the canvas is showing. */
  get active(): DocumentSession {
    const session = this.sessions.find((candidate) => candidate.id === this.activeId);
    if (session === undefined) {
      throw new Error("The document session registry has no active session.");
    }
    return session;
  }

  /** Every open session, in the order the tabs are shown. */
  get list(): readonly DocumentSession[] {
    return this.sessions;
  }

  /** The engine that holds the application preferences. */
  get preferences(): DrawingEngine {
    return this.preferencesEngine;
  }

  /** The tab strip's view of the registry. */
  getState(): DocumentSessionState {
    return this.state;
  }

  /** Notified when the tab strip's view changes. */
  subscribe(listener: Listener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /**
   * Notified when the *active* document changes, or when the active document
   * itself changes.
   *
   * This is what the editor's own store subscribes to: React reads the active
   * session's snapshot, so it has to be told when that snapshot is no longer
   * the current one.
   */
  subscribeActive(listener: Listener): () => void {
    this.activeListeners.add(listener);
    return () => {
      this.activeListeners.delete(listener);
    };
  }

  /** True when at least one open document has changes that are not on disk. */
  get hasUnsavedChanges(): boolean {
    return this.sessions.some((session) => session.engine.getState().file.dirty);
  }

  /**
   * Opens a document as a new session and makes it active.
   *
   * The engine is created here and loaded here, so a session is never half
   * built: a caller either gets a session with the document in it, or an
   * error and no session at all.
   */
  open(project: ParsedProject, path: string | null): DocumentSession {
    const existing = path === null ? undefined : this.findByPath(path);
    if (existing !== undefined) {
      this.activate(existing.id);
      return existing;
    }

    const session = this.create();
    session.engine.loadProject(project, path);
    this.refresh();
    return session;
  }

  /** Creates an empty session and makes it active. */
  create(): DocumentSession {
    const engine = this.createEngine(this.sessions.length);
    const session: DocumentSession = { id: createId("session"), engine };
    this.sessions.push(session);

    this.engineStops.set(
      session.id,
      engine.subscribe(() => this.onEngineChanged(session)),
    );

    // A new session starts with the preferences the application holds, not
    // with the engine defaults: the brush the user last chose is the brush
    // the new tab draws with.
    applyPreferencesToEngine(engine, readPreferencesFromEngine(this.preferencesEngine));

    this.activeId = session.id;
    this.refresh();
    this.notifyActive();
    return session;
  }

  /**
   * Makes a session active.
   *
   * The session's own viewport is restored with it: each document remembers
   * where it was looked at.
   */
  activate(id: string): void {
    if (this.activeId === id) {
      return;
    }
    const session = this.sessions.find((candidate) => candidate.id === id);
    if (session === undefined) {
      return;
    }
    this.activeId = id;
    this.pushPreferencesToActive();
    this.refresh();
    this.notifyActive();
  }

  /**
   * Closes a session.
   *
   * The engine is destroyed, so its renderer, its listeners and its history
   * go with it. The tab to the left takes over; when the closed tab was the
   * leftmost, the first one left does.
   *
   * The last tab is the exception: the editor always has a document on the
   * canvas, so closing the only tab leaves a fresh empty page in its place
   * rather than a window with nothing to draw on.
   */
  close(id: string): boolean {
    const index = this.sessions.findIndex((candidate) => candidate.id === id);
    if (index === -1) {
      return false;
    }
    const session = this.sessions[index];
    if (session === undefined) {
      return false;
    }

    if (this.sessions.length === 1) {
      const document = session.engine.getState().document;
      session.engine.newDocument({
        name: "Untitled",
        width: document.width,
        height: document.height,
      });
      this.refresh();
      this.notifyActive();
      return true;
    }

    this.sessions.splice(index, 1);
    this.engineStops.get(id)?.();
    this.engineStops.delete(id);
    session.engine.destroy();

    if (this.activeId === id) {
      const next = this.sessions[index - 1] ?? this.sessions[0];
      this.activeId = next === undefined ? null : next.id;
    }
    this.refresh();
    this.notifyActive();
    return true;
  }

  /** The session that holds `path`, or `undefined` when it is not open. */
  findByPath(path: string): DocumentSession | undefined {
    return this.sessions.find((session) => {
      const sessionPath = session.engine.getState().file.path;
      return sessionPath !== null && samePath(sessionPath, path);
    });
  }

  /** The session with this id, or `undefined` when it is not open. */
  findById(id: string): DocumentSession | undefined {
    return this.sessions.find((session) => session.id === id);
  }

  /**
   * Releases every engine's renderer and its listeners.
   *
   * The documents themselves stay: `DrawingEngine.destroy()` only detaches
   * the renderer and the pointer listeners, so the sessions are still usable
   * and the canvas can be re-attached. That is what makes the editor's
   * development double-mount harmless.
   */
  destroy(): void {
    for (const stop of this.engineStops.values()) {
      stop();
    }
    this.engineStops.clear();
    for (const session of this.sessions) {
      session.engine.destroy();
    }
    this.preferencesEngine.destroy();
  }

  /** An engine changed: the active document, or a background one. */
  private onEngineChanged(session: DocumentSession): void {
    if (session.id === this.activeId) {
      this.capturePreferencesFromActive();
      this.notifyActive();
    }
    // A background session may have become dirty, so the tab strip has to
    // look again even though the active document did not change.
    this.refresh();
  }

  /**
   * The active document changed a preference: the application-level copy
   * follows it, so the settings file describes the brush in use.
   */
  private capturePreferencesFromActive(): void {
    if (this.syncing || this.activeId === null) {
      return;
    }
    const active = this.sessions.find((candidate) => candidate.id === this.activeId);
    if (active === undefined) {
      return;
    }
    const current = readPreferencesFromEngine(active.engine);
    if (settingsEqual(current, readPreferencesFromEngine(this.preferencesEngine))) {
      return;
    }
    this.syncing = true;
    try {
      applyPreferencesToEngine(this.preferencesEngine, current);
    } finally {
      this.syncing = false;
    }
  }

  /**
   * The application-level preferences changed: the active document follows
   * them, so the brush does not depend on which tab is open.
   */
  private pushPreferencesToActive(): void {
    if (this.syncing || this.activeId === null) {
      return;
    }
    const active = this.sessions.find((candidate) => candidate.id === this.activeId);
    if (active === undefined) {
      return;
    }
    const preferences = readPreferencesFromEngine(this.preferencesEngine);
    if (settingsEqual(preferences, readPreferencesFromEngine(active.engine))) {
      return;
    }
    this.syncing = true;
    try {
      applyPreferencesToEngine(active.engine, preferences);
    } finally {
      this.syncing = false;
    }
  }

  /** Rebuilds the tab strip's view, and tells it when it really changed. */
  private refresh(): void {
    const next = this.buildSummaries();
    if (sameSummaries(next, this.state.sessions) && this.state.activeId === this.activeId) {
      return;
    }
    this.state = { activeId: this.activeId, sessions: next };
    for (const listener of this.stateListeners) {
      listener();
    }
  }

  private notifyActive(): void {
    for (const listener of this.activeListeners) {
      listener();
    }
  }

  /**
   * The tab strip's view of the open documents.
   *
   * Two drawings that have never been saved are told apart by a number, so
   * the tabs never show the same name twice.
   */
  private buildSummaries(): readonly DocumentSessionSummary[] {
    const used = new Map<string, number>();
    return this.sessions.map((session) => {
      const snapshot = session.engine.getState();
      const path = snapshot.file.path;
      const base = path === null ? snapshot.document.name : fileNameOf(path);
      const seen = used.get(base) ?? 0;
      used.set(base, seen + 1);
      return {
        id: session.id,
        title: seen === 0 ? base : `${base} ${seen + 1}`,
        path,
        dirty: snapshot.file.dirty,
        active: session.id === this.activeId,
      };
    });
  }
}
