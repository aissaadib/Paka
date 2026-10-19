/**
 * Global keyboard shortcuts.
 *
 * Pointer input is handled imperatively by the engine; keyboard shortcuts are
 * an interface concern and live here. Shortcuts are ignored while typing in a
 * text field so renaming a layer or naming a document never triggers tools.
 *
 *   B / E / I / H  brush / eraser / colour picker / pan
 *   [ / ]          decrease / increase brush size
 *   Ctrl+Z         undo
 *   Ctrl+Shift+Z   redo
 *   Ctrl+Y         redo
 *   Ctrl+J         duplicate the active layer
 *   Ctrl+= / -     zoom in / out
 *   Ctrl+1         actual size
 *   Ctrl+0         fit to window
 *   Ctrl+S         save
 *   Ctrl+Shift+S   save as
 *   Ctrl+O         open
 *
 * The file handlers are separate arguments rather than an options object so
 * their identities can be stable `useCallback`s; an inline object would make
 * this effect re-register its listener on every render.
 */

import { useEffect } from "react";
import { stepBrushSize } from "../core/brushes/defaults";
import { findToolByShortcut } from "../core/tools/toolDefinitions";
import { useEditor } from "./useEditor";

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function useKeyboardShortcuts(
  onSave?: () => void,
  onSaveAs?: () => void,
  onOpen?: () => void,
): void {
  const { actions, engine } = useEditor();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target)) {
        return;
      }

      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (mod) {
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) {
            actions.redo();
          } else {
            actions.undo();
          }
          return;
        }
        if (key === "y") {
          event.preventDefault();
          actions.redo();
          return;
        }
        if (key === "s") {
          event.preventDefault();
          if (event.shiftKey) {
            onSaveAs?.();
          } else {
            onSave?.();
          }
          return;
        }
        if (key === "o") {
          event.preventDefault();
          onOpen?.();
          return;
        }
        if (key === "j") {
          event.preventDefault();
          const activeLayerId = engine.getState().document.activeLayerId;
          if (activeLayerId !== null) {
            actions.duplicateLayer(activeLayerId);
          }
          return;
        }
        if (key === "=" || key === "+") {
          event.preventDefault();
          actions.zoomIn();
          return;
        }
        if (key === "-") {
          event.preventDefault();
          actions.zoomOut();
          return;
        }
        if (key === "1") {
          event.preventDefault();
          actions.zoomTo(1);
          return;
        }
        if (key === "0") {
          event.preventDefault();
          actions.zoomToFit();
          return;
        }
        return;
      }

      if (event.altKey || event.shiftKey) {
        return;
      }

      const tool = findToolByShortcut(event.key);
      if (tool) {
        event.preventDefault();
        actions.setTool(tool.id);
        return;
      }

      if (event.key === "[" || event.key === "]") {
        event.preventDefault();
        const direction = event.key === "[" ? -1 : 1;
        actions.setBrush({ size: stepBrushSize(engine.getState().brush.size, direction) });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [actions, engine, onSave, onSaveAs, onOpen]);
}
