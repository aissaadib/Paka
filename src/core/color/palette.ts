/**
 * The colour palette: the swatches the artist keeps to hand.
 *
 * A swatch is an id, a name and a colour. The palette is **editor
 * preference**, not document state: it describes what the next gesture can be
 * painted with, exactly like the brush settings do, so adding, renaming or
 * removing a swatch never adds a history entry, bumps the revision or dirties
 * the drawing.
 *
 * The name rules live here rather than in the panel, so the engine and the
 * settings reader enforce the same ones: trimmed, non-empty, bounded length,
 * and unique among the current swatches (a duplicate gets a numeric suffix).
 *
 * The colour is always a plain `#rrggbb`. The app stores no alpha anywhere -
 * a brush, a fill and a gradient all hold an opaque colour - so a swatch that
 * could not be painted is not a swatch, and an unreadable colour is dropped
 * rather than guessed at.
 */

import { hexToRgb, rgbToHex } from "../../utils/color";
import { createId, reserveId } from "../../utils/id";
import { asRecord } from "../../utils/record";

/** One saved colour. */
export interface PaletteSwatch {
  /** Unique within the palette; stable across a save and a reload. */
  readonly id: string;
  /** What the artist calls this colour. Never empty. */
  readonly name: string;
  /** The colour, as a lowercase `#rrggbb`. */
  readonly color: string;
}

/**
 * How many swatches a palette may hold.
 *
 * The cap keeps the grid usable and the settings file small. Adding past it
 * is refused rather than silently dropping the oldest swatch, because the
 * artist asked to keep a colour and losing one without a word is worse than a
 * refusal.
 */
export const MAX_PALETTE_SWATCHES = 64;

/** Long enough for a descriptive name, short enough for the swatch grid. */
export const MAX_SWATCH_NAME_LENGTH = 32;

/**
 * The palette a fresh installation starts with.
 *
 * The ids are fixed rather than generated so a settings file written by one
 * build is read by the next one without the swatches moving around.
 */
export const DEFAULT_PALETTE: readonly PaletteSwatch[] = [
  { id: "palette-ink", name: "Ink", color: "#16181c" },
  { id: "palette-paper", name: "Paper", color: "#ffffff" },
  { id: "palette-red", name: "Red", color: "#e5484d" },
  { id: "palette-amber", name: "Amber", color: "#e8a33d" },
  { id: "palette-green", name: "Green", color: "#3fb950" },
  { id: "palette-blue", name: "Blue", color: "#3b82f6" },
  { id: "palette-violet", name: "Violet", color: "#8b5cf6" },
  { id: "palette-pink", name: "Pink", color: "#d946a0" },
];

/** Trims, collapses runs of whitespace and caps the length. */
export function normalizeSwatchName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_SWATCH_NAME_LENGTH).trim();
}

function withSuffix(base: string, suffix: number): string {
  const marker = ` (${suffix})`;
  const room = MAX_SWATCH_NAME_LENGTH - marker.length;
  return `${base.slice(0, Math.max(1, room)).trimEnd()}${marker}`;
}

/**
 * A usable, unique name for a new or renamed swatch.
 *
 * Returns `""` for a name that is empty after trimming, which is how callers
 * reject it. Duplicate names are compared case-insensitively and get
 * ` (2)`, ` (3)`, ... up to the name cap.
 */
