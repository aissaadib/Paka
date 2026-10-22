/**
 * The panel chrome context.
 *
 * A panel in the stack is told, through this context, what the shell is
 * doing with it: whether it is hidden, whether it is folded to its header,
 * and how to fold it. The generic `Panel` chrome reads it, so a panel
 * component does not have to know anything about the panel manager - it
 * renders its content and the shell folds and hides it.
 *
 * The context is `null` for a panel that is not in a stack, which is what
 * makes the chrome degrade gracefully: such a panel has no fold button and
 * is never hidden.
 */
import { createContext } from "react";

export interface PanelChromeState {
  /** The panel is hidden: it keeps its place in the stack but takes no space. */
  readonly hidden: boolean;
  /** The panel is folded to its header. */
  readonly collapsed: boolean;
  /** The panel can be folded. */
  readonly collapsible: boolean;
  /** The panel takes the leftover height of the column. */
  readonly grow: boolean;
  /** Folds the panel, or unfolds it. */
  readonly onToggleCollapsed: () => void;
}

export const PanelChromeContext = createContext<PanelChromeState | null>(null);
