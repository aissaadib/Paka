/**
 * A tooltip that follows its anchor.
 *
 * The browser's own `title` tooltip cannot be aligned: it appears wherever
 * the pointer happens to be, which is wrong for a vertical tool rail, where
 * the label belongs to the right of the button, and it lands on top of the
 * canvas. This one is anchored, keeps itself inside the window, and is
 * rendered in a portal so no scroll container can clip it.
 *
 * The delay keeps a tooltip from flickering while the pointer crosses the
 * workspace, and the tooltip is also shown on keyboard focus, so the hint
 * reaches a keyboard user too.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type TooltipPlacement = "top" | "right" | "bottom" | "left";

export interface TooltipProps {
  /** The text. */
  readonly label: string;
  /** An optional shortcut hint, shown after the label. */
  readonly shortcut?: string;
  /** Which side of the anchor the tooltip sits on. */
  readonly placement?: TooltipPlacement;
  /** A class for the anchor, so a context can hide or lay the anchor out. */
  readonly className?: string;
  readonly children: ReactNode;
}

const SHOW_DELAY_MS = 450;
const GAP_PX = 8;
const EDGE_PX = 6;

interface Position {
  readonly left: number;
  readonly top: number;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

export function Tooltip({
  label,
  shortcut,
  placement = "bottom",
  className,
  children,
}: TooltipProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const tooltipId = useId();

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback(() => {
    cancel();
    timerRef.current = window.setTimeout(() => {
      const anchor = anchorRef.current;
      if (anchor) {
        setAnchorRect(anchor.getBoundingClientRect());
      }
      setOpen(true);
    }, SHOW_DELAY_MS);
  }, [cancel]);

  const hide = useCallback(() => {
    cancel();
    setOpen(false);
  }, [cancel]);

  useEffect(() => cancel, [cancel]);

  // The anchor moves when the workspace scrolls or resizes, so the tooltip is
  // placed again whenever it does.
  useEffect(() => {
    if (!open) {
      return;
    }
    const measure = () => {
      const anchor = anchorRef.current;
      if (anchor) {
        setAnchorRect(anchor.getBoundingClientRect());
      }
    };
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hide();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, hide]);

  // The bubble is measured after it is rendered, so the placement uses its
  // real size rather than a guess.
  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!open || !anchorRect || !bubble) {
      return;
    }
    const size = bubble.getBoundingClientRect();
    const next = computePosition(anchorRect, placement, size);
    setPosition((current) =>
      current && current.left === next.left && current.top === next.top ? current : next,
    );
  }, [open, anchorRect, placement]);

  return (
    <>
      <span
        ref={anchorRef}
        className={className ? `tooltip-anchor ${className}` : "tooltip-anchor"}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocusCapture={show}
        onBlurCapture={hide}
      >
        {children}
      </span>
      {open
        ? createPortal(
            <div
              ref={bubbleRef}
              id={tooltipId}
              role="tooltip"
              className="tooltip"
              style={{
                left: `${position?.left ?? 0}px`,
                top: `${position?.top ?? 0}px`,
                // The bubble is measured before it is placed, so it stays
                // hidden until it knows where it belongs.
                visibility: position ? "visible" : "hidden",
              }}
            >
              <span className="tooltip__label">{label}</span>
              {shortcut ? <span className="tooltip__key">{shortcut}</span> : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * Places the tooltip beside the anchor, then pulls it back inside the
 * window.
 */
function computePosition(rect: DOMRect, placement: TooltipPlacement, size: Size): Position {
  let left: number;
  let top: number;

  switch (placement) {
    case "top":
      left = rect.left + rect.width / 2 - size.width / 2;
      top = rect.top - size.height - GAP_PX;
      break;
    case "bottom":
      left = rect.left + rect.width / 2 - size.width / 2;
      top = rect.top + rect.height + GAP_PX;
      break;
    case "left":
      left = rect.left - size.width - GAP_PX;
      top = rect.top + rect.height / 2 - size.height / 2;
      break;
    case "right":
    default:
      left = rect.left + rect.width + GAP_PX;
      top = rect.top + rect.height / 2 - size.height / 2;
      break;
  }

  const maxLeft = Math.max(EDGE_PX, window.innerWidth - size.width - EDGE_PX);
  const maxTop = Math.max(EDGE_PX, window.innerHeight - size.height - EDGE_PX);
  return {
    left: Math.min(Math.max(left, EDGE_PX), maxLeft),
    top: Math.min(Math.max(top, EDGE_PX), maxTop),
  };
}
