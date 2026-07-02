"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getWalkthrough } from "@/domain/forge/help/catalog";
import { WalkthroughContext, type WalkthroughContextValue } from "./walkthrough-context";
import { matchesWalkthroughRoute } from "./walkthrough-route-match";
import { logWalkthroughEvent } from "./walkthrough-telemetry";
import { WalkthroughOverlay } from "./walkthrough-overlay";

export function WalkthroughProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);

  const active = activeId ? getWalkthrough(activeId) ?? null : null;
  const currentStep = active ? active.steps[stepIndex] ?? null : null;

  const exit = useCallback(() => {
    if (activeId) logWalkthroughEvent("abandoned", activeId, stepIndex);
    setActiveId(null);
    setStepIndex(0);
  }, [activeId, stepIndex]);

  const start = useCallback(
    (walkthroughId: string) => {
      const w = getWalkthrough(walkthroughId);
      if (!w) return;
      setActiveId(walkthroughId);
      setStepIndex(0);
      logWalkthroughEvent("started", walkthroughId, 0);
      if (w.steps[0] && w.steps[0].page !== pathname) router.push(w.steps[0].page);
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
      return;
    }
    setStepIndex(nextIndex);
    const nextStep = active.steps[nextIndex];
    if (nextStep.page !== pathname) router.push(nextStep.page);
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
    () => ({ active, stepIndex, currentStep, start, next, exit }),
    [active, stepIndex, currentStep, start, next, exit],
  );

  return (
    <WalkthroughContext.Provider value={value}>
      {children}
      {active && <WalkthroughOverlay />}
    </WalkthroughContext.Provider>
  );
}
