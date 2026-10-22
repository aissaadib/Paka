/**
 * Bottom status bar.
 *
 * Document and viewport facts are rendered from the engine snapshot (low
 * frequency). Cursor position, input device and pressure are written straight
 * into the DOM from the cursor stream, so moving the pointer never re-renders
 * React.
 *
 * The row holds the view toggles on the left, the facts about the document in
 * the middle and the pointer readout on the right. The document's own name
 * and the zoom live in the app bar, so neither is repeated here.
 */

import { useEffect, useRef } from "react";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { useNativeEnvironment } from "../../hooks/useNativeEnvironment";
import type { CursorReport } from "../../types/pointer";
import type { FileMessage } from "../project/fileMessages";
import { GridControls } from "../grid/GridControls";

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
    history,
    selectedStrokes,
    selectedGuideId,
    notice,
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

  // The layer the next stroke lands on.
  const activeLayer = document.layers.find(
    (layer) => layer.id === document.activeLayerId,
  );

  return (
    <footer className="status-bar" aria-label="Document status">
      <GridControls />
      <span className="status-bar__item" title="The layer the next stroke is drawn on">
        <span className="status-bar__value">{activeLayer?.name ?? "No layer"}</span>
      </span>
      <span className="status-bar__item">
        {document.width} × {document.height} px
      </span>
      <span className="status-bar__item">history {history.depth}</span>
      {selectedStrokes === 0 ? null : (
        <span
          className="status-bar__item"
          title="Selected strokes: drag or nudge with the arrow keys, Ctrl+D duplicates, Delete removes"
        >
          {selectedStrokes} selected
        </span>
      )}
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
