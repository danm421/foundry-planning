"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getWalkthrough } from "@/domain/forge/help/catalog";
import { WalkthroughContext, type WalkthroughContextValue } from "./walkthrough-context";
import { matchesWalkthroughRoute } from "./walkthrough-route-match";
import { logWalkthroughEvent } from "./walkthrough-telemetry";
import { WalkthroughOverlay } from "./walkthrough-overlay";

const STORAGE_KEY = "foundry.walkthrough";

/** Tour position survives a hard reload. The tour spans several routes, and a
 *  reload mid-flow would otherwise end it silently with no way back in. */
function readPersisted(): { id: string; stepIndex: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: unknown; stepIndex?: unknown };
    if (typeof parsed.id !== "string" || typeof parsed.stepIndex !== "number") return null;
    return { id: parsed.id, stepIndex: parsed.stepIndex };
  } catch {
    return null;
  }
}

function clearPersisted(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode) — nothing to clear */
  }
}

/** Navigate to a step's page unless we're already on it. A pattern containing
 *  a ":" wildcard cannot be turned back into a real URL, so those steps never
 *  navigate — they only spotlight, and rely on the preceding step's click
 *  having already put the user on that route. */
export function navigateToStep(
  page: string,
  pathname: string,
  push: (href: string) => void,
): void {
  if (matchesWalkthroughRoute(page, pathname)) return;
  if (page.includes(":")) return;
  push(page);
}

export function WalkthroughProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);

  const active = activeId ? getWalkthrough(activeId) ?? null : null;
  const currentStep = active ? active.steps[stepIndex] ?? null : null;

  // Restore after mount, never during render. The server has no sessionStorage
  // and renders no overlay, so seeding these in a useState initialiser would
  // diverge from the server HTML and trip a hydration mismatch on exactly the
  // path this persistence exists for — a hard reload mid-tour.
  useEffect(() => {
    const persisted = readPersisted();
    if (!persisted) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- rehydration from sessionStorage is a mount-time side effect by construction: the value is unavailable during render on the server, so it cannot be a derived render value.
    setActiveId(persisted.id);
    setStepIndex(persisted.stepIndex);
  }, []);

  // Mirror position into sessionStorage on every change. This only ever
  // writes; clearing is done at the two points a tour actually ends (exit and
  // completion) so that this effect cannot wipe the stored tour on the mount
  // pass that runs before the restored state above has landed.
  useEffect(() => {
    if (typeof window === "undefined" || !activeId) return;
    try {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ id: activeId, stepIndex }),
      );
    } catch {
      /* storage unavailable (private mode) — the tour just won't survive a reload */
    }
  }, [activeId, stepIndex]);

  const exit = useCallback(() => {
    if (activeId) logWalkthroughEvent("abandoned", activeId, stepIndex);
    setActiveId(null);
    setStepIndex(0);
    clearPersisted();
  }, [activeId, stepIndex]);

  const start = useCallback(
    (walkthroughId: string) => {
      const w = getWalkthrough(walkthroughId);
      if (!w) return;
      setActiveId(walkthroughId);
      setStepIndex(0);
      logWalkthroughEvent("started", walkthroughId, 0);
      if (w.steps[0]) navigateToStep(w.steps[0].page, pathname, router.push);
    },
    [pathname, router],
  );

  const next = useCallback(() => {
    if (!active) return;
    const nextIndex = stepIndex + 1;
    if (nextIndex >= active.steps.length) {
      logWalkthroughEvent("completed", active.id, stepIndex);
      setActiveId(null);
      setStepIndex(0);
      clearPersisted();
      return;
    }
    setStepIndex(nextIndex);
    navigateToStep(active.steps[nextIndex].page, pathname, router.push);
  }, [active, stepIndex, pathname, router]);

  const back = useCallback(() => {
    if (!active || stepIndex === 0) return;
    const prevIndex = stepIndex - 1;
    setStepIndex(prevIndex);
    navigateToStep(active.steps[prevIndex].page, pathname, router.push);
  }, [active, stepIndex, pathname, router]);

  // advanceOn:"navigate" — advance when the target route arrives.
  useEffect(() => {
    if (!currentStep || currentStep.advanceOn !== "navigate" || !currentStep.nextPage) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- navigate-driven auto-advance: the tour must step forward as soon as the URL matches the expected next route, which is inherently a synchronous reaction to URL-derived state (pathname), not a derivable render value.
    if (matchesWalkthroughRoute(currentStep.nextPage, pathname)) next();
  }, [currentStep, pathname, next]);

  // Esc ends the tour anytime.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, exit]);

  const value: WalkthroughContextValue = useMemo(
    () => ({ active, stepIndex, currentStep, start, next, back, exit }),
    [active, stepIndex, currentStep, start, next, back, exit],
  );

  return (
    <WalkthroughContext.Provider value={value}>
      {children}
      {active && <WalkthroughOverlay />}
    </WalkthroughContext.Provider>
  );
}
