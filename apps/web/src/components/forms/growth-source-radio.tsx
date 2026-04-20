"use client";

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
  return (
    <div className="flex items-center gap-4">
      <label className="flex items-center gap-2 text-sm text-gray-200">
        <input
          type="radio"
          checked={value === "custom"}
          disabled={disabled}
          onChange={() => onChange({ value: "custom", customRate })}
        />
        Custom
        <input
          type="number"
          step="0.01"
          value={customRate}
          name={customRateName}
          disabled={disabled || value !== "custom"}
          onChange={(e) => onChange({ value: "custom", customRate: e.target.value })}
          className="ml-1 w-20 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100 disabled:opacity-50"
        />
        <span className="text-xs text-gray-400">%</span>
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-200">
        <input
          type="radio"
          checked={value === "inflation"}
          disabled={disabled}
          onChange={() => onChange({ value: "inflation", customRate })}
        />
        Inflation ({(resolvedInflationRate * 100).toFixed(2)}%)
      </label>
    </div>
  );
}
