/**
 * Workspace profile tests.
 *
 * A profile is a named layout, so what matters here is the rules the model
 * keeps: a name the user could have typed, a layout the shell can actually
 * show, and a set that changes in one step at a time. The tests read the
 * model the way the shell will: they place panels through the shell's own
 * layout rules and they check the profile set against the shell's registry.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  registerPanel,
  resetPanelRegistry,
  type PanelDefinition,
} from "../core/shell/panelRegistry";
import {
  DEFAULT_SHELL_LAYOUT,
  hidePanel,
  placePanel,
  type ShellLayout,
} from "../core/shell/slots";
import {
  DEFAULT_PROFILE_NAME,
  DEFAULT_WORKSPACE_PROFILE,
  MAX_PROFILE_NAME_LENGTH,
  activeProfile,
  addProfile,
  completeLayout,
  createWorkspaceProfiles,
  deleteProfile,
  describeLayoutProblem,
  findProfile,
  hiddenPanelIds,
  isValidProfileLayout,
  isValidProfileName,
  isWellFormedLayout,
  knownPanelsOnly,
  markLayoutCustom,
  normalizeProfileName,
  panelsKnownToShell,
  parseProfile,
  parseProfileSet,
  profileNameKey,
  renameProfile,
  serializeProfile,
  serializeProfileSet,
  shownPanelIds,
  switchProfile,
  updateProfileLayout,
  workspaceProfileEqual,
  workspaceProfileSetEqual,
  type WorkspaceProfile,
  type WorkspaceProfileSet,
} from "../core/workspace/workspaceProfiles";

function panel(id: string, slot: PanelDefinition["slot"], order: number): PanelDefinition {
  return { id, title: id, slot, order, render: () => null };
}

beforeEach(() => {
  resetPanelRegistry();
  registerPanel(panel("layers", "right", 0));
  registerPanel(panel("colour", "left", 0));
  registerPanel(panel("brush", "bottom", 1));
});

/** A set with one saved profile beside the default one. */
function setWithPainting(): WorkspaceProfileSet {
  const added = addProfile(createWorkspaceProfiles(), "Painting", {
    placements: [{ panelId: "layers", slot: "right", order: 0 }],
  });
  if (!added.ok) {
    throw new Error(added.detail ?? "the profile could not be added");
  }
  return added.set;
}

/** The set as it looks after the shell adopts a profile. */
function showing(set: WorkspaceProfileSet, name: string): WorkspaceProfileSet {
  const outcome = switchProfile(set, name);
  if (!outcome.ok) {
    throw new Error(outcome.detail ?? "the profile could not be adopted");
  }
  return outcome.set;
}

describe("the name rules", () => {
  it("accepts a name that says something", () => {
    expect(isValidProfileName("Painting")).toBe(true);
    expect(isValidProfileName("Sketch 2")).toBe(true);
  });

  it("refuses a name that says nothing", () => {
    expect(isValidProfileName("")).toBe(false);
    expect(isValidProfileName("   ")).toBe(false);
    expect(isValidProfileName("\t\n")).toBe(false);
  });

  it("refuses a name that is too long", () => {
    expect(isValidProfileName("x".repeat(MAX_PROFILE_NAME_LENGTH))).toBe(true);
    expect(isValidProfileName("x".repeat(MAX_PROFILE_NAME_LENGTH + 1))).toBe(false);
  });

  it("refuses a name with a control character in it", () => {
    expect(isValidProfileName("Painting\nSketch")).toBe(false);
    expect(isValidProfileName("Painting\tSketch")).toBe(false);
  });

  it("stores a name trimmed with its spacing collapsed", () => {
    expect(normalizeProfileName("  Painting   Sketch ")).toBe("Painting Sketch");
  });

  it("compares names without regard to case", () => {
    expect(profileNameKey("Painting")).toBe(profileNameKey("painting"));
    expect(profileNameKey(" Painting ")).toBe(profileNameKey("painting"));
  });
});

