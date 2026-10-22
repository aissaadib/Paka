/**
 * Confirmation shown before an action that would throw away unsaved work.
 *
 * Three ways out, because discarding a drawing is destructive: cancel, save
 * first, or discard. The caller owns what happens on confirm, so the same
 * dialog covers a tab that is being closed and the window that is being
 * closed.
 *
 * With several documents open, the question is asked about the *document*,
 * not about "the current drawing": the dialog names the tab it is about, so
 * the user can tell which one is at stake.
 */

import { useEffect } from "react";

export type UnsavedAction = "new" | "open" | "close" | "closeTab";

const TITLES: Record<UnsavedAction, string> = {
  new: "Start a new document?",
  open: "Open another project?",
  close: "Close Paka?",
  closeTab: "Close this document?",
};

const BODIES: Record<UnsavedAction, string> = {
  new: "The current drawing has unsaved changes. Creating a new document discards them.",
  open: "The current drawing has unsaved changes. Opening another project discards them.",
  close: "An open drawing has unsaved changes. Closing Paka discards them.",
  closeTab: "This drawing has unsaved changes. Closing it discards them.",
};

const CONFIRM_LABELS: Record<UnsavedAction, string> = {
  new: "Discard and create",
  open: "Discard and open",
  close: "Discard and close",
  closeTab: "Discard and close",
};

export interface UnsavedChangesDialogProps {
  readonly action: UnsavedAction;
  /** The document the question is about, when there is a single one. */
  readonly documentName?: string | null;
  readonly onCancel: () => void;
  readonly onSaveFirst: () => void;
  readonly onDiscard: () => void;
}

export function UnsavedChangesDialog({
  action,
  documentName,
  onCancel,
  onSaveFirst,
  onDiscard,
}: UnsavedChangesDialogProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const name = documentName ?? null;

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title">
        <h2 className="dialog__title" id="unsaved-title">
          {TITLES[action]}
        </h2>
        <p className="dialog__note">
          {BODIES[action]}
          {name === null ? null : (
            <>
              {" "}
              <strong className="dialog__document">{name}</strong>
            </>
          )}
        </p>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button" onClick={onSaveFirst}>
            Save first
          </button>
          <button type="button" className="button button--primary" onClick={onDiscard}>
            {CONFIRM_LABELS[action]}
          </button>
        </div>
      </div>
    </div>
  );
}
