/**
 * Named brush presets.
 *
 * A preset is an id, a name and a *snapshot* of `BrushSettings`. It is editor
 * preference, not document state: applying one goes through `setBrush`, and
 * saving, renaming or deleting one never adds a history entry, bumps the
 * revision or dirties the drawing.
 *
 * The name rules live here rather than in the panel so the engine and the
 * settings reader enforce the same ones: trimmed, non-empty, bounded length,
 * and unique among the current presets (a duplicate gets a numeric suffix).
 *
 * Three fields describe how the user treats a preset rather than what it
 * contains, and they are additive: a settings file written before them has
 * none of them, and the reader gives them their defaults.
 *
 *  - `favorite` - the user starred it.
 *  - `builtin` - it ships with Paka, so it is protected from being renamed,
 *    overwritten or deleted.
 *  - `lastUsedAt` - when it was last applied, which is what the "recent"
 *    ordering reads. `null` means it has never been used.
 */

import type { BrushSettings } from "../../types/brush";
import { createId, reserveId } from "../../utils/id";
import { asRecord } from "../../utils/record";
import { BUNDLED_PRESET_IDS, BUNDLED_PRESETS } from "./bundledPresets";
import { brushSettingsEqual, readBrushSettings } from "./defaults";

export interface BrushPreset {
  readonly id: string;
  readonly name: string;
  readonly brush: BrushSettings;
  /** Whether the user has starred this preset. */
  readonly favorite: boolean;
  /** Whether the preset ships with Paka and is therefore protected. */
  readonly builtin: boolean;
  /** When the preset was last applied, or `null` when it never was. */
  readonly lastUsedAt: number | null;
}

/** Long enough for a descriptive name, short enough for the brush picker. */
export const MAX_PRESET_NAME_LENGTH = 40;

/** Trims, collapses runs of whitespace and caps the length. */
export function normalizePresetName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_PRESET_NAME_LENGTH).trim();
}

function withSuffix(base: string, suffix: number): string {
  const marker = ` (${suffix})`;
  const room = MAX_PRESET_NAME_LENGTH - marker.length;
  return `${base.slice(0, Math.max(1, room)).trimEnd()}${marker}`;
}

/**
 * A usable, unique name for a new or renamed preset.
 *
 * Returns `""` for a name that is empty after trimming, which is how callers
 * reject it. Duplicate names are compared case-insensitively and get
 * ` (2)`, ` (3)`, ... up to the name cap.
 */
