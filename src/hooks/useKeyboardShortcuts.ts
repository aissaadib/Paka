/**
 * Global keyboard shortcuts.
 *
 * Pointer input is handled imperatively by the engine; keyboard shortcuts are
 * an interface concern and live here. Shortcuts are ignored while typing in a
 * text field so renaming a layer or naming a document never triggers tools.
 *
 *   B / E / M / L / R / O / P / S / G / I / U / H
 *                                brush / eraser / select / line / rectangle /
 *                                ellipse / polygon / star / bucket fill /
 *                                colour picker / guides / pan
 *   [ / ]          decrease / increase brush size
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

/** Arrow-key nudge distances, in document pixels. */
const NUDGE_STEP = 1;
const NUDGE_LARGE_STEP = 10;

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
        if (key === "d") {
          event.preventDefault();
          actions.duplicateSelection();
          return;
        }
        if (event.shiftKey && key === "h") {
          event.preventDefault();
          actions.flipSelection("horizontal");
          return;
        }
        if (event.shiftKey && key === "v") {
          event.preventDefault();
          actions.flipSelection("vertical");
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

      if (event.altKey) {
        return;
      }

      if (key.startsWith("arrow")) {
        // Nudge only makes sense with a selection, and only then does the editor
        // claim the keys - otherwise they keep their scrolling behaviour.
        if (engine.getState().selectedStrokes === 0) {
          return;
        }
        event.preventDefault();
        const step = event.shiftKey ? NUDGE_LARGE_STEP : NUDGE_STEP;
        actions.nudgeSelection(
          key === "arrowleft" ? -step : key === "arrowright" ? step : 0,
          key === "arrowup" ? -step : key === "arrowdown" ? step : 0,
        );
        return;
      }

      if (event.shiftKey) {
        return;
      }

      if (key === "escape") {
        event.preventDefault();
        // The guides tool owns Escape while it is active: it cancels the drag
        // in flight and clears the guide selection.
        if (engine.getState().toolId === "guides") {
          actions.cancelGuideGesture();
          return;
        }
        actions.clearSelection();
        return;
      }

      if (key === "delete" || key === "backspace") {
        // Backspace is also the browser's "go back" gesture; the editor owns it.
        event.preventDefault();
        // A selected guide is the guides tool's selection, so Delete removes
        // that first; the stroke selection is untouched by it.
        if (engine.getState().toolId === "guides" && engine.getState().selectedGuideId !== null) {
          actions.deleteSelectedGuide();
          return;
        }
        actions.deleteSelection();
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
