"use client";

import { useState, type ReactNode } from "react";
import { inputBaseClassName, fieldLabelClassName } from "./input-styles";
import { yearForAge, ageForYear } from "@/lib/age-year";

interface AgeYearFieldProps {
  /** FormData key AND input id — the age is what gets submitted, unchanged. */
  name: string;
  label: string;
  required?: boolean;
  /** Seed age. Uncontrolled-style: only the initial value is read. */
  defaultAge: number;
  min: number;
  max: number;
  /** Live birth year from the form's DOB field. Null → year input disabled. */
  birthYear: number | null;
  /** Optional helper text rendered below the inputs. */
  hint?: ReactNode;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/**
 * A linked Age + Year pair for a planning age field (retirement age, life
 * expectancy). Type the age and the year fills in; type the year and the age
 * back-solves from the household's birth year — both stay visible.
 *
 * The age is canonical: the `name`d input carries it so the surrounding form's
 * `FormData` submit path is unchanged (the API still receives an age). The year
 * is derived for display and, while focused, editable. When no birth year is
 * known (DOB not entered yet) the year input is disabled and only the age reads.
 */
export function AgeYearField({
  name,
  label,
  required,
  defaultAge,
  min,
  max,
  birthYear,
  hint,
}: AgeYearFieldProps) {
  const [age, setAge] = useState(String(defaultAge));
  // Non-null only while the user is actively typing in the year box; otherwise
  // the year mirrors `birthYear + age`.
  const [yearDraft, setYearDraft] = useState<string | null>(null);

  const derivedYear =
    age !== "" ? yearForAge(birthYear, Number(age)) : null;
  const yearValue = yearDraft ?? (derivedYear != null ? String(derivedYear) : "");
  const yearId = `${name}-year`;

  function onAgeInput(raw: string) {
    setAge(raw.replace(/\D/g, ""));
    setYearDraft(null);
  }

  function onYearInput(raw: string) {
    const clean = raw.replace(/\D/g, "");
    setYearDraft(clean);
    if (clean.length === 4 && birthYear != null) {
      const a = ageForYear(birthYear, Number(clean));
      if (a != null) setAge(String(clamp(a, min, max)));
    }
  }

  return (
    <div>
      <label className={fieldLabelClassName} htmlFor={name}>
        {label} {required ? <span className="text-red-500">*</span> : null}
      </label>
      <div className="mt-1 flex items-end gap-2">
        <div className="flex-1 min-w-0">
          <input
            id={name}
            name={name}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            required={required}
            value={age}
            onChange={(e) => onAgeInput(e.target.value)}
            aria-label={`${label} (age)`}
            className={`${inputBaseClassName} w-full`}
          />
          <span className="mt-1 block text-[11px] text-ink-4">Age</span>
        </div>
        <span className="pb-2.5 text-[13px] text-ink-4">in</span>
        <div className="flex-1 min-w-0">
          <input
            id={yearId}
            type="number"
            inputMode="numeric"
            value={yearValue}
            disabled={birthYear == null}
            onChange={(e) => onYearInput(e.target.value)}
            onBlur={() => setYearDraft(null)}
            aria-label={`${label} (calendar year)`}
            placeholder={birthYear == null ? "—" : undefined}
            className={`${inputBaseClassName} w-full`}
          />
          <span className="mt-1 block text-[11px] text-ink-4">Year</span>
        </div>
      </div>
      {hint ? <div className="mt-1">{hint}</div> : null}
    </div>
  );
}
