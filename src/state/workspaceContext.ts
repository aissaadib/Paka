/**
 * The workspace context.
 *
 * The workspace store is a session-lifetime service like the editor and the
 * panel store: it is created once per mount of the provider and holds how
 * the window is arranged. It is separate from the editor because the
 * workspace is shell state - it says what the window looks like, never what
 * the drawing contains - and because the engine deliberately knows nothing
 * about windows.
 */
import { createContext } from "react";
import type { WorkspaceStore } from "./workspaceStore";

export const WorkspaceContext = createContext<WorkspaceStore | null>(null);
