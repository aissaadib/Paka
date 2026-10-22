/**
 * The document workspace: the file operations, across the open documents.
 *
 * This is the session-aware face of `ProjectFiles`. `ProjectFiles` knows how
 * to read, parse and write one project against one engine; the workspace
 * knows that there is more than one engine open, and that opening a file
 * **adds a tab** instead of replacing the drawing that is on screen.
 *
 * The rules that matter:
 *
 *  - opening parses and validates the file **before** a session exists, so a
 *    corrupt file never becomes a tab and never disturbs the open ones;
 *  - opening a file that is already open focuses that tab instead of making
 *    a second copy of it - two tabs on one file would mean two editors
 *    writing over each other;
 *  - saving writes the **active** document, and only marks it clean once the
 *    bytes really reached the disk;
 *  - a file that cannot be read is reported, never swallowed: a moved or
 *    deleted file in the recent list says so instead of doing nothing.
 */

import type { NewDocumentOptions } from "../engine/DrawingEngine";
import { fileNameOf } from "../../utils/path";
import { ProjectFiles, type FileOutcome } from "../project/projectFiles";
import { parseProject } from "../project/projectFormat";
import type { ProjectFileGateway } from "../project/projectGateway";
import type { DocumentSession, DocumentSessionRegistry } from "./sessionRegistry";
import type { RecentFilesStore } from "./recentFiles";

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}

function failure(action: string, path: string, error: unknown): FileOutcome {
  return { status: "error", message: `${action} "${fileNameOf(path)}" failed: ${describe(error)}` };
}

export class DocumentWorkspace {
  constructor(
    private readonly sessions: DocumentSessionRegistry,
    private readonly gateway: ProjectFileGateway,
    private readonly recentFiles: RecentFilesStore,
  ) {}

  /** True when at least one open document has changes that are not on disk. */
  get hasUnsavedChanges(): boolean {
    return this.sessions.hasUnsavedChanges;
  }

  /** The path of the active document, or `null` when it was never saved. */
  get path(): string | null {
    return this.sessions.active.engine.getState().file.path;
  }

  /** Adds an empty document as a new tab and makes it active. */
  newDocument(options: NewDocumentOptions): void {
    const session = this.sessions.create();
    session.engine.newDocument(options);
  }

  /**
   * Asks for a project and opens it as a new tab.
   *
   * A cancelled dialog is not an error: the outcome says so, and the open
   * documents are untouched.
   */
  async open(): Promise<FileOutcome> {
    let path: string | null;
    try {
      path = await this.gateway.pickProjectToOpen();
    } catch (error) {
      return { status: "error", message: `The open dialog could not be shown: ${describe(error)}` };
    }
    if (path === null) {
      return { status: "cancelled" };
    }
    return this.openPath(path);
  }

  /**
   * Opens a project that is already named.
   *
   * This is what the recent list calls. A file that has been moved or
   * deleted fails here, and the failure says which file it was - the entry
   * stays in the list, because the file may come back.
   */
  async openPath(path: string): Promise<FileOutcome> {
    let text: string;
    try {
      text = await this.gateway.readTextFile(path);
    } catch (error) {
      return failure("Opening", path, error);
    }

    const parsed = parseProject(text);
    if (!parsed.ok) {
      return { status: "error", message: `${fileNameOf(path)} could not be opened. ${parsed.error}` };
    }

    this.sessions.open(parsed.project, path);
    this.recentFiles.note(path);
    return { status: "opened", path, warnings: parsed.project.warnings };
  }

  /** Saves the active document over its own path, or asks for one. */
  async save(): Promise<FileOutcome> {
    const outcome = await this.filesFor(this.sessions.active).save();
    if (outcome.status === "saved") {
      this.recentFiles.note(outcome.path);
    }
    return outcome;
  }

  /**
   * Saves one open document, whether or not it is the active one.
   *
   * Closing a background tab has to be able to save *that* document, so the
   * save cannot always mean "the one on screen".
   */
  async saveSession(id: string): Promise<FileOutcome> {
    const session = this.sessions.findById(id);
    if (session === undefined) {
      return { status: "error", message: "That document is no longer open." };
    }
    const outcome = await this.filesFor(session).save();
    if (outcome.status === "saved") {
      this.recentFiles.note(outcome.path);
    }
    return outcome;
  }

  /** Saves the active document under a new name. */
  async saveAs(): Promise<FileOutcome> {
    const outcome = await this.filesFor(this.sessions.active).saveAs();
    if (outcome.status === "saved") {
      this.recentFiles.note(outcome.path);
    }
    return outcome;
  }

  /** Writes the active document's composite as a PNG. */
  async exportPng(): Promise<FileOutcome> {
    return this.filesFor(this.sessions.active).exportPng();
  }

  /**
   * Closes a tab.
   *
   * The caller is responsible for asking the user first when the document has
   * unsaved changes: this method closes the tab, it does not decide whether
   * that is allowed.
   */
  closeSession(id: string): boolean {
    return this.sessions.close(id);
  }

  /** The file service bound to one open document. */
  private filesFor(session: DocumentSession): ProjectFiles {
    return new ProjectFiles(
      session.engine,
      this.gateway,
      (path) => this.refuseDuplicatePath(path, session.id),
    );
  }

  /**
   * The reason a path must not be written to, or `null` when it is fine.
   *
   * A file that another open document already holds is refused: the two
   * documents would each overwrite the other, and the user would have no way
   * of telling which one won.
   */
  private refuseDuplicatePath(path: string, ownerId: string): string | null {
    const holder = this.sessions.findByPath(path);
    if (holder === undefined || holder.id === ownerId) {
      return null;
    }
    return `"${fileNameOf(path)}" is already open in another tab. Close it first, or choose another name.`;
  }
}
