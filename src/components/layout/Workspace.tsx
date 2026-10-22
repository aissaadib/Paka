/**
 * Application shell: menu bar, tool options bar, toolbar, document tabs, tool
 * rail, canvas, panel stack and status bar.
 * Application shell: menu bar, tool options bar, toolbar, tool rail, canvas,
 * layers panel and status bar.
 *
 * The state kept here is the workflow the engine deliberately knows nothing
 * about: which dialog is open, and which action is waiting for the user to
 * confirm that unsaved work may be discarded. The panels themselves live in
 * the panel stack, which the panel manager drives.
 *
 * With several documents open, only two things can destroy work: closing a
 * tab that has unsaved changes, and closing the window while any tab has
 * unsaved changes. Both ask first. Creating a new document and opening a
 * project do **not** ask: they add a tab, and the drawing that is on screen
 * keeps its own tab, its own history and its own viewport.
 */

import { useCallback, useMemo, useState } from "react";
import { CanvasStage } from "../../features/canvas/CanvasStage";
import { CanvasStatusBar } from "../../features/canvas/CanvasStatusBar";
import { CommandPalette } from "../../features/commands/CommandPalette";
import { NewDocumentDialog } from "../../features/document/NewDocumentDialog";
import { LayersPanel } from "../../features/layers/LayersPanel";
import { ToolOptionsBar } from "../../features/options/ToolOptionsBar";
import {
  UnsavedChangesDialog,
  type UnsavedAction,
} from "../../features/project/UnsavedChangesDialog";
import { useCloseGuard } from "../../features/project/useCloseGuard";
import { useDocumentTitle } from "../../features/project/useDocumentTitle";
import { useFileCommands } from "../../features/project/useFileCommands";
import { closeWindowNow } from "../../features/project/windowControls";
import { DocumentTabs } from "../../features/tabs/DocumentTabs";
import { tabCloseDecision } from "../../core/documents/sessionRegistry";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { useDocumentSessions } from "../../hooks/useDocumentSessions";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { usePanModifier } from "../../hooks/usePanModifier";
import { useWorkspaceSettings } from "../../hooks/useWorkspace";
import { fileNameOf } from "../../utils/path";
import { SecondaryViewPanel } from "../../features/view/SecondaryViewPanel";
import { PanelStack } from "../panels/PanelStack";
import { ToolRail } from "../toolbar/ToolRail";
import { AppMenuBar } from "./AppMenuBar";
import { ToolBar } from "./ToolBar";

/** An action that is waiting for the user to confirm that work may be lost. */
interface PendingAction {
  readonly action: UnsavedAction;
  /** The tab the question is about, when it is about one tab. */
  readonly sessionId?: string;
  /** The name of that tab, so the question names it. */
  readonly documentName?: string | null;
}

export function Workspace() {
  const { actions, files, sessions, recentFiles } = useEditor();
  const { document: drawingDocument, file, secondaryViewOpen } = useEditorState();
  const sessionState = useDocumentSessions();
  const workspace = useWorkspaceSettings();
  const [newDocumentOpen, setNewDocumentOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const {
    open: openProject,
    openPath: openRecentFile,
    save,
    saveAs,
    exportPng,
    saveThen,
    saveSessionThen,
    saveAllThen,
    busy: fileBusy,
    message: fileMessage,
    dismissMessage,
  } = useFileCommands();

  // Once a project has a place on disk, the file name is what identifies it in
  // the window title and the status bar; the drawing's own name is only what it
  // was created as.
  const documentLabel = file.path === null ? drawingDocument.name : fileNameOf(file.path);

  useDocumentTitle(documentLabel, file.dirty, sessionState.sessions.length);
  useCloseGuard(useCallback(() => setPending({ action: "close" }), []));

  /** Carries out an action the user has agreed may discard unsaved work. */
  const proceed = useCallback(
    (pendingAction: PendingAction) => {
      switch (pendingAction.action) {
        case "new":
          setNewDocumentOpen(true);
          return;
        case "open":
          openProject();
          return;
        case "closeTab": {
          const sessionId = pendingAction.sessionId;
          if (sessionId !== undefined) {
            files.closeSession(sessionId);
          }
          return;
        }
        case "close":
          void closeWindowNow();
      }
    },
    [files, openProject],
  );

  // A new document is a new tab: the drawing on screen keeps its own tab, so
  // nothing is discarded and there is nothing to confirm.
  const requestNewDocument = useCallback(() => {
    setNewDocumentOpen(true);
  }, []);

  // Opening a project is a new tab as well, for the same reason.
  const requestOpen = useCallback(() => {
    openProject();
  }, [openProject]);

  const clearRecentFiles = useCallback(() => {
    recentFiles.clear();
  }, [recentFiles]);

  /**
   * Asks for a tab to be closed.
   *
   * A tab with unsaved changes is never closed silently: the user is asked
   * whether to save it, discard it or keep it.
   */
  const requestCloseTab = useCallback(
    (sessionId: string) => {
      const session = sessions.findById(sessionId);
      if (session === undefined) {
        return;
      }
      const snapshot = session.engine.getState();
      if (tabCloseDecision(session) === "confirm") {
        setPending({
          action: "closeTab",
          sessionId,
          documentName:
            snapshot.file.path === null ? snapshot.document.name : fileNameOf(snapshot.file.path),
        });
        return;
      }
      files.closeSession(sessionId);
    },
    [files, sessions],
  );

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
    if (action === null) {
      return;
    }
    if (action.action === "closeTab" && action.sessionId !== undefined) {
      // Continues only when that document really reached the disk.
      const sessionId = action.sessionId;
      saveSessionThen(sessionId, () => proceed({ ...action, sessionId }));
      return;
    }
    if (action.action === "close") {
      // Every open document with unsaved changes is written first; the window
      // only closes when all of them reached the disk.
      saveAllThen(() => proceed(action));
      return;
    }
    saveThen(() => proceed(action));
  }, [pending, proceed, saveAllThen, saveSessionThen, saveThen]);

  const openCommandPalette = useCallback(() => setPaletteOpen(true), []);
  const closeCommandPalette = useCallback(() => setPaletteOpen(false), []);
  const fileHandlers = useMemo(
    () => ({ save, saveAs, open: requestOpen }),
    [requestOpen, save, saveAs],
  );

  useKeyboardShortcuts(save, saveAs, requestOpen, openCommandPalette);
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
        onOpenRecent={openRecentFile}
        onClearRecentFiles={clearRecentFiles}
        onSaveProject={save}
        onSaveProjectAs={saveAs}
        onExportPng={exportPng}
      />
      <ToolOptionsBar />
      <ToolBar />
      {/* The tab strip and the workspace share one row of the shell: the strip
          has a fixed height of its own, so a long row of open documents never
          takes space away from the canvas. */}
      <div className="workspace-panel">
        <DocumentTabs onNewDocument={requestNewDocument} onRequestClose={requestCloseTab} />
        <div className="workspace-body">
          {workspace.shell.toolRail ? <ToolRail /> : null}
          <div className="canvas-views">
            <CanvasStage />
            {secondaryViewOpen ? <SecondaryViewPanel /> : null}
          </div>
          <PanelStack />
        </div>
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
          action={pending.action}
          documentName={pending.documentName ?? null}
          onCancel={() => setPending(null)}
          onSaveFirst={saveFirst}
          onDiscard={confirmDiscard}
        />
      )}
      <CommandPalette
        open={paletteOpen}
        onClose={closeCommandPalette}
        file={fileHandlers}
      />
    </div>
  );
}
