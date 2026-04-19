"use client";

import type { QuickNavView } from "./quick-nav-utils";

interface QuickNavDropdownProps {
  activeView: QuickNavView;
  onSelectView: (view: QuickNavView) => void;
  onOpenTaxes: () => void;
}

type DropdownValue = QuickNavView | "taxes";

const OPTIONS: { value: DropdownValue; label: string }[] = [
  { value: "base", label: "Base Cash Flow" },
  { value: "income", label: "Income" },
  { value: "expenses", label: "Expenses" },
  { value: "withdrawals", label: "Withdrawals" },
  { value: "assets", label: "Assets" },
  { value: "taxes", label: "Taxes" },
];

export function QuickNavDropdown({
  activeView,
  onSelectView,
  onOpenTaxes,
}: QuickNavDropdownProps) {
  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value as DropdownValue;
    if (value === "taxes") {
      onOpenTaxes();
      // Reset the select back to the active view so Taxes isn't stuck as the displayed value.
      event.target.value = activeView;
      return;
    }
    onSelectView(value);
  }

  return (
    <label className="inline-flex items-center gap-2 text-sm text-gray-300">
      <span className="text-gray-400">Jump to</span>
      <select
        value={activeView}
        onChange={handleChange}
        className="bg-gray-800 border border-gray-600 text-gray-100 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        {OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