export function uniquePresetName(
  name: string,
  existing: readonly Pick<BrushPreset, "id" | "name">[],
  ignoreId?: string,
): string {
  const base = normalizePresetName(name);
  if (base === "") {
    return "";
  }
  const taken = new Set(
    existing
      .filter((preset) => preset.id !== ignoreId)
      .map((preset) => preset.name.toLowerCase()),
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

/** A fresh id for a preset. */
export function createPresetId(): string {
  return createId("preset");
}

/** Keeps generated ids clear of one loaded from the settings file. */
export function reservePresetId(id: string): void {
  reserveId("preset", id);
}

/** A timestamp for a preset that has just been used. */
export function presetUsedAt(now: number = Date.now()): number {
  return now;
}

/** True when the preset ships with Paka and cannot be changed or removed. */
export function isBundledPreset(preset: Pick<BrushPreset, "id" | "builtin">): boolean {
  return preset.builtin || BUNDLED_PRESET_IDS.has(preset.id);
}

/**
 * Reads a preset list out of an untrusted value.
 *
 * This is the one place a preset list is rebuilt, so the settings file and
 * the engine's `setPresets` agree on what a valid entry is. An entry that is
 * not an object, or whose name is empty, is skipped rather than allowed to
 * lose the rest of the list; a missing or duplicate id gets a fresh one; a
 * duplicate name gets a numeric suffix, so the picker always has distinct
 * entries. The brush of an entry is read through `readBrushSettings`, so it
 * keeps every field a brush has.
 *
 * `builtin` is not read from the file: it is decided by the id, so a
 * hand-edited file cannot turn one of the user's presets into a protected
 * one, nor make a protected one editable.
 */
export function normalizeBrushPresets(value: unknown): readonly BrushPreset[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const presets: BrushPreset[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    const record = asRecord(entry);
    if (record === null) {
      continue;
    }
    const name = normalizePresetName(typeof record.name === "string" ? record.name : "");
    if (name === "") {
      continue;
    }
    const rawId = typeof record.id === "string" ? record.id.trim() : "";
    let id = rawId === "" || ids.has(rawId) ? createPresetId() : rawId;
    while (ids.has(id)) {
      id = createPresetId();
    }
    reservePresetId(id);
    ids.add(id);
    const lastUsedAt = record.lastUsedAt;
    presets.push({
      id,
      name: uniquePresetName(name, presets),
      brush: readBrushSettings(record.brush),
      favorite: record.favorite === true,
      builtin: BUNDLED_PRESET_IDS.has(id),
      lastUsedAt:
        typeof lastUsedAt === "number" && Number.isFinite(lastUsedAt) ? lastUsedAt : null,
    });
  }
  return presets;
}

/**
 * Joins the bundled presets with the ones the settings file holds.
 *
 * The bundled brushes are code, so the file cannot change them: the file's
 * copy of a bundled preset contributes only the user's own state - whether
 * it is a favourite and when it was last used. Everything else in the file is
 * the user's, and is kept as it is.
 */
export function mergeBundledPresets(entries: readonly BrushPreset[]): readonly BrushPreset[] {
  const user = entries
    .filter((entry) => !BUNDLED_PRESET_IDS.has(entry.id))
    .map((entry) => ({ ...entry, builtin: false }));
  const bundled = BUNDLED_PRESETS.map((preset) => {
    const stored = entries.find((entry) => entry.id === preset.id);
    if (stored === undefined) {
      return preset;
    }
    return { ...preset, favorite: stored.favorite, lastUsedAt: stored.lastUsedAt };
  });
  return [...bundled, ...user];
}

/**
 * A copy of a preset: the same brush under a fresh id and a name that does
 * not clash with the ones already in the list.
 *
 * The copy is a new entry, so it starts out unstarred and unused: the
 * favourite and recent bookkeeping belongs to the entry it was made from.
 */
export function duplicatePreset(
  preset: BrushPreset,
  existing: readonly BrushPreset[],
): BrushPreset {
  return {
    id: createPresetId(),
    name: uniquePresetName(preset.name, existing),
    brush: { ...preset.brush },
    favorite: false,
    builtin: false,
    lastUsedAt: null,
  };
}

/**
 * A copy of a preset for an import: the same brush under a fresh id, a name
 * that does not clash, and the user's own state kept.
 *
 * The favourite flag travels with the brush - it says something about the
 * brush, not about the machine - but the last-used stamp does not, because
 * the copy has not been used here.
 */
export function importPreset(
  preset: BrushPreset,
  existing: readonly BrushPreset[],
): BrushPreset {
  return {
    id: createPresetId(),
    name: uniquePresetName(preset.name, existing),
    brush: { ...preset.brush },
    favorite: preset.favorite,
    builtin: false,
    lastUsedAt: null,
  };
}

/** Field-wise comparison, used to skip redundant publishes and writes. */
export function brushPresetsEqual(
  a: readonly BrushPreset[],
  b: readonly BrushPreset[],
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
    if (
      left.id !== right.id ||
      left.name !== right.name ||
      left.favorite !== right.favorite ||
      left.builtin !== right.builtin ||
      left.lastUsedAt !== right.lastUsedAt ||
      !brushSettingsEqual(left.brush, right.brush)
    ) {
      return false;
    }
  }
  return true;
}
