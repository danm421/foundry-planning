"use client";

import type React from "react";
import { useState } from "react";
import { cleanInput, formatDisplay } from "@/components/currency-input";

export const selectCls =
  "block w-full max-w-xs rounded border border-ink-3 bg-card px-2 py-1.5 text-sm text-ink";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-ink-3">{label}</span>
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
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
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
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
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
  disabled,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
  disabled?: (v: string) => boolean;
}) {
  return (
    <div className="inline-flex rounded border border-ink-3 p-0.5">
      {options.map(([val, label]) => {
        const isDisabled = disabled?.(val) ?? false;
        return (
          <button
            key={val}
            type="button"
            disabled={isDisabled}
            onClick={() => onChange(val)}
            className={`rounded px-3 py-1 text-xs ${
              value === val ? "bg-accent text-accent-on" : "text-ink-2"
            } ${isDisabled ? "cursor-not-allowed opacity-40" : ""}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
