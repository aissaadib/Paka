/**
 * The palette: the swatches the artist keeps to hand.
 *
 * A swatch is a colour with a name. Clicking one paints with it; right
 * clicking one makes it the alt colour. **Add** saves the current ink as a
 * new swatch, the small cross on a swatch removes it, and double clicking a
 * swatch - or pressing `F2` on a focused one - renames it in place.
 *
 * The palette is editor preference, not document state: nothing here adds a
 * history entry, bumps the revision or dirties the drawing, and removing a
 * swatch never touches a stroke. The settings store persists the list, so the
 * palette is still there next time the app opens.
 *
 * The rules live in `core/color/palette.ts`, so the panel and the settings
 * reader agree on what a valid swatch is: a colour that is really a colour, a
 * name that is not empty, and names that stay distinct.
 */

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import type { PaletteSwatch } from "../../core/color/palette";
import {
  findSwatchByColor,
  MAX_PALETTE_SWATCHES,
  MAX_SWATCH_NAME_LENGTH,
} from "../../core/color/palette";
import { SwatchGrid } from "./SwatchGrid";

/** How many swatches sit on a row. */
const COLUMNS = 8;

export function PalettePanel() {
  const { actions } = useEditor();
  const { palette, brush } = useEditorState();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  // `Escape` cancels; the input then unmounts, and a blur that arrives with
  // it must not commit the name the artist just rejected.
  const cancelRename = useRef(false);

  useEffect(() => {
    if (renamingId !== null && renameInput.current !== null) {
      renameInput.current.focus();
      renameInput.current.select();
    }
  }, [renamingId]);

  const startRename = (swatch: PaletteSwatch) => {
    cancelRename.current = false;
    setMessage(null);
    setRenameDraft(swatch.name);
    setRenamingId(swatch.id);
  };

  const commitRename = () => {
    if (renamingId === null || cancelRename.current) {
      cancelRename.current = false;
      setRenamingId(null);
      return;
    }
    const renamed = actions.renamePaletteSwatch(renamingId, renameDraft);
    setRenamingId(null);
    // A refused rename - an empty name - is said out loud rather than
    // leaving the artist wondering why nothing happened.
    setMessage(renamed === null ? "A swatch needs a name." : null);
  };

  const onRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelRename.current = true;
      setRenamingId(null);
    }
  };

  const ink = brush.color;
  const alreadySaved = findSwatchByColor(palette, ink) !== null;
  const isFull = palette.length >= MAX_PALETTE_SWATCHES;

  return (
    <section className="color-palette" aria-labelledby="color-palette-title">
      <div className="color-palette__header">
        <h3 className="color-palette__title" id="color-palette-title">
          Palette
        </h3>
        <button
          type="button"
          className="color-palette__add"
          onClick={() => actions.addPaletteSwatch(ink)}
          disabled={alreadySaved || isFull}
          title={
            alreadySaved
              ? "This colour is already in the palette"
              : isFull
                ? "The palette is full"
                : `Save ${ink} as a swatch`
          }
        >
          Add ink
        </button>
      </div>

      {palette.length === 0 ? (
        <p className="color-palette__empty">
          No swatches yet. Save the current ink to start a palette.
        </p>
      ) : (
        <SwatchGrid
          items={palette}
          columns={COLUMNS}
          groupLabel="Palette"
          renderItem={(swatch) => {
            if (renamingId === swatch.id) {
              return (
                <div className="color-palette__cell" key={swatch.id}>
                  <input
                    className="color-palette__rename text-input"
                    ref={renameInput}
                    value={renameDraft}
                    maxLength={MAX_SWATCH_NAME_LENGTH}
                    aria-label={`Rename ${swatch.name}`}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={commitRename}
                    onKeyDown={onRenameKeyDown}
                  />
                </div>
              );
            }
            const isActive = swatch.color === ink;
            return (
              <div className="color-palette__cell" key={swatch.id}>
                <button
                  type="button"
                  className={
                    isActive
                      ? "swatch-grid__swatch is-active"
                      : "swatch-grid__swatch"
                  }
                  style={{ backgroundColor: swatch.color }}
                  aria-label={`${swatch.name}, ${swatch.color}`}
                  aria-current={isActive ? "true" : undefined}
                  title={`${swatch.name} (${swatch.color}) - double-click to rename, right-click: alt colour`}
                  data-swatch-focusable
                  onClick={() => actions.setBrush({ color: swatch.color })}
                  onDoubleClick={() => startRename(swatch)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    actions.setSecondaryColor(swatch.color);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "F2") {
                      event.preventDefault();
                      event.stopPropagation();
                      startRename(swatch);
                      return;
                    }
                    if (event.key === "Delete") {
                      event.preventDefault();
                      // The editor's own Delete removes the selected strokes;
                      // here the key removes the swatch, so it must not also
                      // reach the document.
                      event.stopPropagation();
                      actions.removePaletteSwatch(swatch.id);
                    }
                  }}
                />
                <button
                  type="button"
                  className="color-palette__remove"
                  aria-label={`Remove ${swatch.name} from the palette`}
                  title={`Remove ${swatch.name}`}
                  onClick={() => actions.removePaletteSwatch(swatch.id)}
                >
                  ×
                </button>
              </div>
            );
          }}
        />
      )}

      {message === null ? null : (
        <p className="color-palette__message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
