/**
 * Panel registry: the list of panels the application shell can show.
 *
 * A panel used to be hard-wired into the shell's layout, so adding one meant
 * editing the shell's composition. The registry makes the shell the *reader*
 * of a list instead of its owner: a panel registers itself and the shell
 * renders whatever the registry says.
 *
 * The registry holds metadata and a render callback. It is deliberately a
 * module-level list rather than a React context: the shell is the only
 * consumer, and a plain list can be inspected and asserted on without a
 * browser, which is what the project's own rule about the React layer
 * requires.
 *
 * Three rules shape it, and they are the rules that keep **one panel one
 * component**:
 *
 *  1. **One panel, one id.** The registry is keyed by a panel's *canonical*
 *     id, so a panel registered under two spellings of its id is one panel
 *     rather than two. The colour dock was registered once as `"colour"` and
 *     once as `"color"` by two builders, and the side column drew it twice.
 *  2. **A panel's own registration is the panel.** A *fallback* registration -
 *     one that only fills an id nothing else has claimed, such as the shell's
 *     own body for a panel the catalogue knows - never overrules a panel that
 *     registered itself, whichever order the two arrive in. The shell's
 *     registration of the colour dock is a fallback; the dock's is not.
 *  3. **The registry tells the shell when it changes.** A panel that registers
 *     after the first paint is picked up by the next read of the composition,
 *     but nothing would tell React to paint again. The subscription is that
 *     telling, and it is batched, so a module that registers several panels
 *     starts one repaint rather than one per panel.
 */

import type { ReactNode } from "react";
import { isShellSlotId, type ShellSlotId } from "./slots";

/** One panel the shell may show. */
export interface PanelDefinition {
  /** Stable id, unique across the registry. */
  readonly id: string;
  /** The heading the panel shows. */
  readonly title: string;
  /** Where the panel is docked by default. */
  readonly slot: ShellSlotId;
  /** Position within the slot; lower numbers come first. */
  readonly order: number;
  /** The panel's body. */
  readonly render: () => ReactNode;
  /**
   * The icon name the panel is drawn with.
   *
   * A name, not a component: the registry stays free of React so the shell
   * can map the name to a glyph.
   */
  readonly icon?: string;
  /**
   * Whether the panel stays mounted while it is hidden.
   *
   * `"always"` keeps a panel that holds React state of its own from losing
   * it; `"when-visible"` is for a panel derived from the document, which has
   * no state to lose.
   */
  readonly mounting?: "always" | "when-visible";
  /** Whether the panel can be folded down to its header. */
  readonly collapsible?: boolean;
  /** Whether the panel takes the column's leftover height. */
  readonly grow?: boolean;
  /** One line on what the panel is for. */
  readonly description?: string;
  /**
   * Other ids that name this same panel.
   *
   * A panel is one component in one place, so two spellings of one id must
   * not become two panels. A panel that knows it is also called something
   * else says so here, and the registry treats the spellings as one id.
   */
  readonly aliases?: readonly string[];
  /**
   * Whether this registration only fills an id nothing else has claimed.
   *
   * A fallback is the shell's own body for a panel the catalogue knows: it
   * is offered, and it stands down when the panel itself has registered. A
   * registration that is *not* a fallback is the panel's own, and it wins
   * over a fallback in either order - so the shell cannot overrule a panel
   * that spoke for itself, and a panel that re-registers (a hot reload)
   * still replaces its own earlier body rather than leaving a stale one.
   */
  readonly fallback?: boolean;
}

/**
 * The spellings the shell knows by more than one name.
 *
 * The registry is keyed by a panel's canonical id, so a spelling listed here
 * and the id it names are one panel. The colour dock is the case that
 * mattered: two builders wrote its id with different spellings, the
 * registry held two entries, and the side column drew the dock twice.
 */
const PANEL_ID_ALIASES: ReadonlyMap<string, string> = new Map([
  ["colour", "color"],
]);

/** The spellings a registered panel declared for itself. */
const declaredAliases = new Map<string, string>();

/** The registered panels, keyed by their canonical id. */
const panels = new Map<string, PanelDefinition>();

/**
 * The canonical spelling of a panel id.
 *
 * The canonical id is the one the shell, the settings file and the panel
 * manager's catalogue agree on. A spelling that names the same panel resolves
 * to it, so a panel is found under either name and is only ever one entry.
 */
export function canonicalPanelId(id: string): string {
  let current = id;
  // The chain is short; the bound keeps a cycle from looping forever.
  for (let step = 0; step < 8; step += 1) {
    const next = declaredAliases.get(current) ?? PANEL_ID_ALIASES.get(current);
    if (next === undefined || next === current) {
      break;
    }
    current = next;
  }
  return current;
}

/** Refuses a definition the registry cannot hold. */
function validatePanel(definition: PanelDefinition): void {
  if (definition.id.trim() === "") {
    throw new Error("a panel needs a non-empty id");
  }
  if (!isShellSlotId(definition.slot)) {
    throw new Error(`panel "${definition.id}" names an unknown slot`);
  }
}

