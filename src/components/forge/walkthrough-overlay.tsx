"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useWalkthrough } from "./walkthrough-context";
import { useAnchorRect } from "./use-anchor-rect";

const PAD = 6; // px halo around the spotlighted element

export function WalkthroughOverlay() {
  const { active, stepIndex, currentStep, next, exit } = useWalkthrough();
  const { element, rect, status } = useAnchorRect(currentStep?.anchorId ?? null);
  const [canAdvance, setCanAdvance] = useState(false);

  // reset the input-gate whenever the step changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the advance-gate is derived from the current step and must reset when the step changes; a one-shot per-step sync, matching the repo's back-nav-provider convention.
    setCanAdvance(currentStep?.advanceOn === "manual");
  }, [currentStep]);

  // scroll the target into view when it resolves
  useEffect(() => {
    if (status === "found" && element) element.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [status, element]);

  // click / input advancement listeners on the real element
  useEffect(() => {
    if (!element || !currentStep) return;
    if (currentStep.advanceOn === "click") {
      const onClick = () => next();
      element.addEventListener("click", onClick);
      return () => element.removeEventListener("click", onClick);
    }
    if (currentStep.advanceOn === "input") {
      const onInput = () => setCanAdvance(true);
      element.addEventListener("input", onInput, true);
      element.addEventListener("change", onInput, true);
      return () => {
        element.removeEventListener("input", onInput, true);
        element.removeEventListener("change", onInput, true);
      };
    }
  }, [element, currentStep, next]);

  if (!active || !currentStep) return null;

  const total = active.steps.length;
  const counter = `Step ${stepIndex + 1} of ${total}`;
  const isNavigate = currentStep.advanceOn === "navigate";

  // Graceful degradation: anchor never appeared → text fallback, never a trap.
  if (status === "missing") {
    return createPortal(
      <div className="fixed inset-0 z-[81] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-paper/70 backdrop-blur-sm" />
        <div
          role="dialog"
          aria-label="Guided walkthrough"
          className="relative z-[81] w-full max-w-sm rounded-[var(--radius)] border border-hair bg-card p-4 text-ink shadow-lg"
        >
          <p className="text-[13px] font-semibold">{active.title}</p>
          <p className="mt-1 text-[12px] text-ink-3">
            We couldn&apos;t find that element on screen. Here are the remaining steps:
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-[12px] text-ink-2">
            {active.steps.slice(stepIndex).map((s, i) => (
              <li key={i}>{s.callout}</li>
            ))}
          </ol>
          <div className="mt-3 flex justify-end">
            <button
              onClick={exit}
              className="rounded-[var(--radius-sm)] border border-hair px-3 py-1 text-[12px] font-medium"
            >
              Exit
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // Resolving / no rect yet — render nothing visible (avoids a flash before geometry).
  if (status !== "found" || !rect) return null;

  const holeTop = rect.top - PAD;
  const holeLeft = rect.left - PAD;
  const holeW = rect.width + PAD * 2;
  const holeH = rect.height + PAD * 2;
  const scrim = "fixed z-[80] bg-black/50";

  // Callout below the hole if there's room, else above.
  const belowRoom = window.innerHeight - (holeTop + holeH) > 160;
  const calloutStyle: React.CSSProperties = belowRoom
    ? { top: holeTop + holeH + 8, left: Math.max(8, holeLeft) }
    : { top: Math.max(8, holeTop - 148), left: Math.max(8, holeLeft) };

  return createPortal(
    <>
      {/* 4-rectangle scrim leaves the spotlighted element natively clickable */}
      <div className={scrim} style={{ top: 0, left: 0, right: 0, height: Math.max(0, holeTop) }} />
      <div className={scrim} style={{ top: holeTop, left: 0, width: Math.max(0, holeLeft), height: holeH }} />
      <div className={scrim} style={{ top: holeTop, left: holeLeft + holeW, right: 0, height: holeH }} />
      <div className={scrim} style={{ top: holeTop + holeH, left: 0, right: 0, bottom: 0 }} />

      <div
        role="dialog"
        aria-label="Guided walkthrough"
        className="fixed z-[81] w-64 rounded-[var(--radius)] border border-hair bg-card p-3 text-ink shadow-lg"
        style={calloutStyle}
      >
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{counter}</p>
        <p className="mt-1 text-[13px]">{currentStep.callout}</p>
        <div className="mt-3 flex items-center justify-between">
          <button onClick={exit} className="text-[12px] text-ink-3 hover:text-ink">
            Exit
          </button>
          <div className="flex gap-2">
            {!isNavigate && (
              <button
                onClick={next}
                disabled={!canAdvance}
                className="rounded-[var(--radius-sm)] bg-accent px-3 py-1 text-[12px] font-semibold text-accent-on disabled:opacity-50"
              >
                Next
              </button>
            )}
            <button onClick={next} className="text-[12px] text-ink-3 hover:text-ink">
              Skip
            </button>
          </div>
        </div>
        {isNavigate && (
          <p className="mt-1 text-[11px] text-ink-3">Do the highlighted action to continue…</p>
        )}
      </div>
    </>,
    document.body,
  );
}
