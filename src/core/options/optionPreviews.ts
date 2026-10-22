/**
 * Option previews: the small picture a control shows beside itself.
 *
 * A control says what a value *is*; a preview says what it *looks like*. The
 * brush tip is the first one: the list names five shapes, and the swatch
 * beside it shows the mask the stamp engine multiplies into a dab's coverage -
 * the engine's own picture of the tip, not a drawing of a brush.
 *
 * The preview is a **descriptor**, not a React element: the core layer says
 * which picture belongs to a control and what it shows, and the React layer
 * draws it. That keeps the rule testable without a browser, which is the same
 * split every other part of the options bar keeps.
 *
 * The registry is keyed by the option's id because the tool-option contract
 * (`core/shell/toolOptions.ts`) is shared and closed: it cannot grow a preview
 * field for one feature without changing what every option means. A feature
 * that wants a picture beside its control registers one here, and the control
 * renderer asks for it by id.
 */

import type { BrushTipShape } from "../../types/brush";

/**
 * The picture the brush tip's control shows.
 *
 * The tip's mask, at the size the swatch shows it.
 */
export interface BrushTipOptionPreview {
  readonly kind: "brushTip";
  /** The tip the swatch shows. */
  readonly tip: BrushTipShape;
  /** What the swatch shows, for a screen reader. */
  readonly label: string;
}

/**
 * Every kind of option preview.
 *
 * A closed list, so a consumer can enumerate it: the renderer checks itself
 * against this list, and a kind added here without a picture to draw it is a
 * compile error rather than a blank space in the bar.
 */
export type OptionPreview = BrushTipOptionPreview;

/** The name of every kind of option preview. */
export type OptionPreviewKind = OptionPreview["kind"];

/**
 * Builds the preview for a control's current value.
 *
 * `null` means the value has no picture: a shape this build does not know is
 * refused rather than drawn as the nearest thing.
 */
export type OptionPreviewBuilder = (value: string) => OptionPreview | null;

const builders = new Map<string, OptionPreviewBuilder>();

/**
 * Registers the preview a control shows beside itself.
 *
 * The last registration for an id wins, and registering the same id twice is
 * harmless.
 */
export function registerOptionPreview(optionId: string, build: OptionPreviewBuilder): void {
  builders.set(optionId, build);
}

/**
 * The preview for a control's value, or `null` when it has none.
 *
 * A control with no registered preview simply has no picture: the registry is
 * empty for every option but the ones that asked for one.
 */
export function optionPreviewFor(optionId: string, value: string): OptionPreview | null {
  const build = builders.get(optionId);
  return build === undefined ? null : build(value);
}

/**
 * Empties the registry.
 *
 * Only for tests: the previews register themselves when their module is
 * evaluated.
 */
export function resetOptionPreviews(): void {
  builders.clear();
}
