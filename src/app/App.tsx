/**
 * Application root.
 *
 * Composition only: the provider owns the engine, `Workspace` owns the layout.
 * The workspace store is created here because two things share it - the shell
 * that renders it and the settings file that persists it. The panel provider
 * publishes the single panel store, so the panel stack and the Panels menu
 * drive the same layout.
 */

import { useMemo, useState } from "react";
import {
  applyPersistedPanelLayout,
  createPanelLayoutSection,
  persistedPanelLayoutOf,
} from "../core/panels/panelLayoutSection";
import type { SettingsSection } from "../core/settings/settingsSection";
import { createWorkspaceSettingsSection } from "../core/workspace/workspaceSettingsSection";
import { Workspace } from "../components/layout/Workspace";
import { createWorkspaceStore } from "../state/workspaceStore";
import { EditorProvider } from "./EditorProvider";
import { PanelProvider } from "./PanelProvider";
// Registers the built-in panels before the shell reads the registry.
import "./panelModules";

export function App() {
  const [workspaceStore] = useState(() => createWorkspaceStore());

  /*
   * The shell owns two sections of the settings file: the panel arrangement
   * and the frame's own parts. They are built once and handed to the settings
   * store, which is the only writer of the file. A section reads its part on
   * load and writes it back when the owner changes - moving a panel is a
   * preference, never a document edit.
   */
  const sections = useMemo<readonly SettingsSection<unknown>[]>(() => {
    const panelLayout = createPanelLayoutSection({
      getState: () => {
        const preferences = workspaceStore.getPreferences();
        return persistedPanelLayoutOf(preferences, preferences.foldedPanels);
      },
      subscribe: (listener) => workspaceStore.subscribe(listener),
      applyLayout: (layout) => {
        const preferences = workspaceStore.getPreferences();
        workspaceStore.applyPreferences({
          ...applyPersistedPanelLayout(preferences, layout),
          foldedPanels: layout.foldedPanels,
        });
      },
    });
    const workspace = createWorkspaceSettingsSection(workspaceStore);
    return [
      panelLayout as SettingsSection<unknown>,
      workspace as SettingsSection<unknown>,
    ];
  }, [workspaceStore]);

  return (
    <EditorProvider sections={sections}>
      <PanelProvider>
        <Workspace store={workspaceStore} />
      </PanelProvider>
    </EditorProvider>
  );
}
