/**
 * The workspace: the shell's composition model.
 *
 * The shell used to be a hand-written tree. The menu bar, the tool bar, the
 * tool rail, the canvas, the side column and the status bar were markup, in
 * the order they happened to be written down, and changing the arrangement of
 * the window meant editing that tree. This module makes the arrangement
 * *data*: which parts are shown, in what order, and how big they are. The
 * React shell reads the model and mounts what the model says, so "what is
 * mounted and where" is a value that can be stored, compared and tested.
 *
 * Three rules shape the model.
 *
 *  1. **A window is not a drawing.** Nothing here reaches the document: no
 *     history step, no revision bump, no dirty flag, no project file. The
 *     same rule the brush settings and the grid follow.
 *  2. **The wave's contracts decide the rest.** A panel's slot comes from
 *     `core/shell/slots.ts`, the panel itself comes from the registry in
 *     `core/shell/panelRegistry.ts`, and which panels are shown comes from the
 *     preferences in `core/shell/preferences.ts`. This module composes those
 *     contracts; it does not restate them.
 *  3. **The file is untrusted.** A workspace document is read field by field:
 *     a missing field takes its default, an out-of-range size is clamped, a
 *     malformed value takes its default, and a document from a newer version
 *     is ignored wholesale, because its meaning is unknown rather than wrong.
 *
 * The module is pure: no React, no DOM, no engine. That is what makes the
 * whole arrangement testable without a browser.
 */

import { clamp } from "../../utils/math";
import { asRecord } from "../../utils/record";
import type { PanelDefinition } from "../shell/panelRegistry";
import {
  DEFAULT_SHELL_PREFERENCES,
  type ShellPreferences,
} from "../shell/preferences";
import {
  DEFAULT_SHELL_LAYOUT,
  findPlacement,
  hidePanel,
  isShellSlotId,
  placePanel,
  placementsInSlot,
  type ShellLayout,
  type ShellSlotId,
} from "../shell/slots";

/** The version of the workspace document this build reads and writes. */
export const WORKSPACE_VERSION = 1;

/**
 * The regions of the shell.
 *
 * A region is where a part sits in the frame: the chrome above the canvas,
 * the canvas's own row, and the chrome below it. The order of the parts
 * inside a region is the model's; the order of the regions is the frame's.
 */
export type WorkspaceRegion = "top" | "body" | "bottom";

/** Every region, in the order the shell lays them out. */
export const WORKSPACE_REGIONS: readonly WorkspaceRegion[] = Object.freeze([
  "top",
  "body",
  "bottom",
]);

/**
 * The shell's parts.
 *
 * The set is closed: a part id this build does not know is dropped when a
 * document is read, rather than mounted as an empty hole in the frame.
 */
export type WorkspacePartId =
  | "menu-bar"
  | "tool-bar"
  | "tool-rail"
  | "canvas"
  | "side-column"
  | "status-bar";

/** Every part, in the order the shell lays them out. */
export const WORKSPACE_PART_IDS: readonly WorkspacePartId[] = Object.freeze([
  "menu-bar",
  "tool-bar",
  "tool-rail",
  "canvas",
  "side-column",
  "status-bar",
]);

/**
 * How a part takes the space it is given.
 *
 * A number is a fixed size in CSS pixels; `"auto"` means the part is as big as
 * its content; `"fill"` means the part takes what is left. A part's kind is
 * fixed by the part: the canvas always fills, the tool bar is always as tall
 * as it needs to be.
 */
export type WorkspacePartSize = number | "auto" | "fill";

/** What one part of the shell is, and how it behaves. */
export interface WorkspacePartSpec {
  /** The part's id. */
  readonly id: WorkspacePartId;
  /** The region the part sits in. */
  readonly region: WorkspaceRegion;
  /** The name the part is known by. */
  readonly label: string;
  /** The size the shell uses when nothing else has been chosen. */
  readonly defaultSize: WorkspacePartSize;
  /** The smallest fixed size, in CSS pixels. Zero when the part is not fixed. */
  readonly minSize: number;
  /** The largest fixed size, in CSS pixels. Zero when the part is not fixed. */
  readonly maxSize: number;
}

