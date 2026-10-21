/**
 * The Tauri implementation of `SettingsGateway`.
 *
 * The two native commands in `src-tauri/src/settings_io.rs` own the path: the
 * WebView asks for the settings and hands them back, and never learns where
 * they live. That keeps the WebView's write scope at exactly one file - the
 * settings file in the OS configuration directory - instead of "any `.json`
 * the user can name", which is what passing a frontend-chosen path to the
 * generic project writer would have widened it to.
 *
 * The write is the same atomic replace the project files use, so a crash or a
 * full disk cannot leave a half-written settings file behind.
 */

import { invoke } from "@tauri-apps/api/core";
import type { SettingsGateway } from "./settingsGateway";

export function createTauriSettingsGateway(): SettingsGateway {
  return {
    read: () => invoke<string | null>("read_app_settings"),
    async write(contents) {
      await invoke("write_app_settings", { contents });
    },
  };
}
