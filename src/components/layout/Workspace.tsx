/**
 * Application shell: menu bar, toolbar, tool rail, canvas, layers panel and
 * status bar.
 *
 * The state kept here is the workflow the engine deliberately knows nothing
 * about: which dialog is open, and which action is waiting for the user to
 * confirm that unsaved work may be discarded.
 */

import { useCallback, useState } from "react";
import { CanvasStage } from "../../features/canvas/CanvasStage";
import { CanvasStatusBar } from "../../features/canvas/CanvasStatusBar";
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
import { fileNameOf } from "../../utils/path";
import { ToolRail } from "../toolbar/ToolRail";
import { AppMenuBar } from "./AppMenuBar";
import { ToolBar } from "./ToolBar";

export function Workspace() {
  const { actions, files } = useEditor();
  const { document: drawingDocument, file } = useEditorState();
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

  return (
    <div className="app-shell">
      <AppMenuBar
        onNewDocument={requestNewDocument}
        onOpenProject={requestOpen}
        onSaveProject={save}
        onSaveProjectAs={saveAs}
        onExportPng={exportPng}
      />
      <ToolBar />
      <div className="workspace-body">
        <ToolRail />
        <CanvasStage />
        <LayersPanel />
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
