/**
 * Provides the single editor instance to the component tree.
 *
 * The editor (and therefore the engine) is created once per mount of the
 * provider. In development React StrictMode mounts twice; `destroy()` only
 * detaches renderer and listeners, so the engine stays usable across the
 * remount and the canvas is re-attached by `CanvasStage`.
 *
 * The settings store lives here too, because it is a session-lifetime service
 * rather than part of any one component: it reads the preferences once the
 * editor exists, applies them to it, and writes them back when the user
 * changes one. The read is asynchronous and the editor is created
 * synchronously, so the first paint shows the default brush and the stored
 * preferences are applied a moment later. That is deliberate - gating the
 * editor on the read would delay the first paint and would have to survive
 * StrictMode's double mount.
 *
 * The panel layout is a section of the same settings file. The settings
 * store owns the file, so the layout is handed to it as a section rather
 * than written by the panel store itself: one file, one writer. The workspace
 * - the profile, the colour scheme, the interface scale and the brush panel's
 * density - is a second section of the same file, for the same reason.
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPanelLayoutSection } from "../core/panels/panelLayoutSection";
import { createRecentFilesSection } from "../core/documents/recentFiles";
import { SettingsStore } from "../core/settings/settingsStore";
import { createTauriSettingsGateway } from "../core/settings/tauriSettingsGateway";
import { createWorkspaceSettingsSection } from "../core/workspace/workspaceSettingsSection";
import { usePanelStore } from "../hooks/usePanels";
import { useWorkspaceStore } from "../hooks/useWorkspace";
import { EditorContext } from "../state/editorContext";
import { createEditor, type Editor } from "../state/editorStore";

export interface EditorProviderProps {
  readonly children: ReactNode;
  /** Optional injected editor, used by tests. */
  readonly editor?: Editor;
}

export function EditorProvider({ children, editor }: EditorProviderProps) {
  const [value] = useState(() => editor ?? createEditor());
  const panels = usePanelStore();
  const workspace = useWorkspaceStore();

  useEffect(() => {
    const store = new SettingsStore({
      // The preferences live in an engine of their own, so they have one
      // stable home while the active document changes underneath them. The
      // session registry mirrors them into the document that is on screen.
      engine: value.sessions.preferences,
      gateway: createTauriSettingsGateway(),
      // The panels come first: the workspace reads the layout it is applied
      // against, so it has to be in place before the workspace is read.
      sections: [
        createPanelLayoutSection(panels),
        createWorkspaceSettingsSection(workspace),
        createRecentFilesSection(value.recentFiles),
      ],
    });
    void store.load();
    return () => {
      store.destroy();
    };
  }, [panels, value, workspace]);

  useEffect(() => {
    return () => {
      // Every open document has an engine of its own, and every engine has
      // to let go of its renderer and its listeners.
      value.sessions.destroy();
    };
  }, [value]);

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}
