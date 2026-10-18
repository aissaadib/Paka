/**
 * Provides the single editor instance to the component tree.
 *
 * The editor (and therefore the engine) is created once per mount of the
 * provider. In development React StrictMode mounts twice; `destroy()` only
 * detaches renderer and listeners, so the engine stays usable across the
 * remount and the canvas is re-attached by `CanvasStage`.
 */

import { useEffect, useState, type ReactNode } from "react";
import { EditorContext } from "../state/editorContext";
import { createEditor, type Editor } from "../state/editorStore";

export interface EditorProviderProps {
  readonly children: ReactNode;
  /** Optional injected editor, used by tests. */
  readonly editor?: Editor;
}

export function EditorProvider({ children, editor }: EditorProviderProps) {
  const [value] = useState(() => editor ?? createEditor());

  useEffect(() => {
    return () => {
      value.engine.destroy();
    };
  }, [value]);

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}
