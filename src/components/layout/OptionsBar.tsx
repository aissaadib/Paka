/**
 * The contextual options slot: the row that holds the active tool's options.
 *
 * The row has a fixed height and never wraps, so switching tools cannot
 * resize the canvas. What the row holds comes from the feature components:
 * the schema-driven tool options, the gradient's own controls, and the brush
 * group for the tools that paint with a brush. The colours are pinned to the
 * end of the row, because they apply to every tool.
 *
 * The row is a toolbar, so the arrow keys move between its controls - except
 * while a slider or a number box has the focus, where the arrow keys belong
 * to the value.
 *
 * This is the band, not the options: the options themselves are a feature's
 * business, and a feature that brings its own strip replaces the groups below
 * with its own component.
 */

import type { KeyboardEvent } from "react";
import { BrushControls } from "../../features/brushes/BrushControls";
import { ColorControls } from "../../features/color/ColorControls";
import { GradientControls } from "../../features/gradient/GradientControls";
import { ToolOptionsPanel } from "../../features/options/ToolOptionsPanel";
import { toolShowsBrushControls } from "../../features/options/toolOptionSchema";
import { useEditorToolId } from "../../hooks/useEditor";
import { OptionsRegion } from "./OptionsRegion";
import { ToolBadge } from "./ToolBadge";

/** The controls a toolbar's arrow keys may land on. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The controls that own the arrow keys themselves. */
const EDITABLE = new Set(["range", "number", "text", "search", "email", "url"]);

export function OptionsBar() {
  const toolId = useEditorToolId();

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (
      target instanceof HTMLInputElement &&
      EDITABLE.has(target.type)
    ) {
      return;
    }
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((control) => control.getClientRects().length > 0);
    const index = target ? controls.indexOf(target) : -1;
    if (index < 0) {
      return;
    }
    const next = event.key === "ArrowRight" ? index + 1 : index - 1;
    if (next < 0 || next >= controls.length) {
      return;
    }
    event.preventDefault();
    controls[next].focus();
  };

  return (
    <div
      className="options-bar"
      role="toolbar"
      aria-label="Tool options"
      onKeyDown={onKeyDown}
    >
      <ToolBadge />
      <OptionsRegion>
        <ToolOptionsPanel />
        <GradientControls />
        {toolShowsBrushControls(toolId) ? (
          <>
            <div className="toolbar__divider" />
            <BrushControls />
          </>
        ) : null}
      </OptionsRegion>
      <div className="options-bar__aside">
        <ColorControls />
      </div>
    </div>
  );
}
