/**
 * The contrast and colour-difference readout.
 *
 * The panel shows two numbers for the **same pair** of colours: the WCAG 2.2
 * contrast ratio and the CIEDE2000 perceptual difference. The first colour is
 * the brush ("Ink"); the second is a comparison colour that starts as the
 * document's paper and can be changed with the colour input beside it. So the
 * default view still answers "does this ink read on this paper?", and the
 * comparison answers "are these two swatches actually different?".
 *
 * The readout is **read-only with respect to the document**: changing the ink
 * calls the same `setBrush` path as the wheel and the swatches, so it is
 * session state for the next stroke, not an edit. Nothing here writes the
 * document, pushes history or marks it dirty.
 *
 * A colour that is not a solid hex colour - a project file may hold any
 * non-empty string, and the colour field refuses alpha - is not measured and
 * not guessed at. The readout says which side failed and why.
 *
 * The arithmetic lives in `colorPair.ts` and `colorMetrics.ts`, both DOM-free
 * and tested; this file is the presentation of their result.
 */

import { useState } from "react";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { colorInputValue } from "../../utils/color";
import {
  UNKNOWN_REASONS,
  formatContrastRatio,
  formatDeltaE,
  formatSpokenRatio,
  measureColor,
} from "../../utils/colorMetrics";
import { compareColorPair, describeColorIssue } from "../../utils/colorPair";
import type { ColorPairReport } from "../../utils/colorPair";

/** The word shown in place of a number the readout does not have. */
const UNKNOWN = "unknown";

/** Why a pair could not be measured, in words the panel can show. */
function pairFailure(pair: ColorPairReport): string {
  const reasons: string[] = [];
  if (pair.inkIssue !== null) {
    reasons.push(`Ink is ${describeColorIssue(pair.inkIssue)}.`);
  }
  if (pair.againstIssue !== null) {
    reasons.push(`Comparison is ${describeColorIssue(pair.againstIssue)}.`);
  }
  return reasons.length === 0 ? "The pair could not be measured." : reasons.join(" ");
}

export function ContrastReadout() {
  const { actions } = useEditor();
  const state = useEditorState();

  // `null` means "follow the paper": a comparison the user has not chosen
  // yet stays in step with the document. A chosen colour is explicit and
  // stays put when the paper changes.
  const [comparison, setComparison] = useState<string | null>(null);
  const against = comparison ?? state.document.background;

  const pair = compareColorPair(state.brush.color, against);
  // The closest swatch is looked for in the artist's own palette, so the
  // readout names a colour they can actually pick rather than one of ours.
  const paper = measureColor(
    state.brush.color,
    state.document.background,
    state.palette.map((swatch) => swatch.color),
  );

  return (
    <div className="color-readout">
      <div className="color-readout__header">
        <span className="color-readout__label">Compare colours</span>
        <button
          type="button"
          className="color-readout__reset"
          onClick={() => setComparison(null)}
          disabled={comparison === null}
          title="Compare with the document paper"
        >
          Paper
        </button>
      </div>

      <div className="color-readout__pair">
        <label className="color-readout__field">
          <span className="color-readout__field-label">Ink</span>
          <span
            className="color-readout__picker-wrap"
            style={{ backgroundColor: colorInputValue(state.brush.color) }}
          >
            <input
              className="color-readout__picker"
              type="color"
              value={colorInputValue(state.brush.color)}
              aria-label="Ink colour"
              onChange={(event) => actions.setBrush({ color: event.target.value })}
            />
          </span>
          <span className="color-readout__hex" title={state.brush.color}>
            {state.brush.color}
          </span>
        </label>
        <label className="color-readout__field">
          <span className="color-readout__field-label">Against</span>
          <span
            className="color-readout__picker-wrap"
            style={{ backgroundColor: colorInputValue(against) }}
          >
            <input
              className="color-readout__picker"
              type="color"
              value={colorInputValue(against)}
              aria-label="Comparison colour"
              onChange={(event) => setComparison(event.target.value)}
            />
          </span>
          <span className="color-readout__hex" title={against}>
            {against}
          </span>
        </label>
      </div>

      {pair.contrast === null || pair.deltaE === null || pair.guidance === null ? (
        <div className="color-readout__error" role="status">
          <span className="color-readout__value color-readout__value--unknown">
            Cannot measure
          </span>
          <span className="color-readout__note">{pairFailure(pair)}</span>
        </div>
      ) : (
        <>
          <div className="color-readout__row">
            <span className="color-readout__label">Contrast</span>
            <span className="color-readout__line">
              <span className="color-readout__value">
                {/* The visible form is the conventional one; the spoken form
                    is what a screen reader reads, because "17.8:1" would be
                    announced as "seventeen point eight colon one". */}
                <span aria-hidden="true">{formatContrastRatio(pair.contrast)}</span>
                <span className="color-readout__spoken">
                  {formatSpokenRatio(pair.contrast)}
                </span>
              </span>
              <span className="color-readout__note">{pair.guidance.label}</span>
            </span>
          </div>

          <div className="color-readout__row">
            <span className="color-readout__label">ΔE00</span>
            <span className="color-readout__line">
              <span className="color-readout__value">
                {formatDeltaE(pair.deltaE)}
              </span>
              <span className="color-readout__note">CIEDE2000</span>
            </span>
          </div>
        </>
      )}

      <p className="color-readout__hint">
        WCAG 2.2 text guidance, not an accessibility audit.
      </p>

      <div className="color-readout__row color-readout__row--secondary">
        <span className="color-readout__label">Closest swatch</span>
        <span className="color-readout__line">
          {paper.nearest === null ? (
            <>
              <span className="color-readout__value color-readout__value--unknown">
                {UNKNOWN}
              </span>
              <span className="color-readout__note">
                {paper.nearestReason === null
                  ? ""
                  : UNKNOWN_REASONS[paper.nearestReason]}
              </span>
            </>
          ) : (
            <>
              <span
                className="color-readout__chip"
                style={{ background: paper.nearest.hex }}
                aria-hidden="true"
              />
              <span className="color-readout__value">{paper.nearest.hex}</span>
              <span className="color-readout__note">
                ΔE {formatDeltaE(paper.nearest.deltaE)}
              </span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
