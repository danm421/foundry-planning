"use client";

import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import { fieldLabelClassName } from "./input-styles";

/** Account subtypes that can receive an employer match. UI hides the entire
 *  match section for any account whose subType is not in this set. Consolidates
 *  the constant that was previously duplicated across savings-rule-dialog and
 *  add-account-form. */
export const EMPLOYER_MATCH_SUB_TYPES = new Set([
  "401k",
  "403b",
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
    <div className="rounded-md border border-hair bg-card-2/60 p-3">
      <div className="mb-2 flex items-center gap-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">
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
                  : "border-hair-3 bg-card-2 text-ink-3 hover:bg-card-hover"
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
            <label className={fieldLabelClassName} htmlFor={`${idPrefix}-match-pct`}>
              Match rate (%)
            </label>
            <PercentInput
              id={`${idPrefix}-match-pct`}
              name="employerMatchPct"
              placeholder="e.g., 50 or 3"
              defaultValue={initialPct ? pctFromDecimal(initialPct, 0) : ""}
            />
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor={`${idPrefix}-match-cap`}>
              Cap (% of salary) — optional
            </label>
            <PercentInput
              id={`${idPrefix}-match-cap`}
              name="employerMatchCap"
              placeholder="e.g., 6"
              defaultValue={initialCap ? pctFromDecimal(initialCap, 0) : ""}
            />
          </div>
          <p className="col-span-2 text-xs text-ink-3">
            No cap → <code>rate × account-owner salary</code>. With cap →{" "}
            <code>rate × cap × salary</code> (e.g. 50% match up to 6% of salary).
          </p>
        </div>
      )}

      {mode === "flat" && (
        <div>
          <label className={fieldLabelClassName} htmlFor={`${idPrefix}-match-amt`}>
            Flat annual amount ($)
          </label>
          <CurrencyInput
            id={`${idPrefix}-match-amt`}
            name="employerMatchAmount"
            placeholder="5000"
            defaultValue={initialAmount ?? ""}
          />
          <p className="mt-1 text-xs text-ink-3">
            The employer deposits this flat amount each year, regardless of salary.
          </p>
        </div>
      )}
    </div>
  );
}
