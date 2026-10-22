/**
 * The app bar: the top row of the workspace.
 *
 * From the left: the brand, the menus, and then the facts that belong to the
 * whole window rather than to one tool - the document and whether it is
 * saved, the history, and the zoom. Everything in this row is always visible,
 * so the row's height never changes and the layout below it never moves.
 */

import { UndoRedoControls } from "../../features/history/UndoRedoControls";
import { IconPanels } from "../icons";
import { IconButton } from "../toolbar/IconButton";
import { AppMenuBar } from "./AppMenuBar";
import { DocumentTitle } from "./DocumentTitle";
import { ZoomControls } from "./ZoomControls";

export interface AppBarProps {
  readonly onNewDocument: () => void;
  readonly onOpenProject: () => void;
  readonly onSaveProject: () => void;
  readonly onSaveProjectAs: () => void;
  readonly onExportPng: () => void;
  /** The document's name, and whether it differs from the file on disk. */
  readonly documentLabel: string;
  readonly documentDirty: boolean;
  readonly documentPath: string | null;
  /** Whether the panel dock is open on a narrow window. */
  readonly dockOpen: boolean;
  readonly onToggleDock: () => void;
}

export function AppBar({
  onNewDocument,
  onOpenProject,
  onSaveProject,
  onSaveProjectAs,
  onExportPng,
  documentLabel,
  documentDirty,
  documentPath,
  dockOpen,
  onToggleDock,
}: AppBarProps) {
  return (
    <header className="app-bar">
      <span className="app-bar__brand">Paka</span>
      <AppMenuBar
        onNewDocument={onNewDocument}
        onOpenProject={onOpenProject}
        onSaveProject={onSaveProject}
        onSaveProjectAs={onSaveProjectAs}
        onExportPng={onExportPng}
      />
      <span className="app-bar__spacer" />
      <div className="app-bar__cluster">
        <IconButton
          label={dockOpen ? "Hide the panels" : "Show the panels"}
          className="app-bar__dock-toggle"
          active={dockOpen}
          onClick={onToggleDock}
        >
          <IconPanels />
        </IconButton>
        <DocumentTitle
          label={documentLabel}
          dirty={documentDirty}
          path={documentPath}
        />
        <span className="divider" />
        <UndoRedoControls />
        <span className="divider" />
        <ZoomControls />
      </div>
    </header>
  );
}
