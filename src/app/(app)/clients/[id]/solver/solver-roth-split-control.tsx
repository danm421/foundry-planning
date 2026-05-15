"use client";

import { useState, useEffect } from "react";

interface Props {
  /** Roth fraction of the contribution, 0..1. null is treated as 0 (pre-tax). */
  rothPercent: number | null;
  /** Emits the new Roth fraction (0..1). */
  onChange: (rothPercent: number) => void;
}

/**
 * Parse a percent string (0..100), clamp it, and convert to a 0..1 fraction.
 * The percent is rounded to the nearest integer before dividing, so the result
 * has at most 2 decimal places (e.g. "33" → 0.33, "7" → 0.07).
 * Returns 0 for non-numeric input.
 */
function pctToFraction(raw: string): number {
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return 0;
  const clamped = Math.min(100, Math.max(0, n));
  // Round the clamped percent to the nearest whole percent before dividing by 100.
  return Math.round(clamped) / 100;
}

/** Round a 0..1 fraction to 4 decimal places to suppress floating-point drift. */
function roundFraction(f: number): number {
  return Math.round(f * 10000) / 10000;
}

/**
 * Inline Roth/pre-tax control for a 401(k)/403(b) savings rule. Whole state
 * (0 or 1) shows a two-button toggle; a partial split shows two complementary
 * percent inputs. Fully controlled — the parent gates rendering on
 * `supportsRothSplit`.
 */
export function RothSplitControl({ rothPercent, onChange }: Props) {
  const roth = rothPercent ?? 0;
  const isSplit = roth > 0 && roth < 1;

  if (isSplit) {
    const rothPct = Math.round(roth * 100);
    const pretaxPct = 100 - rothPct;
    return (
      <div className="mt-1.5 flex items-center gap-2">
        <SplitInput
          label="Pre-tax %"
          value={pretaxPct}
          onChange={(raw) => onChange(roundFraction(1 - pctToFraction(raw)))}
        />
        <span className="text-ink-4 text-[11px]">/</span>
        <SplitInput
          label="Roth %"
          value={rothPct}
          onChange={(raw) => onChange(pctToFraction(raw))}
        />
      </div>
    );
  }

  return (
    <div className="mt-1.5 inline-flex gap-1">
      <ToggleButton
        label="Pre-tax"
        active={roth === 0}
        onClick={() => onChange(0)}
      />
      <ToggleButton
        label="Roth"
        active={roth === 1}
        onClick={() => onChange(1)}
      />
    </div>
  );
}

function ToggleButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
        active
          ? "border-accent bg-accent/15 text-accent-ink"
          : "border-hair-2 bg-card-2 text-ink-2 hover:bg-card-hover"
      }`}
    >
      {label}
    </button>
  );
}

function SplitInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (raw: string) => void;
}) {
  // Local draft lets the user type multi-digit values without the controlled
  // input resetting on every keystroke. Synced back when the external value
  // changes (e.g. the parent commits a new rounded value).
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <label className="flex items-center gap-1 text-[11px] text-ink-3">
      {label.replace(" %", "")}
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        aria-label={label}
        value={draft}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          // Don't emit while the field is empty — the user is mid-edit (e.g.
          // select-all + delete before retyping). An empty string would parse
          // to 0, collapsing the split view and unmounting this input.
          if (raw === "") return;
          onChange(raw);
        }}
        className="h-7 w-14 rounded-md border border-hair-2 bg-card-2 px-1.5 text-[12px] text-ink tabular focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
      />
    </label>
  );
}
