"use client";

import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { MilestoneAgesControl } from "@/components/presentations/shared/milestone-ages-control";
import { TidbitPicker } from "@/components/presentations/shared/tidbit-picker";
import type { EarlyYearsWaitingPageOptions } from "@/lib/presentations/pages/early-years-waiting/types";

interface Props {
  value: EarlyYearsWaitingPageOptions;
  onChange: (next: EarlyYearsWaitingPageOptions) => void;
}

const NUM =
  "w-16 rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40";

export function EarlyYearsWaitingOptionsControl({ value, onChange }: Props) {
  return (
    <OptionsRow>
      <OptionsGroup label="How much more">
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.5"
            aria-label="Points above their current rate"
            className={NUM}
            /* Stored as a fraction; the advisor types points. */
            value={Math.round(value.rungOffset * 1000) / 10}
            onChange={(e) => {
              const points = Number(e.target.value);
              if (!Number.isFinite(points) || points < 0) return;
              onChange({ ...value, rungOffset: points / 100 });
            }}
          />
          <span className="text-ink-3">% more than today</span>
        </div>
      </OptionsGroup>

      <OptionsGroup label="Start dates">
        <div className="flex items-center gap-2">
          {value.delays.map((d, i) => (
            <input
              key={i}
              type="number"
              aria-label={`Start date ${i + 1}, years from now`}
              className={NUM}
              value={d}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (!Number.isFinite(next) || next < 0) return;
                onChange({
                  ...value,
                  delays: value.delays.map((v, j) => (j === i ? next : v)),
                });
              }}
            />
          ))}
          <span className="text-ink-3">years from now</span>
        </div>
      </OptionsGroup>

      <MilestoneAgesControl
        value={value.milestoneAges}
        onChange={(milestoneAges) => onChange({ ...value, milestoneAges })}
      />

      <OptionsGroup label="Tidbits">
        <TidbitPicker
          value={value.tidbits}
          onChange={(tidbits) => onChange({ ...value, tidbits })}
        />
      </OptionsGroup>
    </OptionsRow>
  );
}
