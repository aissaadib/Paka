/**
 * Reading an untrusted value as a plain record.
 *
 * The settings file, the project file and the preset list are all read from
 * disk, so every value in them is untrusted until it has been checked. This is
 * the check they all start with: an object that is not an array. Anything else
 * - a number, a string, `null`, an array - is not a record, and the caller
 * decides what to do about it.
 */

/** An untrusted value as a record, or `null` when it is not one. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
