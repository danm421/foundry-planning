"use client";

import { FieldTooltip } from "@/components/forms/field-tooltip";
import {
  RETIREMENT_SUMMARY_OPTIONS_DEFAULT,
  type RetirementSummaryOptions,
} from "@/lib/presentations/pages/retirement-summary/options-schema";

interface Props {
  value: RetirementSummaryOptions;
  onChange: (next: RetirementSummaryOptions) => void;
}

const label = "text-[11px] uppercase tracking-[0.1em] text-ink-3";
const field =
  "rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40";

// The same targets the comparison pages offer, so one deck can match them.
const TARGETS = [0.75, 0.8, 0.85, 0.9];

export function RetirementSummaryOptionsControl({ value, onChange }: Props) {
  // A saved template reaches here unparsed and may predate the setting.
  const maxSpend = value.maxSpend ?? RETIREMENT_SUMMARY_OPTIONS_DEFAULT.maxSpend;
  const set = (next: Partial<RetirementSummaryOptions["maxSpend"]>) =>
    onChange({ ...value, maxSpend: { ...maxSpend, ...next } });

  return (
    <div className="flex flex-col gap-2 rounded border border-hair p-2 text-sm text-ink-2">
      <span className={`flex items-center gap-1.5 ${label}`}>
        Max spending
        <FieldTooltip text="Adds a card to the first sheet: the most the household can spend each year in retirement, in today's dollars, while Monte Carlo success stays at or above the confidence you pick. It takes a few seconds the first time a plan is solved." />
      </span>
      <label className="flex items-center gap-2 hover:text-ink">
        <input
          type="checkbox"
          className="accent-accent"
          checked={maxSpend.show}
          onChange={(e) => set({ show: e.target.checked })}
        />
        <span>Show max sustainable spend</span>
      </label>
      <label className="flex items-center justify-between gap-2">
        <span>Confidence target</span>
        <select
          aria-label="Max-spending confidence target"
          className={`${field} disabled:opacity-50`}
          disabled={!maxSpend.show}
          value={String(maxSpend.targetConfidence)}
          onChange={(e) => set({ targetConfidence: Number(e.target.value) })}
        >
          {TARGETS.map((t) => (
            <option key={t} value={t}>{`${Math.round(t * 100)}%`}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
