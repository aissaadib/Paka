/**
 * The brush library file service: writing the user's brushes out and reading
 * somebody else's in.
 *
 * A library file is not a project file and not the settings file. It is the
 * user's brushes, written out so they can be shared, backed up or moved to
 * another machine.
 *
 * The service never throws at its callers: every operation returns an outcome,
 * so the browser can report what happened - a cancelled dialog, a file that
 * is not a brush library, a write that failed - without a try/catch at every
 * call site.
 *
 * It does not touch the editor either: reading a file gives the brushes it
 * holds, and adding them to the library is the browser's decision. The
 * service is about bytes; the library is about the editor's state.
 *
 * The dialogs live behind a port, so the file dialogs stay outside the model
 * and the service can be exercised without a window.
 */

import { ensureExtension, fileNameOf } from "../../utils/path";
import type { BrushPreset } from "./presets";
import {
  MAX_PRESET_LIBRARY_BYTES,
  MAX_PRESET_LIBRARY_ENTRIES,
  PRESET_LIBRARY_EXTENSION,
  parsePresetLibrary,
  presetLibraryByteLength,
  serializePresetLibrary,
  type PresetLibraryEntry,
} from "./presetTransfer";

/**
 * What the service needs from the outside world.
 *
 * The same shape as the project file gateway, minus the project and PNG
 * dialogs: a library file is its own kind of file and has its own filters.
 */
export interface PresetLibraryGateway {
  /** Native open dialog; `null` when the user cancels. */
  pickPresetLibraryToOpen(): Promise<string | null>;
  /** Native save dialog pre-filled with `suggestedName`; `null` on cancel. */
  pickPresetLibraryToSave(suggestedName: string): Promise<string | null>;
  /** Reads a text file. */
  readTextFile(path: string): Promise<string>;
  /** Writes a text file. */
  writeTextFile(path: string, contents: string): Promise<void>;
}

/** What an export or an import did. */
export type PresetLibraryOutcome =
  | { readonly status: "exported"; readonly path: string; readonly count: number }
  | {
      readonly status: "read";
      /** The brushes the file holds, ready to be added to the library. */
      readonly entries: readonly PresetLibraryEntry[];
      /** How many entries in the file were malformed and skipped. */
      readonly skipped: number;
    }
  | { readonly status: "cancelled" }
  | { readonly status: "error"; readonly message: string };

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}

export class PresetLibraryFiles {
  constructor(private readonly gateway: PresetLibraryGateway) {}

  /**
   * Writes brushes to a file the user chooses.
   *
   * The built-in brushes are not written: they are code, and every install
   * already has them. The caller hands over the user's own brushes.
   */
  async exportLibrary(
    presets: readonly BrushPreset[],
    favorites: readonly string[] = [],
    suggestedName = `brushes.${PRESET_LIBRARY_EXTENSION}`,
  ): Promise<PresetLibraryOutcome> {
    if (presets.length > MAX_PRESET_LIBRARY_ENTRIES) {
      return {
        status: "error",
        message: `A library file holds at most ${MAX_PRESET_LIBRARY_ENTRIES} brushes, and this library holds ${presets.length}.`,
      };
    }

    let path: string | null;
    try {
      path = await this.gateway.pickPresetLibraryToSave(suggestedName);
    } catch (error) {
      return {
        status: "error",
        message: `The export dialog could not be shown: ${describe(error)}`,
      };
    }
    if (path === null) {
      return { status: "cancelled" };
    }

    const target = ensureExtension(path, PRESET_LIBRARY_EXTENSION);
    const contents = serializePresetLibrary(presets, favorites);
    if (presetLibraryByteLength(contents) > MAX_PRESET_LIBRARY_BYTES) {
      return {
        status: "error",
        message: `The library is too large to write (limit ${Math.floor(
          MAX_PRESET_LIBRARY_BYTES / 1024,
        )} KB).`,
      };
    }

    try {
      await this.gateway.writeTextFile(target, contents);
    } catch (error) {
      return {
        status: "error",
        message: `Exporting to "${fileNameOf(target)}" failed: ${describe(error)}`,
      };
    }

    return { status: "exported", path: target, count: presets.length };
  }

  /**
   * Reads a brush library the user chooses.
   *
   * A file that is not a usable library is an error with a message, never a
   * silent no-op: the user asked for an import, and nothing happening would
   * look like a success.
   */
  async importLibrary(): Promise<PresetLibraryOutcome> {
    let path: string | null;
    try {
      path = await this.gateway.pickPresetLibraryToOpen();
    } catch (error) {
      return {
        status: "error",
        message: `The import dialog could not be shown: ${describe(error)}`,
      };
    }
    if (path === null) {
      return { status: "cancelled" };
    }

    let text: string;
    try {
      text = await this.gateway.readTextFile(path);
    } catch (error) {
      return {
        status: "error",
        message: `Reading "${fileNameOf(path)}" failed: ${describe(error)}`,
      };
    }

    const parsed = parsePresetLibrary(text);
    if (!parsed.ok) {
      return {
        status: "error",
        message: `"${fileNameOf(path)}" could not be imported. ${parsed.error}`,
      };
    }

    return { status: "read", entries: parsed.entries, skipped: parsed.skipped };
  }
}
