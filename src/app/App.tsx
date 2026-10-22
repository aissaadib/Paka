/**
 * Application root.
 *
 * Composition only: the panel provider owns the panel layout, the workspace
 * provider owns the window's arrangement, the editor provider owns the engine,
 * and `Workspace` owns the layout.
 */

import { Workspace } from "../components/layout/Workspace";
import { EditorProvider } from "./EditorProvider";
import { PanelProvider } from "./PanelProvider";
import { WorkspaceProvider } from "./WorkspaceProvider";

export function App() {
  return (
    <PanelProvider>
      <WorkspaceProvider>
        <EditorProvider>
          <Workspace />
        </EditorProvider>
      </WorkspaceProvider>
    </PanelProvider>
  );
}
