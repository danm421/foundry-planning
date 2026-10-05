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

export type ForgeTab = "chat" | "hub";
/** A video the Hub should open (set by a ▶ Watch card in Chat). The nonce
 *  makes a second click on the same card open it again. */
export type HubTarget = { slug: string; at?: number; nonce: number };

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
  /** Which tab of the Forge window is showing. In-memory only. */
  tab: ForgeTab;
  setTab: (t: ForgeTab) => void;
  hubTarget: HubTarget | null;
  /** Switch to the Knowledge Hub and open a video, optionally at a chapter. */
  openHubVideo: (slug: string, at?: number) => void;
  /** Text the Hub hands to Chat ("Ask in Chat instead"); the panel moves it
   *  into the composer, then clears it. */
  chatDraft: string | null;
  askInChat: (text: string) => void;
  clearChatDraft: () => void;
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

  const [tab, setTab] = useState<ForgeTab>("chat");
  const [hubTarget, setHubTarget] = useState<HubTarget | null>(null);
  const [chatDraft, setChatDraft] = useState<string | null>(null);

  const openHubVideo = useCallback((slug: string, at?: number) => {
    setHubTarget((prev) => ({ slug, at, nonce: (prev?.nonce ?? 0) + 1 }));
    setTab("hub");
  }, []);
  const askInChat = useCallback((text: string) => {
    setChatDraft(text);
    setTab("chat");
  }, []);
  const clearChatDraft = useCallback(() => setChatDraft(null), []);

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
        tab,
        setTab,
        hubTarget,
        openHubVideo,
        chatDraft,
        askInChat,
        clearChatDraft,
      }}
    >
      {children}
    </ForgeCtx.Provider>
  );
}
