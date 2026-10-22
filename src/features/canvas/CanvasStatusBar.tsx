/**
 * Bottom status bar.
 *
 * Document and viewport facts are rendered from the engine snapshot (low
 * frequency). Cursor position, input device and pressure are written straight
 * into the DOM from the cursor stream, so moving the pointer never re-renders
 * React.
 *
 * The unsaved-changes marker is part of the document name: a dot plus the word
 * in the tooltip, and the full project path as the title.
 */

import { useEffect, useRef } from "react";
import { SNAP_TOLERANCE_PX } from "../../core/document/grid";
import {
  SELECTION_MODE_HINTS,
  SELECTION_MODE_LABELS,
} from "../../core/document/selectionModes";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { useNativeEnvironment } from "../../hooks/useNativeEnvironment";
import type { CursorReport } from "../../types/pointer";
import { fileNameOf } from "../../utils/path";
import type { FileMessage } from "../project/fileMessages";

function formatZoom(zoom: number): string {
  const percent = zoom * 100;
  return `${percent >= 10 ? Math.round(percent) : percent.toFixed(1)}%`;
}

function describeInput(report: CursorReport): string {
  switch (report.kind) {
    case "pen":
      return report.hasPressure ? `pen · pressure ${report.pressure.toFixed(2)}` : "pen · no pressure";
    case "mouse":
      return "mouse";
    case "touch":
      return "touch";
    default:
      return "unknown input";
  }
}

export interface CanvasStatusBarProps {
  /** Outcome of the last file operation, shown in the bar. */
  readonly fileMessage?: FileMessage | null;
  /** True while a file dialog is open or a file is being written. */
  readonly fileBusy?: boolean;
  readonly onDismissFileMessage?: () => void;
}

export function CanvasStatusBar({
  fileMessage,
  fileBusy = false,
  onDismissFileMessage,
}: CanvasStatusBarProps) {
  const { engine, actions } = useEditor();
  const {
    document,
    viewport,
    history,
    file,
    selectedStrokes,
    selectedGuideId,
    selectionMode,
    toolId,
    notice,
    gridVisible,
    gridSpacing,
    gridSnapping,
  } = useEditorState();
  const native = useNativeEnvironment();
  const positionRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    return engine.subscribeCursor((report) => {
      if (positionRef.current) {
        positionRef.current.textContent = report.inside
          ? `${Math.round(report.docX)}, ${Math.round(report.docY)}`
          : "—";
      }
      if (inputRef.current) {
        inputRef.current.textContent = report.inside ? describeInput(report) : "—";
      }
    });
  }, [engine]);

  const nativeLabel =
    native.status === "ready" && native.environment
      ? `native ${native.environment.os}/${native.environment.arch}`
      : native.status === "loading"
        ? "native …"
        : "native unavailable";

  const hasFileMessage = fileMessage !== null && fileMessage !== undefined;
  const noticeVisible = !hasFileMessage && notice !== null;
  const fileLabel = fileBusy ? "working…" : (fileMessage?.text ?? notice ?? "");
  const isError =
    !fileBusy && (fileMessage?.tone === "error" || noticeVisible);
  const dismiss = hasFileMessage
    ? onDismissFileMessage
    : noticeVisible
      ? actions.dismissNotice
      : undefined;

  // The guides: how many the document holds, and which one is selected.
  const guideCount = document.guides.length;
  const selectedGuide =
    selectedGuideId === null
      ? undefined
      : document.guides.find((guide) => guide.id === selectedGuideId);

  return (
    <footer className="status-bar">
      <span className="status-bar__item" title={file.path ?? "Not saved to a file yet"}>
        {file.path === null ? document.name : fileNameOf(file.path)}
        {file.dirty ? (
          <span
            className="status-bar__dirty"
            role="img"
            aria-label="Unsaved changes"
            title="Unsaved changes"
          >
            ●
          </span>
        ) : null}
        {file.dirty ? <span className="status-bar__unsaved">unsaved</span> : null}
      </span>
      <span className="status-bar__item">
        {document.width} × {document.height} px
      </span>
      <span className="status-bar__item">zoom {formatZoom(viewport.zoom)}</span>
      <span className="status-bar__item">history {history.depth}</span>
      {selectedStrokes === 0 ? null : (
        <span
          className="status-bar__item"
          title="Selected strokes: drag or nudge with the arrow keys, Ctrl+D duplicates, Delete removes"
        >
          {selectedStrokes} selected
        </span>
      )}
      {toolId === "select" ? (
        <span
          className="status-bar__item"
          title={SELECTION_MODE_HINTS[selectionMode]}
        >
          marquee: {SELECTION_MODE_LABELS[selectionMode].toLowerCase()}
        </span>
      ) : null}
      {selectedGuide ? (
        <span
          className="status-bar__item"
          title="Selected guide: drag it to move it, Delete removes it, Escape clears the selection"
        >
          {selectedGuide.axis} guide at {selectedGuide.position} px
        </span>
      ) : guideCount === 0 ? null : (
        <span className="status-bar__item" title="Composition guides in this document">
          {guideCount} guide{guideCount === 1 ? "" : "s"}
        </span>
      )}
      {gridVisible ? (
        <span className="status-bar__item" title="The grid overlay is drawn over the paper">
          grid {gridSpacing} px
        </span>
      ) : null}
      {gridSnapping ? (
        <span
          className="status-bar__item"
          title={`Snapping is on: a drawing point within ${SNAP_TOLERANCE_PX} screen pixels of a guide or a grid line lands on it`}
        >
          snap on
        </span>
      ) : null}
      {fileLabel === "" ? null : (
        <span
          className={[
            "status-bar__item",
            "status-bar__message",
            isError ? "is-error" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          role="status"
          aria-live="polite"
        >
          {fileLabel}
          {dismiss ? (
            <button
              type="button"
              className="status-bar__dismiss"
              aria-label="Dismiss message"
              onClick={dismiss}
            >
              ✕
            </button>
          ) : null}
        </span>
      )}
      <span className="status-bar__spacer" />
      <span className="status-bar__item">
        cursor <span className="status-bar__readout" ref={positionRef}>—</span>
      </span>
      <span className="status-bar__item status-bar__readout" ref={inputRef}>
        —
      </span>
      <span
        className="status-bar__item"
        title={native.error ?? "Native environment reported by the Rust side"}
      >
        {nativeLabel}
      </span>
    </footer>
  );
}
