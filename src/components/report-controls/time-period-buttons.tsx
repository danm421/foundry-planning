"use client";

import type { AsOfValue } from "./as-of-dropdown";

interface Props {
  selected: AsOfValue;
  onChange: (value: AsOfValue) => void;
  todayYear: number;
  retirementYear?: number;
  firstDeathYear?: number;
  lastDeathYear?: number;
  /** Show the "Split death" pill? Hidden for single-grantor scenarios. */
  showSplit?: boolean;
}

interface Pill {
  key: string;
  label: string;
  value: AsOfValue;
  disabled?: boolean;
}

export function TimePeriodButtons({
  selected,
  onChange,
  todayYear,
  retirementYear,
  firstDeathYear,
  lastDeathYear,
  showSplit = false,
}: Props) {
  const pills: Pill[] = [
    { key: "today", label: "Today", value: "today" },
    {
      key: "retirement",
      label: "Retirement",
      value: retirementYear ?? todayYear,
      disabled: retirementYear == null,
    },
    {
      key: "first-death",
      label: "First Death",
      value: firstDeathYear ?? todayYear,
      disabled: firstDeathYear == null,
    },
    {
      key: "last-death",
      label: "Last Death",
      value: lastDeathYear ?? todayYear,
      disabled: lastDeathYear == null,
    },
  ];

  if (showSplit) {
    pills.push({ key: "split", label: "Split Death", value: "split" });
  }

  const isActive = (p: Pill) => {
    if (p.value === selected) return true;
    if (typeof p.value === "number" && typeof selected === "number") {
      return p.value === selected;
    }
    return false;
  };

  return (
    <div className="inline-flex flex-wrap gap-1 rounded border border-gray-700 bg-gray-900 p-0.5 text-sm">
      {pills.map((p) => {
        const active = isActive(p);
        return (
          <button
            key={p.key}
            type="button"
            disabled={p.disabled}
            onClick={() => onChange(p.value)}
            className={
              active
                ? "rounded bg-gray-700 px-3 py-1 text-gray-100"
                : p.disabled
                  ? "rounded px-3 py-1 text-gray-600"
                  : "rounded px-3 py-1 text-gray-300 hover:text-gray-100"
            }
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
