/**
 * The rail's own tooltip.
 *
 * The browser's `title` tooltip follows the pointer: it opens under the
 * cursor and can cover the canvas the artist is aiming at. This one is
 * anchored to the button it belongs to, opens to the right of the rail and
 * takes no pointer event, so it can never swallow a click meant for the
 * canvas and never sits under the pointer.
 *
 * It is portalled to the body so the rail's own scrolling never clips it.
 */

import { createPortal } from "react-dom";

export interface ToolRailTooltipProps {
  /** The tool's name, or the group's name for a slot that stands for a family. */
  readonly title: string;
  /** What the tool does, in one line. */
  readonly description?: string;
  /** The shortcut that selects the tool. */
  readonly shortcut?: string;
  /** An extra line, for the case the description does not cover. */
  readonly hint?: string;
  /** The button the tooltip belongs to, in viewport coordinates. */
  readonly anchor: DOMRect;
}

/** The widest the tooltip may grow, and the gap to the button. */
const TOOLTIP_WIDTH = 244;
const TOOLTIP_GAP = 8;

export function ToolRailTooltip({
  title,
  description,
  shortcut,
  hint,
  anchor,
}: ToolRailTooltipProps) {
  const left = Math.max(
    TOOLTIP_GAP,
    Math.min(anchor.right + TOOLTIP_GAP, window.innerWidth - TOOLTIP_WIDTH - TOOLTIP_GAP),
  );

  return createPortal(
    <div
      className="tool-rail__tooltip"
      role="tooltip"
      style={{ left, top: anchor.top + anchor.height / 2 }}
    >
      <p className="tool-rail__tooltip-head">
        <span className="tool-rail__tooltip-title">{title}</span>
        {shortcut ? <span className="tool-rail__tooltip-shortcut">{shortcut}</span> : null}
      </p>
      {description ? <p className="tool-rail__tooltip-text">{description}</p> : null}
      {hint ? <p className="tool-rail__tooltip-hint">{hint}</p> : null}
    </div>,
    document.body,
  );
}