describe("a layout a profile may carry", () => {
  it("accepts a layout that places known panels in known slots", () => {
    const layout = placePanel(
      placePanel(DEFAULT_SHELL_LAYOUT, "layers", "right"),
      "colour",
      "left",
    );
    expect(isValidProfileLayout(layout)).toBe(true);
    expect(describeLayoutProblem(layout)).toBeUndefined();
  });

  it("accepts the empty layout", () => {
    expect(isValidProfileLayout(DEFAULT_SHELL_LAYOUT)).toBe(true);
  });

  it("refuses a slot the shell does not have", () => {
    const layout = {
      placements: [{ panelId: "layers", slot: "middle" as unknown as "right", order: 0 }],
    };
    expect(isValidProfileLayout(layout)).toBe(false);
    expect(describeLayoutProblem(layout)).toMatch(/slot "middle" does not exist/);
  });

  it("refuses a panel the shell does not know", () => {
    const layout = placePanel(DEFAULT_SHELL_LAYOUT, "ghost", "right");
    expect(isValidProfileLayout(layout)).toBe(false);
    expect(describeLayoutProblem(layout)).toMatch(/panel "ghost" is not one the shell knows/);
  });

  it("refuses a panel that is placed twice", () => {
    const layout = {
      placements: [
        { panelId: "layers", slot: "right" as const, order: 0 },
        { panelId: "layers", slot: "left" as const, order: 1 },
      ],
    };
    expect(isWellFormedLayout(layout)).toBe(false);
    expect(describeLayoutProblem(layout)).toMatch(/placed twice/);
  });

  it("refuses a placement that names no panel", () => {
    const layout = { placements: [{ panelId: "   ", slot: "right" as const, order: 0 }] };
    expect(isWellFormedLayout(layout)).toBe(false);
  });

  it("refuses a layout with no placement list", () => {
    const layout = { placements: "none" } as unknown as ShellLayout;
    expect(isWellFormedLayout(layout)).toBe(false);
  });

  it("defers the panel check while the registry is empty", () => {
    resetPanelRegistry();
    const layout = placePanel(DEFAULT_SHELL_LAYOUT, "ghost", "right");
    expect(panelsKnownToShell(layout)).toBe(true);
    expect(isValidProfileLayout(layout)).toBe(true);
    expect(knownPanelsOnly(layout)).toEqual(layout);
  });

  it("drops the panels the shell does not know", () => {
    const layout = placePanel(
      placePanel(DEFAULT_SHELL_LAYOUT, "layers", "right"),
      "ghost",
      "right",
    );
    expect(knownPanelsOnly(layout).placements.map((entry) => entry.panelId)).toEqual(["layers"]);
  });
});

describe("completing a layout", () => {
  it("gives every panel the shell knows a slot", () => {
    const completed = completeLayout(DEFAULT_SHELL_LAYOUT);
    expect(completed.placements.map((entry) => entry.panelId).sort()).toEqual([
      "brush",
      "colour",
      "layers",
    ]);
  });

  it("keeps the arrangement the user made", () => {
    const userLayout = placePanel(DEFAULT_SHELL_LAYOUT, "layers", "left");
    const completed = completeLayout(userLayout);
    expect(completed.placements.find((entry) => entry.panelId === "layers")?.slot).toBe("left");
  });

  it("does not place a panel twice", () => {
    const completed = completeLayout(placePanel(DEFAULT_SHELL_LAYOUT, "layers", "right"));
    expect(completed.placements.filter((entry) => entry.panelId === "layers")).toHaveLength(1);
  });
});

describe("the default profile", () => {
  it("starts with the default profile showing", () => {
    const set = createWorkspaceProfiles();
    expect(set.profiles).toHaveLength(1);
    expect(set.profiles[0].name).toBe(DEFAULT_PROFILE_NAME);
    expect(set.active).toBe(DEFAULT_PROFILE_NAME);
  });

  it("carries the layout an installation starts from", () => {
    expect(DEFAULT_WORKSPACE_PROFILE.layout).toEqual(DEFAULT_SHELL_LAYOUT);
    expect(DEFAULT_WORKSPACE_PROFILE.layout.placements).toEqual([]);
  });

  it("is found without regard to case", () => {
    expect(findProfile(createWorkspaceProfiles(), "default")?.name).toBe(DEFAULT_PROFILE_NAME);
    expect(activeProfile(createWorkspaceProfiles())?.name).toBe(DEFAULT_PROFILE_NAME);
  });
});

