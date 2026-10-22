/**
 * The document tabs: the open documents, and the one that is on screen.
 *
 * The strip is deliberately compact. A tab is at most a couple of hundred
 * pixels wide, its title is cut off with an ellipsis rather than widening
 * the row, and the row itself scrolls sideways. A dozen open documents
 * therefore never push the tool rail, the canvas or the panels out of the
 * way: the strip is its own row above the workspace.
 *
 * The dirty marker is a dot next to the title, and the close button is on
 * every tab. Closing a tab that has unsaved changes is the caller's
 * decision - this component asks, it does not decide.
 */

import { useEffect, useRef } from "react";
import { IconPlus } from "../../components/icons";
import { useEditor } from "../../hooks/useEditor";
import { useDocumentSessions } from "../../hooks/useDocumentSessions";
import "./documentTabs.css";

export interface DocumentTabsProps {
  /** Starts a new, empty document in a new tab. */
  readonly onNewDocument: () => void;
  /**
   * Asks for a tab to be closed.
   *
   * The session id is passed on, because the tab being closed is not
   * necessarily the one on screen.
   */
  readonly onRequestClose: (sessionId: string) => void;
}

export function DocumentTabs({ onNewDocument, onRequestClose }: DocumentTabsProps) {
  const { sessions } = useEditor();
  const state = useDocumentSessions();
  const activeRef = useRef<HTMLDivElement | null>(null);

  // The active tab is brought into view: a document opened from the File
  // menu is often the last one, and the user has to be able to see which tab
  // they are on.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [state.activeId]);

  return (
    <div className="document-tabs">
      <div className="document-tabs__list" role="group" aria-label="Open documents">
        {state.sessions.map((session) => (
          <div
            className={[
              "document-tab",
              session.active ? "is-active" : "",
              session.dirty ? "is-dirty" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            key={session.id}
            ref={session.active ? activeRef : undefined}
          >
            <button
              type="button"
              className="document-tab__label"
              aria-current={session.active ? "true" : undefined}
              title={session.path ?? session.title}
              onClick={() => sessions.activate(session.id)}
            >
              {session.dirty ? (
                <span
                  className="document-tab__dirty"
                  role="img"
                  aria-label="Unsaved changes"
                  title="Unsaved changes"
                >
                  ●
                </span>
              ) : null}
              <span className="document-tab__title">{session.title}</span>
            </button>
            <button
              type="button"
              className="document-tab__close"
              aria-label={`Close ${session.title}`}
              title={`Close ${session.title}`}
              onClick={() => onRequestClose(session.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="document-tabs__new"
        onClick={onNewDocument}
        title="New document"
        aria-label="New document"
      >
        <IconPlus width="14" height="14" />
      </button>
    </div>
  );
}
