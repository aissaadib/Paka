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
 */

import { useEffect, useState, type ReactNode } from "react";
import { SettingsStore } from "../core/settings/settingsStore";
import { createShortcutOverridesSection } from "../core/settings/shortcutsSection";
import { createTauriSettingsGateway } from "../core/settings/tauriSettingsGateway";
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
    const store = new SettingsStore({
      engine: value.engine,
      gateway: createTauriSettingsGateway(),
      // The shortcuts are a section of the same file: they belong in the
      // settings, but they are not the engine's state.
      sections: [createShortcutOverridesSection()],
    });
    void store.load();
    return () => {
      store.destroy();
    };
  }, [value]);

  useEffect(() => {
    return () => {
      value.engine.destroy();
    };
  }, [value]);

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}
