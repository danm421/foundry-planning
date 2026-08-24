"use client";

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
 * and nothing under `src/engine/` reads it. Styled by hand in gray-* to match
 * the other selects in `income-expenses-view.tsx` (its ~40 controls import no
 * design tokens; one token-styled control among them would read as a mistake).
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
      <label className="block text-sm font-medium text-gray-300" htmlFor={id}>
        Paid in
      </label>
      <select
        id={id}
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      >
        <option value="">Monthly</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-gray-400">
        Monthly spreads the amount evenly. Pick a month to have the whole
        year&apos;s amount land there instead.
      </p>
    </div>
  );
}
