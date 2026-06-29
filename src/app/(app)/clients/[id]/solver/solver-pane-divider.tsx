"use client";

import { useCallback, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";

type Props = {
  /** The grid container the divider sits over — used to translate pointer x into a percentage. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Current left-pane width as a percentage of the container (0–100). */
  value: number;
  /** Called continuously while dragging / on each keyboard nudge. */
  onChange: (pct: number) => void;
  /** Called once when an adjustment finishes (drag end, key press) — for persistence. */
  onCommit: (pct: number) => void;
  /** Keep both panes usable: floor each side in pixels, then clamp to the percentage band. */
  minLeftPx?: number;
  minRightPx?: number;
  minPct?: number;
  maxPct?: number;
};

const KEY_STEP = 2; // percentage points per arrow press

export function SolverPaneDivider({
  containerRef,
  value,
  onChange,
  onCommit,
  minLeftPx = 320,
  minRightPx = 420,
  minPct = 20,
  maxPct = 60,
}: Props) {
  const clamp = useCallback(
    (pct: number): number => {
      const el = containerRef.current;
      let lo = minPct;
      let hi = maxPct;
      if (el) {
        const w = el.getBoundingClientRect().width;
        if (w > 0) {
          lo = Math.max(lo, (minLeftPx / w) * 100);
          hi = Math.min(hi, ((w - minRightPx) / w) * 100);
        }
      }
      if (lo > hi) lo = hi; // very narrow container — collapse the band rather than invert
      return Math.min(hi, Math.max(lo, pct));
    },
    [containerRef, minLeftPx, minRightPx, minPct, maxPct],
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = containerRef.current;
      if (!el) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.style.userSelect = "none";

      const move = (clientX: number) => {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0) return;
        onChange(clamp(((clientX - rect.left) / rect.width) * 100));
      };
      move(e.clientX);

      const onMove = (ev: PointerEvent) => move(ev.clientX);
      const onUp = (ev: PointerEvent) => {
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const rect = el.getBoundingClientRect();
        if (rect.width > 0) {
          onCommit(clamp(((ev.clientX - rect.left) / rect.width) * 100));
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [containerRef, onChange, onCommit, clamp],
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      let next: number | null = null;
      if (e.key === "ArrowLeft") next = value - KEY_STEP;
      else if (e.key === "ArrowRight") next = value + KEY_STEP;
      else if (e.key === "Home") next = minPct;
      else if (e.key === "End") next = maxPct;
      if (next === null) return;
      e.preventDefault();
      const clamped = clamp(next);
      onChange(clamped);
      onCommit(clamped);
    },
    [value, clamp, onChange, onCommit, minPct, maxPct],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize input and report panels"
      aria-valuemin={Math.round(minPct)}
      aria-valuemax={Math.round(maxPct)}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      style={{ left: `${value}%` }}
      className="group absolute inset-y-0 z-20 hidden w-2.5 -translate-x-1/2 cursor-col-resize touch-none rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent lg:block"
    >
      {/* Resting 1px hairline; brightens on hover / while the handle is engaged. */}
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-hair transition-colors group-hover:bg-hair-2 group-active:bg-hair-2 group-focus-visible:bg-hair-2" />
    </div>
  );
}
