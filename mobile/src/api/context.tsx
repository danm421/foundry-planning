// mobile/src/api/context.tsx
//
// React context that hands the typed API client (bound to Clerk's
// getToken) down to screens. Mounted in Task 7; consumed in Tasks 9-10.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuth } from "@clerk/clerk-expo";
import { createApiClient, type ApiClient } from "./client";

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001",
        getToken: () => getToken(),
      }),
    [getToken],
  );
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi outside ApiProvider");
  return api;
}
