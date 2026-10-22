/**
 * The brush controls: the preset picker, the live preview and the properties.
 *
 * The properties are not written out here. They come from the options schema,
 * the same table the rest of the options bar is built from, so the brush group
 * shows exactly the fields the active tool consumes - a shape has no
 * stabilizer and no dab spacing, and a control that changes nothing is worse
 * than no control at all - and every one of them writes through `setBrush`,
 * which is the path the colour picker and the preset picker use too.
 *
 * The two things that are not schema fields live here: the preset picker and
 * the pressure curve, which are widgets rather than fields, and the preview
 * and the reset button, which are about the brush as a whole.
 */

import { useState } from "react";
import { brushSettingsEqual, DEFAULT_BRUSH } from "../../core/brushes/defaults";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { useWorkspaceSettings } from "../../hooks/useWorkspace";
import { OptionControl } from "../options/OptionControl";
import { toolOptionFields } from "../options/toolOptionSchema";
import { BrushPresets } from "./BrushPresets";
import { BrushPreview } from "./BrushPreview";
import { PressureCurveEditor } from "./PressureCurveEditor";

export function BrushControls() {
  const { actions } = useEditor();
  const snapshot = useEditorState();
  const workspace = useWorkspaceSettings();
  const [curveOpen, setCurveOpen] = useState(false);
  const allFields = toolOptionFields("brush", snapshot.toolId, snapshot);
  // The compact brush panel keeps the size and the opacity - the two
  // properties a brush is judged by - and leaves the rest to the options
  // strip. The choice is a workspace preference, so it survives a restart.
  const fields = workspace.brushPanel.advanced
    ? allFields
    : allFields.filter(
        (option) => option.id === "brushSize" || option.id === "brushOpacity",
      );
  const pressureEnabled =
    snapshot.brush.pressureSize > 0 || snapshot.brush.pressureOpacity > 0;

  // The preset the brush is based on, if there is one. It holds the preset's
  // defaults, which stay apart from the edited values the next stroke uses.
  const origin =
    snapshot.activePresetId === null
      ? null
      : (snapshot.presets.find((preset) => preset.id === snapshot.activePresetId) ?? null);

  // What the reset restores: the preset's own values, or the default brush.
  // When the brush already holds them there is nothing to restore, so the
  // button says so by being disabled.
  const resetTarget = origin?.brush ?? DEFAULT_BRUSH;
  const canReset = !brushSettingsEqual(snapshot.brush, resetTarget);

  return (
    <div className="toolbar__group brush-controls">
      {workspace.brushPanel.presets ? <BrushPresets /> : null}
      <BrushPreview />
      {fields.map((option) => (
        <OptionControl
          key={option.id}
          option={option}
          snapshot={snapshot}
          actions={actions}
        />
      ))}
      {workspace.brushPanel.advanced && pressureEnabled ? (
        <button
          type="button"
          className="pressure-curve__toggle"
          aria-expanded={curveOpen}
          title="Shape how raw pen pressure maps to the size and opacity response"
          onClick={() => setCurveOpen((open) => !open)}
        >
          Pressure curve
        </button>
      ) : null}
      {workspace.brushPanel.advanced && pressureEnabled && curveOpen ? (
        <PressureCurveEditor />
      ) : null}
      <button
        type="button"
        className="button brush-controls__reset"
        disabled={!canReset}
        title={
          origin === null
            ? "Restore the default brush"
            : `Restore the brush to the defaults of "${origin.name}"`
        }
        onClick={actions.resetBrush}
      >
        Reset
      </button>
    </div>
  );
}
