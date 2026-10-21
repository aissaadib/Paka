/**
 * Shape options: how a shape is filled, and how a polygon or a star is shaped.
 *
 * The **Fill shape** switch is shown only while the active tool's shapes bound
 * an area (`fillable`), because the setting has no meaning for a brush, an
 * eraser or a line. It switches the shape tools from an outline to a solid
 * silhouette - the outline is still traced, so the edge stays where an unfilled
 * shape's edge was, and the interior takes the brush colour.
 *
 * The polygon and the star get three more sliders, shown only for those two
 * tools: how many sides (or points) the shape has, how deep the star's valleys
 * are, and how far the outline is turned about its centre. One number serves
 * both tools, so the label follows the active one.
 *
 * Like the fill switch, all four describe the *next* shape: changing one is
 * not an edit, and the shape keeps the values that were active when it was
 * drawn.
 */

import { SliderField } from "../../components/toolbar/SliderField";
import { getToolDefinition } from "../../core/tools/toolDefinitions";
import {
  MAX_SHAPE_INNER_RATIO,
  MAX_SHAPE_SIDES,
  MIN_SHAPE_INNER_RATIO,
  MIN_SHAPE_SIDES,
  SHAPE_INNER_RATIO_STEP,
} from "../../core/tools/shapeGeometry";
import { useEditor, useEditorState } from "../../hooks/useEditor";

export function ShapeControls() {
  const { actions } = useEditor();
  const { toolId, shapeFill, shapeSides, shapeInnerRatio, shapeRotation } = useEditorState();

  const fillable = getToolDefinition(toolId).fillable === true;
  const isStar = toolId === "star";
  const isPolygon = toolId === "polygon";
  const shaped = isStar || isPolygon;

  if (!fillable && !shaped) {
    return null;
  }

  return (
    <>
      {shaped ? (
        <>
          <div className="toolbar__divider" />
          <div className="toolbar__group">
            <SliderField
              label={isStar ? "Points" : "Sides"}
              min={MIN_SHAPE_SIDES}
              max={MAX_SHAPE_SIDES}
              step={1}
              value={shapeSides}
              title={
                isStar
                  ? "How many points the next star has"
                  : "How many sides the next polygon has"
              }
              onChange={(value) => actions.setShapeSides(value)}
            />
            {isStar ? (
              <SliderField
                label="Inner radius"
                min={MIN_SHAPE_INNER_RATIO}
                max={MAX_SHAPE_INNER_RATIO}
                step={SHAPE_INNER_RATIO_STEP}
                value={shapeInnerRatio}
                format={(value) => `${Math.round(value * 100)}%`}
                title="How deep the star's valleys reach, as a fraction of its outer radius"
                // Snapped to the step, so the number box and the slider's
                // thumb can never show two different ratios.
                onChange={(value) =>
                  actions.setShapeInnerRatio(
                    Math.round(value / SHAPE_INNER_RATIO_STEP) * SHAPE_INNER_RATIO_STEP,
                  )
                }
              />
            ) : null}
            <SliderField
              label="Rotation"
              min={0}
              max={360}
              step={1}
              value={shapeRotation}
              format={(value) => `${Math.round(value)}°`}
              title="Turn the outline about the centre of the dragged box"
              onChange={(value) => actions.setShapeRotation(value)}
            />
          </div>
        </>
      ) : null}
      {fillable ? (
        <>
          <div className="toolbar__divider" />
          <div className="toolbar__group">
            <label
              className="toggle"
              title="Fill the shape's interior instead of tracing just its outline"
            >
              <input
                type="checkbox"
                checked={shapeFill}
                onChange={(event) => actions.setShapeFill(event.target.checked)}
              />
              Fill shape
            </label>
          </div>
        </>
      ) : null}
    </>
  );
}
