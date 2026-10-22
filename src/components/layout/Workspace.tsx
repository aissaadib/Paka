/**
 * Application shell: menu bar, tool options bar, toolbar, tool rail, canvas,
 * panel stack and status bar.
 *
 * The state kept here is the workflow the engine deliberately knows nothing
 * about: which dialog is open, and which action is waiting for the user to
 * confirm that unsaved work may be discarded. The panels themselves live in
 * the panel stack, which the panel manager drives.
 */

import { useCallback, useState } from "react";
import { CanvasStage } from "../../features/canvas/CanvasStage";
import { CanvasStatusBar } from "../../features/canvas/CanvasStatusBar";
import { NewDocumentDialog } from "../../features/document/NewDocumentDialog";
import { ToolOptionsBar } from "../../features/options/ToolOptionsBar";
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
import { usePanModifier } from "../../hooks/usePanModifier";
import { useWorkspaceSettings } from "../../hooks/useWorkspace";
import { fileNameOf } from "../../utils/path";
import { SecondaryViewPanel } from "../../features/views/SecondaryViewPanel";
import { PanelStack } from "../panels/PanelStack";
import { ToolRail } from "../toolbar/ToolRail";
import { AppMenuBar } from "./AppMenuBar";
import { ToolBar } from "./ToolBar";

export function Workspace() {
  const { actions, files } = useEditor();
  const { document: drawingDocument, file, secondaryViewOpen } = useEditorState();
  const workspace = useWorkspaceSettings();
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
  usePanModifier();

  return (
    // A hidden shell row takes no space: the grid row collapses to nothing, so
    // the canvas gets the pixels back without the user resizing the window.
    <div
      className="app-shell"
      data-tool-rail={workspace.shell.toolRail ? "shown" : "hidden"}
    >
      <AppMenuBar
        onNewDocument={requestNewDocument}
        onOpenProject={requestOpen}
        onSaveProject={save}
        onSaveProjectAs={saveAs}
        onExportPng={exportPng}
      />
      <ToolOptionsBar />
      <ToolBar />
      <div className="workspace-body">
        {workspace.shell.toolRail ? <ToolRail /> : null}
        <div className="canvas-views">
          <CanvasStage />
          {secondaryViewOpen ? <SecondaryViewPanel /> : null}
        </div>
        <PanelStack />
      </div>
      <CanvasStatusBar
        fileMessage={fileMessage}
        fileBusy={fileBusy}
        onDismissFileMessage={dismissMessage}
      />
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
