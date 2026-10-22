/**
 * The colour text field: type or paste a colour, press Enter.
 *
 * It is a *view* of a colour with a local draft, not a second source of
 * truth. While the field has focus the draft is the user's; on commit the
 * text is resolved by `resolveColorInput` and the colour is handed to the
 * caller, which writes it through the same path the wheel, the swatches and
 * the canvas picker use - so a colour entered here moves the wheel and
 * becomes the next stroke's ink.
 *
 * Two things can be refused, and the field says which: text that is not a
 * colour, and a colour that is not opaque (see `colorInput.ts` for why a
 * translucent colour is refused rather than quietly stored opaque). Either
 * way the field reverts to the colour the editor actually holds, so it never
 * shows a value the app is not using.
 *
 * Pasting a value that the field has to normalise - `hsl()` or `oklch()`, say
 * - rewrites the draft to the `#rrggbb` the editor now stores, so the field
 * always ends up showing what is actually painted.
 */

import { useState } from "react";
import type { KeyboardEvent } from "react";
import { resolveColorInput } from "./colorInput";

export interface ColorTextFieldProps {
  /** The colour the editor currently holds; a refusal reverts to it. */
  readonly value: string;
  /** Called with a resolved `#rrggbb` when the text is accepted. */
  readonly onCommit: (color: string) => void;
  /** The accessible name of the field. */
  readonly label: string;
  /** Extra class for the wrapper, for the panel that owns the field. */
  readonly className?: string;
  /** Extra class for the input itself. */
  readonly inputClassName?: string;
  /** The id of the input, when a `<label>` points at it. */
  readonly id?: string;
}

export function ColorTextField({
  value,
  onCommit,
  label,
  className,
  inputClassName,
  id,
}: ColorTextFieldProps) {
  const [draft, setDraft] = useState(value);
  const [observed, setObserved] = useState(value);
  const [message, setMessage] = useState<string | null>(null);

  // The editor's colour is the authority. When it changes and this field did
  // not write the change - the wheel, a swatch, the canvas picker - the draft
  // is stale, so it is reconciled here, during the render.
  if (observed !== value) {
    setObserved(value);
    setDraft(value);
    setMessage(null);
  }

  const commit = () => {
    const outcome = resolveColorInput(draft, value);
    if (outcome.kind === "applied") {
      setDraft(outcome.color);
      setObserved(outcome.color);
      setMessage(null);
      onCommit(outcome.color);
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
      setDraft(value);
      setMessage(null);
    }
  };

  const wrapperClass = ["color-field", className].filter(Boolean).join(" ");
  const inputClass = ["text-input", "color-field__input", inputClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapperClass}>
      <input
        id={id}
        className={inputClass}
        type="text"
        value={draft}
        spellCheck={false}
        autoComplete="off"
        aria-label={label}
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
        <span className="color-field__message" role="status">
          {message}
        </span>
      )}
    </div>
  );
}
