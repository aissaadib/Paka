/** React context holding the single panel store for the application. */
import { createContext } from "react";
import type { PanelStore } from "./panelStore";

export const PanelContext = createContext<PanelStore | null>(null);