/**
 * The parts, with the sizes the shell has always used.
 *
 * The fixed sizes are the ones in `app/app.css`: a 30 px menu bar, a 40 px
 * tool rail, a 216 px side column and a 22 px status bar. They are stated
 * here as well so that the model is the single answer to "how big is the tool
 * rail", and so that a size the stylesheet later changes can be changed here
 * instead of in two places.
 */
export const WORKSPACE_PART_SPECS: readonly WorkspacePartSpec[] = Object.freeze([
  {
    id: "menu-bar",
    region: "top",
    label: "Menu bar",
    defaultSize: 30,
    minSize: 24,
    maxSize: 48,
  },
  {
    id: "tool-bar",
    region: "top",
    label: "Tool bar",
    defaultSize: "auto",
    minSize: 0,
    maxSize: 0,
  },
  {
    id: "tool-rail",
    region: "body",
    label: "Tool rail",
    defaultSize: 40,
    minSize: 32,
    maxSize: 96,
  },
  {
    id: "canvas",
    region: "body",
    label: "Canvas",
    defaultSize: "fill",
    minSize: 0,
    maxSize: 0,
  },
  {
    id: "side-column",
    region: "body",
    label: "Side column",
    defaultSize: 216,
    minSize: 160,
    maxSize: 480,
  },
  {
    id: "status-bar",
    region: "bottom",
    label: "Status bar",
    defaultSize: 22,
    minSize: 18,
    maxSize: 48,
  },
]);

/** One part of the shell, as the model holds it. */
export interface WorkspacePartSettings {
  /** The part's id. */
  readonly id: WorkspacePartId;
  /** Whether the part is mounted. */
  readonly shown: boolean;
  /** The part's position inside its region; lower numbers come first. */
  readonly order: number;
  /** How the part takes its space. */
  readonly size: WorkspacePartSize;
}

/** The workspace as it is stored. */
export interface WorkspaceSettings {
  /** The document version. Always {@link WORKSPACE_VERSION} after loading. */
  readonly version: number;
  /** The parts, one entry per known part. */
  readonly parts: readonly WorkspacePartSettings[];
}

/** The part a fresh installation starts from. */
function defaultPart(spec: WorkspacePartSpec, order: number): WorkspacePartSettings {
  return {
    id: spec.id,
    shown: true,
    order,
    size: spec.defaultSize,
  };
}

/**
 * The workspace a fresh installation starts from.
 *
 * Every part is shown, in the order the shell has always used: the menu bar
 * and the tool bar above the canvas, the tool rail, the canvas and the side
 * column in its row, and the status bar below.
 */
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = Object.freeze({
  version: WORKSPACE_VERSION,
  parts: Object.freeze([
    defaultPart(WORKSPACE_PART_SPECS[0], 0),
    defaultPart(WORKSPACE_PART_SPECS[1], 1),
    defaultPart(WORKSPACE_PART_SPECS[2], 0),
    defaultPart(WORKSPACE_PART_SPECS[3], 1),
    defaultPart(WORKSPACE_PART_SPECS[4], 2),
    defaultPart(WORKSPACE_PART_SPECS[5], 0),
  ]),
});

/** The spec of one part, or `undefined` when the id is not one of ours. */
export function findWorkspacePartSpec(
  id: WorkspacePartId,
): WorkspacePartSpec | undefined {
  return WORKSPACE_PART_SPECS.find((spec) => spec.id === id);
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function orderOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
}

/**
 * The size a part is given, clamped into the range the part supports.
 *
 * A fixed part's size is a number of CSS pixels, clamped: a file written by a
 * build with a wider range is clamped rather than refused, because a slightly
 * wrong interface size is a much smaller problem than a failed start. The
 * parts that are not fixed keep their own kind whatever the file says.
 */
