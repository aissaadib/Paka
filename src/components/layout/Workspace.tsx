/**
 * Application shell: the composition model decides what is mounted and where.
 *
 * The shell used to be a hand-written tree - the menu bar, the tool bar, the
 * tool rail, the canvas, the side column and the status bar were markup, in
 * the order they happened to be written down. Now the tree is read from the
 * composition model in `core/workspace`: which parts are shown, in what
 * order, and how big they are. The shell maps a part to its component and
 * mounts what the model says.
 *
 * The side column is the same story one level down. The panels themselves
 * come from the shell's registry, their slot comes from the shell's slots
 * and their visibility from the shell's preferences, so a panel is added by
 * registering it rather than by editing this file.
 *
 * The state kept here is the workflow the engine deliberately knows nothing
 * about: which dialog is open, and which action is waiting for the user to
 * confirm that unsaved work may be discarded.
 */

import { Fragment, useCallback, useState, type ReactNode } from "react";
import { findPanel, registerPanel } from "../../core/shell/panelRegistry";
import {
  compositionPanelsInSlot,
  compositionPartsInRegion,
  workspaceGrid,
  type WorkspacePartId,
} from "../../core/workspace/workspaceSettings";
import { CanvasStage } from "../../features/canvas/CanvasStage";
import { CanvasStatusBar } from "../../features/canvas/CanvasStatusBar";
import { ColorPanel } from "../../features/color/ColorPanel";
import { NewDocumentDialog } from "../../features/document/NewDocumentDialog";
import { LayersPanel } from "../../features/layers/LayersPanel";
import {
  UnsavedChangesDialog,
  type UnsavedAction,
} from "../../features/project/UnsavedChangesDialog";
import { useCloseGuard } from "../../features/project/useCloseGuard";
import { useDocumentTitle } from "../../features/project/useDocumentTitle";
import { useFileCommands } from "../../features/project/useFileCommands";
import { closeWindowNow } from "../../features/project/windowControls";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useWorkspaceComposition } from "../../hooks/useWorkspace";
import { WorkspaceProvider } from "../../state/workspaceContext";
import { fileNameOf } from "../../utils/path";
import { ToolRail } from "../toolbar/ToolRail";
import { AppMenuBar } from "./AppMenuBar";
import { ToolBar } from "./ToolBar";

/*
 * The shell's own panels register themselves when this module is evaluated.
 *
 * The registry is the shell's list of panels, so the side column is built
 * from it rather than written out here: a panel is added by registering it,
 * and the composition decides where it sits and whether it is shown.
 */
registerPanel({
  id: "color",
  title: "Color",
  slot: "right",
  order: 0,
  render: () => <ColorPanel />,
});

registerPanel({
  id: "layers",
  title: "Layers",
  slot: "right",
  order: 1,
  render: () => (
    <div className="side-panels__layers">
      <LayersPanel />
    </div>
  ),
});

export function Workspace() {
  return (
    <WorkspaceProvider>
      <WorkspaceShell />
    </WorkspaceProvider>
  );
}

