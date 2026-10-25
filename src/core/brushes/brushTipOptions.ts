/**
 * The brush tip's control in the options bar.
 *
 * The tip itself is the mask in `core/rendering/brushTip.ts`: a closed set of
 * five shapes a stamped dab is masked with. This module is the **control**
 * over that set - the list the user picks from, the write that reaches the
 * brush's own field, and the picture that shows what the tip does.
 *
 * Three rules hold here, and each of them is the reason this module exists
 * rather than a line in the toolbar:
 *
 * - the choices are the tip's shapes and **nothing else**. A shape this build
 *   does not know is refused, not drawn as the nearest thing;
 * - the write goes through `setBrush`, so the tip is **editor state**:
 *   choosing one is not an edit, it adds no history step and dirties nothing;
 * - the option is registered through the shared per-tool registry
 *   (`core/shell/toolOptions.ts`), so the options bar draws it with the same
 *   control every other select uses, and a feature that adds an option to a
 *   tool it does not own gets a control rather than a blank space.
 *
 * The control is visible when the brush stamps, because a tip masks a dab and
 * a brush that does not stamp has no dabs to mask. That is the same rule the
 * brush's own stamp properties follow.
 */

import {
  BRUSH_TIP_SHAPES,
  isBrushTipShape,
  normalizeBrushTip,
} from "../rendering/brushTip";
import {
  appendToolOptions,
  type SelectToolOption,
} from "../shell/toolOptions";
import {
  registerOptionPreview,
  type OptionPreview,
} from "../options/optionPreviews";
import type { BrushTipShape } from "../../types/brush";

/** The id the tip's control is registered under. */
export const BRUSH_TIP_OPTION_ID = "brushTip";

/**
 * The name each shape shows in the list.
 *
 * The map is exhaustive over the tip's shapes, so a shape added to the type
 * without a name here fails to compile rather than showing an empty entry.
 */
const TIP_LABELS: Record<BrushTipShape, string> = {
  round: "Round",
  felt: "Felt",
  chisel: "Chisel",
  blot: "Blot",
  bristle: "Bristle",
};

/** The closed set of shapes, as the list the control shows. */
export const BRUSH_TIP_CHOICES: readonly {
  readonly value: BrushTipShape;
  readonly label: string;
}[] = BRUSH_TIP_SHAPES.map((shape) => ({ value: shape, label: TIP_LABELS[shape] }));

/**
 * The tip's control: a list of the five shapes.
 *
 * The read is the brush's own tip, repaired to the round one when it is
 * something this build does not know - the same repair the brush's reader
 * makes, so the control and the engine cannot disagree about what the brush
 * is.
 */
export const brushTipOption: SelectToolOption = {
  id: BRUSH_TIP_OPTION_ID,
  kind: "select",
  label: "Tip",
  title: "The shape a stamped dab is masked with",
  choices: BRUSH_TIP_CHOICES,
  read: (snapshot) => normalizeBrushTip(snapshot.brush.tip),
  write: (actions, value) => {
    // A shape this build does not know is refused: the tip is a closed set,
    // and a value outside it is not something to draw.
    if (!isBrushTipShape(value)) {
      return;
    }
    // The brush's own field, through the one setter every brush control uses.
    // This is editor state: no history step, no dirty flag, nothing in the
    // project file.
    actions.setBrush({ tip: value });
  },
  visible: (snapshot) => snapshot.brush.stamp,
};

/**
 * The picture the tip's control shows beside itself.
 *
 * It is the tip's own mask, and `null` for a value that is not a shape this
 * build knows: a tip that cannot be drawn is not drawn as something else.
 */
export function brushTipPreview(value: string): OptionPreview | null {
  if (!isBrushTipShape(value)) {
    return null;
  }
  return {
    kind: "brushTip",
    tip: value,
    label: `${TIP_LABELS[value]} brush tip`,
  };
}

/**
 * Registers the tip's control and its preview.
 *
 * Registering is idempotent: the contract ignores an option whose id is
 * already registered for that tool, and the preview registry is keyed by the
 * same id.
 */
export function registerBrushTipOptions(): void {
  appendToolOptions("brush", [brushTipOption]);
  registerOptionPreview(BRUSH_TIP_OPTION_ID, brushTipPreview);
}

registerBrushTipOptions();