/**
 * Adds a panel, or replaces the one already registered under the same id.
 *
 * Registering the same id twice is a replacement, not a duplicate: a panel
 * that is re-registered (because its module was evaluated again) must not
 * appear twice in the shell.
 *
 * A *fallback* registration is the exception: it only fills an id nothing
 * else has claimed, so it stands down when the panel itself has registered,
 * and it never overrules a panel that registered itself. See
 * `PanelDefinition.fallback`.
 */
export function registerPanel(definition: PanelDefinition): PanelDefinition {
  validatePanel(definition);

  const key = canonicalPanelId(definition.id);

  // The spellings this panel answers to, so a registration under one of them
  // is the same panel rather than a second one.
  for (const alias of definition.aliases ?? []) {
    if (alias.trim() === "" || alias === definition.id) {
      continue;
    }
    declaredAliases.set(alias, key);
  }

  const incumbent = panels.get(key);
  if (incumbent) {
    // A fallback only fills an id nothing else has claimed: a panel that
    // spoke for itself is not overruled by one, in either order.
    if (definition.fallback === true && incumbent.fallback !== true) {
      return incumbent;
    }
    // A spelling of an id that is already registered does not become a
    // second panel, and it does not replace the canonical registration
    // either: the canonical spelling wins the id, whoever arrived first.
    if (key !== definition.id && incumbent.id === key) {
      return incumbent;
    }
  }

  panels.set(key, definition);
  registryChanged();
  return definition;
}

/**
 * Registers a panel only when its id is free.
 *
 * This is the first-registration-wins rule: the panel that claimed an id
 * first keeps it, and a panel that is already registered is not registered
 * again. It is the same rule the `fallback` flag states declaratively, for
 * the caller that would rather ask than declare.
 *
 * Returns the definition that holds the id afterwards: the incumbent when
 * the id was taken, the new one otherwise.
 */
export function registerPanelIfAbsent(definition: PanelDefinition): PanelDefinition {
  validatePanel(definition);

  const incumbent = panels.get(canonicalPanelId(definition.id));
  if (incumbent) {
    return incumbent;
  }
  return registerPanel(definition);
}

/** Whether a panel is registered under this id, or under a spelling of it. */
export function isPanelRegistered(id: string): boolean {
  return panels.has(canonicalPanelId(id));
}

/** Removes a panel. Returns whether one was there. */
export function unregisterPanel(id: string): boolean {
  const removed = panels.delete(canonicalPanelId(id));
  if (removed) {
    registryChanged();
  }
  return removed;
}

/** Every registered panel, ordered by slot order and then by panel order. */
export function listPanels(): readonly PanelDefinition[] {
  return [...panels.values()].sort((a, b) => {
    if (a.slot !== b.slot) {
      return a.slot < b.slot ? -1 : 1;
    }
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** One panel by id, or `undefined`. */
export function findPanel(id: string): PanelDefinition | undefined {
  return panels.get(canonicalPanelId(id));
}

/** The panels docked in one slot, in order. */
export function panelsInSlot(slot: ShellSlotId): readonly PanelDefinition[] {
  return listPanels().filter((panel) => panel.slot === slot);
}

/** How many panels are registered. */
export function panelCount(): number {
  return panels.size;
}

/**
 * Empties the registry.
 *
 * Only for tests: the shell's panels register themselves when their module is
 * evaluated, and nothing in the running app should empty the list.
 */
export function resetPanelRegistry(): void {
  panels.clear();
  declaredAliases.clear();
  registryChanged();
}

// ------------------------------------------------------------------ notifying

/** Told when the registry's contents change. */
export type PanelRegistryListener = () => void;

const listeners = new Set<PanelRegistryListener>();

/** The registry's version. It changes whenever the registry's contents do. */
let version = 0;

/** Whether a notification is already on its way. */
let notificationScheduled = false;

/**
 * Subscribes to the registry's changes.
 *
 * The shell reads the registry when it paints, so a panel that registers
 * after the first paint is picked up by the next read - but nothing tells
 * React to paint again. This is that telling.
 *
 * The notification is **batched**: a burst of registrations - a module that
 * registers several panels, or a panel that registers itself while the app is
 * running - is one notification, not one per registration, so a late
 * registration cannot start a re-render storm. The notification is also
 * delivered after the current turn, so a registration that happens while
 * React is rendering cannot ask React to render again from inside that
 * render.
 *
 * The returned function unsubscribes. A subscriber that unsubscribes before
 * the notification arrives is not called.
 */
export function subscribeToPanelRegistry(listener: PanelRegistryListener): () => void {
  listeners.add(listener);
  let subscribed = true;
  return () => {
    if (!subscribed) {
      return;
    }
    subscribed = false;
    listeners.delete(listener);
  };
}

/**
 * The registry's version.
 *
 * A number that changes whenever the registry's contents change, which is
 * what a store's snapshot is: the shell can watch it and read the registry
 * again when it moves.
 */
export function panelRegistryVersion(): number {
  return version;
}

/** Records a change and tells the subscribers, once the turn is over. */
function registryChanged(): void {
  version += 1;
  if (listeners.size === 0 || notificationScheduled) {
    return;
  }
  notificationScheduled = true;
  queueMicrotask(() => {
    notificationScheduled = false;
    for (const listener of [...listeners]) {
      listener();
    }
  });
}
