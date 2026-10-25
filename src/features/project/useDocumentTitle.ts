/**
 * Keeps the window title in step with the document and its unsaved state.
 *
 * This is the most visible half of the unsaved-changes indicator: the OS shows
 * it while the app is in the background, where the status bar cannot.
 */

import { useEffect } from "react";
import { setWindowTitle } from "./windowControls";

export function useDocumentTitle(name: string, dirty: boolean): void {
  useEffect(() => {
    void setWindowTitle(`${name}${dirty ? " •" : ""} — Paka`);
  }, [name, dirty]);
}
