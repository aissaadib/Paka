/**
 * Global keyboard shortcuts.
 *
 * Pointer input is handled imperatively by the engine; keyboard shortcuts are
 * an interface concern and live here. The chord table itself is in
 * `core/actions/registry.ts`; this hook only guards text fields, dispatches one
 * action and prevents the browser default when an action actually ran.
 *
 *   B / E / M / L / R / O / P / S / G / I / U / H
 *                                brush / eraser / select / line / rectangle /
 *                                ellipse / polygon / star / bucket fill /
 *                                colour picker / guides / pan
 *   [ / ]          decrease / increase brush size
 *   Alt+[ / Alt+]  decrease / increase brush size by one pixel
 *   Arrows         nudge the selection by 1 px (Shift: 10 px)
 *   Ctrl+D         duplicate the selection
 *   Ctrl+Shift+H   flip the selection horizontally
 *   Ctrl+Shift+V   flip the selection vertically
 *   Escape         clear the selection (with the guides tool: cancel the
 *                  guide drag and clear the guide selection)
 *   Delete         delete the selected strokes (with the guides tool: the
 *                  selected guide)
 *   Ctrl+Z         undo
 *   Ctrl+Shift+Z   redo
 *   Ctrl+Y         redo
 *   Ctrl+J         duplicate the active layer
 *   Ctrl+= / -     zoom in / out
 *   Ctrl+1         actual size
 *   Ctrl+0         fit to window
 *   Ctrl+Shift+0   reset the view (whole document, upright)
 *   Shift+R        rotate the view 90° clockwise
 *   Shift+M        mirror the view left to right
 *   Space (held)   drag to pan the view instead of drawing
 *   Ctrl+'         show / hide the grid
 *   Ctrl+Shift+'   turn snapping to guides and grid lines on / off
 *   Ctrl+S         save
 *   Ctrl+Shift+S   save as
 *   Ctrl+O         open
 *
 * The brush size also has a pointer gesture: Ctrl+Alt and drag on the canvas
 * resizes the brush, and Escape cancels a resize in flight.
 *
 * On macOS the primary modifier is Cmd; elsewhere it is Ctrl. The file handlers
 * are separate arguments rather than an options object so their identities can
 * be stable `useCallback`s; an inline object would make this effect re-register
 * its listener on every render.
 */

import { useEffect } from "react";
import {
  currentPlatform,
  isTextEntryTarget,
  type TextEntryTargetLike,
} from "../core/actions/keyboard";
import { dispatchKeyboardEvent } from "../core/actions/registry";
import { useEditor } from "./useEditor";

export function useKeyboardShortcuts(
  onSave?: () => void,
  onSaveAs?: () => void,
  onOpen?: () => void,
  onOpenCommandPalette?: () => void,
): void {
  const { actions, engine } = useEditor();

  useEffect(() => {
    const platform = currentPlatform();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target as TextEntryTargetLike | null)) {
        return;
      }

      // A quick brush-size resize owns Escape, and it owns it *with* the
      // modifiers still held: the gesture only ends when the pointer is
      // released, and the user has to be able to call it off before that.
      // The chord table cannot express this, because a shortcut there claims
      // an exact set of modifiers.
      if (event.key === "Escape" && engine.cancelBrushSizeGesture()) {
        event.preventDefault();
        return;
      }

      const match = dispatchKeyboardEvent(
        event,
        {
          engine,
          actions,
          file: { save: onSave, saveAs: onSaveAs, open: onOpen },
          ui: { openCommandPalette: onOpenCommandPalette },
        },
        platform,
      );
      if (match) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [actions, engine, onSave, onSaveAs, onOpen, onOpenCommandPalette]);
}
