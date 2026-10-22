/**
 * Ruler controls.
 *
 * One switch, in the toolbar beside the grid controls: the rulers measure the
 * view, so they belong with the other view aids rather than with the active
 * tool's options.
 *
 * The rulers are **display-only**: they are painted on the display canvas
 * above the artwork, so they never appear in an export or in a saved project.
 * The switch is remembered in the per-user settings file, like the grid's.
 *
 * With the rulers on, the **guides** tool can pull a guide straight out of a
 * ruler: the top ruler measures x and makes a vertical guide, the left ruler
 * measures y and makes a horizontal one.
 */

import { useEditor, useEditorState } from "../../hooks/useEditor";

export function RulerControls() {
  const { actions } = useEditor();
  const { rulersVisible } = useEditorState();

  return (
    <label className="toggle" title="Show the rulers along the top and left edges (Ctrl+Alt+R)">
      <input
        type="checkbox"
        checked={rulersVisible}
        onChange={(event) => actions.setRulersVisible(event.target.checked)}
      />
      Rulers
    </label>
  );
}
