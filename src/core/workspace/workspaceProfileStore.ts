/**
 * The workspace profile store: the shell's live view of the named layouts.
 *
 * A profile is a saved answer to "what does this window look like". The model
 * that owns those answers is `core/workspace/workspaceProfiles.ts`: it names
 * them, renames them, deletes them and says which one is showing. This module
 * is the part that puts a profile into effect: it holds the set, adopts the
 * layout of the profile the user picks, and notices when the user has
 * rearranged the window by hand.
 *
 * Three rules shape it.
 *
 *  1. **The store does not own the layout.** The live layout belongs to the
 *     panel manager, which knows where each panel is docked and how it is
 *     shown. The store reads that layout and asks the panel manager to adopt
 *     a new one, through the small port below. The port is the meeting
 *     point: the panel manager publishes it, the profile store uses it, and
 *     neither of them keeps a second copy of the arrangement.
 *  2. **Adopting a profile is not an edit.** It rearranges the window: no
 *     history step, no revision, no dirty flag, nothing in a project file.
 *     The same rule the panels, the tool options and the grid follow.
 *  3. **The store never writes into a profile behind the model's back.** The
 *     model in `workspaceProfiles.ts` owns the set; the store owns only the
 *     decision to *show* one of them and to notice when the window stops
 *     looking like the profile it was showing.
 *
 * The module is framework-free, exactly like the workspace store and the
 * panel store, so the whole "switch, rearrange, notice, persist" cycle can be
 * exercised in Node.
 */

import {
  addProfile,
  activeProfile,
  completeLayout,
  createWorkspaceProfiles,
  deleteProfile,
  markLayoutCustom,
  renameProfile,
  switchProfile,
  updateProfileLayout,
  workspaceProfileSetEqual,
  type ProfileOutcome,
  type WorkspaceProfileSet,
} from "./workspaceProfiles";
import {
  placementsInSlot,
  SHELL_SLOT_IDS,
  type PanelPlacement,
  type ShellLayout,
  type ShellSlotId,
} from "../shell/slots";
import type { Listener } from "../../utils/store";

/**
 * The port the live shell layout implements.
 *
 * The panel manager owns the arrangement: which panel is docked where, and
 * which ones are hidden. The profile store needs three things from it - the
 * arrangement as it is now, the ability to adopt an arrangement, and a word
 * when the arrangement changes - and this is that contract. It is declared
 * here, beside the only consumer, so the panel manager can implement it
 * without the two of them editing one file.
 */
export interface WorkspaceLayoutPort {
  /** The layout the shell is showing right now. */
  getLayout(): ShellLayout;
  /** The shell adopts this layout: the panels move. */
  applyLayout(layout: ShellLayout): void;
  /** Subscribes to the live layout's changes. */
  subscribe(listener: () => void): () => void;
}

/** The intents the shell offers for the profiles. */
export interface WorkspaceProfileActions {
  /**
   * Adopts a profile: the window takes the profile's arrangement.
   *
   * The layout the profile carries is completed first, so every panel the
   * shell knows has a slot to render in, and the completed layout is what the
   * shell adopts.
   */
  switchTo(name: string): ProfileOutcome;
  /** Saves the arrangement on screen under a new name. */
  add(name: string): ProfileOutcome;
  /** Saves the arrangement on screen over a profile the user already has. */
  save(name: string): ProfileOutcome;
  /** Renames a profile. */
  rename(from: string, to: string): ProfileOutcome;
  /** Removes a profile. The window does not change. */
  remove(name: string): ProfileOutcome;
  /**
   * Asks whether the window still looks like the profile it is showing.
   *
   * The store answers this by itself whenever the layout changes; the method
   * is here for the shell, which may want to ask once the window has settled.
   */
  reconcile(): void;
}

export interface WorkspaceProfileStore {
  /** The profiles the shell holds, and the one it is showing. */
  getState(): WorkspaceProfileSet;
  /** Subscribes to the profiles' changes. */
  subscribe(listener: Listener): () => void;
  /** Replaces the profiles, e.g. with the ones read from the settings file. */
  applyProfiles(set: WorkspaceProfileSet): void;
  /** Stops watching the live layout. */
  destroy(): void;
  /** The intents the shell offers. */
  readonly actions: WorkspaceProfileActions;
}

export interface WorkspaceProfileStoreOptions {
  /** The live layout the store reads and asks the shell to change. */
  readonly layout: WorkspaceLayoutPort;
  /** The profiles the store starts with. */
  readonly initial?: WorkspaceProfileSet;
}

/**
 * The profile store.
 *
 * The store watches the live layout. When the arrangement stops looking like
 * the profile the shell was showing, the arrangement is the user's own, and
 * the store says so with `markLayoutCustom` - the saved profiles are
 * untouched, and only the "which profile is this" answer is dropped.
 */
