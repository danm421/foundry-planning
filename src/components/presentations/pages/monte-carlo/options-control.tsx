"use client";

import type { MonteCarloPageOptions } from "@/lib/presentations/pages/monte-carlo/options-schema";
import {
  OptionsRow,
  OptionsGroup,
} from "@/components/presentations/shared/options-layout";

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
    <OptionsRow>
      <OptionsGroup label="Highlighted chart">
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
      </OptionsGroup>
    </OptionsRow>
  );
}