export function normalizeWorkspacePartSize(
  spec: WorkspacePartSpec,
  value: unknown,
): WorkspacePartSize {
  if (typeof spec.defaultSize !== "number") {
    return spec.defaultSize;
  }
  const pixels =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : spec.defaultSize;
  return Math.round(clamp(pixels, spec.minSize, spec.maxSize));
}

/**
 * Turns whatever was in the file into a usable workspace.
 *
 * Never throws and never rejects: a value it cannot make sense of takes its
 * default, and a document from a newer version is ignored entirely.
 */
export function normalizeWorkspaceSettings(value: unknown): WorkspaceSettings {
  const record = asRecord(value);
  if (record === null) {
    return DEFAULT_WORKSPACE_SETTINGS;
  }

  const version = record.version;
  if (
    typeof version === "number" &&
    Number.isFinite(version) &&
    version > WORKSPACE_VERSION
  ) {
    // Written by a newer Paka. Its meaning is unknown rather than wrong, so
    // the whole document is ignored and the defaults are used.
    return DEFAULT_WORKSPACE_SETTINGS;
  }

  const parts = asRecord(record.parts);
  const normalized: WorkspacePartSettings[] = [];
  for (const spec of WORKSPACE_PART_SPECS) {
    const fallback = defaultPart(
      spec,
      DEFAULT_WORKSPACE_SETTINGS.parts.find((part) => part.id === spec.id)?.order ?? 0,
    );
    const entry = parts === null ? null : asRecord(parts[spec.id]);
    if (entry === null) {
      normalized.push(fallback);
      continue;
    }
    normalized.push({
      id: spec.id,
      shown: booleanOr(entry.shown, fallback.shown),
      order: orderOr(entry.order, fallback.order),
      size: normalizeWorkspacePartSize(spec, entry.size),
    });
  }

  return { version: WORKSPACE_VERSION, parts: normalized };
}

/**
 * Parses a workspace document.
 *
 * `null` - nothing stored yet - and a document that is not valid JSON both
 * yield the defaults: a broken workspace must not stop the editor from
 * starting.
 */
export function parseWorkspaceSettings(text: string | null): WorkspaceSettings {
  if (text === null) {
    return DEFAULT_WORKSPACE_SETTINGS;
  }
  try {
    return normalizeWorkspaceSettings(JSON.parse(text) as unknown);
  } catch {
    return DEFAULT_WORKSPACE_SETTINGS;
  }
}

/** The plain object a workspace is written as. */
export function workspaceSettingsDocument(
  settings: WorkspaceSettings,
): Record<string, unknown> {
  const parts: Record<string, unknown> = {};
  for (const part of settings.parts) {
    parts[part.id] = { shown: part.shown, order: part.order, size: part.size };
  }
  return { version: WORKSPACE_VERSION, parts };
}

/** Field-wise comparison, so an unchanged workspace is never written again. */
export function workspaceSettingsEqual(
  a: WorkspaceSettings,
  b: WorkspaceSettings,
): boolean {
  if (a.version !== b.version || a.parts.length !== b.parts.length) {
    return false;
  }
  return a.parts.every((part, index) => {
    const other = b.parts[index];
    return (
      part.id === other.id &&
      part.shown === other.shown &&
      part.order === other.order &&
      part.size === other.size
    );
  });
}

/** One part of a workspace, or `undefined` when the workspace does not have it. */
export function findWorkspacePart(
  settings: WorkspaceSettings,
  id: WorkspacePartId,
): WorkspacePartSettings | undefined {
  return settings.parts.find((part) => part.id === id);
}

function replacePart(
  settings: WorkspaceSettings,
  id: WorkspacePartId,
  change: (part: WorkspacePartSettings) => WorkspacePartSettings,
): WorkspaceSettings {
  let touched = false;
  const parts = settings.parts.map((part) => {
    if (part.id !== id) {
      return part;
    }
    touched = true;
    return change(part);
  });
  if (!touched) {
    return settings;
  }
  return { version: settings.version, parts };
}

