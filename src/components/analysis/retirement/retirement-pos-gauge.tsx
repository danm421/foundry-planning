"use client";

// Probability-of-Success donut gauge for the Retirement Analysis probability view.
// Wraps SuccessGauge (0..1) and adds a centered label, a Low/Medium/High band
// legend, and accessible markup.

import { SuccessGauge } from "@/components/monte-carlo/success-gauge";

// eMoney PoS bands
const BANDS = [
  { label: "Low", range: "0–69%", color: "var(--color-crit)" },
  { label: "Medium", range: "70–81%", color: "var(--color-warn)" },
  { label: "High", range: "82–100%", color: "var(--color-good)" },
] as const;

interface RetirementPosGaugeProps {
  successRate: number | null;
  status: "idle" | "computing" | "ready";
}

export function RetirementPosGauge({ successRate, status }: RetirementPosGaugeProps) {
  const rate = successRate ?? 0;
  const pct = Math.round(rate * 100);
  const isComputing = status === "computing";

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Gauge + center label */}
      <div
        className={
          "flex flex-col items-center gap-2 transition-opacity duration-300 " +
          (isComputing ? "opacity-40" : "opacity-100")
        }
        aria-label={`Probability of success: ${pct} percent`}
        role="img"
      >
        <div className="relative">
          <SuccessGauge value={rate} />
          {isComputing && (
            <div
              className="pointer-events-none absolute inset-0 animate-pulse rounded"
              aria-hidden="true"
            />
          )}
        </div>
        <p className="text-center text-[14px] font-medium text-ink-2">
          {pct}% Probability Of Success
        </p>
        {isComputing && (
          <p className="text-[12px] text-ink-4" role="status" aria-live="polite">
            Computing…
          </p>
        )}
      </div>

      {/* Band legend — always visible so color meaning is never ambiguous */}
      <div
        className="flex gap-5"
        aria-label="Probability of success bands"
        role="list"
      >
        {BANDS.map(({ label, range, color }) => (
          <div
            key={label}
            className="flex items-center gap-1.5"
            role="listitem"
          >
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            <span className="text-[12px] text-ink-3">
              {label} <span className="text-ink-4">({range})</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
