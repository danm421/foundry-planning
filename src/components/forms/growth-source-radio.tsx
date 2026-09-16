"use client";

import { PercentInput } from "@/components/percent-input";

interface Props {
  value: "custom" | "inflation";
  customRate: string; // percent string as the input displays, e.g., "3.00"
  resolvedInflationRate: number; // decimal fraction, e.g., 0.03
  onChange: (next: { value: "custom" | "inflation"; customRate: string }) => void;
  customRateName?: string; // optional form-input name
  disabled?: boolean;
}

export default function GrowthSourceRadio({
  value,
  customRate,
  resolvedInflationRate,
  onChange,
  customRateName,
  disabled = false,
}: Props) {
  const inflationLabel = `Inflation (${(resolvedInflationRate * 100).toFixed(2)}%)`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 text-xs">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ value: "inflation", customRate })}
          className={
            "rounded-md border px-2 py-0.5 text-xs font-medium transition-colors " +
            (value === "inflation"
              ? "border-accent bg-accent/15 text-accent-ink"
              : "border-hair-3 bg-card-2 text-ink-3 hover:bg-card-hover") +
            (disabled ? " opacity-50" : "")
          }
        >
          {inflationLabel}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ value: "custom", customRate })}
          className={
            "rounded-md border px-2 py-0.5 text-xs font-medium transition-colors " +
            (value === "custom"
              ? "border-accent bg-accent/15 text-accent-ink"
              : "border-hair-3 bg-card-2 text-ink-3 hover:bg-card-hover") +
            (disabled ? " opacity-50" : "")
          }
        >
          Custom %
        </button>
      </div>
      {value === "custom" && (
        <div className="flex items-center gap-1">
          <PercentInput
            value={customRate}
            name={customRateName}
            disabled={disabled}
            onChange={(v) => onChange({ value: "custom", customRate: v })}
            className="w-24"
          />
        </div>
      )}
    </div>
  );
}
