/**
 * Platform window controls used by the file workflow.
 *
 * All three are best-effort. Outside Tauri (the plain browser preview used
 * during development) there is no window to title, no window to close and no
 * close event to intercept, so they fall back to `document.title` or do
 * nothing instead of throwing at the UI.
 */

/** Sets the OS window title, and the document title as the browser fallback. */
export async function setWindowTitle(title: string): Promise<void> {
  document.title = title;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(title);
  } catch {
    // No native window host; the document title above is all there is.
  }
}

/**
 * Closes the window immediately, bypassing the close guard.
 *
 * Used after the user has confirmed that unsaved work may be discarded; the
 * guard would otherwise veto the close again.
 */
export async function closeWindowNow(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().destroy();
  } catch {
    // Nothing to close outside Tauri.
  }
}

/**
 * Intercepts the window's close request.
 *
 * `shouldBlock` is consulted on every close attempt; returning true cancels the
 * close so the UI can ask the user. Returns a function that removes the guard.
 */
export async function registerCloseGuard(shouldBlock: () => boolean): Promise<() => void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return await getCurrentWindow().onCloseRequested((event) => {
      if (shouldBlock()) {
        event.preventDefault();
      }
    });
  } catch {
    return () => {};
  }
}
