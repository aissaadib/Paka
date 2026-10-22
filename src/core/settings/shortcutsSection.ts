/**
 * The shortcut overrides as a section of the settings file.
 *
 * The settings store owns the settings file, so the shortcuts do not write a
 * file of their own: they hand their state to the store, which keeps it under
 * the `shortcuts` key and writes it back with everything else. That is the
 * whole persistence contract for the shortcut editor - one key in the
 * settings document, and no second store.
 *
 * The section is additive: a settings file written before the shortcut editor
 * existed has no `shortcuts` key, and every action then answers to its
 * default.
 */

import {
  shortcutBindings,
  type SerializedShortcutOverrides,
} from "../actions/bindingStore";
import { applyShortcutOverrides, normalizeShortcutOverrides } from "../actions/registry";
import type { SettingsSection } from "./settingsSection";

/** The key the overrides are stored under in the settings document. */
export const SHORTCUT_OVERRIDES_KEY = "shortcuts";

/**
 * The shortcut overrides, wired into the settings file.
 *
 * `read` is tolerant: a missing key, a malformed chord, an action that does
 * not exist and a chord another action already claims all lose that entry and
 * nothing else, so a broken file never stops the editor from starting and
 * never leaves two actions fighting over one key.
 */
export function createShortcutOverridesSection(): SettingsSection<SerializedShortcutOverrides> {
  return {
    key: SHORTCUT_OVERRIDES_KEY,
    read: (document) => normalizeShortcutOverrides(document[SHORTCUT_OVERRIDES_KEY]),
    write: (document, state) => {
      document[SHORTCUT_OVERRIDES_KEY] = state;
    },
    current: () => shortcutBindings.toJSON(),
    apply: (state) => applyShortcutOverrides(state),
    subscribe: (listener) => shortcutBindings.subscribe(listener),
  };
}
