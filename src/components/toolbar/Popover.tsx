/**
 * A floating panel: the popover the tool rail's flyout and its tooltip share.
 *
 * The panel is portalled to the body and positioned `fixed`, so the rail's own
 * scrolling never clips it and the strip's overflow never hides it. It is
 * placed from the anchor's rectangle, so it stays beside the button it belongs
 * to when the window is resized or the rail is scrolled.
 *
 * Two shapes of the same primitive:
 *
 * - **anchored** (the rail's flyout and tooltip): the caller owns the open
 *   state and hands over the rectangle the panel belongs to;
 * - **triggered** (a control that opens its own panel): the panel opens under
 *   a trigger button the primitive owns.
 *
 * Keyboard: `Escape` closes the panel and gives the focus back to the
 * trigger; a pointer press outside the panel closes it as well.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  placePopover,
  type PopoverPlacement,
  type PopoverSide,
  type ToolRailRect,
} from "../../core/tools/toolRail";

export interface PopoverProps {
  /** The panel's content. */
  readonly children: ReactNode;
  /** The trigger's text, in the triggered shape. */
  readonly label?: string;
  /** The trigger's own tooltip, in the triggered shape. */
  readonly title?: string;
  /**
   * Whether the panel is open.
   *
   * Given, the popover is anchored: the caller owns the state and hands over
   * the rectangle. Left out, the popover is triggered and owns its own state.
   */
  readonly open?: boolean;
  /** The rectangle the panel is anchored to, in viewport coordinates. */
  readonly anchor?: ToolRailRect;
  /**
   * The element the panel is anchored to.
   *
   * When it is given, the panel re-measures it every time it is placed, so it
   * follows its button when the window is resized or the rail is scrolled.
   */
  readonly anchorElement?: HTMLElement | null;
  /** Which side of the anchor the panel opens on. */
  readonly side?: PopoverSide;
  /** The gap between the anchor and the panel. */
  readonly gap?: number;
  /** Called when the panel asks to be closed. */
  readonly onClose?: () => void;
  /**
   * Called once the panel has been placed and is visible.
   *
   * A panel that takes the focus cannot do it before it is placed: a panel
   * that is still hidden cannot be focused, so the focus would be dropped.
   */
  readonly onPlaced?: () => void;
  /** The panel's role. */
  readonly role?: string;
  /** The panel's accessible name. */
  readonly ariaLabel?: string;
  /** The panel's class name, on top of `popover__panel`. */
  readonly className?: string;
  /** True when the panel takes the focus as it opens. */
  readonly autoFocus?: boolean;
  /** True when a pointer press outside the panel closes it. */
  readonly closeOnOutsideClick?: boolean;
}

export function Popover({
  children,
  label,
  title,
  open,
  anchor,
  anchorElement,
  side = "below",
  gap,
  onClose,
  onPlaced,
  role = "dialog",
  ariaLabel,
  className,
  autoFocus = false,
  closeOnOutsideClick = true,
}: PopoverProps) {
  const isAnchored = open !== undefined;
  const [triggeredOpen, setTriggeredOpen] = useState(false);
  const isOpen = isAnchored ? open === true : triggeredOpen;

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [triggerRect, setTriggerRect] = useState<ToolRailRect | null>(null);
  const [placement, setPlacement] = useState<PopoverPlacement | null>(null);

  /** Closes the panel, whichever shape it is in. */
  const close = useCallback(() => {
    if (!isAnchored) {
      setTriggeredOpen(false);
    }
    onClose?.();
  }, [isAnchored, onClose]);

  /** Puts the panel beside its anchor, inside the window. */
  const place = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const rect =
      anchorElement !== undefined && anchorElement !== null
        ? anchorElement.getBoundingClientRect()
        : isAnchored
          ? (anchor ?? null)
          : triggerRect;
    if (!rect) {
      return;
    }
    const box = panel.getBoundingClientRect();
    setPlacement(
      placePopover(
        rect,
        { width: box.width, height: box.height },
        { width: window.innerWidth, height: window.innerHeight },
        { side, gap },
      ),
    );
  }, [anchor, anchorElement, isAnchored, side, gap, triggerRect]);

  // The panel is measured after it is in the document, so it can be kept
  // inside the window instead of hanging off the edge.
  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }
    place();
    const handle = () => place();
    window.addEventListener("resize", handle);
    window.addEventListener("scroll", handle, true);
    return () => {
      window.removeEventListener("resize", handle);
      window.removeEventListener("scroll", handle, true);
    };
  }, [isOpen, place]);

  // The panel takes the focus when it opens, so the first `Tab` reaches its
  // first control.
  useLayoutEffect(() => {
    if (isOpen && autoFocus) {
      panelRef.current?.focus();
    }
  }, [isOpen, autoFocus]);

  // The panel is announced as placed once it is visible and in position. A
  // panel that is still hidden cannot take the focus, so this is the moment a
  // caller may move the focus into it.
  const placedRef = useRef(false);
  useLayoutEffect(() => {
    if (!isOpen) {
      placedRef.current = false;
      return;
    }
    if (placement !== null && !placedRef.current) {
      placedRef.current = true;
      onPlaced?.();
    }
  }, [isOpen, placement, onPlaced]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    // A panel nobody can dismiss must not swallow the editor's own keys: the
    // tooltip is dismissed by the pointer leaving its button, not by Escape.
    const dismissible = !isAnchored || onClose !== undefined;
    if (!dismissible) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!closeOnOutsideClick) {
        return;
      }
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      close();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      // The panel owns Escape while it is open: the editor's own Escape
      // (clearing the selection) must not fire behind it.
      event.stopPropagation();
      event.preventDefault();
      close();
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, close, closeOnOutsideClick]);

  const panel = isOpen ? (
    <div
      ref={panelRef}
      className={["popover__panel", className].filter(Boolean).join(" ")}
      role={role}
      aria-label={ariaLabel}
      tabIndex={autoFocus ? -1 : undefined}
      style={{
        top: placement?.top ?? 0,
        left: placement?.left ?? 0,
        visibility: placement === null ? "hidden" : "visible",
      }}
    >
      {children}
    </div>
  ) : null;

  if (isAnchored) {
    return panel === null ? null : createPortal(panel, document.body);
  }

  return (
    <div className="popover">
      <button
        type="button"
        ref={triggerRef}
        className="popover__trigger"
        title={title ?? label}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => {
          // The trigger's rectangle is known now, so the panel opens in the
          // right place instead of jumping into it on the next frame.
          const trigger = triggerRef.current;
          if (trigger) {
            setTriggerRect(trigger.getBoundingClientRect());
          }
          setTriggeredOpen((value) => !value);
        }}
      >
        {label}
      </button>
      {panel === null ? null : createPortal(panel, document.body)}
    </div>
  );
}
