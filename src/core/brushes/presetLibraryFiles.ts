/**
 * The brush library file service: exporting the user's brushes and reading
 * somebody else's.
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
 * The path belongs to the user: it comes from the native dialog, and the
 * native side checks the extension and writes the file atomically, exactly as
 * it does for a project.
 */

import type { ProjectFileGateway } from "../project/projectGateway";
import { ensureExtension, fileNameOf } from "../../utils/path";
import type { BrushPreset } from "./presets";
import {
  PRESET_LIBRARY_EXTENSION,
  parsePresetLibrary,
  serializePresetLibrary,
} from "./presetTransfer";

/** What an export or an import did. */
export type PresetLibraryOutcome =
  | { readonly status: "exported"; readonly path: string; readonly count: number }
  | {
      readonly status: "read";
      /** The brushes the file holds, ready to be added to the library. */
      readonly presets: readonly BrushPreset[];
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
  constructor(private readonly gateway: ProjectFileGateway) {}

  /**
   * Writes brushes to a file the user chooses.
   *
   * The built-in brushes are not written: they are code, and every install
   * already has them.
   */
  async exportLibrary(
    presets: readonly BrushPreset[],
    suggestedName = `brushes.${PRESET_LIBRARY_EXTENSION}`,
  ): Promise<PresetLibraryOutcome> {
    let path: string | null;
    try {
      path = await this.gateway.pickPresetLibraryToSave(suggestedName);
    } catch (error) {
      return { status: "error", message: `The export dialog could not be shown: ${describe(error)}` };
    }
    if (path === null) {
      return { status: "cancelled" };
    }

    const target = ensureExtension(path, PRESET_LIBRARY_EXTENSION);
    const count = presets.filter((preset) => !preset.builtin).length;

    try {
      await this.gateway.writeTextFile(target, serializePresetLibrary(presets));
    } catch (error) {
      return {
        status: "error",
        message: `Exporting to "${fileNameOf(target)}" failed: ${describe(error)}`,
      };
    }

    return { status: "exported", path: target, count };
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
      return { status: "error", message: `The import dialog could not be shown: ${describe(error)}` };
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

    return { status: "read", presets: parsed.presets, skipped: parsed.skipped };
  }
}
