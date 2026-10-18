/**
 * Application root.
 *
 * Composition only: the provider owns the engine, `Workspace` owns the layout.
 */

import { Workspace } from "../components/layout/Workspace";
import { EditorProvider } from "./EditorProvider";

export function App() {
  return (
    <EditorProvider>
      <Workspace />
    </EditorProvider>
  );
}
