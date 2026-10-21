/**
 * The autosave service: writes a recovery copy of the drawing.
 *
 * **This service is not started by the application.** The product decisions
 * that govern autosaving - whether it is on by default, at what interval,
 * whether a document that was never saved is protected, whether recovery is
 * offered or applied, and when the recovery copy is deleted - are the owner's
 * to make, and they are not made here. What is implemented is the part that
 * does not depend on them: the machinery, with the policy injected, and the
 * invariants that keep it from destroying work.
 *
 * The invariants, all of them enforced by this module and pinned by tests:
 *
 *  1. **An autosave never marks the document saved.** The service calls no
 *     method that touches the engine's saved revision, so the document stays
 *     dirty, the close guard keeps vetoing and the title dot stays. A
 *     recovery copy is not the user's chosen file.
 *  2. **An autosave never writes the user's path.** The copy goes to the path
 *     the policy derives, and the service refuses to write at all if that
 *     path is the project's own.
 *  3. **One write at a time.** A tick that arrives while a write is in
 *     flight is dropped; the next tick picks the work up.
 *  4. **A copy written while the user saved is reported as superseded.** The
 *     project file is never touched, but the copy may now be older than what
 *     the user saved, and the service says so instead of pretending otherwise.
 *
 * The service is framework-free, so the whole cycle runs in Node.
 */

import type { DrawingEngine } from "../engine/DrawingEngine";
import type { ProjectFileGateway } from "../project/projectGateway";

/**
 * What autosaving is allowed to do.
 *
 * Every value that is a product decision is injected rather than chosen here,
 * so the owner can decide them without this module changing.
 */
export interface AutosavePolicy {
  /** Whether autosaving runs at all. */
  readonly enabled: boolean;
  /** How often the service looks for work to protect. */
  readonly intervalMs: number;
  /** Where the recovery copy of a project goes. */
  readonly recoveryPathFor: (projectPath: string) => string;
}

export type AutosaveOutcome =
  /** Autosaving is off. */
  | { readonly status: "disabled" }
  /** A write was already in flight; this tick did nothing. */
  | { readonly status: "busy" }
  /** The document has never been saved, so it has no folder to write into. */
  | { readonly status: "no-project" }
  /** The document has no unsaved changes, so there is nothing to protect. */
  | { readonly status: "clean" }
  /** Nothing changed since the last copy. */
  | { readonly status: "unchanged" }
  /** The copy was written. */
  | { readonly status: "written"; readonly path: string }
  /** The copy was written, but the user saved while it was in flight. */
  | { readonly status: "superseded"; readonly path: string }
  /** The copy could not be written. The document is untouched. */
  | { readonly status: "failed"; readonly message: string };

export interface AutosaveServiceOptions {
  readonly engine: DrawingEngine;
  readonly gateway: ProjectFileGateway;
  readonly policy: AutosavePolicy;
  /** Injected timers, so the tests need not wait in real time. */
  readonly schedule?: (callback: () => void, delayMs: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}

export class AutosaveService {
  private readonly engine: DrawingEngine;
  private readonly gateway: ProjectFileGateway;
  private readonly policy: AutosavePolicy;
  private readonly schedule: (callback: () => void, delayMs: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  /** Bumped whenever the user saves, or the project's path changes. */
  private generation = 0;
  /** Whether the document changed since the last copy. */
  private changed = false;
  private writing = false;
  private started = false;
  private timer: unknown = null;
  private stopWatching: (() => void) | null = null;
  private lastDocument: unknown = null;
  private lastPath: string | null = null;
  private lastDirty = false;

  constructor(options: AutosaveServiceOptions) {
    this.engine = options.engine;
    this.gateway = options.gateway;
    this.policy = options.policy;
    this.schedule =
      options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as never));
  }

  /** The path of the last copy written, or `null`. */
  get lastRecoveryPath(): string | null {
    return this.lastWritten;
  }

  private lastWritten: string | null = null;

