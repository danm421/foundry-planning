"use client";

// NOTE: localStorage is one-way write only — it's a debugging/restore
// breadcrumb scoped per client + side, not a source of truth. The URL is
// the source of truth and the hook deliberately does not read localStorage
// on mount. Mirrors `useScenarioState`'s contract.

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * Reads/writes the compare-panel URL params:
 *   - `left=<sid|snap:<id>|"base">`  (default: "base")
 *   - `right=<sid|snap:<id>|"base">` (default: "base")
 *   - `toggles=g1,g2`                 (comma-separated; right side only at parse time)
 *
 * Returns the raw left/right strings plus a `Set<string>` of toggle group ids
 * and stable `setSide` / `setToggle` mutators that round-trip through the URL
 * and (for `setSide`) mirror to localStorage scoped by clientId+side.
 */
export function useCompareState(clientId: string) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const left = params.get("left") ?? "base";
  const right = params.get("right") ?? "base";
  const togglesStr = params.get("toggles") ?? "";
  const toggleSet = useMemo(
    () => new Set(togglesStr.split(",").filter(Boolean)),
    [togglesStr],
  );

  // `useSearchParams()` returns a new instance every render, so we stash it
  // (plus the derived toggleSet) in refs — updated in an effect to satisfy
  // `react-hooks/refs` — and read through them so `setSide` / `setToggle`
  // keep stable identity across re-renders.
  const paramsRef = useRef(params);
  const toggleSetRef = useRef(toggleSet);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);
  useEffect(() => {
    toggleSetRef.current = toggleSet;
  }, [toggleSet]);

  const setSide = useCallback(
    (side: "left" | "right", value: string | null) => {
      const np = new URLSearchParams(paramsRef.current);
      if (value == null || value === "base") {
        np.delete(side);
      } else {
        np.set(side, value);
      }
      const qs = np.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          `compare:${clientId}:${side}`,
          value ?? "base",
        );
      }
    },
    [pathname, router, clientId],
  );

  const setToggle = useCallback(
    (groupId: string, on: boolean) => {
      const np = new URLSearchParams(paramsRef.current);
      const next = new Set(toggleSetRef.current);
      if (on) next.add(groupId);
      else next.delete(groupId);
      if (next.size === 0) np.delete("toggles");
      else np.set("toggles", [...next].join(","));
      const qs = np.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router],
  );

  return { left, right, toggleSet, setSide, setToggle };
}
