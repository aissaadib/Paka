/**
 * Project file service: open, save, save-as and PNG export.
 *
 * This is the only place that knows the sequence "ask the user for a path, move
 * bytes, update the engine". It never throws at its callers: every operation
 * returns a `FileOutcome`, so the UI can report what happened without wrapping
 * every call in try/catch, and a failure never leaves a half-updated editor.
 *
 * Ordering matters and is deliberate:
 *
 *  - opening parses and validates the file **before** touching the engine, so a
 *    corrupt file leaves the current drawing exactly as it was;
 *  - saving serializes, writes, and only then marks the document clean, so a
 *    failed write keeps the unsaved-changes marker.
 */

import type { DrawingEngine, NewDocumentOptions } from "../engine/DrawingEngine";
import { renderDocumentPng } from "../export/pngExport";
import { ensureExtension, fileNameOf, fileStemOf, sanitizeFileName } from "../../utils/path";
import { PROJECT_FILE_EXTENSION, parseProject } from "./projectFormat";
import type { ProjectFileGateway } from "./projectGateway";

const PNG_FILE_EXTENSION = "png";

export type FileOutcome =
  | { readonly status: "saved"; readonly path: string }
  | { readonly status: "opened"; readonly path: string; readonly warnings: readonly string[] }
  | { readonly status: "exported"; readonly path: string; readonly bytes: number }
  | { readonly status: "cancelled" }
  | { readonly status: "error"; readonly message: string };

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}

function failure(action: string, path: string, error: unknown): FileOutcome {
  return { status: "error", message: `${action} "${fileNameOf(path)}" failed: ${describe(error)}` };
}

export class ProjectFiles {
  constructor(
    private readonly engine: DrawingEngine,
    private readonly gateway: ProjectFileGateway,
    /**
     * Asked before a "save as" writes to a path.
     *
     * It returns the reason the write must not happen, or `null` when the
     * path is fine. The editor uses it to refuse a path that another open
     * document already holds: two documents on one file would each overwrite
     * the other, and the user would have no way of telling which one won.
     */
    private readonly refusePath?: (path: string) => string | null,
  ) {}

  /** True when the document has changes that are not on disk. */
  get hasUnsavedChanges(): boolean {
    return this.engine.getState().file.dirty;
  }

  /** Path of the project on disk, or `null` when it was never saved. */
  get path(): string | null {
    return this.engine.getState().file.path;
  }

  /** Replaces the drawing with an empty document (the caller confirms first). */
  newDocument(options: NewDocumentOptions): void {
    this.engine.newDocument(options);
  }

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

    // Only now is the current document replaced.
    this.engine.loadProject(parsed.project, path);
    return { status: "opened", path, warnings: parsed.project.warnings };
  }

  /** Saves over the current path, or asks for one the first time. */
  async save(): Promise<FileOutcome> {
    const current = this.path;
    if (current === null) {
      return this.saveAs();
    }
    return this.writeTo(current);
  }

  async saveAs(): Promise<FileOutcome> {
    let path: string | null;
    try {
      path = await this.gateway.pickProjectToSave(this.suggestedProjectName());
    } catch (error) {
      return { status: "error", message: `The save dialog could not be shown: ${describe(error)}` };
    }
    if (path === null) {
      return { status: "cancelled" };
    }
    const target = ensureExtension(path, PROJECT_FILE_EXTENSION);
    const refusal = this.refusePath?.(target);
    if (refusal !== undefined && refusal !== null) {
      return { status: "error", message: refusal };
    }
    return this.writeTo(target);
  }

  /** Writes the composite as a PNG without touching the editable document. */
  async exportPng(): Promise<FileOutcome> {
    let path: string | null;
    try {
      path = await this.gateway.pickPngToSave(this.suggestedPngName());
    } catch (error) {
      return { status: "error", message: `The export dialog could not be shown: ${describe(error)}` };
    }
    if (path === null) {
      return { status: "cancelled" };
    }

    const target = ensureExtension(path, PNG_FILE_EXTENSION);
    let bytes: Uint8Array;
    try {
      bytes = await renderDocumentPng(this.engine);
    } catch (error) {
      return { status: "error", message: `The image could not be encoded: ${describe(error)}` };
    }

    try {
      await this.gateway.writeBinaryFile(target, bytes);
    } catch (error) {
      return failure("Exporting to", target, error);
    }

    return { status: "exported", path: target, bytes: bytes.length };
  }

  private async writeTo(path: string): Promise<FileOutcome> {
    let contents: string;
    try {
      contents = this.engine.serialize();
    } catch (error) {
      return { status: "error", message: `The project could not be serialized: ${describe(error)}` };
    }

    try {
      await this.gateway.writeTextFile(path, contents);
    } catch (error) {
      return failure("Saving", path, error);
    }

    this.engine.markSaved(path);
    return { status: "saved", path };
  }

  private suggestedProjectName(): string {
    const current = this.path;
    if (current !== null) {
      return fileNameOf(current);
    }
    return `${sanitizeFileName(this.engine.getState().document.name)}.${PROJECT_FILE_EXTENSION}`;
  }

  private suggestedPngName(): string {
    const current = this.path;
    const stem = current !== null ? fileStemOf(current) : sanitizeFileName(this.engine.getState().document.name);
    return `${stem}.${PNG_FILE_EXTENSION}`;
  }
}
