"use client";

import { useState, useEffect } from "react";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import { availableRefs, resolveMilestone, YEAR_REF_LABELS } from "@/lib/milestones";

interface MilestoneYearPickerProps {
  /** HTML name attribute for the year input (used by FormData) */
  name: string;
  /** HTML id for the year input */
  id: string;
  /** Current year value */
  value: number;
  /** Current milestone ref (null = manual) */
  yearRef: YearRef | null;
  /** Resolved milestones for this client */
  milestones: ClientMilestones;
  /** Show SS milestone options (for social_security income type) */
  showSSRefs?: boolean;
  /** Called when value or ref changes */
  onChange: (year: number, ref: YearRef | null) => void;
  /** Label text */
  label: string;
}

const INPUT_CLASS =
  "block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const SELECT_CLASS =
  "block w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300 focus:border-blue-500 focus:outline-none";

export default function MilestoneYearPicker({
  name,
  id,
  value,
  yearRef,
  milestones,
  showSSRefs = false,
  onChange,
  label,
}: MilestoneYearPickerProps) {
  const [currentRef, setCurrentRef] = useState<YearRef | null>(yearRef);
  const [currentYear, setCurrentYear] = useState(value);

  // When milestones change and we have a ref, re-resolve
  useEffect(() => {
    if (currentRef) {
      const resolved = resolveMilestone(currentRef, milestones);
      if (resolved != null && resolved !== currentYear) {
        setCurrentYear(resolved);
        onChange(resolved, currentRef);
      }
    }
  }, [milestones, currentRef]);

  const refs = availableRefs(milestones, showSSRefs);

  function handleRefChange(newRef: string) {
    if (newRef === "manual") {
      setCurrentRef(null);
      onChange(currentYear, null);
    } else {
      const ref = newRef as YearRef;
      const resolved = resolveMilestone(ref, milestones);
      if (resolved != null) {
        setCurrentRef(ref);
        setCurrentYear(resolved);
        onChange(resolved, ref);
      }
    }
  }

  function handleYearChange(year: number) {
    setCurrentYear(year);
    setCurrentRef(null);
    onChange(year, null);
  }

  return (
    <div>
      <label className="block text-xs font-medium text-gray-400" htmlFor={id}>
        {label}
      </label>

      {/* Milestone select */}
      <select
        value={currentRef ?? "manual"}
        onChange={(e) => handleRefChange(e.target.value)}
        className={`mt-1 ${SELECT_CLASS}`}
      >
        <option value="manual">Manual</option>
        {refs.map((r) => (
          <option key={r.ref} value={r.ref}>
            {r.label} ({r.year})
          </option>
        ))}
      </select>

      {/* Year input — read-only when linked to a milestone */}
      <div className="relative mt-1">
        <input
          id={id}
          name={name}
          type="number"
          min={2000}
          max={2100}
          value={currentYear}
          readOnly={currentRef !== null}
          onChange={(e) => handleYearChange(Number(e.target.value))}
          className={`${INPUT_CLASS} ${currentRef ? "text-gray-400" : ""}`}
        />
        {currentRef && (
          <span className="absolute inset-y-0 right-2 flex items-center">
            <span className="rounded bg-blue-900/50 px-1.5 py-0.5 text-[10px] text-blue-400">
              {YEAR_REF_LABELS[currentRef]}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
