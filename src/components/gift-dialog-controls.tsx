"use client";

import type React from "react";

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
