"use client";

import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { TidbitPicker } from "@/components/presentations/shared/tidbit-picker";
import {
  EARLY_YEARS_DEBT_OR_INVEST_OPTIONS_DEFAULT,
  type EarlyYearsDebtOrInvestPageOptions,
} from "@/lib/presentations/pages/early-years-debt-or-invest/types";

interface Props {
  value: EarlyYearsDebtOrInvestPageOptions;
  onChange: (next: EarlyYearsDebtOrInvestPageOptions) => void;
}

const NUM =
  "w-20 rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40";

// `liabilityId` has no control in v1 — the default (the largest amortizing
// balance) is the right loan on almost every plan this deck is built for, and a
// picker needs the client's liability list, which an options control does not
// have. The option is honoured if something sets it.
export function EarlyYearsDebtOrInvestOptionsControl({ value, onChange }: Props) {
  return (
    <OptionsRow>
      <OptionsGroup label="Extra payment">
        <div className="flex items-center gap-2">
          <span className="text-ink-3">$</span>
          <input
            type="number"
            step="50"
            aria-label="Extra dollars a month"
            className={NUM}
            value={value.monthlyAmount}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next) || next < 0) return;
              onChange({ ...value, monthlyAmount: next });
            }}
          />
          <span className="text-ink-3">a month</span>
        </div>
      </OptionsGroup>

      <OptionsGroup label="Compare at age">
        <input
          type="number"
          aria-label="Milestone age"
          className={NUM}
          value={value.milestoneAge}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (!Number.isFinite(next) || next < 1) return;
            onChange({ ...value, milestoneAge: next });
          }}
        />
      </OptionsGroup>

      <OptionsGroup label="Tidbits">
        <TidbitPicker
          value={value.tidbits}
          defaults={EARLY_YEARS_DEBT_OR_INVEST_OPTIONS_DEFAULT.tidbits}
          onChange={(tidbits) => onChange({ ...value, tidbits })}
        />
      </OptionsGroup>
    </OptionsRow>
  );
}
