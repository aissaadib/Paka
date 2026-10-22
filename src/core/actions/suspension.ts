/**
 * Whether the app's own keyboard shortcuts are suspended.
 *
 * The shortcut editor is a modal dialog, so a key pressed in its list must
 * not also run a command behind it: the editor is about the shortcuts, and
 * the commands it lists would fire while the user is reading them.
 *
 * The editor suspends the shortcuts when it opens and resumes them when it
 * closes. The capture itself does not go through the app's handler at all -
 * it is handled in the capture phase, so the pressed key never reaches it.
 */

let suspended = false;

/** Stops the app's own shortcuts from running. */
export function suspendShortcuts(): void {
  suspended = true;
}

/** Lets the app's own shortcuts run again. */
export function resumeShortcuts(): void {
  suspended = false;
}

/** True while the app's own shortcuts are suspended. */
export function shortcutsSuspended(): boolean {
  return suspended;
}
