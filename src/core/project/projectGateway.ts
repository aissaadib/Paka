/**
 * The file gateway: everything the project file service needs from the outside
 * world, as an interface.
 *
 * The service that implements open/save/export therefore has no idea whether it
 * is talking to Tauri dialogs and native file writes, or to a scripted
 * in-memory double. That is what makes "save, reopen, compare" testable in
 * plain Node, where neither a window nor a filesystem scope exists.
 */

export interface ProjectFileGateway {
  /** Native open dialog; `null` when the user cancels. */
  pickProjectToOpen(): Promise<string | null>;
  /** Native save dialog pre-filled with `suggestedName`; `null` on cancel. */
  pickProjectToSave(suggestedName: string): Promise<string | null>;
  /** Native save dialog for PNG export; `null` on cancel. */
  pickPngToSave(suggestedName: string): Promise<string | null>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, contents: string): Promise<void>;
  writeBinaryFile(path: string, bytes: Uint8Array): Promise<void>;
}
