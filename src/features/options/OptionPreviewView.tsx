/**
 * The picture a control shows beside itself.
 *
 * The core layer says which picture belongs to a control
 * (`core/options/optionPreviews.ts`); this component draws it.
 *
 * The kinds are exhausted in one place - the table below - so a kind the core
 * layer gains without a picture to draw it is a compile error rather than a
 * blank space in the bar.
 */

import type { ReactElement } from "react";
import { BrushTipPreview } from "../brushes/BrushTipPreview";
import type { OptionPreview, OptionPreviewKind } from "../../core/options/optionPreviews";

/**
 * The swatch's width, in CSS pixels.
 *
 * The toolbar's own control height: the swatch sits in a row of controls, so
 * it is as tall as they are rather than a picture that doubles the row.
 */
export const OPTION_PREVIEW_CSS_SIZE = 24;

export interface OptionPreviewViewProps {
  /** The picture to draw. */
  readonly preview: OptionPreview;
}

/** The picture each kind is drawn by. */
const PREVIEW_VIEWS: {
  readonly [K in OptionPreviewKind]: (
    preview: Extract<OptionPreview, { kind: K }>,
  ) => ReactElement;
} = {
  brushTip: (preview) => (
    <BrushTipPreview
      tip={preview.tip}
      label={preview.label}
      size={OPTION_PREVIEW_CSS_SIZE}
    />
  ),
};

/** Draws the picture a control shows beside itself. */
export function OptionPreviewView({ preview }: OptionPreviewViewProps): ReactElement {
  return PREVIEW_VIEWS[preview.kind](preview);
}
