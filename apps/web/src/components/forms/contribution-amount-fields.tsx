"use client";

import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";

/** Retirement subtypes on which the employee's contribution can be entered as a
 *  percent of salary (payroll-deduction accounts). Traditional / Roth IRAs are
 *  excluded because they aren't payroll-deduction vehicles. */
export const PERCENT_CONTRIB_SUB_TYPES = new Set([
  "401k",
  "roth_401k",
  "403b",
  "roth_403b",
  "other",
]);

export type ContributionMode = "amount" | "percent";

export function pctFromDecimal(v: string | null | undefined, fallback: number): number {
  if (v === null || v === undefined || v === "") return fallback;
  return Math.round(Number(v) * 10000) / 100;
}

/** True if the contribution mode toggle should be rendered for this account. */
export function supportsPercentContribution(category: string | undefined, subType: string | undefined): boolean {
  if (category !== "retirement") return false;
  return PERCENT_CONTRIB_SUB_TYPES.has(subType ?? "");
}

/** Pick the initial contribution mode from stored values on an existing rule. */
export function inferContributionMode(annualPercent: string | null | undefined): ContributionMode {
  return annualPercent && Number(annualPercent) > 0 ? "percent" : "amount";
}

interface Props {
  mode: ContributionMode;
  onModeChange: (mode: ContributionMode) => void;
  /** Whether to render the mode toggle. When false, only the dollar input
   *  renders (for subtypes that don't support percent-of-salary mode). */
  showModeToggle: boolean;
  initialAmount?: string | number | null;
  initialPercent?: string | null;
  idPrefix?: string;
  required?: boolean;
}

/**
 * Employee-contribution amount input with an optional mode toggle:
 *   - "Dollar amount"  — single currency input (name="annualAmount").
 *   - "% of salary"    — single percent input  (name="annualPercent").
 *
 * Used by both SavingsRuleDialog and the add-account create-mode Savings form.
 * Parent reads both fields from FormData (only the one for the current mode
 * will have a value) and decides which to persist based on `mode`.
 */
export default function ContributionAmountFields({
  mode,
  onModeChange,
  showModeToggle,
  initialAmount,
  initialPercent,
  idPrefix = "sr",
  required = false,
}: Props) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-300" htmlFor={`${idPrefix}-amount`}>
          {mode === "percent" ? "Contribution (% of salary)" : "Annual Amount ($)"}
          {required && <span className="text-red-500"> *</span>}
        </label>
        {showModeToggle && (
          <div className="flex gap-1 text-xs">
            {(["amount", "percent"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange(m)}
                className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                  mode === m
                    ? "border-blue-600 bg-blue-900/40 text-blue-300"
                    : "border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800"
                }`}
              >
                {m === "amount" ? "Dollar amount" : "% of salary"}
              </button>
            ))}
          </div>
        )}
      </div>
      {mode === "amount" ? (
        <CurrencyInput
          id={`${idPrefix}-amount`}
          name="annualAmount"
          required={required}
          defaultValue={initialAmount ?? 0}
          className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 py-2 pr-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      ) : (
        <>
          <PercentInput
            id={`${idPrefix}-amount`}
            name="annualPercent"
            required={required}
            placeholder="e.g., 10"
            defaultValue={initialPercent ? pctFromDecimal(initialPercent, 0) : ""}
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-[11px] text-gray-500">
            Resolves against the account owner&rsquo;s salary each year. No salary that year → no contribution.
          </p>
        </>
      )}
    </div>
  );
}
