"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * Returns a `withScenario(path)` function that appends the active
 * `?scenario=<id>` from the current URL onto an outbound nav href.
 *
 * Use in nav chrome (sidebar, tab bars, breadcrumbs) so an active scenario
 * survives intra-client navigation. If the path already has its own
 * `scenario` param, the caller's value wins (no override).
 */
export function useScenarioPreservingHref(): (path: string) => string {
  const params = useSearchParams();
  const scenarioId = params.get("scenario") ?? "";

  return useCallback(
    (path: string) => {
      if (!scenarioId) return path;
      const [pathname, existing = ""] = path.split("?", 2);
      const qs = new URLSearchParams(existing);
      if (qs.has("scenario")) return path;
      qs.set("scenario", scenarioId);
      return `${pathname}?${qs.toString()}`;
    },
    [scenarioId],
  );
}
