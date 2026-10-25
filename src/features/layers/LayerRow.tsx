/**
 * A single row in the layers panel.
 *
 * The row is the panel's unit of everything: it shows whether the node is the
 * active one, whether it is hidden, whether it is a group, and it carries the
 * three controls an artist reaches for - the visibility toggle, the name and
 * the opacity. A group also carries a chevron that expands or collapses its
 * children; that is view state only and never reaches the document.
 *
 * The row is a *view*: it never changes the document itself. Every control
 * calls back into the panel, which issues an engine command, so every change
 * is undoable and a layer can never be lost by a stray click.
 */

import { useEffect, useRef, useState } from "react";
import type { DragEvent, FocusEvent } from "react";
import { IconChevronRight, IconEye, IconEyeOff, IconFolder } from "../../components/icons";
import type { Layer } from "../../core/document/types";
import type { LayerDropPosition } from "../../core/document/layerTreeDrag";

export interface LayerRowProps {
  readonly layer: Layer;
  /** How deep the node sits; 0 is a root row. */
  readonly depth: number;
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
  /** True when the node is a container. */
  readonly isGroup: boolean;
  /** True when this group's children are hidden in the panel. */
  readonly collapsed: boolean;
  /** How many children the group holds; 0 for a layer. */
  readonly childCount: number;
  /** How many elements the node holds, counting a group's descendants. */
  readonly elementCount: number;
  /** True when an ancestor group is hidden, so this row cannot composited. */
  readonly inheritedHidden: boolean;
  /** Where a drag in flight would land relative to this row, if anywhere. */
  readonly dropPosition: LayerDropPosition | null;
  readonly onSelect: () => void;
  readonly onToggleVisibility: () => void;
  readonly onToggleExpanded: () => void;
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
  depth,
  active,
  focused,
  dragging,
  renaming,
  draft,
  isGroup,
  collapsed,
  childCount,
  elementCount,
  inheritedHidden,
  dropPosition,
  onSelect,
  onToggleVisibility,
  onToggleExpanded,
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
  const children = childCount === 1 ? "1 layer" : `${childCount} layers`;

  const className = [
    "layer-row",
    isGroup ? "is-group" : "",
    active ? "is-active" : "",
    focused ? "is-focused" : "",
    dragging ? "is-dragging" : "",
    layer.visible ? "" : "is-hidden",
    inheritedHidden ? "is-inherited-hidden" : "",
    isGroup ? (collapsed ? "is-collapsed" : "is-expanded") : "",
    dropPosition === "above" ? "is-drop-above" : "",
    dropPosition === "below" ? "is-drop-below" : "",
    dropPosition === "into" ? "is-drop-into" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const title = isGroup
    ? `${layer.name} - group with ${children}, ${elementCount} ${items}. Double-click to rename.`
    : `${layer.name} - ${elementCount} ${items}. Double-click to rename.`;

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
      style={{ paddingLeft: `${6 + depth * 14}px` }}
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
      {isGroup && childCount > 0 ? (
        <button
          type="button"
          className="layer-row__chevron"
          aria-label={collapsed ? `Expand ${layer.name}` : `Collapse ${layer.name}`}
          aria-expanded={!collapsed}
          onClick={onToggleExpanded}
        >
          <IconChevronRight />
        </button>
      ) : (
        <span className="layer-row__chevron-spacer" aria-hidden="true" />
      )}
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
          aria-label={isGroup ? "Group name" : "Layer name"}
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
          title={title}
          onClick={onSelect}
          onDoubleClick={onStartRename}
        >
          {isGroup ? (
            <IconFolder
              className="layer-row__folder"
              aria-hidden="true"
            />
          ) : null}
          <span className="layer-row__title">{layer.name}</span>
          {isGroup ? (
            <span className="layer-row__count" aria-label={`${children} inside`}>
              {childCount}
            </span>
          ) : null}
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
