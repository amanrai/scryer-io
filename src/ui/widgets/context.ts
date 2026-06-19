import { createContext, useContext } from "react";
import type { WidgetManager } from "./manager.js";

// The per-session widget manager, provided by App and consumed by OutputView so
// widget outputs render without threading the manager through every layer.
export const WidgetManagerContext = createContext<WidgetManager | null>(null);
export const useWidgetManager = () => useContext(WidgetManagerContext);
