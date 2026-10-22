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
  /**
   * Opens a file that is already named.
   *
   * This is what the recent list calls. A file that has been moved or deleted
   * fails, and the failure says which file it was.
   */
  readonly openPath: (path: string) => void;
  readonly save: () => void;
  readonly saveAs: () => void;
  readonly exportPng: () => void;
  /**
   * Saves and then runs `next`, but only when the project was really written:
   * a cancelled save dialog or a failed write must not continue into an action
   * that discards the drawing.
   */
  readonly saveThen: (next: () => void) => void;
  /**
   * Saves one open document and then runs `next`.
   *
   * Closing a tab that is not the one on screen has to save *that*
   * document, so the save cannot always mean "the active one".
   */
  readonly saveSessionThen: (sessionId: string, next: () => void) => void;
  /**
   * Saves every open document that has unsaved changes, then runs `next`.
   *
   * Closing the window has to write all of them, not just the one on screen.
   * The follow-up runs only when every one of them reached the disk.
   */
  readonly saveAllThen: (next: () => void) => void;
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
  const { files, sessions } = useEditor();
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

  const openPath = useCallback(
    (path: string) => {
      void run(() => files.openPath(path));
    },
    [files, run],
  );

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

  const saveSessionThen = useCallback(
    (sessionId: string, next: () => void) => {
      void (async () => {
        const outcome = await run(() => files.saveSession(sessionId));
        if (outcome !== null && outcome.status === "saved") {
          next();
        }
      })();
    },
    [files, run],
  );

  const saveAllThen = useCallback(
    (next: () => void) => {
      void (async () => {
        for (const session of sessions.list) {
          if (!session.engine.getState().file.dirty) {
            continue;
          }
          const outcome = await run(() => files.saveSession(session.id));
          if (outcome === null || outcome.status !== "saved") {
            // A cancelled dialog or a failed write stops the sequence: the
            // window stays open and the document keeps its unsaved marker.
            return;
          }
        }
        next();
      })();
    },
    [files, run, sessions],
  );

  const dismissMessage = useCallback(() => {
    setMessage(null);
  }, []);

  return {
    open,
    openPath,
    save,
    saveAs,
    exportPng,
    saveThen,
    saveSessionThen,
    saveAllThen,
    busy,
    message,
    dismissMessage,
  };
}
