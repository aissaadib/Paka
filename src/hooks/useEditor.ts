/**
 * React bindings for the editor.
 *
 * `useEditorState` subscribes to the engine snapshot, which only changes on
 * user-visible events (tool, brush, layers, history, zoom). Stroke input never
 * goes through React.
 */

import { useCallback, useContext, useSyncExternalStore } from "react";
import type { DrawingEngine, EditorSnapshot } from "../core/engine/DrawingEngine";
import { EditorContext } from "../state/editorContext";
import type { Editor } from "../state/editorStore";
import type { ToolId } from "../types/tool";

export function useEditor(): Editor {
  const editor = useContext(EditorContext);
  if (!editor) {
    throw new Error("useEditor must be used inside an <EditorProvider>.");
  }
  return editor;
}

export function useEditorState(): EditorSnapshot {
  const { getState, subscribe } = useEditor();
  return useSyncExternalStore(subscribe, getState, getState);
}

/**
 * The engine of the active document.
 *
 * Every open document has an engine of its own, and this is the one the
 * canvas is showing. It changes when the user switches tab, so anything that
 * binds to the canvas - the renderer, the pointer listeners - has to follow
 * it rather than keep the engine it started with.
 */
export function useActiveEngine(): DrawingEngine {
  const editor = useEditor();
  const getEngine = useCallback(() => editor.engine, [editor]);
  return useSyncExternalStore(editor.subscribe, getEngine, getEngine);
}

/**
 * Narrow subscription for the active tool id.
 *
 * Used where a component must follow the tool (e.g. the drawing surface's
 * cursor) without re-rendering for brush, layer or viewport changes.
 */
export function useEditorToolId(): ToolId {
  const { getState, subscribe } = useEditor();
  const getToolId = useCallback(() => getState().toolId, [getState]);
  return useSyncExternalStore(subscribe, getToolId, getToolId);
}
