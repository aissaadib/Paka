/**
 * Application root.
 *
 * Composition only: the provider owns the engine, `Workspace` owns the layout.
 * The panel provider publishes the single panel store, so the panel stack and
 * the Panels menu drive the same layout.
 */

import { Workspace } from "../components/layout/Workspace";
import { EditorProvider } from "./EditorProvider";
import { PanelProvider } from "./PanelProvider";
// Registers the built-in panels before the shell reads the registry.
import "./panelModules";

export function App() {
  return (
    <EditorProvider>
      <PanelProvider>
        <Workspace />
      </PanelProvider>
    </EditorProvider>
  );
}
