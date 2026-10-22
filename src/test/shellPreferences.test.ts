/**
 * Shell preferences tests.
 *
 * The preferences file is untrusted: it may be truncated, hand-edited or
 * written by a newer build. Every field must fall back rather than throw,
 * because a corrupt preferences file must not stop the editor opening.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHELL_PREFERENCES,
  SHELL_PREFERENCES_VERSION,
  normalizeShellPreferences,
  parseShellPreferences,
  serializeShellPreferences,
  shellPreferencesEqual,
} from "../core/shell/preferences";

describe("shell preferences", () => {
  it("starts with everything shown and nothing hidden", () => {
    expect(DEFAULT_SHELL_PREFERENCES.hiddenPanels).toEqual([]);
    expect(DEFAULT_SHELL_PREFERENCES.panelOrder).toEqual([]);
    expect(DEFAULT_SHELL_PREFERENCES.theme).toBe("system");
    expect(DEFAULT_SHELL_PREFERENCES.showStatusBar).toBe(true);
    expect(DEFAULT_SHELL_PREFERENCES.version).toBe(SHELL_PREFERENCES_VERSION);
  });

  it("keeps the fields it can read", () => {
    const preferences = normalizeShellPreferences({
      hiddenPanels: ["history"],
      panelOrder: ["layers", "colour"],
      panelSlots: { layers: "left" },
      theme: "dark",
      showStatusBar: false,
    });
    expect(preferences.hiddenPanels).toEqual(["history"]);
    expect(preferences.panelOrder).toEqual(["layers", "colour"]);
    expect(preferences.panelSlots).toEqual({ layers: "left" });
    expect(preferences.theme).toBe("dark");
    expect(preferences.showStatusBar).toBe(false);
  });

  it("falls back to the defaults for anything that is not a document", () => {
    for (const value of [null, undefined, 3, "preferences", []]) {
      expect(normalizeShellPreferences(value)).toEqual(DEFAULT_SHELL_PREFERENCES);
    }
  });

  it("drops a panel slot this build does not have", () => {
    const preferences = normalizeShellPreferences({
      panelSlots: { layers: "middle", colour: "right" },
    });
    expect(preferences.panelSlots).toEqual({ colour: "right" });
  });

  it("drops a blank panel id", () => {
    const preferences = normalizeShellPreferences({
      hiddenPanels: ["layers", "  ", "colour"],
    });
    expect(preferences.hiddenPanels).toEqual(["layers", "colour"]);
  });

  it("drops a duplicate panel id", () => {
    const preferences = normalizeShellPreferences({
      panelOrder: ["layers", "layers", "colour"],
    });
    expect(preferences.panelOrder).toEqual(["layers", "colour"]);
  });

  it("rejects a theme it does not know", () => {
    expect(normalizeShellPreferences({ theme: "neon" }).theme).toBe("system");
    expect(normalizeShellPreferences({ theme: "light" }).theme).toBe("light");
  });
});

describe("the preferences file", () => {
  it("round-trips", () => {
    const preferences = {
      ...DEFAULT_SHELL_PREFERENCES,
      hiddenPanels: ["history"],
      theme: "dark" as const,
    };
    const text = serializeShellPreferences(preferences);
    expect(parseShellPreferences(text)).toEqual(preferences);
  });

  it("falls back to the defaults for a file that is not JSON", () => {
    expect(parseShellPreferences("not json at all")).toEqual(DEFAULT_SHELL_PREFERENCES);
    expect(parseShellPreferences("")).toEqual(DEFAULT_SHELL_PREFERENCES);
    expect(parseShellPreferences("[]")).toEqual(DEFAULT_SHELL_PREFERENCES);
  });

  it("carries the version in the file", () => {
    const text = serializeShellPreferences(DEFAULT_SHELL_PREFERENCES);
    expect(JSON.parse(text).version).toBe(SHELL_PREFERENCES_VERSION);
  });
});

describe("comparing preferences", () => {
  it("sees the same preferences as equal", () => {
    expect(
      shellPreferencesEqual(DEFAULT_SHELL_PREFERENCES, { ...DEFAULT_SHELL_PREFERENCES }),
    ).toBe(true);
  });

  it("sees a different theme as different", () => {
    expect(
      shellPreferencesEqual(DEFAULT_SHELL_PREFERENCES, {
        ...DEFAULT_SHELL_PREFERENCES,
        theme: "dark",
      }),
    ).toBe(false);
  });

  it("sees a different slot as different", () => {
    expect(
      shellPreferencesEqual(DEFAULT_SHELL_PREFERENCES, {
        ...DEFAULT_SHELL_PREFERENCES,
        panelSlots: { layers: "left" },
      }),
    ).toBe(false);
  });

  it("sees a different viewport as different", () => {
    expect(
      shellPreferencesEqual(DEFAULT_SHELL_PREFERENCES, {
        ...DEFAULT_SHELL_PREFERENCES,
        viewport: { zoom: 2, centerX: 0, centerY: 0, mode: "free" },
      }),
    ).toBe(false);
  });
});
