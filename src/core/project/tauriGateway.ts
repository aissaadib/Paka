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
import { PROJECT_FILE_EXTENSION } from "./projectFormat";
import type { ProjectFileGateway } from "./projectGateway";

const PROJECT_FILTER = { name: "Paka project", extensions: [PROJECT_FILE_EXTENSION] };
const PNG_FILTER = { name: "PNG image", extensions: ["png"] };

async function openPath(title: string): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    title,
    multiple: false,
    directory: false,
    filters: [PROJECT_FILTER],
  });
  return typeof selected === "string" ? selected : null;
}

async function savePath(title: string, suggestedName: string, png: boolean): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const selected = await save({
    title,
    defaultPath: suggestedName,
    filters: [png ? PNG_FILTER : PROJECT_FILTER],
  });
  return selected ?? null;
}

export function createTauriProjectGateway(): ProjectFileGateway {
  return {
    pickProjectToOpen: () => openPath("Open project"),

    pickProjectToSave: (suggestedName) => savePath("Save project", suggestedName, false),

    pickPngToSave: (suggestedName) => savePath("Export PNG", suggestedName, true),

    readTextFile: (path) => invoke<string>("read_text_file", { path }),

    async writeTextFile(path, contents) {
      await invoke("write_text_file_atomic", { path, contents });
    },

    async writeBinaryFile(path, bytes) {
      await invoke("write_binary_file_atomic", { path, dataBase64: bytesToBase64(bytes) });
    },
  };
}
