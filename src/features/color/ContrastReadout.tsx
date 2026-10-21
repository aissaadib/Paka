/**
 * The contrast and colour-difference readout.
 *
 * Two numbers about the brush colour, both computed from state that already
 * exists: the WCAG 2.2 contrast ratio between the ink and the document's
 * paper, and the palette swatch that is perceptually closest to the ink.
 *
 * It is a **read-only view**. It adds no control, no document state, no
 * history entry and no dirty flag, and it never writes a colour: the ink it
 * measures is the brush colour, which the wheel, the toolbar's colour input,
 * the swatches and the canvas picker all write through the same `setBrush`
 * path, so the readout follows a colour chosen anywhere.
 *
 * A colour that is not a hex colour - a project file may hold any non-empty
 * string as a colour - is not measured and not guessed at: the readout says
 * that it does not know, and says why.
 *
 * The arithmetic lives in `src/utils/colorMetrics.ts`, which is DOM-free and
 * tested; this file is the presentation of its result.
 */

import { useEditorState } from "../../hooks/useEditor";
import {
  CONTRAST_BAND_LABELS,
  UNKNOWN_REASONS,
  formatContrastRatio,
  formatDeltaE,
  formatSpokenRatio,
  measureColor,
} from "../../utils/colorMetrics";
import { PALETTE } from "./palette";

/** The word shown in place of a number the readout does not have. */
const UNKNOWN = "unknown";

export function ContrastReadout() {
  const state = useEditorState();
  const report = measureColor(
    state.brush.color,
    state.document.background,
    PALETTE,
  );
  const { ratio, band, nearest, ratioReason, nearestReason } = report;

  return (
    <div className="color-readout">
      <div className="color-readout__row">
        <span className="color-readout__label">Contrast on paper</span>
        <span className="color-readout__line">
          {ratio === null || band === null ? (
            <>
              <span className="color-readout__value color-readout__value--unknown">
                {UNKNOWN}
              </span>
              <span className="color-readout__note">
                {ratioReason === null ? "" : UNKNOWN_REASONS[ratioReason]}
              </span>
            </>
          ) : (
            <>
              <span className="color-readout__value">
                {/* The visible form is the conventional one; the spoken form
                    is what a screen reader reads, because "17.8:1" would be
                    announced as "seventeen point eight colon one". */}
                <span aria-hidden="true">{formatContrastRatio(ratio)}</span>
                <span className="color-readout__spoken">
                  {formatSpokenRatio(ratio)}
                </span>
              </span>
              <span className="color-readout__note">
                {CONTRAST_BAND_LABELS[band]}
              </span>
            </>
          )}
        </span>
      </div>

      <div className="color-readout__row">
        <span className="color-readout__label">Closest swatch</span>
        <span className="color-readout__line">
          {nearest === null ? (
            <>
              <span className="color-readout__value color-readout__value--unknown">
                {UNKNOWN}
              </span>
              <span className="color-readout__note">
                {nearestReason === null ? "" : UNKNOWN_REASONS[nearestReason]}
              </span>
            </>
          ) : (
            <>
              <span
                className="color-readout__chip"
                style={{ background: nearest.hex }}
                aria-hidden="true"
              />
              <span className="color-readout__value">{nearest.hex}</span>
              <span className="color-readout__note">
                ΔE {formatDeltaE(nearest.deltaE)}
              </span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
