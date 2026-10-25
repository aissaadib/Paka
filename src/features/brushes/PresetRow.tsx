/**
 * One row of the brush library.
 *
 * The row shows the mark the brush paints, its name and the two states that
 * matter: whether it is the brush in effect, and whether the brush has been
 * changed since it was applied. The star is the user's own note about the
 * brush, so it is a button of its own rather than part of the name.
 *
 * The mark is drawn from the brush's own settings - its colour, its width,
 * its opacity, its soft edge and whether it is stamped - so a property that
 * changes a stroke changes the mark too. It is a mark, not a picture of a
 * stroke: the pixels a brush lays down are the renderer's business.
 *
 * A built-in brush shows its icon instead of the mark. The icon says what
 * kind of brush it is - a nib, a dab, a marker, an airbrush, a charcoal
 * stick, a stamp - which the settings cannot say on their own; a saved brush
 * has no icon, so it keeps its mark.
 */

import type { CSSProperties } from "react";
import { describePreset } from "../../core/brushes/presetBrowser";
import type { BrushPreset } from "../../core/brushes/presets";
import type { BrushSettings } from "../../types/brush";
import { BrushIcon } from "./BrushIcon";
import { brushIconForPreset } from "./brushIcons";

/** The largest the mark is drawn, in CSS pixels. */
const MAX_MARK_SIZE = 14;

/** The smallest the mark is drawn, in CSS pixels. */
const MIN_MARK_SIZE = 4;

/** The mark a brush paints, as inline styles. */
function markStyle(brush: BrushSettings): CSSProperties {
  const dot = Math.round(
    Math.min(MAX_MARK_SIZE, Math.max(MIN_MARK_SIZE, brush.size * 0.5)),
  );
  return {
    width: `${dot}px`,
    height: `${dot}px`,
    background: brush.color,
    opacity: brush.opacity,
    // A soft edge is a blurred edge, which is what the setting does to the
    // outside of the stroke.
    filter: brush.hardness < 1 ? `blur(${((1 - brush.hardness) * dot * 0.14).toFixed(2)}px)` : undefined,
    // A stamped brush paints a chain of dabs, so its mark is a row of dots.
    boxShadow: brush.stamp
      ? `${dot * 1.5}px 0 0 0 ${brush.color}, ${dot * 3}px 0 0 0 ${brush.color}`
      : undefined,
  };
}

export interface PresetRowProps {
  readonly preset: BrushPreset;
  /** Whether the brush is one of the built-in ones. */
  readonly bundled: boolean;
  /** Whether the row is the one the keyboard is on. */
  readonly selected: boolean;
  /** Whether the brush is the one in effect. */
  readonly current: boolean;
  /** Whether the brush has been changed since the preset was applied. */
  readonly edited: boolean;
  /** Whether the brush is starred. */
  readonly favorite: boolean;
  /** The row was picked: the brush is applied to the live brush. */
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
  const icon = bundled ? brushIconForPreset(preset.id) : null;
  const title = bundled
    ? `${preset.name} - ${description} (built-in)`
    : `${preset.name} - ${description}`;

  const className = [
    "brush-row",
    selected ? "is-selected" : "",
    current ? "is-current" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={className}>
      <button
        type="button"
        className="brush-row__pick"
        title={title}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(preset.id)}
      >
        {icon ? (
          <BrushIcon icon={icon} />
        ) : (
          <span className="brush-row__mark" style={markStyle(preset.brush)} aria-hidden="true" />
        )}
        <span className="brush-row__name">{preset.name}</span>
        {edited ? (
          <span
            className="brush-row__edited"
            title="The brush has changed since this preset was applied"
          >
            •
          </span>
        ) : null}
        {bundled ? (
          <span className="brush-row__builtin" title="A built-in brush">
            built-in
          </span>
        ) : null}
      </button>
      <button
        type="button"
        className="brush-row__star"
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
