/** A single row in the layers panel: visibility, name (double-click to rename). */

import { useState } from "react";
import { IconEye, IconEyeOff } from "../../components/icons";
import type { Layer } from "../../core/document/types";

export interface LayerRowProps {
  readonly layer: Layer;
  readonly active: boolean;
  readonly onSelect: () => void;
  readonly onToggleVisibility: () => void;
  readonly onRename: (name: string) => void;
}

export function LayerRow({ layer, active, onSelect, onToggleVisibility, onRename }: LayerRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(layer.name);

  const startEditing = () => {
    setDraft(layer.name);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== "" && trimmed !== layer.name) {
      onRename(trimmed);
    }
  };

  const className = ["layer-row", active ? "is-active" : ""].filter(Boolean).join(" ");

  return (
    <li className={className}>
      <button
        type="button"
        className="layer-row__visibility"
        aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
        aria-pressed={layer.visible}
        onClick={onToggleVisibility}
      >
        {layer.visible ? <IconEye /> : <IconEyeOff />}
      </button>
      {editing ? (
        <input
          className="layer-row__input"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- rename is an
          // explicit user gesture (double-click), so focusing is expected.
          autoFocus
          value={draft}
          aria-label="Layer name"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit();
            } else if (event.key === "Escape") {
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="layer-row__name"
          title={`${layer.name} — double-click to rename`}
          onClick={onSelect}
          onDoubleClick={startEditing}
        >
          <span className="layer-row__title">{layer.name}</span>
          <span className="layer-row__opacity">{Math.round(layer.opacity * 100)}%</span>
        </button>
      )}
    </li>
  );
}
