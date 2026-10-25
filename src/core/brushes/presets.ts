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
 */

import type { BrushSettings } from "../../types/brush";
import { createId, reserveId } from "../../utils/id";
import { asRecord } from "../../utils/record";
import { BUNDLED_PRESETS, isBundledPresetId } from "./bundledPresets";
import { brushSettingsEqual, readBrushSettings } from "./defaults";

export interface BrushPreset {
  readonly id: string;
  readonly name: string;
  readonly brush: BrushSettings;
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
    presets.push({
      id,
      name: uniquePresetName(name, presets),
      brush: readBrushSettings(record.brush),
    });
  }
  return presets;
}

/**
 * A copy of a preset: the same brush under a fresh id and a name that does
 * not clash with the ones already in the list.
 */
export function duplicatePreset(
  preset: BrushPreset,
  existing: readonly BrushPreset[],
): BrushPreset {
  return {
    id: createPresetId(),
    name: uniquePresetName(preset.name, existing),
    brush: { ...preset.brush },
  };
}

/**
 * True when the preset is one of the brushes that ship with Paka.
 *
 * The identity is the id and nothing else: a flag in the settings file is not
 * consulted, so a hand-edited file can neither turn one of the user's presets
 * into a protected one nor make a shipped brush editable.
 */
export function isBundledPreset(preset: Pick<BrushPreset, "id">): boolean {
  return isBundledPresetId(preset.id);
}

/**
 * Joins the bundled presets with the ones the user has saved.
 *
 * The bundled brushes are code, so the file cannot change them: the file's
 * copy of a bundled id contributes only what belongs to the user, and the id,
 * the name and the brush come from here. Every other entry is the user's, and
 * is kept as it is.
 *
 * A user preset always wins. When the user has saved a preset under the name
 * of a shipped brush, that name stays theirs and the shipped brush takes the
 * next free name, so the two entries can be told apart in the picker.
 *
 * The result is a pure function of the input: the same entries always give
 * the same list, in the same order, with the same names.
 */
export function mergeBundledPresets(entries: readonly BrushPreset[]): readonly BrushPreset[] {
  const user = entries.filter((entry) => !isBundledPresetId(entry.id));
  const userNames = new Set(user.map((entry) => entry.name.toLowerCase()));
  const bundled = BUNDLED_PRESETS.map((preset) => {
    const stored = entries.find((entry) => entry.id === preset.id);
    // The code owns the id, the name and the brush. Anything else the file
    // stored against that id belongs to the user and rides along.
    const merged: BrushPreset = stored === undefined ? preset : { ...stored, ...preset };
    const name = userNames.has(merged.name.toLowerCase())
      ? uniquePresetName(merged.name, user)
      : merged.name;
    return { ...merged, name, brush: { ...merged.brush } };
  });
  return [...bundled, ...user];
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
      !brushSettingsEqual(left.brush, right.brush)
    ) {
      return false;
    }
  }
  return true;
}