/** Shows or hides a part. */
export function setWorkspacePartShown(
  settings: WorkspaceSettings,
  id: WorkspacePartId,
  shown: boolean,
): WorkspaceSettings {
  return replacePart(settings, id, (part) =>
    part.shown === shown ? part : { ...part, shown },
  );
}

/** Moves a part inside its region. */
export function setWorkspacePartOrder(
  settings: WorkspaceSettings,
  id: WorkspacePartId,
  order: number,
): WorkspaceSettings {
  const next = orderOr(order, 0);
  return replacePart(settings, id, (part) =>
    part.order === next ? part : { ...part, order: next },
  );
}

/** Sets how big a part is. The size is clamped into the part's range. */
export function setWorkspacePartSize(
  settings: WorkspaceSettings,
  id: WorkspacePartId,
  size: WorkspacePartSize,
): WorkspaceSettings {
  const spec = findWorkspacePartSpec(id);
  if (spec === undefined) {
    return settings;
  }
  const next = normalizeWorkspacePartSize(spec, size);
  return replacePart(settings, id, (part) =>
    part.size === next ? part : { ...part, size: next },
  );
}

/* ------------------------------------------------------------------ panels */

/** One panel in the composition. */
export interface WorkspacePanel {
  /** The panel's registry id. */
  readonly id: string;
  /** The slot the panel is docked in. */
  readonly slot: ShellSlotId;
  /** The panel's position inside its slot. */
  readonly order: number;
  /** Whether the panel is shown. */
  readonly visible: boolean;
}

/**
 * The composition: what the shell is made of.
 *
 * The parts are the shell's own rows; the panels are the side panels the
 * registry knows about, and the layout is the shell's own layout type, so the
 * composition is expressed in the wave's terms rather than in a second set of
 * them.
 */
export interface WorkspaceComposition {
  /** The parts, grouped by region and ordered inside each region. */
  readonly parts: readonly WorkspacePartSettings[];
  /** The panels, with their slot and their visibility. */
  readonly panels: readonly WorkspacePanel[];
  /** Where every panel is docked. */
  readonly layout: ShellLayout;
}

/**
 * The order the panels are shown in.
 *
 * The preferences' panel order comes first, in the order the user chose, and
 * the panels that are not in it follow in their registry order. A panel the
 * preferences name but the registry does not know is simply skipped.
 */
