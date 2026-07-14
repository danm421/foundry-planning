"use client";

import { useEffect, useRef, useState } from "react";
import { ageForYear } from "@/lib/age-year";

interface Props {
  /** Calendar year to display (birthYear + current age). */
  year: number | null;
  /** Household birth year. Null → nothing renders (no year to show/edit). */
  birthYear: number | null;
  /** Age clamp applied to a typed year before it's committed. */
  min: number;
  max: number;
  /** Accessible name for the year input. */
  ariaLabel: string;
  /** Commit a back-solved age (year − birthYear, clamped). */
  onCommitAge: (age: number) => void;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/**
 * The calendar year beside a solver age slider — a read-out you can also edit.
 * Click "in 2045" to type a target year; it back-solves the age and commits it,
 * so the slider follows. Mirrors the click-to-edit affordance of the value in
 * `SolverFieldSlider`. Renders nothing when the birth year is unknown.
 */
export function SolverYearEdit({
  year,
  birthYear,
  min,
  max,
  ariaLabel,
  onCommitAge,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    el?.focus();
    el?.select();
  }, [editing]);

  if (birthYear == null || year == null) return null;

  function startEdit() {
    setDraft(String(year));
    setEditing(true);
  }

  function commit() {
    const y = parseInt(draft, 10);
    if (Number.isFinite(y)) {
      const age = ageForYear(birthYear, y);
      if (age != null) onCommitAge(clamp(age, min, max));
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={draft}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") setEditing(false);
        }}
        onBlur={commit}
        className="w-14 rounded border border-accent bg-card-2 px-1.5 py-0.5 text-[11px] tabular text-ink focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      aria-label={`Edit ${ariaLabel}`}
      className="rounded px-1 py-0.5 text-[11px] tabular text-ink-4 transition hover:bg-card-2 hover:text-ink-3"
    >
      in {year}
    </button>
  );
}
