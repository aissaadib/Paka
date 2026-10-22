/**
 * The "Brush settings" panel in the options bar.
 *
 * It is the only home of the advanced brush fields, so the bar can stay one
 * row tall while every setting remains one click away. The panel is the
 * shared popover primitive: it closes on Escape or a press outside, and it
 * gives the focus back to its trigger.
 */

import { Popover } from "../../components/toolbar/Popover";
import { BrushAdvancedControls } from "./BrushControls";

export function BrushAdvancedPopover() {
  return (
    <Popover
      label="Brush settings"
      title="Sampling, stabilizer, texture, the stamp and the pressure response"
      className="brush-advanced-panel"
      ariaLabel="Brush settings"
    >
      <BrushAdvancedControls />
    </Popover>
  );
}
