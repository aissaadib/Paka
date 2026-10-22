/**
 * The built-in panels, joined to the shell.
 *
 * A panel registers itself when its module is evaluated, so the shell's
 * registry only knows a panel that something has imported. That is why a
 * panel can be written, tested and still never appear: nothing imported it.
 * This module is that import.
 *
 * It is kept apart from `App` on purpose. The shell must not name panels -
 * the registry is the list - so this is the one file that decides which of
 * the built-in panels ship, and the shell keeps reading the registry.
 *
 * The brush browser takes parameters (the built-in brushes and the file
 * dialogs it needs), so it cannot register itself; the other two are plain
 * side-effect imports.
 */

import { BUNDLED_PRESETS } from "../core/brushes/bundledPresets";
import { findPanel } from "../core/shell/panelRegistry";
import { registerBrushPresetPanel } from "../features/brushes/BrushPresetPanel";
import "../features/navigator/NavigatorPanel";
import "../features/shortcuts/ShortcutEditorPanel";

/*
 * The brush browser ships without its file dialogs.
 *
 * `registerBrushPresetPanel` takes the gateway that reads and writes a
 * library file; there is no native implementation of that port yet, so the
 * browser opens with its presets and its library buttons disabled rather
 * than pretending an import that cannot happen. The panel already treats
 * `null` as "no file access" and says so in its own controls.
 */
if (!findPanel("brushes")) {
  registerBrushPresetPanel(BUNDLED_PRESETS, null, "right", 5);
}
