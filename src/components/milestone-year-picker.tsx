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
  /** Current milestone ref (null = manual or duration) */
  yearRef: YearRef | null;
  /** Resolved milestones for this client */
  milestones: ClientMilestones;
  /** Show SS milestone options (for social_security income type) */
  showSSRefs?: boolean;
  /** Called when value or ref changes */
  onChange: (year: number, ref: YearRef | null) => void;
  /** Label text */
  label: string;
  /** Client first name — used to personalize labels (e.g. "Dan Retirement") */
  clientFirstName?: string;
  /** Spouse first name — used to personalize spouse labels */
  spouseFirstName?: string;
  /**
   * When provided, enables "Duration" mode on this picker — shows a "years"
   * input that computes `year = startYearForDuration + duration - 1`.
   * Intended for end-year pickers. Typically the start year of the same record.
   */
  startYearForDuration?: number;
}

const INPUT_CLASS =
  "block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
const SELECT_CLASS =
  "block w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300 focus:border-accent focus:outline-none";

/** Build display labels for this picker, personalized if names are provided. */
function buildLabels(
  clientFirstName?: string,
  spouseFirstName?: string
): Record<YearRef, string> {
  const clientName = clientFirstName?.trim() || "Client";
  const spouseName = spouseFirstName?.trim() || "Spouse";
  return {
    ...YEAR_REF_LABELS,
    plan_start: "First Year",
    plan_end: "Last Year",
    client_retirement: `${clientName} Retirement`,
    client_end: `${clientName} Death`,
    spouse_retirement: `${spouseName} Retirement`,
    spouse_end: `${spouseName} Death`,
  };
}

export default function MilestoneYearPicker({
  name,
  id,
  value,
  yearRef,
  milestones,
  showSSRefs = false,
  onChange,
  label,
  clientFirstName,
  spouseFirstName,
  startYearForDuration,
}: MilestoneYearPickerProps) {
  type Mode = "manual" | "milestone" | "duration";
  const [currentRef, setCurrentRef] = useState<YearRef | null>(yearRef);
  const [currentYear, setCurrentYear] = useState(value);
  const [mode, setMode] = useState<Mode>(yearRef ? "milestone" : "manual");
  const [duration, setDuration] = useState<number>(() => {
    if (startYearForDuration != null && value >= startYearForDuration) {
      return value - startYearForDuration + 1;
    }
    return 1;
  });

  // Re-resolve milestone when milestones change
  useEffect(() => {
    if (currentRef) {
      const resolved = resolveMilestone(currentRef, milestones);
      if (resolved != null && resolved !== currentYear) {
        setCurrentYear(resolved);
        onChange(resolved, currentRef);
      }
    }
  }, [milestones, currentRef]);

  // When in duration mode, recompute year when startYearForDuration or duration changes
  useEffect(() => {
    if (mode === "duration" && startYearForDuration != null) {
      const y = startYearForDuration + duration - 1;
      if (y !== currentYear) {
        setCurrentYear(y);
        onChange(y, null);
      }
    }
  }, [mode, duration, startYearForDuration]);

  const labels = buildLabels(clientFirstName, spouseFirstName);
  const refs = availableRefs(milestones, showSSRefs).map((r) => ({
    ...r,
    label: labels[r.ref],
  }));

  function handleModeChange(newMode: string) {
    if (newMode === "manual") {
      setMode("manual");
      setCurrentRef(null);
      onChange(currentYear, null);
    } else if (newMode === "duration") {
      setMode("duration");
      setCurrentRef(null);
      if (startYearForDuration != null) {
        const y = startYearForDuration + duration - 1;
        setCurrentYear(y);
        onChange(y, null);
      }
    } else {
      const ref = newMode as YearRef;
      const resolved = resolveMilestone(ref, milestones);
      if (resolved != null) {
        setMode("milestone");
        setCurrentRef(ref);
        setCurrentYear(resolved);
        onChange(resolved, ref);
      }
    }
  }

  function handleYearChange(year: number) {
    setCurrentYear(year);
    setCurrentRef(null);
    setMode("manual");
    onChange(year, null);
  }

  const selectValue = mode === "milestone" && currentRef ? currentRef : mode;

  return (
    <div>
      <label className="block text-xs font-medium text-gray-300" htmlFor={id}>
        {label}
      </label>

      <select
        value={selectValue}
        onChange={(e) => handleModeChange(e.target.value)}
        className={`mt-1 ${SELECT_CLASS}`}
      >
        <option value="manual">Manual</option>
        {startYearForDuration != null && <option value="duration">Duration</option>}
        {refs.map((r) => (
          <option key={r.ref} value={r.ref}>
            {r.label} ({r.year})
          </option>
        ))}
      </select>

      {mode === "duration" ? (
        <div className="relative mt-1">
          <input
            id={id}
            type="number"
            min={1}
            max={100}
            value={duration}
            onChange={(e) => setDuration(Math.max(1, Number(e.target.value) || 1))}
            className={INPUT_CLASS}
          />
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-gray-300">
            years → {currentYear}
          </span>
          {/* Hidden input carries the computed year for FormData */}
          <input type="hidden" name={name} value={currentYear} />
        </div>
      ) : (
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
            className={`${INPUT_CLASS} ${currentRef ? "text-gray-300" : ""}`}
          />
          {currentRef && (
            <span className="absolute inset-y-0 right-2 flex items-center">
              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs text-accent">
                {labels[currentRef]}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
