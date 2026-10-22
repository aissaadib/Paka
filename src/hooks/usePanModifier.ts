/**
 * The temporary pan modifier.
 *
 * While the space bar is held, a drag on the canvas moves the view instead of
 * drawing, whatever the active tool is. It is the modifier every drawing
 * program has, and it is the mouse's answer for a user who has no middle
 * button: the middle-button drag pans too, and both take the same path.
 *
 * The modifier never touches the document: it moves the canvas and nothing
 * else. It also never interrupts a stroke that is already in flight - the
 * modifier decides what a *new* press does, so holding the space bar by
 * accident cannot lose a drawing.
 */

import { useEffect } from "react";
import {
  isTextEntryTarget,
  type TextEntryTargetLike,
} from "../core/actions/keyboard";
import { useEditor } from "./useEditor";

function isSpace(event: KeyboardEvent): boolean {
  return event.code === "Space" || event.key === " ";
}

export function usePanModifier(): void {
  const { engine } = useEditor();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isSpace(event)) {
        return;
      }
      // Typing in a field wins: a space in a text box is a space, not a pan.
      if (isTextEntryTarget(event.target as TextEntryTargetLike | null)) {
        return;
      }
      // The space bar would scroll the window otherwise.
      event.preventDefault();
      engine.setPanModifier(true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!isSpace(event)) {
        return;
      }
      engine.setPanModifier(false);
    };

    // The key can be released while the window is not focused, so the modifier
    // is dropped whenever the window goes away.
    const release = (): void => {
      engine.setPanModifier(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", release);
      engine.setPanModifier(false);
    };
  }, [engine]);
}