describe("adding a profile", () => {
  it("adds the profile with a normalized name", () => {
    const outcome = addProfile(createWorkspaceProfiles(), "  Painting  ", DEFAULT_SHELL_LAYOUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.set.profiles.map((entry) => entry.name)).toEqual([
      DEFAULT_PROFILE_NAME,
      "Painting",
    ]);
  });

  it("refuses a name another profile already has", () => {
    const outcome = addProfile(createWorkspaceProfiles(), "default", DEFAULT_SHELL_LAYOUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("duplicate-name");
  });

  it("refuses a name that says nothing", () => {
    const outcome = addProfile(createWorkspaceProfiles(), "   ", DEFAULT_SHELL_LAYOUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("invalid-name");
  });

  it("refuses a layout the shell cannot show", () => {
    const outcome = addProfile(
      createWorkspaceProfiles(),
      "Painting",
      placePanel(DEFAULT_SHELL_LAYOUT, "ghost", "right"),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("invalid-layout");
  });

  it("changes nothing when it refuses", () => {
    const set = createWorkspaceProfiles();
    addProfile(set, "default", DEFAULT_SHELL_LAYOUT);
    expect(set.profiles).toHaveLength(1);
    expect(set.active).toBe(DEFAULT_PROFILE_NAME);
  });
});

describe("renaming a profile", () => {
  it("renames the profile and keeps its place in the list", () => {
    const outcome = renameProfile(setWithPainting(), "Painting", "Sketching");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.set.profiles.map((entry) => entry.name)).toEqual([
      DEFAULT_PROFILE_NAME,
      "Sketching",
    ]);
  });

  it("keeps showing the profile it renamed", () => {
    const outcome = renameProfile(showing(setWithPainting(), "Painting"), "Painting", "Sketching");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.set.active).toBe("Sketching");
  });

  it("refuses a name another profile already has", () => {
    const outcome = renameProfile(setWithPainting(), "Painting", "default");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("duplicate-name");
  });

  it("refuses a name that says nothing", () => {
    const outcome = renameProfile(setWithPainting(), "Painting", "  ");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("invalid-name");
  });

  it("refuses a profile that is not there", () => {
    const outcome = renameProfile(setWithPainting(), "Missing", "Sketching");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("unknown-profile");
  });

  it("allows a change of case", () => {
    const outcome = renameProfile(createWorkspaceProfiles(), "Default", "default");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.set.profiles).toHaveLength(1);
    expect(outcome.set.profiles[0].name).toBe("default");
  });
});

describe("deleting a profile", () => {
  it("removes the profile", () => {
    const outcome = deleteProfile(setWithPainting(), "Painting");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.set.profiles.map((entry) => entry.name)).toEqual([DEFAULT_PROFILE_NAME]);
  });

  it("stops showing the profile it removed", () => {
    const outcome = deleteProfile(showing(setWithPainting(), "Painting"), "Painting");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.set.active).toBeUndefined();
  });

  it("keeps showing another profile", () => {
    const outcome = deleteProfile(showing(setWithPainting(), "Painting"), "Default");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.set.active).toBe("Painting");
  });

  it("refuses a profile that is not there", () => {
    const outcome = deleteProfile(setWithPainting(), "Missing");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("unknown-profile");
  });
});

describe("switching to a profile", () => {
  it("adopts the layout of the profile", () => {
    const outcome = switchProfile(setWithPainting(), "Painting");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.set.active).toBe("Painting");
    expect(outcome.layout?.placements.find((entry) => entry.panelId === "layers")?.slot).toBe(
      "right",
    );
  });

  it("completes the layout so that every panel has a slot", () => {
    const outcome = switchProfile(setWithPainting(), "Painting");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.layout?.placements.map((entry) => entry.panelId).sort()).toEqual([
      "brush",
      "colour",
      "layers",
    ]);
  });

  it("refuses a profile that is not there", () => {
    const outcome = switchProfile(setWithPainting(), "Missing");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("unknown-profile");
  });
});

describe("the user's own arrangement", () => {
  it("stops showing a profile without changing the saved ones", () => {
    const custom = markLayoutCustom(showing(setWithPainting(), "Painting"));
    expect(custom.active).toBeUndefined();
    expect(custom.profiles).toHaveLength(2);
  });
});

