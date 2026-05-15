"use client";

import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import { supportsContributionCap } from "./contribution-cap-checkbox";

/** Retirement subtypes on which the employee's contribution can be entered as a
 *  percent of salary (payroll-deduction accounts). Traditional / Roth IRAs are
 *  excluded because they aren't payroll-deduction vehicles. */
export const PERCENT_CONTRIB_SUB_TYPES = new Set([
  "401k",
  "403b",
  "other",
]);

export type ContributionMode = "amount" | "percent" | "max";

export function pctFromDecimal(v: string | null | undefined, fallback: number): number {
  if (v === null || v === undefined || v === "") return fallback;
  return Math.round(Number(v) * 10000) / 100;
}

/** True if the contribution mode toggle should be rendered for this account. */
export function supportsPercentContribution(category: string | undefined, subType: string | undefined): boolean {
  if (category !== "retirement") return false;
  return PERCENT_CONTRIB_SUB_TYPES.has(subType ?? "");
}

/** Account subtypes that support a Roth / pre-tax contribution split. */
export const ROTH_SPLIT_SUB_TYPES = new Set(["401k", "403b"]);

/** True if the contribution input should offer a Roth / pre-tax split. */
export function supportsRothSplit(category: string | undefined, subType: string | undefined): boolean {
  if (category !== "retirement") return false;
  return ROTH_SPLIT_SUB_TYPES.has(subType ?? "");
}

/** True if the "Max (IRS limit)" mode is applicable to this account. */
export const supportsMaxContribution = supportsContributionCap;

/** Pick the initial contribution mode from stored values on an existing rule. */
export function inferContributionMode(
  annualPercent: string | null | undefined,
  contributeMax?: boolean | null,
): ContributionMode {
  if (contributeMax) return "max";
  return annualPercent && Number(annualPercent) > 0 ? "percent" : "amount";
}

interface Props {
  mode: ContributionMode;
  onModeChange: (mode: ContributionMode) => void;
  /** Whether to render the percent-of-salary mode toggle button. */
  showModeToggle: boolean;
  /** Whether to render the "Max (IRS limit)" mode toggle button. */
  showMaxToggle?: boolean;
  initialAmount?: string | number | null;
  initialPercent?: string | null;
  idPrefix?: string;
  required?: boolean;
  /** When true, amount/percent modes render separate Pre-tax and Roth inputs. */
  rothSplit?: boolean;
  /** Stored Roth fraction (0..1) of the contribution, as a decimal string. */
  initialRothPercent?: string | null;
}

/**
 * Employee-contribution amount input with an optional mode toggle:
 *   - "Dollar amount"  — single currency input (name="annualAmount").
 *   - "% of salary"    — single percent input  (name="annualPercent").
 *
 * When `rothSplit` is true the field names emitted change:
 *   - amount mode  → pretaxAmount + rothAmount
 *   - percent mode → pretaxPercent + rothPercentInput
 *   - max mode     → rothShareOfMax
 *
 * Used by both SavingsRuleDialog and the add-account create-mode Savings form.
 * Parent reads both fields from FormData (only the one for the current mode
 * will have a value) and decides which to persist based on `mode`.
 */
