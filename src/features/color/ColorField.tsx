/**
 * The wheel's colour field.
 *
 * A thin wrapper around the shared {@link ColorTextField}: the field is a
 * view of the brush colour, and the brush is the one place a colour lives.
 */

import { useEditor, useEditorState } from "../../hooks/useEditor";
import { ColorTextField } from "./ColorTextField";

export function ColorField() {
  const { actions } = useEditor();
  const { brush } = useEditorState();

  return (
    <ColorTextField
      value={brush.color}
      label="Colour value"
      inputClassName="color-wheel__input"
      onCommit={(color) => actions.setBrush({ color })}
    />
  );
}
