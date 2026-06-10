"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Seeds a report body's active "view" from the `?view=` query param (set by the
 * topbar's nested view flyout) and keeps it in sync when the param changes,
 * while still letting in-page tab clicks drive local state. An absent or unknown
 * param falls back to `fallback`.
 *
 * This is the third nav tier ("views") expressed as a query param rather than a
 * route segment — the lightweight counterpart to the Cash Flow → Ledgers route
 * split. See `Topbar`'s nested flyout for the link side.
 */
export function useViewParam<T extends string>(
  valid: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const params = useSearchParams();
  const raw = params?.get("view") ?? null;
  const fromUrl = (valid as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;

  const [view, setView] = useState<T>(fromUrl);
  useEffect(() => {
    setView(fromUrl);
  }, [fromUrl]);

  return [view, setView];
}
