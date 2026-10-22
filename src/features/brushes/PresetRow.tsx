/**
 * One row of the brush library.
 *
 * The row shows the mark the preset paints, its name and the two states that
 * matter: whether it is the brush in effect, and whether the brush has been
 * changed since it was applied. The star is the user's own note about the
 * brush, so it is a button of its own rather than part of the name.
 */

import { describePreset, isRecentlyUsed } from "../../core/brushes/presetBrowser";
import { isBundledPreset, type BrushPreset } from "../../core/brushes/presets";
import { BrushTipPreview } from "./BrushTipPreview";

export interface PresetRowProps {
  readonly preset: BrushPreset;
  /** Whether the row is the one the keyboard is on. */
  readonly selected: boolean;
  /** Whether the row is the brush in effect. */
  readonly current: boolean;
  /** Whether the brush has been changed since the preset was applied. */
  readonly edited: boolean;
  /** The colour painted behind the swatch: the document's paper. */
  readonly background: string;
  /** The row was picked. */
  readonly onSelect: (id: string) => void;
  /** The star was pressed. */
  readonly onToggleFavorite: (id: string) => void;
}

export function PresetRow({
  preset,
  selected,
  current,
  edited,
  background,
  onSelect,
  onToggleFavorite,
}: PresetRowProps) {
  const builtin = isBundledPreset(preset);
  const description = describePreset(preset);
  const title = builtin
    ? `${preset.name} - ${description} (built-in)`
    : `${preset.name} - ${description}`;

  return (
    <div
      id={`brush-option-${preset.id}`}
      className={[
        "brush-row",
        selected ? "is-selected" : "",
        current ? "is-current" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="option"
      aria-selected={selected}
      title={title}
      onClick={() => onSelect(preset.id)}
    >
      <BrushTipPreview brush={preset.brush} background={background} label={`${preset.name}: ${description}`} />
      <span className="brush-row__name">{preset.name}</span>
      {edited ? <span className="brush-row__edited" title="The brush has changed since this preset was applied">•</span> : null}
      {builtin ? <span className="brush-row__builtin" title="A built-in brush">built-in</span> : null}
      {isRecentlyUsed(preset) ? (
        <span className="brush-row__recent" title="Used recently">
          recent
        </span>
      ) : null}
      <button
        type="button"
        className="brush-row__star"
        aria-label={preset.favorite ? `Unstar ${preset.name}` : `Star ${preset.name}`}
        aria-pressed={preset.favorite}
        title={preset.favorite ? `Unstar ${preset.name}` : `Star ${preset.name}`}
        onClick={(event) => {
          // The star is its own control: pressing it must not apply the preset.
          event.stopPropagation();
          onToggleFavorite(preset.id);
        }}
      >
        {preset.favorite ? "★" : "☆"}
      </button>
    </div>
  );
}
