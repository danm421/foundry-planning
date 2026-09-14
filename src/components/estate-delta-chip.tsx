// The two visual primitives of estate report comparison.
//
// `goodDirection` decouples colour from sign: a falling tax bill and a rising
// bequest are both good news, so the caller says which way is up for its row.
import type { LineStatus } from "@/lib/estate/diff-estate-tax";

const compact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Below this, a delta is engine apportionment noise, not a real change. */
const NOISE_FLOOR = 1;

/**
 * Tone -> token classes. `good`/`crit` are the design system's semantic
 * status tokens, never the verdigris accent — the accent is reserved for
 * actions (CTA fills, the mark, status pips), not for colouring a data
 * value. `bad` (the `data-tone` value the caller/tests key off of) maps to
 * the `crit` token, matching the pattern already used for tone-coloured
 * pills elsewhere (see `portal-access-card.tsx`, `crm-task-row.tsx`).
 */
const TONE_CLASS: Record<"good" | "bad", string> = {
  good: "border-good/40 text-good",
  bad: "border-crit/40 text-crit",
};

export function EstateDeltaChip({
  delta,
  goodDirection,
  className,
  testId,
}: {
  delta: number;
  goodDirection: "up" | "down";
  className?: string;
  /** Lets a caller address a specific subtotal chip, e.g. by report row. */
  testId?: string;
}) {
  if (Math.abs(delta) < NOISE_FLOOR) return null;
  const down = delta < 0;
  const tone = (down ? "down" : "up") === goodDirection ? "good" : "bad";
  const magnitude = compact.format(Math.abs(delta));
  return (
    <span
      data-testid={testId ?? "estate-delta-chip"}
      data-tone={tone}
      aria-label={`${down ? "Down" : "Up"} ${magnitude} versus the compared plan`}
      className={
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-0.5 text-[11px] font-medium " +
        TONE_CLASS[tone] +
        (className ? ` ${className}` : "")
      }
    >
      {down ? "▾" : "▴"} <span className="tabular">{magnitude}</span>
    </span>
  );
}

export function EstateRowMarker({ status }: { status: LineStatus }) {
  if (status !== "added" && status !== "removed") return null;
  return (
    <span data-testid="estate-row-marker" data-status={status} className="chip">
      {status}
    </span>
  );
}
