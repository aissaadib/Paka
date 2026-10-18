/**
 * Vetoes the window close while the drawing has unsaved changes.
 *
 * The close request is intercepted at the window level rather than at the
 * "File → Quit" level because the title bar button and Alt+F4 are the ways
 * people actually close an app, and losing a drawing to either would be worse
 * than any in-app action. `onBlocked` is expected to be stable (a `useCallback`
 * around a state setter) so the listener is registered exactly once.
 */

import { useEffect } from "react";
import { useEditor } from "../../hooks/useEditor";
import { registerCloseGuard } from "./windowControls";

export function useCloseGuard(onBlocked: () => void): void {
  const { files } = useEditor();

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;

    void registerCloseGuard(() => {
      const dirty = files.hasUnsavedChanges;
      if (dirty) {
        onBlocked();
      }
      return dirty;
    }).then((remove) => {
      if (disposed) {
        remove();
      } else {
        unlisten = remove;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [files, onBlocked]);
}
