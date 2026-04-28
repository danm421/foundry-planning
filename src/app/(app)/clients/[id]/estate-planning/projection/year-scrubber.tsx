"use client";

/**
 * YearScrubber — header showing the active year and presets, plus a hidden
 * <input type="range"> overlaid on a custom track with death markers and a
 * mirrored thumb.
 *
 * A11y: the real keyboard control is the hidden range input — it stays in the
 * DOM with `opacity-0` (NOT `display:none` / `visibility:hidden`, which would
 * kill keyboard focus). The visual thumb mirror is `aria-hidden`.
 *
 * Token translations from the plan pseudocode:
 *   bg-bg-0/bg-bg-1 → bg-card / bg-card-2
 *   text-fg-3       → text-ink-3
 *   text-tax-fg     → text-ink (no `-fg` siblings exist)
 *   bg-neg          → bg-crit
 *   text-neg        → text-crit
 *
 * Helpers `pctOfRange` and `ticks` are intentionally file-local — see plan
 * gotcha #10.
 */

export interface YearScrubberProps {
  currentYear: number;
  firstDeathYear?: number;
  secondDeathYear?: number;
  value: number;
  onChange: (year: number) => void;
}

export function YearScrubber({
  currentYear,
  firstDeathYear,
  secondDeathYear,
  value,
  onChange,
}: YearScrubberProps) {
  const finalDeathYear = secondDeathYear ?? firstDeathYear ?? currentYear + 30;
  const min = currentYear;
  const max = Math.max(currentYear + 40, finalDeathYear + 5);
  const yearsFromNow = value - currentYear;
  const activeEvent: "second-death" | "first-death" | null =
    secondDeathYear !== undefined && value >= secondDeathYear
      ? "second-death"
      : firstDeathYear !== undefined && value >= firstDeathYear
        ? "first-death"
        : null;

  const valuePct = pctOfRange(value, min, max);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-3">
        <span className="text-[32px] font-mono tabular-nums text-ink">{value}</span>
        <span className="text-[11px] text-ink-3">+{yearsFromNow} years from now</span>
        {activeEvent && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10.5px] uppercase ${
              activeEvent === "second-death"
                ? "bg-crit/15 text-crit"
                : "bg-tax/15 text-ink"
            }`}
          >
            {activeEvent === "second-death" ? "Second death" : "First death"}
          </span>
        )}
        <div className="ml-auto flex gap-1 text-[11px]">
          <button
            type="button"
            onClick={() => onChange(currentYear)}
            className="rounded border border-hair bg-card-2 px-2 py-0.5 text-ink-3 hover:text-ink"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onChange(currentYear + 10)}
            className="rounded border border-hair bg-card-2 px-2 py-0.5 text-ink-3 hover:text-ink"
          >
            +10y
          </button>
          {firstDeathYear !== undefined && (
            <button
              type="button"
              onClick={() => onChange(firstDeathYear)}
              className="rounded border border-hair bg-card-2 px-2 py-0.5 text-ink-3 hover:text-ink"
            >
              1st
            </button>
          )}
          {secondDeathYear !== undefined && (
            <button
              type="button"
              onClick={() => onChange(secondDeathYear)}
              className="rounded border border-hair bg-card-2 px-2 py-0.5 text-ink-3 hover:text-ink"
            >
              2nd
            </button>
          )}
          <button
            type="button"
            onClick={() => onChange(currentYear + 40)}
            className="rounded border border-hair bg-card-2 px-2 py-0.5 text-ink-3 hover:text-ink"
          >
            +40y
          </button>
        </div>
      </div>

      <div className="relative h-6">
        {/* Track */}
        <div
          className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-hair"
          aria-hidden="true"
        />
        {/* Filled portion (today → value) */}
        <div
          className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 bg-accent"
          style={{ width: `${valuePct}%` }}
          aria-hidden="true"
        />
        {/* Death markers */}
        {firstDeathYear !== undefined && (
          <span
            className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-tax"
            style={{ left: `calc(${pctOfRange(firstDeathYear, min, max)}% - 5px)` }}
            aria-hidden="true"
          />
        )}
        {secondDeathYear !== undefined && (
          <span
            className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-crit"
            style={{ left: `calc(${pctOfRange(secondDeathYear, min, max)}% - 5px)` }}
            aria-hidden="true"
          />
        )}
        {/* Visual thumb mirror — input drives the value, this just shows it */}
        <span
          className="pointer-events-none absolute top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full bg-accent ring-2 ring-accent/40"
          style={{ left: `calc(${valuePct}% - 9px)` }}
          aria-hidden="true"
        />
        {/* The real control — hidden but keyboard-focusable */}
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          aria-label="Year scrubber"
          className="absolute inset-0 w-full cursor-pointer opacity-0"
        />
      </div>

      <div className="flex justify-between font-mono text-[10.5px] text-ink-3">
        {ticks(min, max).map((y) => (
          <span key={y}>{y}</span>
        ))}
      </div>
    </div>
  );
}

function pctOfRange(v: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
}

function ticks(min: number, max: number): number[] {
  const out: number[] = [];
  const step = 10;
  let y = Math.ceil(min / step) * step;
  while (y <= max) {
    out.push(y);
    y += step;
  }
  return out;
}
