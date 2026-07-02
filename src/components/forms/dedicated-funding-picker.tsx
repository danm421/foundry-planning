"use client";

interface PickerAccount {
  id: string;
  name: string;
  category: string;
  subType: string;
}

interface Props {
  accounts: PickerAccount[];
  /** Selected account ids, in draw order. */
  value: string[];
  onChange: (ids: string[]) => void;
}

// Accounts eligible to fund a goal: liquid/investable only.
const ELIGIBLE = new Set(["cash", "taxable", "retirement"]);

/**
 * Multi-account "Dedicated Funding" picker. A checkbox list of eligible accounts;
 * selection order is the draw order (persisted as sort_order). New territory —
 * expenses have no multi-account precedent (mirrors CashAccountPicker's category
 * filter, rebuilt as a checklist).
 */
export function DedicatedFundingPicker({ accounts, value, onChange }: Props) {
  const eligible = accounts.filter((a) => ELIGIBLE.has(a.category));
  if (eligible.length === 0) {
    return <p className="text-xs text-gray-400">No eligible funding accounts (cash / taxable / retirement).</p>;
  }
  const toggle = (id: string) =>
    value.includes(id) ? onChange(value.filter((v) => v !== id)) : onChange([...value, id]);

  return (
    <div>
      <label className="block text-sm font-medium text-gray-300">Dedicated Funding</label>
      <div className="mt-1 space-y-1 rounded-md border border-gray-600 bg-gray-800 p-2">
        {eligible.map((a) => {
          const idx = value.indexOf(a.id);
          return (
            <label key={a.id} className="flex items-center gap-2 text-sm text-gray-100">
              <input type="checkbox" checked={idx >= 0} onChange={() => toggle(a.id)} aria-label={a.name} />
              <span>{a.name}</span>
              {idx >= 0 && <span className="text-xs text-gray-400">· #{idx + 1}</span>}
            </label>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-gray-400">Drawn in the order selected. Uncovered cost is a shortfall unless &quot;pay out of pocket&quot; is on.</p>
    </div>
  );
}