function WorkspaceShell() {
  const { actions, files } = useEditor();
  const { document: drawingDocument, file } = useEditorState();
  const composition = useWorkspaceComposition();
  const [newDocumentOpen, setNewDocumentOpen] = useState(false);
  const [pending, setPending] = useState<UnsavedAction | null>(null);

  const {
    open: openProject,
    save,
    saveAs,
    exportPng,
    saveThen,
    busy: fileBusy,
    message: fileMessage,
    dismissMessage,
  } = useFileCommands();

  // Once a project has a place on disk, the file name is what identifies it in
  // the window title and the status bar; the drawing's own name is only what it
  // was created as.
  const documentLabel = file.path === null ? drawingDocument.name : fileNameOf(file.path);

  useDocumentTitle(documentLabel, file.dirty);
  useCloseGuard(useCallback(() => setPending("close"), []));

  /** Carries out an action the user has agreed may discard unsaved work. */
  const proceed = useCallback(
    (action: UnsavedAction) => {
      switch (action) {
        case "new":
          setNewDocumentOpen(true);
          return;
        case "open":
          openProject();
          return;
        case "close":
          void closeWindowNow();
      }
    },
    [openProject],
  );

  const requestNewDocument = useCallback(() => {
    if (files.hasUnsavedChanges) {
      setPending("new");
    } else {
      setNewDocumentOpen(true);
    }
  }, [files]);

  const requestOpen = useCallback(() => {
    if (files.hasUnsavedChanges) {
      setPending("open");
    } else {
      openProject();
    }
  }, [files, openProject]);

  const confirmDiscard = useCallback(() => {
    const action = pending;
    setPending(null);
    if (action !== null) {
      proceed(action);
    }
  }, [pending, proceed]);

  const saveFirst = useCallback(() => {
    const action = pending;
    setPending(null);
    if (action !== null) {
      // Continues only when the document really reached the disk.
      saveThen(() => proceed(action));
    }
  }, [pending, proceed, saveThen]);

  useKeyboardShortcuts(save, saveAs, requestOpen);

  /**
   * The component a part is mounted with.
   *
   * The model says which parts are shown and where; this says what each one
   * is. The parts that need the shell's own state - the menu bar and the
   * status bar - are handed the props they have always been handed.
   */
  const renderPart = (id: WorkspacePartId): ReactNode => {
    switch (id) {
      case "menu-bar":
        return (
          <AppMenuBar
            onNewDocument={requestNewDocument}
            onOpenProject={requestOpen}
            onSaveProject={save}
            onSaveProjectAs={saveAs}
            onExportPng={exportPng}
          />
        );
      case "tool-bar":
        return <ToolBar />;
      case "tool-rail":
        return <ToolRail />;
      case "canvas":
        return <CanvasStage />;
      case "side-column":
        return <SideColumn />;
      case "status-bar":
        return (
          <CanvasStatusBar
            fileMessage={fileMessage}
            fileBusy={fileBusy}
            onDismissFileMessage={dismissMessage}
          />
        );
      default:
        return null;
    }
  };

  const grid = workspaceGrid(composition);

  return (
    <div className="app-shell" style={{ gridTemplateRows: grid.rows }}>
      {compositionPartsInRegion(composition, "top").map((part) =>
        part.shown ? <Fragment key={part.id}>{renderPart(part.id)}</Fragment> : null,
      )}
      <div className="workspace-body" style={{ gridTemplateColumns: grid.columns }}>
        {compositionPartsInRegion(composition, "body").map((part) =>
          part.shown ? <Fragment key={part.id}>{renderPart(part.id)}</Fragment> : null,
        )}
      </div>
      {compositionPartsInRegion(composition, "bottom").map((part) =>
        part.shown ? <Fragment key={part.id}>{renderPart(part.id)}</Fragment> : null,
      )}
      {newDocumentOpen ? (
        <NewDocumentDialog
          onCancel={() => setNewDocumentOpen(false)}
          onCreate={(options) => {
            actions.newDocument(options);
            setNewDocumentOpen(false);
          }}
        />
      ) : null}
      {pending === null ? null : (
        <UnsavedChangesDialog
          action={pending}
          onCancel={() => setPending(null)}
          onSaveFirst={saveFirst}
          onDiscard={confirmDiscard}
        />
      )}
    </div>
  );
}

/**
 * The right-hand column: the panels the registry knows about.
 *
 * The panels come from the registry, their slot from the shell's slots and
 * their visibility from the shell's preferences, so the column is a reading
 * of the composition rather than a list of components.
 */
function SideColumn() {
  const composition = useWorkspaceComposition();
  const panels = compositionPanelsInSlot(composition, "right");

  return (
    <div className="side-panels">
      {panels.map((panel) => (
        <Fragment key={panel.id}>{findPanel(panel.id)?.render()}</Fragment>
      ))}
    </div>
  );
}
