import { drawStyle } from "@/components/mark-loader";

// Five verdigris strokes fanning from a left origin dot into the probability
// cone, echoing the Monte Carlo report's hero fan-chart. Staggered so the
// median anchors first and the cone opens outward; the outer pairs sit fainter
// for depth. Coordinates are viewBox-relative, so the same paths serve both the
// report's hero-slot loader and the solver gauge's ~20px chip — size via
// `className`, not new geometry.
const STROKES = [
  { d: "M 6 17 C 24 17, 30 17, 43 17", opacity: 1, delay: "0.15s" }, // median
  { d: "M 6 17 C 22 17, 28 9, 43 9", opacity: 0.6, delay: "0.35s" }, // upper inner
  { d: "M 6 17 C 22 17, 28 25, 43 25", opacity: 0.6, delay: "0.35s" }, // lower inner
  { d: "M 6 17 C 22 17, 28 3, 43 3", opacity: 0.3, delay: "0.55s" }, // upper outer
  { d: "M 6 17 C 22 17, 28 31, 43 31", opacity: 0.3, delay: "0.55s" }, // lower outer
];

/**
 * The Monte Carlo "simulating" mark. Each stroke draws itself in via the shared
 * `.mark-draw` / `.mark-draw-loop` classes (see globals.css); under
 * `prefers-reduced-motion` every stroke settles fully drawn. Decorative —
 * callers own the accessible name.
 *
 * `strokeWidth` is viewBox-relative and therefore scales with the rendered
 * size: the default 1.5 reads correctly at the report's `h-14`, but shrinks to
 * a hairline at gauge size, so small callers pass a larger value.
 *
 * `loop` picks perpetual motion over the default one-shot draw: the fan sweeps
 * out from the origin dot, holds, and exits, forever. Pass it wherever the mark
 * renders WITHOUT `MarkLoader` — its breathing halo is what keeps a one-shot
 * mark feeling alive, so a bare mark needs the motion in the strokes instead.
 * `duration` follows suit (a full cycle wants longer than a lone draw-in), so
 * callers rarely set both.
 */
export function FanMark({
  className = "relative h-14 w-20 text-accent",
  strokeWidth = 1.5,
  loop = false,
  duration = loop ? "2.6s" : "0.9s",
}: {
  className?: string;
  strokeWidth?: number;
  loop?: boolean;
  duration?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 34"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      {STROKES.map((s, i) => (
        <path
          key={i}
          className={loop ? "mark-draw-loop" : "mark-draw"}
          pathLength={100}
          d={s.d}
          opacity={s.opacity}
          style={drawStyle(duration, s.delay)}
        />
      ))}
      {/* Origin dot — the common source the paths fan out from. */}
      <circle cx={6} cy={17} r={2.4} fill="currentColor" stroke="none" />
    </svg>
  );
}
