"use client";

import type { MonteCarloPageOptions } from "@/lib/presentations/pages/monte-carlo/options-schema";

interface Props {
  value: MonteCarloPageOptions;
  onChange: (next: MonteCarloPageOptions) => void;
}

const CHOICES: Array<{ key: MonteCarloPageOptions["highlight"]; label: string }> = [
  { key: "fan", label: "Fan chart (portfolio over time)" },
  { key: "histogram", label: "Ending distribution" },
  { key: "longevity", label: "Success over time" },
];

export function MonteCarloOptionsControl({ value, onChange }: Props) {
  return (
    <div className="space-y-3 text-sm text-ink-2">
      <fieldset className="space-y-1">
        <legend className="text-[11px] uppercase tracking-[0.1em] text-ink-3">
          Highlighted chart
        </legend>
        {CHOICES.map((c) => (
          <label key={c.key} className="flex items-center gap-2 hover:text-ink">
            <input
              type="radio"
              className="accent-accent"
              checked={value.highlight === c.key}
              onChange={() => onChange({ ...value, highlight: c.key })}
            />
            <span>{c.label}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
