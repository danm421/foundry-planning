"use client";

import type React from "react";
import { useState } from "react";
import { cleanInput, formatDisplay } from "@/components/currency-input";
import { FieldTooltip } from "@/components/forms/field-tooltip";

export const selectCls =
  "block w-full max-w-xs rounded border border-ink-3 bg-card px-2 py-1.5 text-sm text-ink";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  /** Longer "how does this work" copy. Rendered as a `?` badge beside the
   *  label rather than inline under the input — the dialog stays quiet enough
   *  to be on screen in front of a client. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-xs text-ink-3">
        {label}
        {hint && <FieldTooltip text={hint} />}
      </span>
      {children}
    </label>
  );
}

export function NumberInput({
  value,
  onChange,
  className,
  min,
  max,
  step,
  testId,
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  min?: number;
  max?: number;
  /** Arrow-key / spinner increment. Also what the browser validates against —
   *  the default of 1 marks a decimal entry invalid, so any field that accepts
   *  a fraction must pass this. */
  step?: number;
  testId?: string;
}) {
  return (
    <input
      type="number"
      data-testid={testId}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`${className ?? ""} block w-full max-w-[10rem] rounded border border-ink-3 bg-card px-2 py-1.5 text-sm text-ink`}
    />
  );
}

/** Whole/decimal-dollar input that thousands-groups and strips leading zeros as
 *  you type, with a leading `$`. Holds its own text buffer so an in-progress
 *  value (e.g. a trailing ".") survives round-trips through the numeric prop.
 *  Seeds once from `value`; callers that need to re-seed (e.g. switching which
 *  amount field is shown) should give the instance a distinct `key`. */
export function MoneyInput({
  value,
  onChange,
  className,
  testId,
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  testId?: string;
}) {
  const [text, setText] = useState(() => (value ? String(value) : ""));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = cleanInput(e.target.value);
    setText(cleaned);
    const parsed = cleaned === "" || cleaned === "-" ? 0 : Number(cleaned);
    onChange(Number.isFinite(parsed) ? parsed : 0);
  };

  return (
    <div className={`relative w-full max-w-[10rem] ${className ?? ""}`}>
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-ink-3">$</span>
      <input
        type="text"
        data-testid={testId}
        inputMode="decimal"
        value={formatDisplay(text)}
        onChange={handleChange}
        className="block w-full rounded border border-ink-3 bg-card py-1.5 pl-6 pr-2 text-sm text-ink"
      />
    </div>
  );
}

export function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex rounded border border-ink-3 p-0.5">
      {options.map(([val, label]) => (
        <button
          key={val}
          type="button"
          onClick={() => onChange(val)}
          className={`rounded px-3 py-1 text-xs ${
            value === val ? "bg-accent text-accent-on" : "text-ink-2"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
