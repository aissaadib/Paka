/**
 * Confirmation shown before an action that would throw away unsaved work.
 *
 * Three ways out, because discarding a drawing is destructive: cancel, save
 * first, or discard. The caller owns what happens on confirm, so the same
 * dialog covers new, open and window close.
 */

import { useEffect } from "react";

export type UnsavedAction = "new" | "open" | "close";

const TITLES: Record<UnsavedAction, string> = {
  new: "Start a new document?",
  open: "Open another project?",
  close: "Close Paka?",
};

const BODIES: Record<UnsavedAction, string> = {
  new: "The current drawing has unsaved changes. Creating a new document discards them.",
  open: "The current drawing has unsaved changes. Opening another project discards them.",
  close: "The current drawing has unsaved changes. Closing Paka discards them.",
};

const CONFIRM_LABELS: Record<UnsavedAction, string> = {
  new: "Discard and create",
  open: "Discard and open",
  close: "Discard and close",
};

export interface UnsavedChangesDialogProps {
  readonly action: UnsavedAction;
  readonly onCancel: () => void;
  readonly onSaveFirst: () => void;
  readonly onDiscard: () => void;
}

export function UnsavedChangesDialog({
  action,
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
        <p className="dialog__note">{BODIES[action]}</p>
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