function panelOrders(
  preferences: ShellPreferences,
  panels: readonly PanelDefinition[],
): Map<string, number> {
  const orders = new Map<string, number>();
  let next = 0;
  for (const id of preferences.panelOrder) {
    if (!orders.has(id)) {
      orders.set(id, next);
      next += 1;
    }
  }
  const rest = panels
    .filter((panel) => !orders.has(panel.id))
    .sort((a, b) =>
      a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
  for (const panel of rest) {
    orders.set(panel.id, next);
    next += 1;
  }
  return orders;
}

/**
 * Where every panel is docked.
 *
 * A panel's slot comes from the preferences when they name one and from the
 * registry's own default otherwise; the slot vocabulary is the shell's, so an
 * unknown slot falls back rather than inventing a place to put the panel. A
 * panel the user hid is hidden through the shell's own rule, which keeps the
 * panel and remembers where it came from.
 */
function buildLayout(
  preferences: ShellPreferences,
  panels: readonly PanelDefinition[],
): ShellLayout {
  const orders = panelOrders(preferences, panels);
  let layout = DEFAULT_SHELL_LAYOUT;
  for (const panel of panels) {
    const preferred = preferences.panelSlots[panel.id];
    const slot =
      preferred !== undefined && isShellSlotId(preferred) ? preferred : panel.slot;
    layout = placePanel(layout, panel.id, slot, orders.get(panel.id) ?? panel.order);
  }
  for (const id of preferences.hiddenPanels) {
    if (findPlacement(layout, id) !== undefined) {
      layout = hidePanel(layout, id);
    }
  }
  return layout;
}

/**
 * The composition of the shell.
 *
 * The parts come from the workspace settings; the panels come from the
 * registry, placed by the preferences. The preferences' status bar switch is
 * honoured as well as the model's own: a switch that says "no status bar"
 * wins, so the shell's own preference is never quietly ignored.
 */
export function composeWorkspace(
  settings: WorkspaceSettings,
  preferences: ShellPreferences = DEFAULT_SHELL_PREFERENCES,
  panels: readonly PanelDefinition[] = [],
): WorkspaceComposition {
  const layout = buildLayout(preferences, panels);
  const resolved: WorkspacePanel[] = [];
  for (const panel of panels) {
    const placement = findPlacement(layout, panel.id);
    if (placement === undefined) {
      continue;
    }
    resolved.push({
      id: placement.panelId,
      slot: placement.slot,
      order: placement.order,
      visible: placement.slot !== "hidden",
    });
  }

  const parts = WORKSPACE_REGIONS.flatMap((region) =>
    workspacePartsInRegion(settings, region),
  ).map((part) =>
    part.id === "status-bar" && !preferences.showStatusBar
      ? { ...part, shown: false }
      : part,
  );

  // The panels are listed the way the registry lists them: by slot, then by
  // their order in it, then by id.
  resolved.sort((a, b) => {
    if (a.slot !== b.slot) {
      return a.slot < b.slot ? -1 : 1;
    }
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return { parts, panels: resolved, layout };
}

/** The parts of a region, in the order the shell shows them. */
export function workspacePartsInRegion(
  settings: WorkspaceSettings,
  region: WorkspaceRegion,
): readonly WorkspacePartSettings[] {
  return settings.parts
    .filter((part) => findWorkspacePartSpec(part.id)?.region === region)
    .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1));
}

/** The parts of a composition's region, in the order the shell shows them. */
export function compositionPartsInRegion(
  composition: WorkspaceComposition,
  region: WorkspaceRegion,
): readonly WorkspacePartSettings[] {
  return composition.parts.filter(
    (part) => findWorkspacePartSpec(part.id)?.region === region,
  );
}

/** The panels docked in one slot, in order. */
export function compositionPanelsInSlot(
  composition: WorkspaceComposition,
  slot: ShellSlotId,
): readonly WorkspacePanel[] {
  const visible = new Map(
    composition.panels.map((panel) => [panel.id, panel] as const),
  );
  return placementsInSlot(composition.layout, slot)
    .map((placement) => visible.get(placement.panelId))
    .filter((panel): panel is WorkspacePanel => panel !== undefined);
}

/* -------------------------------------------------------------------- grid */

/** The grid the shell lays the frame out with. */
export interface WorkspaceGrid {
  /** One track per row of the frame. */
  readonly rows: string;
  /** One track per column of the canvas's row. */
  readonly columns: string;
}

function rowTrack(size: WorkspacePartSize): string {
  return typeof size === "number" ? `${size}px` : size;
}

function columnTrack(size: WorkspacePartSize): string {
  if (typeof size === "number") {
    return `${size}px`;
  }
  return size === "fill" ? "minmax(0, 1fr)" : "auto";
}

/**
 * The grid the composition asks for.
 *
 * The frame is a grid of rows: a track per chrome part above the canvas, the
 * canvas's own row, and a track per chrome part below it. The canvas's row is
 * a grid of columns: a track per part in it.
 *
 * The tracks are the sizes the model holds, so hiding a part removes its
 * track and the space it took goes back to the canvas.
 */
export function workspaceGrid(composition: WorkspaceComposition): WorkspaceGrid {
  const rows: string[] = [];
  for (const part of compositionPartsInRegion(composition, "top")) {
    if (part.shown) {
      rows.push(rowTrack(part.size));
    }
  }
  rows.push("1fr");
  for (const part of compositionPartsInRegion(composition, "bottom")) {
    if (part.shown) {
      rows.push(rowTrack(part.size));
    }
  }

  const columns: string[] = [];
  for (const part of compositionPartsInRegion(composition, "body")) {
    if (part.shown) {
      columns.push(columnTrack(part.size));
    }
  }

  return { rows: rows.join(" "), columns: columns.length === 0 ? "none" : columns.join(" ") };
}
