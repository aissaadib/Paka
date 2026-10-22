/**
 * A compact popover: a trigger in the strip and a panel of controls below it.
 *
 * The panel is positioned `fixed`, so the strip's own horizontal scroll cannot
 * clip it, and it is placed from the trigger's rectangle so it stays under its
 * button when the window is resized or the strip is scrolled.
 *
 * Keyboard: the panel takes the focus when it opens, so the first `Tab`
 * reaches its first control; `Escape` closes it and puts the focus back on the
 * trigger.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface PopoverProps {
  /** The trigger's text. */
  readonly label: string;
  /** The tooltip on the trigger. */
  readonly title?: string;
  readonly children: ReactNode;
}

interface Placement {
  readonly top: number;
  readonly left: number;
}

/** The gap between the trigger and the panel. */
const PANEL_GAP = 4;
/** The smallest gap the panel keeps from the window's edge. */
const EDGE_GAP = 8;

export function Popover({ label, title, children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  /** Puts the panel under the trigger, inside the window. */
  const place = () => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const panel = panelRef.current;
    const panelWidth = panel?.getBoundingClientRect().width ?? 0;
    const panelHeight = panel?.getBoundingClientRect().height ?? 0;

    const maxTop = window.innerHeight - panelHeight - EDGE_GAP;
    const top = Math.max(EDGE_GAP, Math.min(rect.bottom + PANEL_GAP, maxTop));
    const maxLeft = window.innerWidth - panelWidth - EDGE_GAP;
    const left = Math.max(EDGE_GAP, Math.min(rect.left, maxLeft));

    setPlacement({ top, left });
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      // The editor's own Escape handling clears the selection; the popover
      // owns the key while it is open.
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();

    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
    // `place` is rebuilt on every render, but the effect only cares about the
    // panel being open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    // The trigger's rectangle is known now, so the panel opens in the right
    // place instead of jumping into it on the next frame.
    const trigger = triggerRef.current;
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      setPlacement({ top: rect.bottom + PANEL_GAP, left: rect.left });
    }
    setOpen(true);
  };

  return (
    <div className="popover">
      <button
        type="button"
        ref={triggerRef}
        className="popover__trigger"
        title={title ?? label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        {label}
      </button>
      {open ? (
        <div
          ref={panelRef}
          className="popover__panel"
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          style={{
            top: placement?.top ?? 0,
            left: placement?.left ?? 0,
            visibility: placement === null ? "hidden" : "visible",
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