export default function ContributionAmountFields({
  mode,
  onModeChange,
  showModeToggle,
  showMaxToggle = false,
  initialAmount,
  initialPercent,
  idPrefix = "sr",
  required = false,
  rothSplit,
  initialRothPercent,
}: Props) {
  const rothRatio = initialRothPercent != null && initialRothPercent !== ""
    ? Number(initialRothPercent)
    : 0;
  const initAmt = Number(initialAmount ?? 0);
  const initPct = initialPercent ? pctFromDecimal(initialPercent, 0) : 0;
  const splitInitials = {
    pretaxAmount: initAmt * (1 - rothRatio),
    rothAmount: initAmt * rothRatio,
    pretaxPercent: initPct * (1 - rothRatio),
    rothPercent: initPct * rothRatio,
  };
  const modeOptions: ContributionMode[] = [
    "amount",
    ...(showModeToggle ? (["percent"] as ContributionMode[]) : []),
    ...(showMaxToggle ? (["max"] as ContributionMode[]) : []),
  ];
  const showAnyToggle = modeOptions.length > 1;
  const primaryInputId = rothSplit
    ? (mode === "amount" ? `${idPrefix}-pretax-amount` : mode === "percent" ? `${idPrefix}-pretax-percent` : undefined)
    : `${idPrefix}-amount`;

  const label =
    mode === "percent"
      ? "Contribution (% of salary)"
      : mode === "max"
        ? "Contribution"
        : "Annual Amount ($)";

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-300" {...(primaryInputId ? { htmlFor: primaryInputId } : {})}>
          {label}
          {required && mode !== "max" && <span className="text-red-500"> *</span>}
        </label>
        {showAnyToggle && (
          <div className="flex gap-1 text-xs">
            {modeOptions.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange(m)}
                className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
                  mode === m
                    ? "border-accent bg-accent/15 text-accent-ink"
                    : "border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800"
                }`}
              >
                {m === "amount" ? "Dollar amount" : m === "percent" ? "% of salary" : "Max (IRS limit)"}
              </button>
            ))}
          </div>
        )}
      </div>
      {mode === "amount" && (rothSplit ? (
        <div className="mt-1 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400" htmlFor={`${idPrefix}-pretax-amount`}>Pre-tax ($)</label>
            <CurrencyInput
              id={`${idPrefix}-pretax-amount`}
              name="pretaxAmount"
              defaultValue={splitInitials.pretaxAmount}
              className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 py-2 pr-3 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400" htmlFor={`${idPrefix}-roth-amount`}>Roth ($)</label>
            <CurrencyInput
              id={`${idPrefix}-roth-amount`}
              name="rothAmount"
              defaultValue={splitInitials.rothAmount}
              className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 py-2 pr-3 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>
      ) : (
        <CurrencyInput
          id={`${idPrefix}-amount`}
          name="annualAmount"
          required={required}
          defaultValue={initialAmount ?? 0}
          className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 py-2 pr-3 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      ))}
      {mode === "percent" && (rothSplit ? (
        <>
          <div className="mt-1 grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400" htmlFor={`${idPrefix}-pretax-percent`}>Pre-tax (% of salary)</label>
              <PercentInput
                id={`${idPrefix}-pretax-percent`}
                name="pretaxPercent"
                placeholder="e.g., 4"
                defaultValue={splitInitials.pretaxPercent || ""}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400" htmlFor={`${idPrefix}-roth-percent`}>Roth (% of salary)</label>
              <PercentInput
                id={`${idPrefix}-roth-percent`}
                name="rothPercentInput"
                placeholder="e.g., 3"
                defaultValue={splitInitials.rothPercent || ""}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Each resolves against the account owner&rsquo;s salary. No salary that year &rarr; no contribution.
          </p>
        </>
      ) : (
        <>
          <PercentInput
            id={`${idPrefix}-amount`}
            name="annualPercent"
            required={required}
            placeholder="e.g., 10"
            defaultValue={initialPercent ? pctFromDecimal(initialPercent, 0) : ""}
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <p className="mt-1 text-xs text-gray-400">
            Resolves against the account owner&rsquo;s salary each year. No salary that year → no contribution.
          </p>
        </>
      ))}
      {mode === "max" && (
        <>
          <div className="mt-1 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent-ink">
            Contributes the IRS limit each year for the account owner&rsquo;s age
            (base + age-50 catch-up + SECURE 2.0 60-63 super catch-up when
            applicable).
          </div>
          {rothSplit && (
            <div className="mt-2">
              <label className="block text-xs text-gray-400" htmlFor={`${idPrefix}-roth-share`}>Roth share of max contribution (%)</label>
              <PercentInput
                id={`${idPrefix}-roth-share`}
                name="rothShareOfMax"
                placeholder="0"
                defaultValue={rothRatio ? rothRatio * 100 : ""}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
