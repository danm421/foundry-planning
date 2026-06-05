"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
}

// Default is only used when a consumer renders outside a provider (e.g. unit
// tests render <SidebarNav> in isolation). The real app always wraps the
// sidebar tree in <SidebarProvider>, so the cookie-backed initial value wins.
const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  setCollapsed: () => {},
  toggle: () => {},
});

// Persist to the same cookie the server layout reads on the next full load,
// so the user's collapsed preference survives a reload / fresh SSR.
function persist(collapsed: boolean): void {
  document.cookie = `sidebar-collapsed=${collapsed ? "1" : "0"}; path=/; max-age=${
    60 * 60 * 24 * 365
  }; samesite=lax`;
}

interface SidebarProviderProps {
  /** Server-read cookie value, so the first client render matches SSR. */
  initialCollapsed: boolean;
  children: ReactNode;
}

export function SidebarProvider({
  initialCollapsed,
  children,
}: SidebarProviderProps): ReactElement {
  const [collapsed, setCollapsedState] = useState(initialCollapsed);

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    persist(next);
  }, []);

  const toggle = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev;
      persist(next);
      return next;
    });
  }, []);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  return useContext(SidebarContext);
}
