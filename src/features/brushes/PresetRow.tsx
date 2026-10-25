/**
 * One tile of the brush library.
 *
 * The library is a grid of square thumbnails, as a paint program's preset
 * chooser is: the picture is the brush, and the name is the tooltip and the
 * button's accessible name rather than a caption under every tile. Two states
 * are drawn on the tile itself - the brush in effect and the tile the keyboard
 * is on - and two marks sit in its corners: the star the user gave the brush
 * and the dot that says the live brush has been changed since the preset was
 * applied.
 *
 * The star is the user's own note about the brush, so it is a button of its
 * own rather than part of the tile's press. It is pinned to the corner and
 * shown while the tile is under the pointer or the keyboard, or while the
 * brush is starred, so a grid of unstarred brushes stays a grid of pictures.
 *
 * Every brush has an icon. A built-in brush shows the picture drawn for it by
 * hand; a saved one - a Krita preset or the user's own - is drawn from its
 * settings, in the same frame and the same manner, so the grid reads as one
 * set and a tile says what kind of brush it is before it is applied.
 */

import { useMemo } from "react";
import { describePreset } from "../../core/brushes/presetBrowser";
import type { BrushPreset } from "../../core/brushes/presets";
import { BrushIcon } from "./BrushIcon";
import { brushIconForPreset } from "./brushIconFromBrush";

export interface PresetRowProps {
  readonly preset: BrushPreset;
  /** Whether the brush is one of the built-in ones. */
  readonly bundled: boolean;
  /** Whether the tile is the one the keyboard is on. */
  readonly selected: boolean;
  /** Whether the brush is the one in effect. */
  readonly current: boolean;
  /** Whether the brush has been changed since the preset was applied. */
  readonly edited: boolean;
  /** Whether the brush is starred. */
  readonly favorite: boolean;
  /** The tile was picked: the brush is applied to the live brush. */
  readonly onSelect: (id: string) => void;
  /** The star was pressed. */
  readonly onToggleFavorite: (id: string) => void;
}

export function PresetRow({
  preset,
  bundled,
  selected,
  current,
  edited,
  favorite,
  onSelect,
  onToggleFavorite,
}: PresetRowProps) {
  const description = describePreset(preset);
  const icon = useMemo(() => brushIconForPreset(preset), [preset]);
  const title = bundled
    ? `${preset.name} - ${description} (built-in)`
    : `${preset.name} - ${description}`;
  // The tile draws no text, so its name has to come from the button.
  const label = bundled ? `${preset.name} (built-in brush)` : preset.name;

  const className = [
    "brush-tile",
    selected ? "is-selected" : "",
    current ? "is-current" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={className} data-built-in={bundled ? "true" : undefined}>
      <button
        type="button"
        className="brush-tile__pick"
        title={title}
        aria-label={label}
        aria-current={current ? "true" : undefined}
        onClick={() => onSelect(preset.id)}
      >
        <BrushIcon icon={icon} />
      </button>
      {edited ? (
        <span
          className="brush-tile__edited"
          title="The brush has changed since this preset was applied"
          aria-hidden="true"
        >
          •
        </span>
      ) : null}
      <button
        type="button"
        className="brush-tile__star"
        aria-label={favorite ? `Unstar ${preset.name}` : `Star ${preset.name}`}
        aria-pressed={favorite}
        title={favorite ? `Unstar ${preset.name}` : `Star ${preset.name}`}
        onClick={() => onToggleFavorite(preset.id)}
      >
        {favorite ? "★" : "☆"}
      </button>
    </li>
  );
}
