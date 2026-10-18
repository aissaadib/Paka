/**
 * Monotonic, human-readable identifiers.
 *
 * Document, layer, stroke and command ids only need to be unique within a
 * running session; a per-prefix counter keeps them predictable. Ids that come
 * from a project file were generated the same way, so `reserveId` walks the
 * counter past them: without it, opening "layer-4" in a fresh session and then
 * adding a layer would produce a second "layer-1"... and the surface cache,
 * which is keyed by layer id, would happily reuse the wrong pixels.
 */

const counters = new Map<string, number>();

export function createId(prefix: string): string {
  const next = (counters.get(prefix) ?? 0) + 1;
  counters.set(prefix, next);
  return `${prefix}-${next.toString(36)}`;
}

/**
 * Ensures the next id generated for `prefix` cannot collide with `id`.
 *
 * Ids that do not follow this module's `<prefix>-<base36>` shape are ignored:
 * they cannot collide with anything generated here.
 */
export function reserveId(prefix: string, id: string): void {
  const marker = `${prefix}-`;
  if (!id.startsWith(marker)) {
    return;
  }
  const suffix = id.slice(marker.length);
  if (!/^[0-9a-z]+$/.test(suffix)) {
    return;
  }
  const value = Number.parseInt(suffix, 36);
  if (!Number.isFinite(value)) {
    return;
  }
  if (value > (counters.get(prefix) ?? 0)) {
    counters.set(prefix, value);
  }
}

/** Test hook: forgets every counter so suites do not depend on ordering. */
export function resetIdCounters(): void {
  counters.clear();
}
