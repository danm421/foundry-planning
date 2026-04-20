"use client";

import { DEDUCTIBLE_ELIGIBLE_SUBTYPES } from "@/lib/tax/derive-deductions";

/** True if the deductibility checkbox should be rendered for this account.
 *  Hides the checkbox for Roth, non-retirement, 529, cash, taxable, etc. */
export function supportsDeductibility(category: string | undefined, subType: string | undefined): boolean {
  if (category !== "retirement") return false;
  return DEDUCTIBLE_ELIGIBLE_SUBTYPES.has(subType ?? "");
}

/** Initial checked state for a new rule based on subtype.
 *  - traditional_ira / 401k / 403b → checked
 *  - other (retirement)            → unchecked (advisor asserts eligibility) */
export function defaultDeductibleForSubtype(subType: string | undefined): boolean {
  if (!subType) return false;
  if (subType === "other") return false;
  return true;
}

interface Props {
  /** Current checked state (controlled by parent). */
  checked: boolean;
  onChange: (checked: boolean) => void;
  idPrefix?: string;
}

/**
 * Checkbox letting the advisor mark a savings-rule contribution as tax-deductible.
 * Render only when `supportsDeductibility(category, subType)` is true.
 * The parent controls `checked` so it can sync with form state.
 */
export default function DeductibleContributionCheckbox({
  checked,
  onChange,
  idPrefix = "sr",
}: Props) {
  return (
    <label className="flex items-start gap-2 rounded-md border border-gray-800 bg-gray-900/60 p-3 text-sm text-gray-300">
      <input
        id={`${idPrefix}-deductible`}
        name="isDeductible"
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-1 focus:ring-blue-500"
      />
      <span>
        <span className="font-medium text-gray-200">Contribution is tax-deductible (pre-tax)</span>
        <span className="block text-[11px] text-gray-500">
          Uncheck for after-tax / non-deductible contributions (e.g., non-deductible traditional IRA, after-tax 401(k) for a backdoor Roth).
        </span>
      </span>
    </label>
  );
}
