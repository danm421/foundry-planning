// src/components/forge/forge-provider.tsx
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
  clientId: string | null;
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
 * Holds forge open/close state and current scope (clientId, live scenarioId,
 * pathname). Coordinates mutual exclusion with the scenario drawer: opening the
 * forge closes the drawer so only one right-edge panel (shared z-30 layer) is
 * open at a time. Mounted in ClientLayout as a sibling of ScenarioDrawerProvider.
 */
export function ForgeProvider({
  clientId,
  children,
}: {
  clientId: string | null;
  children: ReactNode;
}) {
  // Call hooks unconditionally (Rules of Hooks).
  // Pass a stable sentinel when global so useScenarioState always has a string arg.
  const liveScenario = useScenarioState(clientId ?? "__none__");
  const pathname = usePathname();
  const drawer = useScenarioDrawerOptional();
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    if (clientId) drawer?.setOpen(false); // mutual exclusion only in client scope
    setIsOpen(true);
  }, [drawer, clientId]);

  const close = useCallback(() => setIsOpen(false), []);

  const toggle = useCallback(() => {
    setIsOpen((wasOpen) => {
      if (!wasOpen && clientId) drawer?.setOpen(false);
      return !wasOpen;
    });
  }, [drawer, clientId]);

  return (
    <ForgeCtx.Provider
      value={{
        clientId,
        scenarioId: clientId ? liveScenario.scenarioId : null,
        pathname,
        open,
        close,
        toggle,
        isOpen,
      }}
    >
      {children}
    </ForgeCtx.Provider>
  );
}
