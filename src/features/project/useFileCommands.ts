/**
 * File operations exposed to the UI.
 *
 * `ProjectFiles` does the work and returns an outcome; this hook only adds the
 * React-facing parts: a re-entrancy guard so a double-clicked menu entry cannot
 * start two writes, and the message describing what happened. The individual
 * callbacks have stable identity, so the keyboard shortcut effect registers its
 * listener once.
 */

import { useCallback, useRef, useState } from "react";
import type { FileOutcome } from "../../core/project/projectFiles";
import { useEditor } from "../../hooks/useEditor";
import { describeOutcome, type FileMessage } from "./fileMessages";

export interface FileCommands {
  readonly open: () => void;
  readonly save: () => void;
  readonly saveAs: () => void;
  readonly exportPng: () => void;
  /**
   * Saves and then runs `next`, but only when the project was really written:
   * a cancelled save dialog or a failed write must not continue into an action
   * that discards the drawing.
   */
  readonly saveThen: (next: () => void) => void;
  /** True while a dialog is open or a file is being written. */
  readonly busy: boolean;
  readonly message: FileMessage | null;
  readonly dismissMessage: () => void;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}

export function useFileCommands(): FileCommands {
  const { files } = useEditor();
  const [message, setMessage] = useState<FileMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const run = useCallback(
    async (operation: () => Promise<FileOutcome>): Promise<FileOutcome | null> => {
      if (inFlight.current) {
        return null;
      }
      inFlight.current = true;
      setBusy(true);

      try {
        const outcome = await operation();
        const described = describeOutcome(outcome);
        if (described !== null) {
          setMessage(described);
        }
        return outcome;
      } catch (error) {
        // `ProjectFiles` reports failures instead of throwing; reaching here
        // means a bug, and the user should still be told rather than see the
        // operation silently do nothing.
        setMessage({ text: `The file operation failed: ${describeError(error)}`, tone: "error" });
        return null;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [],
  );

  const open = useCallback(() => {
    void run(() => files.open());
  }, [files, run]);

  const save = useCallback(() => {
    void run(() => files.save());
  }, [files, run]);

  const saveAs = useCallback(() => {
    void run(() => files.saveAs());
  }, [files, run]);

  const exportPng = useCallback(() => {
    void run(() => files.exportPng());
  }, [files, run]);

  /**
   * Saves and then runs `next`, but only when the project was really written:
   * a cancelled save dialog or a failed write must not continue into an action
   * that discards the drawing.
   *
   * The follow-up runs *after* the guarded save has released its re-entrancy
   * lock, because the follow-up can itself be a file command - opening a
   * project - that has to take the lock again.
   */
  const saveThen = useCallback(
    (next: () => void) => {
      void (async () => {
        const outcome = await run(() => files.save());
        if (outcome !== null && outcome.status === "saved") {
          next();
        }
      })();
    },
    [files, run],
  );

  const dismissMessage = useCallback(() => {
    setMessage(null);
  }, []);

  return { open, save, saveAs, exportPng, saveThen, busy, message, dismissMessage };
}
