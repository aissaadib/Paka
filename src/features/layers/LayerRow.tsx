/**
 * A single row in the layers panel.
 *
 * The row is the panel's unit of everything: it shows whether the layer is the
 * active one, whether it is hidden, and it carries the three controls an
 * artist reaches for - the visibility toggle, the name and the opacity.
 *
 * The row is a *view*: it never changes the document itself. Every control
 * calls back into the panel, which issues an engine command, so every change
 * is undoable and a layer can never be lost by a stray click.
 */

import { useEffect, useRef, useState } from "react";
import type { DragEvent, FocusEvent } from "react";
import { IconEye, IconEyeOff } from "../../components/icons";
import type { Layer } from "../../core/document/types";

export interface LayerRowProps {
  readonly layer: Layer;
  /** The layer the engine draws into. */
  readonly active: boolean;
  /** The row the keyboard is on. Focus is not the same as selection. */
  readonly focused: boolean;
  /** The row being dragged. */
  readonly dragging: boolean;
  /** The row is being renamed. */
  readonly renaming: boolean;
  /** The name being typed, while renaming. */
  readonly draft: string;
  /** How many elements the layer holds. */
  readonly elementCount: number;
  readonly onSelect: () => void;
  readonly onToggleVisibility: () => void;
  readonly onFocus: () => void;
  readonly onBlur: (event: FocusEvent<HTMLLIElement>) => void;
  readonly onStartRename: () => void;
  readonly onDraftChange: (draft: string) => void;
  readonly onCommitRename: () => void;
  readonly onCancelRename: () => void;
  readonly onOpacityChange: (opacity: number) => void;
  readonly onDragStart: (event: DragEvent<HTMLElement>) => void;
  readonly onDragEnd: () => void;
  readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
  readonly onDrop: (event: DragEvent<HTMLElement>) => void;
  /** Registers the row's name button so the panel can move the focus. */
  readonly registerNameButton: (element: HTMLButtonElement | null) => void;
}

export function LayerRow({
  layer,
  active,
  focused,
  dragging,
  renaming,
  draft,
  elementCount,
  onSelect,
  onToggleVisibility,
  onFocus,
  onBlur,
  onStartRename,
  onDraftChange,
  onCommitRename,
  onCancelRename,
  onOpacityChange,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  registerNameButton,
}: LayerRowProps) {
  const [opacityOpen, setOpacityOpen] = useState(false);
  const [opacityDraft, setOpacityDraft] = useState(Math.round(layer.opacity * 100));
  const rowRef = useRef<HTMLLIElement | null>(null);

  // The draft follows the layer while the editor is closed, so an opacity
  // changed elsewhere - the panel's slider, an undo - is not overwritten by a
  // stale number.
  useEffect(() => {
    if (!opacityOpen) {
      setOpacityDraft(Math.round(layer.opacity * 100));
    }
  }, [layer.opacity, opacityOpen]);

  const percent = Math.round(layer.opacity * 100);
  const items = elementCount === 1 ? "item" : "items";

  const className = [
    "layer-row",
    active ? "is-active" : "",
    focused ? "is-focused" : "",
    dragging ? "is-dragging" : "",
    layer.visible ? "" : "is-hidden",
  ]
    .filter(Boolean)
    .join(" ");

  const commitOpacity = () => {
    setOpacityOpen(false);
    const next = Math.min(100, Math.max(0, opacityDraft));
    if (next !== percent) {
      onOpacityChange(next / 100);
    }
  };

  return (
    <li
      ref={rowRef}
      className={className}
      onFocus={onFocus}
      onBlur={onBlur}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <span
        className="layer-row__grip"
        draggable
        aria-hidden="true"
        onDragStart={(event) => {
          // The handle is eight pixels wide; the row is what the artist sees
          // being carried around.
          if (rowRef.current) {
            event.dataTransfer.setDragImage(rowRef.current, 12, 12);
          }
          onDragStart(event);
        }}
      />
      <button
        type="button"
        className="layer-row__visibility"
        aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
        aria-pressed={layer.visible}
        onClick={onToggleVisibility}
      >
        {layer.visible ? <IconEye /> : <IconEyeOff />}
      </button>
      {renaming ? (
        <input
          className="layer-row__input"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- rename is an
          // explicit user gesture (double-click or F2), so focusing is expected.
          autoFocus
          value={draft}
          aria-label="Layer name"
          onChange={(event) => onDraftChange(event.target.value)}
          onBlur={onCommitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onCommitRename();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancelRename();
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="layer-row__name"
          ref={registerNameButton}
          aria-current={active ? "true" : undefined}
          title={`${layer.name} - ${elementCount} ${items}. Double-click to rename.`}
          onClick={onSelect}
          onDoubleClick={onStartRename}
        >
          <span className="layer-row__title">{layer.name}</span>
          {layer.blendMode === "normal" ? null : (
            <span className="layer-row__blend" aria-label={`Blend mode ${layer.blendMode}`}>
              {BLEND_BADGES[layer.blendMode] ?? ""}
            </span>
          )}
        </button>
      )}
      {opacityOpen ? (
        <input
          className="layer-row__opacity-input"
          type="number"
          min={0}
          max={100}
          step={5}
          value={opacityDraft}
          aria-label={`Opacity of ${layer.name}, in percent`}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) {
              setOpacityDraft(next);
            }
          }}
          onBlur={commitOpacity}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitOpacity();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpacityDraft(percent);
              setOpacityOpen(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="layer-row__opacity"
          aria-label={`Opacity of ${layer.name}: ${percent} percent. Click to change.`}
          title={`Opacity ${percent}%`}
          onClick={() => {
            setOpacityDraft(percent);
            setOpacityOpen(true);
          }}
        >
          {percent}%
        </button>
      )}
    </li>
  );
}

/**
 * The two-letter badge a non-normal blend mode gets in the row.
 *
 * The row is narrow, so the mode is a badge rather than a word; the full name
 * is in the panel's blend selector and in the row's tooltip.
 */
const BLEND_BADGES: Readonly<Record<string, string>> = {
  multiply: "MU",
  screen: "SC",
  overlay: "OV",
  "soft-light": "SL",
  "hard-light": "HL",
  "color-dodge": "CD",
  darken: "DK",
  lighten: "LT",
  difference: "DF",
  exclusion: "EX",
};
