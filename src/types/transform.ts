/** Selection transform vocabulary shared by the engine, store and menu. */

/**
 * Axis a selection is reflected across.
 *
 * `"horizontal"` flips left-to-right (mirrors each x about the selection's
 * vertical centre line); `"vertical"` flips top-to-bottom. Named after the
 * direction the content moves, which is how the menu labels read.
 */
export type FlipAxis = "horizontal" | "vertical";
