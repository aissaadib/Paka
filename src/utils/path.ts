/**
 * Small helpers for the paths that come back from native file dialogs.
 *
 * Tauri hands back OS paths, which on Windows use backslashes, so nothing here
 * assumes a separator. These exist so the file service can derive display names
 * and suggested file names the same way on every platform.
 */

/** Last path segment, with trailing separators removed. */
export function fileNameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

/** File name without its extension. */
export function fileStemOf(path: string): string {
  const name = fileNameOf(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Appends `extension` unless the path already ends with it (case-insensitive). */
export function ensureExtension(path: string, extension: string): string {
  const suffix = `.${extension}`;
  return fileNameOf(path).toLowerCase().endsWith(suffix.toLowerCase()) ? path : `${path}${suffix}`;
}

/** Makes a name safe to suggest as a file name. */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned === "" ? "Untitled" : cleaned;
}
