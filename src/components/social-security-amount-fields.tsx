"use client";

import type { SsAmountUnit } from "@/lib/social-security/benefit-entry";
import { SS_STATED_AGES, convertAmountText, statedAgeYear } from "@/lib/social-security/benefit-entry";
import { FrequencyToggle } from "@/components/forms/frequency-toggle";
import { inputClassName, selectBaseClassName, fieldLabelClassName } from "@/components/forms/input-styles";

export interface SocialSecurityAmountFieldsProps {
  idPrefix: string;
  /** "Benefit amount" or "PIA" — also the input's accessible name. */
  label: string;
  placeholder: string;
  amount: string;
  unit: SsAmountUnit;
  /** Both change together: flipping the unit re-expresses the typed amount. */
  onChange: (next: { amount: string; unit: SsAmountUnit }) => void;
  readOnly?: boolean;
  hint?: React.ReactNode;
  /** Present only for "Benefit at a specific age". */
  statedAge?: {
    years: number;
    months: number;
    dob: string | undefined;
    onChange: (next: { years: number; months: number }) => void;
  };
}

export function SocialSecurityAmountFields(p: SocialSecurityAmountFieldsProps) {
  const stated = p.statedAge;
  const year = stated ? statedAgeYear(stated.dob, stated.years, stated.months) : null;
  return (
    <div className="mb-4">
      <label htmlFor={`${p.idPrefix}-amount`} className={fieldLabelClassName}>{p.label}</label>
      <div className="flex items-center gap-2">
        <input
          id={`${p.idPrefix}-amount`}
          type="number"
          value={p.amount}
          placeholder={p.placeholder}
          readOnly={p.readOnly}
          onChange={(e) => p.onChange({ amount: e.target.value, unit: p.unit })}
          className={inputClassName}
        />
        <FrequencyToggle
          value={p.unit}
          label={p.label}
          onChange={(next) => p.onChange({ amount: convertAmountText(p.amount, p.unit, next), unit: next })}
        />
      </div>
      {stated && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
          <span>paid if claimed at age</span>
          <select
            aria-label="Age this benefit is quoted at"
            value={stated.years}
            onChange={(e) => stated.onChange({ years: parseInt(e.target.value, 10), months: stated.months })}
            className={selectBaseClassName}
          >
            {SS_STATED_AGES.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select
            aria-label="Extra months"
            value={stated.months}
            onChange={(e) => stated.onChange({ years: stated.years, months: parseInt(e.target.value, 10) })}
            className={selectBaseClassName}
          >
            {Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{i} mo</option>)}
          </select>
          {year != null && <span className="text-ink-3">· {year}</span>}
        </div>
      )}
      {p.hint && <p className="text-[12px] text-ink-3 mt-1">{p.hint}</p>}
      {stated && (
        <p className="text-[12px] text-ink-3 mt-1">
          Already collecting? Enter the current check and the age they started.
          {" "}Figures from an SSA statement are in today&apos;s dollars.
        </p>
      )}
    </div>
  );
}
