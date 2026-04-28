"use client";

import { formatAges, type OwnerDobs } from "./age-helpers";

export type AsOfValue = "today" | "split" | number;

export interface Milestone {
  year: number;
  label: string;
}

interface Props {
  years: number[];
  todayYear: number;
  selected: AsOfValue;
  onChange: (value: AsOfValue) => void;
  dobs: OwnerDobs;
  /** Highlighted shortcuts at the top of the dropdown (Retirement, First Death, Last Death). */
  milestones?: Milestone[];
  /** Show "Split death" entry in the dropdown? */
  allowSplit?: boolean;
  /** Override the prefix shown for non-"today"/"split" entries. Default "End of". */
  yearPrefix?: string;
  className?: string;
  ariaLabel?: string;
}

function decadeKey(year: number): string {
  const start = Math.floor(year / 10) * 10;
  return `${start}–${start + 9}`;
}

export function AsOfDropdown({
  years,
  todayYear,
  selected,
  onChange,
  dobs,
  milestones = [],
  allowSplit = false,
  yearPrefix = "End of",
  className,
  ariaLabel = "As of",
}: Props) {
  const groups = new Map<string, number[]>();
  for (const y of years) {
    const key = decadeKey(y);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(y);
  }

  const value =
    selected === "today" ? "today" : selected === "split" ? "split" : String(selected);

  const ageStr = (year: number) => {
    const a = formatAges(year, dobs);
    return a ? ` · age ${a}` : "";
  };

  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "today") onChange("today");
        else if (v === "split") onChange("split");
        else onChange(Number(v));
      }}
      className={
        className ??
        "rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
      }
    >
      <option value="today">Today · {todayYear}{ageStr(todayYear)}</option>
      {allowSplit && <option value="split">Split death (each at projected year)</option>}
      {milestones.length > 0 && (
        <optgroup label="Milestones">
          {milestones.map((m) => (
            <option key={`m-${m.label}-${m.year}`} value={m.year}>
              {m.label} · {m.year}{ageStr(m.year)}
            </option>
          ))}
        </optgroup>
      )}
      {Array.from(groups.entries()).map(([label, ys]) => (
        <optgroup key={label} label={label}>
          {ys.map((y) => (
            <option key={y} value={y}>
              {yearPrefix} {y}{ageStr(y)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
