/**
 * The brush library file: the format, the writer and the reader.
 *
 * A library file is Paka's own small JSON document. It is not a project file
 * and it is not the settings file: it holds only brushes, so it can be handed
 * to somebody else, kept as a backup or moved to another machine.
 *
 * The format is explicit and versioned, and everything in it is checked on
 * the way in, because the file comes from outside:
 *
 *  - a file that is not JSON, or not a preset library, is an **error** with a
 *    message the user can act on - it is not silently read as an empty
 *    library, because that would look like a successful import that did
 *    nothing;
 *  - a file from a **newer** version is refused rather than half-read;
 *  - a file that is **too large**, or that holds **more brushes** than the
 *    browser will take, is refused before anything is read into memory;
 *  - an individual entry that is malformed is **skipped**, and the rest of
 *    the file is still imported. The number of skipped entries is reported.
 *
 * The ids stay behind: an imported brush is a new entry here, with a fresh
 * id, so the same file can be imported twice without the second copy
 * replacing the first. The brush itself is read through `readBrushSettings`,
 * the one reader that knows every field a brush has, so nothing is dropped on
 * the way in.
 */

import { readBrushSettings } from "./defaults";
import { normalizePresetName, type BrushPreset } from "./presets";
import { asRecord } from "../../utils/record";
import type { BrushSettings } from "../../types/brush";

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

/** The most brushes a library file may hold. */
export const MAX_PRESET_LIBRARY_ENTRIES = 200;

/** The file extension the browser suggests. */
export const PRESET_LIBRARY_EXTENSION = "json";

/**
 * One brush as it travels in a library file.
 *
 * There is no id: the id belongs to the machine the file came from, and a
 * new one is minted when the entry is imported.
 */
export interface PresetLibraryEntry {
  /** The name the brush had on the machine it came from. */
  readonly name: string;
  /** The brush itself, read field by field. */
  readonly brush: BrushSettings;
  /** Whether the brush was starred there. */
  readonly favorite: boolean;
}

/** The outcome of reading a library file. */
export type PresetLibraryRead =
  | {
      readonly ok: true;
      /** The brushes the file holds, in file order. */
      readonly entries: readonly PresetLibraryEntry[];
      /** How many entries were malformed and skipped. */
      readonly skipped: number;
    }
  | {
      readonly ok: false;
      /** Why the file was refused, in words the user can act on. */
      readonly error: string;
    };

/** The size of a string in bytes, when the platform can tell us. */
export function presetLibraryByteLength(text: string): number {
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
 * The entries are the brushes the caller hands over: the user's own. A
 * built-in brush is code, and shipping it again would only make the file
 * bigger. The ids stay behind, because they belong to the machine the
 * library came from.
 *
 * The starred brushes are written with their star, so a library that is
 * handed to somebody else carries the note the user made about each brush.
 */
export function serializePresetLibrary(
  presets: readonly BrushPreset[],
  favorites: readonly string[] = [],
): string {
  const starred = new Set(favorites);
  const entries = presets.map((preset) => ({
    name: preset.name,
    brush: preset.brush,
    favorite: starred.has(preset.id),
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
 * message, and a file that can be used comes back as the brushes it holds.
 */
export function parsePresetLibrary(text: string): PresetLibraryRead {
  if (presetLibraryByteLength(text) > MAX_PRESET_LIBRARY_BYTES) {
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
  if (record === null || record.format !== PRESET_LIBRARY_FORMAT) {
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
    return { ok: false, error: "The file has no list of brushes." };
  }
  if (raw.length > MAX_PRESET_LIBRARY_ENTRIES) {
    return {
      ok: false,
      error: `The file holds more than ${MAX_PRESET_LIBRARY_ENTRIES} brushes.`,
    };
  }

  const entries: PresetLibraryEntry[] = [];
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
    entries.push({
      name,
      // The one brush reader: every field a brush has is read here, so a
      // brush that goes through a file comes back whole.
      brush: readBrushSettings(entryRecord.brush),
      favorite: entryRecord.favorite === true,
    });
  }

  if (entries.length === 0) {
    return { ok: false, error: "The file holds no usable brushes." };
  }

  return { ok: true, entries, skipped };
}
