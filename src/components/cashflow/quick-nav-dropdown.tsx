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
    <label className="inline-flex items-center gap-2 text-sm text-ink-2">
      <span className="text-ink-2">Jump to</span>
      <select
        value={activeView}
        onChange={handleChange}
        className="bg-card border border-hair text-ink rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
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