export function uniqueSwatchName(
  name: string,
  existing: readonly Pick<PaletteSwatch, "id" | "name">[],
  ignoreId?: string,
): string {
  const base = normalizeSwatchName(name);
  if (base === "") {
    return "";
  }
  const taken = new Set(
    existing
      .filter((swatch) => swatch.id !== ignoreId)
      .map((swatch) => swatch.name.toLowerCase()),
  );
  if (!taken.has(base.toLowerCase())) {
    return base;
  }
  for (let suffix = 2; ; suffix++) {
    const candidate = withSuffix(base, suffix);
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

/** A colour as a lowercase `#rrggbb`, or `null` when it is not a colour. */
export function normalizeSwatchColor(color: unknown): string | null {
  if (typeof color !== "string") {
    return null;
  }
  const rgb = hexToRgb(color.trim());
  return rgb === null ? null : rgbToHex(rgb);
}

/**
 * Reads a palette out of an untrusted value.
 *
 * This is the one place a palette is rebuilt, so the settings file and the
 * engine's `setPalette` agree on what a valid swatch is. An entry that is not
 * an object, that has no usable name or that has no colour at all is skipped
 * rather than allowed to lose the rest of the list; a missing or duplicate id
 * gets a fresh one; a duplicate name gets a numeric suffix, so the grid always
 * has distinct entries. The list is capped at {@link MAX_PALETTE_SWATCHES}.
 */
export function normalizePalette(value: unknown): readonly PaletteSwatch[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const palette: PaletteSwatch[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    if (palette.length >= MAX_PALETTE_SWATCHES) {
      break;
    }
    const record = asRecord(entry);
    if (record === null) {
      continue;
    }
    const name = normalizeSwatchName(typeof record.name === "string" ? record.name : "");
    if (name === "") {
      continue;
    }
    const color = normalizeSwatchColor(record.color);
    if (color === null) {
      continue;
    }
    const rawId = typeof record.id === "string" ? record.id.trim() : "";
    let id = rawId === "" || ids.has(rawId) ? createId("swatch") : rawId;
    while (ids.has(id)) {
      id = createId("swatch");
    }
    reserveId("swatch", id);
    ids.add(id);
    palette.push({ id, name: uniqueSwatchName(name, palette), color });
  }
  return palette;
}

/** Field-wise comparison, used to skip redundant publishes and writes. */
export function paletteEqual(
  a: readonly PaletteSwatch[],
  b: readonly PaletteSwatch[],
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index++) {
    const left = a[index];
    const right = b[index];
    if (left.id !== right.id || left.name !== right.name || left.color !== right.color) {
      return false;
    }
  }
  return true;
}

/** The swatch with this id, or `null`. */
export function findPaletteSwatch(
  palette: readonly PaletteSwatch[],
  id: string,
): PaletteSwatch | null {
  return palette.find((swatch) => swatch.id === id) ?? null;
}

/** The swatch holding this colour, or `null`. */
export function findSwatchByColor(
  palette: readonly PaletteSwatch[],
  color: string,
): PaletteSwatch | null {
  const normalized = normalizeSwatchColor(color);
  if (normalized === null) {
    return null;
  }
  return palette.find((swatch) => swatch.color === normalized) ?? null;
}

/** The result of a change to the palette. */
export interface PaletteChange {
  /** The palette after the change. */
  readonly palette: readonly PaletteSwatch[];
  /** The swatch the change was about. */
  readonly swatch: PaletteSwatch;
}

/**
 * Adds a colour to the palette.
 *
 * A colour that is already in the palette is **not** added twice: the
 * existing swatch is returned with the palette unchanged, because a second
 * swatch in the same colour would be a different entry the artist would have
 * to keep straight. A palette that is full is refused.
 */
export function addPaletteSwatch(
  palette: readonly PaletteSwatch[],
  color: string,
  name?: string,
): PaletteChange | null {
  const normalized = normalizeSwatchColor(color);
  if (normalized === null) {
    return null;
  }
  const existing = findSwatchByColor(palette, normalized);
  if (existing !== null) {
    return { palette, swatch: existing };
  }
  if (palette.length >= MAX_PALETTE_SWATCHES) {
    return null;
  }
  const id = createId("swatch");
  reserveId("swatch", id);
  const requested = name === undefined ? normalized : normalizeSwatchName(name);
  const swatch: PaletteSwatch = {
    id,
    name: uniqueSwatchName(requested === "" ? normalized : requested, palette),
    color: normalized,
  };
  return { palette: [...palette, swatch], swatch };
}

/**
 * Renames a swatch.
 *
 * An unknown id and an empty name are both refused. The new name is made
 * unique among the other swatches, so the grid never shows two of the same.
 */
export function renamePaletteSwatch(
  palette: readonly PaletteSwatch[],
  id: string,
  name: string,
): PaletteChange | null {
  const swatch = findPaletteSwatch(palette, id);
  if (swatch === null) {
    return null;
  }
  const normalized = normalizeSwatchName(name);
  if (normalized === "") {
    return null;
  }
  const unique = uniqueSwatchName(normalized, palette, id);
  if (unique === swatch.name) {
    return { palette, swatch };
  }
  const next = palette.map((entry) =>
    entry.id === id ? { ...entry, name: unique } : entry,
  );
  return { palette: next, swatch: { ...swatch, name: unique } };
}

/**
 * Removes a swatch.
 *
 * An unknown id is refused and the palette is returned unchanged. Removing a
 * swatch never touches a stroke: the colours already painted stay exactly as
 * they are.
 */
export function removePaletteSwatch(
  palette: readonly PaletteSwatch[],
  id: string,
): readonly PaletteSwatch[] | null {
  if (findPaletteSwatch(palette, id) === null) {
    return null;
  }
  return palette.filter((swatch) => swatch.id !== id);
}
