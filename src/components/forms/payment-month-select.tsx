"use client";

import { FieldTooltip } from "./field-tooltip";
import { fieldLabelBaseClassName, selectClassName } from "./input-styles";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * When in the year this row's money moves.
 *
 * The default option reads "Monthly" rather than "None" or "Spread evenly": it
 * names what the plan actually does with an untimed row, instead of describing
 * a setting the advisor declined to make.
 *
 * Presentation only — `paymentMonth` shapes the month-by-month cash flow view
 * and nothing under `src/engine/` reads it.
 */
export function PaymentMonthSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <label className={fieldLabelBaseClassName} htmlFor={id}>
          Paid in
        </label>
        <FieldTooltip text="Monthly spreads the amount evenly. Pick a month to have the whole year's amount land there instead." />
      </div>
      <select
        id={id}
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={`mt-1 ${selectClassName}`}
      >
        <option value="">Monthly</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
