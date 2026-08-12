"use client";

import { useId } from "react";
import { FieldTooltip } from "@/components/forms/field-tooltip";

/** The API stores advisory fees as decimal fractions bounded `.min(0).max(0.1)`,
 *  so a typed percent is bounded at 10. */
export const MAX_ADVISORY_FEE_PCT = 10;

const ADVISORY_FEE_TOOLTIP =
  "Only the advisory fee you charge on top of the funds. The funds' own expense ratios come from fund data automatically and are already in the fee comparison — don't add them here.";

/**
 * Decimals of percent the fee is carried at, everywhere.
 *
 * `advisory_fee_current` / `advisory_fee_proposed` are `numeric(6,5)`: five
 * decimals of fraction, so three of percent. A fourth would round in the column
 * while the frozen jsonb snapshot kept what was sent — and the screen seeds its
 * input from the column but tests it against the snapshot, so the two would
 * disagree, report "the advisory fee changed" on a screen nobody touched, and
 * advance the as-of date on a save that changed nothing. A thousandth of a
 * percent is a tenth of a basis point; no advisory fee is quoted that finely.
 */
const FEE_PCT_DECIMALS = 3;

/** Percent text as the decimal fraction the API stores. Blank means "no fee on
 *  file", which the API takes as an explicit null. Rounded to what the column
 *  holds exactly, so the stored fee and the stored snapshot can never differ.
 *  Call `feePctError` first. */
export function feePctToFraction(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return Number((Number(trimmed) / 100).toFixed(FEE_PCT_DECIMALS + 2));
}

/** Decimal fraction back to percent text for the input. */
export function feeFractionToPct(value: number | null): string {
  return value == null ? "" : String(Number((value * 100).toFixed(FEE_PCT_DECIMALS)));
}

/** The message to show under the field, or null when the value is usable. */
export function feePctError(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > MAX_ADVISORY_FEE_PCT) {
    return `Enter a fee between 0 and ${MAX_ADVISORY_FEE_PCT}%.`;
  }
  return null;
}

export interface ProposalFeesProps {
  /** Percent text, e.g. "1.0" for 1%. Empty means no advisory fee on file. */
  current: string;
  proposed: string;
  onCurrentChange: (text: string) => void;
  onProposedChange: (text: string) => void;
}

function FeeInput({
  label,
  value,
  onChange,
  tooltip,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  tooltip?: string;
}) {
  const error = feePctError(value);
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex items-center gap-1.5 text-xs text-ink-2">
        {label}
        {tooltip && <FieldTooltip text={tooltip} />}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        max={MAX_ADVISORY_FEE_PCT}
        step={0.01}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        // The visible label carries the tooltip's "?" glyph, so the accessible
        // name is set explicitly rather than read off the label text.
        aria-label={label}
        aria-invalid={error !== null}
        className="tabular h-9 w-28 rounded-md border border-hair-2 bg-card-2 px-2 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
      {error && <p className="text-xs text-crit">{error}</p>}
    </div>
  );
}

export function ProposalFees({
  current,
  proposed,
  onCurrentChange,
  onProposedChange,
}: ProposalFeesProps) {
  return (
    <div className="rounded-lg border border-hair-2 bg-card p-4">
      <h3 className="mb-1 text-sm font-medium text-ink">Advisory fees (%)</h3>
      <p className="mb-3 text-xs text-ink-3">
        Optional. Leave blank to compare fund costs alone.
      </p>
      <div className="flex flex-wrap gap-6">
        <FeeInput
          label="Current advisory fee"
          value={current}
          onChange={onCurrentChange}
          tooltip={ADVISORY_FEE_TOOLTIP}
        />
        <FeeInput
          label="Proposed advisory fee"
          value={proposed}
          onChange={onProposedChange}
          tooltip={ADVISORY_FEE_TOOLTIP}
        />
      </div>
    </div>
  );
}
