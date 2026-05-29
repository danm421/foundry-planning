"use client";

import type { EstatePageOptions } from "@/lib/presentations/pages/estate-shared/options-schema";

interface Props {
  value: EstatePageOptions;
  onChange: (next: EstatePageOptions) => void;
}

const CURRENT_YEAR = new Date().getFullYear();

export function EstateOptionsControl({ value, onChange }: Props) {
  const isYear = value.asOf.kind === "year";
  const year = isYear ? (value.asOf as { year: number }).year : CURRENT_YEAR + 10;

  return (
    <div className="space-y-3 text-sm text-ink-2">
      <fieldset className="space-y-1">
        <legend className="sr-only">As of</legend>
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="radio"
            className="accent-accent"
            checked={value.asOf.kind === "split"}
            onChange={() => onChange({ ...value, asOf: { kind: "split" } })}
          />
          <span>Each death at its projected year</span>
        </label>
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="radio"
            className="accent-accent"
            checked={value.asOf.kind === "today"}
            onChange={() => onChange({ ...value, asOf: { kind: "today" } })}
          />
          <span>Today (both die now)</span>
        </label>
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="radio"
            className="accent-accent"
            checked={isYear}
            onChange={() => onChange({ ...value, asOf: { kind: "year", year } })}
          />
          <span>Specific year</span>
        </label>
      </fieldset>
      {isYear && (
        <div className="pl-6">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">
              Year
            </span>
            <input
              type="number"
              aria-label="As-of year"
              className="w-24 rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
              value={year}
              onChange={(e) =>
                onChange({ ...value, asOf: { kind: "year", year: Number(e.target.value) } })
              }
            />
          </label>
        </div>
      )}
      <label className="flex items-center gap-2 hover:text-ink">
        <input
          type="checkbox"
          className="accent-accent"
          checked={value.showHeirDetail}
          onChange={(e) => onChange({ ...value, showHeirDetail: e.target.checked })}
        />
        <span>Show per-heir line-item detail</span>
      </label>
    </div>
  );
}
