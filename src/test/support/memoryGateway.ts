/**
 * In-memory `ProjectFileGateway` for tests.
 *
 * The file service is deliberately unaware of Tauri, so the whole open/save/
 * export workflow can be exercised in Node by swapping the gateway: "the user
 * picked this path", "the disk contains these bytes", "this write fails".
 */

import type { ProjectFileGateway } from "../../core/project/projectGateway";

export class MemoryProjectGateway implements ProjectFileGateway {
  /** Text files, keyed by path. */
  readonly files = new Map<string, string>();
  /** Binary files, keyed by path. */
  readonly binaries = new Map<string, Uint8Array>();
  /** Paths written through `writeTextFile`, in order (to count real writes). */
  readonly writes: string[] = [];

  /** Path the open dialog returns; `null` means the user cancelled. */
  openPath: string | null = null;
  savePath: string | null = null;
  pngPath: string | null = null;
  /** Path the brush library dialogs return; `null` means the user cancelled. */
  presetLibraryOpenPath: string | null = null;
  presetLibrarySavePath: string | null = null;

  /** When set, the corresponding operation fails with this message. */
  readFailure: string | null = null;
  writeFailure: string | null = null;

  /** Suggested file names the save dialogs were called with, in order. */
  readonly saveSuggestions: string[] = [];
  readonly pngSuggestions: string[] = [];
  readonly presetLibrarySuggestions: string[] = [];

  async pickProjectToOpen(): Promise<string | null> {
    return this.openPath;
  }

  async pickProjectToSave(suggestedName: string): Promise<string | null> {
    this.saveSuggestions.push(suggestedName);
    return this.savePath;
  }

  async pickPngToSave(suggestedName: string): Promise<string | null> {
    this.pngSuggestions.push(suggestedName);
    return this.pngPath;
  }

  async pickPresetLibraryToOpen(): Promise<string | null> {
    return this.presetLibraryOpenPath;
  }

  async pickPresetLibraryToSave(suggestedName: string): Promise<string | null> {
    this.presetLibrarySuggestions.push(suggestedName);
    return this.presetLibrarySavePath;
  }

  async readTextFile(path: string): Promise<string> {
    if (this.readFailure !== null) {
      throw new Error(this.readFailure);
    }
    const text = this.files.get(path);
    if (text === undefined) {
      throw new Error(`${path} does not exist.`);
    }
    return text;
  }

  async writeTextFile(path: string, contents: string): Promise<void> {
    if (this.writeFailure !== null) {
      throw new Error(this.writeFailure);
    }
    this.files.set(path, contents);
    this.writes.push(path);
  }

  async writeBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
    if (this.writeFailure !== null) {
      throw new Error(this.writeFailure);
    }
    this.binaries.set(path, bytes);
  }
}
