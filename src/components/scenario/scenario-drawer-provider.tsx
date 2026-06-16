"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

type ScenarioDrawerUI = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};

const ScenarioDrawerCtx = createContext<ScenarioDrawerUI | null>(null);

/**
 * Read the changes-drawer open state. Throws outside the provider so a
 * missing-provider bug surfaces loudly (unlike the no-op scenario-mode
 * context — here a silently-dead handle would be confusing).
 */
export function useScenarioDrawer(): ScenarioDrawerUI {
  const ctx = useContext(ScenarioDrawerCtx);
  if (!ctx) {
    throw new Error("useScenarioDrawer must be used within ScenarioDrawerProvider");
  }
  return ctx;
}

/**
 * Like `useScenarioDrawer` but returns `null` outside the provider instead of
 * throwing. Used by the copilot provider to coordinate mutual exclusion with
 * the drawer (close the drawer when the copilot opens) without hard-coupling
 * the copilot's mount to the drawer being present.
 */
export function useScenarioDrawerOptional(): ScenarioDrawerUI | null {
  return useContext(ScenarioDrawerCtx);
}

/**
 * Holds the right-edge changes drawer's open/closed flag. Mounted in
 * ClientLayout so the state survives client-side navigation between sibling
 * pages (the layout doesn't unmount). Defaults closed; a full reload resets it.
 */
export function ScenarioDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  return (
    <ScenarioDrawerCtx.Provider value={{ open, setOpen, toggle }}>
      {children}
    </ScenarioDrawerCtx.Provider>
  );
}
