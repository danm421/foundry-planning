import type { CSSProperties, ReactNode } from "react";
import { LoadingLabel } from "@/components/skeleton";

/**
 * Per-stroke draw-in timing for a `.mark-draw` path, as inline custom props.
 * Marks stagger their strokes by giving each its own duration + delay, so the
 * timing lives at the call site while the `.mark-draw` animation stays generic.
 */
export function drawStyle(duration: string, delay: string): CSSProperties {
  return {
    "--mark-draw-dur": duration,
    "--mark-draw-delay": delay,
  } as CSSProperties;
}

/**
 * `MarkLoader` — shared chrome for Foundry's branded "computing" loaders.
 *
 * A calm, centered card with a soft verdigris halo breathing behind an SVG
 * `mark` that draws itself in (see the `.mark-draw` / `.mark-halo` utilities in
 * globals.css). Callers supply the mark — the LI shield-check, the Monte Carlo
 * fan — a visible `caption`, and an sr-only `status` line for screen readers.
 * All motion sits behind `prefers-reduced-motion`, which settles the mark to a
 * static, fully-drawn state and holds the halo steady.
 *
 * Height is intentionally left to the caller via `className`: the LI chart
 * loader fills its container (`h-full min-h-[180px]`), the Monte Carlo loader
 * stands in a taller hero slot (`min-h-[300px]`).
 */
export function MarkLoader({
  mark,
  caption,
  status,
  markBoxClassName = "h-16 w-16",
  className = "",
}: {
  /** The animated SVG mark (its paths carry the `.mark-draw` class). */
  mark: ReactNode;
  /** Visible, decorative caption tying the mark to the work. */
  caption: string;
  /** Screen-reader status line, announced via role=status. */
  status: string;
  /** Sizing for the relative box holding the halo + mark. */
  markBoxClassName?: string;
  /** Height / spacing classes for the outer card, set by the caller. */
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-md border border-hair bg-card-2 px-6 text-center ${className}`.trim()}
    >
      <div
        className={`relative flex items-center justify-center ${markBoxClassName}`.trim()}
      >
        {/* Soft verdigris halo, breathing behind the mark. */}
        <span
          aria-hidden
          className="mark-halo pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at center, color-mix(in srgb, var(--color-accent) 55%, transparent) 0%, color-mix(in srgb, var(--color-accent) 16%, transparent) 46%, transparent 72%)",
          }}
        />
        {mark}
      </div>
      <p aria-hidden className="mt-4 text-[13px] text-ink-3">
        {caption}
      </p>
      <LoadingLabel>{status}</LoadingLabel>
    </div>
  );
}
