/**
 * The zoom field: a precise, editable zoom readout.
 *
 * The field shows the *actual* zoom of the canvas - the same number the
 * viewport holds - and it accepts a typed one: `150`, `150%` or `1.5x`. A
 * value the canvas cannot show is clamped to the range the viewport supports
 * rather than refused, so the field always ends up showing a real zoom.
 *
 * While the field has the focus it shows what the user is typing; when it
 * loses the focus it goes back to the canvas' own zoom. Enter commits and
 * releases the focus, Escape throws the typing away.
 */

import { useRef, useState } from "react";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import {
  MAX_ZOOM_PERCENT,
  MIN_ZOOM_PERCENT,
  parseZoomPercent,
  zoomPercentText,
} from "./viewNavigation";
import "./view.css";

export function ZoomField() {
  const { actions } = useEditor();
  const { viewport } = useEditorState();
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Escape asks for the typing to be thrown away, and the blur that follows
  // must not commit it. The flag travels with the intent, because the blur
  // event runs before React has the new state.
  const cancelledRef = useRef(false);

  const text = draft ?? zoomPercentText(viewport.zoom);

  const commit = (): void => {
    const cancelled = cancelledRef.current;
    cancelledRef.current = false;
    if (cancelled) {
      // The typing was thrown away: the field goes back to the canvas' zoom.
      setDraft(null);
      return;
    }
    if (draft !== null) {
      const zoom = parseZoomPercent(draft);
      if (zoom !== null) {
        actions.zoomTo(zoom);
      }
      setDraft(null);
    }
    inputRef.current?.blur();
  };

  const cancel = (): void => {
    cancelledRef.current = true;
    setDraft(null);
    inputRef.current?.blur();
    // The blur above runs the commit, which consumes the flag. If the field
    // was not focused there was no blur, so the flag is dropped here.
    cancelledRef.current = false;
  };

  return (
    <span className="zoom-field">
      <input
        className="zoom-field__input"
        ref={inputRef}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        size={5}
        aria-label="Zoom percentage"
        title={`Zoom: type a percentage (150) or a factor (1.5x) and press Enter. Between ${MIN_ZOOM_PERCENT}% and ${MAX_ZOOM_PERCENT}%.`}
        value={text}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        onBlur={commit}
      />
      <span className="zoom-field__unit" aria-hidden="true">
        %
      </span>
    </span>
  );
}