  /** Starts watching the editor and the timer. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    const snapshot = this.engine.getState();
    this.lastDocument = snapshot.document;
    this.lastPath = snapshot.file.path;
    this.lastDirty = snapshot.file.dirty;
    // A document that is already dirty when the service starts holds unsaved
    // work, so that work is worth protecting even though the service did not
    // see the edit that made it dirty.
    this.changed = snapshot.file.dirty;

    this.stopWatching = this.engine.subscribe(() => this.onEditorChanged());
    this.scheduleNext();
  }

  /** Stops the timer and the watch. */
  stop(): void {
    this.started = false;
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    if (this.stopWatching !== null) {
      this.stopWatching();
      this.stopWatching = null;
    }
  }

  /**
   * One pass: decides whether there is anything to protect, and writes the
   * copy if there is.
   *
   * It never touches the engine's saved state, so the document stays dirty
   * whatever it does.
   */
  async tick(): Promise<AutosaveOutcome> {
    if (!this.policy.enabled) {
      return { status: "disabled" };
    }
    if (this.writing) {
      return { status: "busy" };
    }

    const snapshot = this.engine.getState();
    const projectPath = snapshot.file.path;
    if (projectPath === null) {
      // A document that was never saved has no folder to write into, and
      // autosaving cannot ask the user for one.
      return { status: "no-project" };
    }
    if (!snapshot.file.dirty) {
      // Nothing unsaved, so nothing to protect.
      return { status: "clean" };
    }
    if (!this.changed) {
      return { status: "unchanged" };
    }

    const generation = this.generation;
    // The document this copy covers. The engine replaces it on every change,
    // so comparing it with the newest one after the write tells us whether
    // an edit landed while the copy was in flight.
    const documentAtCopy = this.engine.getState().document;
    let contents: string;
    try {
      contents = this.engine.serialize();
    } catch (error) {
      return { status: "failed", message: `The drawing could not be serialized: ${describe(error)}` };
    }

    const recoveryPath = this.policy.recoveryPathFor(projectPath);
    if (recoveryPath === projectPath) {
      // The one path this service must never write is the user's own file.
      return {
        status: "failed",
        message: "The recovery copy would overwrite the project file.",
      };
    }

    this.writing = true;
    let outcome: AutosaveOutcome;
    try {
      await this.gateway.writeTextFile(recoveryPath, contents);
      if (this.generation !== generation) {
        // The user saved while the copy was in flight. The project file was
        // never touched, but this copy may now be older than what they saved.
        outcome = { status: "superseded", path: recoveryPath };
      } else if (this.lastDocument !== documentAtCopy) {
        // An edit landed while the copy was in flight, so the copy does not
        // hold the newest work. It stays marked as changed, and the next tick
        // copies the newer document.
        outcome = { status: "written", path: recoveryPath };
      } else {
        outcome = { status: "written", path: recoveryPath };
        this.changed = false;
      }
    } catch (error) {
      outcome = { status: "failed", message: `The recovery copy could not be written: ${describe(error)}` };
      // The document is still changed, so the next tick tries again.
    } finally {
      this.writing = false;
    }

    this.lastWritten = recoveryPath;
    return outcome;
  }

  private onEditorChanged(): void {
    const snapshot = this.engine.getState();
    if (snapshot.document !== this.lastDocument) {
      this.lastDocument = snapshot.document;
      this.changed = true;
    }
    if (snapshot.file.path !== this.lastPath) {
      this.lastPath = snapshot.file.path;
      // A different project: a copy of the old one is not this one's.
      this.generation += 1;
    }
    if (this.lastDirty && !snapshot.file.dirty) {
      // The document became clean, which only an ordinary save does.
      this.generation += 1;
    }
    this.lastDirty = snapshot.file.dirty;
  }

  private scheduleNext(): void {
    if (!this.started) {
      return;
    }
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.runTick();
    }, this.policy.intervalMs);
  }

  private async runTick(): Promise<void> {
    try {
      await this.tick();
    } finally {
      this.scheduleNext();
    }
  }
}
