"use client";

import { useState } from "react";

import { FieldTooltip } from "@/components/forms/field-tooltip";

/** Shared by the narrow numeric inputs so a styling change cannot land on one
 *  and miss the others. `DollarField` is deliberately wider and keeps its own. */
const NUMBER_INPUT_CLASS =
  "w-24 rounded border border-hair bg-card px-2 py-1 text-[13px] text-ink tabular-nums";

/** A toggleable stressor block: checkbox + label + (when on) its parameter inputs. */
export function StressRow({
  label,
  hint,
  on,
  disabled = false,
  lockToggle = false,
  onToggle,
  footer,
  children,
}: {
  label: string;
  hint: string;
  on: boolean;
  disabled?: boolean;
  /** Disables only the checkbox and keeps the row's fields on screen — a save
   *  in flight, or view-only access to a saved stressor. */
  lockToggle?: boolean;
  onToggle: (checked: boolean) => void;
  /** Shown under the row whether or not it is on — a saved stressor's status. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-hair pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2">
        <label className={`flex items-center gap-2 ${disabled ? "opacity-50" : ""}`}>
          <input
            type="checkbox"
            checked={on && !disabled}
            disabled={disabled || lockToggle}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          <span className="text-[13px] font-medium text-ink">{label}</span>
        </label>
        <FieldTooltip text={hint} />
      </div>
      {on && !disabled ? <div className="mt-3">{children}</div> : null}
      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  );
}

/** A year input that may be left empty. Empty commits null — `YearField` would
 *  read the blank as `Number("") === 0` and commit year zero. */
export function OptionalYearField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: number | null;
  placeholder: string;
  onCommit: (year: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-3">{label}</span>
      <input
        type="number"
        step="1"
        placeholder={placeholder}
        defaultValue={value ?? ""}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          if (raw === "") {
            onCommit(null);
            return;
          }
          const next = Number(raw);
          if (Number.isFinite(next)) onCommit(Math.round(next));
        }}
        className={NUMBER_INPUT_CLASS}
      />
    </label>
  );
}

export function PercentField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (decimal: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-3">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          step="0.5"
          min="0"
          defaultValue={Math.round(value * 10000) / 100}
          onBlur={(e) => {
            // Leaving the box as shown commits nothing: the shown text can be a
            // rounding of the value, and committing it would change the value.
            if (e.target.value === e.target.defaultValue) return;
            const next = Number(e.target.value);
            if (Number.isFinite(next)) onCommit(Math.max(0, next) / 100);
          }}
          className={NUMBER_INPUT_CLASS}
        />
        <span className="text-[12px] text-ink-3">%</span>
      </div>
    </label>
  );
}

export function DollarField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (dollars: number) => void;
}) {
  const [text, setText] = useState(() => formatDollars(value));

  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-3">{label}</span>
      <div className="flex items-center gap-1">
        <span className="text-[12px] text-ink-3">$</span>
        <input
          type="text"
          inputMode="numeric"
          value={text}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            setText(digits === "" ? "" : formatDollars(Number(digits)));
          }}
          onBlur={() => {
            const next = Number(text.replace(/\D/g, ""));
            const dollars = Number.isFinite(next) ? Math.max(0, next) : 0;
            setText(formatDollars(dollars));
            onCommit(dollars);
          }}
          className="w-32 rounded border border-hair bg-card px-2 py-1 text-[13px] text-ink tabular-nums"
        />
      </div>
    </label>
  );
}

/** Whole-dollar value with thousand separators (no cents, no symbol). */
function formatDollars(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function YearField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (year: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-3">{label}</span>
      <input
        type="number"
        step="1"
        defaultValue={value}
        onBlur={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onCommit(Math.round(next));
        }}
        className={NUMBER_INPUT_CLASS}
      />
    </label>
  );
}

export function SelectField({
  label,
  value,
  options,
  onCommit,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onCommit: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-3">{label}</span>
      <select
        value={value}
        onChange={(e) => onCommit(e.target.value)}
        className="w-full rounded border border-hair bg-card px-2 py-1 text-[13px] text-ink"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
