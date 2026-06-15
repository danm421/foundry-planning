// src/components/copilot/copilot-launcher.tsx
"use client";

import { useCopilot } from "./copilot-provider";

/**
 * Floating launcher for the Copilot panel. Lives in ClientLayout (not the
 * topbar — the topbar lacks clientId). Indigo AI token (--color-secondary).
 * Hides while the panel is open so it never overlaps the slide-over; the panel
 * carries its own close button. z-30 so it sits on the right-panel layer,
 * never above the topbar (z-40).
 */
export function CopilotLauncher() {
  const { isOpen, open } = useCopilot();
  if (isOpen) return null;

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Open copilot"
      aria-expanded={isOpen}
      aria-controls="copilot-panel"
      className="fixed bottom-6 right-6 z-30 flex h-12 w-12 items-center justify-center rounded-full border border-secondary/40 bg-secondary text-secondary-on shadow-lg transition-colors hover:bg-secondary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary/60"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path
          d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.4 2.4M15.3 15.3l2.4 2.4M17.7 6.3l-2.4 2.4M8.7 15.3l-2.4 2.4"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
