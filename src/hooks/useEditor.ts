/**
 * React bindings for the editor.
 *
 * `useEditorState` subscribes to the engine snapshot, which only changes on
 * user-visible events (tool, brush, layers, history, zoom). Stroke input never
 * goes through React.
 */

import { useCallback, useContext, useSyncExternalStore } from "react";
import type { EditorSnapshot } from "../core/engine/DrawingEngine";
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
 * Narrow subscription for the active tool id.
 *
 * Used where a component must follow the tool (e.g. the drawing surface's
 * cursor) without re-rendering for brush, layer or viewport changes.
 */
export function useEditorToolId(): ToolId {
  const { engine, subscribe } = useEditor();
  const getToolId = useCallback(() => engine.getState().toolId, [engine]);
  return useSyncExternalStore(subscribe, getToolId, getToolId);
}
