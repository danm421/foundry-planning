"use client";

import { useState, useEffect } from "react";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import { availableRefs, resolveMilestone, YEAR_REF_LABELS } from "@/lib/milestones";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";
import { householdAgePeople } from "@/lib/year-or-age";
import YearOrAgeInput, { YearReadout } from "@/components/year-or-age-input";
import { fieldLabelClassName, inputBaseClassName, selectBaseClassName } from "@/components/forms/input-styles";

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
  /**
   * Open in "Duration" mode rather than "Manual" whenever there is no milestone
   * ref — for records where the SPAN is the meaningful quantity and the end
   * date is merely where it lands. An education goal is "four years" however
   * its start moves. Requires `startYearForDuration`; ignored without it.
   */
  preferDuration?: boolean;
  /**
   * Whether this picker is choosing a start year or end year. Drives
   * position-aware milestone resolution: transition refs (retirement, death,
   * SS-claim ages) used as `end` resolve to `year - 1` so the picked stream
   * stops the year before the transition rather than overlapping it.
   * Defaults to "start" for backwards compatibility.
   */
  position?: "start" | "end";
  /**
   * Optional minimum allowed year. Applied as the HTML `min` attribute on the
   * underlying number input. Used by callers that need to floor the year above
   * a related event (e.g. a sell-year picker floored to buy.year + 1).
   */
  minYear?: number;
  /**
   * The label takes the dialog's field-label style and spacing
   * (`fieldLabelClassName`), so it lines up with the fields beside it.
   */
  compact?: boolean;
}

/** The names this picker shows — first names when provided. */
function personNames(clientFirstName?: string, spouseFirstName?: string) {
  return {
    client: clientFirstName?.trim() || "Client",
    spouse: spouseFirstName?.trim() || CO_CLIENT_LABEL,
  };
}

/** Build display labels for this picker, personalized by `personNames`. */
function buildLabels({ client: clientName, spouse: spouseName }: ReturnType<typeof personNames>): Record<YearRef, string> {
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
  preferDuration = false,
  position = "start",
  minYear,
  compact = false,
}: MilestoneYearPickerProps) {
  type Mode = "manual" | "milestone" | "duration";

  /** How a given ref/year pair presents: a ref always wins, and a bare year is
   *  a duration only where the caller asked for one and a start exists. */
  function modeFor(ref: YearRef | null): Mode {
    if (ref) return "milestone";
    return preferDuration && startYearForDuration != null ? "duration" : "manual";
  }
  function durationFor(year: number): number {
    if (startYearForDuration == null) return 1;
    return Math.max(1, year - startYearForDuration + 1);
  }

  const [currentRef, setCurrentRef] = useState<YearRef | null>(yearRef);
  const [currentYear, setCurrentYear] = useState(value);
  const [mode, setMode] = useState<Mode>(() => modeFor(yearRef));
  const [duration, setDuration] = useState<number>(() => durationFor(value));

  // Adopt a year the parent sets programmatically. The picker owns its year
  // between edits, so without this it keeps rendering its mount-time value
  // while the parent holds a newer one — which is exactly what an education
  // goal does when the beneficiary changes and the dialog re-dates the goal to
  // their 18th year.
  //
  // Both guards are load-bearing. The outer one requires the props to have
  // actually CHANGED, so a parent that drops `onChange` on the floor can't
  // revert an edit the picker is mid-way through. The inner one ignores a
  // parent echoing back what this picker just emitted, which would otherwise
  // reset `mode` and knock the advisor out of Duration.
  const [prevProps, setPrevProps] = useState({ value, yearRef });
  if (value !== prevProps.value || yearRef !== prevProps.yearRef) {
    setPrevProps({ value, yearRef });
    if (value !== currentYear || yearRef !== currentRef) {
      setCurrentYear(value);
      setCurrentRef(yearRef);
      setMode(modeFor(yearRef));
      setDuration(durationFor(value));
    }
  }

  // Re-resolve milestone when milestones change
  useEffect(() => {
    if (currentRef) {
      const resolved = resolveMilestone(currentRef, milestones, position);
      if (resolved != null && resolved !== currentYear) {
        setCurrentYear(resolved);
        onChange(resolved, currentRef);
      }
    }
  }, [milestones, currentRef, position]);

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

  const names = personNames(clientFirstName, spouseFirstName);
  const labels = buildLabels(names);
  const refs = availableRefs(milestones, showSSRefs, position).map((r) => ({
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
      const resolved = resolveMilestone(ref, milestones, position);
      if (resolved != null) {
        setMode("milestone");
        setCurrentRef(ref);
        setCurrentYear(resolved);
        onChange(resolved, ref);
      }
    }
  }

  function handleYearChange(year: number | null) {
    if (year == null) return;
    setCurrentYear(year);
    setCurrentRef(null);
    setMode("manual");
    onChange(year, null);
  }

  const people = householdAgePeople(milestones, names);
  const selectValue = mode === "milestone" && currentRef ? currentRef : mode;

  // One row: the source on the left, the year (or span) right beside it, and
  // everyone's age that year after it (on a second line when there's no room). A milestone shows no year box — its
  // option already names the year — so the select takes the label there.
  return (
    <div>
      <label
        className={compact ? fieldLabelClassName : "block text-xs font-medium text-ink-3"}
        htmlFor={id}
      >
        {label}
      </label>

      {/* The ages wrap under the row when a narrow dialog has no room beside it. */}
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1${compact ? "" : " mt-1"}`}>
        <select
          id={mode === "milestone" ? id : undefined}
          value={selectValue}
          onChange={(e) => handleModeChange(e.target.value)}
          className={`${selectBaseClassName} min-w-[7.5rem] flex-1`}
        >
          <option value="manual">Manual</option>
          {startYearForDuration != null && <option value="duration">Duration</option>}
          {refs.map((r) => (
            <option key={r.ref} value={r.ref}>
              {r.label} ({r.year})
            </option>
          ))}
        </select>

        {mode === "manual" && (
          <YearOrAgeInput
            id={id}
            year={currentYear}
            onChange={handleYearChange}
            people={people}
            min={minYear}
          />
        )}
        {mode === "duration" && (
          <>
            {/* "yrs" sits inside the box so the readout keeps the room. */}
            <div className="relative shrink-0">
              <input
                id={id}
                type="number"
                min={1}
                max={100}
                value={duration}
                onChange={(e) => setDuration(Math.max(1, Number(e.target.value) || 1))}
                className={`${inputBaseClassName} w-[4.5rem] pr-8 tabular`}
              />
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-ink-3">
                yrs
              </span>
            </div>
            <YearReadout year={currentYear} people={people} showYear />
          </>
        )}
        {mode === "milestone" && <YearReadout year={currentYear} people={people} />}
      </div>

      {/* The resolved year rides along for FormData in every mode. */}
      <input type="hidden" name={name} value={currentYear} />
    </div>
  );
}
