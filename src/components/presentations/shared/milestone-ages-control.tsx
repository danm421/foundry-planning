"use client";

import { OptionsGroup } from "@/components/presentations/shared/options-layout";

const NUM =
  "w-16 rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40";

interface Props {
  value: number[];
  onChange: (next: number[]) => void;
  label?: string;
}

/**
 * The ages an Early Years chart clusters bars at. Shared so two pages in one
 * deck offer the same control — the spec's milestone-age consistency rule starts
 * with the two inputs looking and behaving alike.
 *
 * An emptied input keeps the age it had. `Number("")` is 0, which fails the
 * options schema's `.min(1)`, and the advisor would be left with a page that
 * refuses to save while the field merely looks blank.
 */
export function MilestoneAgesControl({ value, onChange, label = "Milestone ages" }: Props) {
  return (
    <OptionsGroup label={label}>
      <div className="flex items-center gap-2">
        {value.map((age, i) => (
          <input
            key={i}
            type="number"
            aria-label={`Milestone age ${i + 1}`}
            className={NUM}
            value={age}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next) || next < 1) return;
              onChange(value.map((a, j) => (j === i ? next : a)));
            }}
          />
        ))}
      </div>
    </OptionsGroup>
  );
}