export function createWorkspaceProfileStore(
  options: WorkspaceProfileStoreOptions,
): WorkspaceProfileStore {
  let set = options.initial ?? createWorkspaceProfiles();
  /**
   * The layout the shell was last given for the profile it is showing.
   *
   * It is the yardstick the live layout is measured against. `undefined`
   * means the store has not adopted anything itself, and the profile's own
   * completed layout is the yardstick instead.
   */
  let adopted: ShellLayout | undefined;
  /** True while the store is handing a layout to the shell. */
  let applying = false;
  const listeners = new Set<Listener>();

  const notify = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  /** Replaces the set, but only when it really changed. */
  const commit = (next: WorkspaceProfileSet): void => {
    if (workspaceProfileSetEqual(set, next)) {
      return;
    }
    set = next;
    notify();
  };

  /**
   * Whether the window still looks like the profile it is showing.
   *
   * A profile that is showing and an arrangement that does not match it mean
   * the user has rearranged the window by hand, so the answer to "which
   * profile is this" becomes "none of them".
   */
  const reconcile = (): void => {
    if (applying) {
      // The store is the one changing the layout, so the change is not the
      // user's doing and the profile stays the one being shown.
      return;
    }
    const profile = activeProfile(set);
    if (profile === undefined) {
      // The arrangement is already the user's own.
      return;
    }
    const expected = adopted ?? completeLayout(profile.layout);
    if (sameArrangement(expected, options.layout.getLayout())) {
      return;
    }
    adopted = undefined;
    commit(markLayoutCustom(set));
  };

  const actions: WorkspaceProfileActions = {
    switchTo: (name) => {
      const outcome = switchProfile(set, name);
      if (!outcome.ok) {
        return outcome;
      }
      const layout = outcome.layout;
      if (layout !== undefined) {
        applying = true;
        try {
          options.layout.applyLayout(layout);
        } finally {
          applying = false;
        }
        adopted = layout;
      }
      commit(outcome.set);
      return outcome;
    },
    add: (name) => {
      const outcome = addProfile(set, name, options.layout.getLayout());
      if (outcome.ok) {
        commit(outcome.set);
      }
      return outcome;
    },
    save: (name) => {
      const outcome = updateProfileLayout(set, name, options.layout.getLayout());
      if (outcome.ok) {
        commit(outcome.set);
      }
      return outcome;
    },
    rename: (from, to) => {
      const outcome = renameProfile(set, from, to);
      if (outcome.ok) {
        commit(outcome.set);
      }
      return outcome;
    },
    remove: (name) => {
      const outcome = deleteProfile(set, name);
      if (outcome.ok) {
        commit(outcome.set);
      }
      return outcome;
    },
    reconcile,
  };

  const stopWatching = options.layout.subscribe(() => {
    reconcile();
  });

  return {
    getState: () => set,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    applyProfiles: (next) => {
      // The set that came from the file is a new starting point: the layout
      // the store adopted before belongs to the arrangement it was showing.
      adopted = undefined;
      commit(next);
    },
    destroy: () => {
      stopWatching();
      listeners.clear();
    },
    actions,
  };
}

/* ------------------------------------------------------------ the arrangement */

/** The placements of a layout, by the panel they name. */
function placementsByPanel(layout: ShellLayout): Map<string, PanelPlacement> {
  const result = new Map<string, PanelPlacement>();
  for (const placement of layout.placements) {
    result.set(placement.panelId, placement);
  }
  return result;
}

/** The panels of a slot, in the order the slot shows them. */
function orderInSlot(layout: ShellLayout, slot: ShellSlotId): readonly string[] {
  return placementsInSlot(layout, slot).map((placement) => placement.panelId);
}

function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

/**
 * Whether two layouts describe the same arrangement.
 *
 * The comparison is about the *arrangement*, not about the numbers: a layout
 * says which slot a panel is docked in and where it sits among the panels of
 * that slot, and the numbers that say "where it sits" are the shell's own
 * business. Two layouts that put every panel in the same slot, in the same
 * order inside that slot, are the same arrangement however they number it.
 *
 * A panel that only one of the two layouts places is not counted as a
 * difference: the shell may know a panel the profile does not mention, and a
 * profile saved before a panel was removed still names it. The panels the two
 * layouts have in common are the ones that are compared.
 */
export function sameArrangement(a: ShellLayout, b: ShellLayout): boolean {
  const left = placementsByPanel(a);
  const right = placementsByPanel(b);

  for (const [panelId, placement] of left) {
    const other = right.get(panelId);
    if (other !== undefined && other.slot !== placement.slot) {
      return false;
    }
  }

  for (const slot of SHELL_SLOT_IDS) {
    const inLeft = orderInSlot(a, slot).filter((panelId) => right.has(panelId));
    const inRight = orderInSlot(b, slot).filter((panelId) => left.has(panelId));
    if (!sameSequence(inLeft, inRight)) {
      return false;
    }
  }

  return true;
}

/* --------------------------------------------------------------- the ports */

/**
 * A layout port that is not wired to the shell.
 *
 * It holds the last layout it was given and says when it changed, so the
 * profile store works - and can be tested - before the panel manager
 * publishes its own port. The shell adopts nothing while this port is in
 * use, so the arrangement on screen stays the user's own.
 */
export function createDetachedLayoutPort(
  initial: ShellLayout = { placements: [] },
): WorkspaceLayoutPort {
  let layout = initial;
  const listeners = new Set<Listener>();
  return {
    getLayout: () => layout,
    applyLayout: (next) => {
      layout = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
