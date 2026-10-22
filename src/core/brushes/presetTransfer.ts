/**
 * The brush preset library file: exporting a library and importing one.
 *
 * A library file is Paka's own small JSON document. It is not a project file
 * and it is not the settings file: it holds only the user's brushes, so it
 * can be handed to somebody else or kept as a backup.
 *
 * The format is explicit and versioned, and everything in it is validated on
 * the way in, because the file comes from outside:
 *
 *  - a file that is not JSON, or not a preset library, is an **error** with a
 *    message the user can act on - it is not silently read as an empty
 *    library, because that would look like a successful import that did
 *    nothing;
 *  - a file from a **newer** version is refused rather than half-read;
 *  - a file that is **too large**, or that holds **more presets** than the
 *    browser will take, is refused before anything is read into memory;
 *  - an individual entry that is malformed is **skipped**, and the rest of
 *    the file is still imported. The number of skipped entries is reported.
 *
 * The ids and the last-used stamps of the source machine are not carried
 * over: an imported preset is a new entry here, with a fresh id, and a name
 * that does not clash with the ones already in the library.
 */

import { readBrushSettings } from "./defaults";
import { normalizePresetName, type BrushPreset } from "./presets";
import { asRecord } from "../../utils/record";

/** The marker in the file that says "this is a preset library". */
export const PRESET_LIBRARY_FORMAT = "paka-preset-library";

/** The version of the library file this build reads and writes. */
export const PRESET_LIBRARY_VERSION = 1;

/**
 * The largest library file that will be read.
 *
 * A library holds brushes, not drawings: a hundred of them are a few tens of
 * kilobytes. The limit is generous enough for any real library and small
 * enough that a wrong file cannot exhaust memory.
 */
export const MAX_PRESET_LIBRARY_BYTES = 256 * 1024;

/** The most presets a library file may hold. */
export const MAX_PRESET_LIBRARY_ENTRIES = 200;

/** The file extension the browser suggests. */
export const PRESET_LIBRARY_EXTENSION = "json";

/** The outcome of reading a library file. */
export type PresetLibraryRead =
  | {
      readonly ok: true;
      /** The presets the file holds, in file order. */
      readonly presets: readonly BrushPreset[];
      /** How many entries were malformed and skipped. */
      readonly skipped: number;
    }
  | {
      readonly ok: false;
      /** Why the file was refused, in words the user can act on. */
      readonly error: string;
    };

/** The size of a string in bytes, when the platform can tell us. */
function byteLength(text: string): number {
  const encoder = (globalThis as { TextEncoder?: new () => { encode(value: string): Uint8Array } })
    .TextEncoder;
  if (encoder === undefined) {
    // A UTF-16 code unit is at least one byte, so the length is a lower
    // bound; the limit is a safety net, not an exact budget.
    return text.length;
  }
  return new encoder().encode(text).length;
}

/**
 * Writes a library file.
 *
 * The entries are the user's own presets: a built-in brush is code, and
 * shipping it again would only make the file bigger. The id and the last-used
 * stamp stay behind, because they belong to the machine the library came
 * from.
 */
export function serializePresetLibrary(presets: readonly BrushPreset[]): string {
  const entries = presets
    .filter((preset) => !preset.builtin)
    .map((preset) => ({
      name: preset.name,
      brush: preset.brush,
      favorite: preset.favorite,
    }));
  return `${JSON.stringify(
    {
      format: PRESET_LIBRARY_FORMAT,
      version: PRESET_LIBRARY_VERSION,
      presets: entries,
    },
    null,
    2,
  )}\n`;
}

/**
 * Reads a library file.
 *
 * Never throws: a file that cannot be used comes back as an error with a
 * message, and a file that is usable comes back as the presets it holds.
 */
export function parsePresetLibrary(text: string): PresetLibraryRead {
  if (byteLength(text) > MAX_PRESET_LIBRARY_BYTES) {
    return {
      ok: false,
      error: `The file is too large to be a brush library (limit ${Math.floor(
        MAX_PRESET_LIBRARY_BYTES / 1024,
      )} KB).`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "The file is not valid JSON." };
  }

  const record = asRecord(parsed);
  if (record === null) {
    return { ok: false, error: "The file is not a Paka brush library." };
  }
  if (record.format !== PRESET_LIBRARY_FORMAT) {
    return { ok: false, error: "The file is not a Paka brush library." };
  }

  const version = record.version;
  if (typeof version !== "number" || !Number.isFinite(version)) {
    return { ok: false, error: "The file is not a Paka brush library." };
  }
  if (version > PRESET_LIBRARY_VERSION) {
    return {
      ok: false,
      error: "The file was written by a newer version of Paka and cannot be read.",
    };
  }

  const raw = record.presets;
  if (!Array.isArray(raw)) {
    return { ok: false, error: "The file has no list of presets." };
  }
  if (raw.length > MAX_PRESET_LIBRARY_ENTRIES) {
    return {
      ok: false,
      error: `The file holds more than ${MAX_PRESET_LIBRARY_ENTRIES} presets.`,
    };
  }

  const presets: BrushPreset[] = [];
  let skipped = 0;
  for (const entry of raw) {
    const entryRecord = asRecord(entry);
    if (entryRecord === null) {
      skipped += 1;
      continue;
    }
    const name = normalizePresetName(
      typeof entryRecord.name === "string" ? entryRecord.name : "",
    );
    if (name === "") {
      skipped += 1;
      continue;
    }
    presets.push({
      // The id is minted on import, so a library can be imported twice
      // without the second copy replacing the first.
      id: "",
      name,
      brush: readBrushSettings(entryRecord.brush),
      favorite: entryRecord.favorite === true,
      builtin: false,
      lastUsedAt: null,
    });
  }

  if (presets.length === 0) {
    return { ok: false, error: "The file holds no usable presets." };
  }

  return { ok: true, presets, skipped };
}
