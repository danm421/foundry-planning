"use client";

// A year box sized for four digits that also takes an age, with the reading
// spelled out beside it. Type 2041 and it shows "Dan 65 · Jane 63"; type 65 and
// it shows "→ 2041 · Dan 65 · Jane 63", then settles on 2041 when the box loses
// focus. The rules live in `@/lib/year-or-age`.
//
// The box is text, not `type="number"`: a number input's `min` would refuse
// "65" at submit, and the whole point is that 65 is a legal thing to type.
// A four-digit year commits as it is typed. An age commits on blur or Enter —
// per keystroke, the "20" on the way to "2041" would save as age 20.

import { useState, type ReactNode } from "react";
import { agesInYear, readYearOrAge, YEAR_MAX, YEAR_MIN, type AgePerson } from "@/lib/year-or-age";
import { inputBaseClassName } from "@/components/forms/input-styles";

/** "→ 2041 · Dan 65 · Jane 63" — the year (when the box does not already show
 *  it) and everyone's age that year. Renders nothing when there is nothing to say. */
export function YearReadout({
  year,
  people,
  showYear = false,
  id,
}: {
  year: number;
  people: AgePerson[];
  showYear?: boolean;
  id?: string;
}) {
  const ages = agesInYear(year, people);
  if (!showYear && ages.length === 0) return null;
  const title = [showYear ? String(year) : null, ...ages.map((a) => `${a.name} ${a.age}`)]
    .filter(Boolean)
    .join(" · ");
  return (
    <span id={id} title={title} className="max-w-full truncate whitespace-nowrap text-xs text-ink-3">
      {showYear && <span className="tabular text-ink-2">→ {year}</span>}
      {ages.map((a, i) => (
        <span key={a.name + i}>
          {(showYear || i > 0) && " · "}
          {a.name} <span className="tabular text-ink-2">{a.age}</span>
        </span>
      ))}
    </span>
  );
}

interface YearOrAgeInputProps {
  id?: string;
  /** The committed year; null only where `emptyLabel` gives empty a meaning. */
  year: number | null;
  onChange: (year: number | null) => void;
  /** Client first: a two- or three-digit entry is the FIRST person's age. */
  people: AgePerson[];
  /** Raises the floor above `YEAR_MIN` (never lowers it). */
  min?: number;
  max?: number;
  /** When set, the box may be cleared (reported as null) and the readout shows
   *  this instead — "First plan year". Without it, clearing reverts on blur. */
  emptyLabel?: string;
  "aria-label"?: string;
  /** Size variant for tight hosts; `inputBaseClassName` (h-9) by default. */
  inputClassName?: string;
}

export default function YearOrAgeInput({
  id,
  year,
  onChange,
  people,
  min,
  max = YEAR_MAX,
  emptyLabel,
  "aria-label": ariaLabel,
  inputClassName = inputBaseClassName,
}: YearOrAgeInputProps) {
  const committedText = year == null ? "" : String(year);
  // The box owns its text only while it has focus; otherwise it shows the
  // committed year, so a year the parent sets lands without any syncing effect.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? committedText;

  const floor = Math.max(YEAR_MIN, min ?? YEAR_MIN);
  const read = (t: string) => readYearOrAge(t, people[0]?.birthYear, { min: floor, max });
  const entry = read(text);
  const readoutId = id ? `${id}-readout` : undefined;
  const hint =
    entry?.kind === "age" && people[0]
      ? `${text} is ${people[0].name}'s age`
      : `Type a year${people[0] ? `, or ${people[0].name}'s age` : ""}`;

  function commit(t: string, kinds: "year" | "any") {
    const e = read(t);
    if (e?.inRange && (kinds === "any" || e.kind === "year") && e.year !== year) onChange(e.year);
  }

  function handleChange(next: string) {
    const digits = next.replace(/\D/g, "").slice(0, 4);
    setDraft(digits);
    if (digits === "" && emptyLabel != null) onChange(null);
    else commit(digits, "year");
  }

  let readout: ReactNode = null;
  if (text === "" && emptyLabel != null) {
    readout = <span id={readoutId} className="whitespace-nowrap text-xs text-ink-3">{emptyLabel}</span>;
  } else if (entry?.inRange) {
    readout = <YearReadout id={readoutId} year={entry.year} people={people} showYear={entry.kind === "age"} />;
  } else if (entry?.kind === "year") {
    // Four digits outside the allowed span — say why instead of silently
    // reverting on blur. A short age read en route to a year ("20" of "2041")
    // stays quiet: it is mid-typing, not a mistake.
    readout = (
      <span id={readoutId} className="whitespace-nowrap text-xs text-warn">
        {entry.year < floor ? `${floor} or later` : `${max} or earlier`}
      </span>
    );
  }

  return (
    <>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        aria-label={ariaLabel}
        aria-describedby={readout ? readoutId : undefined}
        title={hint}
        value={text}
        onFocus={(e) => {
          setDraft(committedText);
          e.target.select();
        }}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(text, "any");
        }}
        // Whatever did not resolve falls back to the last year that did.
        onBlur={() => {
          commit(text, "any");
          setDraft(null);
        }}
        className={`${inputClassName} w-[4.5rem] shrink-0 text-center tabular`}
      />
      {readout}
    </>
  );
}
