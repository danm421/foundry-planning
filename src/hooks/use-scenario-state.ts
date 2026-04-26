"use client";

// NOTE: localStorage is one-way write only here — it's a debugging/restore
// breadcrumb, not a source of truth. The URL is the source of truth, and the
// hook deliberately does not read localStorage on mount.

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

/**
 * Reads/writes the `?scenario=<sid>` URL searchParam and mirrors it to
 * localStorage scoped per client.
 *
 * `null` means the base case — no `?scenario=` in the URL, no localStorage
 * entry. This keeps the URL clean and bookmarkable.
 */
export function useScenarioState(clientId: string) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const scenarioId = params.get("scenario") ?? null;

  // `useSearchParams()` returns a new instance every render, so we stash it in
  // a ref (updated in an effect to satisfy `react-hooks/refs`) and read through
  // that — keeping `setScenario` identity stable across re-renders so consumer
  // memoization (e.g. `<ScenarioChipRow>`) holds.
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const setScenario = useCallback(
    (next: string | null) => {
      const newParams = new URLSearchParams(paramsRef.current);
      if (next == null) newParams.delete("scenario");
      else newParams.set("scenario", next);
      const qs = newParams.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      router.push(url);
      if (typeof window !== "undefined") {
        const key = `scenario:${clientId}`;
        if (next == null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, next);
      }
    },
    [pathname, router, clientId],
  );

  return { scenarioId, setScenario };
}