describe("saving over a profile", () => {
  it("replaces the layout of the profile", () => {
    const outcome = updateProfileLayout(
      setWithPainting(),
      "Painting",
      placePanel(DEFAULT_SHELL_LAYOUT, "colour", "left"),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const profile = findProfile(outcome.set, "Painting");
    expect(profile?.layout.placements.map((entry) => entry.panelId)).toEqual(["colour"]);
  });

  it("refuses a layout the shell cannot show", () => {
    const outcome = updateProfileLayout(
      setWithPainting(),
      "Painting",
      placePanel(DEFAULT_SHELL_LAYOUT, "ghost", "right"),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("invalid-layout");
  });

  it("refuses a profile that is not there", () => {
    const outcome = updateProfileLayout(setWithPainting(), "Missing", DEFAULT_SHELL_LAYOUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("unknown-profile");
  });
});

describe("the panels a layout shows", () => {
  it("tells the shown panels from the hidden ones", () => {
    const layout = hidePanel(placePanel(DEFAULT_SHELL_LAYOUT, "layers", "right"), "colour");
    expect(shownPanelIds(layout)).toEqual(["layers"]);
    expect(hiddenPanelIds(layout)).toEqual(["colour"]);
  });
});

describe("comparing profiles", () => {
  const profile: WorkspaceProfile = {
    name: "Painting",
    layout: placePanel(DEFAULT_SHELL_LAYOUT, "layers", "right"),
  };

  it("sees two profiles with the same name and layout as equal", () => {
    expect(workspaceProfileEqual(profile, { ...profile })).toBe(true);
  });

  it("sees a different layout as a different profile", () => {
    const other = { ...profile, layout: placePanel(DEFAULT_SHELL_LAYOUT, "colour", "left") };
    expect(workspaceProfileEqual(profile, other)).toBe(false);
  });

  it("sees two sets with the same profiles as equal", () => {
    expect(workspaceProfileSetEqual(setWithPainting(), setWithPainting())).toBe(true);
  });

  it("sees a set showing another profile as different", () => {
    expect(workspaceProfileSetEqual(showing(setWithPainting(), "Painting"), setWithPainting())).toBe(
      false,
    );
  });
});

describe("the persistence boundary", () => {
  it("writes one profile down and reads it back", () => {
    const profile = findProfile(setWithPainting(), "Painting");
    expect(profile).toBeDefined();
    const read = parseProfile(serializeProfile(profile as WorkspaceProfile));
    expect(read).not.toBeNull();
    expect(workspaceProfileEqual(read as WorkspaceProfile, profile as WorkspaceProfile)).toBe(true);
  });

  it("refuses a value that is not a profile", () => {
    for (const value of [null, undefined, 3, "Painting", [], { name: 7 }]) {
      expect(parseProfile(value)).toBeNull();
    }
  });

  it("refuses a profile whose name says nothing", () => {
    expect(parseProfile({ name: "   ", layout: { placements: [] } })).toBeNull();
  });

  it("drops a slot this build does not have when it reads a layout", () => {
    const read = parseProfile({
      name: "Painting",
      layout: {
        placements: [
          { panelId: "layers", slot: "middle", order: 0 },
          { panelId: "colour", slot: "right", order: 1 },
        ],
      },
    });
    expect(read?.layout.placements.map((entry) => entry.panelId)).toEqual(["colour"]);
  });

  it("reads a profile with no layout as the layout an installation starts from", () => {
    const read = parseProfile({ name: "Painting" });
    expect(read?.layout).toEqual(DEFAULT_SHELL_LAYOUT);
  });

  it("writes a whole set down and reads it back", () => {
    const set = showing(setWithPainting(), "Painting");
    const read = parseProfileSet(serializeProfileSet(set));
    expect(workspaceProfileSetEqual(read, set)).toBe(true);
  });

  it("falls back to the default set for a value that is not a set", () => {
    for (const value of [null, undefined, 3, "profiles", []]) {
      const read = parseProfileSet(value);
      expect(read.profiles).toHaveLength(1);
      expect(read.profiles[0].name).toBe(DEFAULT_PROFILE_NAME);
      expect(read.active).toBe(DEFAULT_PROFILE_NAME);
    }
  });

  it("refuses a set from a newer version", () => {
    const read = parseProfileSet({
      version: 99,
      profiles: [{ name: "Painting", layout: { placements: [] } }],
      active: "Painting",
    });
    expect(read.profiles).toHaveLength(1);
    expect(read.profiles[0].name).toBe(DEFAULT_PROFILE_NAME);
  });

  it("drops a profile it cannot read and keeps the others", () => {
    const read = parseProfileSet({
      version: 1,
      profiles: [
        { name: "Painting", layout: { placements: [] } },
        { name: "   ", layout: { placements: [] } },
        "not a profile",
      ],
      active: "Painting",
    });
    expect(read.profiles.map((entry) => entry.name)).toEqual(["Painting"]);
    expect(read.active).toBe("Painting");
  });

  it("drops an active name that names no profile", () => {
    const read = parseProfileSet({
      version: 1,
      profiles: [{ name: "Painting", layout: { placements: [] } }],
      active: "Missing",
    });
    expect(read.active).toBeUndefined();
  });
});
