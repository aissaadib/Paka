/**
 * The Tauri implementation of `ProjectFileGateway`.
 *
 * Two native facilities are used:
 *
 *  - `tauri-plugin-dialog` for the OS open/save dialogs. The user therefore
 *    picks the path in the platform's own UI, and the frontend never guesses
 *    where a document lives.
 *  - the `project_io` commands in `src-tauri` for the actual bytes. File access
 *    is not exposed to the WebView: the Rust side validates the path, caps the
 *    size and performs an atomic replace, so an interrupted write cannot leave
 *    a half-written project behind.
 *
 * The dialog module is imported dynamically: it is only needed once a file
 * operation starts, which keeps it out of the initial bundle and keeps the
 * module importable from Node (tests) where the Tauri API is absent.
 */

import { invoke } from "@tauri-apps/api/core";
import { bytesToBase64 } from "../../utils/base64";
import { PRESET_LIBRARY_EXTENSION } from "../brushes/presetTransfer";
import { PROJECT_FILE_EXTENSION } from "./projectFormat";
import type { ProjectFileGateway } from "./projectGateway";

const PROJECT_FILTER = { name: "Paka project", extensions: [PROJECT_FILE_EXTENSION] };
const PNG_FILTER = { name: "PNG image", extensions: ["png"] };
const PRESET_LIBRARY_FILTER = {
  name: "Paka brush library",
  extensions: [PRESET_LIBRARY_EXTENSION],
};

async function openPath(
  title: string,
  filter?: { name: string; extensions: string[] },
): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    title,
    multiple: false,
    directory: false,
    filters: filter ? [filter] : [PROJECT_FILTER],
  });
  return typeof selected === "string" ? selected : null;
}

async function savePath(
  title: string,
  suggestedName: string,
  filter: { name: string; extensions: string[] },
): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const selected = await save({
    title,
    defaultPath: suggestedName,
    filters: [filter],
  });
  return selected ?? null;
}

export function createTauriProjectGateway(): ProjectFileGateway {
  return {
    pickProjectToOpen: () => openPath("Open project"),

    pickProjectToSave: (suggestedName) => savePath("Save project", suggestedName, PROJECT_FILTER),

    pickPngToSave: (suggestedName) => savePath("Export PNG", suggestedName, PNG_FILTER),

    pickPresetLibraryToOpen: () =>
      openPath("Import brushes", PRESET_LIBRARY_FILTER),

    pickPresetLibraryToSave: (suggestedName) =>
      savePath("Export brushes", suggestedName, PRESET_LIBRARY_FILTER),

    readTextFile: (path) => invoke<string>("read_text_file", { path }),

    async writeTextFile(path, contents) {
      await invoke("write_text_file_atomic", { path, contents });
    },

    async writeBinaryFile(path, bytes) {
      await invoke("write_binary_file_atomic", { path, dataBase64: bytesToBase64(bytes) });
    },
  };
}
