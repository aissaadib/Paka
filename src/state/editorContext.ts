/** React context holding the single editor instance for the application. */

import { createContext } from "react";
import type { Editor } from "./editorStore";

export const EditorContext = createContext<Editor | null>(null);
