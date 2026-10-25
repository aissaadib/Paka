/**
 * The panels the user has pulled out of the dock.
 *
 * A floating panel is the same panel the dock renders - the registry still
 * owns its body - with a window around it. The window can be moved by its
 * header and resized from its bottom-right corner, and it can be docked again
 * or hidden. Nothing here touches the document: moving a window is shell
 * state, exactly like moving a docked tab.
 *
 * The layer is `position: fixed` and ignores the pointer outside its panels,
 * so the canvas underneath keeps working while a panel floats above it.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { IconClose, IconDock } from "../icons";
import "./panel.css";

/** One panel the floating layer can show. */
export interface FloatingPanelSpec {
  /** The panel's stable id. */
  readonly id: string;
  /** The heading the window shows. */
  readonly title: string;
  /** The panel's body. */
  readonly render: () => ReactNode;
}

export interface FloatingPanelsProps {
  readonly panels: readonly FloatingPanelSpec[];
  /** Puts the panel back in the side dock. */
  readonly onDock: (panelId: string) => void;
  /** Hides the panel. */
  readonly onHide: (panelId: string) => void;
}

interface PanelRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface DragState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly left: number;
  readonly top: number;
}

interface ResizeState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly width: number;
  readonly height: number;
}

const MIN_WIDTH = 240;
const MIN_HEIGHT = 220;
const EDGE = 8;
const KEEP_VISIBLE = 96;

export function FloatingPanels({ panels, onDock, onHide }: FloatingPanelsProps) {
  if (panels.length === 0) {
    return null;
  }
  return (
    <div className="floating-panels" aria-label="Floating panels">
      {panels.map((panel, index) => (
        <FloatingPanel
          key={panel.id}
          panel={panel}
          index={index}
          onDock={onDock}
          onHide={onHide}
        />
      ))}
    </div>
  );
}

interface FloatingPanelProps {
  readonly panel: FloatingPanelSpec;
  readonly index: number;
  readonly onDock: (panelId: string) => void;
  readonly onHide: (panelId: string) => void;
}

function FloatingPanel({ panel, index, onDock, onHide }: FloatingPanelProps) {
  const [rect, setRect] = useState<PanelRect>(() => initialRect(index));
  const drag = useRef<DragState | null>(null);
  const resize = useRef<ResizeState | null>(null);

  const clampIntoViewport = useCallback((next: PanelRect): PanelRect => {
    const width = Math.max(MIN_WIDTH, Math.min(next.width, viewportWidth() - EDGE * 2));
    const height = Math.max(MIN_HEIGHT, Math.min(next.height, viewportHeight() - EDGE * 2));
    const left = clamp(
      next.left,
      EDGE - width + KEEP_VISIBLE,
      viewportWidth() - KEEP_VISIBLE,
    );
    const top = clamp(next.top, 0, viewportHeight() - 40);
    return { left, top, width, height };
  }, []);

  useEffect(() => {
    const onResize = () => setRect((current) => clampIntoViewport(current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampIntoViewport]);

  const onDragStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    // A button inside the header is an action, not a drag handle.
    if ((event.target as HTMLElement).closest("button") !== null) {
      return;
    }
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onDragMove = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) {
      return;
    }
    setRect((current) =>
      clampIntoViewport({
        ...current,
        left: state.left + event.clientX - state.startX,
        top: state.top + event.clientY - state.startY,
      }),
    );
  };

  const onDragEnd = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) {
      return;
    }
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    resize.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
  };

  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = resize.current;
    if (state === null || state.pointerId !== event.pointerId) {
      return;
    }
    setRect((current) =>
      clampIntoViewport({
        ...current,
        width: state.width + event.clientX - state.startX,
        height: state.height + event.clientY - state.startY,
      }),
    );
  };

  const onResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resize.current?.pointerId !== event.pointerId) {
      return;
    }
    resize.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  /** Arrow keys move the window; Shift makes the step fine. */
  const onHeaderKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 1 : 8;
    let delta: { x: number; y: number } | null = null;
    switch (event.key) {
      case "ArrowLeft":
        delta = { x: -step, y: 0 };
        break;
      case "ArrowRight":
        delta = { x: step, y: 0 };
        break;
      case "ArrowUp":
        delta = { x: 0, y: -step };
        break;
      case "ArrowDown":
        delta = { x: 0, y: step };
        break;
      default:
        return;
    }
    event.preventDefault();
    setRect((current) =>
      clampIntoViewport({
        ...current,
        left: current.left + delta.x,
        top: current.top + delta.y,
      }),
    );
  };

  return (
    <section
      className="floating-panel"
      data-panel-id={panel.id}
      role="region"
      aria-label={`${panel.title} panel`}
      style={{
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      }}
    >
      <header
        className="floating-panel__header"
        tabIndex={0}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onKeyDown={onHeaderKeyDown}
        title="Drag to move, or use the arrow keys"
      >
        <span className="floating-panel__grip" aria-hidden="true" />
        <h2 className="floating-panel__title">{panel.title}</h2>
        <div className="floating-panel__actions">
          <button
            type="button"
            className="floating-panel__button"
            aria-label={`Dock ${panel.title}`}
            title="Dock"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onDock(panel.id)}
          >
            <IconDock />
          </button>
          <button
            type="button"
            className="floating-panel__button"
            aria-label={`Hide ${panel.title}`}
            title="Hide"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onHide(panel.id)}
          >
            <IconClose />
          </button>
        </div>
      </header>
      <div className="floating-panel__body">{panel.render()}</div>
      <div
        className="floating-panel__resize"
        aria-hidden="true"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      />
    </section>
  );
}

function initialRect(index: number): PanelRect {
  const width = Math.min(300, Math.max(MIN_WIDTH, viewportWidth() - 32));
  const height = Math.min(430, Math.max(MIN_HEIGHT, viewportHeight() - 120));
  const left = Math.max(EDGE, viewportWidth() - width - 24 - index * 18);
  const top = Math.max(EDGE, 72 + index * 18);
  return { left, top, width, height };
}

function viewportWidth(): number {
  return typeof window === "undefined" ? 1280 : window.innerWidth;
}

function viewportHeight(): number {
  return typeof window === "undefined" ? 800 : window.innerHeight;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
