// src/components/portal/portal-mode-context.tsx
"use client";

import { createContext, useCallback, useContext } from "react";
import type { ReactNode } from "react";
import { PORTAL_AS_CLIENT_HEADER } from "@/lib/portal/resolve-portal-client";

export type PortalMode = { mode: "client" | "advisor"; clientId: string };

const PortalModeContext = createContext<PortalMode>({ mode: "client", clientId: "" });

export function PortalModeProvider({
  value,
  children,
}: {
  value: PortalMode;
  children: ReactNode;
}) {
  return (
    <PortalModeContext.Provider value={value}>
      {children}
    </PortalModeContext.Provider>
  );
}

export function usePortalMode(): PortalMode {
  return useContext(PortalModeContext);
}

/**
 * fetch wrapper for portal client components. In advisor "act as client" mode it
 * attaches the x-portal-as-client header so `/api/portal/*` routes can resolve
 * the target client; in client mode it is a plain fetch.
 */
export function usePortalFetch() {
  const { mode, clientId } = usePortalMode();
  return useCallback(
    (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (mode !== "advisor") return fetch(input, init);
      const headers = new Headers(init.headers);
      headers.set(PORTAL_AS_CLIENT_HEADER, clientId);
      return fetch(input, { ...init, headers });
    },
    [mode, clientId],
  );
}
