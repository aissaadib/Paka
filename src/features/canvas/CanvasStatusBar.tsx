/**
 * Bottom status bar.
 *
 * Document and viewport facts are rendered from the engine snapshot (low
 * frequency). Cursor position, input device and pressure are written straight
 * into the DOM from the cursor stream, so moving the pointer never re-renders
 * React.
 *
 * Every field is read from the engine's own state: the document's size, the
 * zoom, the active tool, the active layer, the history depth, the selection,
 * the guides, the grid and the view's orientation. Nothing here is a guess and
 * nothing is a constant that could drift away from the canvas.
 *
 * The unsaved-changes marker is part of the document name: a dot plus the word
 * in the tooltip, and the full project path as the title.
 */

import { useEffect, useRef } from "react";
import { SNAP_TOLERANCE_PX } from "../../core/document/grid";
import type { SymmetryMode } from "../../core/document/symmetry";
import type { EditorSnapshot } from "../../core/engine/DrawingEngine";
import { TOOL_DEFINITIONS } from "../../core/tools/toolDefinitions";
import { viewTransformOf } from "../../core/rendering/viewport";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { useNativeEnvironment } from "../../hooks/useNativeEnvironment";
import type { CursorReport } from "../../types/pointer";
import { fileNameOf } from "../../utils/path";
import { SECONDARY_VIEW_ID } from "../../types/viewport";
import type { FileMessage } from "../project/fileMessages";
import { ZoomField } from "../view/ZoomField";
import { describeViewTransform } from "../view/viewNavigation";

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

/**
 * The selected gradient's geometry, in one line.
 *
 * A linear gradient reads as its axis, a radial one as its centre and its
 * radius: the two handles mean different things, so the readout does too.
 */
function describeGradient(gradient: NonNullable<EditorSnapshot["selectedGradient"]>): string {
  const start = `${Math.round(gradient.x1)}, ${Math.round(gradient.y1)}`;
  if (gradient.type === "radial") {
    const radius = Math.hypot(gradient.x2 - gradient.x1, gradient.y2 - gradient.y1);
    return `radial at ${start} r ${Math.round(radius)}`;
  }
  return `linear ${start} → ${Math.round(gradient.x2)}, ${Math.round(gradient.y2)}`;
}

/**
 * The symmetry, in one line.
 *
 * The mode says what the copies are, and the radial mode adds how many there
 * are: the two mirror modes always make exactly one copy.
 */
function describeSymmetry(mode: SymmetryMode, count: number): string {
  if (mode === "radial") {
    return `radial x${count}`;
  }
  return mode === "vertical" ? "mirror V" : "mirror H";
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
    selectedGradient,
    notice,
    gridVisible,
    gridSpacing,
    gridSnapping,
    symmetryEnabled,
    symmetryMode,
    symmetryCount,
    symmetryCenter,
    toolId,
    activeViewId,
    secondaryViewOpen,
  } = useEditorState();
  const native = useNativeEnvironment();
  const positionRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    return engine.subscribeCursor((report) => {
      // A cursor belongs to a view: the readout shows the one of the view the
      // user is working in, not the one of a window the pointer just left.
      if (report.viewId !== activeViewId) {
        return;
      }
      if (positionRef.current) {
        positionRef.current.textContent = report.inside
          ? `${Math.round(report.docX)}, ${Math.round(report.docY)}`
          : "—";
      }
      if (inputRef.current) {
        inputRef.current.textContent = report.inside ? describeInput(report) : "—";
      }
    });
  }, [engine, activeViewId]);

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

  // The tool that will draw the next stroke, and the layer it will land on.
  // The lookup does not throw: a tool the definitions do not know would break
  // the whole bar, and a name is enough for a readout.
  const tool = TOOL_DEFINITIONS.find((definition) => definition.id === toolId);
  const activeLayer =
    document.activeLayerId === null
      ? undefined
      : document.layers.find((layer) => layer.id === document.activeLayerId);

  // The view's orientation. An upright, unmirrored view is the default, so it
  // is not named; a turned or mirrored one is, because the canvas looks
  // different from the document and the user deserves to know why.
  const viewTransform = viewTransformOf(viewport);
  const viewIsDefault = viewTransform.rotation === 0 && !viewTransform.mirrored;

  return (
    <footer className="status-bar">
      <div className="status-bar__group">
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
        <span className="status-bar__item" title="Document size in document pixels">
          {document.width} × {document.height} px
        </span>
        <span className="status-bar__item" title={`Active tool${tool ? ` (${tool.shortcut})` : ""}`}>
          tool {tool?.label ?? toolId}
        </span>
        {activeLayer ? (
          <span
            className="status-bar__item"
            title={`Active layer: ${activeLayer.name} (layer ${document.layers.length} in total)`}
          >
            layer {activeLayer.name}
          </span>
        ) : null}
        <span className="status-bar__item" title="Zoom: type a percentage and press Enter">
          zoom <ZoomField />
        </span>
        {secondaryViewOpen ? (
          <span
            className="status-bar__item"
            title="The view the zoom, the fit and the rotation act on"
          >
            view {activeViewId === SECONDARY_VIEW_ID ? 2 : 1}
          </span>
        ) : null}
        <span className="status-bar__item" title="Undo steps in the history">
          history {history.depth}
        </span>
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
        {selectedGradient ? (
          <span
            className="status-bar__item"
            title="Selected gradient: drag a handle to move it, the arrow keys nudge the focused handle by 1 px (Shift: 10 px), Escape clears the selection"
          >
            {describeGradient(selectedGradient)}
          </span>
        ) : null}
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
        {symmetryEnabled ? (
          <span
            className="status-bar__item"
            title="The symmetry is on: the next stroke is repeated around the centre. Drag the centre marker on the canvas to move it"
          >
            symmetry {describeSymmetry(symmetryMode, symmetryCount)} at {symmetryCenter.x},{" "}
            {symmetryCenter.y}
          </span>
        ) : null}
        {viewIsDefault ? null : (
          <span
            className="status-bar__item"
            title="The view is turned: the document's pixels are untouched"
          >
            {describeViewTransform(viewTransform)}
          </span>
        )}
      </div>
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
      <div className="status-bar__group status-bar__group--end">
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
      </div>
    </footer>
  );
}
