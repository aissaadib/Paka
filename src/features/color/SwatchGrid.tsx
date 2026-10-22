/**
 * The grid of colour swatches.
 *
 * Every swatch is a real button, so it is reachable with Tab and fires on
 * Enter and Space without any extra wiring. The arrow keys are an addition on
 * top of that: they move the focus to the neighbouring swatch, which is what
 * a grid of colours is used for - stepping through the palette to find the
 * one you want, not tabbing through twenty stops.
 *
 * The grid is deliberately *not* a roving-tabindex widget: every swatch stays
 * in the tab order, so a keyboard user can jump straight to the swatch they
 * know rather than having to walk the whole grid to reach it.
 */

import { useRef } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";

export interface SwatchGridProps<T> {
  /** The swatches, in the order they are shown. */
  readonly items: readonly T[];
  /** How many swatches sit on a row; the arrow keys use it to step a row. */
  readonly columns: number;
  /** The accessible name of the group. */
  readonly groupLabel: string;
  /** Renders one cell. The focusable element inside it needs the attribute
   * `data-swatch-focusable`, so the arrow keys can find it. */
  readonly renderItem: (item: T, index: number) => ReactNode;
}

const ARROW_KEYS = new Set(["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"]);

export function SwatchGrid<T>({
  items,
  columns,
  groupLabel,
  renderItem,
}: SwatchGridProps<T>) {
  const container = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!ARROW_KEYS.has(event.key)) {
      return;
    }
    const host = container.current;
    if (host === null) {
      return;
    }
    const focusable = Array.from(
      host.querySelectorAll<HTMLElement>("[data-swatch-focusable]"),
    );
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    if (current < 0) {
      return;
    }
    event.preventDefault();
    const step =
      event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowLeft"
          ? -1
          : event.key === "ArrowDown"
            ? columns
            : -columns;
    const next = current + step;
    if (next < 0 || next >= focusable.length) {
      return;
    }
    focusable[next].focus();
  };

  return (
    <div
      className="swatch-grid"
      role="group"
      aria-label={groupLabel}
      ref={container}
      onKeyDown={onKeyDown}
      style={{ "--swatch-columns": columns } as CSSProperties}
    >
      {items.map((item, index) => renderItem(item, index))}
    </div>
  );
}
