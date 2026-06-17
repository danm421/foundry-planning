// src/components/copilot/forge-provider.tsx
"use client";

import {
  createContext,
  useContext,
  useCallback,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useScenarioState } from "@/hooks/use-scenario-state";
import { useScenarioDrawerOptional } from "@/components/scenario/scenario-drawer-provider";

interface ForgeContextValue {
  clientId: string;
  /** Live scenario id from the URL (null = base case). Re-read every render so
   *  each turn captures the current scope (scenario-drift guard). */
  scenarioId: string | null;
  /** Current pathname — drives the "current page" context chip. */
  pathname: string;
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: boolean;
}

const ForgeCtx = createContext<ForgeContextValue | null>(null);

export function useForge(): ForgeContextValue {
  const ctx = useContext(ForgeCtx);
  if (!ctx) throw new Error("useForge must be used within ForgeProvider");
  return ctx;
}

/**
 * Holds copilot open/close state and current scope (clientId, live scenarioId,
 * pathname). Coordinates mutual exclusion with the scenario drawer: opening the
 * copilot closes the drawer so only one right-edge panel (shared z-30 layer) is
 * open at a time. Mounted in ClientLayout as a sibling of ScenarioDrawerProvider.
 */
export function ForgeProvider({
  clientId,
  children,
}: {
  clientId: string;
  children: ReactNode;
}) {
  const { scenarioId } = useScenarioState(clientId);
  const pathname = usePathname();
  const drawer = useScenarioDrawerOptional();
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    drawer?.setOpen(false); // mutual exclusion: close the scenario drawer
    setIsOpen(true);
  }, [drawer]);

  const close = useCallback(() => setIsOpen(false), []);

  const toggle = useCallback(() => {
    setIsOpen((wasOpen) => {
      if (!wasOpen) drawer?.setOpen(false);
      return !wasOpen;
    });
  }, [drawer]);

  return (
    <ForgeCtx.Provider
      value={{ clientId, scenarioId, pathname, open, close, toggle, isOpen }}
    >
      {children}
    </ForgeCtx.Provider>
  );
}
