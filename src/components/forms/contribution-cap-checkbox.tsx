"use client";

/** Retirement subtypes that have IRS contribution limits the engine
 *  enforces: payroll-deduction plans and both IRA flavors. */
export const CONTRIBUTION_LIMIT_SUB_TYPES = new Set([
  "401k",
  "403b",
  "traditional_ira",
  "roth_ira",
]);

/** True if this account's contributions are subject to an IRS cap we
 *  enforce. Hides the checkbox for cash, taxable, 529, etc. */
export function supportsContributionCap(category: string | undefined, subType: string | undefined): boolean {
  if (category !== "retirement") return false;
  return CONTRIBUTION_LIMIT_SUB_TYPES.has(subType ?? "");
}

interface Props {
  /** Current state. Parent owns the boolean so it can include in form submit. */
  checked: boolean;
  onChange: (checked: boolean) => void;
  idPrefix?: string;
}

/** Checkbox letting the advisor opt a savings-rule out of the IRS
 *  contribution-limit cap. Defaults to checked (= engine caps the
 *  contribution). Unchecked = rule bypasses the cap (advisor models the
 *  literal entered amount). */
export default function ContributionCapCheckbox({
  checked,
  onChange,
  idPrefix = "sr",
}: Props) {
  return (
    <label className="flex items-start gap-2 rounded-md border border-gray-800 bg-gray-900/60 p-3 text-sm text-gray-300">
      <input
        id={`${idPrefix}-apply-limit`}
        name="applyContributionLimit"
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-accent focus:ring-1 focus:ring-accent"
      />
      <span>
        <span className="font-medium text-gray-200">Apply IRS contribution limit</span>
        <span className="block text-xs text-gray-400">
          When on, the engine caps this contribution at the applicable IRS limit (401(k)/403(b) deferral or IRA, including age-50+ catch-up and age 60–63 super catch-up). Uncheck to let the entered amount pass through uncapped.
        </span>
      </span>
    </label>
  );
}
