/**
 * The panel layout as a section of the settings file.
 *
 * The settings store owns the settings file, so the panel layout does not
 * write a file of its own: it hands its state to the store, which keeps it
 * under the `panels` key and writes it back with everything else. That is
 * the whole persistence contract for the panel manager - one key in the
 * settings document, and no second store.
 *
 * The section is additive: a settings file written before the panel manager
 * existed has no `panels` key, and the layout then starts from its defaults.
 */

import type { SettingsSection } from "../settings/settingsSection";
import {
  normalizePanelLayoutState,
  panelLayoutDocument,
  type PanelLayoutSource,
  type PanelLayoutState,
} from "./panelLayout";

/** The key the layout is stored under in the settings document. */
export const PANEL_LAYOUT_KEY = "panels";

/**
 * The panel layout, wired into the settings file.
 *
 * `read` is tolerant: a missing key, a malformed value or a document from a
 * newer version all yield the defaults, so a broken layout never stops the
 * editor from starting.
 */
export function createPanelLayoutSection(
  source: PanelLayoutSource,
): SettingsSection<PanelLayoutState> {
  return {
    key: PANEL_LAYOUT_KEY,
    read: (document) => normalizePanelLayoutState(document[PANEL_LAYOUT_KEY]),
    write: (document, state) => {
      document[PANEL_LAYOUT_KEY] = panelLayoutDocument(state);
    },
    current: () => source.getState(),
    apply: (state) => source.applyLayout(state),
    subscribe: (listener) => source.subscribe(listener),
  };
}
