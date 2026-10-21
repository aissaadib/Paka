/**
 * Where a recovery copy of a project lives.
 *
 * A recovery copy is a **project file** - the same format, the same parser -
 * so it needs no new format and no new code path to read back. What it must
 * not be is the project file itself: the user's chosen path is the one the
 * editor believes holds their work, and a recovery copy that overwrote it
 * would destroy the work it was meant to protect.
 *
 * The name therefore has to satisfy two rules at once:
 *
 *  - the native writer only accepts `.paka` and `.json`, so the copy has to
 *    *end* in `.paka`. A name like `drawing.paka.autosave` is rejected,
 *    because its extension is `autosave`;
 *  - the copy has to be recognisable as a copy, so it carries a marker.
 *
 * `<stem>.autosave.paka` satisfies both: the extension is `paka`, and the
 * marker sits in the middle where a user browsing their folder will read it.
 */

import { fileNameOf, fileStemOf } from "../../utils/path";
import { PROJECT_FILE_EXTENSION } from "../project/projectFormat";

/** The marker that identifies a recovery copy. */
export const RECOVERY_MARKER = "autosave";

/**
 * The recovery copy's path for a project.
 *
 * The copy sits **beside** the project, in the folder the user chose, so it
 * inherits the project's backup and sync behaviour. The folder is taken from
 * the project path as it is - separator and all - rather than rebuilt, so the
 * copy lands in the same directory on every platform.
 */
export function recoveryPathFor(projectPath: string): string {
  const separator = Math.max(projectPath.lastIndexOf("/"), projectPath.lastIndexOf("\\"));
  const directory = separator === -1 ? "" : projectPath.slice(0, separator + 1);
  return `${directory}${fileStemOf(projectPath)}.${RECOVERY_MARKER}.${PROJECT_FILE_EXTENSION}`;
}

/** True when a path names a recovery copy. */
export function isRecoveryPath(path: string): boolean {
  const name = fileNameOf(path).toLowerCase();
  return name.includes(`.${RECOVERY_MARKER}.`);
}
