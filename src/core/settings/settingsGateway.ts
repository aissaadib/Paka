/**
 * The settings gateway: everything the settings store needs from the outside
 * world, as an interface.
 *
 * It mirrors `ProjectFileGateway`'s shape and its rule: the service that uses
 * it has no idea whether it is talking to Tauri or to an in-memory double,
 * which is what makes "read the settings, change one, read them back" testable
 * in plain Node, where neither a window nor a filesystem scope exists.
 */

export interface SettingsGateway {
  /**
   * The stored settings, or `null` when there is no settings file yet.
   *
   * A missing file is the normal first-launch case, so it is a value and not
   * an error. A read that fails for any other reason is an error.
   */
  read(): Promise<string | null>;
  /** Replaces the settings file. */
  write(contents: string): Promise<void>;
}
