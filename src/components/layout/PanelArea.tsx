/**
 * The panel dock: the column of panels on the right of the canvas.
 *
 * The dock is a stack of panels that scrolls when it is taller than the
 * window, so a panel added for one tool never squeezes the others out of
 * reach. The panels themselves belong to their features; the dock only says
 * where they sit and how they share the column.
 */

import { useEditorState } from "../../hooks/useEditor";
import { ColorPanel } from "../../features/color/ColorPanel";
import { GradientStopEditor } from "../../features/gradient/GradientStopEditor";
import { LayersPanel } from "../../features/layers/LayersPanel";
import { Panel } from "../panels/Panel";

export function PanelArea() {
  const { toolId } = useEditorState();

  return (
    <aside className="panel-area" aria-label="Panels">
      <ColorPanel />
      {toolId === "gradient" ? (
        <Panel title="Gradient">
          <GradientStopEditor />
        </Panel>
      ) : null}
      <LayersPanel />
    </aside>
  );
}
