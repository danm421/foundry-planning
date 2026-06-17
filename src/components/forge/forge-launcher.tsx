// src/components/forge/forge-launcher.tsx
"use client";

import { useForge } from "./forge-provider";
import { SparkIcon } from "./spark-icon";

/**
 * Floating launcher for the Forge panel. Lives in ClientLayout (not the
 * topbar — the topbar lacks clientId). Indigo AI token (--color-secondary).
 * Hides while the panel is open so it never overlaps the slide-over; the panel
 * carries its own close button. z-30 so it sits on the right-panel layer,
 * never above the topbar (z-40).
 */
export function ForgeLauncher() {
  const { isOpen, open } = useForge();
  if (isOpen) return null;

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Open Forge"
      aria-expanded={isOpen}
      aria-controls="forge-panel"
      className="fixed bottom-6 right-6 z-30 flex h-12 w-12 items-center justify-center rounded-full border border-secondary/40 bg-secondary text-secondary-on shadow-lg transition-colors hover:bg-secondary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary/60"
    >
      <SparkIcon className="h-5 w-5" />
    </button>
  );
}
