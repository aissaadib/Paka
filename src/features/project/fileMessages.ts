/**
 * Turning file-operation outcomes into messages for the user.
 *
 * Kept out of the React hook so the wording and the formatting can be tested
 * directly: the hook only has to put the returned text somewhere.
 */

import type { FileOutcome } from "../../core/project/projectFiles";
import { fileNameOf } from "../../utils/path";

export interface FileMessage {
  readonly text: string;
  /** `error` messages are shown as problems and never auto-cleared. */
  readonly tone: "info" | "error";
}

/** Human-readable byte count (1024-based, matching file managers). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["kB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** `null` means "nothing to say" (the user cancelled the dialog). */
export function describeOutcome(outcome: FileOutcome): FileMessage | null {
  switch (outcome.status) {
    case "saved":
      return { text: `Saved ${fileNameOf(outcome.path)}`, tone: "info" };
    case "opened": {
      const name = fileNameOf(outcome.path);
      if (outcome.warnings.length === 0) {
        return { text: `Opened ${name}`, tone: "info" };
      }
      return {
        text: `Opened ${name} with ${outcome.warnings.length} warning${
          outcome.warnings.length === 1 ? "" : "s"
        }: ${outcome.warnings.join(" ")}`,
        tone: "info",
      };
    }
    case "exported":
      return {
        text: `Exported ${fileNameOf(outcome.path)} (${formatBytes(outcome.bytes)})`,
        tone: "info",
      };
    case "cancelled":
      return null;
    case "error":
      return { text: outcome.message, tone: "error" };
  }
}
