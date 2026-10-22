/**
 * Keeps the window title in step with the document and its unsaved state.
 *
 * This is the most visible half of the unsaved-changes indicator: the OS shows
 * it while the app is in the background, where the status bar cannot.
 *
 * With several documents open the title names the one on screen and says how
 * many are open, so a window in the background still says which drawing it is
 * showing.
 */

import { useEffect } from "react";
import { setWindowTitle } from "./windowControls";

export function useDocumentTitle(name: string, dirty: boolean, openDocuments = 1): void {
  useEffect(() => {
    const others = openDocuments > 1 ? ` (${openDocuments} open)` : "";
    void setWindowTitle(`${name}${dirty ? " •" : ""}${others} — Paka`);
  }, [name, dirty, openDocuments]);
}
