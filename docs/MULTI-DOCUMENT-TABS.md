# Multi-document tabs and recent files

**Status:** shipped (Agent 25). The tab strip, the per-document session
registry and the recent-file list are in the tree; the tests are in
`src/test/documentSessions.test.ts`.

## What it does

- A **tab strip** above the workspace shows every open document: its title,
  which one is active, and a dot when it has unsaved changes. It is a row of
  its own, with a fixed height, and the tabs scroll sideways inside it, so a
  long list of open documents never pushes the tool rail, the canvas or the
  panels out of the way.
- **New** and **Open** add a tab. They no longer ask whether the drawing on
  screen may be discarded, because nothing is discarded: the drawing keeps
  its own tab, its own history and its own viewport.
- **Closing a tab** asks when the document has unsaved changes: *Save
  first*, *Discard* or *Cancel*. Nothing is ever thrown away silently.
- **Closing the window** asks when *any* open document has unsaved changes,
  and *Save first* writes every one of them before the window goes.
- The **recent files** are in the File menu. A file that has been moved or
  deleted stays in the list and says so when it is opened.

## How it is built

**One `DrawingEngine` per open document.** The engine owns the document, the
strokes, the undo history, the selection and the viewport, so giving each
document an engine of its own is what makes the tabs independent - there is
no "swap the document into the one engine" step that could leave the history
or the selection behind. `core/documents/sessionRegistry.ts` owns the
sessions and knows which one is active; the canvas is bound to the active
session's engine and rebinds when the user switches tab.

The alternative - one engine with the document swapped in and out - was
rejected because the engine's history holds commands bound to that engine's
own stroke store, and restoring them into another document's strokes is
exactly the kind of bug that loses work.

**The preferences stay application-level.** The brush, the tool, the presets
and the grid belong to the application, not to a document, so they live in a
*preferences engine* - an engine that is never a document and never has a
renderer - and are mirrored into the active session. Both directions use the
same two functions the settings store uses
(`applyPreferencesToEngine`/`readPreferencesFromEngine`), so the settings
file and the document on screen can never disagree about what a preference
is.

**The recent files are a settings section.** The settings store owns the
settings file, so the list is handed to it as a section
(`core/documents/recentFiles.ts`) rather than written by a second writer. It
holds **paths only** - no drawing, no file contents, no preview.

## The rules that keep work from being lost

| Rule | Where |
| --- | --- |
| Opening parses and validates the file *before* a tab exists, so a corrupt file never becomes a tab and never disturbs the open ones. | `documentWorkspace.ts` |
| Opening a file that is already open focuses that tab instead of making a second copy of it. Two tabs on one file would mean two editors writing over each other. | `sessionRegistry.ts` (`findByPath`) |
| *Save as* refuses a path another open document holds. | `documentWorkspace.ts` (`refuseDuplicatePath`) |
| A tab with unsaved changes is never closed without a decision. | `sessionRegistry.ts` (`tabCloseDecision`) |
| Saving marks the document clean only after the bytes reached the disk. | `projectFiles.ts` (unchanged) |
| Closing the last tab leaves a fresh empty page rather than a window with nothing to draw on. | `sessionRegistry.ts` (`close`) |

## What is deliberately not here

- **The tabs are not restored at startup.** The recent list is persisted, but
  reopening documents automatically would open files the user did not ask
  for, and a file that moved would fail at startup. This is an owner
  decision, not a technical one.
- **There is no keyboard shortcut for closing a tab.** The action registry is
  another workstream's; the close button on the tab is the entry point for
  now. `Ctrl+W` would be the natural chord.
- **Switching tabs rebuilds the layer surfaces.** A background session has no
  renderer, so the first frame after a switch rasterizes the layers again.
  The document data, the history and the viewport are all kept; only the
  pixels are made again.
- **The secondary view (Agent 24) follows the active document.** It is bound
  to the same engine as the canvas, so it shows the document on screen.

## The files

| File | What is in it |
| --- | --- |
| `src/core/documents/sessionRegistry.ts` | The sessions, the active one, the tab strip's view, the close decision, the preference mirroring. |
| `src/core/documents/documentWorkspace.ts` | Open, save, save-as, export and close across the documents. |
| `src/core/documents/recentFiles.ts` | The recent list, its rules and its settings section. |
| `src/features/tabs/DocumentTabs.tsx` | The strip itself. |
| `src/features/tabs/documentTabs.css` | The strip, and the shell row it shares with the workspace. |
| `src/hooks/useDocumentSessions.ts`, `src/hooks/useRecentFiles.ts`, `src/hooks/useEditor.ts` (`useActiveEngine`) | The React bindings. |
| `src/state/editorStore.ts` | The session-aware editor: `editor.engine` is the *active* document's engine. |
| `src/components/layout/Workspace.tsx` | The close-tab flow. |
| `src/test/documentSessions.test.ts` | The registry, the workspace and the recent list. |
