/**
 * The colour panel's text field: type or paste a colour, press Enter.
 *
 * It is a *view* of the brush colour with a local draft, not a second source
 * of truth. While the field has focus the draft is the user's; on commit the
 * text is resolved by `resolveColorInput` and the brush is set through the
 * same `setBrush` path the wheel, the swatches and the canvas picker use, so
 * a colour entered here moves the wheel and becomes the next stroke's ink.
 *
 * Two things can be refused, and the field says which: text that is not a
 * colour, and a colour that is not opaque (see `colorInput.ts` for why a
 * translucent colour is refused rather than quietly stored opaque). Either
 * way the field reverts to the colour the brush holds, so it never shows a
 * value the app is not using.
 *
 * Pasting a value that the field has to normalise - `hsl()` or `oklch()`, say
 * - rewrites the draft to the `#rrggbb` the brush now stores, so the field
 * always ends up showing what is actually painted.
 */

import { useState } from "react";
import type { KeyboardEvent } from "react";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { resolveColorInput } from "./colorInput";

export function ColorField() {
  const { actions } = useEditor();
  const { brush } = useEditorState();

  const [draft, setDraft] = useState(brush.color);
  const [observed, setObserved] = useState(brush.color);
  const [message, setMessage] = useState<string | null>(null);

  // The brush colour is the authority. When it changes and this field did not
  // write the change - the wheel, a swatch, the canvas picker - the draft is
  // stale, so it is reconciled here, during the render.
  if (observed !== brush.color) {
    setObserved(brush.color);
    setDraft(brush.color);
    setMessage(null);
  }

  const commit = () => {
    const outcome = resolveColorInput(draft, brush.color);
    if (outcome.kind === "applied") {
      setDraft(outcome.color);
      setObserved(outcome.color);
      setMessage(null);
      actions.setBrush({ color: outcome.color });
      return;
    }
    // A refusal reverts to the last valid colour and says why.
    setDraft(outcome.color);
    setMessage(outcome.message);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(brush.color);
      setMessage(null);
    }
  };

  return (
    <div className="color-wheel__entry">
      <input
        className="text-input color-wheel__input"
        type="text"
        value={draft}
        spellCheck={false}
        autoComplete="off"
        aria-label="Colour value"
        aria-invalid={message !== null}
        title="Hex, hsl() or oklch() - press Enter to apply"
        onChange={(event) => {
          setDraft(event.target.value);
          setMessage(null);
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {message === null ? null : (
        <span className="color-wheel__message" role="status">
          {message}
        </span>
      )}
    </div>
  );
}
