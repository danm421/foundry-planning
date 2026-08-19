"use client";

import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { TidbitPicker } from "@/components/presentations/shared/tidbit-picker";
import type { EarlyYearsLadderPageOptions } from "@/lib/presentations/pages/early-years-ladder/types";

interface Props {
  value: EarlyYearsLadderPageOptions;
  onChange: (next: EarlyYearsLadderPageOptions) => void;
}

const NUM =
  "w-16 rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40";

/** Percent-of-salary values are stored as fractions; the advisor types points. */
const toPoints = (fraction: number) => Math.round(fraction * 1000) / 10;
const toFraction = (points: number) => (Number.isFinite(points) ? points / 100 : 0);

export function EarlyYearsLadderOptionsControl({ value, onChange }: Props) {
  const cfg = value.rungs;
  const relative = cfg.mode === "relative";
  const steps = cfg.mode === "relative" ? cfg.offsets : cfg.percents;

  function setStep(index: number, points: number) {
    const next = steps.map((v, i) => (i === index ? toFraction(points) : v));
    onChange({
      ...value,
      rungs: relative
        ? { mode: "relative", offsets: next }
        : { mode: "absolute", percents: next },
    });
  }

  return (
    <OptionsRow>
      <OptionsGroup label="Rungs">
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="radio"
            className="accent-accent"
            checked={relative}
            onChange={() => onChange({ ...value, rungs: { mode: "relative", offsets: steps } })}
          />
          <span>Points above their rate</span>
        </label>
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="radio"
            className="accent-accent"
            checked={!relative}
            onChange={() => onChange({ ...value, rungs: { mode: "absolute", percents: steps } })}
          />
          <span>Fixed savings rates</span>
        </label>
        <div className="flex items-center gap-2 pt-1">
          {steps.map((v, i) => (
            <input
              key={i}
              type="number"
              step="0.5"
              aria-label={relative ? `Rung ${i + 1}, points above` : `Rung ${i + 1}, savings rate`}
              className={NUM}
              value={toPoints(v)}
              onChange={(e) => setStep(i, Number(e.target.value))}
            />
          ))}
          <span className="text-ink-3">%</span>
        </div>
      </OptionsGroup>

      <OptionsGroup label="Milestone ages">
        <div className="flex items-center gap-2">
          {value.milestoneAges.map((age, i) => (
            <input
              key={i}
              type="number"
              aria-label={`Milestone age ${i + 1}`}
              className={NUM}
              value={age}
              onChange={(e) =>
                onChange({
                  ...value,
                  milestoneAges: value.milestoneAges.map((a, j) =>
                    j === i ? Number(e.target.value) : a,
                  ),
                })
              }
            />
          ))}
        </div>
      </OptionsGroup>

      <OptionsGroup label="Tidbits">
        <TidbitPicker
          value={value.tidbits}
          onChange={(tidbits) => onChange({ ...value, tidbits })}
        />
      </OptionsGroup>
    </OptionsRow>
  );
}
