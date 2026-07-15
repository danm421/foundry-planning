"use client";

import { useEffect, useState } from "react";

/**
 * Tracks the user's `prefers-reduced-motion` setting. SSR-safe: starts `false`,
 * corrected on mount, and updates live if the OS setting changes. Use to gate
 * JS/canvas animations that a CSS `@media (prefers-reduced-motion)` block can't
 * reach (e.g. a Chart.js reveal animation drawn to <canvas>).
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}
