/**
 * The options region: the part of the options bar that holds the active
 * tool's controls.
 *
 * The row has a fixed height, so switching tools never resizes the canvas.
 * A tool with more controls than fit scrolls sideways instead of wrapping onto
 * a second line, and the two chevrons are how the far end of the row is
 * reached with a mouse. The chevrons appear only while something is hidden.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IconChevronLeft, IconChevronRight } from "../icons";

export interface OptionsRegionProps {
  readonly children: ReactNode;
}

const SCROLL_STEP_PX = 180;

export function OptionsRegion({ children }: OptionsRegionProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const measure = useCallback(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const overflow = element.scrollWidth - element.clientWidth;
    setAtStart(element.scrollLeft <= 1);
    setAtEnd(overflow <= 1 || element.scrollLeft >= overflow - 1);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (contentRef.current) {
      observer.observe(contentRef.current);
    }
    element.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [measure]);

  const scrollBy = (delta: number) => {
    const element = scrollRef.current;
    if (element) {
      element.scrollBy({ left: delta, behavior: "smooth" });
    }
  };

  const overflows = !atStart || !atEnd;

  return (
    <div
      className={overflows ? "options-region is-overflowing" : "options-region"}
    >
      <div className="options-region__scroll" ref={scrollRef}>
        <div className="options-region__content" ref={contentRef}>
          {children}
        </div>
      </div>
      {overflows ? (
        <div className="options-region__nav">
          <button
            type="button"
            className="options-region__nav-button"
            aria-label="Show the options to the left"
            disabled={atStart}
            onClick={() => scrollBy(-SCROLL_STEP_PX)}
          >
            <IconChevronLeft width="12" height="12" />
          </button>
          <button
            type="button"
            className="options-region__nav-button"
            aria-label="Show the options to the right"
            disabled={atEnd}
            onClick={() => scrollBy(SCROLL_STEP_PX)}
          >
            <IconChevronRight width="12" height="12" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
