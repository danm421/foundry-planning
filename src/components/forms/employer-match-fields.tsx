"use client";

import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";

/** Account subtypes that can receive an employer match. UI hides the entire
 *  match section for any account whose subType is not in this set. Consolidates
 *  the constant that was previously duplicated across savings-rule-dialog and
 *  add-account-form. */
export const EMPLOYER_MATCH_SUB_TYPES = new Set([
  "401k",
  "roth_401k",
  "403b",
  "roth_403b",
  "other",
]);

export type MatchMode = "none" | "percent" | "flat";

export function pctFromDecimal(v: string | null | undefined, fallback: number): number {
  if (v === null || v === undefined || v === "") return fallback;
  return Math.round(Number(v) * 10000) / 100;
}

/** True if this account subtype is eligible for an employer match UI. */
export function supportsEmployerMatch(category: string | undefined, subType: string | undefined): boolean {
  if (category !== "retirement") return false;
  return EMPLOYER_MATCH_SUB_TYPES.has(subType ?? "");
}

/** Pick the initial match mode from stored values on an existing rule. */
export function inferMatchMode(
  employerMatchAmount: string | null | undefined,
  employerMatchPct: string | null | undefined
): MatchMode {
  if (employerMatchAmount && Number(employerMatchAmount) > 0) return "flat";
  if (employerMatchPct && Number(employerMatchPct) > 0) return "percent";
  return "none";
}

interface Props {
  mode: MatchMode;
  onModeChange: (mode: MatchMode) => void;
  /** Existing values (decimal strings) if editing; ignored if creating. */
  initialPct?: string | null;
  initialCap?: string | null;
  initialAmount?: string | null;
  /** Prefix for input ids so the component can be used twice on one page. */
  idPrefix?: string;
}

/**
 * Shared employer-match UI used by both SavingsRuleDialog and the add-account
 * create-mode Savings form. Caller must only render this when
 * `supportsEmployerMatch(category, subType)` is true.
 *
 * Uncontrolled inputs with stable `name` attributes so the parent can read
 * them from FormData. The current `mode` is controlled by the parent so it
 * can decide which field set to persist to the backend.
 */
export default function EmployerMatchFields({
  mode,
  onModeChange,
  initialPct,
  initialCap,
  initialAmount,
  idPrefix = "sr",
}: Props) {
  return (
    <div className="rounded-md border border-gray-800 bg-gray-900/60 p-3">
      <div className="mb-2 flex items-center gap-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-300">
          Employer Match
        </span>
        <div className="flex gap-1 text-xs">
          {(["none", "percent", "flat"] as const).map((m) => (
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
              {m === "none" ? "None" : m === "percent" ? "% of salary" : "Flat $"}
            </button>
          ))}
        </div>
      </div>

      {mode === "percent" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-300" htmlFor={`${idPrefix}-match-pct`}>
              Match rate (%)
            </label>
            <PercentInput
              id={`${idPrefix}-match-pct`}
              name="employerMatchPct"
              placeholder="e.g., 50 or 3"
              defaultValue={initialPct ? pctFromDecimal(initialPct, 0) : ""}
              className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-300" htmlFor={`${idPrefix}-match-cap`}>
              Cap (% of salary) — optional
            </label>
            <PercentInput
              id={`${idPrefix}-match-cap`}
              name="employerMatchCap"
              placeholder="e.g., 6"
              defaultValue={initialCap ? pctFromDecimal(initialCap, 0) : ""}
              className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <p className="col-span-2 text-xs text-gray-400">
            No cap → <code>rate × account-owner salary</code>. With cap →{" "}
            <code>rate × cap × salary</code> (e.g. 50% match up to 6% of salary).
          </p>
        </div>
      )}

      {mode === "flat" && (
        <div>
          <label className="block text-xs font-medium text-gray-300" htmlFor={`${idPrefix}-match-amt`}>
            Flat annual amount ($)
          </label>
          <CurrencyInput
            id={`${idPrefix}-match-amt`}
            name="employerMatchAmount"
            placeholder="5000"
            defaultValue={initialAmount ?? ""}
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 py-2 pr-3 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <p className="mt-1 text-xs text-gray-400">
            The employer deposits this flat amount each year, regardless of salary.
          </p>
        </div>
      )}
    </div>
  );
}
