"use client";

import { FieldTooltip } from "./field-tooltip";

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
    <label className="flex items-center gap-2 rounded-md border border-hair-3 bg-card-2/60 p-3 text-sm text-ink-3">
      <input
        id={`${idPrefix}-deductible`}
        name="isDeductible"
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-hair-3 bg-card-2 text-accent focus:ring-1 focus:ring-accent"
      />
      <span className="font-medium text-ink-2">Contribution is tax-deductible (pre-tax)</span>
      <FieldTooltip text="Uncheck for after-tax / non-deductible contributions (e.g., non-deductible traditional IRA, after-tax 401(k) for a backdoor Roth)." />
    </label>
  );
}
